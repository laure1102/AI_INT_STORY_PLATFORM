/**
 * 协调 AI 创作任务的启动、恢复、取消，以及用户确认后的草稿应用。
 *
 * “生成”和“应用”是两条明确分开的路径：Agent 任务只产生可编辑草稿与日志，不修改故事；只有
 * 用户勾选内容并触发 apply，服务端才会结合 expectedRevision 事务提交候选 StoryDocument。
 *
 * 输入来源：StoryCreationWorkspace emit 的指令、反馈草稿、取消和应用选择。
 * 输出去向：可恢复任务 composable、创作历史、共享文档/validation 和用户提示。
 * 不负责：编辑草稿字段、决定默认勾选项或直接写任何资产文件。
 */
import type {
  ApplyStoryCreationDraftSelection,
  StoryCreationDraft,
  StoryCreationHistorySession
} from "@story-mgr/shared"
type StoryCreationAgentRunMode = "new" | "feedback"
import type { StoryEditorStateController } from "./useStoryEditorState"
import type { StoryEditorLifecycleController } from "./useStoryEditorLifecycle"

type StoryEditorActionContext = StoryEditorStateController & StoryEditorLifecycleController

/**
 * 在共享 State/Lifecycle 上增加 AI 创作副作用。
 *
 * 任务状态仍由 `useStoryCreationTask` 单一管理，本 composable 只把它同步成编辑器可见状态和历史。
 */
export function useStoryEditorCreationActions(context: StoryEditorActionContext) {
  const {
    props,
    projectStore, isAgentRunning, isCreationDraftApplying, creationAgentResult,
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
    isSettingsDialogOpen, isGameSettingsDialogOpen, refreshValidation, closeEditor,
    openValsDialog, closeValsDialog, openPlayerOverrideValsDialog, closePlayerOverrideValsDialog,
    openSystemValsDialog, closeSystemValsDialog, openScenesDialog, closeScenesDialog,
    openLocationsDialog, closeLocationsDialog, openItemsDialog, closeItemsDialog,
    openShopDialog, closeShopDialog, openContactDialog, closeContactDialog,
    openReferDialog, closeReferDialog, openRolesDialog, closeRolesDialog,
    openSettingsDialog, closeSettingsDialog, openGameSettingsDialog, closeGameSettingsDialog,
    createHistoryId, getActiveCreationHistorySession, upsertLocalCreationHistorySession, persistCreationHistorySession,
    createCreationHistorySession, handleRestoreCreationHistorySession, buildRunningCreationHistoryTurn, settleCreationHistoryTurn,
    completeCreationRun, handleDeleteCreationHistorySession
  } = context

/**
 * 启动一轮新创作或基于现有草稿的反馈修订。
 *
 * 顺序是：建立/续用历史 session → 先写 running turn → 清理旧 UI 状态 → 持久化历史 → 创建任务并
 * 等待结果 → 成功/失败/取消收敛历史。finally 始终释放 running 标记。`baseDraft` 只传给反馈轮次，
 * 不会提前覆盖当前预览草稿。
 */
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
    updatedAt: startedAt,
    turns: [
      ...historySession.turns,
      buildRunningCreationHistoryTurn(runMode, instruction)
    ]
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
  try {
    // 先保存 running 历史，页面刷新后才能知道有任务需要恢复。
    await persistCreationHistorySession(historySession)
    const result = await runCreationTask(instruction, baseDraft)
    await completeCreationRun(historySession, result)
  } catch (error) {
    // Abort 是用户主动取消，不显示成红色系统错误；仍要把历史轮次标为 cancelled。
    if (isAbortError(error)) {
      const now = new Date().toISOString()
      const nextSession: StoryCreationHistorySession = {
        ...historySession,
        status: "cancelled",
        updatedAt: now,
        turns: settleCreationHistoryTurn(historySession, "cancelled", undefined, "已中止")
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
      turns: settleCreationHistoryTurn(historySession, "failed", undefined, message)
    }
    upsertLocalCreationHistorySession(nextSession)
    activeCreationHistorySessionId.value = nextSession.id
    await persistCreationHistorySession(nextSession)
  } finally {
    isAgentRunning.value = false
    creationAgentRunMode.value = null
  }
}

/**
 * 页面重载后恢复最近一个仍处于 running 的创作任务。
 *
 * 前端历史提供 instruction/mode，服务端任务 composable 通过 storyId 查找持久化 job/checkpoint；没有
 * 可恢复任务时明确失败并结束旧 running turn，避免界面永远停在“运行中”。
 */
async function resumePendingCreationTask() {
  const historySession = creationHistory.value.sessions.find((session) => session.status === "running")
  const runningTurn = historySession?.turns.findLast((turn) => turn.status === "running")
  if (!historySession || !runningTurn || isAgentRunning.value) return

  activeCreationHistorySessionId.value = historySession.id
  isAgentRunning.value = true
  creationAgentRunMode.value = runningTurn.mode
  creationAgentError.value = null
  try {
    const result = await resumeCreationTask()
    if (!result) throw new Error("未找到可恢复的 AI 创作任务。")
    await completeCreationRun(historySession, result)
  } catch (error) {
    const cancelled = isAbortError(error)
    const message = cancelled
      ? "已中止"
      : error instanceof Error ? error.message : "AI 创作任务恢复失败。"
    if (!cancelled) {
      creationAgentError.value = message
      errorMessage.value = message
    }
    const nextSession: StoryCreationHistorySession = {
      ...historySession,
      status: cancelled ? "cancelled" : "failed",
      updatedAt: new Date().toISOString(),
      turns: settleCreationHistoryTurn(
        historySession,
        cancelled ? "cancelled" : "failed",
        undefined,
        message
      )
    }
    upsertLocalCreationHistorySession(nextSession)
    await persistCreationHistorySession(nextSession)
  } finally {
    isAgentRunning.value = false
    creationAgentRunMode.value = null
  }
}

/** 请求取消当前服务端任务；不直接改 UI，最终状态由 run/resume 的 catch/finally 统一收敛。 */
function handleAbortCreationAgent() {
  void cancelCreationTask()
}

/** 兼容浏览器 AbortError 名称与请求库的 aborted 消息。 */
function isAbortError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.name === "AbortError" || error.message.includes("aborted")
}

/**
 * 草稿应用成功后，切换到用户选择的第一个事件。
 *
 * 选择 key 包含 `collectionType:id`，解析失败时保持当前界面，不让异常历史数据破坏工作区状态。
 */
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

/**
 * 将用户勾选的草稿交给服务端原子应用。
 *
 * 请求期间锁定重复提交；成功响应中的 story 和 validation 是服务端权威结果，直接替换本地源状态，
 * 然后记录实际应用数量与 warnings。草稿仍保存在历史中以便审计。409、校验失败或事务错误都只
 * 显示错误，不在前端做部分合并，因为客户端无法保证跨文件一致性。
 */
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

  return {
    handleRunCreationAgent, resumePendingCreationTask, handleAbortCreationAgent, isAbortError,
    selectAppliedEvent, handleApplyCreationDraft
  }
}

export type StoryEditorCreationActions = ReturnType<typeof useStoryEditorCreationActions>
