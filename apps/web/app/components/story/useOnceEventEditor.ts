/**
 * 单次事件编辑控制器。
 *
 * 共享字段由 useEventScriptFields 与 useEventDialogueFields 提供，本模块只补充单次事件字段。
 * 保存时组装 StoryOnceEventFile 并通过 emit 交给父编辑器，不直接调用文件存储。
 */
import { useEventDialogueFields } from "./useEventDialogueFields"
import { useEventScriptFields, type ScriptFieldKey } from "./useEventScriptFields"
import {
  buildStoryRoleKey,
  findStoryRoleReference,
  type StoryDocument,
  type StoryEventLocationFile,
  type StoryEventPresentationType,
  type StoryOnceDialogueDefinition,
  type StoryOnceEventFile,
  type StoryOnceInvokeParamDefinition,
  type StoryOnceTriggerMode,
  type StoryRolesFile,
  type StorySceneFile,
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

interface InvokeParamDraft extends StoryOnceInvokeParamDefinition {
  id: string
}

interface OnceEventDraft {
  id: string
  title: string
  triggerMode: StoryOnceTriggerMode
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
}

export interface OnceEventEditorProps {
  eyebrow?: string
  event: StoryOnceEventFile | null
  eventLocations: StoryEventLocationFile
  itemIds: string[]
  mode?: "create" | "edit"
  roles: StoryRolesFile
  saving: boolean
  scenes: StorySceneFile
  story?: StoryDocument | null
  vals: StoryValsFile
}

export interface OnceEventEditorEmits {
  close: []
  quickCreateLocation: [payload: StoryQuickCreateLocationPayload]
  quickCreateRole: [payload: StoryQuickCreateRolePayload]
  save: [event: StoryOnceEventFile]
}

export type OnceEventEditorEmit = <Name extends keyof OnceEventEditorEmits>(
  event: Name,
  ...args: OnceEventEditorEmits[Name]
) => void

/** 组合 `OnceEventEditor` 的响应式状态、派生值和操作方法。 @param props 调用方传入的 `props`。 @param emit 调用方传入的 `emit`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useOnceEventEditor(
  props: Readonly<OnceEventEditorProps>,
  emit: OnceEventEditorEmit
) {
  const { generateStoryDialogue } = useStoryApi()
  const pendingQuickLocationName = shallowRef<string | null>(null)
  
  /** 复制 `InvokeParam`，避免共享可变引用。 @param param 调用方传入的 `param`。 @returns 计算、查找或构建后的结果。 */
  function cloneInvokeParam(param?: StoryOnceInvokeParamDefinition): InvokeParamDraft {
    return {
      id: createInvokeParamId(),
      name: param?.name ?? "",
      descr: param?.descr ?? ""
    }
  }
  
  const draft = reactive<OnceEventDraft>({
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
    selectedObjectKeys: []
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
  
  const panelTitle = computed(() => {
    if (draft.title.trim()) {
      return draft.title.trim()
    }
  
    return props.mode === "create" ? "未命名一次性事件" : (props.event?.title ?? "一次性事件")
  })
  
  const panelEyebrow = computed(() => {
    if (props.eyebrow) {
      return props.eyebrow
    }
  
    return props.mode === "create" ? "新一次性事件" : "一次性事件编辑"
  })
  
  /** 将 `DraftTriggerMode` 输入清洗为内部统一格式。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
  function normalizeDraftTriggerMode(event: StoryOnceEventFile | null): StoryOnceTriggerMode {
    const mode = event?.trigger_mode ?? "default"
    if (mode === "condition" && !(event?.trigger_expr ?? "").trim()) {
      return "default"
    }
  
    return mode
  }
  
  /** 把外部或服务端数据同步到本地响应式状态。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function syncPresentationDraft(event: StoryOnceEventFile | null) {
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
  function syncDraft(event: StoryOnceEventFile | null) {
    draft.id = event?.id ?? ""
    draft.title = event?.title ?? ""
    draft.triggerMode = normalizeDraftTriggerMode(event)
    draft.triggerExpr = event?.trigger_expr ?? ""
    draft.invokeParams = (event?.invoke_params ?? []).map((param) => cloneInvokeParam(param))
    draft.initScript = event?.init_script ?? ""
    draft.location = event?.location ?? ""
    draft.bgm = event?.bgm ?? ""
    draft.endScript = event?.end_script ?? ""
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
  function buildDraftPresentation(): StoryOnceEventFile["presentation"] {
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
        content: dialogue.content.trim(),
        ...(dialogue.role_name_input?.role_key
          ? { role_name_input: { role_key: dialogue.role_name_input.role_key.trim(), ...(dialogue.role_name_input.prompt?.trim() ? { prompt: dialogue.role_name_input.prompt.trim() } : {}) } }
          : {})
      }))
    }
  }
  
  /** 根据当前输入构建 `DialogueEventDraft` 结果。 @returns 计算、查找或构建后的结果。 */
  function buildDialogueEventDraft(): StoryOnceEventFile | null {
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
          collectionType: "pool",
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
      end_script: draft.endScript.trim()
    })
  }
  
  /** 校验当前草稿并提交给父组件或 API。 @param payload 调用方传入的 `payload`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function submitQuickCreateLocation(payload: StoryQuickCreateLocationPayload) {
    pendingQuickLocationName.value = payload.id
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
    () => draft.triggerMode,
    (mode) => {
      if (mode !== "condition") {
        closeScriptAutocomplete("triggerExpr")
      }
    }
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
    generateStoryDialogue, pendingQuickLocationName, cloneInvokeParam, draft,
    bgmOptions, panelTitle, panelEyebrow, normalizeDraftTriggerMode,
    syncPresentationDraft, syncDraft, getReadableValidationTokens, validateScriptField,
    closeAllScriptAutocomplete, onScriptFieldKeydown, buildDraftPresentation, buildDialogueEventDraft,
    runDialogueAi, submitDraft, submitQuickCreateLocation, handleDocumentPointerDown,
  }
}

/** 单次事件面板可安全访问的完整控制器类型。 */
export type OnceEventEditorController = ReturnType<typeof useOnceEventEditor>
