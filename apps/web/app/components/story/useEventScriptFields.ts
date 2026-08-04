/**
 * 事件面板共享的 StoryScript 字段控制器。
 *
 * 输入是事件草稿和故事上下文，输出自动补全、语法校验、帮助弹层和滚动同步能力。
 * 它不保存事件，也不处理对白或资产选择。
 */
import { computed, reactive, shallowRef, useTemplateRef, type ComputedRef } from "vue"
import {
  buildStoryRoleKey,
  findStoryRoleReference,
  type StoryDocument,
  type StoryEventInvokeParamDefinition,
  type StoryEventLocationFile,
  type StoryEventTriggerMode,
  type StoryRolesFile,
  type StoryValsFile
} from "@story-mgr/core"
import {
  buildStoryScriptBuiltinAutocompleteItems,
  buildStoryScriptHighlightTokens,
  buildStoryScriptInvokeAutocompleteContext,
  buildStoryReferAutocompleteItems,
  buildStoryScriptValAutocompleteItems,
  filterStoryScriptAutocompleteItems,
  mergeStoryScriptAutocompleteItems,
  openStoryScriptReferencePage,
  resolveStoryScriptAutocompletePlacement,
  resolveStoryScriptCommandAutocomplete,
  type StoryScriptAutocompleteItem
} from "./storyScriptEditor"
import { formatStoryScriptValidationIssue } from "./storyScriptValidation"

export interface SharedEventInvokeParamDraft extends StoryEventInvokeParamDefinition {
  id: string
}

export interface SharedEventScriptProps {
  eventLocations: StoryEventLocationFile
  roles: StoryRolesFile
  saving: boolean
  story?: StoryDocument | null
  vals: StoryValsFile
}

export interface SharedEventScriptDraft {
  endScript: string
  initScript: string
  invokeParams: SharedEventInvokeParamDraft[]
  selectedObjectKeys: string[]
  triggerExpr: string
  triggerMode: StoryEventTriggerMode
}

export type ScriptFieldKey = "triggerExpr" | "initScript" | "endScript"
type ScriptEditorFieldKey = Exclude<ScriptFieldKey, "triggerExpr">
type ScriptValidationStatus = "idle" | "checking" | "passed" | "failed"

interface ScriptAutocompleteState {
  open: boolean
  query: string
  replaceStart: number
  replaceEnd: number
  activeIndex: number
  placement: "top" | "bottom"
  mode?: "placeholder" | "invoke_once"
  commandItems?: StoryScriptAutocompleteItem[]
}

interface ScriptValidationState {
  status: ScriptValidationStatus
  issues: string[]
}

export interface UseEventScriptFieldsOptions {
  draft: SharedEventScriptDraft
  onScriptFieldKeydown: (field: ScriptFieldKey, event: KeyboardEvent) => void
  props: Readonly<SharedEventScriptProps>
}

/** 组合 `EventScriptFields` 的响应式状态、派生值和操作方法。 @param options 调用方传入的 `options`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useEventScriptFields(options: UseEventScriptFieldsOptions) {
  const { draft, onScriptFieldKeydown, props } = options

  const triggerExprFieldRef = useTemplateRef<HTMLDivElement>("triggerExprField")
  
  const triggerExprTextareaRef = useTemplateRef<HTMLTextAreaElement>("triggerExprTextarea")
  
  const initScriptFieldRef = useTemplateRef<HTMLDivElement>("initScriptField")
  
  const initScriptTextareaRef = useTemplateRef<HTMLTextAreaElement>("initScriptTextarea")
  
  const endScriptFieldRef = useTemplateRef<HTMLDivElement>("endScriptField")
  
  const endScriptTextareaRef = useTemplateRef<HTMLTextAreaElement>("endScriptTextarea")
  
  const triggerAutocompleteState = reactive<ScriptAutocompleteState>({
    open: false,
    query: "",
    replaceStart: 0,
    replaceEnd: 0,
    activeIndex: 0,
    placement: "bottom",
    mode: "placeholder",
    commandItems: []
  })
  
  const initScriptAutocompleteState = reactive<ScriptAutocompleteState>({
    open: false,
    query: "",
    replaceStart: 0,
    replaceEnd: 0,
    activeIndex: 0,
    placement: "bottom",
    mode: "placeholder",
    commandItems: []
  })
  
  const endScriptAutocompleteState = reactive<ScriptAutocompleteState>({
    open: false,
    query: "",
    replaceStart: 0,
    replaceEnd: 0,
    activeIndex: 0,
    placement: "bottom",
    mode: "placeholder",
    commandItems: []
  })
  
  const scriptValidationState = reactive<Record<ScriptFieldKey, ScriptValidationState>>({
    triggerExpr: {
      status: "idle",
      issues: []
    },
    initScript: {
      status: "idle",
      issues: []
    },
    endScript: {
      status: "idle",
      issues: []
    }
  })
  
  const globalAutocompleteCandidates = computed(() => {
    return mergeStoryScriptAutocompleteItems(
      buildStoryScriptBuiltinAutocompleteItems(),
      buildStoryScriptValAutocompleteItems(props.vals),
      buildStoryReferAutocompleteItems(props.story)
    )
  })

  const invokeParamAutocompleteCandidates = computed<StoryScriptAutocompleteItem[]>(() => {
    if (draft.triggerMode !== "invoke") return []
    const seen = new Set<string>()
    return draft.invokeParams.flatMap((param) => {
      const paramName = normalizeAutocompleteText(param.name)
      if (!paramName || seen.has(paramName)) return []
      seen.add(paramName)
      return [{
        name: `call.${paramName}`,
        description: normalizeAutocompleteText(param.descr) || "被调用时传入的参数"
      }]
    })
  })

  const scriptAutocompleteCandidates = computed(() =>
    mergeStoryScriptAutocompleteItems(
      globalAutocompleteCandidates.value,
      invokeParamAutocompleteCandidates.value
    )
  )

  const triggerAutocompleteItems = computed(() =>
    filterStoryScriptAutocompleteItems(
      triggerAutocompleteState.query,
      globalAutocompleteCandidates.value
    )
  )
  
  const invokeAutocompleteContext = computed(() => {
    return buildStoryScriptInvokeAutocompleteContext(props.story)
  })
  
  const initScriptAutocompleteItems = computed(() => {
    if (initScriptAutocompleteState.mode === "invoke_once") {
      return filterStoryScriptAutocompleteItems(
        initScriptAutocompleteState.query,
        initScriptAutocompleteState.commandItems ?? []
      )
    }
  
    return filterStoryScriptAutocompleteItems(
      initScriptAutocompleteState.query,
      scriptAutocompleteCandidates.value
    )
  })
  
  const endScriptAutocompleteItems = computed(() => {
    if (endScriptAutocompleteState.mode === "invoke_once") {
      return filterStoryScriptAutocompleteItems(
        endScriptAutocompleteState.query,
        endScriptAutocompleteState.commandItems ?? []
      )
    }
  
    return filterStoryScriptAutocompleteItems(
      endScriptAutocompleteState.query,
      scriptAutocompleteCandidates.value
    )
  })
  
  const highlightedInitScriptTokens = computed(() => {
    return buildStoryScriptHighlightTokens(draft.initScript)
  })
  
  const highlightedEndScriptTokens = computed(() => {
    return buildStoryScriptHighlightTokens(draft.endScript)
  })
  
  const isTriggerAutocompleteOpen = computed(() => triggerAutocompleteState.open)
  
  const isInitScriptAutocompleteOpen = computed(() => initScriptAutocompleteState.open)
  
  const isEndScriptAutocompleteOpen = computed(() => endScriptAutocompleteState.open)
  
  const activeTriggerAutocompleteItem = computed(() => {
    if (!isTriggerAutocompleteOpen.value || triggerAutocompleteItems.value.length === 0) {
      return null
    }
  
    return triggerAutocompleteItems.value[
      triggerAutocompleteState.activeIndex % triggerAutocompleteItems.value.length
    ]
  })
  
  const activeInitScriptAutocompleteItem = computed(() => {
    if (!isInitScriptAutocompleteOpen.value || initScriptAutocompleteItems.value.length === 0) {
      return null
    }
  
    return initScriptAutocompleteItems.value[
      initScriptAutocompleteState.activeIndex % initScriptAutocompleteItems.value.length
    ]
  })
  
  const activeEndScriptAutocompleteItem = computed(() => {
    if (!isEndScriptAutocompleteOpen.value || endScriptAutocompleteItems.value.length === 0) {
      return null
    }
  
    return endScriptAutocompleteItems.value[
      endScriptAutocompleteState.activeIndex % endScriptAutocompleteItems.value.length
    ]
  })
  
  const activeInitScriptCommandDetail = computed(() => {
    return initScriptAutocompleteState.mode === "invoke_once"
      ? activeInitScriptAutocompleteItem.value
      : null
  })
  
  const activeEndScriptCommandDetail = computed(() => {
    return endScriptAutocompleteState.mode === "invoke_once"
      ? activeEndScriptAutocompleteItem.value
      : null
  })
  
  /** 将 `AutocompleteText` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
  function normalizeAutocompleteText(value: unknown) {
    return typeof value === "string" ? value.trim() : ""
  }
  
  /** 切换 `TriggerHelp` 的当前状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function toggleTriggerHelp() {
    openStoryScriptReferencePage()
  }
  
  /** 切换 `InitScriptHelp` 的当前状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function toggleInitScriptHelp() {
    openStoryScriptReferencePage()
  }
  
  /** 切换 `EndScriptHelp` 的当前状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function toggleEndScriptHelp() {
    openStoryScriptReferencePage()
  }
  
  /** 重置或清理 `resetScriptValidation` 对应的临时状态。 @param field 调用方传入的 `field`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function resetScriptValidation(field?: ScriptFieldKey) {
    const fields = field ? [field] : (["triggerExpr", "initScript", "endScript"] as const)
  
    for (const currentField of fields) {
      scriptValidationState[currentField].status = "idle"
      scriptValidationState[currentField].issues = []
    }
  }
  
  /** 读取或计算 `ScriptValidationLabel`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getScriptValidationLabel(field: ScriptFieldKey) {
    const status = scriptValidationState[field].status
  
    if (status === "checking") {
      return "校验中"
    }
  
    if (status === "passed") {
      return "校验通过"
    }
  
    if (status === "failed") {
      return "有问题"
    }
  
    return ""
  }
  
  /** 读取或计算 `ScriptValidationMessage`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getScriptValidationMessage(field: ScriptFieldKey) {
    if (scriptValidationState[field].status !== "passed") {
      return ""
    }
  
    if (!getScriptFieldValue(field).trim()) {
      return field === "triggerExpr" ? "空条件，无需校验。" : "空脚本，无需校验。"
    }
  
    return field === "triggerExpr" ? "触发条件可以执行。" : "脚本可以执行。"
  }
  
  /** 读取或计算 `ScriptValidationClass`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getScriptValidationClass(field: ScriptFieldKey) {
    return `detail-panel__validation--${scriptValidationState[field].status}`
  }
  
  /** 读取或计算 `ScriptAutocompleteState`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getScriptAutocompleteState(field: ScriptFieldKey) {
    if (field === "triggerExpr") {
      return triggerAutocompleteState
    }
  
    if (field === "initScript") {
      return initScriptAutocompleteState
    }
  
    return endScriptAutocompleteState
  }
  
  /** 读取或计算 `ScriptAutocompleteItems`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getScriptAutocompleteItems(field: ScriptFieldKey) {
    if (field === "triggerExpr") {
      return triggerAutocompleteItems.value
    }
  
    if (field === "initScript") {
      return initScriptAutocompleteItems.value
    }
  
    return endScriptAutocompleteItems.value
  }
  
  /** 读取或计算 `ActiveScriptAutocompleteItem`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getActiveScriptAutocompleteItem(field: ScriptFieldKey) {
    if (field === "triggerExpr") {
      return activeTriggerAutocompleteItem.value
    }
  
    if (field === "initScript") {
      return activeInitScriptAutocompleteItem.value
    }
  
    return activeEndScriptAutocompleteItem.value
  }
  
  /** 读取或计算 `ScriptTextareaRef`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getScriptTextareaRef(field: ScriptFieldKey) {
    if (field === "triggerExpr") {
      return triggerExprTextareaRef.value
    }
  
    if (field === "initScript") {
      return initScriptTextareaRef.value
    }
  
    return endScriptTextareaRef.value
  }
  
  /** 读取或计算 `ScriptFieldRef`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getScriptFieldRef(field: ScriptFieldKey) {
    if (field === "triggerExpr") {
      return triggerExprFieldRef.value
    }
  
    if (field === "initScript") {
      return initScriptFieldRef.value
    }
  
    return endScriptFieldRef.value
  }
  
  /** 读取或计算 `ScriptFieldValue`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getScriptFieldValue(field: ScriptFieldKey) {
    if (field === "triggerExpr") {
      return draft.triggerExpr
    }
  
    if (field === "initScript") {
      return draft.initScript
    }
  
    return draft.endScript
  }
  
  /** 更新 `ScriptFieldValue` 对应的响应式值。 @param field 调用方传入的 `field`。 @param value 调用方传入的 `value`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function setScriptFieldValue(field: ScriptFieldKey, value: string) {
    if (field === "triggerExpr") {
      draft.triggerExpr = value
      return
    }
  
    if (field === "initScript") {
      draft.initScript = value
      return
    }
  
    draft.endScript = value
  }
  
  /** 关闭 `ScriptAutocomplete` 界面并清理临时状态。 @param field 调用方传入的 `field`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function closeScriptAutocomplete(field: ScriptFieldKey) {
    const state = getScriptAutocompleteState(field)
    state.open = false
    state.query = ""
    state.replaceStart = 0
    state.replaceEnd = 0
    state.activeIndex = 0
    state.placement = "bottom"
    state.mode = "placeholder"
    state.commandItems = []
  }
  
  /** 执行 `updateScriptAutocompleteFromCaret` 对应的局部业务逻辑。 @param field 调用方传入的 `field`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
  function updateScriptAutocompleteFromCaret(field: ScriptFieldKey) {
    const textarea = getScriptTextareaRef(field)
    const fieldValue = getScriptFieldValue(field)
    const state = getScriptAutocompleteState(field)
  
    if (!textarea) {
      closeScriptAutocomplete(field)
      return
    }
  
    const caret = textarea.selectionStart ?? fieldValue.length
    const autocomplete = resolveStoryScriptCommandAutocomplete(fieldValue, caret, {
      invokeContext: field === "triggerExpr" ? undefined : invokeAutocompleteContext.value
    })
  
    if (!autocomplete) {
      closeScriptAutocomplete(field)
      return
    }
  
    state.open = autocomplete.state.open
    state.query = autocomplete.state.query
    state.replaceStart = autocomplete.state.replaceStart
    state.replaceEnd = autocomplete.state.replaceEnd
    state.placement = resolveStoryScriptAutocompletePlacement(textarea)
    state.mode = autocomplete.state.mode
    state.commandItems = autocomplete.state.mode === "invoke_once" ? autocomplete.items : []
  
    const items = getScriptAutocompleteItems(field)
  
    if (items.length === 0) {
      state.activeIndex = 0
    } else if (state.activeIndex >= items.length) {
      state.activeIndex = 0
    }
  }
  
  /** 执行 `insertScriptAutocompleteItem` 对应的局部业务逻辑。 @param field 调用方传入的 `field`。 @param itemName 调用方传入的 `itemName`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
  function insertScriptAutocompleteItem(field: ScriptFieldKey, itemName: string) {
    const textarea = getScriptTextareaRef(field)
    const state = getScriptAutocompleteState(field)
    const replaceStart = state.replaceStart
    const currentValue = getScriptFieldValue(field)
    const isPlaceholderMode = currentValue.slice(replaceStart, replaceStart + 2) === "${"
    const nextValue = isPlaceholderMode
      ? currentValue.slice(0, replaceStart + 2) + itemName + "}" + currentValue.slice(state.replaceEnd)
      : currentValue.slice(0, replaceStart) + itemName + currentValue.slice(state.replaceEnd)
  
    setScriptFieldValue(field, nextValue)
    closeScriptAutocomplete(field)
  
    requestAnimationFrame(() => {
      const nextCaret = isPlaceholderMode
        ? replaceStart + itemName.length + 3
        : replaceStart + itemName.length
      textarea?.focus()
      textarea?.setSelectionRange(nextCaret, nextCaret)
    })
  }
  
  /** 处理 `TriggerExprInput` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onTriggerExprInput() {
    resetScriptValidation("triggerExpr")
    updateScriptAutocompleteFromCaret("triggerExpr")
  }
  
  /** 处理 `TriggerExprKeydown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onTriggerExprKeydown(event: KeyboardEvent) {
    onScriptFieldKeydown("triggerExpr", event)
  }
  
  /** 处理 `InitScriptInput` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onInitScriptInput() {
    resetScriptValidation("initScript")
    updateScriptAutocompleteFromCaret("initScript")
  }
  
  /** 处理 `InitScriptKeydown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onInitScriptKeydown(event: KeyboardEvent) {
    onScriptFieldKeydown("initScript", event)
  }
  
  /** 处理 `InitScriptScroll` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onInitScriptScroll(event: Event) {
    syncScriptEditorScroll("initScript", event)
  }
  
  /** 处理 `EndScriptInput` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onEndScriptInput() {
    resetScriptValidation("endScript")
    updateScriptAutocompleteFromCaret("endScript")
  }
  
  /** 处理 `EndScriptKeydown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onEndScriptKeydown(event: KeyboardEvent) {
    onScriptFieldKeydown("endScript", event)
  }
  
  /** 处理 `EndScriptScroll` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onEndScriptScroll(event: Event) {
    syncScriptEditorScroll("endScript", event)
  }
  
  /** 把外部或服务端数据同步到本地响应式状态。 @param field 调用方传入的 `field`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function syncScriptEditorScroll(field: ScriptEditorFieldKey, event: Event) {
    const textarea = event.target as HTMLTextAreaElement | null
    const fieldElement = getScriptFieldRef(field)
    const highlightElement = fieldElement?.querySelector<HTMLElement>("[data-script-highlight]")
  
    if (!textarea || !highlightElement) {
      return
    }
  
    highlightElement.scrollTop = textarea.scrollTop
    highlightElement.scrollLeft = textarea.scrollLeft
  }

  return {
    triggerExprFieldRef, triggerExprTextareaRef, initScriptFieldRef, initScriptTextareaRef,
    endScriptFieldRef, endScriptTextareaRef, triggerAutocompleteState, initScriptAutocompleteState,
    endScriptAutocompleteState, scriptValidationState, globalAutocompleteCandidates, invokeParamAutocompleteCandidates,
    scriptAutocompleteCandidates, triggerAutocompleteItems, invokeAutocompleteContext,
    initScriptAutocompleteItems, endScriptAutocompleteItems, highlightedInitScriptTokens, highlightedEndScriptTokens,
    isTriggerAutocompleteOpen, isInitScriptAutocompleteOpen, isEndScriptAutocompleteOpen, activeTriggerAutocompleteItem,
    activeInitScriptAutocompleteItem, activeEndScriptAutocompleteItem, activeInitScriptCommandDetail, activeEndScriptCommandDetail,
    normalizeAutocompleteText, toggleTriggerHelp, toggleInitScriptHelp, toggleEndScriptHelp,
    resetScriptValidation, getScriptValidationLabel, getScriptValidationMessage, getScriptValidationClass,
    getScriptAutocompleteState, getScriptAutocompleteItems, getActiveScriptAutocompleteItem, getScriptTextareaRef,
    getScriptFieldRef, getScriptFieldValue, setScriptFieldValue, closeScriptAutocomplete,
    updateScriptAutocompleteFromCaret, insertScriptAutocompleteItem, onTriggerExprInput, onTriggerExprKeydown,
    onInitScriptInput, onInitScriptKeydown, onInitScriptScroll, onEndScriptInput,
    onEndScriptKeydown, onEndScriptScroll, syncScriptEditorScroll,
  }
}
