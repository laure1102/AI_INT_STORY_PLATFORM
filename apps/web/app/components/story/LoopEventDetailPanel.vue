<script setup lang="ts">
import {
  buildStoryRoleKey,
  findStoryRoleReference,
  type StoryEventInvokeParamDefinition,
  type StoryEventTriggerMode,
  type StoryEventLocationFile,
  type StoryLoopEventFile,
  type StoryLoopMode,
  type StoryOnceDialogueDefinition,
  type StoryRolesFile,
  type StorySceneFile,
  type StoryValsFile
} from "@story-mgr/core"
import StoryEventLocationField from "./StoryEventLocationField.vue"
import StoryEventObjectField from "./StoryEventObjectField.vue"
import StoryQuickLocationCreateDialog from "./StoryQuickLocationCreateDialog.vue"
import StoryQuickRoleCreateDialog from "./StoryQuickRoleCreateDialog.vue"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import {
  STORY_SCRIPT_TEMPLATE_PLACEHOLDER,
  buildStoryScriptHighlightTokens,
  buildStoryScriptValAutocompleteItems,
  filterStoryScriptAutocompleteItems,
  mergeStoryScriptAutocompleteItems,
  openStoryScriptReferencePage,
  resolveStoryScriptAutocompletePlacement,
  type StoryScriptAutocompleteItem
} from "./storyScriptEditor"

interface DialogueDraft extends StoryOnceDialogueDefinition {
  id: string
}

interface DialogueEditorDraft {
  speaker_type: StoryOnceDialogueDefinition["speaker_type"]
  speaker_key: string
  content: string
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
  dialogues: DialogueDraft[]
  selectedObjectKeys: string[]
  loopMode: StoryLoopMode
  intervalDays: number
  weekday: number
  monthDay: number
}

interface RoleOption {
  key: string
  label: string
}

const PLAYER_OBJECT_OPTION: RoleOption = {
  key: "player",
  label: "主角"
}

type ScriptFieldKey = "triggerExpr" | "initScript" | "endScript"

interface ScriptAutocompleteState {
  open: boolean
  query: string
  replaceStart: number
  replaceEnd: number
  activeIndex: number
  placement: "top" | "bottom"
}

type ScriptEditorFieldKey = Exclude<ScriptFieldKey, "triggerExpr">

const props = defineProps<{
  event: StoryLoopEventFile | null
  eventLocations: StoryEventLocationFile
  mode?: "create" | "edit"
  roles: StoryRolesFile
  saving: boolean
  scenes: StorySceneFile
  vals: StoryValsFile
}>()

const emit = defineEmits<{
  close: []
  quickCreateLocation: [payload: StoryQuickCreateLocationPayload]
  quickCreateRole: [payload: StoryQuickCreateRolePayload]
  save: [event: StoryLoopEventFile]
}>()

const triggerExprFieldRef = useTemplateRef<HTMLDivElement>("triggerExprField")
const triggerExprTextareaRef = useTemplateRef<HTMLTextAreaElement>("triggerExprTextarea")
const initScriptFieldRef = useTemplateRef<HTMLDivElement>("initScriptField")
const initScriptTextareaRef = useTemplateRef<HTMLTextAreaElement>("initScriptTextarea")
const endScriptFieldRef = useTemplateRef<HTMLDivElement>("endScriptField")
const endScriptTextareaRef = useTemplateRef<HTMLTextAreaElement>("endScriptTextarea")
const dialogueContentFieldRef = useTemplateRef<HTMLElement>("dialogueContentField")
const dialogueContentTextareaRef = useTemplateRef<HTMLTextAreaElement>("dialogueContentTextarea")
const isQuickLocationDialogOpen = shallowRef(false)
const pendingQuickLocationId = shallowRef<string | null>(null)
const isQuickRoleDialogOpen = shallowRef(false)
const pendingQuickRoleKey = shallowRef<string | null>(null)
const triggerAutocompleteState = reactive<ScriptAutocompleteState>({
  open: false,
  query: "",
  replaceStart: 0,
  replaceEnd: 0,
  activeIndex: 0,
  placement: "bottom"
})
const initScriptAutocompleteState = reactive<ScriptAutocompleteState>({
  open: false,
  query: "",
  replaceStart: 0,
  replaceEnd: 0,
  activeIndex: 0,
  placement: "bottom"
})
const endScriptAutocompleteState = reactive<ScriptAutocompleteState>({
  open: false,
  query: "",
  replaceStart: 0,
  replaceEnd: 0,
  activeIndex: 0,
  placement: "bottom"
})
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

const LOOP_WEEKDAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" }
] as const

function createDialogueId() {
  dialogueIdSeed += 1
  return `dialogue-${dialogueIdSeed}`
}

function createInvokeParamId() {
  invokeParamIdSeed += 1
  return `invoke-param-${invokeParamIdSeed}`
}

function cloneDialogue(dialogue?: StoryOnceDialogueDefinition): DialogueDraft {
  return {
    id: createDialogueId(),
    speaker_type: dialogue?.speaker_type ?? "object",
    speaker_key: dialogue?.speaker_key ?? "",
    content: dialogue?.content ?? ""
  }
}

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
  dialogues: [],
  selectedObjectKeys: [],
  loopMode: "daily",
  intervalDays: 1,
  weekday: 1,
  monthDay: 1
})

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

const locationOptions = computed(() => {
  return props.eventLocations.assignments.map((assignment) => ({
    value: assignment.id,
    label: assignment.descr.trim()
      ? `${assignment.id} - ${assignment.descr.trim()}`
      : assignment.id
  }))
})

const bgmOptions = computed(() => {
  return Array.from(
    new Set(
      props.scenes.scenes
        .map((scene) => scene.music.trim())
        .filter(Boolean)
    )
  )
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
const loopModeOptions: Array<{ value: StoryLoopMode; label: string }> = [
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "interval_days", label: "每隔多少天" }
]
const globalAutocompleteCandidates = computed(() => {
  return buildStoryScriptValAutocompleteItems(props.vals)
})
const invokeParamAutocompleteCandidates = computed<StoryScriptAutocompleteItem[]>(() => {
  if (draft.triggerMode !== "invoke") {
    return []
  }

  const seen = new Set<string>()

  return draft.invokeParams.flatMap((param) => {
    const paramName = normalizeAutocompleteText(param.name)
    if (!paramName || seen.has(paramName)) {
      return []
    }

    seen.add(paramName)
    return [{
      name: `call.${paramName}`,
      description: normalizeAutocompleteText(param.descr) || "被调用时传入的参数"
    }]
  })
})
const scriptAutocompleteCandidates = computed(() => {
  return mergeStoryScriptAutocompleteItems(
    globalAutocompleteCandidates.value,
    invokeParamAutocompleteCandidates.value
  )
})
const triggerAutocompleteItems = computed(() => {
  return filterStoryScriptAutocompleteItems(
    triggerAutocompleteState.query,
    globalAutocompleteCandidates.value
  )
})
const initScriptAutocompleteItems = computed(() => {
  return filterStoryScriptAutocompleteItems(
    initScriptAutocompleteState.query,
    scriptAutocompleteCandidates.value
  )
})
const endScriptAutocompleteItems = computed(() => {
  return filterStoryScriptAutocompleteItems(
    endScriptAutocompleteState.query,
    scriptAutocompleteCandidates.value
  )
})
const dialogueContentAutocompleteItems = computed(() => {
  return filterStoryScriptAutocompleteItems(
    dialogueContentAutocompleteState.query,
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
const isDialogueContentAutocompleteOpen = computed(() => dialogueContentAutocompleteState.open)
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

const panelTitle = computed(() => {
  if (draft.title.trim()) {
    return draft.title.trim()
  }

  return props.mode === "create" ? "未命名循环事件" : (props.event?.title ?? "循环事件")
})

const submitLabel = computed(() => {
  if (props.saving) {
    return "保存中..."
  }

  return "保存"
})

const panelEyebrow = computed(() => {
  return props.mode === "create" ? "新循环事件" : "循环事件编辑"
})

function normalizeObjectKeys(objectKeys: string[]) {
  return Array.from(new Set(objectKeys.map((roleKey) => roleKey.trim()).filter(Boolean)))
}

function normalizeAutocompleteText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeDraftTriggerMode(event: StoryLoopEventFile | null): StoryEventTriggerMode {
  const mode = event?.trigger_mode ?? "default"
  if (mode === "condition" && !(event?.trigger_expr ?? "").trim()) {
    return "default"
  }

  return mode
}

function normalizeStoredObjectKeys(objectKeys: string[]) {
  return normalizeObjectKeys(
    objectKeys
      .map((roleKey) => findStoryRoleReference(props.roles, roleKey)?.key ?? roleKey.trim())
      .filter(Boolean)
  )
}

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
  draft.selectedObjectKeys = normalizeStoredObjectKeys(event?.object_keys ?? [])
  draft.dialogues = (event?.dialogues ?? []).map((dialogue) => {
    const normalizedSpeakerKey =
      dialogue.speaker_type === "object"
        ? findStoryRoleReference(props.roles, dialogue.speaker_key)?.key ?? dialogue.speaker_key
        : dialogue.speaker_key

    return cloneDialogue({
      ...dialogue,
      speaker_key: normalizedSpeakerKey
    })
  })
}

function createDialogueEditorDraft(dialogue?: StoryOnceDialogueDefinition): DialogueEditorDraft {
  const speakerType = dialogue?.speaker_type ?? (objectKeyOptions.value[0] ? "object" : "player")
  const speakerKey = speakerType === "player"
    ? "player"
    : (dialogue?.speaker_key || objectKeyOptions.value[0] || "")

  return {
    speaker_type: speakerType,
    speaker_key: speakerKey,
    content: dialogue?.content ?? ""
  }
}

function openCreateDialogueEditor() {
  closeDialogueContentAutocomplete()
  dialogueEditorState.open = true
  dialogueEditorState.mode = "create"
  dialogueEditorState.dialogueId = ""
  dialogueEditorState.draft = createDialogueEditorDraft()
}

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

function closeDialogueEditor() {
  closeDialogueContentAutocomplete()
  dialogueEditorState.open = false
  dialogueEditorState.mode = "create"
  dialogueEditorState.dialogueId = ""
  dialogueEditorState.draft = createDialogueEditorDraft()
}

function removeDialogue(dialogueId: string) {
  draft.dialogues = draft.dialogues.filter((dialogue) => dialogue.id !== dialogueId)
}

function addInvokeParam() {
  draft.invokeParams.push(cloneInvokeParam())
}

function removeInvokeParam(paramId: string) {
  draft.invokeParams = draft.invokeParams.filter((param) => param.id !== paramId)
}

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

function handleDialogueEditorSpeakerTypeChange() {
  if (dialogueEditorState.draft.speaker_type === "player") {
    dialogueEditorState.draft.speaker_key = "player"
    return
  }

  dialogueEditorState.draft.speaker_key = objectKeyOptions.value[0] ?? ""
}

function getDialogueEditorSpeakerOptions() {
  if (dialogueEditorState.draft.speaker_type === "player") {
    return [{ value: "player", label: "主角" }]
  }

  return objectKeyOptions.value.map((roleKey) => ({
    value: roleKey,
    label: roleOptionMap.value.get(roleKey)?.label ?? roleKey
  }))
}

function saveDialogueEditor() {
  const nextDialogue: DialogueDraft = {
    id: dialogueEditorState.mode === "edit" ? dialogueEditorState.dialogueId : createDialogueId(),
    speaker_type: dialogueEditorState.draft.speaker_type,
    speaker_key:
      dialogueEditorState.draft.speaker_type === "player"
        ? "player"
        : dialogueEditorState.draft.speaker_key,
    content: dialogueEditorState.draft.content
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

function toggleTriggerHelp() {
  openStoryScriptReferencePage()
}

function toggleInitScriptHelp() {
  openStoryScriptReferencePage()
}

function toggleEndScriptHelp() {
  openStoryScriptReferencePage()
}

function toggleDialogueTemplateHelp() {
  openStoryScriptReferencePage()
}

function getScriptAutocompleteState(field: ScriptFieldKey) {
  if (field === "triggerExpr") {
    return triggerAutocompleteState
  }

  if (field === "initScript") {
    return initScriptAutocompleteState
  }

  return endScriptAutocompleteState
}

function getScriptAutocompleteItems(field: ScriptFieldKey) {
  if (field === "triggerExpr") {
    return triggerAutocompleteItems.value
  }

  if (field === "initScript") {
    return initScriptAutocompleteItems.value
  }

  return endScriptAutocompleteItems.value
}

function getActiveScriptAutocompleteItem(field: ScriptFieldKey) {
  if (field === "triggerExpr") {
    return activeTriggerAutocompleteItem.value
  }

  if (field === "initScript") {
    return activeInitScriptAutocompleteItem.value
  }

  return activeEndScriptAutocompleteItem.value
}

function getScriptTextareaRef(field: ScriptFieldKey) {
  if (field === "triggerExpr") {
    return triggerExprTextareaRef.value
  }

  if (field === "initScript") {
    return initScriptTextareaRef.value
  }

  return endScriptTextareaRef.value
}

function getScriptFieldRef(field: ScriptFieldKey) {
  if (field === "triggerExpr") {
    return triggerExprFieldRef.value
  }

  if (field === "initScript") {
    return initScriptFieldRef.value
  }

  return endScriptFieldRef.value
}

function getScriptFieldValue(field: ScriptFieldKey) {
  if (field === "triggerExpr") {
    return draft.triggerExpr
  }

  if (field === "initScript") {
    return draft.initScript
  }

  return draft.endScript
}

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

function closeScriptAutocomplete(field: ScriptFieldKey) {
  const state = getScriptAutocompleteState(field)
  state.open = false
  state.query = ""
  state.replaceStart = 0
  state.replaceEnd = 0
  state.activeIndex = 0
  state.placement = "bottom"
}

function closeAllScriptAutocomplete() {
  closeScriptAutocomplete("triggerExpr")
  closeScriptAutocomplete("initScript")
  closeScriptAutocomplete("endScript")
}

function updateScriptAutocompleteFromCaret(field: ScriptFieldKey) {
  const textarea = getScriptTextareaRef(field)
  const fieldValue = getScriptFieldValue(field)
  const state = getScriptAutocompleteState(field)

  if (!textarea) {
    closeScriptAutocomplete(field)
    return
  }

  const caret = textarea.selectionStart ?? fieldValue.length
  const beforeCaret = fieldValue.slice(0, caret)
  const openPlaceholderIndex = beforeCaret.lastIndexOf("${")

  if (
    openPlaceholderIndex < 0 ||
    beforeCaret.slice(openPlaceholderIndex + 2).includes("}")
  ) {
    closeScriptAutocomplete(field)
    return
  }

  state.open = true
  state.query = beforeCaret.slice(openPlaceholderIndex + 2)
  state.replaceStart = openPlaceholderIndex
  state.replaceEnd = caret
  state.placement = resolveStoryScriptAutocompletePlacement(textarea)

  const items = getScriptAutocompleteItems(field)

  if (items.length === 0) {
    state.activeIndex = 0
  } else if (state.activeIndex >= items.length) {
    state.activeIndex = 0
  }
}

function insertScriptAutocompleteItem(field: ScriptFieldKey, itemName: string) {
  const textarea = getScriptTextareaRef(field)
  const state = getScriptAutocompleteState(field)
  const replaceStart = state.replaceStart
  const nextValue =
    getScriptFieldValue(field).slice(0, replaceStart + 2) +
    itemName +
    "}" +
    getScriptFieldValue(field).slice(state.replaceEnd)

  setScriptFieldValue(field, nextValue)
  closeScriptAutocomplete(field)

  requestAnimationFrame(() => {
    const nextCaret = replaceStart + itemName.length + 3
    textarea?.focus()
    textarea?.setSelectionRange(nextCaret, nextCaret)
  })
}

function onTriggerExprInput() {
  updateScriptAutocompleteFromCaret("triggerExpr")
}

function onTriggerExprKeydown(event: KeyboardEvent) {
  onScriptFieldKeydown("triggerExpr", event)
}

function onInitScriptInput() {
  updateScriptAutocompleteFromCaret("initScript")
}

function onInitScriptKeydown(event: KeyboardEvent) {
  onScriptFieldKeydown("initScript", event)
}

function onInitScriptScroll(event: Event) {
  syncScriptEditorScroll("initScript", event)
}

function onEndScriptInput() {
  updateScriptAutocompleteFromCaret("endScript")
}

function onEndScriptKeydown(event: KeyboardEvent) {
  onScriptFieldKeydown("endScript", event)
}

function onEndScriptScroll(event: Event) {
  syncScriptEditorScroll("endScript", event)
}

function closeDialogueContentAutocomplete() {
  dialogueContentAutocompleteState.open = false
  dialogueContentAutocompleteState.query = ""
  dialogueContentAutocompleteState.replaceStart = 0
  dialogueContentAutocompleteState.replaceEnd = 0
  dialogueContentAutocompleteState.activeIndex = 0
  dialogueContentAutocompleteState.placement = "bottom"
}

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

function onDialogueContentInput() {
  updateDialogueContentAutocompleteFromCaret()
}

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
    dialogues: draft.dialogues.map((dialogue) => ({
      speaker_type: dialogue.speaker_type,
      speaker_key: dialogue.speaker_key.trim(),
      content: dialogue.content.trim()
    })),
    location: draft.location.trim(),
    bgm: draft.bgm.trim(),
    end_script: draft.endScript.trim(),
    loop: {
      mode: draft.loopMode,
      interval_days: draft.loopMode === "interval_days" ? Math.max(1, Number(draft.intervalDays) || 1) : undefined,
      weekday: draft.loopMode === "weekly" ? Math.max(1, Math.min(7, Number(draft.weekday) || 1)) : undefined,
      month_day: draft.loopMode === "monthly" ? Math.max(1, Math.min(31, Number(draft.monthDay) || 1)) : undefined
    }
  })
}

function requestQuickCreateRole() {
  isQuickRoleDialogOpen.value = true
}

function requestQuickCreateLocation() {
  isQuickLocationDialogOpen.value = true
}

function closeQuickLocationDialog() {
  if (props.saving) {
    return
  }

  isQuickLocationDialogOpen.value = false
}

function submitQuickCreateLocation(payload: StoryQuickCreateLocationPayload) {
  pendingQuickLocationId.value = payload.id
  emit("quickCreateLocation", payload)
}

function closeQuickRoleDialog() {
  if (props.saving) {
    return
  }

  isQuickRoleDialogOpen.value = false
}

function submitQuickCreateRole(payload: StoryQuickCreateRolePayload) {
  pendingQuickRoleKey.value = payload.roleKey
  emit("quickCreateRole", payload)
}

function applyQuickCreatedRole(roleKey: string) {
  const nextKeys = new Set(draft.selectedObjectKeys)
  nextKeys.add(roleKey)
  draft.selectedObjectKeys = Array.from(nextKeys)
}

watch(
  () => props.event,
  (event) => {
    syncDraft(event)
    closeAllScriptAutocomplete()
    closeDialogueContentAutocomplete()
  },
  { immediate: true }
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
})

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
</script>

<template>
  <section class="detail-panel glass-panel">
    <template v-if="event">
      <div class="detail-panel__header">
        <div class="detail-panel__header-copy">
          <span class="eyebrow">{{ panelEyebrow }}</span>
          <h2 class="detail-panel__title">{{ panelTitle }}</h2>
        </div>
      </div>

      <div class="detail-panel__workspace">
        <div class="detail-panel__main">
          <section class="detail-card">
            <h3 class="detail-card__title">基础信息</h3>
            <div class="detail-grid">
              <label class="field">
                <span class="field-label">事件 ID</span>
                <input
                  v-model="draft.id"
                  class="text-input"
                  type="text"
                  :readonly="props.mode !== 'create'"
                />
              </label>

              <label class="field">
                <span class="field-label">标题</span>
                <input v-model="draft.title" class="text-input" type="text" />
              </label>

              <StoryEventLocationField
                v-model="draft.location"
                :options="locationOptions"
                @quick-create="requestQuickCreateLocation"
              />

              <label class="field">
                <span class="field-label">背景音乐</span>
                <input v-model="draft.bgm" class="text-input" type="text" list="loop-event-bgm" />
                <datalist id="loop-event-bgm">
                  <option v-for="bgm in bgmOptions" :key="bgm" :value="bgm" />
                </datalist>
              </label>

              <label v-if="draft.triggerMode !== 'invoke'" class="field field--full">
                <span class="field-label">循环方式</span>
                <div class="detail-panel__loop-row">
                  <select v-model="draft.loopMode" class="select-input detail-panel__loop-mode">
                    <option
                      v-for="option in loopModeOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>

                  <div
                    v-if="draft.loopMode !== 'daily'"
                    class="detail-panel__loop-config"
                  >
                    <template v-if="draft.loopMode === 'interval_days'">
                      <span class="detail-panel__loop-config-label">每多少天</span>
                      <input
                        v-model.number="draft.intervalDays"
                        class="text-input detail-panel__loop-interval"
                        type="number"
                        min="1"
                        step="1"
                      />
                    </template>

                    <template v-else-if="draft.loopMode === 'weekly'">
                      <span class="detail-panel__loop-config-label">每周日期</span>
                      <div class="detail-panel__weekday-group" role="radiogroup" aria-label="每周日期">
                        <label
                          v-for="option in LOOP_WEEKDAY_OPTIONS"
                          :key="option.value"
                          class="detail-panel__weekday-option"
                          :class="{
                            'detail-panel__weekday-option--active': draft.weekday === option.value
                          }"
                        >
                          <input
                            v-model="draft.weekday"
                            class="detail-panel__weekday-input"
                            type="radio"
                            name="loop-weekday"
                            :value="option.value"
                          />
                          <span>{{ option.label }}</span>
                        </label>
                      </div>
                    </template>

                    <template v-else-if="draft.loopMode === 'monthly'">
                      <span class="detail-panel__loop-config-label">每月日期</span>
                      <div class="detail-panel__monthday-row">
                        <span class="detail-panel__monthday-prefix">每月</span>
                        <input
                          v-model.number="draft.monthDay"
                          class="text-input detail-panel__monthday-input"
                          type="number"
                          min="1"
                          max="31"
                          step="1"
                        />
                        <span class="detail-panel__monthday-suffix">日</span>
                      </div>
                    </template>
                  </div>
                </div>
              </label>
              <div v-else class="field field--full">
                <span class="field-label">循环方式</span>
                <div class="detail-panel__param-empty">
                  当前事件为“被调用”模式，不参与循环定时扫描；只有通过
                  `invoke_once schedule {{ draft.id || 'event_id' }}` 调用后才会进入事件队列。
                </div>
              </div>
            </div>
          </section>

          <section class="detail-card">
            <div class="detail-grid detail-grid--event-config">
              <StoryEventObjectField
                v-model="draft.selectedObjectKeys"
                :special-options="specialObjectOptions"
                :important-options="importantRoleOptions"
                :normal-options="normalRoleOptions"
                placeholder="搜索并选择对象角色"
                @quick-create="requestQuickCreateRole"
              />

              <div ref="triggerExprField" class="field detail-panel__trigger-config">
                <span class="field-label">触发方式</span>
                <div class="detail-panel__trigger-mode">
                  <label class="detail-panel__trigger-mode-option">
                    <input
                      v-model="draft.triggerMode"
                      class="detail-panel__trigger-mode-input"
                      type="radio"
                      value="default"
                    />
                    <span>默认触发</span>
                  </label>
                  <label class="detail-panel__trigger-mode-option">
                    <input
                      v-model="draft.triggerMode"
                      class="detail-panel__trigger-mode-input"
                      type="radio"
                      value="condition"
                    />
                    <span>条件触发</span>
                  </label>
                  <label class="detail-panel__trigger-mode-option">
                    <input
                      v-model="draft.triggerMode"
                      class="detail-panel__trigger-mode-input"
                      type="radio"
                      value="invoke"
                    />
                    <span>被调用</span>
                  </label>
                </div>

                <template v-if="draft.triggerMode === 'condition'">
                  <div class="detail-panel__label-row">
                    <span class="field-label">触发条件</span>
                    <div class="detail-panel__help">
                      <button
                        class="detail-panel__help-button"
                        type="button"
                        aria-label="查看触发条件说明"
                        @click.stop="toggleTriggerHelp"
                      >
                        ?
                      </button>
                    </div>
                  </div>
                  <div class="detail-panel__expression-wrap">
                    <textarea
                      ref="triggerExprTextarea"
                      v-model="draft.triggerExpr"
                      class="text-area detail-panel__expression"
                      placeholder="${county.gdp} >= 10000000000 && ${county.jiaoyu} >= 60"
                      @input="onTriggerExprInput"
                      @click="updateScriptAutocompleteFromCaret('triggerExpr')"
                      @keyup="updateScriptAutocompleteFromCaret('triggerExpr')"
                      @keydown="onTriggerExprKeydown"
                    />

                    <div
                      v-if="isTriggerAutocompleteOpen"
                      class="detail-panel__autocomplete"
                      :class="{
                        'detail-panel__autocomplete--top':
                          triggerAutocompleteState.placement === 'top'
                      }"
                    >
                      <button
                        v-for="(item, index) in triggerAutocompleteItems"
                        :key="item.name"
                        class="detail-panel__autocomplete-item"
                        :class="{
                          'detail-panel__autocomplete-item--active':
                            index === triggerAutocompleteState.activeIndex
                        }"
                        type="button"
                        @mousedown.prevent="insertScriptAutocompleteItem('triggerExpr', item.name)"
                      >
                        <span class="detail-panel__autocomplete-name">{{ item.name }}</span>
                        <span
                          v-if="item.description"
                          class="detail-panel__autocomplete-description"
                        >
                          {{ item.description }}
                        </span>
                      </button>

                      <div
                        v-if="!triggerAutocompleteItems.length"
                        class="detail-panel__autocomplete-empty"
                      >
                        没有匹配的变量
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="draft.triggerMode === 'invoke'">
                  <div class="detail-panel__label-row">
                    <span class="field-label">调用参数</span>
                    <button
                      class="btn-secondary detail-panel__param-add"
                      type="button"
                      @click="addInvokeParam"
                    >
                      添加参数
                    </button>
                  </div>

                  <div v-if="draft.invokeParams.length" class="detail-panel__param-table">
                    <div class="detail-panel__param-table-head">
                      <span>参数名</span>
                      <span>说明</span>
                      <span>操作</span>
                    </div>

                    <div
                      v-for="param in draft.invokeParams"
                      :key="param.id"
                      class="detail-panel__param-row"
                    >
                      <input
                        v-model="param.name"
                        class="text-input"
                        type="text"
                        placeholder="county_name"
                      />
                      <input
                        v-model="param.descr"
                        class="text-input"
                        type="text"
                        placeholder="调用方需要传什么值"
                      />
                      <button
                        class="btn-secondary detail-panel__param-remove"
                        type="button"
                        @click="removeInvokeParam(param.id)"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <div v-else class="detail-panel__param-empty">
                    这个事件不会自动扫描，只有通过 `invoke_once schedule {{ draft.id || 'event_id' }}`
                    传参后才会入队。
                  </div>
                </template>

                <template v-else>
                  <div class="detail-panel__param-empty">
                    默认触发会按循环方式参与运行时自动调度，不需要填写触发条件。
                  </div>
                </template>
              </div>

              <label ref="initScriptField" class="field">
                <div class="detail-panel__label-row">
                <span class="field-label">初始化脚本</span>
                  <div class="detail-panel__help">
                    <button
                      class="detail-panel__help-button"
                      type="button"
                      aria-label="查看初始化脚本说明"
                      @click.stop="toggleInitScriptHelp"
                    >
                      ?
                    </button>
                  </div>
                </div>
                <div class="detail-panel__script-wrap">
                  <div class="detail-panel__script-editor">
                    <pre class="detail-panel__script-highlight" data-script-highlight aria-hidden="true"><code><template
                          v-for="(token, index) in highlightedInitScriptTokens"
                          :key="`init-${index}`"
                        ><span
                            :class="[
                              'detail-panel__script-token',
                              token.highlighted ? 'detail-panel__script-token--keyword' : ''
                            ]"
                            v-html="token.text || '&nbsp;'"
                          /></template></code></pre>
                    <textarea
                      ref="initScriptTextarea"
                      v-model="draft.initScript"
                      class="text-area detail-panel__script detail-panel__script--overlay"
                      placeholder="let bonus = Math.floor(${county.level} * 2)"
                      spellcheck="false"
                      @input="onInitScriptInput"
                      @scroll="onInitScriptScroll"
                      @click="updateScriptAutocompleteFromCaret('initScript')"
                      @keyup="updateScriptAutocompleteFromCaret('initScript')"
                      @keydown="onInitScriptKeydown"
                    />
                  </div>

                  <div
                    v-if="isInitScriptAutocompleteOpen"
                    class="detail-panel__autocomplete"
                    :class="{
                      'detail-panel__autocomplete--top':
                        initScriptAutocompleteState.placement === 'top'
                    }"
                  >
                    <button
                      v-for="(item, index) in initScriptAutocompleteItems"
                      :key="item.name"
                      class="detail-panel__autocomplete-item"
                      :class="{
                        'detail-panel__autocomplete-item--active':
                          index === initScriptAutocompleteState.activeIndex
                      }"
                      type="button"
                      @mousedown.prevent="insertScriptAutocompleteItem('initScript', item.name)"
                    >
                      <span class="detail-panel__autocomplete-name">{{ item.name }}</span>
                      <span
                        v-if="item.description"
                        class="detail-panel__autocomplete-description"
                      >
                        {{ item.description }}
                      </span>
                    </button>

                    <div
                      v-if="!initScriptAutocompleteItems.length"
                      class="detail-panel__autocomplete-empty"
                    >
                      没有匹配的变量
                    </div>
                  </div>
                </div>
                <span class="detail-panel__script-hint">
                  支持多行、`let` 临时变量、`Math` 函数，以及 `=`、`+=`、`-=`、`*=`、`/=`、`%=` 赋值；可读取 `calc` 变量，但不能给 `calc` 变量赋值。
                </span>
              </label>

              <label ref="endScriptField" class="field">
                <div class="detail-panel__label-row">
                <span class="field-label">结束脚本</span>
                  <div class="detail-panel__help">
                    <button
                      class="detail-panel__help-button"
                      type="button"
                      aria-label="查看结束脚本说明"
                      @click.stop="toggleEndScriptHelp"
                    >
                      ?
                    </button>
                  </div>
                </div>
                <div class="detail-panel__script-wrap">
                  <div class="detail-panel__script-editor">
                    <pre class="detail-panel__script-highlight" data-script-highlight aria-hidden="true"><code><template
                          v-for="(token, index) in highlightedEndScriptTokens"
                          :key="`end-${index}`"
                        ><span
                            :class="[
                              'detail-panel__script-token',
                              token.highlighted ? 'detail-panel__script-token--keyword' : ''
                            ]"
                            v-html="token.text || '&nbsp;'"
                          /></template></code></pre>
                    <textarea
                      ref="endScriptTextarea"
                      v-model="draft.endScript"
                      class="text-area detail-panel__script detail-panel__script--overlay"
                      placeholder="${county.exp} = ${county.exp} + 10"
                      spellcheck="false"
                      @input="onEndScriptInput"
                      @scroll="onEndScriptScroll"
                      @click="updateScriptAutocompleteFromCaret('endScript')"
                      @keyup="updateScriptAutocompleteFromCaret('endScript')"
                      @keydown="onEndScriptKeydown"
                    />
                  </div>

                  <div
                    v-if="isEndScriptAutocompleteOpen"
                    class="detail-panel__autocomplete"
                    :class="{
                      'detail-panel__autocomplete--top':
                        endScriptAutocompleteState.placement === 'top'
                    }"
                  >
                    <button
                      v-for="(item, index) in endScriptAutocompleteItems"
                      :key="item.name"
                      class="detail-panel__autocomplete-item"
                      :class="{
                        'detail-panel__autocomplete-item--active':
                          index === endScriptAutocompleteState.activeIndex
                      }"
                      type="button"
                      @mousedown.prevent="insertScriptAutocompleteItem('endScript', item.name)"
                    >
                      <span class="detail-panel__autocomplete-name">{{ item.name }}</span>
                      <span
                        v-if="item.description"
                        class="detail-panel__autocomplete-description"
                      >
                        {{ item.description }}
                      </span>
                    </button>

                    <div
                      v-if="!endScriptAutocompleteItems.length"
                      class="detail-panel__autocomplete-empty"
                    >
                      没有匹配的变量
                    </div>
                  </div>
                </div>
                <span class="detail-panel__script-hint">
                  支持多行、`let` 临时变量、`Math` 函数，以及 `=`、`+=`、`-=`、`*=`、`/=`、`%=` 赋值；可读取 `calc` 变量，但不能给 `calc` 变量赋值。
                </span>
              </label>
            </div>
          </section>
        </div>

        <aside class="detail-panel__dialogue-card">
          <div class="detail-panel__dialogue-head">
            <div>
              <h3 class="detail-card__title">剧情对白</h3>
              <p class="detail-panel__dialogue-summary">
                当前 {{ draft.dialogues.length }} 条对白。只有右侧列表会滚动。
              </p>
            </div>
            <button class="btn-secondary detail-panel__dialogue-add" type="button" @click="openCreateDialogueEditor">
              添加对白
            </button>
          </div>

          <div v-if="draft.dialogues.length" class="dialogue-list">
            <div class="dialogue-list__table">
              <div class="dialogue-list__table-head">
                <span>排序</span>
                <span>说话人</span>
                <span>对白</span>
                <span>操作</span>
              </div>

              <div
                v-for="(dialogue, index) in draft.dialogues"
                :key="dialogue.id"
                class="dialogue-list__row"
              >
                <div class="dialogue-list__sort">
                  <button
                    class="btn-secondary dialogue-list__icon-btn"
                    type="button"
                    title="上移"
                    :disabled="index === 0"
                    @click="moveDialogue(dialogue.id, -1)"
                  >
                    ↑
                  </button>
                  <button
                    class="btn-secondary dialogue-list__icon-btn"
                    type="button"
                    title="下移"
                    :disabled="index === draft.dialogues.length - 1"
                    @click="moveDialogue(dialogue.id, 1)"
                  >
                    ↓
                  </button>
                </div>

                <div class="dialogue-list__speaker-cell">
                  <span class="dialogue-list__index">{{ index + 1 }}</span>
                  <span class="dialogue-list__speaker">
                    {{
                      dialogue.speaker_type === "player"
                        ? "主角"
                        : (roleOptionMap.get(dialogue.speaker_key)?.label ?? dialogue.speaker_key)
                    }}
                  </span>
                </div>

                <button
                  class="dialogue-list__content-button"
                  type="button"
                  @click="openEditDialogueEditor(dialogue.id)"
                >
                  <span class="dialogue-list__content">
                    {{ dialogue.content.trim() || "点击编辑对白内容" }}
                  </span>
                </button>

                <div class="dialogue-list__actions">
                  <button
                    class="btn-secondary dialogue-list__icon-btn"
                    type="button"
                    title="编辑"
                    @click="openEditDialogueEditor(dialogue.id)"
                  >
                    <svg class="dialogue-list__icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.99-1.66Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                  <button
                    class="btn-secondary dialogue-list__icon-btn dialogue-list__icon-btn--danger"
                    type="button"
                    title="删除"
                    @click="removeDialogue(dialogue.id)"
                  >
                    <svg class="dialogue-list__icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Zm-1 11h12a2 2 0 0 0 2-2V8H4v10a2 2 0 0 0 2 2Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="dialogue-empty">
            还没有对白，点击“添加对白”开始编辑。
          </div>
        </aside>
      </div>

      <div class="detail-panel__footer">
        <button class="btn-secondary detail-panel__close" type="button" @click="emit('close')">
          关闭
        </button>
        <button class="btn-primary detail-panel__submit" type="button" :disabled="saving" @click="submitDraft">
          {{ submitLabel }}
        </button>
      </div>

      <div
        v-if="dialogueEditorState.open"
        class="detail-panel__dialogue-modal"
        @click.self="closeDialogueEditor"
      >
        <section class="detail-panel__dialogue-modal-panel glass-panel">
          <div class="detail-panel__dialogue-modal-head">
            <h3 class="detail-panel__dialogue-modal-title">{{ dialogueEditorTitle }}</h3>
            <button class="btn-secondary" type="button" @click="closeDialogueEditor">关闭</button>
          </div>

          <div class="dialogue-editor__grid">
            <label class="field">
              <span class="field-label">说话人类型</span>
              <select
                v-model="dialogueEditorState.draft.speaker_type"
                class="select-input"
                @change="handleDialogueEditorSpeakerTypeChange"
              >
                <option value="player">主角</option>
                <option value="object">事件对象</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">说话人</span>
              <select v-model="dialogueEditorState.draft.speaker_key" class="select-input">
                <option
                  v-for="option in getDialogueEditorSpeakerOptions()"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>

          <label ref="dialogueContentField" class="field">
            <div class="detail-panel__label-row">
              <span class="field-label">对白</span>
              <div class="detail-panel__help">
                <button
                  class="detail-panel__help-button"
                  type="button"
                  aria-label="查看对白插值说明"
                  @click.stop="toggleDialogueTemplateHelp"
                >
                  ?
                </button>
              </div>
            </div>
            <div class="detail-panel__expression-wrap">
              <textarea
                ref="dialogueContentTextarea"
                v-model="dialogueEditorState.draft.content"
                class="text-area dialogue-editor__content"
                :placeholder="STORY_SCRIPT_TEMPLATE_PLACEHOLDER"
                @input="onDialogueContentInput"
                @click="updateDialogueContentAutocompleteFromCaret"
                @keyup="updateDialogueContentAutocompleteFromCaret"
                @keydown="onDialogueContentKeydown"
              />

              <div
                v-if="isDialogueContentAutocompleteOpen"
                class="detail-panel__autocomplete"
                :class="{
                  'detail-panel__autocomplete--top':
                    dialogueContentAutocompleteState.placement === 'top'
                }"
              >
                <button
                  v-for="(item, index) in dialogueContentAutocompleteItems"
                  :key="item.name"
                  class="detail-panel__autocomplete-item"
                  :class="{
                    'detail-panel__autocomplete-item--active':
                      index === dialogueContentAutocompleteState.activeIndex
                  }"
                  type="button"
                  @mousedown.prevent="insertDialogueContentAutocompleteItem(item.name)"
                >
                  <span class="detail-panel__autocomplete-name">{{ item.name }}</span>
                  <span
                    v-if="item.description"
                    class="detail-panel__autocomplete-description"
                  >
                    {{ item.description }}
                  </span>
                </button>

                <div
                  v-if="!dialogueContentAutocompleteItems.length"
                  class="detail-panel__autocomplete-empty"
                >
                  没有匹配的变量
                </div>
              </div>
            </div>
          </label>

          <div class="detail-panel__dialogue-modal-actions">
            <button class="btn-secondary" type="button" @click="closeDialogueEditor">取消</button>
            <button class="btn-primary" type="button" @click="saveDialogueEditor">保存</button>
          </div>
        </section>
      </div>

      <StoryQuickRoleCreateDialog
        v-if="isQuickRoleDialogOpen"
        :roles="props.roles"
        :saving="props.saving"
        @close="closeQuickRoleDialog"
        @create="submitQuickCreateRole"
      />

      <StoryQuickLocationCreateDialog
        v-if="isQuickLocationDialogOpen"
        :event-locations="props.eventLocations"
        :saving="props.saving"
        @close="closeQuickLocationDialog"
        @create="submitQuickCreateLocation"
      />
    </template>

    <div v-else class="detail-panel__empty">
      请先在画布中选择一个大事件再开始编辑。
    </div>
  </section>
</template>

<style scoped>
.detail-panel {
  width: calc(100vw - 24px);
  max-width: none;
  height: calc(100dvh - 24px);
  max-height: none;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
}

.detail-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.detail-panel__header-copy {
  min-width: 0;
}

.detail-panel__title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.7rem;
}

.detail-panel__close,
.detail-panel__submit {
  min-width: 120px;
}

.detail-panel__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
}

.detail-panel__workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(380px, 0.9fr);
  gap: 14px;
  overflow: hidden;
}

.detail-panel__main {
  display: grid;
  grid-template-rows: auto auto auto;
  gap: 14px;
  min-height: 0;
  overflow: hidden;
}

.detail-card,
.detail-panel__dialogue-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.025);
  min-height: 0;
}

.detail-card__title {
  margin: 0;
  font-size: 1rem;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.field--full {
  grid-column: 1 / -1;
}

.detail-grid--event-config {
  align-items: start;
}

.field--full .select-input[multiple] {
  min-height: 160px;
}

.detail-panel__loop-row {
  display: grid;
  grid-template-columns: minmax(160px, 240px) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.detail-panel__loop-mode {
  min-width: 0;
}

.detail-panel__loop-config {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.detail-panel__loop-config-label {
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.35;
}

.detail-panel__loop-interval {
  max-width: 220px;
}

.detail-panel__weekday-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-panel__weekday-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease;
}

.detail-panel__weekday-option--active {
  border-color: rgba(255, 180, 84, 0.42);
  background: rgba(255, 180, 84, 0.12);
  color: var(--accent);
}

.detail-panel__weekday-input {
  margin: 0;
}

.detail-panel__monthday-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-panel__monthday-prefix,
.detail-panel__monthday-suffix {
  color: var(--text-muted);
  font-size: 0.92rem;
}

.detail-panel__monthday-input {
  width: 92px;
}

.detail-panel__dialogue-card {
  grid-template-rows: auto minmax(0, 1fr);
}

.detail-panel__dialogue-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail-panel__dialogue-summary {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 0.84rem;
  line-height: 1.45;
}

.detail-panel__dialogue-add {
  min-height: 32px;
  white-space: nowrap;
}

.detail-panel__trigger-config {
  display: grid;
  gap: 12px;
  align-content: start;
}

.detail-panel__trigger-mode {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.detail-panel__trigger-mode-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
}

.detail-panel__trigger-mode-input {
  margin: 0;
}

.detail-panel__label-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-panel__help {
  position: relative;
}

.detail-panel__help-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid rgba(255, 180, 84, 0.32);
  border-radius: 999px;
  background: rgba(255, 180, 84, 0.1);
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
}

.detail-panel__expression-wrap {
  position: relative;
}

.detail-panel__param-add {
  margin-left: auto;
  min-height: 30px;
}

.detail-panel__param-table {
  display: grid;
  gap: 8px;
}

.detail-panel__param-table-head,
.detail-panel__param-row {
  display: grid;
  grid-template-columns: minmax(140px, 0.8fr) minmax(0, 1.2fr) 72px;
  gap: 10px;
  align-items: center;
}

.detail-panel__param-table-head {
  padding: 0 2px;
  color: var(--text-dim);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
}

.detail-panel__param-remove {
  min-width: 72px;
  min-height: 34px;
}

.detail-panel__param-empty {
  padding: 14px 16px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-muted);
  line-height: 1.5;
}

.detail-panel__script-wrap {
  position: relative;
}

.detail-panel__script-editor {
  position: relative;
}

.detail-panel__script-highlight,
.detail-panel__script {
  min-height: 118px;
  max-height: 118px;
  margin: 0;
  overflow: auto;
  font: inherit;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  tab-size: 2;
}

.detail-panel__script-highlight {
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.86);
  pointer-events: none;
}

.detail-panel__script-highlight code {
  font: inherit;
}

.detail-panel__script-token--keyword {
  color: #63a9ff;
}

.detail-panel__expression {
  min-height: 128px;
  max-height: 128px;
}

.detail-panel__autocomplete {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 10;
  max-height: 220px;
  overflow-y: auto;
  display: grid;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(10, 24, 37, 0.98);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.28);
}

.detail-panel__autocomplete--top {
  top: auto;
  bottom: calc(100% + 8px);
}

.detail-panel__autocomplete-item {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: transparent;
  color: var(--text);
  text-align: left;
}

.detail-panel__autocomplete-item:last-child {
  border-bottom: none;
}

.detail-panel__autocomplete-item--active {
  background: rgba(255, 180, 84, 0.12);
}

.detail-panel__autocomplete-name {
  font-weight: 600;
}

.detail-panel__autocomplete-description {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.detail-panel__autocomplete-empty {
  padding: 12px;
  color: var(--text-muted);
  text-align: center;
}

.detail-panel__script--overlay {
  position: absolute;
  inset: 0;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
}

.detail-panel__script--overlay::selection {
  background: rgba(99, 169, 255, 0.28);
}

.detail-panel__script--overlay::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.detail-panel__script-hint {
  display: none;
}

.dialogue-list {
  min-height: 0;
  overflow-y: auto;
  padding-right: 6px;
}

.dialogue-list__table {
  display: grid;
  gap: 6px;
}

.dialogue-list__table-head,
.dialogue-list__row {
  display: grid;
  grid-template-columns: 72px minmax(120px, 180px) minmax(0, 1fr) 88px;
  gap: 10px;
  align-items: center;
}

.dialogue-list__table-head {
  padding: 0 10px 6px;
  color: var(--text-dim);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
}

.dialogue-list__row {
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.025);
}

.dialogue-list__sort {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.dialogue-list__icon-btn {
  min-width: 30px;
  width: 30px;
  min-height: 30px;
  height: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  font-size: 0.92rem;
}

.dialogue-list__icon-btn--danger {
  color: rgba(255, 191, 182, 0.96);
  background: rgba(255, 139, 123, 0.12);
}

.dialogue-list__speaker-cell {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.dialogue-list__content-button {
  min-width: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.dialogue-list__index {
  font-weight: 700;
  font-size: 0.76rem;
  color: var(--text-dim);
}

.dialogue-list__speaker {
  color: var(--accent);
  font-size: 0.84rem;
}

.dialogue-list__content {
  color: var(--text-muted);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.dialogue-list__actions {
  display: inline-flex;
  gap: 6px;
  justify-content: flex-end;
}

.dialogue-list__icon {
  width: 14px;
  height: 14px;
}

.detail-panel__dialogue-modal {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.detail-panel__dialogue-modal-panel {
  width: min(840px, calc(100vw - 40px));
  padding: 20px;
  border-radius: 22px;
  display: grid;
  gap: 16px;
}

.detail-panel__dialogue-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail-panel__dialogue-modal-title {
  margin: 0;
  font-size: 1.1rem;
}

.dialogue-editor__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.dialogue-editor__content {
  min-height: 220px;
}

.detail-panel__dialogue-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.dialogue-empty,
.detail-panel__empty {
  display: grid;
  place-items: center;
  min-height: 240px;
  border: 1px dashed var(--line);
  border-radius: 18px;
  color: var(--text-muted);
  text-align: center;
}

.detail-panel :deep(.text-input),
.detail-panel :deep(.text-area),
.detail-panel :deep(.select-input) {
  background: rgba(255, 255, 255, 0.04);
}

@media (max-width: 1280px) {
  .detail-panel__workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .detail-panel__main {
    grid-template-rows: auto auto auto;
  }
}

@media (max-width: 900px) {
  .detail-panel {
    width: calc(100vw - 8px);
    height: calc(100dvh - 8px);
    padding: 10px;
  }

  .detail-panel__header,
  .detail-panel__dialogue-head,
  .detail-panel__dialogue-modal-head {
    flex-direction: column;
    align-items: stretch;
  }

  .detail-panel__footer {
    width: 100%;
    justify-content: stretch;
  }

  .detail-grid,
  .dialogue-editor__grid,
  .detail-panel__loop-row {
    grid-template-columns: 1fr;
  }

  .dialogue-list__row {
    grid-template-columns: 1fr;
  }

  .dialogue-list__table-head {
    display: none;
  }

  .dialogue-list__sort,
  .dialogue-list__actions {
    justify-content: start;
  }
}
</style>
