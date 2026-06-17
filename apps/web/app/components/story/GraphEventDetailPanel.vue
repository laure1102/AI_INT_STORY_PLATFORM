<script setup lang="ts">
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
import StoryEventLocationField from "./StoryEventLocationField.vue"
import StoryEventObjectField from "./StoryEventObjectField.vue"
import StoryQuickLocationCreateDialog from "./StoryQuickLocationCreateDialog.vue"
import StoryQuickRoleCreateDialog from "./StoryQuickRoleCreateDialog.vue"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"
import StoryDialogueAiDialog from "./StoryDialogueAiDialog.vue"
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

interface DialogueEditorDraft {
  speaker_type: StoryOnceDialogueDefinition["speaker_type"]
  speaker_key: string
  content: string
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

interface RoleOption {
  key: string
  label: string
}

const PLAYER_OBJECT_OPTION: RoleOption = {
  key: "player",
  label: "主角"
}

interface GraphNodeOption {
  id: string
  title: string
  type: "event" | "action"
}

type ScriptFieldKey = "triggerExpr" | "initScript" | "endScript"
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

const props = defineProps<{
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
}>()

const emit = defineEmits<{
  close: []
  quickCreateLocation: [payload: StoryQuickCreateLocationPayload]
  quickCreateRole: [payload: StoryQuickCreateRolePayload]
  save: [event: StoryEventFile]
}>()

const { generateStoryDialogue } = useStoryApi()

const activeTab = shallowRef<"basic" | "next">("basic")

const triggerExprFieldRef = useTemplateRef<HTMLDivElement>("triggerExprField")
const triggerExprTextareaRef = useTemplateRef<HTMLTextAreaElement>("triggerExprTextarea")
const initScriptFieldRef = useTemplateRef<HTMLDivElement>("initScriptField")
const initScriptTextareaRef = useTemplateRef<HTMLTextAreaElement>("initScriptTextarea")
const endScriptFieldRef = useTemplateRef<HTMLDivElement>("endScriptField")
const endScriptTextareaRef = useTemplateRef<HTMLTextAreaElement>("endScriptTextarea")
const dialogueContentFieldRef = useTemplateRef<HTMLElement>("dialogueContentField")
const dialogueContentTextareaRef = useTemplateRef<HTMLTextAreaElement>("dialogueContentTextarea")
const isQuickLocationDialogOpen = shallowRef(false)
const pendingQuickLocationName = shallowRef<string | null>(null)
const isQuickRoleDialogOpen = shallowRef(false)
const pendingQuickRoleKey = shallowRef<string | null>(null)
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
const dialogueContentAutocompleteState = reactive<ScriptAutocompleteState>({
  open: false,
  query: "",
  replaceStart: 0,
  replaceEnd: 0,
  activeIndex: 0,
  placement: "bottom"
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

let dialogueIdSeed = 0
let invokeParamIdSeed = 0

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
let dialogueAiAbortController: AbortController | null = null

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
const globalAutocompleteCandidates = computed(() => {
  return mergeStoryScriptAutocompleteItems(
    buildStoryScriptBuiltinAutocompleteItems(),
    buildStoryScriptValAutocompleteItems(props.vals),
    buildStoryReferAutocompleteItems(props.story)
  )
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
const triggerAutocompleteCandidates = computed(() => {
  return mergeStoryScriptAutocompleteItems(
    globalAutocompleteCandidates.value,
    props.branchAutocompleteItems ?? []
  )
})
const scriptAutocompleteCandidates = computed(() => {
  return mergeStoryScriptAutocompleteItems(
    triggerAutocompleteCandidates.value,
    invokeParamAutocompleteCandidates.value
  )
})
const invokeAutocompleteContext = computed(() => {
  return buildStoryScriptInvokeAutocompleteContext(props.story)
})
const triggerAutocompleteItems = computed(() => {
  return filterStoryScriptAutocompleteItems(
    triggerAutocompleteState.query,
    triggerAutocompleteCandidates.value
  )
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

const panelTitle = computed(() => {
  if (draft.title.trim()) {
    return draft.title.trim()
  }

  return props.mode === "create" ? "未命名剧情事件" : (props.event?.title ?? "普通剧情事件")
})

const submitLabel = computed(() => {
  if (props.saving) {
    return "保存中..."
  }

  return "保存"
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


function normalizeObjectKeys(objectKeys: string[]) {
  return Array.from(new Set(objectKeys.map((roleKey) => roleKey.trim()).filter(Boolean)))
}

function normalizeAutocompleteText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeDraftTriggerMode(event: StoryEventFile | null): StoryEventTriggerMode {
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
  pendingQuickLocationName.value = payload.id
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

function getBranchValidationTokens() {
  return (props.branchAutocompleteItems ?? [])
    .map((item) => normalizeAutocompleteText(item.name))
    .filter(Boolean)
}

function getInvokeParamValidationTokens() {
  return invokeParamAutocompleteCandidates.value
    .map((item) => normalizeAutocompleteText(item.name))
    .filter(Boolean)
}

function getReadableValidationTokens(field: ScriptFieldKey) {
  if (field === "triggerExpr") {
    return getBranchValidationTokens()
  }

  return [
    ...getBranchValidationTokens(),
    ...getInvokeParamValidationTokens()
  ]
}

function getWritableValidationTokens(field: ScriptFieldKey) {
  if (field === "triggerExpr") {
    return []
  }

  return getBranchValidationTokens()
}

function resetScriptValidation(field?: ScriptFieldKey) {
  const fields = field ? [field] : (["triggerExpr", "initScript", "endScript"] as const)

  for (const currentField of fields) {
    scriptValidationState[currentField].status = "idle"
    scriptValidationState[currentField].issues = []
  }
}

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

function getScriptValidationMessage(field: ScriptFieldKey) {
  if (scriptValidationState[field].status !== "passed") {
    return ""
  }

  if (!getScriptFieldValue(field).trim()) {
    return field === "triggerExpr" ? "空条件，无需校验。" : "空脚本，无需校验。"
  }

  return field === "triggerExpr" ? "触发条件可以执行。" : "脚本可以执行。"
}

function getScriptValidationClass(field: ScriptFieldKey) {
  return `detail-panel__validation--${scriptValidationState[field].status}`
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
  state.mode = "placeholder"
  state.commandItems = []
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

function onTriggerExprInput() {
  resetScriptValidation("triggerExpr")
  updateScriptAutocompleteFromCaret("triggerExpr")
}

function onTriggerExprKeydown(event: KeyboardEvent) {
  onScriptFieldKeydown("triggerExpr", event)
}

function onInitScriptInput() {
  resetScriptValidation("initScript")
  updateScriptAutocompleteFromCaret("initScript")
}

function onInitScriptKeydown(event: KeyboardEvent) {
  onScriptFieldKeydown("initScript", event)
}

function onInitScriptScroll(event: Event) {
  syncScriptEditorScroll("initScript", event)
}

function onEndScriptInput() {
  resetScriptValidation("endScript")
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

function openDialogueAiDialog() {
  dialogueAiError.value = null
  dialogueAiResult.value = null
  dialogueAiPrompt.value = ""
  isDialogueAiDialogOpen.value = true
}

function closeDialogueAiDialog() {
  if (dialogueAiLoading.value) {
    return
  }

  isDialogueAiDialogOpen.value = false
}

function abortDialogueAi() {
  dialogueAiAbortController?.abort()
}

async function runDialogueAi() {
  const eventDraft = buildDialogueEventDraft()

  if (!eventDraft || eventDraft.presentation.type !== "dialogue") {
    return
  }

  dialogueAiLoading.value = true
  dialogueAiError.value = null
  dialogueAiAbortController = new AbortController()

  try {
    dialogueAiResult.value = await generateStoryDialogue(
      useRoute().params.storyId as string,
      {
        collectionType: "chain",
        event: eventDraft,
        instruction: dialogueAiPrompt.value
      },
      dialogueAiAbortController.signal
    )
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
      dialogueAiError.value = "已中止。"
    } else {
      dialogueAiError.value = error instanceof Error ? error.message : "AI 补对白失败。"
    }
  } finally {
    dialogueAiLoading.value = false
    dialogueAiAbortController = null
  }
}

function applyDialogueAiResult(dialogues: StoryOnceDialogueDefinition[]) {
  draft.dialogues = dialogues.map((dialogue) => cloneDialogue(dialogue))
  isDialogueAiDialogOpen.value = false
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
  dialogueAiAbortController?.abort()
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

      <div class="detail-panel__tabs" role="tablist" aria-label="普通剧情事件编辑标签">
        <button
          class="detail-panel__tab"
          :class="{ 'detail-panel__tab--active': activeTab === 'basic' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'basic'"
          @click="activeTab = 'basic'"
        >
          基础信息
        </button>
        <button
          class="detail-panel__tab"
          :class="{ 'detail-panel__tab--active': activeTab === 'next' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'next'"
          @click="activeTab = 'next'"
        >
          后续节点
        </button>
      </div>

      <div v-if="activeTab === 'basic'" class="detail-panel__workspace">
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
                    <button
                      class="detail-panel__validate-button"
                      type="button"
                      :disabled="scriptValidationState.triggerExpr.status === 'checking'"
                      @click.stop="validateScriptField('triggerExpr')"
                    >
                      {{
                        scriptValidationState.triggerExpr.status === "checking"
                          ? "校验中"
                          : "校验"
                      }}
                    </button>
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
                  <div
                    v-if="scriptValidationState.triggerExpr.status !== 'idle'"
                    class="detail-panel__validation"
                    :class="getScriptValidationClass('triggerExpr')"
                  >
                    <strong class="detail-panel__validation-title">
                      {{ getScriptValidationLabel("triggerExpr") }}
                    </strong>
                    <span
                      v-if="!scriptValidationState.triggerExpr.issues.length"
                      class="detail-panel__validation-message"
                    >
                      {{ getScriptValidationMessage("triggerExpr") }}
                    </span>
                    <ul v-else class="detail-panel__validation-list">
                      <li
                        v-for="issue in scriptValidationState.triggerExpr.issues"
                        :key="issue"
                      >
                        {{ issue }}
                      </li>
                    </ul>
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
                    这个事件不会自动扫描，只有通过 `invoke_once chain {{ draft.id || 'event_id' }}`
                    传参后才会入队。
                  </div>
                </template>

                <template v-else>
                  <div class="detail-panel__param-empty">
                    默认触发会参与运行时自动扫描，不需要填写触发条件。
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
                  <button
                    class="detail-panel__validate-button"
                    type="button"
                    :disabled="scriptValidationState.initScript.status === 'checking'"
                    @click.stop="validateScriptField('initScript')"
                  >
                    {{
                      scriptValidationState.initScript.status === "checking"
                        ? "校验中"
                        : "校验"
                    }}
                  </button>
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
                <div
                  v-if="activeInitScriptCommandDetail?.detailTitle || activeInitScriptCommandDetail?.detailLines?.length"
                  class="detail-panel__autocomplete-detail"
                >
                  <strong
                    v-if="activeInitScriptCommandDetail?.detailTitle"
                    class="detail-panel__autocomplete-detail-title"
                  >
                    {{ activeInitScriptCommandDetail.detailTitle }}
                  </strong>
                  <ul
                    v-if="activeInitScriptCommandDetail?.detailLines?.length"
                    class="detail-panel__autocomplete-detail-list"
                  >
                    <li
                      v-for="line in activeInitScriptCommandDetail.detailLines"
                      :key="line"
                    >
                      {{ line }}
                    </li>
                  </ul>
                </div>
                <div
                  v-if="scriptValidationState.initScript.status !== 'idle'"
                  class="detail-panel__validation"
                  :class="getScriptValidationClass('initScript')"
                >
                  <strong class="detail-panel__validation-title">
                    {{ getScriptValidationLabel("initScript") }}
                  </strong>
                  <span
                    v-if="!scriptValidationState.initScript.issues.length"
                    class="detail-panel__validation-message"
                  >
                    {{ getScriptValidationMessage("initScript") }}
                  </span>
                  <ul v-else class="detail-panel__validation-list">
                    <li
                      v-for="issue in scriptValidationState.initScript.issues"
                      :key="issue"
                    >
                      {{ issue }}
                    </li>
                  </ul>
                </div>
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
                  <button
                    class="detail-panel__validate-button"
                    type="button"
                    :disabled="scriptValidationState.endScript.status === 'checking'"
                    @click.stop="validateScriptField('endScript')"
                  >
                    {{
                      scriptValidationState.endScript.status === "checking"
                        ? "校验中"
                        : "校验"
                    }}
                  </button>
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
                      placeholder="${county.exp} += 10"
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
                <div
                  v-if="activeEndScriptCommandDetail?.detailTitle || activeEndScriptCommandDetail?.detailLines?.length"
                  class="detail-panel__autocomplete-detail"
                >
                  <strong
                    v-if="activeEndScriptCommandDetail?.detailTitle"
                    class="detail-panel__autocomplete-detail-title"
                  >
                    {{ activeEndScriptCommandDetail.detailTitle }}
                  </strong>
                  <ul
                    v-if="activeEndScriptCommandDetail?.detailLines?.length"
                    class="detail-panel__autocomplete-detail-list"
                  >
                    <li
                      v-for="line in activeEndScriptCommandDetail.detailLines"
                      :key="line"
                    >
                      {{ line }}
                    </li>
                  </ul>
                </div>
                <div
                  v-if="scriptValidationState.endScript.status !== 'idle'"
                  class="detail-panel__validation"
                  :class="getScriptValidationClass('endScript')"
                >
                  <strong class="detail-panel__validation-title">
                    {{ getScriptValidationLabel("endScript") }}
                  </strong>
                  <span
                    v-if="!scriptValidationState.endScript.issues.length"
                    class="detail-panel__validation-message"
                  >
                    {{ getScriptValidationMessage("endScript") }}
                  </span>
                  <ul v-else class="detail-panel__validation-list">
                    <li
                      v-for="issue in scriptValidationState.endScript.issues"
                      :key="issue"
                    >
                      {{ issue }}
                    </li>
                  </ul>
                </div>
              </label>
            </div>
          </section>
        </div>

        <aside class="detail-panel__dialogue-card">
          <div class="detail-panel__dialogue-head">
            <div>
              <h3 class="detail-card__title">事件表现</h3>
              <p class="detail-panel__dialogue-summary">
                {{
                  draft.presentationType === "silent"
                    ? "静默执行脚本，不显示客户端内容。"
                    : draft.presentationType === "message"
                      ? "显示一段短消息，随后自动继续。"
                      : `当前 ${draft.dialogues.length} 条对白。只有右侧列表会滚动。`
                }}
              </p>
            </div>
            <div v-if="draft.presentationType === 'dialogue'" class="detail-panel__dialogue-head-actions">
              <button
                class="btn-secondary detail-panel__dialogue-add"
                type="button"
                @click="openDialogueAiDialog"
              >
                AI 补对白
              </button>
              <button
                class="btn-secondary detail-panel__dialogue-add"
                type="button"
                @click="openCreateDialogueEditor"
              >
                添加对白
              </button>
            </div>
          </div>

          <div class="detail-panel__presentation-mode">
            <label class="detail-panel__trigger-mode-option">
              <input v-model="draft.presentationType" type="radio" value="silent" />
              <span>静默执行</span>
            </label>
            <label class="detail-panel__trigger-mode-option">
              <input v-model="draft.presentationType" type="radio" value="message" />
              <span>消息提示</span>
            </label>
            <label class="detail-panel__trigger-mode-option">
              <input v-model="draft.presentationType" type="radio" value="dialogue" />
              <span>对白</span>
            </label>
          </div>

          <div v-if="draft.presentationType === 'silent'" class="detail-panel__presentation-empty">
            静默执行事件只运行初始化脚本、结束脚本和后续推进。
          </div>

          <div v-else-if="draft.presentationType === 'message'" class="detail-panel__message-fields">
            <label class="field">
              <span class="field-label">提示消息</span>
              <textarea
                v-model="draft.messageContent"
                class="text-area detail-panel__message-text"
                placeholder="昨日人口流动统计已完成。"
              />
            </label>
            <label class="field">
              <span class="field-label">显示秒数</span>
              <input
                v-model.number="draft.messageDurationSeconds"
                class="text-input"
                min="0"
                step="0.5"
                type="number"
              />
            </label>
          </div>

          <div v-else-if="draft.dialogues.length" class="dialogue-list">
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

      <div v-else class="detail-panel__next-tab">
        <section class="detail-card">
          <div class="detail-card__head">
            <div class="detail-panel__next-heading">
              <h3 class="detail-card__title">后续节点</h3>
              <span class="detail-panel__next-summary">管理这个节点当前已经连接出去的分支</span>
            </div>
          </div>

          <div v-if="linkedNextNodes.length" class="detail-panel__next-list">
            <div v-for="node in linkedNextNodes" :key="node.id" class="detail-panel__next-item">
              <div class="detail-panel__next-copy">
                <div class="detail-panel__next-meta">
                  <span class="detail-panel__next-type">
                    {{ node.type === "action" ? "操作" : "事件" }}
                  </span>
                  <span class="detail-panel__next-id">{{ node.id }}</span>
                </div>
                <strong>{{ node.title }}</strong>
              </div>
              <button
                class="detail-panel__next-remove"
                type="button"
                @click="removeNextNode(node.id)"
              >
                删除
              </button>
            </div>
          </div>
          <div v-else class="dialogue-empty">当前还没有后续节点</div>
        </section>
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

      <StoryDialogueAiDialog
        :open="isDialogueAiDialogOpen"
        :event="buildDialogueEventDraft() ?? event"
        collection-type="chain"
        :roles="props.roles"
        :loading="dialogueAiLoading"
        :prompt="dialogueAiPrompt"
        :result="dialogueAiResult"
        :error-message="dialogueAiError"
        @close="closeDialogueAiDialog"
        @update-prompt="dialogueAiPrompt = $event"
        @run="runDialogueAi"
        @abort="abortDialogueAi"
        @apply="applyDialogueAiResult"
      />
    </template>

    <div v-else class="detail-panel__empty">
      请先在画布中选择一个事件再开始编辑。
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

.detail-panel__tabs {
  display: inline-flex;
  align-items: flex-end;
  gap: 0;
  padding: 4px 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}

.detail-panel__tab {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 12px 12px 0 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transform: translateY(1px);
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.detail-panel__tab--active {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(8, 15, 26, 0.92);
  color: var(--text-main);
  box-shadow: inset 0 2px 0 rgba(124, 227, 195, 0.5);
}

.detail-panel__tab:hover:not(.detail-panel__tab--active) {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-main);
}

.detail-panel__header-copy {
  min-width: 0;
}

.detail-panel__title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.7rem;
}

.detail-panel__callout {
  margin: 8px 0 0;
  padding: 12px 14px;
  border: 1px solid rgba(124, 227, 195, 0.32);
  border-radius: 14px;
  background: rgba(124, 227, 195, 0.08);
  color: var(--text-muted);
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

.detail-panel__next-tab {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  gap: 14px;
  overflow: auto;
  padding-right: 2px;
}

.detail-panel__main {
  display: grid;
  grid-template-rows: auto auto;
  gap: 14px;
  min-height: 0;
  overflow: hidden;
}

.detail-card,
.detail-panel__dialogue-card {
  display: flex;
  flex-direction: column;
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

.detail-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.detail-panel__next-summary {
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

.detail-panel__next-heading {
  display: grid;
  gap: 4px;
}

.detail-panel__next-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.detail-panel__next-item,
.detail-panel__next-picker {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
    rgba(7, 13, 23, 0.72);
}

.detail-panel__next-picker {
  width: 100%;
  text-align: left;
  color: var(--text-main);
  cursor: pointer;
}

.detail-panel__next-copy,
.detail-panel__next-picker {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.detail-panel__next-copy span,
.detail-panel__next-picker span {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.detail-panel__next-copy strong {
  font-size: 0.95rem;
  line-height: 1.35;
}

.detail-panel__next-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-panel__next-type {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(124, 227, 195, 0.24);
  border-radius: 999px;
  background: rgba(124, 227, 195, 0.1);
  color: #c8fff0;
  font-size: 0.72rem;
  line-height: 1;
}

.detail-panel__next-id {
  color: var(--text-dim);
  font-size: 0.74rem;
  font-family: "IBM Plex Mono", "Fira Code", monospace;
  word-break: break-all;
}

.detail-panel__next-remove {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(255, 122, 122, 0.2);
  border-radius: 10px;
  background: rgba(255, 122, 122, 0.08);
  color: #ffd1d1;
  cursor: pointer;
}

.detail-panel__next-remove:hover {
  background: rgba(255, 122, 122, 0.14);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.detail-grid--event-config {
  align-items: start;
}

.field--full {
  grid-column: 1 / -1;
}

.detail-panel__dialogue-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail-panel__dialogue-head-actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
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

.detail-panel__presentation-mode {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.detail-panel__presentation-mode > .detail-panel__trigger-mode-option {
  flex: 0 0 auto;
  height: 36px;
  min-height: 36px;
  white-space: nowrap;
}

.detail-panel__message-fields {
  display: grid;
  gap: 12px;
  align-content: start;
}

.detail-panel__message-text {
  min-height: 180px;
}

.detail-panel__presentation-empty {
  color: var(--text-muted);
  line-height: 1.5;
  padding: 2px 0 0;
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

.detail-panel__validate-button {
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(99, 169, 255, 0.34);
  border-radius: 6px;
  background: rgba(99, 169, 255, 0.1);
  color: #a8d1ff;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 700;
}

.detail-panel__validate-button:disabled {
  cursor: wait;
  opacity: 0.7;
}

.detail-panel__validation {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 0.82rem;
  line-height: 1.45;
}

.detail-panel__validation--checking {
  border-color: rgba(99, 169, 255, 0.24);
  color: #a8d1ff;
}

.detail-panel__validation--passed {
  border-color: rgba(82, 211, 145, 0.28);
  color: #9ee6bd;
}

.detail-panel__validation--failed {
  border-color: rgba(255, 111, 111, 0.34);
  color: #ffb1b1;
}

.detail-panel__validation-title {
  font-size: 0.82rem;
}

.detail-panel__validation-message {
  color: inherit;
}

.detail-panel__validation-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}

.detail-panel__expression-wrap,
.detail-panel__script-wrap,
.detail-panel__script-editor {
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

.detail-panel__expression {
  min-height: 128px;
  max-height: 128px;
}

.detail-panel__links {
  min-height: 124px;
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

.detail-panel__autocomplete-detail {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-muted);
  display: grid;
  gap: 6px;
}

.detail-panel__autocomplete-detail-title {
  color: var(--text);
  font-size: 0.8rem;
  font-weight: 600;
}

.detail-panel__autocomplete-detail-list {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 0.78rem;
  line-height: 1.45;
}

.dialogue-list {
  flex: 1 1 auto;
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
    grid-template-rows: auto auto;
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
  .dialogue-editor__grid {
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
