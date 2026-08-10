/**
 * 创建 StoryEditorShell 及各子控制器共享的“单一状态源”。
 *
 * 这里集中取得 API、任务、文档、事件工作台和工具弹窗 composable，并只声明源状态与纯 computed。
 * Lifecycle/EventActions/AssetActions/CreationActions 都接收本函数返回的同一个 controller，因此不会
 * 各自复制一份当前故事、当前事件或保存状态。
 *
 * 输入来源：Shell 的只读 `storyId` prop，以及更小 composable 暴露的 typed state/actions。
 * 输出去向：StoryEditorShell 模板和四个副作用 controller。
 * 不负责：页面加载时机、API 写请求、任务运行和 UI 渲染。
 */
import type {
  AppSettingsFile,
  StoryAnyEventFile,
  StoryActionFile,
  StoryBibleFile,
  StoryDoingFile,
  StoryEventFile,
  StoryEventLocationFile,
  StoryContactFile,
  StoryReferFile,
  StoryItemsFile,
  StoryLoopEventFile,
  StoryMetaFile,
  StoryOnceEventFile,
  StoryPlayerOverrideValsFile,
  StoryContactConversationsFile,
  StoryRolesFile,
  StorySceneFile,
  StoryShopFile,
  StoryValsFile,
  ValidationIssue
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
import type { EventCanvasTab, EventWorkbenchTab } from "~/composables/useStoryEventWorkbench"
import { appendQuickLocationToEventLocations } from "./storyQuickLocation"
import { appendQuickRoleToRoles } from "./storyQuickRole"
import {
  mergeStoryScriptAutocompleteItems,
  normalizeStoryScriptAutocompleteText,
  type StoryScriptAutocompleteItem
} from "./storyScriptEditor"

import { computed, ref, shallowRef, watch } from "vue"
import { useProjectStore } from "../../stores/project"
import { useStoryApi } from "../../composables/useStoryApi"
import { useStoryCreationTask } from "../../composables/useStoryCreationTask"
import { useStoryEditorDocument } from "../../composables/useStoryEditorDocument"
import { useStoryEditorTools } from "../../composables/useStoryEditorTools"
import { useStoryEventWorkbench } from "../../composables/useStoryEventWorkbench"

type StoryWorkspaceTab = "creation" | "events"
type StoryCreationAgentRunMode = "new" | "feedback"

export interface StoryEditorShellProps {
  storyId: string
}

/**
 * 初始化编辑器共享状态、纯派生值和本地文档替换工具。
 *
 * 大型 `StoryDocument` 由 `useStoryEditorDocument` 使用 shallowRef 持有：Vue 只在根对象被替换时更新，
 * 不为几千个嵌套字段创建深层代理。所有保存响应都采用“替换根对象”的方式，因此既能触发界面，
 * 又避免大文档深响应式成本。
 */
export function useStoryEditorState(props: Readonly<StoryEditorShellProps>) {
// API 在组合根一次取得，再显式传给 Actions controller。这样子组件无需直接依赖全局请求客户端。
const projectStore = useProjectStore()
const {
  applyStoryCreationDraft,
  deleteEvent,
  exportStory,
  getAppSettings,
  getStoryCreationHistory,
  getStory,
  deleteStoryCreationHistorySession,
  saveAppSettings,
  saveEvent,
  saveEventLocations,
  saveDoing,
  saveStoryMeta,
  saveStoryCreationHistorySession,
  saveItems,
  saveContact,
  saveContactConversations,
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
const {
  activeJob: creationJob,
  cancel: cancelCreationTask,
  resumeLatest: resumeCreationTask,
  run: runCreationTask
} = useStoryCreationTask(() => props.storyId)

const {
  appSettings,
  errorMessage,
  exportPath,
  isExporting,
  isLoading,
  isSaving,
  issueSummary,
  storyDocument,
  validation
} = useStoryEditorDocument()
const {
  activeEventTab,
  activeEventTabLabel,
  activeEvents,
  activeGraphEvents,
  activeLoopEvents,
  activeOnceEvents,
  eventTabOptions,
  eventTriggerFilter,
  eventTriggerFilterOptions,
  filteredGraphCanvasEvents,
  filteredLoopCanvasEvents,
  filteredOnceCanvasEvents,
  getEventsByCollectionType,
  getGraphNodes,
  isEventCanvasTab,
  isGraphActionNode,
  isGraphEventNode,
  normalizeEventTriggerMode
} = useStoryEventWorkbench(storyDocument)

// AI 任务与草稿应用是两个独立 busy 状态：任务生成期间仍可能查看旧草稿，应用期间则只锁提交按钮。
// 标量与大结果对象使用 shallowRef；只有创作历史数组需要深层响应式编辑，因此使用 ref。
const isAgentRunning = shallowRef(false)
const isCreationDraftApplying = shallowRef(false)
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

// 工具 composable 只拥有“哪个弹窗打开”的布尔 Ref；具体 open/close 互斥规则在 Lifecycle 中。
const {
  closeAllTools,
  isValsDialogOpen,
  isPlayerOverrideValsDialogOpen,
  isSystemValsDialogOpen,
  isScenesDialogOpen,
  isLocationsDialogOpen,
  isItemsDialogOpen,
  isShopDialogOpen,
  isContactDialogOpen,
  isReferDialogOpen,
  isRolesDialogOpen,
  isSettingsDialogOpen,
  isGameSettingsDialogOpen
} = useStoryEditorTools()
const scenesSaveSuccessMessage = shallowRef<string | null>(null)
const locationsSaveSuccessMessage = shallowRef<string | null>(null)
const itemsSaveSuccessMessage = shallowRef<string | null>(null)
const shopSaveSuccessMessage = shallowRef<string | null>(null)
const contactSaveSuccessMessage = shallowRef<string | null>(null)
const contactConversationsSaveErrorMessage = shallowRef<string | null>(null)
const contactConversationsSaveSuccessMessage = shallowRef<string | null>(null)
const referSaveSuccessMessage = shallowRef<string | null>(null)
const doingSaveSuccessMessage = shallowRef<string | null>(null)
const rolesSaveSuccessMessage = shallowRef<string | null>(null)
const activeWorkspaceTab = shallowRef<StoryWorkspaceTab>("creation")

const workspaceTabOptions: Array<{ key: StoryWorkspaceTab; label: string }> = [
  { key: "creation", label: "创作" },
  { key: "events", label: "事件" }
]

const selectedEventId = computed(() =>
  isEventCanvasTab(activeEventTab.value)
    ? projectStore.getSelectedEventId(props.storyId, activeEventTab.value)
    : null
)

// 事件选择、正在编辑项和创建草稿分开保存：选中节点不等于已打开编辑器，新建草稿也还不属于
// storyDocument。这样取消新建不会污染正式文档，保存成功后才由 Actions 替换源状态。
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

// StoryScript 编辑器需要同时“看见”全局与系统变量才能补全和校验引用，但可写权限仍由校验器决定；
// 合并到预览对象不代表系统变量变成可写。
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

const contactInvokeEventOptions = computed(() => {
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

/**
 * 把前置 action 的局部变量转换成 `branch.xxx` 自动补全项。
 *
 * 只有真正连向当前事件的 action 变量才可见，避免编辑器提示一个运行时根本不会传入的分支值。
 */
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

/**
 * 用服务端保存结果新增/替换本地事件，并通过替换 StoryDocument 根对象触发 shallowRef 更新。
 *
 * `matchEventId` 允许处理“编辑时修改了 id”：按旧 id 找到原位置，再放入服务端返回的新事件。
 * 此函数只做内存同步，不调用 API，也不改变当前选中项。
 */
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
      poolEvents: nextEvents
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
      scheduleEvents: nextEvents
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
      chainEvents: nextEvents
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
    chainEvents: nextEvents
  }
}

/**
 * 从本地文档移除事件。
 *
 * 删除 chain 节点时还会清理所有指向它的 `next`，让画布立即与服务端删除结果一致；更广泛的业务
 * 引用由随后执行的全篇 validation 展示给用户。
 */
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
      poolEvents: nextEvents
    }
    return
  }

  if (collectionType === "schedule") {
    const nextEvents = storyDocument.value.scheduleEvents.filter((event) => event.id !== eventId)
    storyDocument.value = {
      ...storyDocument.value,
      scheduleEvents: nextEvents
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
    chainEvents: nextEvents
  }
}

  return {
    props, projectStore, isAgentRunning, isCreationDraftApplying, creationAgentResult,
    creationAgentRunMode, creationAgentError, creationApplyMessage, creationApplyWarnings,
    creationHistory, activeCreationHistorySessionId, editingEventId, creatingFromEventId,
    creatingEventDraft, scenesSaveSuccessMessage, locationsSaveSuccessMessage, itemsSaveSuccessMessage,
    shopSaveSuccessMessage, contactSaveSuccessMessage, contactConversationsSaveErrorMessage, contactConversationsSaveSuccessMessage,
    referSaveSuccessMessage, doingSaveSuccessMessage, rolesSaveSuccessMessage, activeWorkspaceTab,
    workspaceTabOptions, selectedEventId, selectedEvent, editingEvent,
    activeDraftEvent, activeGraphParentNodeId, activeGraphDraftEvent, activeGraphDraftAction,
    graphNodeOptions, storyScriptVals, storyScriptItemIds, contactInvokeEventOptions,
    buildGraphEventBranchAutocompleteItemsFromActions, activeGraphBranchAutocompleteItems, isCreateMode, replaceEventInDocument,
    removeEventFromDocument, applyStoryCreationDraft, deleteEvent, exportStory,
    getAppSettings, getStoryCreationHistory, getStory, deleteStoryCreationHistorySession,
    saveAppSettings, saveEvent, saveEventLocations, saveDoing,
    saveStoryMeta, saveStoryCreationHistorySession, saveItems, saveContact,
    saveContactConversations, saveRefer, saveShop, savePlayerOverrideVals,
    saveRoles, saveScenes, saveStoryBible, saveSystemVals,
    saveVals, validateStory, creationJob, cancelCreationTask,
    resumeCreationTask, runCreationTask, appSettings, errorMessage,
    exportPath, isExporting, isLoading, isSaving,
    issueSummary, storyDocument, validation, activeEventTab,
    activeEventTabLabel, activeEvents, activeGraphEvents, activeLoopEvents,
    activeOnceEvents, eventTabOptions, eventTriggerFilter, eventTriggerFilterOptions,
    filteredGraphCanvasEvents, filteredLoopCanvasEvents, filteredOnceCanvasEvents, getEventsByCollectionType,
    getGraphNodes, isEventCanvasTab, isGraphActionNode, isGraphEventNode,
    normalizeEventTriggerMode, closeAllTools, isValsDialogOpen, isPlayerOverrideValsDialogOpen,
    isSystemValsDialogOpen, isScenesDialogOpen, isLocationsDialogOpen, isItemsDialogOpen,
    isShopDialogOpen, isContactDialogOpen, isReferDialogOpen, isRolesDialogOpen,
    isSettingsDialogOpen, isGameSettingsDialogOpen
  }
}

export type StoryEditorStateController = ReturnType<typeof useStoryEditorState>
