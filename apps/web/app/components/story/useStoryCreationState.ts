/**
 * 保存 StoryCreationWorkspace 的最小源状态，并从 props 派生所有展示/应用索引。
 *
 * 输入是父组件只读 props：当前故事、AI 设置、任务状态、历史和最新 Agent 结果。输出是命令文本、
 * 故事圣经表单、可编辑草稿、各领域勾选数组，以及只读 computed 摘要。它不 emit、不调用 API，
 * 也不应用草稿；副作用由 Workspace 组合层转发给 StoryEditorCreationActions。
 *
 * Vue 数据流：props 向下提供权威故事；本 composable 拥有工作区临时状态；模板事件只修改这些 Ref
 * 或向父组件 emit。现有故事索引全部用 computed 派生，避免 watch 复制后产生过期数据。
 */
import type { StoryBibleFile } from "@story-mgr/core"
import type {
  StoryCreationAgentRole,
  StoryCreationDraft,
  StoryCreationDraftEvent,
  StoryCreationDraftRole,
  StoryCreationDraftVariable
} from "@story-mgr/shared"
import { computed, reactive, ref, shallowRef } from "vue"
import type { StoryCreationWorkspaceProps } from "./useStoryCreationWorkspace"

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

/** 读取或计算 `EventKey`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function getEventKey(event: StoryCreationDraftEvent) {
  return `${event.collectionType}:${event.id}`
}

/** 读取或计算 `RoleKey`。 @param role 调用方传入的 `role`。 @returns 计算、查找或构建后的结果。 */
function getRoleKey(role: StoryCreationDraftRole) {
  return `${role.important ? "important" : "normal"}:${role.id}`
}

/** 读取或计算 `VariableKey`。 @param variable 调用方传入的 `variable`。 @returns 计算、查找或构建后的结果。 */
function getVariableKey(variable: StoryCreationDraftVariable) {
  return `${variable.group}.${variable.name}`
}

/**
 * 创建创作工作区状态控制器。
 *
 * 返回值会继续传给 DraftPreview 和 Workspace Actions；两者共享同一批 Ref，不会复制 editableDraft。
 */
export function useStoryCreationState(props: Readonly<StoryCreationWorkspaceProps>) {
// 简单文本、开关、计数和选择数组都通过“整体替换”更新，所以使用 shallowRef 即可。
// editableDraft 会在预览表单中直接修改深层字段，必须使用 ref 让嵌套输入保持响应式。
const commandText = shallowRef("")
const feedbackText = shallowRef("")
const newCreationExpanded = shallowRef(true)
const creationHistoryExpanded = shallowRef(false)
const feedbackSeq = shallowRef(0)
const activeFeedbackId = shallowRef<number | null>(null)
const activeBibleField = shallowRef<BibleFieldKey>("background")
const selectedEventKeys = shallowRef<string[]>([])
const selectedLocationIds = shallowRef<string[]>([])
const selectedRoleKeys = shallowRef<string[]>([])
const selectedItemIds = shallowRef<string[]>([])
const selectedVariableKeys = shallowRef<string[]>([])
const selectedContactChannelIds = shallowRef<string[]>([])
const selectedContactPersonalityIds = shallowRef<string[]>([])
const selectedContactTalkIds = shallowRef<string[]>([])
const selectedContactActionIds = shallowRef<string[]>([])
const selectedContactReplyIds = shallowRef<string[]>([])
const selectedContactProfileKeys = shallowRef<string[]>([])
const selectedContactConversationIds = shallowRef<string[]>([])
const selectedDoingMenuIds = shallowRef<string[]>([])
const selectedDoingIds = shallowRef<string[]>([])
const selectedShopCategoryIds = shallowRef<string[]>([])
const selectedShopProductIds = shallowRef<string[]>([])
const feedbackHistory = ref<FeedbackHistoryItem[]>([])
const editableDraft = ref<StoryCreationDraft | null>(null)
const draftApplied = shallowRef(false)

// 故事圣经是固定的小型表单对象，字段通过 v-model 原地修改，使用 reactive 比多个独立 Ref 更清晰。
const draft = reactive<StoryBibleFile>({
  background: "",
  golden_finger: "",
  protagonist: "",
  world_rules: "",
  outline: "",
  current_arc: "",
  gameplay_design: "",
  style_guide: "",
  constraints: ""
})

const bibleFields: BibleFieldConfig[] = [
  {
    key: "background",
    label: "故事背景",
    placeholder: "小说世界的时代、地域、势力格局、开局矛盾。"
  },
  {
    key: "golden_finger",
    label: "金手指",
    placeholder: "主角独有能力、系统规则、成长边界、代价。"
  },
  {
    key: "protagonist",
    label: "主角设定",
    placeholder: "默认主角身份、性格底色、初始处境、可被玩家覆盖的部分。"
  },
  {
    key: "world_rules",
    label: "世界规则",
    placeholder: "经济、修炼、权力、时间推进、常识和不可违背的规则。"
  },
  {
    key: "outline",
    label: "故事大纲",
    placeholder: "主线篇章、关键爽点、主要反派、阶段性目标。"
  },
  {
    key: "current_arc",
    label: "当前篇章",
    placeholder: "当前要扩写的篇章位置、冲突焦点、下一批事件目标。"
  },
  {
    key: "gameplay_design",
    label: "玩法设计",
    placeholder: "玩家选择空间、变量驱动、事件池触发策略、失败和回报结构。"
  },
  {
    key: "style_guide",
    label: "文风口味",
    placeholder: "叙事节奏、对白风格、爽感密度、禁用表达。"
  },
  {
    key: "constraints",
    label: "约束禁忌",
    placeholder: "不能生成的剧情、不能破坏的设定、必须保留的玩家自由度。"
  }
]

const pipelineSteps: Array<{ role: StoryCreationAgentRole; label: string }> = [
  { role: "chiefEditor", label: "主编" },
  { role: "plotPlanner", label: "规划" },
  { role: "assetDesigner", label: "资产" },
  { role: "eventWriter", label: "事件" },
  { role: "scriptDoctor", label: "审校" },
  { role: "consistencyChecker", label: "一致性" }
]

// 第一组 computed 只负责工作区展示状态：按钮是否可用、当前运行模式、日志和各领域草稿数量。
// computed getter 保持纯函数，不在其中 emit、写 Ref 或发请求。
const activeBibleFieldConfig = computed<BibleFieldConfig>(() => {
  return bibleFields.find((field) => field.key === activeBibleField.value) ?? bibleFields[0]!
})

const agentModelSummary = computed(() => {
  const agent = props.settings?.ai.agent

  if (!agent) {
    return "未配置"
  }

  return agent.eventWriterModel || agent.plotPlannerModel || agent.chiefEditorModel || "未配置"
})

const filledBibleFieldCount = computed(() => {
  return bibleFields.filter((field) => draft[field.key].trim().length > 0).length
})

const canRunAgent = computed(() => {
  return commandText.value.trim().length > 0 && !props.agentRunning
})

const canRefineDraft = computed(() => {
  return feedbackText.value.trim().length > 0 && !!editableDraft.value && !props.agentRunning
})

const isFeedbackRunning = computed(() => {
  return props.agentRunning && props.agentRunMode === "feedback"
})

const isNewCreationRunning = computed(() => {
  return props.agentRunning && props.agentRunMode === "new"
})

const abortAgentLabel = computed(() => {
  if (props.agentRunMode === "feedback") {
    return "中止优化"
  }

  if (props.agentRunMode === "new") {
    return "中止生成"
  }

  return "中止当前任务"
})

const activeFeedbackItem = computed(() => {
  if (activeFeedbackId.value === null) {
    return null
  }

  return feedbackHistory.value.find((item) => item.id === activeFeedbackId.value) ?? null
})

const historySessions = computed(() => {
  return [...props.creationHistory.sessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )
})

const historySessionCount = computed(() => historySessions.value.length)

const showNewCreationForm = computed(() => {
  return !editableDraft.value || newCreationExpanded.value
})

const runStatus = computed(() => {
  if (props.agentRunning && props.creationJob?.currentRole) {
    const step = pipelineSteps.find((item) => item.role === props.creationJob?.currentRole)
    return `${step?.label ?? "Agent"}正在处理，任务可在刷新页面后继续恢复...`
  }

  if (isFeedbackRunning.value) {
    return "正在优化当前草稿..."
  }

  if (isNewCreationRunning.value) {
    return "多 Agent 正在生成草稿..."
  }

  if (editableDraft.value) {
    return `已生成 ${editableDraft.value.events.length} 个事件草稿、${editableDraft.value.items.length} 个物品草稿`
  }

  return "等待创作指令"
})

const agentLogs = computed(() => {
  if (props.agentRunning) {
    return props.creationJob?.logs ?? []
  }

  return props.agentResult?.logs ?? []
})

const loggedRoles = computed(() => {
  return new Set(agentLogs.value
    .filter((log) => !("status" in log) || log.status === "completed")
    .map((log) => log.role))
})

const activeAgentRole = computed(() => props.creationJob?.currentRole ?? null)

const draftPreview = computed(() => {
  return editableDraft.value
})

const eventTypeSummary = computed(() => {
  const events = draftPreview.value?.events ?? []

  return {
    chain: events.filter((event) => event.collectionType === "chain").length,
    pool: events.filter((event) => event.collectionType === "pool").length,
    schedule: events.filter((event) => event.collectionType === "schedule").length
  }
})

const contactDraftCount = computed(() => {
  const contact = draftPreview.value?.contact

  if (!contact) {
    return 0
  }

  return contact.personality_library.length
    + contact.channels.length
    + contact.talk_library.length
    + contact.action_library.length
    + contact.reply_library.length
    + contact.contact_profiles.length
})

const contactConversationDraftCount = computed(() => {
  return draftPreview.value?.contactConversations?.conversations.length ?? 0
})

const doingDraftCount = computed(() => {
  const doing = draftPreview.value?.doing

  if (!doing) {
    return 0
  }

  return doing.menus.length + doing.doings.length
})

const shopDraftCount = computed(() => {
  const shop = draftPreview.value?.shop

  if (!shop) {
    return 0
  }

  return shop.categories.length + shop.products.length
})

const selectedApplyCount = computed(() => {
  return selectedEventKeys.value.length
    + selectedLocationIds.value.length
    + selectedRoleKeys.value.length
    + selectedItemIds.value.length
    + selectedVariableKeys.value.length
    + selectedContactChannelIds.value.length
    + selectedContactPersonalityIds.value.length
    + selectedContactTalkIds.value.length
    + selectedContactActionIds.value.length
    + selectedContactReplyIds.value.length
    + selectedContactProfileKeys.value.length
    + selectedContactConversationIds.value.length
    + selectedDoingMenuIds.value.length
    + selectedDoingIds.value.length
    + selectedShopCategoryIds.value.length
    + selectedShopProductIds.value.length
})

const canApplyDraft = computed(() => {
  return !!editableDraft.value && selectedApplyCount.value > 0 && !props.applying && !draftApplied.value
})

const applyButtonLabel = computed(() => {
  if (props.applying) {
    return "应用中..."
  }

  if (draftApplied.value) {
    return "已应用"
  }

  return "应用草稿"
})

// 第二组 computed 把当前 StoryDocument 建成 Set 索引。Set 只用于本地 O(1) 存在性查询，
// 不会序列化或传给服务端；props.storyDocument 替换后所有索引会自动重新计算。
const existingLocationIds = computed(() => {
  return new Set(props.story.eventLocations.assignments.map((location) => location.id))
})

const existingRoleKeys = computed(() => {
  return new Set([
    ...props.story.roles.normal.roles.map((role) => `normal:${role.id}`),
    ...props.story.roles.important.roles.map((role) => `important:${role.id}`)
  ])
})

const existingItemIds = computed(() => {
  return new Set(props.story.items.items.map((item) => item.id))
})

const existingItemCategoryIds = computed(() => {
  return new Set(props.story.items.categories.map((category) => category.id))
})

const existingVariableKeys = computed(() => {
  return new Set(
    props.story.vals.variables.flatMap((group) =>
      group.vals.map((entry) => `${group.name}.${entry.name}`)
    )
  )
})

const existingContactPersonalityIds = computed(() => {
  return new Set(props.story.contact.personality_library.map((personality) => personality.id))
})

const existingContactChannelIds = computed(() => {
  return new Set(props.story.contact.channels.map((channel) => channel.id))
})

const existingContactTalkIds = computed(() => {
  return new Set(props.story.contact.talk_library.map((entry) => entry.id))
})

const existingContactActionIds = computed(() => {
  return new Set(props.story.contact.action_library.map((entry) => entry.id))
})

const existingContactReplyIds = computed(() => {
  return new Set(props.story.contact.reply_library.map((entry) => entry.id))
})

const existingContactProfileKeys = computed(() => {
  return new Set(props.story.contact.contact_profiles.map((profile) => profile.role_key))
})

const existingContactConversationIds = computed(() => {
  return new Set(props.story.contactConversations.conversations.map((conversation) => conversation.id))
})

const existingDoingMenuIds = computed(() => {
  return new Set(props.story.doing.menus.map((menu) => menu.id))
})

const existingDoingIds = computed(() => {
  return new Set(props.story.doing.doings.map((doing) => doing.id))
})

const existingShopCategoryIds = computed(() => {
  return new Set(props.story.shop.categories.map((category) => category.id))
})

const existingShopProductIds = computed(() => {
  return new Set(props.story.shop.products.map((product) => product.id))
})

const existingChainIds = computed(() => {
  return new Set(props.story.chainEvents.map((event) => event.id))
})

const existingEventKeys = computed(() => {
  return new Set([
    ...props.story.chainEvents.map((event) => `chain:${event.id}`),
    ...props.story.poolEvents.map((event) => `pool:${event.id}`),
    ...props.story.scheduleEvents.map((event) => `schedule:${event.id}`)
  ])
})

// “可应用 id”必须同时考虑现有故事和本次已勾选草稿。例如一个新商城商品只能引用已有物品，
// 或引用同一批草稿里也被用户选中的新物品，不能引用只存在于未勾选预览中的内容。
const selectedDraftChainIds = computed(() => {
  const selectedKeys = new Set(selectedEventKeys.value)
  return new Set(
    draftPreview.value?.events
      .filter((event) => event.collectionType === "chain" && selectedKeys.has(getEventKey(event)))
      .map((event) => event.id) ?? []
  )
})

const availableLocationIdsForApply = computed(() => {
  return new Set([
    ...Array.from(existingLocationIds.value),
    ...selectedLocationIds.value
  ])
})

const availableRoleKeysForApply = computed(() => {
  return new Set([
    "player",
    ...Array.from(existingRoleKeys.value),
    ...selectedRoleKeys.value
  ])
})

const availableChainIdsForApply = computed(() => {
  return new Set([
    ...Array.from(existingChainIds.value),
    ...Array.from(selectedDraftChainIds.value)
  ])
})

const availableDoingMenuIdsForApply = computed(() => {
  return new Set([
    ...Array.from(existingDoingMenuIds.value),
    ...selectedDoingMenuIds.value
  ])
})

const availableItemIdsForApply = computed(() => {
  return new Set([
    ...Array.from(existingItemIds.value),
    ...selectedItemIds.value
  ])
})

const availableShopCategoryIdsForApply = computed(() => {
  return new Set([
    ...Array.from(existingShopCategoryIds.value),
    ...selectedShopCategoryIds.value
  ])
})

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
    availableShopCategoryIdsForApply, getEventKey, getRoleKey, getVariableKey
  }
}

export type StoryCreationStateController = ReturnType<typeof useStoryCreationState>
