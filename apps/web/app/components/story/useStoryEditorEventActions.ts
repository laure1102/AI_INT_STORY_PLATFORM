/**
 * 处理事件工作台中的选择、创建、保存、删除和 chain 图连线。
 *
 * 输入来自事件画布和详情面板 emit 的事件 id/草稿；输出通过 API 保存，再更新共享 storyDocument、
 * ProjectStore 选中项和 validation。详情组件只编辑本地 draft，不直接改父级故事，符合 Props Down /
 * Events Up：用户点击保存后，副作用才集中进入这个 composable。
 *
 * 不负责资产、AI 草稿或弹窗生命周期；它们由其他 controller 处理。
 */
import type {
  StoryAnyEventFile,
  StoryActionFile,
  StoryEventFile,
  StoryLoopEventFile,
  StoryOnceEventFile,
} from "@story-mgr/core"
import type { EventWorkbenchTab } from "~/composables/useStoryEventWorkbench"

type StoryWorkspaceTab = "creation" | "events"
type StoryCreationAgentRunMode = "new" | "feedback"

export interface StoryEditorShellProps {
  storyId: string
}
import type { StoryEditorStateController } from "./useStoryEditorState"
import type { StoryEditorLifecycleController } from "./useStoryEditorLifecycle"

type StoryEditorActionContext = StoryEditorStateController & StoryEditorLifecycleController

/**
 * 在共享 State/Lifecycle 上增加事件写操作。
 *
 * 返回的方法由 StoryEditorShell 传给画布和详情面板；子组件只能 emit 意图，真正 API 调用、loading、
 * 错误提示和本地文档同步始终留在这一层。
 */
export function useStoryEditorEventActions(context: StoryEditorActionContext) {
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

/** 只改变画布选中项，不自动打开编辑器，供单击节点使用。 */
function handleSelectEvent(eventId: string) {
  if (!isEventCanvasTab(activeEventTab.value)) {
    return
  }

  projectStore.selectEvent(props.storyId, activeEventTab.value, eventId)
}

/** 打开已存在事件编辑器，并退出所有“新建子节点”状态。 */
function handleEditEvent(eventId: string) {
  if (!isEventCanvasTab(activeEventTab.value)) {
    return
  }

  creatingFromEventId.value = null
  editingEventId.value = eventId
  projectStore.selectEvent(props.storyId, activeEventTab.value, eventId)
}

/** 把标题片段收敛为事件 id 可用的小写连字符格式。 */
function sanitizeIdSegment(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * 在当前事件集合内创建稳定且不重复的 id。
 *
 * 冲突时顺序追加 `-2`、`-3`，而不是使用随机值，便于用户预期、测试复现和 git diff 阅读。
 */
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

// 以下 builder 只创建“尚未保存”的本地草稿。字段使用 Core 当前完整默认结构，
// 这样详情面板可以直接编辑，不需要在模板里判断每个字段是否存在。
/** 根据当前输入构建 `NewEventFromParent` 结果。 @param parentEventId 调用方传入的 `parentEventId`。 @returns 计算、查找或构建后的结果。 */
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

/** 根据当前输入构建 `NewActionFromParent` 结果。 @param parentEventId 调用方传入的 `parentEventId`。 @returns 计算、查找或构建后的结果。 */
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

/** 根据当前输入构建 `NewRootEvent` 结果。 @returns 计算、查找或构建后的结果。 */
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

/** 根据当前输入构建 `NewStandaloneEvent` 结果。 @returns 计算、查找或构建后的结果。 */
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

/**
 * 进入新建 chain 子事件模式。
 *
 * 先记住 parent id，保存成功后 `handleSaveEvent` 才会追加 parent.next；取消编辑不会留下半条连线。
 */
function handleCreateGraphEvent(parentEventId: string) {
  creatingFromEventId.value = parentEventId
  editingEventId.value = null
  creatingEventDraft.value = buildNewEventFromParent(parentEventId)
  projectStore.selectEvent(props.storyId, "chain", parentEventId)
}

/** 进入新建 chain 行动分支模式；同样在保存成功后才连接父节点。 */
function handleCreateGraphAction(parentEventId: string) {
  creatingFromEventId.value = parentEventId
  editingEventId.value = null
  creatingEventDraft.value = buildNewActionFromParent(parentEventId)
  projectStore.selectEvent(props.storyId, "chain", parentEventId)
}

/** 新建无父节点的 chain 根事件，并清除旧画布选择。 */
function handleCreateGraphRootEvent() {
  creatingFromEventId.value = null
  editingEventId.value = null
  creatingEventDraft.value = buildNewRootEvent()
  projectStore.clearEvent(props.storyId, "chain")
}

/** 根据当前 pool/schedule 标签建立独立事件草稿。 */
function handleCreateStandaloneEvent() {
  if (!isEventCanvasTab(activeEventTab.value)) {
    return
  }

  creatingFromEventId.value = null
  editingEventId.value = null
  creatingEventDraft.value = buildNewStandaloneEvent()
  projectStore.clearEvent(props.storyId, activeEventTab.value)
}

/**
 * 切换事件领域时关闭旧编辑草稿和领域提示。
 *
 * 不保留未保存草稿，避免 chain 草稿被 pool 面板误解；文档源状态本身不会因此改变。
 */
function handleSwitchEventTab(tab: EventWorkbenchTab) {
  if (activeEventTab.value === tab) {
    return
  }

  closeEditor()
  doingSaveSuccessMessage.value = null
  contactConversationsSaveErrorMessage.value = null
  contactConversationsSaveSuccessMessage.value = null
  activeEventTab.value = tab
}

/** 切换“创作/事件”工作区时关闭事件编辑器，防止隐藏面板继续持有旧草稿。 */
function handleSwitchWorkspaceTab(tab: StoryWorkspaceTab) {
  if (activeWorkspaceTab.value === tab) {
    return
  }

  closeEditor()
  activeWorkspaceTab.value = tab
}

/** 删除前根据节点类型显示人类可读确认文案，确认后复用统一删除流程。 */
async function handleDeleteGraphNode(eventId: string) {
  const targetEvent = activeEvents.value.find((event) => event.id === eventId)
  const label = targetEvent && "exec_script" in targetEvent ? "这个操作节点" : "这个事件节点"

  if (!window.confirm(`确认删除${label}吗？`)) {
    return
  }

  await handleDeleteEvent(eventId)
}

/**
 * 保存事件并同步画布、选择状态和校验结果。
 *
 * 新建 chain 子节点分两次请求：先保存新节点，成功后再保存 parent.next。每次成功响应都用于替换
 * 本地文档，不能直接相信前端草稿，因为服务端可能执行规范化并返回新 revision。失败时保留草稿，
 * 让用户修正或重试；成功后退出 create mode 并刷新全篇校验。
 */
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

/**
 * 删除事件，并修复当前选中/编辑状态。
 *
 * 服务端成功后才从本地文档移除；若删除的是当前节点，选择同集合第一项作为回退，没有剩余项则
 * 清空选择。随后刷新校验，以显示其他节点可能产生的悬空引用。
 */
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

/**
 * 切换一条 chain `next` 连线。
 *
 * 画布只提交 source/target id；本函数基于当前服务端文档构造新 next 数组，保存 source 节点后再
 * 更新本地状态。pool/schedule 没有图连线语义，因此立即忽略。
 */
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

  return {
    handleSelectEvent, handleEditEvent, sanitizeIdSegment, createUniqueEventId,
    buildNewEventFromParent, buildNewActionFromParent, buildNewRootEvent, buildNewStandaloneEvent,
    handleCreateGraphEvent, handleCreateGraphAction, handleCreateGraphRootEvent, handleCreateStandaloneEvent,
    handleSwitchEventTab, handleSwitchWorkspaceTab, handleDeleteGraphNode, handleSaveEvent,
    handleDeleteEvent, handleToggleLink
  }
}

export type StoryEditorEventActions = ReturnType<typeof useStoryEditorEventActions>
