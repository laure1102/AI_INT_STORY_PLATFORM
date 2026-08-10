/**
 * AI 创作工作区控制器：管理命令、任务状态、选择范围和草稿预览。
 * 输入来自父编辑器，输出通过 emits 交回保存与任务层，不直接写文件。
 */
import type { AppSettingsFile, StoryBibleFile, StoryDocument } from "@story-mgr/core"
import type {
  ApplyStoryCreationDraftSelection,
  RunStoryCreationAgentResponse,
  StoryCreationAgentRole,
  StoryCreationDraft,
  StoryCreationDraftDoing,
  StoryCreationDraftEvent,
  StoryCreationDraftContact,
  StoryCreationDraftContactConversations,
  StoryCreationHistoryFile,
  StoryCreationHistorySession,
  StoryCreationJob,
  StoryCreationDraftItem,
  StoryCreationDraftLoopRule,
  StoryCreationDraftRole,
  StoryCreationDraftShop,
  StoryCreationDraftVariable
} from "@story-mgr/shared"
import { computed, reactive, ref, shallowRef, watch } from "vue"
import { useStoryCreationDraftPreview } from "./useStoryCreationDraftPreview"
import { useStoryCreationState } from "./useStoryCreationState"

type BibleFieldKey = keyof StoryBibleFile
type DraftImpactKind = "create" | "update" | "skip"
type StoryCreationAgentRunMode = "new" | "feedback"
type FeedbackHistoryStatus = "running" | "done" | "failed" | "cancelled"

interface BibleFieldConfig {
  key: BibleFieldKey
  label: string
  placeholder: string
}

interface DraftImpact {
  kind: DraftImpactKind
  label: string
  detail: string
}

interface FeedbackHistoryItem {
  id: number
  content: string
  mode: StoryCreationAgentRunMode
  status: FeedbackHistoryStatus
  error?: string
}

export interface StoryCreationWorkspaceProps {
  agentResult: RunStoryCreationAgentResponse | null
  creationJob: StoryCreationJob | null
  agentRunMode: StoryCreationAgentRunMode | null
  agentRunning: boolean
  agentError: string | null
  applying: boolean
  applyMessage: string | null
  applyWarnings: string[]
  creationHistory: StoryCreationHistoryFile
  activeHistorySessionId: string | null
  story: StoryDocument
  settings: AppSettingsFile | null
  saving: boolean
}

export interface StoryCreationWorkspaceEmits {
  applyDraft: [draft: StoryCreationDraft, selection: ApplyStoryCreationDraftSelection]
  abortAgent: []
  deleteHistorySession: [session: StoryCreationHistorySession]
  restoreHistorySession: [session: StoryCreationHistorySession]
  runAgent: [instruction: string, baseDraft?: StoryCreationDraft]
  saveStoryBible: [storyBible: StoryBibleFile]
}

export type StoryCreationWorkspaceEmit = <Name extends keyof StoryCreationWorkspaceEmits>(
  event: Name,
  ...args: StoryCreationWorkspaceEmits[Name]
) => void

/** 创建 AI 创作工作区控制器。 @param props 故事、任务状态和已有草稿等只读输入。 @param emit 向父层发出保存圣经、启动/中止任务、历史操作和应用草稿事件。 @returns 创作表单、任务反馈、草稿选择、影响分析及全部操作方法；状态只在当前工作区生命周期内存在。 */
export function useStoryCreationWorkspace(
  props: Readonly<StoryCreationWorkspaceProps>,
  emit: StoryCreationWorkspaceEmit
) {

const creationState = useStoryCreationState(props)
const {
  commandText, feedbackText, newCreationExpanded, creationHistoryExpanded,
  feedbackSeq, activeFeedbackId, activeBibleField, selectedEventKeys,
  selectedLocationIds, selectedRoleKeys, selectedItemIds, selectedVariableKeys,
  selectedContactChannelIds,
  selectedContactPersonalityIds, selectedContactTalkIds, selectedContactActionIds, selectedContactReplyIds,
  selectedContactProfileKeys, selectedContactConversationIds, selectedDoingMenuIds, selectedDoingIds,
  selectedShopCategoryIds, selectedShopProductIds, feedbackHistory, editableDraft,
  draftApplied, draft, bibleFields, pipelineSteps,
  activeBibleFieldConfig, agentModelSummary, filledBibleFieldCount, canRunAgent,
  canRefineDraft, isFeedbackRunning, isNewCreationRunning, abortAgentLabel,
  activeFeedbackItem, historySessions, historySessionCount, showNewCreationForm,
  runStatus, agentLogs, loggedRoles, activeAgentRole,
  draftPreview, eventTypeSummary, contactDraftCount, contactConversationDraftCount,
  doingDraftCount, shopDraftCount, selectedApplyCount, canApplyDraft,
  applyButtonLabel, existingLocationIds, existingRoleKeys, existingItemIds,
  existingItemCategoryIds, existingVariableKeys, existingContactChannelIds, existingContactPersonalityIds, existingContactTalkIds,
  existingContactActionIds, existingContactReplyIds, existingContactProfileKeys, existingContactConversationIds,
  existingDoingMenuIds, existingDoingIds, existingShopCategoryIds, existingShopProductIds,
  existingChainIds, existingEventKeys, selectedDraftChainIds, availableLocationIdsForApply,
  availableRoleKeysForApply, availableChainIdsForApply, availableDoingMenuIdsForApply, availableItemIdsForApply,
  availableShopCategoryIdsForApply, getEventKey, getRoleKey, getVariableKey
} = creationState



const selectedImpactSummary = computed(() => {
  const summary = {
    create: 0,
    update: 0,
    skip: 0
  } satisfies Record<DraftImpactKind, number>
  const draft = draftPreview.value

  if (!draft) {
    return summary
  }
  /** 新增一项 `Impact` 草稿。 @param impact 调用方传入的 `impact`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  const addImpact = (impact: DraftImpact) => {
    summary[impact.kind] += 1
  }

  for (const location of draft.locations) {
    if (selectedLocationIds.value.includes(location.id)) {
      addImpact(getLocationImpact(location))
    }
  }

  for (const role of draft.roles) {
    if (selectedRoleKeys.value.includes(getRoleKey(role))) {
      addImpact(getRoleImpact(role))
    }
  }

  for (const item of draft.items) {
    if (selectedItemIds.value.includes(item.id)) {
      addImpact(getItemImpact(item))
    }
  }

  for (const variable of draft.variables) {
    if (selectedVariableKeys.value.includes(getVariableKey(variable))) {
      addImpact(getVariableImpact(variable))
    }
  }

  for (const event of draft.events) {
    if (selectedEventKeys.value.includes(getEventKey(event))) {
      addImpact(getEventImpact(event))
    }
  }

  for (const personality of draft.contact?.personality_library ?? []) {
    if (selectedContactPersonalityIds.value.includes(personality.id)) {
      addImpact(getContactPersonalityImpact(personality))
    }
  }

  for (const channel of draft.contact?.channels ?? []) {
    if (selectedContactChannelIds.value.includes(channel.id)) {
      addImpact(getContactChannelImpact(channel))
    }
  }

  for (const entry of draft.contact?.talk_library ?? []) {
    if (selectedContactTalkIds.value.includes(entry.id)) {
      addImpact(getContactTalkImpact(entry))
    }
  }

  for (const entry of draft.contact?.action_library ?? []) {
    if (selectedContactActionIds.value.includes(entry.id)) {
      addImpact(getContactActionImpact(entry))
    }
  }

  for (const entry of draft.contact?.reply_library ?? []) {
    if (selectedContactReplyIds.value.includes(entry.id)) {
      addImpact(getContactReplyImpact(entry))
    }
  }

  for (const profile of draft.contact?.contact_profiles ?? []) {
    if (selectedContactProfileKeys.value.includes(profile.role_key)) {
      addImpact(getContactProfileImpact(profile))
    }
  }

  for (const conversation of draft.contactConversations?.conversations ?? []) {
    if (selectedContactConversationIds.value.includes(conversation.id)) {
      addImpact(getContactConversationImpact(conversation))
    }
  }

  for (const menu of draft.doing?.menus ?? []) {
    if (selectedDoingMenuIds.value.includes(menu.id)) {
      addImpact(getDoingMenuImpact(menu))
    }
  }

  for (const doing of draft.doing?.doings ?? []) {
    if (selectedDoingIds.value.includes(doing.id)) {
      addImpact(getDoingImpact(doing))
    }
  }

  for (const category of draft.shop?.categories ?? []) {
    if (selectedShopCategoryIds.value.includes(category.id)) {
      addImpact(getShopCategoryImpact(category))
    }
  }

  for (const product of draft.shop?.products ?? []) {
    if (selectedShopProductIds.value.includes(product.id)) {
      addImpact(getShopProductImpact(product))
    }
  }

  return summary
})

const applyPreviewMessage = computed(() => {
  if (draftApplied.value && props.applyMessage) {
    return props.applyMessage
  }

  const parts = [
    selectedImpactSummary.value.create > 0 ? `新增 ${selectedImpactSummary.value.create}` : "",
    selectedImpactSummary.value.update > 0 ? `覆盖 ${selectedImpactSummary.value.update}` : "",
    selectedImpactSummary.value.skip > 0 ? `跳过 ${selectedImpactSummary.value.skip}` : ""
  ].filter(Boolean)

  if (parts.length === 0) {
    return "确认后会写入所选地点、角色、物品、变量、事件、联系人资产、联系人剧情、行动资产和商城资产。"
  }

  return `确认后将${parts.join("、")}。`
})
/** 把外部或服务端数据同步到本地响应式状态。 @param storyBible 调用方传入的 `storyBible`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(storyBible: StoryBibleFile) {
  draft.background = storyBible.background ?? ""
  draft.golden_finger = storyBible.golden_finger ?? ""
  draft.protagonist = storyBible.protagonist ?? ""
  draft.world_rules = storyBible.world_rules ?? ""
  draft.outline = storyBible.outline ?? ""
  draft.current_arc = storyBible.current_arc ?? ""
  draft.gameplay_design = storyBible.gameplay_design ?? ""
  draft.style_guide = storyBible.style_guide ?? ""
  draft.constraints = storyBible.constraints ?? ""
}
/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function submitStoryBible() {
  emit("saveStoryBible", {
    background: draft.background,
    golden_finger: draft.golden_finger,
    protagonist: draft.protagonist,
    world_rules: draft.world_rules,
    outline: draft.outline,
    current_arc: draft.current_arc,
    gameplay_design: draft.gameplay_design,
    style_guide: draft.style_guide,
    constraints: draft.constraints
  })
}
/** 启动一次新的 AI 创作任务。 @returns 无返回值；指令为空或任务已运行时直接结束，否则清空旧反馈、创建 pending 历史项并 emit `runAgent`，网络与任务失败由父层状态回传。 */
function runAgent() {
  const instruction = commandText.value.trim()

  if (!instruction || props.agentRunning) {
    return
  }

  draftApplied.value = false
  clearFeedbackHistory()
  const runId = appendFeedbackHistory(instruction, "new")
  activeFeedbackId.value = runId
  emit("runAgent", instruction)
}
/** 执行 `refineDraft` 对应的异步业务流程。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
function refineDraft() {
  const instruction = feedbackText.value.trim()

  if (!instruction || !editableDraft.value || props.agentRunning) {
    return
  }

  const feedbackId = appendFeedbackHistory(instruction, "feedback")
  activeFeedbackId.value = feedbackId
  feedbackText.value = ""
  draftApplied.value = false
  emit("runAgent", instruction, cloneCreationDraft(editableDraft.value))
}
/** 执行 `abortAgent` 对应的异步业务流程。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
function abortAgent() {
  finishActiveFeedback("cancelled", "已中止")
  emit("abortAgent")
}
/** 执行 `appendFeedbackHistory` 对应的局部业务逻辑。 @param content 调用方传入的 `content`。 @param mode 调用方传入的 `mode`。 @returns 计算、查找或构建后的结果。 */
function appendFeedbackHistory(content: string, mode: StoryCreationAgentRunMode) {
  feedbackSeq.value += 1
  const id = feedbackSeq.value

  feedbackHistory.value = [
    {
      id,
      content,
      mode,
      status: "running"
    },
    ...feedbackHistory.value
  ]

  return id
}
/** 执行 `finishActiveFeedback` 对应的局部业务逻辑。 @param status 调用方传入的 `status`。 @param error 调用方传入的 `error`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function finishActiveFeedback(status: Exclude<FeedbackHistoryStatus, "running">, error?: string | null) {
  if (activeFeedbackId.value === null) {
    return
  }

  updateFeedbackHistoryItem(activeFeedbackId.value, status, error ?? undefined)
  activeFeedbackId.value = null
}
/** 执行 `updateFeedbackHistoryItem` 对应的局部业务逻辑。 @param feedbackId 调用方传入的 `feedbackId`。 @param status 调用方传入的 `status`。 @param error 调用方传入的 `error`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function updateFeedbackHistoryItem(
  feedbackId: number,
  status: FeedbackHistoryStatus,
  error?: string
) {
  feedbackHistory.value = feedbackHistory.value.map((item) =>
    item.id === feedbackId
      ? {
          ...item,
          status,
          error
        }
      : item
  )
}
/** 重置或清理 `clearFeedbackHistory` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function clearFeedbackHistory() {
  feedbackHistory.value = []
  activeFeedbackId.value = null
}
/** 执行 `feedbackStatusLabel` 对应的局部业务逻辑。 @param status 调用方传入的 `status`。 @param mode 调用方传入的 `mode`。 @returns 计算、查找或构建后的结果。 */
function feedbackStatusLabel(status: FeedbackHistoryStatus, mode: StoryCreationAgentRunMode) {
  if (status === "running") {
    return mode === "new" ? "创作中" : "优化中"
  }

  if (status === "failed") {
    return "失败"
  }

  if (status === "cancelled") {
    return "已中止"
  }

  return "已完成"
}
/** 读取或计算 `FeedbackStatusClass`。 @param status 调用方传入的 `status`。 @returns 计算、查找或构建后的结果。 */
function getFeedbackStatusClass(status: FeedbackHistoryStatus) {
  return `creation-feedback-history__state--${status}`
}
/** 执行 `historyStatusLabel` 对应的局部业务逻辑。 @param status 调用方传入的 `status`。 @returns 计算、查找或构建后的结果。 */
function historyStatusLabel(status: StoryCreationHistorySession["status"]) {
  if (status === "applied") {
    return "已应用"
  }

  if (status === "draft") {
    return "草稿"
  }

  if (status === "running") {
    return "运行中"
  }

  if (status === "cancelled") {
    return "已中止"
  }

  return "失败"
}
/** 执行 `historyStatusClass` 对应的局部业务逻辑。 @param status 调用方传入的 `status`。 @returns 计算、查找或构建后的结果。 */
function historyStatusClass(status: StoryCreationHistorySession["status"]) {
  return `creation-history__status--${status}`
}
/** 把 `HistoryTime` 转换成界面可读文本。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function formatHistoryTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
}
/** 把外部或服务端数据同步到本地响应式状态。 @param session 调用方传入的 `session`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncFeedbackHistoryFromSession(session: StoryCreationHistorySession) {
  feedbackSeq.value = session.turns.length
  feedbackHistory.value = session.turns
    .map((turn, index) => ({
      id: index + 1,
      content: turn.instruction,
      mode: turn.mode,
      status: turn.status === "failed"
        ? "failed" as const
        : turn.status === "running"
          ? "running" as const
          : turn.status === "cancelled"
            ? "cancelled" as const
            : "done" as const,
      error: turn.error
    }))
    .reverse()
  activeFeedbackId.value = null
}
/** 执行 `restoreHistorySession` 对应的局部业务逻辑。 @param session 调用方传入的 `session`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function restoreHistorySession(session: StoryCreationHistorySession) {
  emit("restoreHistorySession", session)
  syncFeedbackHistoryFromSession(session)
  newCreationExpanded.value = false
  creationHistoryExpanded.value = false
}
/** 删除指定的 `HistorySession` 数据。 @param session 调用方传入的 `session`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
function deleteHistorySession(session: StoryCreationHistorySession) {
  if (
    !window.confirm(`删除创作记录「${session.title || "未命名创作"}」？`)
  ) {
    return
  }

  emit("deleteHistorySession", session)
}
/** 复制 `CreationDraft`，避免共享可变引用。 @param draft 调用方传入的 `draft`。 @returns 计算、查找或构建后的结果。 */
function cloneCreationDraft(draft: StoryCreationDraft): StoryCreationDraft {
  const cloned = JSON.parse(JSON.stringify(toRaw(draft))) as StoryCreationDraft
  cloned.items = cloned.items ?? []
  cloned.contact = {
    channels: cloned.contact?.channels ?? [],
    personality_library: cloned.contact?.personality_library ?? [],
    talk_library: cloned.contact?.talk_library ?? [],
    action_library: cloned.contact?.action_library ?? [],
    reply_library: cloned.contact?.reply_library ?? [],
    contact_profiles: cloned.contact?.contact_profiles ?? []
  }
  cloned.contactConversations = {
    conversations: cloned.contactConversations?.conversations ?? []
  }
  cloned.doing = {
    menus: cloned.doing?.menus ?? [],
    doings: cloned.doing?.doings ?? []
  }
  cloned.shop = {
    categories: cloned.shop?.categories ?? [],
    products: cloned.shop?.products ?? []
  }
  return cloned
}
/** 把外部或服务端数据同步到本地响应式状态。 @param result 调用方传入的 `result`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncEditableDraft(result: RunStoryCreationAgentResponse | null) {
  editableDraft.value = result ? cloneCreationDraft(result.draft) : null
  draftApplied.value = false
}
/** 重置或清理 `resetEditableDraft` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function resetEditableDraft() {
  syncEditableDraft(props.agentResult)
  syncApplySelection(editableDraft.value)
}
/** 把外部或服务端数据同步到本地响应式状态。 @param draft 调用方传入的 `draft`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncApplySelection(draft: StoryCreationDraft | null) {
  selectedEventKeys.value = draft?.events.map(getEventKey) ?? []
  selectedLocationIds.value = draft?.locations.map((location) => location.id) ?? []
  selectedRoleKeys.value = draft?.roles.map(getRoleKey) ?? []
  selectedItemIds.value = draft?.items.map((item) => item.id) ?? []
  selectedVariableKeys.value = draft?.variables.map(getVariableKey) ?? []
  selectedContactChannelIds.value = draft?.contact?.channels.map((channel) => channel.id) ?? []
  selectedContactPersonalityIds.value = draft?.contact?.personality_library.map((personality) => personality.id) ?? []
  selectedContactTalkIds.value = draft?.contact?.talk_library.map((entry) => entry.id) ?? []
  selectedContactActionIds.value = draft?.contact?.action_library.map((entry) => entry.id) ?? []
  selectedContactReplyIds.value = draft?.contact?.reply_library.map((entry) => entry.id) ?? []
  selectedContactProfileKeys.value = draft?.contact?.contact_profiles.map((profile) => profile.role_key) ?? []
  selectedContactConversationIds.value = draft?.contactConversations?.conversations.map((conversation) => conversation.id) ?? []
  selectedDoingMenuIds.value = draft?.doing?.menus.map((menu) => menu.id) ?? []
  selectedDoingIds.value = draft?.doing?.doings.map((doing) => doing.id) ?? []
  selectedShopCategoryIds.value = draft?.shop?.categories.map((category) => category.id) ?? []
  selectedShopProductIds.value = draft?.shop?.products.map((product) => product.id) ?? []
}
/** 切换 `StringSelection` 的当前状态。 @param source 调用方传入的 `source`。 @param value 调用方传入的 `value`。 @param checked 调用方传入的 `checked`。 @returns 计算、查找或构建后的结果。 */
function toggleStringSelection(source: string[], value: string, checked: boolean) {
  draftApplied.value = false

  if (checked) {
    return source.includes(value) ? source : [...source, value]
  }

  return source.filter((item) => item !== value)
}
/** 更新 `EventSelected` 对应的响应式值。 @param event 调用方传入的 `event`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setEventSelected(event: StoryCreationDraftEvent, checked: boolean) {
  selectedEventKeys.value = toggleStringSelection(selectedEventKeys.value, getEventKey(event), checked)
}
/** 更新 `LocationSelected` 对应的响应式值。 @param locationId 调用方传入的 `locationId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setLocationSelected(locationId: string, checked: boolean) {
  selectedLocationIds.value = toggleStringSelection(selectedLocationIds.value, locationId, checked)
}
/** 更新 `RoleSelected` 对应的响应式值。 @param role 调用方传入的 `role`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setRoleSelected(role: StoryCreationDraftRole, checked: boolean) {
  selectedRoleKeys.value = toggleStringSelection(selectedRoleKeys.value, getRoleKey(role), checked)
}
/** 更新 `ItemSelected` 对应的响应式值。 @param itemId 调用方传入的 `itemId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setItemSelected(itemId: string, checked: boolean) {
  selectedItemIds.value = toggleStringSelection(selectedItemIds.value, itemId, checked)
}
/** 更新 `VariableSelected` 对应的响应式值。 @param variable 调用方传入的 `variable`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setVariableSelected(variable: StoryCreationDraftVariable, checked: boolean) {
  selectedVariableKeys.value = toggleStringSelection(
    selectedVariableKeys.value,
    getVariableKey(variable),
    checked
  )
}
/** 更新 `ContactPersonalitySelected` 对应的响应式值。 @param personalityId 调用方传入的 `personalityId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactPersonalitySelected(personalityId: string, checked: boolean) {
  selectedContactPersonalityIds.value = toggleStringSelection(
    selectedContactPersonalityIds.value,
    personalityId,
    checked
  )
}
/** 更新联系媒介的草稿选择状态。 */
function setContactChannelSelected(channelId: string, checked: boolean) {
  selectedContactChannelIds.value = toggleStringSelection(selectedContactChannelIds.value, channelId, checked)
}
/** 更新 `ContactTalkSelected` 对应的响应式值。 @param talkId 调用方传入的 `talkId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactTalkSelected(talkId: string, checked: boolean) {
  selectedContactTalkIds.value = toggleStringSelection(selectedContactTalkIds.value, talkId, checked)
}
/** 更新 `ContactActionSelected` 对应的响应式值。 @param actionId 调用方传入的 `actionId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactActionSelected(actionId: string, checked: boolean) {
  selectedContactActionIds.value = toggleStringSelection(selectedContactActionIds.value, actionId, checked)
}
/** 更新 `ContactReplySelected` 对应的响应式值。 @param replyId 调用方传入的 `replyId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactReplySelected(replyId: string, checked: boolean) {
  selectedContactReplyIds.value = toggleStringSelection(selectedContactReplyIds.value, replyId, checked)
}
/** 更新 `ContactProfileSelected` 对应的响应式值。 @param roleKey 调用方传入的 `roleKey`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactProfileSelected(roleKey: string, checked: boolean) {
  selectedContactProfileKeys.value = toggleStringSelection(
    selectedContactProfileKeys.value,
    roleKey,
    checked
  )
}
/** 更新 `ContactConversationSelected` 对应的响应式值。 @param conversationId 调用方传入的 `conversationId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactConversationSelected(conversationId: string, checked: boolean) {
  selectedContactConversationIds.value = toggleStringSelection(
    selectedContactConversationIds.value,
    conversationId,
    checked
  )
}
/** 更新 `DoingMenuSelected` 对应的响应式值。 @param menuId 调用方传入的 `menuId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setDoingMenuSelected(menuId: string, checked: boolean) {
  selectedDoingMenuIds.value = toggleStringSelection(selectedDoingMenuIds.value, menuId, checked)
}
/** 更新 `DoingSelected` 对应的响应式值。 @param doingId 调用方传入的 `doingId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setDoingSelected(doingId: string, checked: boolean) {
  selectedDoingIds.value = toggleStringSelection(selectedDoingIds.value, doingId, checked)
}
/** 更新 `ShopCategorySelected` 对应的响应式值。 @param categoryId 调用方传入的 `categoryId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setShopCategorySelected(categoryId: string, checked: boolean) {
  selectedShopCategoryIds.value = toggleStringSelection(selectedShopCategoryIds.value, categoryId, checked)
}
/** 更新 `ShopProductSelected` 对应的响应式值。 @param productId 调用方传入的 `productId`。 @param checked 调用方传入的 `checked`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setShopProductSelected(productId: string, checked: boolean) {
  selectedShopProductIds.value = toggleStringSelection(selectedShopProductIds.value, productId, checked)
}
/** 读取或计算 `CheckboxChecked`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function getCheckboxChecked(event: Event) {
  return event.target instanceof HTMLInputElement && event.target.checked
}
/** 处理 `LocationSelectionChange` 用户交互。 @param locationId 调用方传入的 `locationId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleLocationSelectionChange(locationId: string, event: Event) {
  setLocationSelected(locationId, getCheckboxChecked(event))
}
/** 处理 `RoleSelectionChange` 用户交互。 @param role 调用方传入的 `role`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleRoleSelectionChange(role: StoryCreationDraftRole, event: Event) {
  setRoleSelected(role, getCheckboxChecked(event))
}
/** 处理 `ItemSelectionChange` 用户交互。 @param itemId 调用方传入的 `itemId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleItemSelectionChange(itemId: string, event: Event) {
  setItemSelected(itemId, getCheckboxChecked(event))
}
/** 处理 `VariableSelectionChange` 用户交互。 @param variable 调用方传入的 `variable`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleVariableSelectionChange(variable: StoryCreationDraftVariable, event: Event) {
  setVariableSelected(variable, getCheckboxChecked(event))
}
/** 处理 `EventSelectionChange` 用户交互。 @param draftEvent 调用方传入的 `draftEvent`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleEventSelectionChange(draftEvent: StoryCreationDraftEvent, event: Event) {
  setEventSelected(draftEvent, getCheckboxChecked(event))
}
/** 处理 `ContactPersonalitySelectionChange` 用户交互。 @param personalityId 调用方传入的 `personalityId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleContactPersonalitySelectionChange(personalityId: string, event: Event) {
  setContactPersonalitySelected(personalityId, getCheckboxChecked(event))
}
/** 根据复选框事件更新联系媒介选择。 */
function handleContactChannelSelectionChange(channelId: string, event: Event) {
  setContactChannelSelected(channelId, getCheckboxChecked(event))
}
/** 处理 `ContactTalkSelectionChange` 用户交互。 @param talkId 调用方传入的 `talkId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleContactTalkSelectionChange(talkId: string, event: Event) {
  setContactTalkSelected(talkId, getCheckboxChecked(event))
}
/** 处理 `ContactActionSelectionChange` 用户交互。 @param actionId 调用方传入的 `actionId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleContactActionSelectionChange(actionId: string, event: Event) {
  setContactActionSelected(actionId, getCheckboxChecked(event))
}
/** 处理 `ContactReplySelectionChange` 用户交互。 @param replyId 调用方传入的 `replyId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleContactReplySelectionChange(replyId: string, event: Event) {
  setContactReplySelected(replyId, getCheckboxChecked(event))
}
/** 处理 `ContactProfileSelectionChange` 用户交互。 @param roleKey 调用方传入的 `roleKey`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleContactProfileSelectionChange(roleKey: string, event: Event) {
  setContactProfileSelected(roleKey, getCheckboxChecked(event))
}
/** 处理 `ContactConversationSelectionChange` 用户交互。 @param conversationId 调用方传入的 `conversationId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleContactConversationSelectionChange(conversationId: string, event: Event) {
  setContactConversationSelected(conversationId, getCheckboxChecked(event))
}
/** 处理 `DoingMenuSelectionChange` 用户交互。 @param menuId 调用方传入的 `menuId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleDoingMenuSelectionChange(menuId: string, event: Event) {
  setDoingMenuSelected(menuId, getCheckboxChecked(event))
}
/** 处理 `DoingSelectionChange` 用户交互。 @param doingId 调用方传入的 `doingId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleDoingSelectionChange(doingId: string, event: Event) {
  setDoingSelected(doingId, getCheckboxChecked(event))
}
/** 处理 `ShopCategorySelectionChange` 用户交互。 @param categoryId 调用方传入的 `categoryId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleShopCategorySelectionChange(categoryId: string, event: Event) {
  setShopCategorySelected(categoryId, getCheckboxChecked(event))
}
/** 处理 `ShopProductSelectionChange` 用户交互。 @param productId 调用方传入的 `productId`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleShopProductSelectionChange(productId: string, event: Event) {
  setShopProductSelected(productId, getCheckboxChecked(event))
}
/** 提交用户明确勾选的 AI 草稿内容。 @returns 无返回值；没有草稿、正在应用或选择数为 0 时不提交，否则把可编辑草稿和各领域 id 选择集合一次 emit 给父层事务应用。 */
function applyDraft() {
  if (!editableDraft.value || props.applying || selectedApplyCount.value === 0) {
    return
  }

  emit("applyDraft", editableDraft.value, {
    eventKeys: selectedEventKeys.value,
    locationIds: selectedLocationIds.value,
    roleKeys: selectedRoleKeys.value,
    itemIds: selectedItemIds.value,
    variableKeys: selectedVariableKeys.value,
    contactChannelIds: selectedContactChannelIds.value,
    contactPersonalityIds: selectedContactPersonalityIds.value,
    contactTalkIds: selectedContactTalkIds.value,
    contactActionIds: selectedContactActionIds.value,
    contactReplyIds: selectedContactReplyIds.value,
    contactProfileKeys: selectedContactProfileKeys.value,
    contactConversationIds: selectedContactConversationIds.value,
    doingMenuIds: selectedDoingMenuIds.value,
    doingIds: selectedDoingIds.value,
    shopCategoryIds: selectedShopCategoryIds.value,
    shopProductIds: selectedShopProductIds.value
  })
}

const creationDraftPreview = useStoryCreationDraftPreview(props, creationState)
const {
  variableValueLabel, setVariableValueFromInput, createImpact, getLocationImpact,
  getRoleImpact, getItemImpact, getVariableImpact, getEventImpact,
  getContactChannelImpact, getContactPersonalityImpact, getContactTalkImpact, getContactActionImpact, getContactReplyImpact,
  getContactProfileImpact, getContactConversationImpact, getDoingMenuImpact, getDoingImpact,
  getShopCategoryImpact, getShopProductImpact, getDraftPresentationDialogues, getPresentationLabel,
  getImpactClass, getItemCategoryName, getDraftOrExistingItemName, getDraftOrExistingShopCategoryName,
  getItemTagsText, splitListInput, setItemTagsText, getContactScopeText,
  getStringListText, setStringListText, setContactPersonalityTags, setContactTalkTags,
  setContactActionTags, setContactReplyTags, setContactPreferredTags, getContactCostItemsText,
  getContactRepliesText, setContactRepliesText, getContactProfileSummary, getDoingPresentationSummary,
  setItemMaxStackFromInput, ensureScheduleLoop, getScheduleAt, setScheduleAt,
  getSchedulePriority, setSchedulePriority, getScheduleAfterText, setScheduleAfterText,
  getEventApplyWarnings, collectionTypeLabel, triggerModeLabel
} = creationDraftPreview



watch(
  () => props.story.storyBible,
  (storyBible) => {
    syncDraft(storyBible)
  },
  { immediate: true }
)

watch(
  () => props.agentResult,
  (result) => {
    syncEditableDraft(result)
    syncApplySelection(editableDraft.value)
    newCreationExpanded.value = !result
    if (result) {
      feedbackText.value = ""
    }
  },
  { immediate: true }
)

watch(
  () => props.applyMessage,
  (message) => {
    if (message) {
      draftApplied.value = true
    }
  }
)

watch(
  () => [props.agentRunning, props.agentRunMode, props.agentError] as const,
  ([running], [previousRunning, previousMode]) => {
    if (previousRunning && previousMode && !running) {
      finishActiveFeedback(props.agentError ? "failed" : "done", props.agentError)
    }
  }
)

  return {
    commandText, feedbackText, newCreationExpanded, creationHistoryExpanded,
    feedbackSeq, activeFeedbackId, activeBibleField, selectedEventKeys,
    selectedLocationIds, selectedRoleKeys, selectedItemIds, selectedVariableKeys,
    selectedContactChannelIds,
    selectedContactPersonalityIds, selectedContactTalkIds, selectedContactActionIds, selectedContactReplyIds,
    selectedContactProfileKeys, selectedContactConversationIds, selectedDoingMenuIds, selectedDoingIds,
    selectedShopCategoryIds, selectedShopProductIds, feedbackHistory, editableDraft,
    draftApplied, draft, bibleFields, pipelineSteps,
    activeBibleFieldConfig, agentModelSummary, filledBibleFieldCount, canRunAgent,
    canRefineDraft, isFeedbackRunning, isNewCreationRunning, abortAgentLabel,
    activeFeedbackItem, historySessions, historySessionCount, showNewCreationForm,
    runStatus, agentLogs, loggedRoles, activeAgentRole,
    draftPreview, eventTypeSummary, contactDraftCount, contactConversationDraftCount,
    doingDraftCount, shopDraftCount, selectedApplyCount, canApplyDraft,
    applyButtonLabel, existingLocationIds, existingRoleKeys, existingItemIds,
    existingItemCategoryIds, existingVariableKeys, existingContactChannelIds, existingContactPersonalityIds, existingContactTalkIds,
    existingContactActionIds, existingContactReplyIds, existingContactProfileKeys, existingContactConversationIds,
    existingDoingMenuIds, existingDoingIds, existingShopCategoryIds, existingShopProductIds,
    existingChainIds, existingEventKeys, selectedDraftChainIds, availableLocationIdsForApply,
    availableRoleKeysForApply, availableChainIdsForApply, availableDoingMenuIdsForApply, availableItemIdsForApply,
    availableShopCategoryIdsForApply, selectedImpactSummary, applyPreviewMessage, syncDraft,
    submitStoryBible, runAgent, refineDraft, abortAgent,
    appendFeedbackHistory, finishActiveFeedback, updateFeedbackHistoryItem, clearFeedbackHistory,
    feedbackStatusLabel, getFeedbackStatusClass, historyStatusLabel, historyStatusClass,
    formatHistoryTime, syncFeedbackHistoryFromSession, restoreHistorySession, deleteHistorySession,
    getEventKey, getRoleKey, getVariableKey, cloneCreationDraft,
    syncEditableDraft, resetEditableDraft, syncApplySelection, toggleStringSelection,
    setEventSelected, setLocationSelected, setRoleSelected, setItemSelected,
    setVariableSelected, setContactChannelSelected, setContactPersonalitySelected, setContactTalkSelected, setContactActionSelected,
    setContactReplySelected, setContactProfileSelected, setContactConversationSelected, setDoingMenuSelected,
    setDoingSelected, setShopCategorySelected, setShopProductSelected, getCheckboxChecked,
    handleLocationSelectionChange, handleRoleSelectionChange, handleItemSelectionChange, handleVariableSelectionChange,
    handleEventSelectionChange, handleContactChannelSelectionChange, handleContactPersonalitySelectionChange, handleContactTalkSelectionChange, handleContactActionSelectionChange,
    handleContactReplySelectionChange, handleContactProfileSelectionChange, handleContactConversationSelectionChange, handleDoingMenuSelectionChange,
    handleDoingSelectionChange, handleShopCategorySelectionChange, handleShopProductSelectionChange, applyDraft,
    variableValueLabel, setVariableValueFromInput, createImpact, getLocationImpact,
    getRoleImpact, getItemImpact, getVariableImpact, getEventImpact,
    getContactChannelImpact, getContactPersonalityImpact, getContactTalkImpact, getContactActionImpact, getContactReplyImpact,
    getContactProfileImpact, getContactConversationImpact, getDoingMenuImpact, getDoingImpact,
    getShopCategoryImpact, getShopProductImpact, getDraftPresentationDialogues, getPresentationLabel,
    getImpactClass, getItemCategoryName, getDraftOrExistingItemName, getDraftOrExistingShopCategoryName,
    getItemTagsText, splitListInput, setItemTagsText, getContactScopeText,
    getStringListText, setStringListText, setContactPersonalityTags, setContactTalkTags,
    setContactActionTags, setContactReplyTags, setContactPreferredTags, getContactCostItemsText,
    getContactRepliesText, setContactRepliesText, getContactProfileSummary, getDoingPresentationSummary,
    setItemMaxStackFromInput, ensureScheduleLoop, getScheduleAt, setScheduleAt,
    getSchedulePriority, setSchedulePriority, getScheduleAfterText, setScheduleAfterText,
    getEventApplyWarnings, collectionTypeLabel, triggerModeLabel
  }
}

export type StoryCreationWorkspaceController = ReturnType<typeof useStoryCreationWorkspace>
