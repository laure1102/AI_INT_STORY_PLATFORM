/**
 * 定时事件编辑控制器。
 *
 * 公共脚本与对白能力来自共享控制器，本模块补充循环周期、执行时刻和依赖顺序。
 * 静态依赖环由 Core Validator 复核，本模块只维护用户正在编辑的草稿。
 */
import { useEventDialogueFields } from "./useEventDialogueFields"
import { useEventScriptFields, type ScriptFieldKey } from "./useEventScriptFields"
import {
  buildStoryRoleKey,
  findStoryRoleReference,
  type StoryDocument,
  type StoryEventInvokeParamDefinition,
  type StoryEventTriggerMode,
  type StoryEventLocationFile,
  type StoryEventPresentationType,
  type StoryLoopEventFile,
  type StoryLoopMode,
  type StoryOnceDialogueDefinition,
  type StoryRolesFile,
  type StorySceneFile,
  type StoryValsFile
} from "@story-mgr/core"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import {
  STORY_SCRIPT_TEMPLATE_PLACEHOLDER,
  buildStoryScriptBuiltinAutocompleteItems,
  buildStoryScriptHighlightTokens,
  buildStoryScriptInvokeAutocompleteContext,
  buildStoryReferAutocompleteItems,
  buildStoryScriptValAutocompleteItems,
  filterStoryScriptAutocompleteItems,
  mergeStoryScriptAutocompleteItems,
  openStoryScriptReferencePage,
  resolveStoryScriptCommandAutocomplete,
  resolveStoryScriptAutocompletePlacement,
  type StoryScriptAutocompleteItem
} from "./storyScriptEditor"
import {
  formatStoryScriptValidationIssue,
  validateStoryScriptField
} from "./storyScriptValidation"
import type { GenerateStoryDialogueResponse } from "@story-mgr/shared"

interface DialogueDraft extends StoryOnceDialogueDefinition {
  id: string
}

interface InvokeParamDraft extends StoryEventInvokeParamDefinition {
  id: string
}

interface LoopEventDraft {
  id: string
  title: string
  triggerMode: StoryEventTriggerMode
  triggerExpr: string
  invokeParams: InvokeParamDraft[]
  initScript: string
  location: string
  bgm: string
  endScript: string
  presentationType: StoryEventPresentationType
  messageContent: string
  messageDurationSeconds: number
  dialogues: DialogueDraft[]
  selectedObjectKeys: string[]
  loopMode: StoryLoopMode
  intervalDays: number
  weekday: number
  monthDay: number
  scheduleAt: string
  schedulePriority: number
  afterIds: string[]
}

export interface LoopEventEditorProps {
  event: StoryLoopEventFile | null
  eventLocations: StoryEventLocationFile
  itemIds: string[]
  mode?: "create" | "edit"
  roles: StoryRolesFile
  saving: boolean
  scenes: StorySceneFile
  scheduleEvents: StoryLoopEventFile[]
  story?: StoryDocument | null
  vals: StoryValsFile
}

export interface LoopEventEditorEmits {
  close: []
  quickCreateLocation: [payload: StoryQuickCreateLocationPayload]
  quickCreateRole: [payload: StoryQuickCreateRolePayload]
  save: [event: StoryLoopEventFile]
}

export type LoopEventEditorEmit = <Name extends keyof LoopEventEditorEmits>(
  event: Name,
  ...args: LoopEventEditorEmits[Name]
) => void

/** 组合 `LoopEventEditor` 的响应式状态、派生值和操作方法。 @param props 调用方传入的 `props`。 @param emit 调用方传入的 `emit`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useLoopEventEditor(
  props: Readonly<LoopEventEditorProps>,
  emit: LoopEventEditorEmit
) {
  const { generateStoryDialogue } = useStoryApi()
  const pendingQuickLocationId = shallowRef<string | null>(null)
  const isScheduleDependencyDialogOpen = shallowRef(false)
  const scheduleDependencySearch = shallowRef("")
  
  const LOOP_WEEKDAY_OPTIONS = [
    { value: 1, label: "周一" },
    { value: 2, label: "周二" },
    { value: 3, label: "周三" },
    { value: 4, label: "周四" },
    { value: 5, label: "周五" },
    { value: 6, label: "周六" },
    { value: 7, label: "周日" }
  ] as const
  
  /** 复制 `InvokeParam`，避免共享可变引用。 @param param 调用方传入的 `param`。 @returns 计算、查找或构建后的结果。 */
  function cloneInvokeParam(param?: StoryEventInvokeParamDefinition): InvokeParamDraft {
    return {
      id: createInvokeParamId(),
      name: param?.name ?? "",
      descr: param?.descr ?? ""
    }
  }
  
  const draft = reactive<LoopEventDraft>({
    id: "",
    title: "",
    triggerMode: "default",
    triggerExpr: "",
    invokeParams: [],
    initScript: "",
    location: "",
    bgm: "",
    endScript: "",
    presentationType: "silent",
    messageContent: "",
    messageDurationSeconds: 3,
    dialogues: [],
    selectedObjectKeys: [],
    loopMode: "daily",
    intervalDays: 1,
    weekday: 1,
    monthDay: 1,
    scheduleAt: "00:00",
    schedulePriority: 100,
    afterIds: []
  })
  
  const eventScriptFields = useEventScriptFields({ draft, onScriptFieldKeydown, props })
  const {
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
  } = eventScriptFields
  
  const eventDialogueFields = useEventDialogueFields({
    cloneInvokeParam,
    draft,
    emitQuickCreateRole: (payload) => emit("quickCreateRole", payload),
    globalAutocompleteCandidates,
    invokeParamAutocompleteCandidates,
    normalizeAutocompleteText,
    props,
    scriptAutocompleteCandidates
  })
  const {
    PLAYER_OBJECT_OPTION, dialogueContentFieldRef, dialogueContentTextareaRef, isQuickLocationDialogOpen,
    isQuickRoleDialogOpen, pendingQuickRoleKey, dialogueContentAutocompleteState, dialogueIdSeed,
    invokeParamIdSeed, createDialogueId, createInvokeParamId, cloneDialogue,
    dialogueEditorState, isDialogueAiDialogOpen, dialogueAiPrompt, dialogueAiLoading,
    dialogueAiError, dialogueAiResult, dialogueAiAbortController, locationOptions,
    importantRoleOptions, normalRoleOptions, specialObjectOptions, roleOptionMap,
    objectKeyOptions, dialogueEditorTitle, dialogueContentAutocompleteItems,
    isDialogueContentAutocompleteOpen, activeDialogueContentAutocompleteItem, submitLabel, normalizeObjectKeys,
    normalizeStoredObjectKeys, createDialogueEditorDraft, openCreateDialogueEditor, openEditDialogueEditor,
    closeDialogueEditor, removeDialogue, addInvokeParam, removeInvokeParam,
    moveDialogue, handleDialogueEditorSpeakerTypeChange, getDialogueEditorSpeakerOptions, saveDialogueEditor,
    toggleDialogueTemplateHelp, getInvokeParamValidationTokens, closeDialogueContentAutocomplete, updateDialogueContentAutocompleteFromCaret,
    insertDialogueContentAutocompleteItem, onDialogueContentInput, onDialogueContentKeydown, openDialogueAiDialog,
    closeDialogueAiDialog, abortDialogueAi, applyDialogueAiResult, requestQuickCreateRole,
    requestQuickCreateLocation, closeQuickLocationDialog, closeQuickRoleDialog, submitQuickCreateRole,
    applyQuickCreatedRole,
  } = eventDialogueFields
  
  
  const bgmOptions = computed(() => {
    return Array.from(
      new Set(
        props.scenes.scenes
          .map((scene) => scene.music.trim())
          .filter(Boolean)
      )
    )
  })
  const loopModeOptions: Array<{ value: StoryLoopMode; label: string }> = [
    { value: "daily", label: "每天" },
    { value: "weekly", label: "每周" },
    { value: "monthly", label: "每月" },
    { value: "interval_days", label: "每隔多少天" }
  ]
  const scheduleDependencyOptions = computed(() => {
    const currentId = draft.id.trim()
  
    return props.scheduleEvents
      .filter((event) => event.id !== currentId)
      .map((event) => ({
        value: event.id,
        label: event.title.trim() ? `${event.title} (${event.id})` : event.id
      }))
  })
  const selectedScheduleDependencyLabels = computed(() => {
    const selectedIds = new Set(draft.afterIds)
  
    return scheduleDependencyOptions.value
      .filter((option) => selectedIds.has(option.value))
      .map((option) => option.label)
  })
  const scheduleDependencySummary = computed(() => {
    const labels = selectedScheduleDependencyLabels.value
    if (!labels.length) {
      return "无前置事件"
    }
  
    if (labels.length <= 2) {
      return labels.join("、")
    }
  
    return `${labels.slice(0, 2).join("、")} 等 ${labels.length} 个`
  })
  const filteredScheduleDependencyOptions = computed(() => {
    const keyword = scheduleDependencySearch.value.trim().toLowerCase()
    if (!keyword) {
      return scheduleDependencyOptions.value
    }
  
    return scheduleDependencyOptions.value.filter((option) => {
      return option.value.toLowerCase().includes(keyword)
        || option.label.toLowerCase().includes(keyword)
    })
  })
  
  const panelTitle = computed(() => {
    if (draft.title.trim()) {
      return draft.title.trim()
    }
  
    return props.mode === "create" ? "未命名循环事件" : (props.event?.title ?? "循环事件")
  })
  
  const panelEyebrow = computed(() => {
    return props.mode === "create" ? "新循环事件" : "循环事件编辑"
  })
  
  /** 将 `ScheduleDependencyIds` 输入清洗为内部统一格式。 @param ids 调用方传入的 `ids`。 @returns 计算、查找或构建后的结果。 */
  function normalizeScheduleDependencyIds(ids: string[]) {
    const currentId = draft.id.trim()
    const availableIds = new Set(scheduleDependencyOptions.value.map((option) => option.value))
  
    return Array.from(
      new Set(
        ids
          .map((id) => id.trim())
          .filter((id) => id && id !== currentId && availableIds.has(id))
      )
    )
  }
  
  /** 判断 `isValidScheduleAt` 对应的条件是否成立。 @param value 调用方传入的 `value`。 @returns 布尔判断结果。 */
  function isValidScheduleAt(value: string) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim())
  }
  
  /** 将 `ScheduleAt` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
  function normalizeScheduleAt(value: string) {
    return isValidScheduleAt(value) ? value.trim() : "00:00"
  }
  
  /** 将 `SchedulePriority` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
  function normalizeSchedulePriority(value: number) {
    return Number.isFinite(value) ? Math.trunc(value) : 100
  }
  
  /** 打开 `ScheduleDependencyDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function openScheduleDependencyDialog() {
    scheduleDependencySearch.value = ""
    isScheduleDependencyDialogOpen.value = true
  }
  
  /** 关闭 `ScheduleDependencyDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function closeScheduleDependencyDialog() {
    isScheduleDependencyDialogOpen.value = false
  }
  
  /** 重置或清理 `clearScheduleDependencies` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function clearScheduleDependencies() {
    draft.afterIds = []
  }
  
  /** 将 `DraftTriggerMode` 输入清洗为内部统一格式。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
  function normalizeDraftTriggerMode(event: StoryLoopEventFile | null): StoryEventTriggerMode {
    const mode = event?.trigger_mode ?? "default"
    if (mode === "condition" && !(event?.trigger_expr ?? "").trim()) {
      return "default"
    }
  
    return mode
  }
  
  /** 把外部或服务端数据同步到本地响应式状态。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function syncPresentationDraft(event: StoryLoopEventFile | null) {
    const presentation = event?.presentation ?? { type: "silent" as const }
    draft.presentationType = presentation.type
  
    if (presentation.type === "message") {
      draft.messageContent = presentation.message.content
      draft.messageDurationSeconds = presentation.message.duration_seconds
      draft.dialogues = []
      return
    }
  
    draft.messageContent = ""
    draft.messageDurationSeconds = 3
  
    if (presentation.type === "dialogue") {
      draft.dialogues = presentation.dialogues.map((dialogue) => {
        const normalizedSpeakerKey =
          dialogue.speaker_type === "object"
            ? findStoryRoleReference(props.roles, dialogue.speaker_key)?.key ?? dialogue.speaker_key
            : dialogue.speaker_key
  
        return cloneDialogue({
          ...dialogue,
          speaker_key: normalizedSpeakerKey
        })
      })
      return
    }
  
    draft.dialogues = []
  }
  
  /** 把外部或服务端数据同步到本地响应式状态。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function syncDraft(event: StoryLoopEventFile | null) {
    draft.id = event?.id ?? ""
    draft.title = event?.title ?? ""
    draft.triggerMode = normalizeDraftTriggerMode(event)
    draft.triggerExpr = event?.trigger_expr ?? ""
    draft.invokeParams = (event?.invoke_params ?? []).map((param) => cloneInvokeParam(param))
    draft.initScript = event?.init_script ?? ""
    draft.location = event?.location ?? ""
    draft.bgm = event?.bgm ?? ""
    draft.endScript = event?.end_script ?? ""
    draft.loopMode = event?.loop.mode ?? "daily"
    draft.intervalDays = event?.loop.interval_days ?? 1
    draft.weekday = event?.loop.weekday ?? 1
    draft.monthDay = event?.loop.month_day ?? 1
    draft.scheduleAt = normalizeScheduleAt(event?.loop.at ?? "00:00")
    draft.schedulePriority = event?.loop.priority ?? 100
    draft.afterIds = normalizeScheduleDependencyIds(event?.loop.after ?? [])
    draft.selectedObjectKeys = normalizeStoredObjectKeys(event?.object_keys ?? [])
    syncPresentationDraft(event)
  }
  
  /** 读取或计算 `ReadableValidationTokens`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getReadableValidationTokens(field: ScriptFieldKey) {
    return field === "triggerExpr" ? [] : getInvokeParamValidationTokens()
  }
  
  /** 校验 `ScriptField` 并整理错误信息。 @param field 调用方传入的 `field`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
  async function validateScriptField(field: ScriptFieldKey) {
    const state = scriptValidationState[field]
    state.status = "checking"
    state.issues = []
    await Promise.resolve()
  
    const source = getScriptFieldValue(field)
  
    if (field === "triggerExpr" && draft.triggerMode === "condition" && !source.trim()) {
      state.status = "failed"
      state.issues = ["条件触发必须填写触发条件。"]
      return
    }
  
    const result = validateStoryScriptField({
      vals: props.vals,
      source,
      mode: field === "triggerExpr" ? "predicate" : "procedure",
      itemIds: props.itemIds,
      story: props.story,
      readableTokens: getReadableValidationTokens(field),
      writableTokens: [],
      bagMode: field === "triggerExpr" ? "read" : "write"
    })
  
    state.status = result.ok ? "passed" : "failed"
    state.issues = result.issues.map((issue) => formatStoryScriptValidationIssue(issue))
  }
  
  /** 关闭 `AllScriptAutocomplete` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function closeAllScriptAutocomplete() {
    closeScriptAutocomplete("triggerExpr")
    closeScriptAutocomplete("initScript")
    closeScriptAutocomplete("endScript")
  }
  
  /** 处理 `ScriptFieldKeydown` 用户交互。 @param field 调用方传入的 `field`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onScriptFieldKeydown(field: ScriptFieldKey, event: KeyboardEvent) {
    const state = getScriptAutocompleteState(field)
    const items = getScriptAutocompleteItems(field)
  
    if (!state.open) {
      if (event.key === "{") {
        requestAnimationFrame(() => {
          updateScriptAutocompleteFromCaret(field)
        })
      }
  
      return
    }
  
    if (event.key === "Escape") {
      event.preventDefault()
      closeScriptAutocomplete(field)
      return
    }
  
    if (event.key === "ArrowDown") {
      event.preventDefault()
      state.activeIndex = (state.activeIndex + 1) % Math.max(items.length, 1)
      return
    }
  
    if (event.key === "ArrowUp") {
      event.preventDefault()
      const length = Math.max(items.length, 1)
      state.activeIndex = (state.activeIndex - 1 + length) % length
      return
    }
  
    if (event.key === "Enter" || event.key === "Tab") {
      const item = getActiveScriptAutocompleteItem(field)
  
      if (!item) {
        return
      }
  
      event.preventDefault()
      insertScriptAutocompleteItem(field, item.name)
    }
  }
  
  /** 根据当前输入构建 `DraftPresentation` 结果。 @returns 计算、查找或构建后的结果。 */
  function buildDraftPresentation(): StoryLoopEventFile["presentation"] {
    if (draft.presentationType === "silent") {
      return {
        type: "silent"
      }
    }
  
    if (draft.presentationType === "message") {
      const durationSeconds = Number.isFinite(draft.messageDurationSeconds)
        ? Math.max(0, draft.messageDurationSeconds)
        : 3
  
      return {
        type: "message",
        message: {
          content: draft.messageContent.trim(),
          duration_seconds: durationSeconds
        }
      }
    }
  
    return {
      type: "dialogue",
      dialogues: draft.dialogues.map((dialogue) => ({
        speaker_type: dialogue.speaker_type,
        speaker_key: dialogue.speaker_key.trim(),
        content: dialogue.content.trim()
      }))
    }
  }
  
  /** 根据当前输入构建 `DialogueEventDraft` 结果。 @returns 计算、查找或构建后的结果。 */
  function buildDialogueEventDraft(): StoryLoopEventFile | null {
    if (!props.event) {
      return null
    }
  
    return {
      id: draft.id.trim(),
      title: draft.title.trim(),
      trigger_mode: draft.triggerMode,
      trigger_expr: draft.triggerMode === "condition" ? draft.triggerExpr.trim() : "",
      invoke_params: draft.triggerMode === "invoke"
        ? draft.invokeParams
            .map((param) => ({
              name: param.name.trim(),
              descr: (param.descr ?? "").trim() || undefined
            }))
            .filter((param) => param.name)
        : [],
      init_script: draft.initScript.trim(),
      object_keys: normalizeObjectKeys(draft.selectedObjectKeys),
      presentation: buildDraftPresentation(),
      location: draft.location.trim(),
      bgm: draft.bgm.trim(),
      end_script: draft.endScript.trim(),
      loop: {
        mode: draft.loopMode,
        interval_days: draft.loopMode === "interval_days" ? Math.max(1, Number(draft.intervalDays) || 1) : undefined,
        weekday: draft.loopMode === "weekly" ? Math.max(1, Math.min(7, Number(draft.weekday) || 1)) : undefined,
        month_day: draft.loopMode === "monthly" ? Math.max(1, Math.min(31, Number(draft.monthDay) || 1)) : undefined,
        at: normalizeScheduleAt(draft.scheduleAt),
        priority: normalizeSchedulePriority(draft.schedulePriority),
        after: normalizeScheduleDependencyIds(draft.afterIds),
        before: []
      },
      meta: props.event.meta
    }
  }
  
  /** 执行 `runDialogueAi` 对应的异步业务流程。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function runDialogueAi() {
    const eventDraft = buildDialogueEventDraft()
  
    if (!eventDraft || eventDraft.presentation.type !== "dialogue") {
      return
    }
  
    dialogueAiLoading.value = true
    dialogueAiError.value = null
    dialogueAiAbortController.value = new AbortController()
  
    try {
      dialogueAiResult.value = await generateStoryDialogue(
        useRoute().params.storyId as string,
        {
          collectionType: "schedule",
          event: eventDraft,
          instruction: dialogueAiPrompt.value
        },
        dialogueAiAbortController.value.signal
      )
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
        dialogueAiError.value = "已中止。"
      } else {
        dialogueAiError.value = error instanceof Error ? error.message : "AI 补对白失败。"
      }
    } finally {
      dialogueAiLoading.value = false
      dialogueAiAbortController.value = null
    }
  }
  
  /** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function submitDraft() {
    if (!props.event) {
      return
    }
  
    const triggerMode = draft.triggerMode
    const triggerExpr = triggerMode === "condition" ? draft.triggerExpr.trim() : ""
    const invokeParams = triggerMode === "invoke"
      ? draft.invokeParams
          .map((param) => ({
            name: param.name.trim(),
            descr: (param.descr ?? "").trim() || undefined
          }))
          .filter((param) => param.name)
      : []
  
    if (triggerMode === "condition" && !triggerExpr) {
      window.alert("条件触发必须填写触发条件。")
      return
    }
  
    if (triggerMode === "invoke" && invokeParams.length === 0) {
      window.alert("被调用触发必须至少填写一个调用参数。")
      return
    }
  
    if (triggerMode !== "invoke" && !isValidScheduleAt(draft.scheduleAt)) {
      window.alert("执行时间必须使用 HH:mm 格式，例如 00:00。")
      return
    }
  
    emit("save", {
      id: draft.id.trim(),
      title: draft.title.trim(),
      trigger_mode: triggerMode,
      trigger_expr: triggerExpr,
      invoke_params: invokeParams,
      init_script: draft.initScript.trim(),
      object_keys: normalizeObjectKeys(draft.selectedObjectKeys),
      presentation: buildDraftPresentation(),
      location: draft.location.trim(),
      bgm: draft.bgm.trim(),
      end_script: draft.endScript.trim(),
      loop: {
        mode: draft.loopMode,
        interval_days: draft.loopMode === "interval_days" ? Math.max(1, Number(draft.intervalDays) || 1) : undefined,
        weekday: draft.loopMode === "weekly" ? Math.max(1, Math.min(7, Number(draft.weekday) || 1)) : undefined,
        month_day: draft.loopMode === "monthly" ? Math.max(1, Math.min(31, Number(draft.monthDay) || 1)) : undefined,
        at: normalizeScheduleAt(draft.scheduleAt),
        priority: normalizeSchedulePriority(draft.schedulePriority),
        after: normalizeScheduleDependencyIds(draft.afterIds),
        before: []
      }
    })
  }
  
  /** 校验当前草稿并提交给父组件或 API。 @param payload 调用方传入的 `payload`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function submitQuickCreateLocation(payload: StoryQuickCreateLocationPayload) {
    pendingQuickLocationId.value = payload.id
    emit("quickCreateLocation", payload)
  }
  
  watch(
    () => props.event,
    (event) => {
      syncDraft(event)
      closeAllScriptAutocomplete()
      closeDialogueContentAutocomplete()
      resetScriptValidation()
      dialogueAiError.value = null
      dialogueAiResult.value = null
      dialogueAiPrompt.value = ""
      isDialogueAiDialogOpen.value = false
    },
    { immediate: true }
  )
  
  watch(
    () => draft.triggerMode,
    () => resetScriptValidation("triggerExpr")
  )
  
  watch(
    () => props.roles,
    () => {
      draft.selectedObjectKeys = normalizeStoredObjectKeys(draft.selectedObjectKeys)
  
      for (const dialogue of draft.dialogues) {
        if (dialogue.speaker_type === "object") {
          dialogue.speaker_key =
            findStoryRoleReference(props.roles, dialogue.speaker_key)?.key ?? dialogue.speaker_key
        }
      }
  
      if (pendingQuickRoleKey.value && findStoryRoleReference(props.roles, pendingQuickRoleKey.value)) {
        applyQuickCreatedRole(pendingQuickRoleKey.value)
        pendingQuickRoleKey.value = null
        isQuickRoleDialogOpen.value = false
      }
    },
    { deep: true }
  )
  
  watch(
    locationOptions,
    (options) => {
      if (!pendingQuickLocationId.value) {
        return
      }
  
      if (options.some((option) => option.value === pendingQuickLocationId.value)) {
        draft.location = pendingQuickLocationId.value
        pendingQuickLocationId.value = null
        isQuickLocationDialogOpen.value = false
      }
    },
    { deep: true }
  )
  
  watch(
    objectKeyOptions,
    (keys) => {
      for (const dialogue of draft.dialogues) {
        if (dialogue.speaker_type === "object" && !keys.includes(dialogue.speaker_key)) {
          dialogue.speaker_key = keys[0] ?? ""
        }
      }
    }
  )
  
  onMounted(() => {
    document.addEventListener("mousedown", handleDocumentPointerDown)
  })
  
  onBeforeUnmount(() => {
    document.removeEventListener("mousedown", handleDocumentPointerDown)
    dialogueAiAbortController.value?.abort()
  })
  
  /** 处理 `DocumentPointerDown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function handleDocumentPointerDown(event: MouseEvent) {
    const target = event.target as Node | null
  
    if (
      !isTriggerAutocompleteOpen.value &&
      !isInitScriptAutocompleteOpen.value &&
      !isEndScriptAutocompleteOpen.value &&
      !isDialogueContentAutocompleteOpen.value
    ) {
      return
    }
  
    for (const field of ["triggerExpr", "initScript", "endScript"] as const) {
      const state = getScriptAutocompleteState(field)
  
      if (!state.open) {
        continue
      }
  
      const fieldElement = getScriptFieldRef(field)
  
      if (fieldElement && target && fieldElement.contains(target)) {
        continue
      }
  
      closeScriptAutocomplete(field)
    }
  
    if (
      isDialogueContentAutocompleteOpen.value &&
      (!dialogueContentFieldRef.value || !target || !dialogueContentFieldRef.value.contains(target))
    ) {
      closeDialogueContentAutocomplete()
    }
  }

  return {
    ...eventScriptFields,
    ...eventDialogueFields,
    generateStoryDialogue, pendingQuickLocationId, isScheduleDependencyDialogOpen, scheduleDependencySearch,
    LOOP_WEEKDAY_OPTIONS, cloneInvokeParam, draft, bgmOptions,
    loopModeOptions, scheduleDependencyOptions, selectedScheduleDependencyLabels, scheduleDependencySummary,
    filteredScheduleDependencyOptions, panelTitle, panelEyebrow, normalizeScheduleDependencyIds,
    isValidScheduleAt, normalizeScheduleAt, normalizeSchedulePriority, openScheduleDependencyDialog,
    closeScheduleDependencyDialog, clearScheduleDependencies, normalizeDraftTriggerMode, syncPresentationDraft,
    syncDraft, getReadableValidationTokens, validateScriptField, closeAllScriptAutocomplete,
    onScriptFieldKeydown, buildDraftPresentation, buildDialogueEventDraft, runDialogueAi,
    submitDraft, submitQuickCreateLocation, handleDocumentPointerDown,
  }
}

/** 定时事件面板可安全访问的完整控制器类型。 */
export type LoopEventEditorController = ReturnType<typeof useLoopEventEditor>
