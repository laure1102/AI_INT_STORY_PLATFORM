<script setup lang="ts">
import type {
  AppSettingsFile,
  StoryAnyEventFile,
  StoryActionFile,
  StoryBibleFile,
  StoryDoingFile,
  StoryDocument,
  StoryEventCollectionType,
  StoryEventFile,
  StoryEventLocationFile,
  StoryPhoneFile,
  StoryReferFile,
  StoryEventTriggerMode,
  StoryItemsFile,
  StoryLoopEventFile,
  StoryOnceEventFile,
  StoryPlayerOverrideValsFile,
  StoryRolesFile,
  StorySceneFile,
  StoryShopFile,
  StoryValsFile,
  ValidationIssue,
  ValidationResult
} from "@story-mgr/core"
import type {
  ApplyStoryCreationDraftSelection,
  RunStoryCreationAgentResponse,
  StoryCreationDraft,
  StoryCreationHistoryFile,
  StoryCreationHistorySession,
  StoryCreationHistoryTurn
} from "@story-mgr/shared"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import AppSettingsDialog from "./AppSettingsDialog.vue"
import GraphActionDetailPanel from "./GraphActionDetailPanel.vue"
import GraphEventDetailPanel from "./GraphEventDetailPanel.vue"
import LoopEventDetailPanel from "./LoopEventDetailPanel.vue"
import OnceEventDetailPanel from "./OnceEventDetailPanel.vue"
import StoryCreationWorkspace from "./StoryCreationWorkspace.vue"
import StoryDoingDialog from "./StoryDoingDialog.vue"
import StoryGraphCanvas from "./StoryGraphCanvas.vue"
import StoryItemsDialog from "./StoryItemsDialog.vue"
import StoryLoopEventCanvas from "./StoryLoopEventCanvas.vue"
import StoryLocationsDialog from "./StoryLocationsDialog.vue"
import StoryOnceCanvas from "./StoryOnceCanvas.vue"
import StoryPhoneDialog from "./StoryPhoneDialog.vue"
import StoryPlayerOverrideValsDialog from "./StoryPlayerOverrideValsDialog.vue"
import StoryReferDialog from "./StoryReferDialog.vue"
import StoryRolesDialog from "./StoryRolesDialog.vue"
import StoryScenesDialog from "./StoryScenesDialog.vue"
import StoryShopDialog from "./StoryShopDialog.vue"
import StoryValsDialog from "./StoryValsDialog.vue"
import { appendQuickLocationToEventLocations } from "./storyQuickLocation"
import { appendQuickRoleToRoles } from "./storyQuickRole"
import {
  mergeStoryScriptAutocompleteItems,
  normalizeStoryScriptAutocompleteText,
  type StoryScriptAutocompleteItem
} from "./storyScriptEditor"

type EventCanvasTab = Extract<StoryEventCollectionType, "chain" | "pool" | "schedule">
type EventWorkbenchTab = EventCanvasTab | "doing"
type EventTriggerFilter = "all" | "normal" | "invoke"
type StoryWorkspaceTab = "creation" | "events"
type StoryCreationAgentRunMode = "new" | "feedback"

const props = defineProps<{
  storyId: string
}>()

const projectStore = useProjectStore()
const {
  applyStoryCreationDraft,
  deleteEvent,
  exportStory,
  getAppSettings,
  getStoryCreationHistory,
  getStory,
  runStoryCreationAgent,
  deleteStoryCreationHistorySession,
  saveAppSettings,
  saveEvent,
  saveEventLocations,
  saveDoing,
  saveStoryCreationHistorySession,
  saveItems,
  savePhone,
  saveRefer,
  saveShop,
  savePlayerOverrideVals,
  saveRoles,
  saveScenes,
  saveStoryBible,
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
const isAgentRunning = shallowRef(false)
const isCreationDraftApplying = shallowRef(false)
const creationAgentAbortController = shallowRef<AbortController | null>(null)
const errorMessage = shallowRef<string | null>(null)
const creationAgentResult = shallowRef<RunStoryCreationAgentResponse | null>(null)
const creationAgentRunMode = shallowRef<StoryCreationAgentRunMode | null>(null)
const creationAgentError = shallowRef<string | null>(null)
const creationApplyMessage = shallowRef<string | null>(null)
const creationApplyWarnings = shallowRef<string[]>([])
const creationHistory = ref<StoryCreationHistoryFile>({ sessions: [] })
const activeCreationHistorySessionId = shallowRef<string | null>(null)
const editingEventId = shallowRef<string | null>(null)
const creatingFromEventId = shallowRef<string | null>(null)
const creatingEventDraft = shallowRef<StoryAnyEventFile | null>(null)
const isValsDialogOpen = shallowRef(false)
const isPlayerOverrideValsDialogOpen = shallowRef(false)
const isSystemValsDialogOpen = shallowRef(false)
const isScenesDialogOpen = shallowRef(false)
const isLocationsDialogOpen = shallowRef(false)
const isItemsDialogOpen = shallowRef(false)
const isShopDialogOpen = shallowRef(false)
const isPhoneDialogOpen = shallowRef(false)
const isReferDialogOpen = shallowRef(false)
const isRolesDialogOpen = shallowRef(false)
const isSettingsDialogOpen = shallowRef(false)
const scenesSaveSuccessMessage = shallowRef<string | null>(null)
const locationsSaveSuccessMessage = shallowRef<string | null>(null)
const itemsSaveSuccessMessage = shallowRef<string | null>(null)
const shopSaveSuccessMessage = shallowRef<string | null>(null)
const phoneSaveSuccessMessage = shallowRef<string | null>(null)
const referSaveSuccessMessage = shallowRef<string | null>(null)
const doingSaveSuccessMessage = shallowRef<string | null>(null)
const rolesSaveSuccessMessage = shallowRef<string | null>(null)
const activeWorkspaceTab = shallowRef<StoryWorkspaceTab>("creation")
const activeEventTab = shallowRef<EventWorkbenchTab>("chain")
const eventTriggerFilter = shallowRef<EventTriggerFilter>("all")

const workspaceTabOptions: Array<{ key: StoryWorkspaceTab; label: string }> = [
  { key: "creation", label: "创作" },
  { key: "events", label: "事件" }
]

const eventTabOptions: Array<{ key: EventWorkbenchTab; label: string }> = [
  { key: "chain", label: "链式剧情线" },
  { key: "pool", label: "平面事件池" },
  { key: "schedule", label: "定时规则事件" },
  { key: "doing", label: "行动" }
]

const eventTriggerFilterOptions: Array<{ key: EventTriggerFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "normal", label: "普通" },
  { key: "invoke", label: "被调用" }
]

function isEventCanvasTab(tab: EventWorkbenchTab): tab is EventCanvasTab {
  return tab === "chain" || tab === "pool" || tab === "schedule"
}

function getEventsByCollectionType(collectionType: EventCanvasTab) {
  if (!storyDocument.value) {
    return []
  }

  if (collectionType === "pool") {
    return storyDocument.value.poolEvents
  }

  if (collectionType === "schedule") {
    return storyDocument.value.scheduleEvents
  }

  return storyDocument.value.chainEvents
}

function getGraphNodes() {
  if (!storyDocument.value) {
    return []
  }

  return storyDocument.value.chainEvents
}

function isGraphActionNode(event: StoryAnyEventFile): event is StoryActionFile {
  return "exec_script" in event
}

function isGraphEventNode(event: StoryAnyEventFile): event is StoryEventFile {
  return "next" in event && !("exec_script" in event) && !("bgm" in event)
}

function normalizeEventTriggerMode(
  event: StoryEventFile | StoryOnceEventFile | StoryLoopEventFile
): StoryEventTriggerMode {
  return event.trigger_mode ?? "default"
}

function matchesEventTriggerFilter(
  event: StoryEventFile | StoryOnceEventFile | StoryLoopEventFile
) {
  if (eventTriggerFilter.value === "all") {
    return true
  }

  const triggerMode = normalizeEventTriggerMode(event)
  return eventTriggerFilter.value === "invoke"
    ? triggerMode === "invoke"
    : triggerMode !== "invoke"
}

const activeEvents = computed<StoryAnyEventFile[]>(() => {
  if (!isEventCanvasTab(activeEventTab.value)) {
    return []
  }

  if (activeEventTab.value === "chain") {
    return getGraphNodes()
  }

  return getEventsByCollectionType(activeEventTab.value)
})

const activeGraphEvents = computed<StoryEventFile[]>(() => {
  if (activeEventTab.value !== "chain") {
    return []
  }

  return getEventsByCollectionType("chain") as StoryEventFile[]
})

const activeOnceEvents = computed<StoryOnceEventFile[]>(() => {
  if (activeEventTab.value !== "pool") {
    return []
  }

  return getEventsByCollectionType("pool") as StoryOnceEventFile[]
})

const activeLoopEvents = computed<StoryLoopEventFile[]>(() => {
  if (activeEventTab.value !== "schedule") {
    return []
  }

  return getEventsByCollectionType("schedule") as StoryLoopEventFile[]
})

const filteredGraphCanvasEvents = computed<StoryAnyEventFile[]>(() => {
  const graphNodes = getGraphNodes()
  if (eventTriggerFilter.value === "all") {
    return graphNodes
  }

  const visibleEventIds = new Set(
    graphNodes
      .filter(isGraphEventNode)
      .filter((event) => matchesEventTriggerFilter(event))
      .map((event) => event.id)
  )
  const visibleActionIds = new Set<string>()

  for (const node of graphNodes) {
    if (isGraphEventNode(node) && visibleEventIds.has(node.id)) {
      for (const nextId of node.next) {
        const nextNode = graphNodes.find((candidate) => candidate.id === nextId)
        if (nextNode && isGraphActionNode(nextNode)) {
          visibleActionIds.add(nextNode.id)
        }
      }
    }

    if (isGraphActionNode(node) && node.next.some((nextId) => visibleEventIds.has(nextId))) {
      visibleActionIds.add(node.id)
    }
  }

  return graphNodes.filter((node) => {
    if (isGraphEventNode(node)) {
      return visibleEventIds.has(node.id)
    }

    return isGraphActionNode(node) && visibleActionIds.has(node.id)
  })
})

const filteredOnceCanvasEvents = computed(() => {
  return activeOnceEvents.value.filter((event) => matchesEventTriggerFilter(event))
})

const filteredLoopCanvasEvents = computed(() => {
  return activeLoopEvents.value.filter((event) => matchesEventTriggerFilter(event))
})

const selectedEventId = computed(() =>
  isEventCanvasTab(activeEventTab.value)
    ? projectStore.getSelectedEventId(props.storyId, activeEventTab.value)
    : null
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
  if (activeEventTab.value !== "chain") {
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
  if (activeEventTab.value !== "chain") {
    return null
  }

  const draft = activeDraftEvent.value

  if (!draft || "exec_script" in draft || "bgm" in draft) {
    return null
  }

  return draft as StoryEventFile
})

const activeGraphDraftAction = computed<StoryActionFile | null>(() => {
  if (activeEventTab.value !== "chain") {
    return null
  }

  const draft = activeDraftEvent.value

  if (!draft || !isGraphActionNode(draft)) {
    return null
  }

  return draft
})

const graphNodeOptions = computed(() => {
  if (activeEventTab.value !== "chain") {
    return []
  }

  return getGraphNodes().map((node) => ({
    id: node.id,
    title: node.title,
    type: (isGraphActionNode(node) ? "action" : "event") as "action" | "event"
  }))
})

const storyScriptVals = computed<StoryValsFile>(() => {
  if (!storyDocument.value) {
    return {
      variables: []
    }
  }

  return {
    variables: [
      ...storyDocument.value.vals.variables,
      ...storyDocument.value.systemVals.variables
    ]
  }
})

const storyScriptItemIds = computed(() => {
  return storyDocument.value?.items.items.map((item) => item.id) ?? []
})

const phoneInvokeEventOptions = computed(() => {
  if (!storyDocument.value) {
    return []
  }

  const chainEvents = storyDocument.value.chainEvents
    .filter((event): event is StoryEventFile => isGraphEventNode(event))
    .filter((event) => normalizeEventTriggerMode(event) === "invoke")
    .map((event) => ({
      eventId: event.id,
      label: `[链] ${event.title} (${event.id})`,
      targetType: "chain" as const
    }))

  const poolEvents = storyDocument.value.poolEvents
    .filter((event) => normalizeEventTriggerMode(event) === "invoke")
    .map((event) => ({
      eventId: event.id,
      label: `[池] ${event.title} (${event.id})`,
      targetType: "pool" as const
    }))

  const scheduleEvents = storyDocument.value.scheduleEvents
    .filter((event) => normalizeEventTriggerMode(event) === "invoke")
    .map((event) => ({
      eventId: event.id,
      label: `[定时] ${event.title} (${event.id})`,
      targetType: "schedule" as const
    }))

  return [...chainEvents, ...poolEvents, ...scheduleEvents]
})

function buildGraphEventBranchAutocompleteItemsFromActions(
  actions: StoryActionFile[]
): StoryScriptAutocompleteItem[] {
  const actionItems = actions.flatMap((action) => {
    return action.vars.flatMap((actionVar) => {
      const branchName = normalizeStoryScriptAutocompleteText(actionVar.name)

      if (!branchName) {
        return []
      }

      const branchDescription = [
        action.title.trim() ? `来自操作 ${action.title.trim()}` : "",
        normalizeStoryScriptAutocompleteText(actionVar.descr)
      ]
        .filter(Boolean)
        .join(" / ")

      return [{
        name: `branch.${branchName}`,
        description: branchDescription || "前置操作连接变量"
      }]
    })
  })

  return mergeStoryScriptAutocompleteItems(actionItems)
}

const activeGraphBranchAutocompleteItems = computed<StoryScriptAutocompleteItem[]>(() => {
  if (activeEventTab.value !== "chain" || !storyDocument.value) {
    return []
  }

  const graphActions = storyDocument.value.chainEvents.filter(isGraphActionNode)
  const currentEventId = activeGraphDraftEvent.value?.id ?? null

  if (currentEventId) {
    const incomingActions = graphActions.filter((action) => action.next.includes(currentEventId))
    return buildGraphEventBranchAutocompleteItemsFromActions(incomingActions)
  }

  if (!activeGraphParentNodeId.value) {
    return []
  }

  const parentNode = storyDocument.value.chainEvents.find(
    (node) => node.id === activeGraphParentNodeId.value
  )

  if (!parentNode || !isGraphActionNode(parentNode)) {
    return []
  }

  return buildGraphEventBranchAutocompleteItemsFromActions([parentNode])
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

  if (collectionType === "pool") {
    const sourceEvents = storyDocument.value.poolEvents
    const typedSavedEvent = savedEvent as StoryOnceEventFile
    const hasExistingEvent = sourceEvents.some((currentEvent) => currentEvent.id === matchEventId)
    const nextEvents = hasExistingEvent
      ? sourceEvents.map((currentEvent) =>
          currentEvent.id === matchEventId ? typedSavedEvent : currentEvent
        )
      : [...sourceEvents, typedSavedEvent]

    storyDocument.value = {
      ...storyDocument.value,
      poolEvents: nextEvents,
      onceEvents: nextEvents
    }
    return
  }

  if (collectionType === "schedule") {
    const sourceEvents = storyDocument.value.scheduleEvents
    const typedSavedEvent = savedEvent as StoryLoopEventFile
    const hasExistingEvent = sourceEvents.some((currentEvent) => currentEvent.id === matchEventId)
    const nextEvents = hasExistingEvent
      ? sourceEvents.map((currentEvent) =>
          currentEvent.id === matchEventId ? typedSavedEvent : currentEvent
        )
      : [...sourceEvents, typedSavedEvent]

    storyDocument.value = {
      ...storyDocument.value,
      scheduleEvents: nextEvents,
      loopEvents: nextEvents
    }
    return
  }

  const sourceEvents = storyDocument.value.chainEvents
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
      chainEvents: nextEvents,
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
    chainEvents: nextEvents,
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

  if (collectionType === "pool") {
    const nextEvents = storyDocument.value.poolEvents.filter((event) => event.id !== eventId)
    storyDocument.value = {
      ...storyDocument.value,
      poolEvents: nextEvents,
      onceEvents: nextEvents
    }
    return
  }

  if (collectionType === "schedule") {
    const nextEvents = storyDocument.value.scheduleEvents.filter((event) => event.id !== eventId)
    storyDocument.value = {
      ...storyDocument.value,
      scheduleEvents: nextEvents,
      loopEvents: nextEvents
    }
    return
  }

  const nextEvents = storyDocument.value.chainEvents
    .filter((event) => event.id !== eventId)
    .map((event) =>
      event.next.includes(eventId)
        ? {
            ...event,
            next: event.next.filter((nextEventId) => nextEventId !== eventId)
          }
        : event
    )

  storyDocument.value = {
    ...storyDocument.value,
    chainEvents: nextEvents,
    graphEvents: nextEvents
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
  isPlayerOverrideValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isItemsDialogOpen.value = false
  isShopDialogOpen.value = false
  isPhoneDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  isValsDialogOpen.value = true
}

function closeValsDialog() {
  isValsDialogOpen.value = false
}

function openPlayerOverrideValsDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isItemsDialogOpen.value = false
  isShopDialogOpen.value = false
  isPhoneDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  isPlayerOverrideValsDialogOpen.value = true
}

function closePlayerOverrideValsDialog() {
  isPlayerOverrideValsDialogOpen.value = false
}

function openSystemValsDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isPlayerOverrideValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isItemsDialogOpen.value = false
  isShopDialogOpen.value = false
  isPhoneDialogOpen.value = false
  isReferDialogOpen.value = false
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
  isPlayerOverrideValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isItemsDialogOpen.value = false
  isShopDialogOpen.value = false
  isPhoneDialogOpen.value = false
  isReferDialogOpen.value = false
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
  isPlayerOverrideValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isItemsDialogOpen.value = false
  isShopDialogOpen.value = false
  isPhoneDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  locationsSaveSuccessMessage.value = null
  isLocationsDialogOpen.value = true
}

function closeLocationsDialog() {
  locationsSaveSuccessMessage.value = null
  isLocationsDialogOpen.value = false
}

function openItemsDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isPlayerOverrideValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isShopDialogOpen.value = false
  isPhoneDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  itemsSaveSuccessMessage.value = null
  isItemsDialogOpen.value = true
}

function closeItemsDialog() {
  itemsSaveSuccessMessage.value = null
  isItemsDialogOpen.value = false
}

function openShopDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isPlayerOverrideValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isItemsDialogOpen.value = false
  isPhoneDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  shopSaveSuccessMessage.value = null
  isShopDialogOpen.value = true
}

function closeShopDialog() {
  shopSaveSuccessMessage.value = null
  isShopDialogOpen.value = false
}

function openPhoneDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isPlayerOverrideValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isItemsDialogOpen.value = false
  isShopDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  phoneSaveSuccessMessage.value = null
  isPhoneDialogOpen.value = true
}

function closePhoneDialog() {
  phoneSaveSuccessMessage.value = null
  isPhoneDialogOpen.value = false
}

function openReferDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isPlayerOverrideValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isItemsDialogOpen.value = false
  isShopDialogOpen.value = false
  isPhoneDialogOpen.value = false
  isRolesDialogOpen.value = false
  referSaveSuccessMessage.value = null
  isReferDialogOpen.value = true
}

function closeReferDialog() {
  referSaveSuccessMessage.value = null
  isReferDialogOpen.value = false
}

function openRolesDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isPlayerOverrideValsDialogOpen.value = false
  isSystemValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isItemsDialogOpen.value = false
  isShopDialogOpen.value = false
  isPhoneDialogOpen.value = false
  isReferDialogOpen.value = false
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

function createHistoryId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function getActiveCreationHistorySession() {
  if (!activeCreationHistorySessionId.value) {
    return null
  }

  return creationHistory.value.sessions.find((session) => session.id === activeCreationHistorySessionId.value) ?? null
}

function upsertLocalCreationHistorySession(session: StoryCreationHistorySession) {
  creationHistory.value = {
    sessions: [
      session,
      ...creationHistory.value.sessions.filter((item) => item.id !== session.id)
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }
}

async function persistCreationHistorySession(session: StoryCreationHistorySession) {
  try {
    const response = await saveStoryCreationHistorySession(props.storyId, session)
    creationHistory.value = response.history
  } catch (error) {
    console.error("[web] failed to save creation history", error)
  }
}

function createCreationHistorySession(instruction: string): StoryCreationHistorySession {
  const now = new Date().toISOString()
  return {
    id: createHistoryId("creation"),
    title: instruction.slice(0, 40) || "未命名创作",
    status: "running",
    createdAt: now,
    updatedAt: now,
    initialInstruction: instruction,
    turns: []
  }
}

function buildCreationHistoryTurn(
  mode: StoryCreationAgentRunMode,
  instruction: string,
  response: RunStoryCreationAgentResponse | null,
  error?: string
): StoryCreationHistoryTurn {
  const now = new Date().toISOString()
  return {
    id: createHistoryId("turn"),
    mode,
    instruction,
    status: error ? "failed" : "done",
    createdAt: now,
    completedAt: now,
    ...(error ? { error } : {}),
    ...(response ? { response } : {})
  }
}

function handleRestoreCreationHistorySession(session: StoryCreationHistorySession) {
  activeCreationHistorySessionId.value = session.id
  creationAgentResult.value = session.currentDraft
    ? {
        draft: session.currentDraft,
        logs: session.turns.at(-1)?.response?.logs ?? []
      }
    : (session.turns.at(-1)?.response ?? null)
  creationApplyMessage.value = session.applied?.message ?? null
  creationApplyWarnings.value = session.applied?.warnings ?? []
  creationAgentError.value = null
  errorMessage.value = null
}

async function handleDeleteCreationHistorySession(session: StoryCreationHistorySession) {
  if (isAgentRunning.value && activeCreationHistorySessionId.value === session.id) {
    errorMessage.value = "当前创作任务还在运行中，请先中止后再删除记录。"
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const response = await deleteStoryCreationHistorySession(props.storyId, session.id)
    creationHistory.value = response.history

    if (activeCreationHistorySessionId.value === session.id) {
      activeCreationHistorySessionId.value = null
      creationAgentResult.value = null
      creationAgentRunMode.value = null
      creationAgentError.value = null
      creationApplyMessage.value = null
      creationApplyWarnings.value = []
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "删除创作记录失败。"
  } finally {
    isSaving.value = false
  }
}

async function loadStory() {
  isLoading.value = true
  errorMessage.value = null
  exportPath.value = null
  creationAgentResult.value = null
  creationAgentRunMode.value = null
  creationAgentError.value = null
  creationApplyMessage.value = null
  creationApplyWarnings.value = []
  creationHistory.value = { sessions: [] }
  activeCreationHistorySessionId.value = null
  referSaveSuccessMessage.value = null
  doingSaveSuccessMessage.value = null

  try {
    const [story, settings, history] = await Promise.all([
      getStory(props.storyId),
      getAppSettings(),
      getStoryCreationHistory(props.storyId)
    ])
    storyDocument.value = story
    appSettings.value = settings
    creationHistory.value = history

    for (const collectionType of ["chain", "pool", "schedule"] as EventCanvasTab[]) {
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
  if (!isEventCanvasTab(activeEventTab.value)) {
    return
  }

  projectStore.selectEvent(props.storyId, activeEventTab.value, eventId)
}

function handleEditEvent(eventId: string) {
  if (!isEventCanvasTab(activeEventTab.value)) {
    return
  }

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
    trigger_mode: "default",
    trigger_expr: "",
    invoke_params: [],
    init_script: "",
    end_script: "",
    object_keys: [],
    presentation: { type: "silent" },
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
    trigger_mode: "default",
    trigger_expr: "",
    invoke_params: [],
    init_script: "",
    end_script: "",
    object_keys: [],
    presentation: { type: "silent" },
    location: "",
    next: []
  }
}

function buildNewStandaloneEvent(): StoryAnyEventFile {
  if (activeEventTab.value === "pool") {
    const event: StoryOnceEventFile = {
      id: createUniqueEventId("pool-event"),
      title: "新事件",
      trigger_mode: "default",
      trigger_expr: "",
      invoke_params: [],
      init_script: "",
      object_keys: [],
      presentation: { type: "silent" },
      location: "",
      bgm: "",
      end_script: ""
    }

    return event
  }

  if (activeEventTab.value === "schedule") {
    const event: StoryLoopEventFile = {
      id: createUniqueEventId("schedule-event"),
      title: "新定时事件",
      trigger_mode: "default",
      trigger_expr: "",
      invoke_params: [],
      init_script: "",
      object_keys: [],
      presentation: { type: "silent" },
      location: "",
      bgm: "",
      end_script: "",
      loop: {
        mode: "daily",
        at: "00:00",
        priority: 100,
        after: [],
        before: []
      }
    }

    return event
  }

  const defaultId = "event"

  return {
    id: createUniqueEventId(defaultId),
    title: "新事件",
    trigger_mode: "default",
    trigger_expr: "",
    invoke_params: [],
    init_script: "",
    end_script: "",
    object_keys: [],
    presentation: { type: "silent" },
    location: "",
    next: []
  }
}

function handleCreateGraphEvent(parentEventId: string) {
  creatingFromEventId.value = parentEventId
  editingEventId.value = null
  creatingEventDraft.value = buildNewEventFromParent(parentEventId)
  projectStore.selectEvent(props.storyId, "chain", parentEventId)
}

function handleCreateGraphAction(parentEventId: string) {
  creatingFromEventId.value = parentEventId
  editingEventId.value = null
  creatingEventDraft.value = buildNewActionFromParent(parentEventId)
  projectStore.selectEvent(props.storyId, "chain", parentEventId)
}

function handleCreateGraphRootEvent() {
  creatingFromEventId.value = null
  editingEventId.value = null
  creatingEventDraft.value = buildNewRootEvent()
  projectStore.clearEvent(props.storyId, "chain")
}

function handleCreateStandaloneEvent() {
  if (!isEventCanvasTab(activeEventTab.value)) {
    return
  }

  creatingFromEventId.value = null
  editingEventId.value = null
  creatingEventDraft.value = buildNewStandaloneEvent()
  projectStore.clearEvent(props.storyId, activeEventTab.value)
}

function handleSwitchEventTab(tab: EventWorkbenchTab) {
  if (activeEventTab.value === tab) {
    return
  }

  closeEditor()
  doingSaveSuccessMessage.value = null
  activeEventTab.value = tab
}

function handleSwitchWorkspaceTab(tab: StoryWorkspaceTab) {
  if (activeWorkspaceTab.value === tab) {
    return
  }

  closeEditor()
  activeWorkspaceTab.value = tab
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
  if (!isEventCanvasTab(activeEventTab.value)) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const collectionType = activeEventTab.value
    const isCreatingDraft = isCreateMode.value
    const parentEventId = collectionType === "chain" ? creatingFromEventId.value : null
    const previousEventId = projectStore.getSelectedEventId(props.storyId, collectionType) ?? event.id
    const currentEvents =
      collectionType === "chain" ? getGraphNodes() : getEventsByCollectionType(collectionType)
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
  if (!storyDocument.value || !isEventCanvasTab(activeEventTab.value)) {
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

async function handleSavePlayerOverrideVals(playerOverrideVals: StoryPlayerOverrideValsFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const savedPlayerOverrideVals = await savePlayerOverrideVals(props.storyId, playerOverrideVals)
    storyDocument.value = {
      ...storyDocument.value,
      playerOverrideVals: savedPlayerOverrideVals
    }
    isPlayerOverrideValsDialogOpen.value = false
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存玩家覆盖变量失败。"
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

async function handleSaveItems(items: StoryItemsFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  itemsSaveSuccessMessage.value = null

  try {
    const savedItems = await saveItems(props.storyId, items)
    storyDocument.value = {
      ...storyDocument.value,
      items: savedItems
    }
    itemsSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存物品失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveShop(shop: StoryShopFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  shopSaveSuccessMessage.value = null

  try {
    const savedShop = await saveShop(props.storyId, shop)
    storyDocument.value = {
      ...storyDocument.value,
      shop: savedShop
    }
    shopSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存商城失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSavePhone(phone: StoryPhoneFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  phoneSaveSuccessMessage.value = null

  try {
    const savedPhone = await savePhone(props.storyId, phone)
    storyDocument.value = {
      ...storyDocument.value,
      phone: savedPhone
    }
    phoneSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存手机联系人配置失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveRefer(refer: StoryReferFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  referSaveSuccessMessage.value = null

  try {
    const savedRefer = await saveRefer(props.storyId, refer)
    storyDocument.value = {
      ...storyDocument.value,
      refer: savedRefer
    }
    referSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存称谓配置失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveDoing(doing: StoryDoingFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  doingSaveSuccessMessage.value = null

  try {
    const savedDoing = await saveDoing(props.storyId, doing)
    storyDocument.value = {
      ...storyDocument.value,
      doing: savedDoing
    }
    doingSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存行动配置失败。"
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

async function handleSaveStoryBible(storyBible: StoryBibleFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const savedStoryBible = await saveStoryBible(props.storyId, storyBible)
    storyDocument.value = {
      ...storyDocument.value,
      storyBible: savedStoryBible
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存创作设定失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleRunCreationAgent(instruction: string, baseDraft?: StoryCreationDraft) {
  if (!storyDocument.value || isAgentRunning.value) {
    return
  }

  const runMode: StoryCreationAgentRunMode = baseDraft ? "feedback" : "new"
  const startedAt = new Date().toISOString()
  let historySession = runMode === "new"
    ? createCreationHistorySession(instruction)
    : getActiveCreationHistorySession()

  if (!historySession) {
    historySession = createCreationHistorySession(instruction)
  }

  historySession = {
    ...historySession,
    status: "running",
    updatedAt: startedAt
  }
  activeCreationHistorySessionId.value = historySession.id
  upsertLocalCreationHistorySession(historySession)

  isAgentRunning.value = true
  creationAgentRunMode.value = runMode
  creationAgentError.value = null
  errorMessage.value = null
  if (!baseDraft) {
    creationAgentResult.value = null
  }
  creationApplyMessage.value = null
  creationApplyWarnings.value = []
  creationAgentAbortController.value = new AbortController()

  try {
    const result = await runStoryCreationAgent(
      props.storyId,
      instruction,
      baseDraft,
      creationAgentAbortController.value.signal
    )
    creationAgentResult.value = result

    const now = new Date().toISOString()
    const nextSession: StoryCreationHistorySession = {
      ...historySession,
      title: result.draft.title || historySession.title,
      status: "draft",
      updatedAt: now,
      currentDraft: result.draft,
      turns: [
        ...historySession.turns,
        buildCreationHistoryTurn(runMode, instruction, result)
      ]
    }
    upsertLocalCreationHistorySession(nextSession)
    activeCreationHistorySessionId.value = nextSession.id
    await persistCreationHistorySession(nextSession)
  } catch (error) {
    if (isAbortError(error)) {
      const now = new Date().toISOString()
      const nextSession: StoryCreationHistorySession = {
        ...historySession,
        status: "cancelled",
        updatedAt: now,
        turns: [
          ...historySession.turns,
          {
            ...buildCreationHistoryTurn(runMode, instruction, null, "已中止"),
            status: "cancelled"
          }
        ]
      }
      upsertLocalCreationHistorySession(nextSession)
      activeCreationHistorySessionId.value = nextSession.id
      await persistCreationHistorySession(nextSession)
      return
    }

    const message = error instanceof Error ? error.message : "AI 创作 Agent 运行失败。"
    creationAgentError.value = message
    errorMessage.value = message
    const now = new Date().toISOString()
    const nextSession: StoryCreationHistorySession = {
      ...historySession,
      status: "failed",
      updatedAt: now,
      turns: [
        ...historySession.turns,
        buildCreationHistoryTurn(runMode, instruction, null, message)
      ]
    }
    upsertLocalCreationHistorySession(nextSession)
    activeCreationHistorySessionId.value = nextSession.id
    await persistCreationHistorySession(nextSession)
  } finally {
    isAgentRunning.value = false
    creationAgentRunMode.value = null
    creationAgentAbortController.value = null
  }
}

function handleAbortCreationAgent() {
  creationAgentAbortController.value?.abort()
}

function isAbortError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.name === "AbortError" || error.message.includes("aborted")
}

function selectAppliedEvent(selection: ApplyStoryCreationDraftSelection) {
  const firstEventKey = selection.eventKeys[0]
  if (!firstEventKey) {
    return
  }

  const [collectionType, eventId] = firstEventKey.split(":")
  if (
    !eventId ||
    (collectionType !== "chain" && collectionType !== "pool" && collectionType !== "schedule")
  ) {
    return
  }

  activeEventTab.value = collectionType
  projectStore.selectEvent(props.storyId, collectionType, eventId)
}

async function handleApplyCreationDraft(
  draft: StoryCreationDraft,
  selection: ApplyStoryCreationDraftSelection
) {
  if (!storyDocument.value || isCreationDraftApplying.value) {
    return
  }

  isCreationDraftApplying.value = true
  errorMessage.value = null
  creationApplyMessage.value = null
  creationApplyWarnings.value = []

  try {
    const response = await applyStoryCreationDraft(props.storyId, {
      draft,
      selection
    })

    storyDocument.value = response.story
    validation.value = response.result
    creationApplyWarnings.value = response.warnings
    creationApplyMessage.value = `已应用 ${response.applied.events} 个事件、${response.applied.locations} 个地点、${response.applied.roles} 个角色、${response.applied.items} 个物品、${response.applied.variables} 个变量、${response.applied.shopCategories} 个商城分类、${response.applied.shopProducts} 个商城商品。`
    const activeSession = getActiveCreationHistorySession()
    if (activeSession) {
      const now = new Date().toISOString()
      const nextSession: StoryCreationHistorySession = {
        ...activeSession,
        status: "applied",
        updatedAt: now,
        currentDraft: draft,
        applied: {
          appliedAt: now,
          message: creationApplyMessage.value,
          selection,
          applied: response.applied,
          warnings: response.warnings,
          draft
        }
      }
      upsertLocalCreationHistorySession(nextSession)
      await persistCreationHistorySession(nextSession)
    }
    closeEditor()
    selectAppliedEvent(selection)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "应用 AI 草稿失败。"
  } finally {
    isCreationDraftApplying.value = false
  }
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
    if (collectionType !== "chain") {
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
    isPlayerOverrideValsDialogOpen.value = false
    isSystemValsDialogOpen.value = false
    isScenesDialogOpen.value = false
    isLocationsDialogOpen.value = false
    isItemsDialogOpen.value = false
    isShopDialogOpen.value = false
    isPhoneDialogOpen.value = false
    isReferDialogOpen.value = false
    isRolesDialogOpen.value = false
    activeWorkspaceTab.value = "creation"
    creationAgentResult.value = null
    creationAgentRunMode.value = null
    creationAgentError.value = null
    creationApplyMessage.value = null
    creationApplyWarnings.value = []
    scenesSaveSuccessMessage.value = null
    locationsSaveSuccessMessage.value = null
    itemsSaveSuccessMessage.value = null
    shopSaveSuccessMessage.value = null
    phoneSaveSuccessMessage.value = null
    referSaveSuccessMessage.value = null
    doingSaveSuccessMessage.value = null
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
          <button
            class="btn-secondary editor-header__tool-button"
            type="button"
            @click="openPlayerOverrideValsDialog"
          >
            玩家覆盖变量
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
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openItemsDialog">
            物品
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openShopDialog">
            商城
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openPhoneDialog">
            手机
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openReferDialog">
            称谓
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

    <div v-if="storyDocument" class="editor-workspace-tabs" role="tablist" aria-label="故事工作区">
      <button
        v-for="tab in workspaceTabOptions"
        :key="tab.key"
        class="editor-workspace-tabs__button"
        :class="{ 'editor-workspace-tabs__button--active': activeWorkspaceTab === tab.key }"
        type="button"
        role="tab"
        :aria-selected="activeWorkspaceTab === tab.key"
        @click="handleSwitchWorkspaceTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <section v-if="activeWorkspaceTab === 'events' || (isLoading && !storyDocument)" class="editor-main">
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

    <StoryCreationWorkspace
      v-if="storyDocument && activeWorkspaceTab === 'creation'"
      :agent-result="creationAgentResult"
      :agent-run-mode="creationAgentRunMode"
      :agent-running="isAgentRunning"
      :agent-error="creationAgentError"
      :apply-message="creationApplyMessage"
      :apply-warnings="creationApplyWarnings"
      :applying="isCreationDraftApplying"
      :creation-history="creationHistory"
      :active-history-session-id="activeCreationHistorySessionId"
      :settings="appSettings"
      :saving="isSaving"
      :story="storyDocument"
      @apply-draft="handleApplyCreationDraft"
      @abort-agent="handleAbortCreationAgent"
      @delete-history-session="handleDeleteCreationHistorySession"
      @restore-history-session="handleRestoreCreationHistorySession"
      @run-agent="handleRunCreationAgent"
      @save-story-bible="handleSaveStoryBible"
    />

    <section v-if="storyDocument && activeWorkspaceTab === 'events'" class="editor-canvas-band">
      <div class="editor-event-tabs">
        <div class="editor-event-tabs__tablist" role="tablist" aria-label="剧情事件类型">
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

        <div v-if="isEventCanvasTab(activeEventTab)" class="editor-trigger-filter" role="group" aria-label="触发方式筛选">
          <span class="editor-trigger-filter__label">触发</span>
          <button
            v-for="option in eventTriggerFilterOptions"
            :key="option.key"
            class="editor-trigger-filter__button"
            :class="{ 'editor-trigger-filter__button--active': eventTriggerFilter === option.key }"
            type="button"
            @click="eventTriggerFilter = option.key"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <StoryGraphCanvas
        v-if="activeEventTab === 'chain'"
        :events="filteredGraphCanvasEvents"
        :selected-event-id="selectedEventId"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @delete="handleDeleteGraphNode"
        @create="handleCreateGraphEvent"
        @create-action="handleCreateGraphAction"
        @create-root="handleCreateGraphRootEvent"
        @toggle-link="handleToggleLink"
      />

      <StoryOnceCanvas
        v-else-if="activeEventTab === 'pool'"
        :events="filteredOnceCanvasEvents"
        :selected-event-id="selectedEventId"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @delete="handleDeleteEvent"
        @create="handleCreateStandaloneEvent"
      />

      <StoryLoopEventCanvas
        v-else-if="activeEventTab === 'schedule'"
        :events="filteredLoopCanvasEvents"
        :selected-event-id="selectedEventId"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @delete="handleDeleteEvent"
        @create="handleCreateStandaloneEvent"
      />

      <StoryDoingDialog
        v-else-if="activeEventTab === 'doing'"
        embedded
        :doing="storyDocument.doing"
        :item-ids="storyScriptItemIds"
        :roles="storyDocument.roles"
        :save-success-message="doingSaveSuccessMessage"
        :saving="isSaving"
        :story="storyDocument"
        :vals="storyScriptVals"
        @quick-create-location="handleQuickCreateLocation"
        @quick-create-role="handleQuickCreateRole"
        @save="handleSaveDoing"
      />
    </section>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="storyDocument && activeWorkspaceTab === 'events' && isEventCanvasTab(activeEventTab) && (editingEvent || creatingEventDraft)"
          class="editor-modal"
          @click.self="closeEditor"
        >
          <div class="editor-modal__panel">
            <GraphEventDetailPanel
              v-if="activeEventTab === 'chain' && activeGraphDraftEvent"
              :event="activeGraphDraftEvent"
              :branch-autocomplete-items="activeGraphBranchAutocompleteItems"
              :event-locations="storyDocument.eventLocations"
              :graph-node-options="graphNodeOptions"
              :mode="isCreateMode ? 'create' : 'edit'"
              :parent-event-id="activeGraphParentNodeId"
              :roles="storyDocument.roles"
              :saving="isSaving"
              :item-ids="storyScriptItemIds"
              :story="storyDocument"
              :vals="storyScriptVals"
              @close="closeEditor"
              @quick-create-location="handleQuickCreateLocation"
              @quick-create-role="handleQuickCreateRole"
              @save="handleSaveEvent"
            />
            <GraphActionDetailPanel
              v-else-if="activeEventTab === 'chain' && activeGraphDraftAction"
              :action="activeGraphDraftAction"
              :graph-node-options="graphNodeOptions"
              :mode="isCreateMode ? 'create' : 'edit'"
              :saving="isSaving"
              :story="storyDocument"
              :vals="storyScriptVals"
              @close="closeEditor"
              @save="handleSaveEvent"
            />
            <OnceEventDetailPanel
              v-else-if="activeEventTab === 'pool'"
              :event="activeDraftEvent as StoryOnceEventFile | null"
              :event-locations="storyDocument.eventLocations"
              :mode="isCreateMode ? 'create' : 'edit'"
              :roles="storyDocument.roles"
              :saving="isSaving"
              :scenes="storyDocument.scenes"
              :item-ids="storyScriptItemIds"
              :story="storyDocument"
              :vals="storyScriptVals"
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
              :schedule-events="storyDocument.scheduleEvents"
              :item-ids="storyScriptItemIds"
              :story="storyDocument"
              :vals="storyScriptVals"
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

    <StoryPlayerOverrideValsDialog
      v-if="storyDocument && isPlayerOverrideValsDialogOpen"
      :player-override-vals="storyDocument.playerOverrideVals"
      :saving="isSaving"
      :vals="storyDocument.vals"
      @close="closePlayerOverrideValsDialog"
      @save="handleSavePlayerOverrideVals"
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

    <StoryItemsDialog
      v-if="storyDocument && isItemsDialogOpen"
      :items="storyDocument.items"
      :save-success-message="itemsSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :story-title="storyDocument.story.title"
      @close="closeItemsDialog"
      @save="handleSaveItems"
    />

    <StoryShopDialog
      v-if="storyDocument && isShopDialogOpen"
      :items="storyDocument.items"
      :save-success-message="shopSaveSuccessMessage"
      :saving="isSaving"
      :shop="storyDocument.shop"
      :story="storyDocument"
      :vals="storyScriptVals"
      @close="closeShopDialog"
      @save="handleSaveShop"
    />

    <StoryPhoneDialog
      v-if="storyDocument && isPhoneDialogOpen"
      :item-ids="storyScriptItemIds"
      :invoke-event-options="phoneInvokeEventOptions"
      :phone="storyDocument.phone"
      :roles="storyDocument.roles"
      :save-success-message="phoneSaveSuccessMessage"
      :saving="isSaving"
      @close="closePhoneDialog"
      @save="handleSavePhone"
    />

    <StoryReferDialog
      v-if="storyDocument && isReferDialogOpen"
      :refer="storyDocument.refer"
      :save-success-message="referSaveSuccessMessage"
      :saving="isSaving"
      @close="closeReferDialog"
      @save="handleSaveRefer"
    />

    <StoryRolesDialog
      v-if="storyDocument && isRolesDialogOpen"
      :phone="storyDocument.phone"
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

.editor-workspace-tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  margin: 0 0 6px;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.editor-workspace-tabs__button {
  min-height: 30px;
  padding: 0 14px;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.82rem;
  white-space: nowrap;
}

.editor-workspace-tabs__button:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.editor-workspace-tabs__button--active {
  background: rgba(255, 180, 84, 0.9);
  color: #1d1200;
  font-weight: 700;
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
  align-items: flex-end;
  justify-content: space-between;
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

.editor-event-tabs__tablist {
  display: flex;
  gap: 2px;
  min-width: 0;
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

.editor-trigger-filter {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 8px auto;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
}

.editor-trigger-filter__label {
  padding: 0 7px 0 9px;
  color: var(--text-muted);
  font-size: 0.76rem;
}

.editor-trigger-filter__button {
  min-height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.78rem;
  cursor: pointer;
  white-space: nowrap;
}

.editor-trigger-filter__button:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.06);
}

.editor-trigger-filter__button--active {
  color: #07121d;
  background: rgba(124, 227, 195, 0.9);
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
.editor-canvas-band :deep(.once-board),
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
