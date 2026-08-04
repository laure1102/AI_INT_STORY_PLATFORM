/**
 * 剧情链事件编辑控制器。
 *
 * 共享字段由两个事件公共控制器提供，本模块只管理后继节点和分支脚本上下文。
 * 它输出 StoryEventFile 草稿，不负责修改画布或持久化故事文件。
 */
import { useEventDialogueFields } from "./useEventDialogueFields"
import { useEventScriptFields, type ScriptFieldKey } from "./useEventScriptFields"
import {
  buildStoryRoleKey,
  findStoryRoleReference,
  type StoryDocument,
  type StoryEventFile,
  type StoryEventInvokeParamDefinition,
  type StoryEventLocationFile,
  type StoryEventPresentationType,
  type StoryEventTriggerMode,
  type StoryOnceDialogueDefinition,
  type StoryRolesFile,
  type StoryValsFile
} from "@story-mgr/core"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"
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

interface GraphEventDraft {
  id: string
  title: string
  triggerMode: StoryEventTriggerMode
  triggerExpr: string
  invokeParams: InvokeParamDraft[]
  initScript: string
  endScript: string
  presentationType: StoryEventPresentationType
  messageContent: string
  messageDurationSeconds: number
  dialogues: DialogueDraft[]
  selectedObjectKeys: string[]
  location: string
}

export interface GraphNodeOption {
  id: string
  title: string
  type: "event" | "action"
}

export interface GraphEventEditorProps {
  branchAutocompleteItems?: StoryScriptAutocompleteItem[]
  event: StoryEventFile | null
  eventLocations: StoryEventLocationFile
  graphNodeOptions: GraphNodeOption[]
  itemIds: string[]
  mode?: "create" | "edit"
  parentEventId?: string | null
  roles: StoryRolesFile
  saving: boolean
  story?: StoryDocument | null
  vals: StoryValsFile
}

export interface GraphEventEditorEmits {
  close: []
  quickCreateLocation: [payload: StoryQuickCreateLocationPayload]
  quickCreateRole: [payload: StoryQuickCreateRolePayload]
  save: [event: StoryEventFile]
}

export type GraphEventEditorEmit = <Name extends keyof GraphEventEditorEmits>(
  event: Name,
  ...args: GraphEventEditorEmits[Name]
) => void

/** 创建 chain 剧情事件编辑器控制器。 @param props 当前事件、完整故事文档和保存/AI 状态。 @param emit 保存、删除后继、快速创建资产及 AI 对白事件。 @returns 基础/后继页签草稿、对白与脚本子控制器、校验/自动补全状态和提交方法；props 始终只读，保存通过 emit 上行。 */
export function useGraphEventEditor(
  props: Readonly<GraphEventEditorProps>,
  emit: GraphEventEditorEmit
) {
  const { generateStoryDialogue } = useStoryApi()
  
  const activeTab = shallowRef<"basic" | "next">("basic")
  const pendingQuickLocationName = shallowRef<string | null>(null)
  
  /** 复制 `InvokeParam`，避免共享可变引用。 @param param 调用方传入的 `param`。 @returns 计算、查找或构建后的结果。 */
  function cloneInvokeParam(param?: StoryEventInvokeParamDefinition): InvokeParamDraft {
    return {
      id: createInvokeParamId(),
      name: param?.name ?? "",
      descr: param?.descr ?? ""
    }
  }
  
  const draft = reactive<GraphEventDraft>({
    id: "",
    title: "",
    triggerMode: "default",
    triggerExpr: "",
    invokeParams: [],
    initScript: "",
    endScript: "",
    presentationType: "silent",
    messageContent: "",
    messageDurationSeconds: 3,
    dialogues: [],
    selectedObjectKeys: [],
    location: ""
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
  
  const triggerAutocompleteCandidates = computed(() => {
    return mergeStoryScriptAutocompleteItems(
      globalAutocompleteCandidates.value,
      props.branchAutocompleteItems ?? []
    )
  })
  
  const panelTitle = computed(() => {
    if (draft.title.trim()) {
      return draft.title.trim()
    }
  
    return props.mode === "create" ? "未命名剧情事件" : (props.event?.title ?? "普通剧情事件")
  })
  
  const panelEyebrow = computed(() => {
    return props.mode === "create" ? "新普通剧情事件" : "普通剧情事件编辑"
  })
  
  const linkedNextNodes = computed(() => {
    const currentEvent = props.event
  
    if (!currentEvent) {
      return []
    }
  
    return currentEvent.next.map((nodeId) => {
      const matchedNode = props.graphNodeOptions.find((node) => node.id === nodeId)
      return {
        id: nodeId,
        title: matchedNode?.title ?? nodeId,
        type: matchedNode?.type ?? "event"
      }
    })
  })
  
  /** 将 `DraftTriggerMode` 输入清洗为内部统一格式。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
  function normalizeDraftTriggerMode(event: StoryEventFile | null): StoryEventTriggerMode {
    const mode = event?.trigger_mode ?? "default"
    if (mode === "condition" && !(event?.trigger_expr ?? "").trim()) {
      return "default"
    }
  
    return mode
  }
  
  /** 把外部或服务端数据同步到本地响应式状态。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function syncPresentationDraft(event: StoryEventFile | null) {
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
  function syncDraft(event: StoryEventFile | null) {
    draft.id = event?.id ?? ""
    draft.title = event?.title ?? ""
    draft.triggerMode = normalizeDraftTriggerMode(event)
    draft.triggerExpr = event?.trigger_expr ?? ""
    draft.invokeParams = (event?.invoke_params ?? []).map((param) => cloneInvokeParam(param))
    draft.initScript = event?.init_script ?? ""
    draft.endScript = event?.end_script ?? ""
    draft.location = event?.location ?? ""
    draft.selectedObjectKeys = normalizeStoredObjectKeys(event?.object_keys ?? [])
    syncPresentationDraft(event)
  }
  
  /** 校验当前草稿并提交给父组件或 API。 @param payload 调用方传入的 `payload`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function submitQuickCreateLocation(payload: StoryQuickCreateLocationPayload) {
    pendingQuickLocationName.value = payload.id
    emit("quickCreateLocation", payload)
  }
  
  /** 读取或计算 `BranchValidationTokens`。 @returns 计算、查找或构建后的结果。 */
  function getBranchValidationTokens() {
    return (props.branchAutocompleteItems ?? [])
      .map((item) => normalizeAutocompleteText(item.name))
      .filter(Boolean)
  }
  
  /** 读取或计算 `ReadableValidationTokens`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getReadableValidationTokens(field: ScriptFieldKey) {
    if (field === "triggerExpr") {
      return getBranchValidationTokens()
    }
  
    return [
      ...getBranchValidationTokens(),
      ...getInvokeParamValidationTokens()
    ]
  }
  
  /** 读取或计算 `WritableValidationTokens`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
  function getWritableValidationTokens(field: ScriptFieldKey) {
    if (field === "triggerExpr") {
      return []
    }
  
    return getBranchValidationTokens()
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
      writableTokens: getWritableValidationTokens(field),
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
  
    if (!state.open) {
      if (event.key === "Escape") {
        closeScriptAutocomplete(field)
      }
      return
    }
  
    const items = getScriptAutocompleteItems(field)
  
    if (event.key === "Escape") {
      event.preventDefault()
      closeScriptAutocomplete(field)
      return
    }
  
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const length = Math.max(items.length, 1)
      state.activeIndex = (state.activeIndex + 1) % length
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
  function buildDraftPresentation(): StoryEventFile["presentation"] {
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
  function buildDialogueEventDraft(): StoryEventFile | null {
    if (!props.event) {
      return null
    }
  
    return {
      node_type: "event",
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
      end_script: draft.endScript.trim(),
      object_keys: normalizeObjectKeys(draft.selectedObjectKeys),
      presentation: buildDraftPresentation(),
      location: draft.location.trim(),
      next: [...props.event.next],
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
          collectionType: "chain",
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
  
    emit("save", {
      node_type: "event",
      id: draft.id.trim(),
      title: draft.title.trim(),
      trigger_mode: triggerMode,
      trigger_expr: triggerExpr,
      invoke_params: invokeParams,
      init_script: draft.initScript.trim(),
      end_script: draft.endScript.trim(),
      object_keys: normalizeObjectKeys(draft.selectedObjectKeys),
      presentation: buildDraftPresentation(),
      location: draft.location.trim(),
      next: [...props.event.next],
      meta: props.event.meta
    })
  }
  
  /** 移除指定的 `NextNode` 数据。 @param nextNodeId 调用方传入的 `nextNodeId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeNextNode(nextNodeId: string) {
    if (!props.event) {
      return
    }
  
    if (!window.confirm("确认删除这个后续节点连接吗？")) {
      return
    }
  
    emit("save", {
      ...props.event,
      next: props.event.next.filter((id) => id !== nextNodeId)
    })
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
      activeTab.value = "basic"
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
      if (!pendingQuickLocationName.value) {
        return
      }
  
      if (options.some((option) => option.value === pendingQuickLocationName.value)) {
        draft.location = pendingQuickLocationName.value
        pendingQuickLocationName.value = null
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
    generateStoryDialogue, activeTab, pendingQuickLocationName, cloneInvokeParam,
    draft, triggerAutocompleteCandidates, panelTitle, panelEyebrow,
    linkedNextNodes, normalizeDraftTriggerMode, syncPresentationDraft, syncDraft,
    submitQuickCreateLocation, getBranchValidationTokens, getReadableValidationTokens, getWritableValidationTokens,
    validateScriptField, closeAllScriptAutocomplete, onScriptFieldKeydown, buildDraftPresentation,
    buildDialogueEventDraft, runDialogueAi, submitDraft, removeNextNode,
    handleDocumentPointerDown,
  }
}

/** 剧情链事件面板可安全访问的完整控制器类型。 */
export type GraphEventEditorController = ReturnType<typeof useGraphEventEditor>
