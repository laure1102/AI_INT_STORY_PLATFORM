/**
 * 管理 StoryEditorShell 的页面生命周期、工具弹窗互斥和 AI 创作历史。
 *
 * 输入是 `useStoryEditorState` 创建的共享 controller；输出是一组给 Shell 模板绑定的 open/close、
 * 校验刷新和历史记录方法。它会修改 controller 中明确暴露的 Ref，并通过 API 持久化创作历史，
 * 但不保存事件、资产或故事正文，这些副作用属于对应 Actions composable。
 *
 * Vue 数据流边界：Shell 把 storyId 作为 props 交给 State；Lifecycle 不复制文档，只操作共享 Ref；
 * 子弹窗仍通过 emits 把保存请求交回 Shell，再由 AssetActions 处理。
 */
import type {
  RunStoryCreationAgentResponse,
  StoryCreationHistorySession,
  StoryCreationHistoryTurn
} from "@story-mgr/shared"
type StoryCreationAgentRunMode = "new" | "feedback"
import type { StoryEditorStateController } from "./useStoryEditorState"

/**
 * 在现有编辑器 State 上增加页面生命周期操作。
 *
 * 返回方法由 Shell 继续组合进事件、资产和 AI Actions；这种组合方式让根组件只负责接线，同时保持
 * 状态单一来源，不会在多个 composable 中各维护一份“当前故事”或“当前弹窗”。
 */
export function useStoryEditorLifecycle(state: StoryEditorStateController) {
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
    isSettingsDialogOpen, isGameSettingsDialogOpen
  } = state

/** 从服务端重新取得整篇校验结果；只更新 validation，不改故事文档。 */
async function refreshValidation() {
  validation.value = await validateStory(props.storyId)
}

/** 关闭事件编辑/创建草稿，防止工具弹窗与事件详情同时编辑同一份文档。 */
function closeEditor() {
  editingEventId.value = null
  creatingFromEventId.value = null
  creatingEventDraft.value = null
}

// 工具弹窗遵循同一个规则：没有文档时不打开；打开前关闭事件编辑和其他互斥工具；
// 保存提示在每次打开/关闭时清空，避免用户把上一次保存成功误认为本次操作结果。
/** 打开 `ValsDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
  isContactDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  isValsDialogOpen.value = true
}

/** 关闭 `ValsDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeValsDialog() {
  isValsDialogOpen.value = false
}

/** 打开 `PlayerOverrideValsDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
  isContactDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  isPlayerOverrideValsDialogOpen.value = true
}

/** 关闭 `PlayerOverrideValsDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closePlayerOverrideValsDialog() {
  isPlayerOverrideValsDialogOpen.value = false
}

/** 打开 `SystemValsDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
  isContactDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  isSystemValsDialogOpen.value = true
}

/** 关闭 `SystemValsDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeSystemValsDialog() {
  isSystemValsDialogOpen.value = false
}

/** 打开 `ScenesDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
  isContactDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  scenesSaveSuccessMessage.value = null
  isScenesDialogOpen.value = true
}

/** 关闭 `ScenesDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeScenesDialog() {
  scenesSaveSuccessMessage.value = null
  isScenesDialogOpen.value = false
}

/** 打开 `LocationsDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
  isContactDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  locationsSaveSuccessMessage.value = null
  isLocationsDialogOpen.value = true
}

/** 关闭 `LocationsDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeLocationsDialog() {
  locationsSaveSuccessMessage.value = null
  isLocationsDialogOpen.value = false
}

/** 打开 `ItemsDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
  isContactDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  itemsSaveSuccessMessage.value = null
  isItemsDialogOpen.value = true
}

/** 关闭 `ItemsDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeItemsDialog() {
  itemsSaveSuccessMessage.value = null
  isItemsDialogOpen.value = false
}

/** 打开 `ShopDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
  isContactDialogOpen.value = false
  isReferDialogOpen.value = false
  isRolesDialogOpen.value = false
  shopSaveSuccessMessage.value = null
  isShopDialogOpen.value = true
}

/** 关闭 `ShopDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeShopDialog() {
  shopSaveSuccessMessage.value = null
  isShopDialogOpen.value = false
}

/** 打开 `ContactDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openContactDialog() {
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
  contactSaveSuccessMessage.value = null
  isContactDialogOpen.value = true
}

/** 关闭 `ContactDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeContactDialog() {
  contactSaveSuccessMessage.value = null
  isContactDialogOpen.value = false
}

/** 打开 `ReferDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
  isContactDialogOpen.value = false
  isRolesDialogOpen.value = false
  referSaveSuccessMessage.value = null
  isReferDialogOpen.value = true
}

/** 关闭 `ReferDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeReferDialog() {
  referSaveSuccessMessage.value = null
  isReferDialogOpen.value = false
}

/** 打开 `RolesDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
  isContactDialogOpen.value = false
  isReferDialogOpen.value = false
  rolesSaveSuccessMessage.value = null
  isRolesDialogOpen.value = true
}

/** 关闭 `RolesDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeRolesDialog() {
  rolesSaveSuccessMessage.value = null
  isRolesDialogOpen.value = false
}

/** 打开 `SettingsDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openSettingsDialog() {
  if (!appSettings.value) {
    return
  }

  isSettingsDialogOpen.value = true
}

/** 关闭 `SettingsDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeSettingsDialog() {
  isSettingsDialogOpen.value = false
}

/** 打开 `GameSettingsDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openGameSettingsDialog() {
  if (!storyDocument.value) {
    return
  }

  isGameSettingsDialogOpen.value = true
}

/** 关闭 `GameSettingsDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeGameSettingsDialog() {
  isGameSettingsDialogOpen.value = false
}

/** 创建仅用于编辑器历史记录的本地 id；它不是服务端 AI jobId 或 LangGraph thread_id。 */
function createHistoryId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 根据当前选中历史 id 取得会话；被删除或尚未选择时返回 null。 */
function getActiveCreationHistorySession() {
  if (!activeCreationHistorySessionId.value) {
    return null
  }

  return creationHistory.value.sessions.find((session) => session.id === activeCreationHistorySessionId.value) ?? null
}

/**
 * 先在本地插入/替换历史会话并按更新时间倒序排列。
 *
 * 这让任务状态能立即反馈到 UI，不必等待磁盘请求；服务端保存成功后会再用权威 history 覆盖本地值。
 */
function upsertLocalCreationHistorySession(session: StoryCreationHistorySession) {
  creationHistory.value = {
    sessions: [
      session,
      ...creationHistory.value.sessions.filter((item) => item.id !== session.id)
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }
}

/**
 * 尝试持久化一条历史会话。
 *
 * 历史记录失败不应让已经成功的 AI 草稿消失或把主流程判为失败，因此这里只记录控制台错误；任务
 * 和草稿状态仍保留在本地，用户可以继续查看或应用。
 */
async function persistCreationHistorySession(session: StoryCreationHistorySession) {
  try {
    const response = await saveStoryCreationHistorySession(props.storyId, session)
    creationHistory.value = response.history
  } catch (error) {
    console.error("[web] failed to save creation history", error)
  }
}

/** 为一次全新创作建立历史容器；后续反馈轮次会追加到同一个 session。 */
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

/**
 * 把历史会话恢复到当前预览区。
 *
 * 恢复只切换前端选中状态和草稿预览，不会重新运行 Agent，也不会自动应用草稿到故事文件。
 */
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

/** 创建状态为 running 的历史轮次，供任务开始前立即展示。 */
function buildRunningCreationHistoryTurn(
  mode: StoryCreationAgentRunMode,
  instruction: string
): StoryCreationHistoryTurn {
  return {
    id: createHistoryId("turn"),
    mode,
    instruction,
    status: "running",
    createdAt: new Date().toISOString()
  }
}

/**
 * 将最近一个 running 轮次收敛为 done/failed/cancelled。
 *
 * 若历史数据中没有 running 轮次，会补建一个再结束，兼容进程恢复或旧数据不完整的情况；不会修改
 * 原 turns 数组，而是返回新数组触发 Vue 更新。
 */
function settleCreationHistoryTurn(
  session: StoryCreationHistorySession,
  status: "done" | "failed" | "cancelled",
  response?: RunStoryCreationAgentResponse,
  error?: string
) {
  const runningIndex = session.turns.findLastIndex((turn) => turn.status === "running")
  const source = runningIndex >= 0
    ? session.turns[runningIndex]!
    : buildRunningCreationHistoryTurn("new", session.initialInstruction)
  const settled: StoryCreationHistoryTurn = {
    ...source,
    status,
    completedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
    ...(response ? { response } : {})
  }
  return runningIndex >= 0
    ? session.turns.map((turn, index) => index === runningIndex ? settled : turn)
    : [...session.turns, settled]
}

/** 把成功任务的草稿、日志和历史状态一次同步到本地，再尽力保存服务端历史。 */
async function completeCreationRun(
  session: StoryCreationHistorySession,
  result: RunStoryCreationAgentResponse
) {
  creationAgentResult.value = result
  const now = new Date().toISOString()
  const nextSession: StoryCreationHistorySession = {
    ...session,
    title: result.draft.title || session.title,
    status: "draft",
    updatedAt: now,
    currentDraft: result.draft,
    turns: settleCreationHistoryTurn(session, "done", result)
  }
  upsertLocalCreationHistorySession(nextSession)
  activeCreationHistorySessionId.value = nextSession.id
  await persistCreationHistorySession(nextSession)
}

/**
 * 删除一条创作历史。
 *
 * 当前仍在运行的会话禁止删除，避免 UI 失去取消/恢复任务所需的上下文；删除当前选中项后还要清空
 * 草稿、错误和应用提示，防止界面继续显示已不存在记录的内容。
 */
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

  return {
    refreshValidation, closeEditor, openValsDialog, closeValsDialog,
    openPlayerOverrideValsDialog, closePlayerOverrideValsDialog, openSystemValsDialog, closeSystemValsDialog,
    openScenesDialog, closeScenesDialog, openLocationsDialog, closeLocationsDialog,
    openItemsDialog, closeItemsDialog, openShopDialog, closeShopDialog,
    openContactDialog, closeContactDialog, openReferDialog, closeReferDialog,
    openRolesDialog, closeRolesDialog, openSettingsDialog, closeSettingsDialog,
    openGameSettingsDialog, closeGameSettingsDialog, createHistoryId, getActiveCreationHistorySession,
    upsertLocalCreationHistorySession, persistCreationHistorySession, createCreationHistorySession, handleRestoreCreationHistorySession,
    buildRunningCreationHistoryTurn, settleCreationHistoryTurn, completeCreationRun, handleDeleteCreationHistorySession
  }
}

export type StoryEditorLifecycleController = ReturnType<typeof useStoryEditorLifecycle>
