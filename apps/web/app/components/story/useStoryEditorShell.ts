/**
 * 故事编辑器组合控制器：把文档、事件工作台、AI 创作与工具弹窗连接起来。
 * 它不渲染界面，所有可见状态由 StoryEditorShell.vue 消费。
 */
import type {
  AppSettingsFile,
  StoryAnyEventFile,
  StoryActionFile,
  StoryBibleFile,
  StoryDoingFile,
  StoryEventFile,
  StoryEventLocationFile,
  StoryPhoneFile,
  StoryReferFile,
  StoryItemsFile,
  StoryLoopEventFile,
  StoryMetaFile,
  StoryOnceEventFile,
  StoryPlayerOverrideValsFile,
  StoryPhoneConversationsFile,
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
import { useStoryEditorAssetActions } from "./useStoryEditorAssetActions"
import { useStoryEditorCreationActions } from "./useStoryEditorCreationActions"
import { useStoryEditorEventActions } from "./useStoryEditorEventActions"
import { useStoryEditorLifecycle } from "./useStoryEditorLifecycle"
import { useStoryEditorState } from "./useStoryEditorState"

/** 创建编辑器外壳控制器；这里只组合领域模块并处理首次加载。 */
export function useStoryEditorShell(props: Readonly<StoryEditorShellProps>) {
  const state = useStoryEditorState(props)
  const {
    projectStore, isAgentRunning, isCreationDraftApplying, creationAgentResult,
    creationAgentRunMode, creationAgentError, creationApplyMessage, creationApplyWarnings,
    creationHistory, activeCreationHistorySessionId, editingEventId, creatingFromEventId,
    creatingEventDraft, scenesSaveSuccessMessage, locationsSaveSuccessMessage, itemsSaveSuccessMessage,
    shopSaveSuccessMessage, phoneSaveSuccessMessage, phoneConversationsSaveErrorMessage, phoneConversationsSaveSuccessMessage,
    referSaveSuccessMessage, doingSaveSuccessMessage, rolesSaveSuccessMessage, activeWorkspaceTab,
    workspaceTabOptions, selectedEventId, selectedEvent, editingEvent,
    activeDraftEvent, activeGraphParentNodeId, activeGraphDraftEvent, activeGraphDraftAction,
    graphNodeOptions, storyScriptVals, storyScriptItemIds, phoneInvokeEventOptions,
    buildGraphEventBranchAutocompleteItemsFromActions, activeGraphBranchAutocompleteItems, isCreateMode, replaceEventInDocument,
    removeEventFromDocument, applyStoryCreationDraft, deleteEvent, exportStory,
    getAppSettings, getStoryCreationHistory, getStory, deleteStoryCreationHistorySession,
    saveAppSettings, saveEvent, saveEventLocations, saveDoing,
    saveStoryMeta, saveStoryCreationHistorySession, saveItems, savePhone,
    savePhoneConversations, saveRefer, saveShop, savePlayerOverrideVals,
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
    isShopDialogOpen, isPhoneDialogOpen, isReferDialogOpen, isRolesDialogOpen,
    isSettingsDialogOpen, isGameSettingsDialogOpen
  } = state
  const lifecycle = useStoryEditorLifecycle(state)
  const {
    refreshValidation, closeEditor, openValsDialog, closeValsDialog,
    openPlayerOverrideValsDialog, closePlayerOverrideValsDialog, openSystemValsDialog, closeSystemValsDialog,
    openScenesDialog, closeScenesDialog, openLocationsDialog, closeLocationsDialog,
    openItemsDialog, closeItemsDialog, openShopDialog, closeShopDialog,
    openPhoneDialog, closePhoneDialog, openReferDialog, closeReferDialog,
    openRolesDialog, closeRolesDialog, openSettingsDialog, closeSettingsDialog,
    openGameSettingsDialog, closeGameSettingsDialog, createHistoryId, getActiveCreationHistorySession,
    upsertLocalCreationHistorySession, persistCreationHistorySession, createCreationHistorySession, handleRestoreCreationHistorySession,
    buildRunningCreationHistoryTurn, settleCreationHistoryTurn, completeCreationRun, handleDeleteCreationHistorySession
  } = lifecycle
  const actionContext = { ...state, ...lifecycle }
  const eventActions = useStoryEditorEventActions(actionContext)
  const {
    handleSelectEvent, handleEditEvent, sanitizeIdSegment, createUniqueEventId,
    buildNewEventFromParent, buildNewActionFromParent, buildNewRootEvent, buildNewStandaloneEvent,
    handleCreateGraphEvent, handleCreateGraphAction, handleCreateGraphRootEvent, handleCreateStandaloneEvent,
    handleSwitchEventTab, handleSwitchWorkspaceTab, handleDeleteGraphNode, handleSaveEvent,
    handleDeleteEvent, handleToggleLink
  } = eventActions
  const assetActions = useStoryEditorAssetActions(actionContext)
  const {
    handleSaveVals, handleSaveSystemVals, handleSavePlayerOverrideVals, handleSaveScenes,
    handleSaveEventLocations, handleSaveItems, handleSaveShop, handleSavePhone,
    handleSavePhoneConversations, handleSaveRefer, handleSaveDoing, handleSaveRoles,
    handleQuickCreateRole, handleQuickCreateLocation, handleSaveStoryBible, handleSaveAppSettings,
    handleSaveStoryMeta, handleExport
  } = assetActions
  const creationActions = useStoryEditorCreationActions(actionContext)
  const {
    handleRunCreationAgent, resumePendingCreationTask, handleAbortCreationAgent, isAbortError,
    selectAppliedEvent, handleApplyCreationDraft
  } = creationActions

/** 异步加载 `Story` 数据并更新响应式状态。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
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
  phoneConversationsSaveErrorMessage.value = null

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
    void resumePendingCreationTask()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载剧情失败。"
  } finally {
    isLoading.value = false
  }
}

/** 判断 `issueKey` 对应的条件是否成立。 @param issue 调用方传入的 `issue`。 @param index 调用方传入的 `index`。 @returns 布尔判断结果。 */
function issueKey(issue: ValidationIssue, index: number) {
  return `${issue.code}:${issue.path.join("/")}:${index}`
}

watch(
  () => props.storyId,
  () => {
    editingEventId.value = null
    creatingFromEventId.value = null
    creatingEventDraft.value = null
    closeAllTools()
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
    phoneConversationsSaveErrorMessage.value = null
    phoneConversationsSaveSuccessMessage.value = null
    referSaveSuccessMessage.value = null
    doingSaveSuccessMessage.value = null
    rolesSaveSuccessMessage.value = null
    void loadStory()
  },
  { immediate: true }
)

  return {
    projectStore, isAgentRunning, isCreationDraftApplying, creationAgentResult,
    creationAgentRunMode, creationAgentError, creationApplyMessage, creationApplyWarnings,
    creationHistory, activeCreationHistorySessionId, editingEventId, creatingFromEventId,
    creatingEventDraft, scenesSaveSuccessMessage, locationsSaveSuccessMessage, itemsSaveSuccessMessage,
    shopSaveSuccessMessage, phoneSaveSuccessMessage, phoneConversationsSaveErrorMessage, phoneConversationsSaveSuccessMessage,
    referSaveSuccessMessage, doingSaveSuccessMessage, rolesSaveSuccessMessage, activeWorkspaceTab,
    workspaceTabOptions, selectedEventId, selectedEvent, editingEvent,
    activeDraftEvent, activeGraphParentNodeId, activeGraphDraftEvent, activeGraphDraftAction,
    graphNodeOptions, storyScriptVals, storyScriptItemIds, phoneInvokeEventOptions,
    buildGraphEventBranchAutocompleteItemsFromActions, activeGraphBranchAutocompleteItems, isCreateMode, replaceEventInDocument,
    removeEventFromDocument, refreshValidation, closeEditor, openValsDialog,
    closeValsDialog, openPlayerOverrideValsDialog, closePlayerOverrideValsDialog, openSystemValsDialog,
    closeSystemValsDialog, openScenesDialog, closeScenesDialog, openLocationsDialog,
    closeLocationsDialog, openItemsDialog, closeItemsDialog, openShopDialog,
    closeShopDialog, openPhoneDialog, closePhoneDialog, openReferDialog,
    closeReferDialog, openRolesDialog, closeRolesDialog, openSettingsDialog,
    closeSettingsDialog, openGameSettingsDialog, closeGameSettingsDialog, createHistoryId,
    getActiveCreationHistorySession, upsertLocalCreationHistorySession, persistCreationHistorySession, createCreationHistorySession,
    handleRestoreCreationHistorySession, buildRunningCreationHistoryTurn, settleCreationHistoryTurn, completeCreationRun,
    handleDeleteCreationHistorySession, loadStory, handleSelectEvent, handleEditEvent,
    sanitizeIdSegment, createUniqueEventId, buildNewEventFromParent, buildNewActionFromParent,
    buildNewRootEvent, buildNewStandaloneEvent, handleCreateGraphEvent, handleCreateGraphAction,
    handleCreateGraphRootEvent, handleCreateStandaloneEvent, handleSwitchEventTab, handleSwitchWorkspaceTab,
    handleDeleteGraphNode, handleSaveEvent, handleDeleteEvent, handleSaveVals,
    handleSaveSystemVals, handleSavePlayerOverrideVals, handleSaveScenes, handleSaveEventLocations,
    handleSaveItems, handleSaveShop, handleSavePhone, handleSavePhoneConversations,
    handleSaveRefer, handleSaveDoing, handleSaveRoles, handleQuickCreateRole,
    handleQuickCreateLocation, handleSaveStoryBible, handleRunCreationAgent, resumePendingCreationTask,
    handleAbortCreationAgent, isAbortError, selectAppliedEvent, handleApplyCreationDraft,
    handleSaveAppSettings, handleSaveStoryMeta, handleToggleLink, handleExport,
    issueKey, applyStoryCreationDraft, deleteEvent, exportStory,
    getAppSettings, getStoryCreationHistory, getStory, deleteStoryCreationHistorySession,
    saveAppSettings, saveEvent, saveEventLocations, saveDoing,
    saveStoryMeta, saveStoryCreationHistorySession, saveItems, savePhone,
    savePhoneConversations, saveRefer, saveShop, savePlayerOverrideVals,
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
    isShopDialogOpen, isPhoneDialogOpen, isReferDialogOpen, isRolesDialogOpen,
    isSettingsDialogOpen, isGameSettingsDialogOpen
  }
}

export type StoryEditorShellController = ReturnType<typeof useStoryEditorShell>
