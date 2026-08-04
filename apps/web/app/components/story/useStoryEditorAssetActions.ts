/**
 * 集中处理变量、资产、手机、设置和导出的保存副作用。
 *
 * 各弹窗通过 typed emits 把完整编辑结果传回 StoryEditorShell，Shell 再调用这里的方法。子组件不会
 * 直接请求 API 或修改父 props；保存成功后，本模块使用服务端返回值替换共享 storyDocument 的对应
 * 领域，更新 revision/提示，并重新校验故事。
 *
 * 输入来源：资产弹窗 emit 的 Core 类型对象和快速创建 payload。
 * 输出去向：Story API、共享文档 Ref、保存提示与 validation。
 * 不负责：弹窗表单内部草稿、事件图写入和 AI 任务。
 */
import type {
  AppSettingsFile,
  StoryBibleFile,
  StoryDoingFile,
  StoryEventLocationFile,
  StoryItemsFile,
  StoryMetaFile,
  StoryPlayerOverrideValsFile,
  StoryPhoneConversationsFile,
  StoryPhoneFile,
  StoryReferFile,
  StoryRolesFile,
  StorySceneFile,
  StoryShopFile,
  StoryValsFile
} from "@story-mgr/core"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import { appendQuickLocationToEventLocations } from "./storyQuickLocation"
import { appendQuickRoleToRoles } from "./storyQuickRole"
import type { StoryEditorStateController } from "./useStoryEditorState"
import type { StoryEditorLifecycleController } from "./useStoryEditorLifecycle"

type StoryEditorActionContext = StoryEditorStateController & StoryEditorLifecycleController

/**
 * 在共享 State/Lifecycle 上增加所有非事件领域的写操作。
 *
 * 每个 handler 都拥有自己的 loading/error/success 生命周期，但不会持有第二份文档源状态。
 */
export function useStoryEditorAssetActions(context: StoryEditorActionContext) {
  const {
    props,
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
    isSettingsDialogOpen, isGameSettingsDialogOpen, refreshValidation, closeEditor,
    openValsDialog, closeValsDialog, openPlayerOverrideValsDialog, closePlayerOverrideValsDialog,
    openSystemValsDialog, closeSystemValsDialog, openScenesDialog, closeScenesDialog,
    openLocationsDialog, closeLocationsDialog, openItemsDialog, closeItemsDialog,
    openShopDialog, closeShopDialog, openPhoneDialog, closePhoneDialog,
    openReferDialog, closeReferDialog, openRolesDialog, closeRolesDialog,
    openSettingsDialog, closeSettingsDialog, openGameSettingsDialog, closeGameSettingsDialog,
    createHistoryId, getActiveCreationHistorySession, upsertLocalCreationHistorySession, persistCreationHistorySession,
    createCreationHistorySession, handleRestoreCreationHistorySession, buildRunningCreationHistoryTurn, settleCreationHistoryTurn,
    completeCreationRun, handleDeleteCreationHistorySession
  } = context

// 下面的领域保存函数遵循同一套顺序：
// 1. 设置全局 saving 并清空旧错误；2. 调用 typed API；3. 用响应替换 storyDocument 对应字段；
// 4. 更新 revision；5. 写领域成功提示/关闭弹窗；6. 刷新全篇校验；finally 一定解除 saving。
// 不能在请求前直接改共享文档，否则 409 冲突或网络失败后 UI 会显示一个从未保存成功的版本。
/** 处理 `SaveVals` 用户交互。 @param vals 调用方传入的 `vals`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 保存运行时系统变量定义；与普通 vals 分开，避免误把只读系统变量写进全局变量文件。 */
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

/** 保存玩家创建覆盖字段；它只描述新档输入，不直接改当前 Runtime 存档。 */
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

// 场景、地点、物品、商城、手机、称谓、行动和角色都使用上面的统一保存协议。
// 各自保留独立 success ref，是为了让当前弹窗显示自己的结果，不把“物品已保存”显示到角色弹窗。
/** 处理 `SaveScenes` 用户交互。 @param scenes 调用方传入的 `scenes`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 处理 `SaveEventLocations` 用户交互。 @param eventLocations 调用方传入的 `eventLocations`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 处理 `SaveItems` 用户交互。 @param items 调用方传入的 `items`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 处理 `SaveShop` 用户交互。 @param shop 调用方传入的 `shop`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 处理 `SavePhone` 用户交互。 @param phone 调用方传入的 `phone`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 处理 `SavePhoneConversations` 用户交互。 @param phoneConversations 调用方传入的 `phoneConversations`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleSavePhoneConversations(phoneConversations: StoryPhoneConversationsFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  phoneConversationsSaveErrorMessage.value = null
  phoneConversationsSaveSuccessMessage.value = null

  try {
    const savedPhoneConversations = await savePhoneConversations(props.storyId, phoneConversations)
    storyDocument.value = {
      ...storyDocument.value,
      phoneConversations: savedPhoneConversations
    }
    phoneConversationsSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存手机剧情对话失败。"
    phoneConversationsSaveErrorMessage.value = message
    errorMessage.value = message
  } finally {
    isSaving.value = false
  }
}

/** 处理 `SaveRefer` 用户交互。 @param refer 调用方传入的 `refer`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 处理 `SaveDoing` 用户交互。 @param doing 调用方传入的 `doing`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 处理 `SaveRoles` 用户交互。 @param roles 调用方传入的 `roles`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/**
 * 快速创建角色：基于最新共享角色文件生成新对象，再复用正式角色保存流程。
 *
 * 快速入口没有特殊写盘通道，因此仍然获得 revision 检查、服务端 Schema 校验和全篇校验。
 */
async function handleQuickCreateRole(payload: StoryQuickCreateRolePayload) {
  if (!storyDocument.value) {
    return
  }

  await handleSaveRoles(appendQuickRoleToRoles(storyDocument.value.roles, payload))
}

/** 快速创建地点同样只负责构造候选，实际保存复用地点 handler。 */
async function handleQuickCreateLocation(payload: StoryQuickCreateLocationPayload) {
  if (!storyDocument.value) {
    return
  }

  await handleSaveEventLocations(
    appendQuickLocationToEventLocations(storyDocument.value.eventLocations, payload)
  )
}

/** 保存仅供 AI 创作读取的故事圣经；Runtime/Compiler 不会把它当作游戏状态。 */
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

/** 保存应用级 AI/图片配置；它不属于当前 StoryDocument，因此只更新 appSettings。 */
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

/** 保存故事标题、描述、标签等元信息，并同步最新 revision。 */
async function handleSaveStoryMeta(story: StoryMetaFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    storyDocument.value = {
      ...storyDocument.value,
      story: await saveStoryMeta(props.storyId, story)
    }
    isGameSettingsDialogOpen.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存游戏设置失败。"
  } finally {
    isSaving.value = false
  }
}

/**
 * 请求服务端导出当前故事。
 *
 * 导出不修改 storyDocument，但使用独立 isExporting 防止重复点击；成功路径供 Shell 展示，失败统一
 * 写入 errorMessage。导出前的编译/校验由服务端负责。
 */
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

  return {
    handleSaveVals, handleSaveSystemVals, handleSavePlayerOverrideVals, handleSaveScenes,
    handleSaveEventLocations, handleSaveItems, handleSaveShop, handleSavePhone,
    handleSavePhoneConversations, handleSaveRefer, handleSaveDoing, handleSaveRoles,
    handleQuickCreateRole, handleQuickCreateLocation, handleSaveStoryBible, handleSaveAppSettings,
    handleSaveStoryMeta, handleExport
  }
}

export type StoryEditorAssetActions = ReturnType<typeof useStoryEditorAssetActions>
