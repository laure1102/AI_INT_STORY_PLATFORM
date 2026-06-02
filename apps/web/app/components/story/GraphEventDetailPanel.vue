<script setup lang="ts">
import {
  buildStoryRoleKey,
  findStoryRoleReference,
  type StoryBigOnceDialogueDefinition,
  type StoryEventFile,
  type StoryEventLocationFile,
  type StoryRolesFile,
  type StoryValsFile
} from "@story-mgr/core"
import StoryEventLocationField from "./StoryEventLocationField.vue"
import StoryEventObjectField from "./StoryEventObjectField.vue"
import StoryQuickLocationCreateDialog from "./StoryQuickLocationCreateDialog.vue"
import StoryQuickRoleCreateDialog from "./StoryQuickRoleCreateDialog.vue"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"

interface DialogueDraft extends StoryBigOnceDialogueDefinition {
  id: string
}

interface DialogueEditorDraft {
  speaker_type: StoryBigOnceDialogueDefinition["speaker_type"]
  speaker_key: string
  content: string
}

interface GraphEventDraft {
  id: string
  title: string
  triggerExpr: string
  initScript: string
  dialogues: DialogueDraft[]
  selectedObjectKeys: string[]
  location: string
}

interface RoleOption {
  key: string
  label: string
}

interface TriggerAutocompleteItem {
  name: string
  description: string
}

interface GraphNodeOption {
  id: string
  title: string
  type: "event" | "action"
}

type ScriptFieldKey = "triggerExpr" | "initScript"

interface ScriptAutocompleteState {
  open: boolean
  query: string
  replaceStart: number
  replaceEnd: number
  activeIndex: number
}

interface ScriptHighlightToken {
  text: string
  highlighted: boolean
}

const SCRIPT_HIGHLIGHT_PATTERN =
  /\b(let|true|false|null)\b|\bMath\b|\b(?:abs|acos|asin|atan2|atan|ceil|clamp|cos|exp|floor|log10|log2|log|max|min|pow|round|sign|sin|sqrt|tan|trunc)\b(?=\s*\()/g

const props = defineProps<{
  event: StoryEventFile | null
  eventLocations: StoryEventLocationFile
  graphNodeOptions: GraphNodeOption[]
  mode?: "create" | "edit"
  parentEventId?: string | null
  roles: StoryRolesFile
  saving: boolean
  vals: StoryValsFile
}>()

const emit = defineEmits<{
  close: []
  quickCreateLocation: [payload: StoryQuickCreateLocationPayload]
  quickCreateRole: [payload: StoryQuickCreateRolePayload]
  save: [event: StoryEventFile]
}>()

const activeTab = shallowRef<"basic" | "next">("basic")

const triggerHelpRef = useTemplateRef<HTMLDivElement>("triggerHelp")
const initScriptHelpRef = useTemplateRef<HTMLDivElement>("initScriptHelp")
const triggerExprFieldRef = useTemplateRef<HTMLDivElement>("triggerExprField")
const triggerExprTextareaRef = useTemplateRef<HTMLTextAreaElement>("triggerExprTextarea")
const initScriptFieldRef = useTemplateRef<HTMLDivElement>("initScriptField")
const initScriptTextareaRef = useTemplateRef<HTMLTextAreaElement>("initScriptTextarea")
const isTriggerHelpOpen = shallowRef(false)
const isInitScriptHelpOpen = shallowRef(false)
const isQuickLocationDialogOpen = shallowRef(false)
const pendingQuickLocationName = shallowRef<string | null>(null)
const isQuickRoleDialogOpen = shallowRef(false)
const pendingQuickRoleKey = shallowRef<string | null>(null)
const triggerAutocompleteState = reactive<ScriptAutocompleteState>({
  open: false,
  query: "",
  replaceStart: 0,
  replaceEnd: 0,
  activeIndex: 0
})
const initScriptAutocompleteState = reactive<ScriptAutocompleteState>({
  open: false,
  query: "",
  replaceStart: 0,
  replaceEnd: 0,
  activeIndex: 0
})

let dialogueIdSeed = 0

function createDialogueId() {
  dialogueIdSeed += 1
  return `dialogue-${dialogueIdSeed}`
}

function cloneDialogue(dialogue?: StoryBigOnceDialogueDefinition): DialogueDraft {
  return {
    id: createDialogueId(),
    speaker_type: dialogue?.speaker_type ?? "object",
    speaker_key: dialogue?.speaker_key ?? "",
    content: dialogue?.content ?? ""
  }
}

const draft = reactive<GraphEventDraft>({
  id: "",
  title: "",
  triggerExpr: "",
  initScript: "",
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

const locationOptions = computed(() => {
  return props.eventLocations.assignments.map((assignment) => ({
    value: assignment.name,
    label: assignment.descr.trim()
      ? `${assignment.name} - ${assignment.descr.trim()}`
      : assignment.name
  }))
})

const importantRoleOptions = computed<RoleOption[]>(() => {
  return props.roles.important.roles.map((role) => ({
    key: buildStoryRoleKey("important", role.name),
    label: role.zhiye.trim() ? `${role.name} - ${role.zhiye.trim()}` : role.name
  }))
})

const normalRoleOptions = computed<RoleOption[]>(() => {
  return props.roles.normal.roles.map((role) => ({
    key: buildStoryRoleKey("normal", role.name),
    label: role.zhiye.trim() ? `${role.name} - ${role.zhiye.trim()}` : role.name
  }))
})

const roleOptionMap = computed(() => {
  const entries: Array<[string, RoleOption]> = [
    ...importantRoleOptions.value,
    ...normalRoleOptions.value
  ].map((option) => [option.key, option])

  return new Map(entries)
})

const objectKeyOptions = computed(() => draft.selectedObjectKeys)
const dialogueEditorTitle = computed(() => {
  return dialogueEditorState.mode === "create" ? "新增对白" : "编辑对白"
})
const triggerAutocompleteCandidates = computed<TriggerAutocompleteItem[]>(() => {
  const seen = new Set<string>()

  return props.vals.variables.flatMap((group) => {
    const groupName = normalizeAutocompleteText(group.name)
    const groupDescription = normalizeAutocompleteText(group.description)

    if (!groupName) {
      return []
    }

    return group.vals.flatMap((row) => {
      const rowName = normalizeAutocompleteText(row.name)

      if (!rowName) {
        return []
      }

      const name = `${groupName}.${rowName}`

      if (seen.has(name)) {
        return []
      }

      seen.add(name)

      return [{
        name,
        description: [groupDescription, normalizeAutocompleteText(row.description)]
          .filter(Boolean)
          .join(" / ")
      }]
    })
  })
})
const triggerAutocompleteItems = computed(() => {
  return filterScriptAutocompleteItems(triggerAutocompleteState.query)
})
const initScriptAutocompleteItems = computed(() => {
  return filterScriptAutocompleteItems(initScriptAutocompleteState.query)
})
const highlightedInitScriptTokens = computed(() => {
  return buildScriptHighlightTokens(draft.initScript)
})
const isTriggerAutocompleteOpen = computed(() => triggerAutocompleteState.open)
const isInitScriptAutocompleteOpen = computed(() => initScriptAutocompleteState.open)
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

function filterScriptAutocompleteItems(queryText: string) {
  const query = queryText.trim().toLowerCase()

  if (!query) {
    return triggerAutocompleteCandidates.value
  }

  return triggerAutocompleteCandidates.value.filter((item) => {
    return (
      item.name.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    )
  })
}

function normalizeStoredObjectKeys(objectKeys: string[]) {
  return normalizeObjectKeys(
    objectKeys
      .map((roleKey) => findStoryRoleReference(props.roles, roleKey)?.key ?? roleKey.trim())
      .filter(Boolean)
  )
}

function syncDraft(event: StoryEventFile | null) {
  draft.id = event?.id ?? ""
  draft.title = event?.title ?? ""
  draft.triggerExpr = event?.trigger_expr ?? ""
  draft.initScript = event?.init_script ?? ""
  draft.location = event?.location ?? ""
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

function createDialogueEditorDraft(dialogue?: StoryBigOnceDialogueDefinition): DialogueEditorDraft {
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

  dialogueEditorState.open = true
  dialogueEditorState.mode = "edit"
  dialogueEditorState.dialogueId = dialogueId
  dialogueEditorState.draft = createDialogueEditorDraft(dialogue)
}

function closeDialogueEditor() {
  dialogueEditorState.open = false
  dialogueEditorState.mode = "create"
  dialogueEditorState.dialogueId = ""
  dialogueEditorState.draft = createDialogueEditorDraft()
}

function removeDialogue(dialogueId: string) {
  draft.dialogues = draft.dialogues.filter((dialogue) => dialogue.id !== dialogueId)
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
  pendingQuickLocationName.value = payload.name
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
  isTriggerHelpOpen.value = !isTriggerHelpOpen.value
}

function closeTriggerHelp() {
  isTriggerHelpOpen.value = false
}

function toggleInitScriptHelp() {
  isInitScriptHelpOpen.value = !isInitScriptHelpOpen.value
}

function closeInitScriptHelp() {
  isInitScriptHelpOpen.value = false
}

function escapeScriptHighlightHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function buildScriptHighlightTokens(value: string): ScriptHighlightToken[] {
  const tokens: ScriptHighlightToken[] = []
  let lastIndex = 0

  for (const match of value.matchAll(SCRIPT_HIGHLIGHT_PATTERN)) {
    const matchIndex = match.index ?? 0
    const matchedText = match[0] ?? ""

    if (matchIndex > lastIndex) {
      tokens.push({
        text: escapeScriptHighlightHtml(value.slice(lastIndex, matchIndex)),
        highlighted: false
      })
    }

    tokens.push({
      text: escapeScriptHighlightHtml(matchedText),
      highlighted: true
    })

    lastIndex = matchIndex + matchedText.length
  }

  if (lastIndex < value.length) {
    tokens.push({
      text: escapeScriptHighlightHtml(value.slice(lastIndex)),
      highlighted: false
    })
  }

  if (tokens.length === 0) {
    tokens.push({
      text: "",
      highlighted: false
    })
  }

  return tokens
}

function getScriptAutocompleteState(field: ScriptFieldKey) {
  return field === "triggerExpr" ? triggerAutocompleteState : initScriptAutocompleteState
}

function getScriptAutocompleteItems(field: ScriptFieldKey) {
  return field === "triggerExpr"
    ? triggerAutocompleteItems.value
    : initScriptAutocompleteItems.value
}

function getActiveScriptAutocompleteItem(field: ScriptFieldKey) {
  return field === "triggerExpr"
    ? activeTriggerAutocompleteItem.value
    : activeInitScriptAutocompleteItem.value
}

function getScriptTextareaRef(field: ScriptFieldKey) {
  return field === "triggerExpr" ? triggerExprTextareaRef.value : initScriptTextareaRef.value
}

function getScriptFieldRef(field: ScriptFieldKey) {
  return field === "triggerExpr" ? triggerExprFieldRef.value : initScriptFieldRef.value
}

function getScriptFieldValue(field: ScriptFieldKey) {
  return field === "triggerExpr" ? draft.triggerExpr : draft.initScript
}

function setScriptFieldValue(field: ScriptFieldKey, value: string) {
  if (field === "triggerExpr") {
    draft.triggerExpr = value
    return
  }

  draft.initScript = value
}

function closeScriptAutocomplete(field: ScriptFieldKey) {
  const state = getScriptAutocompleteState(field)
  state.open = false
  state.query = ""
  state.replaceStart = 0
  state.replaceEnd = 0
  state.activeIndex = 0
}

function closeAllScriptAutocomplete() {
  closeScriptAutocomplete("triggerExpr")
  closeScriptAutocomplete("initScript")
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
  const openBraceIndex = beforeCaret.lastIndexOf("{")

  if (openBraceIndex < 0 || beforeCaret.slice(openBraceIndex + 1).includes("}")) {
    closeScriptAutocomplete(field)
    return
  }

  state.open = true
  state.query = beforeCaret.slice(openBraceIndex + 1)
  state.replaceStart = openBraceIndex
  state.replaceEnd = caret

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
    getScriptFieldValue(field).slice(0, replaceStart + 1) +
    itemName +
    "}" +
    getScriptFieldValue(field).slice(state.replaceEnd)

  setScriptFieldValue(field, nextValue)
  closeScriptAutocomplete(field)

  requestAnimationFrame(() => {
    const nextCaret = replaceStart + itemName.length + 2
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
  syncScriptEditorScroll(event)
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

function syncScriptEditorScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement | null
  const highlightElement = initScriptFieldRef.value?.querySelector<HTMLElement>("[data-script-highlight]")

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

  emit("save", {
    ...props.event,
    id: draft.id.trim(),
    title: draft.title.trim(),
    trigger_expr: draft.triggerExpr.trim(),
    init_script: draft.initScript.trim(),
    object_keys: normalizeObjectKeys(draft.selectedObjectKeys),
    dialogues: draft.dialogues.map((dialogue) => ({
      speaker_type: dialogue.speaker_type,
      speaker_key: dialogue.speaker_key.trim(),
      content: dialogue.content.trim()
    })),
    location: draft.location.trim(),
    next: props.event.next
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
    closeTriggerHelp()
    closeInitScriptHelp()
    activeTab.value = "basic"
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
})

function handleDocumentPointerDown(event: MouseEvent) {
  const target = event.target as Node | null

  if (isTriggerHelpOpen.value) {
    const helpElement = triggerHelpRef.value

    if (helpElement && target && !helpElement.contains(target)) {
      closeTriggerHelp()
    }
  }

  if (isInitScriptHelpOpen.value) {
    const helpElement = initScriptHelpRef.value

    if (helpElement && target && !helpElement.contains(target)) {
      closeInitScriptHelp()
    }
  }

  if (!isTriggerAutocompleteOpen.value && !isInitScriptAutocompleteOpen.value) {
    return
  }

  for (const field of ["triggerExpr", "initScript"] as const) {
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
                :important-options="importantRoleOptions"
                :normal-options="normalRoleOptions"
                placeholder="搜索并选择对象角色"
                @quick-create="requestQuickCreateRole"
              />

              <div ref="triggerExprField" class="field">
                <div class="detail-panel__label-row">
                  <span class="field-label">触发条件</span>
                  <div ref="triggerHelp" class="detail-panel__help">
                    <button
                      class="detail-panel__help-button"
                      type="button"
                      aria-label="查看触发条件说明"
                      :aria-expanded="isTriggerHelpOpen"
                      @click.stop="toggleTriggerHelp"
                    >
                      ?
                    </button>
                    <div v-if="isTriggerHelpOpen" class="detail-panel__help-popover" @click.stop>
                      <p>支持 `{group.row}`、比较运算、逻辑运算和常见 `Math` 函数；结果必须是 `boolean`。</p>
                      <p>示例：{county.level} &gt; 0 | Math.floor({county.level}) &gt;= 1 | {county.level} !== null</p>
                    </div>
                  </div>
                </div>
                <div class="detail-panel__expression-wrap">
                  <textarea
                    ref="triggerExprTextarea"
                    v-model="draft.triggerExpr"
                    class="text-area detail-panel__expression"
                    placeholder="{county.gdp} >= 10000000000 && {county.jiaoyu} >= 60"
                    @input="onTriggerExprInput"
                    @click="updateScriptAutocompleteFromCaret('triggerExpr')"
                    @keyup="updateScriptAutocompleteFromCaret('triggerExpr')"
                    @keydown="onTriggerExprKeydown"
                  />

                  <div v-if="isTriggerAutocompleteOpen" class="detail-panel__autocomplete">
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
              </div>

              <label ref="initScriptField" class="field field--full">
                <div class="detail-panel__label-row">
                  <span class="field-label">初始化脚本</span>
                  <div ref="initScriptHelp" class="detail-panel__help">
                    <button
                      class="detail-panel__help-button"
                      type="button"
                      aria-label="查看初始化脚本说明"
                      :aria-expanded="isInitScriptHelpOpen"
                      @click.stop="toggleInitScriptHelp"
                    >
                      ?
                    </button>
                    <div
                      v-if="isInitScriptHelpOpen"
                      class="detail-panel__help-popover"
                      @click.stop
                    >
                      <p>
                        支持多行、`let` 临时变量、`Math` 函数；可读取 `calc`
                        变量，但不能给 `calc` 变量赋值。
                      </p>
                    </div>
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
                      placeholder="let bonus = Math.floor({county.level} * 2)"
                      spellcheck="false"
                      @input="onInitScriptInput"
                      @scroll="onInitScriptScroll"
                      @click="updateScriptAutocompleteFromCaret('initScript')"
                      @keyup="updateScriptAutocompleteFromCaret('initScript')"
                      @keydown="onInitScriptKeydown"
                    />
                  </div>

                  <div v-if="isInitScriptAutocompleteOpen" class="detail-panel__autocomplete">
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
            <div
              v-for="(dialogue, index) in draft.dialogues"
              :key="dialogue.id"
              class="dialogue-list__row"
            >
              <div class="dialogue-list__sort">
                <button
                  class="btn-secondary dialogue-list__arrow"
                  type="button"
                  title="上移"
                  :disabled="index === 0"
                  @click="moveDialogue(dialogue.id, -1)"
                >
                  ↑
                </button>
                <button
                  class="btn-secondary dialogue-list__arrow"
                  type="button"
                  title="下移"
                  :disabled="index === draft.dialogues.length - 1"
                  @click="moveDialogue(dialogue.id, 1)"
                >
                  ↓
                </button>
              </div>

              <button
                class="dialogue-list__main"
                type="button"
                @click="openEditDialogueEditor(dialogue.id)"
              >
                <span class="dialogue-list__index">对白 {{ index + 1 }}</span>
                <span class="dialogue-list__speaker">
                  {{
                    dialogue.speaker_type === "player"
                      ? "主角"
                      : (roleOptionMap.get(dialogue.speaker_key)?.label ?? dialogue.speaker_key)
                  }}
                </span>
                <span class="dialogue-list__content">
                  {{ dialogue.content.trim() || "点击编辑对白内容" }}
                </span>
              </button>

              <div class="dialogue-list__actions">
                <button
                  class="btn-secondary dialogue-list__action"
                  type="button"
                  @click="openEditDialogueEditor(dialogue.id)"
                >
                  编辑
                </button>
                <button
                  class="btn-secondary dialogue-list__action"
                  type="button"
                  @click="removeDialogue(dialogue.id)"
                >
                  删除
                </button>
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

          <label class="field">
            <span class="field-label">对白</span>
            <textarea
              v-model="dialogueEditorState.draft.content"
              class="text-area dialogue-editor__content"
            />
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

.detail-panel__help-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 10;
  width: min(360px, 60vw);
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(10, 24, 37, 0.98);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.28);
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.5;
}

.detail-panel__help-popover p {
  margin: 0;
}

.detail-panel__expression-wrap,
.detail-panel__script-wrap,
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

.dialogue-list {
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 12px;
  padding-right: 6px;
}

.dialogue-list__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: stretch;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.dialogue-list__sort {
  display: grid;
  gap: 8px;
  align-content: start;
}

.dialogue-list__arrow {
  min-width: 38px;
  min-height: 34px;
  padding: 0;
  font-size: 1rem;
}

.dialogue-list__main {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 4px 6px;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.dialogue-list__index {
  font-weight: 700;
}

.dialogue-list__speaker {
  color: var(--accent);
  font-size: 0.88rem;
}

.dialogue-list__content {
  color: var(--text-muted);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dialogue-list__actions {
  display: grid;
  gap: 8px;
  align-content: start;
}

.dialogue-list__action {
  min-width: 68px;
  min-height: 34px;
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

  .dialogue-list__sort,
  .dialogue-list__actions {
    grid-auto-flow: column;
    justify-content: start;
  }
}
</style>
