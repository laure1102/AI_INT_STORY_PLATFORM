<script setup lang="ts">
import type {
  AppSettingsFile,
  StoryAnyEventFile,
  StoryActionFile,
  StoryBigOnceEventFile,
  StoryDocument,
  StoryEventCollectionType,
  StoryEventFile,
  StoryEventLocationFile,
  StoryLoopEventFile,
  StoryRolesFile,
  StorySceneFile,
  StoryValsFile,
  ValidationIssue,
  ValidationResult
} from "@story-mgr/core"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import AppSettingsDialog from "./AppSettingsDialog.vue"
import BigOnceEventDetailPanel from "./BigOnceEventDetailPanel.vue"
import GraphActionDetailPanel from "./GraphActionDetailPanel.vue"
import GraphEventDetailPanel from "./GraphEventDetailPanel.vue"
import LoopEventDetailPanel from "./LoopEventDetailPanel.vue"
import StoryBigOnceCanvas from "./StoryBigOnceCanvas.vue"
import StoryGraphCanvas from "./StoryGraphCanvas.vue"
import StoryLoopEventCanvas from "./StoryLoopEventCanvas.vue"
import StoryLocationsDialog from "./StoryLocationsDialog.vue"
import StoryRolesDialog from "./StoryRolesDialog.vue"
import StoryScenesDialog from "./StoryScenesDialog.vue"
import StoryValsDialog from "./StoryValsDialog.vue"
import { appendQuickLocationToEventLocations } from "./storyQuickLocation"
import { appendQuickRoleToRoles } from "./storyQuickRole"

type EventCanvasTab = StoryEventCollectionType

const props = defineProps<{
  storyId: string
}>()

const projectStore = useProjectStore()
const {
  deleteEvent,
  exportStory,
  getAppSettings,
  getStory,
  saveAppSettings,
  saveEvent,
  saveEventLocations,
  saveRoles,
  saveScenes,
  saveSystemVals,
  saveVals,
  validateStory
} = useStoryApi()

const storyDocument = ref<StoryDocument | null>(null)
const appSettings = ref<AppSettingsFile | null>(null)
const validation = shallowRef<ValidationResult | null>(null)
const exportPath = shallowRef<string | null>(null)
const isLoading = shallowRef(true)
const isSaving = shallowRef(false)
const isExporting = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)
const editingEventId = shallowRef<string | null>(null)
const creatingFromEventId = shallowRef<string | null>(null)
const creatingEventDraft = shallowRef<StoryAnyEventFile | null>(null)
const isValsDialogOpen = shallowRef(false)
const isSystemValsDialogOpen = shallowRef(false)
const isScenesDialogOpen = shallowRef(false)
const isLocationsDialogOpen = shallowRef(false)
const isRolesDialogOpen = shallowRef(false)
const isSettingsDialogOpen = shallowRef(false)
const scenesSaveSuccessMessage = shallowRef<string | null>(null)
const locationsSaveSuccessMessage = shallowRef<string | null>(null)
const rolesSaveSuccessMessage = shallowRef<string | null>(null)
const activeEventTab = shallowRef<EventCanvasTab>("graph")

const eventTabOptions: Array<{ key: EventCanvasTab; label: string }> = [
  { key: "graph", label: "普通剧情推进事件" },
  { key: "bigOnce", label: "一次性大事件" },
  { key: "loop", label: "定时循环事件" }
]

function getEventsByCollectionType(collectionType: EventCanvasTab) {
  if (!storyDocument.value) {
    return []
  }

  if (collectionType === "bigOnce") {
    return storyDocument.value.bigOnceEvents
  }

  if (collectionType === "loop") {
    return storyDocument.value.loopEvents
  }

  return storyDocument.value.graphEvents
}

function getGraphNodes() {
  if (!storyDocument.value) {
    return []
  }

  return storyDocument.value.graphEvents
}

function isGraphActionNode(event: StoryAnyEventFile): event is StoryActionFile {
  return "exec_script" in event
}

function isGraphEventNode(event: StoryAnyEventFile): event is StoryEventFile {
  return "next" in event && !("exec_script" in event) && !("bgm" in event)
}

const activeEvents = computed<StoryAnyEventFile[]>(() => {
  if (activeEventTab.value === "graph") {
    return getGraphNodes()
  }

  return getEventsByCollectionType(activeEventTab.value)
})

const activeGraphEvents = computed<StoryEventFile[]>(() => {
  if (activeEventTab.value !== "graph") {
    return []
  }

  return getEventsByCollectionType("graph") as StoryEventFile[]
})

const activeBigOnceEvents = computed<StoryBigOnceEventFile[]>(() => {
  if (activeEventTab.value !== "bigOnce") {
    return []
  }

  return getEventsByCollectionType("bigOnce") as StoryBigOnceEventFile[]
})

const activeLoopEvents = computed<StoryLoopEventFile[]>(() => {
  if (activeEventTab.value !== "loop") {
    return []
  }

  return getEventsByCollectionType("loop") as StoryLoopEventFile[]
})

const selectedEventId = computed(() =>
  projectStore.getSelectedEventId(props.storyId, activeEventTab.value)
)

const selectedEvent = computed(() => {
  return activeEvents.value.find((event) => event.id === selectedEventId.value) ?? null
})

const editingEvent = computed(() => {
  return activeEvents.value.find((event) => event.id === editingEventId.value) ?? null
})

const activeDraftEvent = computed(() => {
  if (creatingFromEventId.value || creatingEventDraft.value) {
    return creatingEventDraft.value
  }

  return editingEvent.value
})

const activeGraphParentNodeId = computed<string | null>(() => {
  if (activeEventTab.value !== "graph") {
    return null
  }

  if (creatingFromEventId.value) {
    return creatingFromEventId.value
  }

  const currentEventId = activeDraftEvent.value?.id

  if (!currentEventId) {
    return null
  }

  const parentNode = getGraphNodes().find((event) => "next" in event && event.next.includes(currentEventId))

  return parentNode?.id ?? null
})

const activeGraphDraftEvent = computed<StoryEventFile | null>(() => {
  if (activeEventTab.value !== "graph") {
    return null
  }

  const draft = activeDraftEvent.value

  if (!draft || "exec_script" in draft || "bgm" in draft) {
    return null
  }

  return draft as StoryEventFile
})

const activeGraphDraftAction = computed<StoryActionFile | null>(() => {
  if (activeEventTab.value !== "graph") {
    return null
  }

  const draft = activeDraftEvent.value

  if (!draft || !isGraphActionNode(draft)) {
    return null
  }

  return draft
})

const graphNodeOptions = computed(() => {
  if (activeEventTab.value !== "graph") {
    return []
  }

  return getGraphNodes().map((node) => ({
    id: node.id,
    title: node.title,
    type: (isGraphActionNode(node) ? "action" : "event") as "action" | "event"
  }))
})

const isCreateMode = computed(() => !!creatingEventDraft.value)

const issueSummary = computed(() => {
  const issues = validation.value?.issues ?? []
  const errorCount = issues.filter((issue) => issue.level === "error").length
  const warningCount = issues.filter((issue) => issue.level === "warning").length

  return { errorCount, warningCount }
})

const activeEventTabLabel = computed(() => {
  return eventTabOptions.find((option) => option.key === activeEventTab.value)?.label ?? "普通剧情推进事件"
})

function replaceEventInDocument(
  collectionType: EventCanvasTab,
  savedEvent: StoryAnyEventFile,
  matchEventId = savedEvent.id
) {
  if (!storyDocument.value) {
    return
  }

  if (collectionType === "bigOnce") {
    const sourceEvents = storyDocument.value.bigOnceEvents
    const typedSavedEvent = savedEvent as StoryBigOnceEventFile
    const hasExistingEvent = sourceEvents.some((currentEvent) => currentEvent.id === matchEventId)
    const nextEvents = hasExistingEvent
      ? sourceEvents.map((currentEvent) =>
          currentEvent.id === matchEventId ? typedSavedEvent : currentEvent
        )
      : [...sourceEvents, typedSavedEvent]

    storyDocument.value = {
      ...storyDocument.value,
      bigOnceEvents: nextEvents
    }
    return
  }

  if (collectionType === "loop") {
    const sourceEvents = storyDocument.value.loopEvents
    const typedSavedEvent = savedEvent as StoryLoopEventFile
    const hasExistingEvent = sourceEvents.some((currentEvent) => currentEvent.id === matchEventId)
    const nextEvents = hasExistingEvent
      ? sourceEvents.map((currentEvent) =>
          currentEvent.id === matchEventId ? typedSavedEvent : currentEvent
        )
      : [...sourceEvents, typedSavedEvent]

    storyDocument.value = {
      ...storyDocument.value,
      loopEvents: nextEvents
    }
    return
  }

  const sourceEvents = storyDocument.value.graphEvents
  if ("exec_script" in savedEvent) {
    const typedSavedAction = savedEvent as StoryActionFile
    const hasExistingAction = sourceEvents.some((currentEvent) => currentEvent.id === matchEventId)
    const nextEvents = hasExistingAction
      ? sourceEvents.map((currentEvent) =>
          currentEvent.id === matchEventId ? typedSavedAction : currentEvent
        )
      : [...sourceEvents, typedSavedAction]

    storyDocument.value = {
      ...storyDocument.value,
      graphEvents: nextEvents
    }
    return
  }

  const typedSavedEvent = savedEvent as StoryEventFile
  const hasExistingEvent = sourceEvents.some((currentEvent) => currentEvent.id === matchEventId)
  const nextEvents = hasExistingEvent
    ? sourceEvents.map((currentEvent) =>
        currentEvent.id === matchEventId ? typedSavedEvent : currentEvent
      )
    : [...sourceEvents, typedSavedEvent]

  storyDocument.value = {
    ...storyDocument.value,
    graphEvents: nextEvents
  }
}

function removeEventFromDocument(
  collectionType: EventCanvasTab,
  eventId: string
) {
  if (!storyDocument.value) {
    return
  }

  if (collectionType === "bigOnce") {
    storyDocument.value = {
      ...storyDocument.value,
      bigOnceEvents: storyDocument.value.bigOnceEvents.filter((event) => event.id !== eventId)
    }
    return
  }

  if (collectionType === "loop") {
    storyDocument.value = {
      ...storyDocument.value,
      loopEvents: storyDocument.value.loopEvents.filter((event) => event.id !== eventId)
    }
    return
  }

  storyDocument.value = {
    ...storyDocument.value,
    graphEvents: storyDocument.value.graphEvents
      .filter((event) => event.id !== eventId)
      .map((event) =>
        event.next.includes(eventId)
          ? {
              ...event,
              next: event.next.filter((nextEventId) => nextEventId !== eventId)
            }
          : event
      )
  }
}

async function refreshValidation() {
  validation.value = await validateStory(props.storyId)
}

function closeEditor() {
  editingEventId.value = null
  creatingFromEventId.value = null
  creatingEventDraft.value = null
}

function openValsDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isRolesDialogOpen.value = false
  isValsDialogOpen.value = true
}

function closeValsDialog() {
  isValsDialogOpen.value = false
}

function openSystemValsDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isRolesDialogOpen.value = false
  isSystemValsDialogOpen.value = true
}

function closeSystemValsDialog() {
  isSystemValsDialogOpen.value = false
}

function openScenesDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isRolesDialogOpen.value = false
  scenesSaveSuccessMessage.value = null
  isScenesDialogOpen.value = true
}

function closeScenesDialog() {
  scenesSaveSuccessMessage.value = null
  isScenesDialogOpen.value = false
}

function openLocationsDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isRolesDialogOpen.value = false
  locationsSaveSuccessMessage.value = null
  isLocationsDialogOpen.value = true
}

function closeLocationsDialog() {
  locationsSaveSuccessMessage.value = null
  isLocationsDialogOpen.value = false
}

function openRolesDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  rolesSaveSuccessMessage.value = null
  isRolesDialogOpen.value = true
}

function closeRolesDialog() {
  rolesSaveSuccessMessage.value = null
  isRolesDialogOpen.value = false
}

function openSettingsDialog() {
  if (!appSettings.value) {
    return
  }

  isSettingsDialogOpen.value = true
}

function closeSettingsDialog() {
  isSettingsDialogOpen.value = false
}

async function loadStory() {
  isLoading.value = true
  errorMessage.value = null
  exportPath.value = null

  try {
    const [story, settings] = await Promise.all([getStory(props.storyId), getAppSettings()])
    storyDocument.value = story
    appSettings.value = settings

    for (const collectionType of ["graph", "bigOnce", "loop"] as EventCanvasTab[]) {
      const events = getEventsByCollectionType(collectionType)
      const currentSelection = projectStore.getSelectedEventId(props.storyId, collectionType)
      const fallbackEventId = events[0]?.id

      if (currentSelection) {
        const stillExists = events.some((event) => event.id === currentSelection)

        if (!stillExists) {
          if (fallbackEventId) {
            projectStore.selectEvent(props.storyId, collectionType, fallbackEventId)
          } else {
            projectStore.clearEvent(props.storyId, collectionType)
          }
        }
      } else if (fallbackEventId) {
        projectStore.selectEvent(props.storyId, collectionType, fallbackEventId)
      } else {
        projectStore.clearEvent(props.storyId, collectionType)
      }
    }

    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载剧情失败。"
  } finally {
    isLoading.value = false
  }
}

function handleSelectEvent(eventId: string) {
  projectStore.selectEvent(props.storyId, activeEventTab.value, eventId)
}

function handleEditEvent(eventId: string) {
  creatingFromEventId.value = null
  editingEventId.value = eventId
  projectStore.selectEvent(props.storyId, activeEventTab.value, eventId)
}

function sanitizeIdSegment(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function createUniqueEventId(baseId: string) {
  const events = activeEvents.value
  const usedIds = new Set(events.map((event) => event.id))
  const base = sanitizeIdSegment(baseId) || "event"

  let candidate = base
  let index = 2
  while (usedIds.has(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }

  return candidate
}

function buildNewEventFromParent(parentEventId: string): StoryEventFile {
  const newId = createUniqueEventId(`${parentEventId}-child`)

  return {
    id: newId,
    title: "新事件",
    trigger_expr: "",
    init_script: "",
    end_script: "",
    object_keys: [],
    dialogues: [],
    location: "",
    next: []
  }
}

function buildNewActionFromParent(parentEventId: string): StoryActionFile {
  const newId = createUniqueEventId(`${parentEventId}-action`)

  return {
    id: newId,
    title: "新操作",
    vars: [],
    exec_script: "",
    next: []
  }
}

function buildNewRootEvent(): StoryEventFile {
  const newId = createUniqueEventId("root")

  return {
    id: newId,
    title: "新根事件",
    trigger_expr: "",
    init_script: "",
    end_script: "",
    object_keys: [],
    dialogues: [],
    location: "",
    next: []
  }
}

function buildNewStandaloneEvent(): StoryAnyEventFile {
  if (activeEventTab.value === "bigOnce") {
    const event: StoryBigOnceEventFile = {
      id: createUniqueEventId("big-once-event"),
      title: "新事件",
      trigger_expr: "",
      init_script: "",
      object_keys: [],
      dialogues: [],
      location: "",
      bgm: "",
      end_script: ""
    }

    return event
  }

  if (activeEventTab.value === "loop") {
    const event: StoryLoopEventFile = {
      id: createUniqueEventId("loop-event"),
      title: "新循环事件",
      trigger_expr: "",
      init_script: "",
      object_keys: [],
      dialogues: [],
      location: "",
      bgm: "",
      end_script: "",
      loop: {
        mode: "daily"
      }
    }

    return event
  }

  const defaultId = "event"

  return {
    id: createUniqueEventId(defaultId),
    title: "新事件",
    trigger_expr: "",
    init_script: "",
    end_script: "",
    object_keys: [],
    dialogues: [],
    location: "",
    next: []
  }
}

function handleCreateGraphEvent(parentEventId: string) {
  creatingFromEventId.value = parentEventId
  editingEventId.value = null
  creatingEventDraft.value = buildNewEventFromParent(parentEventId)
  projectStore.selectEvent(props.storyId, activeEventTab.value, parentEventId)
}

function handleCreateGraphAction(parentEventId: string) {
  creatingFromEventId.value = parentEventId
  editingEventId.value = null
  creatingEventDraft.value = buildNewActionFromParent(parentEventId)
  projectStore.selectEvent(props.storyId, activeEventTab.value, parentEventId)
}

function handleCreateGraphRootEvent() {
  creatingFromEventId.value = null
  editingEventId.value = null
  creatingEventDraft.value = buildNewRootEvent()
  projectStore.clearEvent(props.storyId, activeEventTab.value)
}

function handleCreateStandaloneEvent() {
  creatingFromEventId.value = null
  editingEventId.value = null
  creatingEventDraft.value = buildNewStandaloneEvent()
  projectStore.clearEvent(props.storyId, activeEventTab.value)
}

function handleSwitchEventTab(tab: EventCanvasTab) {
  if (activeEventTab.value === tab) {
    return
  }

  closeEditor()
  activeEventTab.value = tab
}

async function handleDeleteGraphNode(eventId: string) {
  const targetEvent = activeEvents.value.find((event) => event.id === eventId)
  const label = targetEvent && "exec_script" in targetEvent ? "这个操作节点" : "这个事件节点"

  if (!window.confirm(`确认删除${label}吗？`)) {
    return
  }

  await handleDeleteEvent(eventId)
}

async function handleSaveEvent(event: StoryAnyEventFile) {
  isSaving.value = true
  errorMessage.value = null

  try {
    const collectionType = activeEventTab.value
    const isCreatingDraft = isCreateMode.value
    const parentEventId = collectionType === "graph" ? creatingFromEventId.value : null
    const previousEventId = projectStore.getSelectedEventId(props.storyId, collectionType) ?? event.id
    const currentEvents =
      collectionType === "graph" ? getGraphNodes() : getEventsByCollectionType(collectionType)
    const savedEvent = await saveEvent(props.storyId, event, collectionType)

    if (parentEventId) {
      const sourceEvent = currentEvents.find((currentEvent) => currentEvent.id === parentEventId)

      if (
        sourceEvent &&
        "next" in sourceEvent &&
        !sourceEvent.next.includes(savedEvent.id)
      ) {
        const linkedSourceEvent = await saveEvent(
          props.storyId,
          {
            ...sourceEvent,
            next: [...sourceEvent.next, savedEvent.id]
          },
          collectionType
        )

        replaceEventInDocument(collectionType, linkedSourceEvent, sourceEvent.id)
      }

      replaceEventInDocument(collectionType, savedEvent)
    } else {
      replaceEventInDocument(collectionType, savedEvent, previousEventId)
    }

    if (isCreatingDraft || savedEvent.id !== previousEventId) {
      projectStore.selectEvent(props.storyId, collectionType, savedEvent.id)
    }

    editingEventId.value = savedEvent.id
    creatingFromEventId.value = null
    creatingEventDraft.value = null
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存事件失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleDeleteEvent(eventId: string) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const collectionType = activeEventTab.value

    await deleteEvent(props.storyId, eventId, collectionType)
    removeEventFromDocument(collectionType, eventId)

    const remainingEvents = getEventsByCollectionType(collectionType)
    const fallbackEventId = remainingEvents[0]?.id ?? null
    const currentSelectedEventId = projectStore.getSelectedEventId(props.storyId, collectionType)
    const isEditingDeletedEvent =
      editingEventId.value === eventId || creatingFromEventId.value === eventId

    if (currentSelectedEventId === eventId) {
      if (fallbackEventId) {
        projectStore.selectEvent(props.storyId, collectionType, fallbackEventId)
      } else {
        projectStore.clearEvent(props.storyId, collectionType)
      }
    }

    if (isEditingDeletedEvent || creatingEventDraft.value?.id === eventId) {
      closeEditor()
    }

    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "删除事件失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveVals(vals: StoryValsFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const savedVals = await saveVals(props.storyId, vals)
    storyDocument.value = {
      ...storyDocument.value,
      vals: savedVals
    }
    isValsDialogOpen.value = false
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存全局变量失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveSystemVals(systemVals: StoryValsFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const savedSystemVals = await saveSystemVals(props.storyId, systemVals)
    storyDocument.value = {
      ...storyDocument.value,
      systemVals: savedSystemVals
    }
    isSystemValsDialogOpen.value = false
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存系统变量失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveScenes(scenes: StorySceneFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  scenesSaveSuccessMessage.value = null

  try {
    const savedScenes = await saveScenes(props.storyId, scenes)
    storyDocument.value = {
      ...storyDocument.value,
      scenes: savedScenes
    }
    scenesSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存场景失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveEventLocations(eventLocations: StoryEventLocationFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  locationsSaveSuccessMessage.value = null

  try {
    const savedEventLocations = await saveEventLocations(props.storyId, eventLocations)
    storyDocument.value = {
      ...storyDocument.value,
      eventLocations: savedEventLocations
    }
    locationsSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存地点失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveRoles(roles: StoryRolesFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  rolesSaveSuccessMessage.value = null

  try {
    const savedRoles = await saveRoles(props.storyId, roles)
    storyDocument.value = {
      ...storyDocument.value,
      roles: savedRoles
    }
    rolesSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存角色失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleQuickCreateRole(payload: StoryQuickCreateRolePayload) {
  if (!storyDocument.value) {
    return
  }

  await handleSaveRoles(appendQuickRoleToRoles(storyDocument.value.roles, payload))
}

async function handleQuickCreateLocation(payload: StoryQuickCreateLocationPayload) {
  if (!storyDocument.value) {
    return
  }

  await handleSaveEventLocations(
    appendQuickLocationToEventLocations(storyDocument.value.eventLocations, payload)
  )
}

async function handleSaveAppSettings(settings: AppSettingsFile) {
  isSaving.value = true
  errorMessage.value = null

  try {
    appSettings.value = await saveAppSettings(settings)
    isSettingsDialogOpen.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存设置失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleToggleLink(payload: {
  sourceEventId: string
  targetEventId: string
}) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const collectionType = activeEventTab.value
    if (collectionType !== "graph") {
      return
    }

    const sourceEvent = getGraphNodes().find((event) => event.id === payload.sourceEventId)

    if (!sourceEvent || !("next" in sourceEvent)) {
      return
    }

    const next = sourceEvent.next.includes(payload.targetEventId)
      ? sourceEvent.next.filter((eventId) => eventId !== payload.targetEventId)
      : [...sourceEvent.next, payload.targetEventId]

    const savedEvent = await saveEvent(
      props.storyId,
      {
        ...sourceEvent,
        next
      },
      collectionType
    )

    replaceEventInDocument(collectionType, savedEvent, payload.sourceEventId)
    await refreshValidation()
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "更新图谱连线失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleExport() {
  isExporting.value = true
  errorMessage.value = null

  try {
    const response = await exportStory(props.storyId)
    validation.value = response.result
    exportPath.value = response.outputPath
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "导出运行时 JSON 失败。"
  } finally {
    isExporting.value = false
  }
}

function issueKey(issue: ValidationIssue, index: number) {
  return `${issue.code}:${issue.path.join("/")}:${index}`
}

watch(
  () => props.storyId,
  () => {
    editingEventId.value = null
    creatingFromEventId.value = null
    creatingEventDraft.value = null
    isValsDialogOpen.value = false
    isSystemValsDialogOpen.value = false
    isScenesDialogOpen.value = false
    isLocationsDialogOpen.value = false
    isRolesDialogOpen.value = false
    scenesSaveSuccessMessage.value = null
    locationsSaveSuccessMessage.value = null
    rolesSaveSuccessMessage.value = null
    void loadStory()
  },
  { immediate: true }
)
</script>

<template>
  <main class="page-shell page-shell--editor fade-up">
    <div class="editor-header">
      <div class="editor-header__copy">
        <NuxtLink class="editor-header__back" to="/">返回剧情列表</NuxtLink>
        <h1 class="editor-header__title">
          {{ storyDocument?.story.title || "正在加载剧情..." }}
        </h1>
        <div class="editor-header__tools" aria-label="故事配置入口">
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openValsDialog">
            全局变量
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openSystemValsDialog">
            系统变量
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openScenesDialog">
            场景
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openLocationsDialog">
            地点
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openRolesDialog">
            角色
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openSettingsDialog">
            设置
          </button>
        </div>
      </div>

      <div class="editor-header__actions">
        <button class="btn-secondary" type="button" :disabled="isLoading" @click="loadStory">
          重新加载剧情
        </button>
        <button class="btn-primary" type="button" :disabled="isExporting" @click="handleExport">
          {{ isExporting ? "导出中..." : "导出运行时 JSON" }}
        </button>
      </div>
    </div>

    <div v-if="errorMessage" class="editor-banner editor-banner--error">
      {{ errorMessage }}
    </div>

    <div v-if="exportPath" class="editor-banner">
      运行时数据已导出到 {{ exportPath }}
    </div>

    <section class="editor-main">
      <div class="editor-validation-row">
        <div class="editor-status glass-panel">
          <div>
            <span class="eyebrow">校验</span>
            <h2 class="section-title">
              {{ issueSummary.errorCount }} 个错误 / {{ issueSummary.warningCount }} 个警告
            </h2>
          </div>
          <div class="editor-status__actions">
            <button class="btn-secondary" type="button" @click="refreshValidation">
              重新校验
            </button>
          </div>
        </div>

        <section class="issues glass-panel">
          <div class="issues__head">
            <h2 class="section-title">校验结果</h2>
          </div>

          <ul v-if="validation?.issues.length" class="issues__list">
            <li
              v-for="(issue, index) in validation.issues"
              :key="issueKey(issue, index)"
              class="issues__item"
              :class="`issues__item--${issue.level}`"
            >
              <strong>{{ issue.code }}</strong>
              <span>{{ issue.message }}</span>
              <code>{{ issue.path.join(" / ") }}</code>
            </li>
          </ul>
          <p v-else class="muted">未发现结构问题。</p>
        </section>
      </div>

      <p v-if="isLoading && !storyDocument" class="muted">正在加载剧情数据...</p>
    </section>

    <section v-if="storyDocument" class="editor-canvas-band">
      <div class="editor-event-tabs" role="tablist" aria-label="剧情事件类型">
        <button
          v-for="tab in eventTabOptions"
          :key="tab.key"
          class="editor-event-tabs__button"
          :class="{ 'editor-event-tabs__button--active': activeEventTab === tab.key }"
          type="button"
          role="tab"
          :aria-selected="activeEventTab === tab.key"
          @click="handleSwitchEventTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <StoryGraphCanvas
        v-if="activeEventTab === 'graph'"
        :entry-event-id="storyDocument.story.startEventId ?? activeGraphEvents[0]?.id ?? null"
        :events="activeEvents"
        :selected-event-id="selectedEventId"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @delete="handleDeleteGraphNode"
        @create="handleCreateGraphEvent"
        @create-action="handleCreateGraphAction"
        @create-root="handleCreateGraphRootEvent"
        @toggle-link="handleToggleLink"
      />

      <StoryBigOnceCanvas
        v-else-if="activeEventTab === 'bigOnce'"
        :events="activeBigOnceEvents"
        :selected-event-id="selectedEventId"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @delete="handleDeleteEvent"
        @create="handleCreateStandaloneEvent"
      />

      <StoryLoopEventCanvas
        v-else
        :events="activeLoopEvents"
        :selected-event-id="selectedEventId"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @delete="handleDeleteEvent"
        @create="handleCreateStandaloneEvent"
      />
    </section>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="storyDocument && (editingEvent || creatingEventDraft)"
          class="editor-modal"
          @click.self="closeEditor"
        >
          <div class="editor-modal__panel">
            <GraphEventDetailPanel
              v-if="activeEventTab === 'graph' && activeGraphDraftEvent"
              :event="activeGraphDraftEvent"
              :event-locations="storyDocument.eventLocations"
              :graph-node-options="graphNodeOptions"
              :mode="isCreateMode ? 'create' : 'edit'"
              :parent-event-id="activeGraphParentNodeId"
              :roles="storyDocument.roles"
              :saving="isSaving"
              :vals="storyDocument.vals"
              @close="closeEditor"
              @quick-create-location="handleQuickCreateLocation"
              @quick-create-role="handleQuickCreateRole"
              @save="handleSaveEvent"
            />
            <GraphActionDetailPanel
              v-else-if="activeEventTab === 'graph' && activeGraphDraftAction"
              :action="activeGraphDraftAction"
              :graph-node-options="graphNodeOptions"
              :mode="isCreateMode ? 'create' : 'edit'"
              :saving="isSaving"
              :vals="storyDocument.vals"
              @close="closeEditor"
              @save="handleSaveEvent"
            />
            <BigOnceEventDetailPanel
              v-else-if="activeEventTab === 'bigOnce'"
              :event="activeDraftEvent as StoryBigOnceEventFile | null"
              :event-locations="storyDocument.eventLocations"
              :mode="isCreateMode ? 'create' : 'edit'"
              :roles="storyDocument.roles"
              :saving="isSaving"
              :scenes="storyDocument.scenes"
              :vals="storyDocument.vals"
              @close="closeEditor"
              @quick-create-location="handleQuickCreateLocation"
              @quick-create-role="handleQuickCreateRole"
              @save="handleSaveEvent"
            />
            <LoopEventDetailPanel
              v-else
              :event="activeDraftEvent as StoryLoopEventFile | null"
              :event-locations="storyDocument.eventLocations"
              :mode="isCreateMode ? 'create' : 'edit'"
              :roles="storyDocument.roles"
              :saving="isSaving"
              :scenes="storyDocument.scenes"
              :vals="storyDocument.vals"
              @close="closeEditor"
              @quick-create-location="handleQuickCreateLocation"
              @quick-create-role="handleQuickCreateRole"
              @save="handleSaveEvent"
            />
          </div>
        </div>
      </Transition>
    </Teleport>

    <StoryValsDialog
      v-if="storyDocument && isValsDialogOpen"
      :saving="isSaving"
      :vals="storyDocument.vals"
      @close="closeValsDialog"
      @save="handleSaveVals"
    />

    <StoryValsDialog
      v-if="storyDocument && isSystemValsDialogOpen"
      eyebrow="系统变量"
      title="系统变量设置"
      :saving="isSaving"
      :vals="storyDocument.systemVals"
      @close="closeSystemValsDialog"
      @save="handleSaveSystemVals"
    />

    <StoryScenesDialog
      v-if="storyDocument && isScenesDialogOpen"
      :save-success-message="scenesSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :scenes="storyDocument.scenes"
      @close="closeScenesDialog"
      @save="handleSaveScenes"
    />

    <StoryLocationsDialog
      v-if="storyDocument && isLocationsDialogOpen"
      :event-locations="storyDocument.eventLocations"
      :save-success-message="locationsSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :story-title="storyDocument.story.title"
      @close="closeLocationsDialog"
      @save="handleSaveEventLocations"
    />

    <StoryRolesDialog
      v-if="storyDocument && isRolesDialogOpen"
      :roles="storyDocument.roles"
      :save-success-message="rolesSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :story-title="storyDocument.story.title"
      @close="closeRolesDialog"
      @save="handleSaveRoles"
    />

    <AppSettingsDialog
      v-if="appSettings && isSettingsDialogOpen"
      :saving="isSaving"
      :settings="appSettings"
      @close="closeSettingsDialog"
      @save="handleSaveAppSettings"
    />
  </main>
</template>

<style scoped>
.page-shell--editor {
  width: 100%;
  max-width: none;
  height: 100dvh;
  min-height: 100dvh;
  margin: 0;
  padding: 10px 10px 0;
  padding-bottom: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.editor-header__copy {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.editor-header__back {
  color: var(--accent);
  font-family: "Space Grotesk", sans-serif;
  font-size: 0.78rem;
  flex-shrink: 0;
}

.editor-header__title {
  margin: 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: clamp(1.1rem, 1.9vw, 1.45rem);
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
}

.editor-header__actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.editor-header__tools {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.editor-header__tool-button {
  min-height: 28px;
  padding: 0 10px;
  border-radius: 10px;
  font-size: 0.78rem;
}

.editor-header :deep(.btn-primary),
.editor-header :deep(.btn-secondary),
.editor-main :deep(.btn-secondary) {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 10px;
}

.editor-banner {
  margin-bottom: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(124, 227, 195, 0.4);
  border-radius: 12px;
  background: rgba(124, 227, 195, 0.12);
  font-size: 0.82rem;
  line-height: 1.25;
}

.editor-banner--error {
  border-color: rgba(255, 139, 123, 0.45);
  background: rgba(255, 139, 123, 0.14);
}

.editor-main {
  display: grid;
  gap: 6px;
  flex-shrink: 0;
}

.editor-canvas-band {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  width: 100%;
  margin: 4px 0 0;
}

.editor-event-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 0;
  padding: 8px 8px 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: 0;
  border-radius: 18px 18px 0 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02)),
    rgba(5, 12, 20, 0.86);
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.editor-event-tabs__button {
  position: relative;
  min-height: 40px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 14px 14px 0 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.editor-event-tabs__button:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.04);
}

.editor-event-tabs__button--active {
  color: var(--text-main);
  border-color: rgba(124, 227, 195, 0.42);
  background:
    linear-gradient(180deg, rgba(124, 227, 195, 0.18), rgba(124, 227, 195, 0.08)),
    rgba(8, 18, 29, 0.98);
  transform: translateY(1px);
  box-shadow:
    0 -1px 0 rgba(124, 227, 195, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.editor-canvas-band :deep(.graph-panel),
.editor-canvas-band :deep(.big-once-board),
.editor-canvas-band :deep(.loop-board) {
  border-top-left-radius: 0;
  border-top-right-radius: 18px;
  margin-top: -1px;
}

.editor-validation-row {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 16px;
}

.editor-status__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.issues {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 12px;
  border-radius: 16px;
}

.issues__head {
  margin: 0;
  flex-shrink: 0;
}

.issues__list {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
  max-height: none;
  overflow-x: auto;
  overflow-y: hidden;
  padding-right: 0;
  white-space: nowrap;
}

.issues__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 0.8rem;
  flex-shrink: 0;
}

.issues__item--error {
  border-color: rgba(255, 139, 123, 0.4);
}

.issues__item--warning {
  border-color: rgba(255, 180, 84, 0.4);
}

.issues__item code {
  color: var(--text-muted);
  font-size: 0.72rem;
}

.editor-main .section-title {
  font-size: 0.92rem;
  line-height: 1;
}

.editor-main .eyebrow {
  gap: 6px;
  font-size: 0.72rem;
}

.editor-main .eyebrow::before {
  width: 22px;
}

.issues .muted {
  margin: 0;
  font-size: 0.8rem;
  white-space: nowrap;
}

.editor-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  padding: 0;
  background: rgba(2, 8, 16, 0.72);
  backdrop-filter: blur(10px);
  overflow: hidden;
}

.editor-modal__panel {
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  background: transparent;
}

.editor-modal__close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(7, 16, 26, 0.92);
  color: var(--text);
  font-size: 1.5rem;
  line-height: 1;
  z-index: 2;
}

@media (max-width: 1024px) {
  .page-shell--editor {
    width: 100%;
    height: 100dvh;
    margin: 0;
    padding: 8px 6px 0;
    padding-bottom: 0;
  }

  .editor-header,
  .editor-header__actions,
  .editor-status,
  .editor-status__actions,
  .editor-validation-row {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }

  .editor-header__copy {
    display: grid;
    gap: 4px;
  }

  .editor-header__title,
  .editor-header__tools {
    white-space: normal;
  }

  .editor-event-tabs {
    flex-wrap: wrap;
  }

  .issues {
    align-items: flex-start;
  }

  .issues__list {
    width: 100%;
  }
}
</style>
