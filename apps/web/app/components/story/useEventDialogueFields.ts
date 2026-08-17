/**
 * 事件面板共享的对白与对象字段控制器。
 *
 * 输入是事件草稿、角色和地点资料，输出对白编辑、AI 对白、对象选择和快速创建状态。
 * 它只修改内存草稿；最终校验与保存仍由具体事件控制器负责。
 */
import { computed, reactive, shallowRef, useTemplateRef, type ComputedRef } from "vue"
import {
  buildStoryRoleKey,
  findStoryRoleReference,
  type StoryDocument,
  type StoryEventInvokeParamDefinition,
  type StoryEventLocationFile,
  type StoryEventPresentationType,
  type StoryEventTriggerMode,
  type StoryOnceDialogueDefinition,
  type StoryRolesFile,
  type StoryValsFile
} from "@story-mgr/core"
import type { GenerateStoryDialogueResponse } from "@story-mgr/shared"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import {
  STORY_SCRIPT_TEMPLATE_PLACEHOLDER,
  buildStoryReferAutocompleteItems,
  filterStoryScriptAutocompleteItems,
  mergeStoryScriptAutocompleteItems,
  openStoryScriptReferencePage,
  resolveStoryScriptAutocompletePlacement,
  type StoryScriptAutocompleteItem
} from "./storyScriptEditor"

interface DialogueDraft extends StoryOnceDialogueDefinition { id: string }
interface DialogueEditorDraft {
  speaker_type: StoryOnceDialogueDefinition["speaker_type"]
  speaker_key: string
  content: string
  role_name_input?: { role_key: string; prompt?: string }
}
interface InvokeParamDraft extends StoryEventInvokeParamDefinition { id: string }
interface RoleOption { key: string; label: string }

interface ScriptAutocompleteState {
  open: boolean
  query: string
  replaceStart: number
  replaceEnd: number
  activeIndex: number
  placement: "top" | "bottom"
}

export interface SharedEventDialogueProps {
  eventLocations: StoryEventLocationFile
  roles: StoryRolesFile
  saving: boolean
  story?: StoryDocument | null
  vals: StoryValsFile
}

export interface SharedEventDialogueDraft {
  dialogues: DialogueDraft[]
  endScript: string
  initScript: string
  invokeParams: InvokeParamDraft[]
  selectedObjectKeys: string[]
  triggerExpr: string
  triggerMode: StoryEventTriggerMode
}

export interface UseEventDialogueFieldsOptions {
  cloneInvokeParam: (param?: StoryEventInvokeParamDefinition) => InvokeParamDraft
  draft: SharedEventDialogueDraft
  emitQuickCreateRole: (payload: StoryQuickCreateRolePayload) => void
  globalAutocompleteCandidates: ComputedRef<StoryScriptAutocompleteItem[]>
  invokeParamAutocompleteCandidates: ComputedRef<StoryScriptAutocompleteItem[]>
  normalizeAutocompleteText: (value: unknown) => string
  props: Readonly<SharedEventDialogueProps>
  scriptAutocompleteCandidates: ComputedRef<StoryScriptAutocompleteItem[]>
}

/** 组合 `EventDialogueFields` 的响应式状态、派生值和操作方法。 @param options 调用方传入的 `options`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useEventDialogueFields(options: UseEventDialogueFieldsOptions) {
  const {
    cloneInvokeParam,
    draft,
    emitQuickCreateRole,
    globalAutocompleteCandidates,
    invokeParamAutocompleteCandidates,
    normalizeAutocompleteText,
    props,
    scriptAutocompleteCandidates
  } = options

  const PLAYER_OBJECT_OPTION: RoleOption = {
    key: "player",
    label: "主角"
  }
  
  const dialogueContentFieldRef = useTemplateRef<HTMLElement>("dialogueContentField")
  
  const dialogueContentTextareaRef = useTemplateRef<HTMLTextAreaElement>("dialogueContentTextarea")
  
  const isQuickLocationDialogOpen = shallowRef(false)
  
  const isQuickRoleDialogOpen = shallowRef(false)
  
  const pendingQuickRoleKey = shallowRef<string | null>(null)
  
  const dialogueContentAutocompleteState = reactive<ScriptAutocompleteState>({
    open: false,
    query: "",
    replaceStart: 0,
    replaceEnd: 0,
    activeIndex: 0,
    placement: "bottom"
  })
  
  let dialogueIdSeed = 0
  
  let invokeParamIdSeed = 0
  
  /** 创建一份新的 `DialogueId` 数据。 @returns 计算、查找或构建后的结果。 */
  function createDialogueId() {
    dialogueIdSeed += 1
    return `dialogue-${dialogueIdSeed}`
  }
  
  /** 创建一份新的 `InvokeParamId` 数据。 @returns 计算、查找或构建后的结果。 */
  function createInvokeParamId() {
    invokeParamIdSeed += 1
    return `invoke-param-${invokeParamIdSeed}`
  }
  
  /** 复制 `Dialogue`，避免共享可变引用。 @param dialogue 调用方传入的 `dialogue`。 @returns 计算、查找或构建后的结果。 */
  function cloneDialogue(dialogue?: StoryOnceDialogueDefinition): DialogueDraft {
    return {
      id: createDialogueId(),
      speaker_type: dialogue?.speaker_type ?? "object",
      speaker_key: dialogue?.speaker_key ?? "",
      content: dialogue?.content ?? "",
      role_name_input: dialogue?.role_name_input
        ? { role_key: dialogue.role_name_input.role_key, prompt: dialogue.role_name_input.prompt ?? "" }
        : undefined
    }
  }
  
  const dialogueEditorState = reactive<{
    open: boolean
    mode: "create" | "edit"
    dialogueId: string
    draft: DialogueEditorDraft
  }>({
    open: false,
    mode: "create",
    dialogueId: "",
    draft: {
      speaker_type: "player",
      speaker_key: "player",
      content: ""
    }
  })
  
  const isDialogueAiDialogOpen = shallowRef(false)
  
  const dialogueAiPrompt = shallowRef("")
  
  const dialogueAiLoading = shallowRef(false)
  
  const dialogueAiError = shallowRef<string | null>(null)
  
  const dialogueAiResult = shallowRef<GenerateStoryDialogueResponse | null>(null)
  
  const dialogueAiAbortController = shallowRef<AbortController | null>(null)
  
  const locationOptions = computed(() => {
    return props.eventLocations.assignments.map((assignment) => ({
      value: assignment.id,
      label: assignment.descr.trim()
        ? `${assignment.id} - ${assignment.descr.trim()}`
        : assignment.id
    }))
  })
  
  const importantRoleOptions = computed<RoleOption[]>(() => {
    return props.roles.important.roles.map((role) => ({
      key: buildStoryRoleKey("important", role.id),
      label: role.zhiye.trim()
        ? `${role.name?.trim() || role.id} - ${role.zhiye.trim()}`
        : role.name?.trim() || role.id
    }))
  })
  
  const normalRoleOptions = computed<RoleOption[]>(() => {
    return props.roles.normal.roles.map((role) => ({
      key: buildStoryRoleKey("normal", role.id),
      label: role.zhiye.trim()
        ? `${role.name?.trim() || role.id} - ${role.zhiye.trim()}`
        : role.name?.trim() || role.id
    }))
  })
  
  const specialObjectOptions = computed<RoleOption[]>(() => [PLAYER_OBJECT_OPTION])
  
  const roleOptionMap = computed(() => {
    const entries: Array<[string, RoleOption]> = [
      ...specialObjectOptions.value,
      ...importantRoleOptions.value,
      ...normalRoleOptions.value
    ].map((option) => [option.key, option])
  
    return new Map(entries)
  })
  
  const objectKeyOptions = computed(() => draft.selectedObjectKeys)
  
  const dialogueEditorTitle = computed(() => {
    return dialogueEditorState.mode === "create" ? "新增对白" : "编辑对白"
  })
  
  const dialogueContentAutocompleteItems = computed(() => {
    return filterStoryScriptAutocompleteItems(
      dialogueContentAutocompleteState.query,
      scriptAutocompleteCandidates.value
    )
  })
  
  const isDialogueContentAutocompleteOpen = computed(() => dialogueContentAutocompleteState.open)
  
  const activeDialogueContentAutocompleteItem = computed(() => {
    if (
      !isDialogueContentAutocompleteOpen.value ||
      dialogueContentAutocompleteItems.value.length === 0
    ) {
      return null
    }
  
    return dialogueContentAutocompleteItems.value[
      dialogueContentAutocompleteState.activeIndex % dialogueContentAutocompleteItems.value.length
    ]
  })
  
  const submitLabel = computed(() => {
    if (props.saving) {
      return "保存中..."
    }
  
    return "保存"
  })
  
  /** 将 `ObjectKeys` 输入清洗为内部统一格式。 @param objectKeys 调用方传入的 `objectKeys`。 @returns 计算、查找或构建后的结果。 */
  function normalizeObjectKeys(objectKeys: string[]) {
    return Array.from(new Set(objectKeys.map((roleKey) => roleKey.trim()).filter(Boolean)))
  }
  
  /** 将 `StoredObjectKeys` 输入清洗为内部统一格式。 @param objectKeys 调用方传入的 `objectKeys`。 @returns 计算、查找或构建后的结果。 */
  function normalizeStoredObjectKeys(objectKeys: string[]) {
    return normalizeObjectKeys(
      objectKeys
        .map((roleKey) => findStoryRoleReference(props.roles, roleKey)?.key ?? roleKey.trim())
        .filter(Boolean)
    )
  }
  
  /** 创建一份新的 `DialogueEditorDraft` 数据。 @param dialogue 调用方传入的 `dialogue`。 @returns 计算、查找或构建后的结果。 */
  function createDialogueEditorDraft(dialogue?: StoryOnceDialogueDefinition): DialogueEditorDraft {
    const speakerType = dialogue?.speaker_type ?? (objectKeyOptions.value[0] ? "object" : "player")
    const speakerKey = speakerType === "player"
      ? "player"
      : (dialogue?.speaker_key || objectKeyOptions.value[0] || "")
  
    return {
      speaker_type: speakerType,
      speaker_key: speakerKey,
      content: dialogue?.content ?? "",
      role_name_input: dialogue?.role_name_input
        ? { role_key: dialogue.role_name_input.role_key, prompt: dialogue.role_name_input.prompt ?? "" }
        : undefined
    }
  }
  
  /** 打开 `CreateDialogueEditor` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function openCreateDialogueEditor() {
    closeDialogueContentAutocomplete()
    dialogueEditorState.open = true
    dialogueEditorState.mode = "create"
    dialogueEditorState.dialogueId = ""
    dialogueEditorState.draft = createDialogueEditorDraft()
  }
  
  /** 打开 `EditDialogueEditor` 界面并初始化临时状态。 @param dialogueId 调用方传入的 `dialogueId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function openEditDialogueEditor(dialogueId: string) {
    const dialogue = draft.dialogues.find((item) => item.id === dialogueId)
  
    if (!dialogue) {
      return
    }
  
    closeDialogueContentAutocomplete()
    dialogueEditorState.open = true
    dialogueEditorState.mode = "edit"
    dialogueEditorState.dialogueId = dialogueId
    dialogueEditorState.draft = createDialogueEditorDraft(dialogue)
  }
  
  /** 关闭 `DialogueEditor` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function closeDialogueEditor() {
    closeDialogueContentAutocomplete()
    dialogueEditorState.open = false
    dialogueEditorState.mode = "create"
    dialogueEditorState.dialogueId = ""
    dialogueEditorState.draft = createDialogueEditorDraft()
  }
  
  /** 移除指定的 `Dialogue` 数据。 @param dialogueId 调用方传入的 `dialogueId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeDialogue(dialogueId: string) {
    draft.dialogues = draft.dialogues.filter((dialogue) => dialogue.id !== dialogueId)
  }
  
  /** 新增一项 `InvokeParam` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addInvokeParam() {
    draft.invokeParams.push(cloneInvokeParam())
  }
  
  /** 移除指定的 `InvokeParam` 数据。 @param paramId 调用方传入的 `paramId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeInvokeParam(paramId: string) {
    draft.invokeParams = draft.invokeParams.filter((param) => param.id !== paramId)
  }
  
  /** 调整 `Dialogue` 在列表中的顺序。 @param dialogueId 调用方传入的 `dialogueId`。 @param direction 调用方传入的 `direction`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function moveDialogue(dialogueId: string, direction: -1 | 1) {
    const index = draft.dialogues.findIndex((dialogue) => dialogue.id === dialogueId)
    const nextIndex = index + direction
  
    if (index < 0 || nextIndex < 0 || nextIndex >= draft.dialogues.length) {
      return
    }
  
    const nextDialogues = [...draft.dialogues]
    const [dialogue] = nextDialogues.splice(index, 1)
    nextDialogues.splice(nextIndex, 0, dialogue)
    draft.dialogues = nextDialogues
  }
  
  /** 处理 `DialogueEditorSpeakerTypeChange` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function handleDialogueEditorSpeakerTypeChange() {
    if (dialogueEditorState.draft.speaker_type === "player") {
      dialogueEditorState.draft.speaker_key = "player"
      dialogueEditorState.draft.role_name_input = undefined
      return
    }
  
    dialogueEditorState.draft.speaker_key = objectKeyOptions.value[0] ?? ""
  }

  function getDialogueEditorRoleNameOptions() {
    const objectKeys = new Set(objectKeyOptions.value)
    return importantRoleOptions.value.filter((option) => objectKeys.has(option.key))
  }

  function handleDialogueEditorRoleNameToggle(enabled: boolean) {
    if (!enabled || dialogueEditorState.draft.speaker_type === "player") {
      dialogueEditorState.draft.role_name_input = undefined
      return
    }
    const options = getDialogueEditorRoleNameOptions()
    const current = dialogueEditorState.draft.role_name_input?.role_key
    dialogueEditorState.draft.role_name_input = {
      role_key: current && options.some((option) => option.key === current) ? current : (options[0]?.key ?? ""),
      prompt: dialogueEditorState.draft.role_name_input?.prompt ?? ""
    }
  }
  
  /** 读取或计算 `DialogueEditorSpeakerOptions`。 @returns 计算、查找或构建后的结果。 */
  function getDialogueEditorSpeakerOptions() {
    if (dialogueEditorState.draft.speaker_type === "player") {
      return [{ value: "player", label: "主角" }]
    }
  
    return objectKeyOptions.value.map((roleKey) => ({
      value: roleKey,
      label: roleOptionMap.value.get(roleKey)?.label ?? roleKey
    }))
  }
  
  /** 保存 `DialogueEditor` 数据并同步界面状态。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  function saveDialogueEditor() {
    const nextDialogue: DialogueDraft = {
      id: dialogueEditorState.mode === "edit" ? dialogueEditorState.dialogueId : createDialogueId(),
      speaker_type: dialogueEditorState.draft.speaker_type,
      speaker_key:
        dialogueEditorState.draft.speaker_type === "player"
          ? "player"
          : dialogueEditorState.draft.speaker_key,
      content: dialogueEditorState.draft.content
      ,...(dialogueEditorState.draft.role_name_input?.role_key
        ? { role_name_input: {
            role_key: dialogueEditorState.draft.role_name_input.role_key.trim(),
            ...(dialogueEditorState.draft.role_name_input.prompt?.trim()
              ? { prompt: dialogueEditorState.draft.role_name_input.prompt.trim() }
              : {})
          } }
        : {})
    }
  
    if (dialogueEditorState.mode === "edit") {
      draft.dialogues = draft.dialogues.map((dialogue) => {
        return dialogue.id === dialogueEditorState.dialogueId ? nextDialogue : dialogue
      })
    } else {
      draft.dialogues.push(nextDialogue)
    }
  
    closeDialogueEditor()
  }
  
  /** 切换 `DialogueTemplateHelp` 的当前状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function toggleDialogueTemplateHelp() {
    openStoryScriptReferencePage()
  }
  
  /** 读取或计算 `InvokeParamValidationTokens`。 @returns 计算、查找或构建后的结果。 */
  function getInvokeParamValidationTokens() {
    return invokeParamAutocompleteCandidates.value
      .map((item) => normalizeAutocompleteText(item.name))
      .filter(Boolean)
  }
  
  /** 关闭 `DialogueContentAutocomplete` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function closeDialogueContentAutocomplete() {
    dialogueContentAutocompleteState.open = false
    dialogueContentAutocompleteState.query = ""
    dialogueContentAutocompleteState.replaceStart = 0
    dialogueContentAutocompleteState.replaceEnd = 0
    dialogueContentAutocompleteState.activeIndex = 0
    dialogueContentAutocompleteState.placement = "bottom"
  }
  
  /** 执行 `updateDialogueContentAutocompleteFromCaret` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
  function updateDialogueContentAutocompleteFromCaret() {
    const textarea = dialogueContentTextareaRef.value
    const fieldValue = dialogueEditorState.draft.content
  
    if (!textarea) {
      closeDialogueContentAutocomplete()
      return
    }
  
    const caret = textarea.selectionStart ?? fieldValue.length
    const beforeCaret = fieldValue.slice(0, caret)
    const openPlaceholderIndex = beforeCaret.lastIndexOf("${")
  
    if (
      openPlaceholderIndex < 0 ||
      beforeCaret.slice(openPlaceholderIndex + 2).includes("}")
    ) {
      closeDialogueContentAutocomplete()
      return
    }
  
    dialogueContentAutocompleteState.open = true
    dialogueContentAutocompleteState.query = beforeCaret.slice(openPlaceholderIndex + 2)
    dialogueContentAutocompleteState.replaceStart = openPlaceholderIndex
    dialogueContentAutocompleteState.replaceEnd = caret
    dialogueContentAutocompleteState.placement = resolveStoryScriptAutocompletePlacement(textarea)
  
    if (dialogueContentAutocompleteItems.value.length === 0) {
      dialogueContentAutocompleteState.activeIndex = 0
      return
    }
  
    if (dialogueContentAutocompleteState.activeIndex >= dialogueContentAutocompleteItems.value.length) {
      dialogueContentAutocompleteState.activeIndex = 0
    }
  }
  
  /** 执行 `insertDialogueContentAutocompleteItem` 对应的局部业务逻辑。 @param itemName 调用方传入的 `itemName`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
  function insertDialogueContentAutocompleteItem(itemName: string) {
    const replaceStart = dialogueContentAutocompleteState.replaceStart
  
    dialogueEditorState.draft.content =
      dialogueEditorState.draft.content.slice(0, replaceStart + 2) +
      itemName +
      "}" +
      dialogueEditorState.draft.content.slice(dialogueContentAutocompleteState.replaceEnd)
  
    closeDialogueContentAutocomplete()
  
    requestAnimationFrame(() => {
      const nextCaret = replaceStart + itemName.length + 3
      dialogueContentTextareaRef.value?.focus()
      dialogueContentTextareaRef.value?.setSelectionRange(nextCaret, nextCaret)
    })
  }
  
  /** 处理 `DialogueContentInput` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onDialogueContentInput() {
    updateDialogueContentAutocompleteFromCaret()
  }
  
  /** 处理 `DialogueContentKeydown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function onDialogueContentKeydown(event: KeyboardEvent) {
    if (!dialogueContentAutocompleteState.open) {
      if (event.key === "Escape") {
        closeDialogueContentAutocomplete()
      }
      return
    }
  
    if (event.key === "Escape") {
      event.preventDefault()
      closeDialogueContentAutocomplete()
      return
    }
  
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const length = Math.max(dialogueContentAutocompleteItems.value.length, 1)
      dialogueContentAutocompleteState.activeIndex =
        (dialogueContentAutocompleteState.activeIndex + 1) % length
      return
    }
  
    if (event.key === "ArrowUp") {
      event.preventDefault()
      const length = Math.max(dialogueContentAutocompleteItems.value.length, 1)
      dialogueContentAutocompleteState.activeIndex =
        (dialogueContentAutocompleteState.activeIndex - 1 + length) % length
      return
    }
  
    if (event.key === "Enter" || event.key === "Tab") {
      const item = activeDialogueContentAutocompleteItem.value
  
      if (!item) {
        return
      }
  
      event.preventDefault()
      insertDialogueContentAutocompleteItem(item.name)
    }
  }
  
  /** 打开 `DialogueAiDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function openDialogueAiDialog() {
    dialogueAiError.value = null
    dialogueAiResult.value = null
    dialogueAiPrompt.value = ""
    isDialogueAiDialogOpen.value = true
  }
  
  /** 关闭 `DialogueAiDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function closeDialogueAiDialog() {
    if (dialogueAiLoading.value) {
      return
    }
  
    isDialogueAiDialogOpen.value = false
  }
  
  /** 执行 `abortDialogueAi` 对应的异步业务流程。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  function abortDialogueAi() {
    dialogueAiAbortController.value?.abort()
  }
  
  /** 把 `DialogueAiResult` 结果应用到当前草稿或状态。 @param dialogues 调用方传入的 `dialogues`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  function applyDialogueAiResult(dialogues: StoryOnceDialogueDefinition[]) {
    draft.dialogues = dialogues.map((dialogue) => cloneDialogue(dialogue))
    isDialogueAiDialogOpen.value = false
  }
  
  /** 执行 `requestQuickCreateRole` 对应的异步业务流程。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  function requestQuickCreateRole() {
    isQuickRoleDialogOpen.value = true
  }
  
  /** 执行 `requestQuickCreateLocation` 对应的异步业务流程。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  function requestQuickCreateLocation() {
    isQuickLocationDialogOpen.value = true
  }
  
  /** 关闭 `QuickLocationDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function closeQuickLocationDialog() {
    if (props.saving) {
      return
    }
  
    isQuickLocationDialogOpen.value = false
  }
  
  /** 关闭 `QuickRoleDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function closeQuickRoleDialog() {
    if (props.saving) {
      return
    }
  
    isQuickRoleDialogOpen.value = false
  }
  
  /** 校验当前草稿并提交给父组件或 API。 @param payload 调用方传入的 `payload`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function submitQuickCreateRole(payload: StoryQuickCreateRolePayload) {
    pendingQuickRoleKey.value = payload.roleKey
    emitQuickCreateRole(payload)
  }
  
  /** 把 `QuickCreatedRole` 结果应用到当前草稿或状态。 @param roleKey 调用方传入的 `roleKey`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  function applyQuickCreatedRole(roleKey: string) {
    const nextKeys = new Set(draft.selectedObjectKeys)
    nextKeys.add(roleKey)
    draft.selectedObjectKeys = Array.from(nextKeys)
  }

  return {
    STORY_SCRIPT_TEMPLATE_PLACEHOLDER, PLAYER_OBJECT_OPTION, dialogueContentFieldRef, dialogueContentTextareaRef, isQuickLocationDialogOpen,
    isQuickRoleDialogOpen, pendingQuickRoleKey, dialogueContentAutocompleteState, dialogueIdSeed,
    invokeParamIdSeed, createDialogueId, createInvokeParamId, cloneDialogue,
    dialogueEditorState, isDialogueAiDialogOpen, dialogueAiPrompt, dialogueAiLoading,
    dialogueAiError, dialogueAiResult, dialogueAiAbortController, locationOptions,
    importantRoleOptions, normalRoleOptions, specialObjectOptions, roleOptionMap,
    objectKeyOptions, dialogueEditorTitle, dialogueContentAutocompleteItems,
    isDialogueContentAutocompleteOpen, activeDialogueContentAutocompleteItem, submitLabel, normalizeObjectKeys,
    normalizeStoredObjectKeys, createDialogueEditorDraft, openCreateDialogueEditor, openEditDialogueEditor,
    closeDialogueEditor, removeDialogue, addInvokeParam, removeInvokeParam,
    moveDialogue, handleDialogueEditorSpeakerTypeChange, getDialogueEditorSpeakerOptions, getDialogueEditorRoleNameOptions,
    handleDialogueEditorRoleNameToggle, saveDialogueEditor,
    toggleDialogueTemplateHelp, getInvokeParamValidationTokens, closeDialogueContentAutocomplete, updateDialogueContentAutocompleteFromCaret,
    insertDialogueContentAutocompleteItem, onDialogueContentInput, onDialogueContentKeydown, openDialogueAiDialog,
    closeDialogueAiDialog, abortDialogueAi, applyDialogueAiResult, requestQuickCreateRole,
    requestQuickCreateLocation, closeQuickLocationDialog, closeQuickRoleDialog, submitQuickCreateRole,
    applyQuickCreatedRole,
  }
}
