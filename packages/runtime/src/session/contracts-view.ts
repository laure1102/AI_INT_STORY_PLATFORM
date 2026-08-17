/**
 * 客户端视图、action、内部播放状态与默认常量。
 *
 * 本文件由原 session.ts 按顶层声明依赖拆出；它只负责本领域，不提供新的外部入口。
 */
import {
  DEFAULT_CLOCK_STEP_MINUTES,
  MINUTES_PER_DAY,
  datePartsToUtcDayNumber,
  formatStoryDate,
  parseStoryDate,
  snapMinuteToStep,
  utcDayNumberToDateParts,
  type RuntimeClockState,
  type RuntimeDateParts
} from "../clock"
import {
  createRuntimeRngState,
  nextRuntimeRandom,
  normalizeRuntimeRngState,
  type RuntimeRngState
} from "../rng"
import { sortScheduledEvents } from "../scheduler"
import {
  evaluateStoryBooleanExpression,
  executeStoryScript,
  renderStoryTextTemplate
} from "../vals"
import {
  createRuleBasedRuntimeDirector,
  createRuntimeDirectorDecisionLog,
  flattenDirectorValues,
  type RuntimeDirectorCandidate,
  type RuntimeDirectorCandidateSourceType,
  type RuntimeDirectorDecisionLog,
  type RuntimeDirectorFeatureSnapshot,
  type RuntimeDirectorHistoryEntry,
  type RuntimeStoryDirector
} from "../director"
import type {
  StoryScriptExecutionContext,
  StoryScriptInvocation,
  StoryScriptInvokeDelay
} from "../vals"
import type {
  StoryInvokeTargetType,
  StoryPlayerOverrideValsFile,
  StoryValDefinition,
  StoryValEntryDefinition,
  StoryValsFile
} from "../types"
import type { CompiledAction, CompiledEvent, RuntimeContactChannelLabels, RuntimeContactChannelPreset, RuntimeEventTriggerMode, RuntimeInitialBagsFile, RuntimeContactTrackId, RuntimeHistoryEntry, RuntimePlaybackActionState, RuntimePlaybackState, RuntimeProfileCustomFile, RuntimeSchedulerAuditKind, RuntimeStandaloneEvent, RuntimeStoryDoingFile, RuntimeStoryItemsFile, RuntimeStoryContactProfile, RuntimeStoryContactConversationRuntimeState, RuntimeStoryContactConversationsFile, RuntimeStoryContactEventInvocation, RuntimeStoryContactFile, RuntimeStoryContactRelationshipTrack, RuntimeStoryPresentation, RuntimeStoryReferFile, RuntimeStorySaveState, RuntimeStorySessionSnapshot, RuntimeStoryShopFile } from "./contracts-core"
import { getRuntimeActiveCallValues } from "./script-context"
import { cloneValue, normalizeText } from "./state-values"

export interface RuntimeStoryBundle {
  schemaVersion?: 1 | 2
  contentHash?: string
  storyId: string
  title: string
  generatedAt: string
  gameSettings?: {
    start_time?: string
  }
  vals: StoryValsFile
  playerOverrideVals: StoryPlayerOverrideValsFile
  systemVals: StoryValsFile
  scenes: unknown
  roles: unknown
  eventLocations: unknown
  items?: RuntimeStoryItemsFile
  initialBags?: RuntimeInitialBagsFile
  contact?: RuntimeStoryContactFile
  contactConversations?: RuntimeStoryContactConversationsFile
  refer?: RuntimeStoryReferFile
  doing?: RuntimeStoryDoingFile
  shop?: RuntimeStoryShopFile
  chainEvents?: Record<string, unknown>
  poolEvents?: unknown[]
  scheduleEvents?: unknown[]
  /** @deprecated 请改用 chainEvents */
  graphEvents?: Record<string, unknown>
  /** @deprecated 请改用 poolEvents */
  onceEvents?: unknown[]
  /** @deprecated 请改用 scheduleEvents */
  loopEvents?: unknown[]
}

export type RuntimeInteraction =
  | {
      kind: "select"
      prompt: string
      options: Array<{
        id: string
        label: string
        description?: string
      }>
    }
  | {
      kind: "text-input"
      prompt: string
      field: string
      initialValue?: string
      placeholder?: string
    }
  | {
      kind: "confirm"
      prompt: string
      confirmLabel?: string
      cancelLabel?: string
    }
  | null

export interface RuntimeRenderedDialogue {
  index: number
  total: number
  speakerLabel: string
  speakerKey: string
  content: string
}

export interface RuntimeRenderedMessage {
  content: string
  durationSeconds: number
  elapsedSeconds: number
  remainingSeconds: number
}

export interface RuntimeBranchOptionView {
  id: string
  title: string
  nextEventId: string | null
  vars: Array<{
    name: string
    descr?: string
    initialValue: string
  }>
}

export interface RuntimeBagItemView {
  ownerId: string
  itemId: string
  itemName: string
  quantity: number
  bound: boolean
  obtainedAtDay: number
  obtainedAtMinute: number
  giftable: boolean
  giftFavorDelta: number
  giftCooldownHours: number
  giftDisabledReason: string | null
}

export interface RuntimeBagSummary {
  ownerId: string
  itemCount: number
  totalQuantity: number
  entries: RuntimeBagItemView[]
}

export interface RuntimeContactQuickMessageView {
  id: string
  text: string
  tags: string[]
  baseFavorDelta: number
  cooldownHours: number
  suggested: boolean
}

export interface RuntimeContactView {
  roleKey: string
  label: string
  favor: number
  relationTrackId: RuntimeContactTrackId
  relationTrackLabel: string
  relationStageId: string
  relationStageLabel: string
  canContact: boolean
  lockMessage: string | null
  personalityId: string
  personalityLabel: string
  unreadCount: number
  unlockedAtDay: number
  lastMessageGameMinute: number | null
  lastMessagePreview: string | null
  messageCount: number
  channelId: string
  channelName: string
  channelPreset: RuntimeContactChannelPreset
  channelLabels: Required<RuntimeContactChannelLabels>
}

export interface RuntimeContactThreadMessageView {
  id: string
  sender: "player" | "contact" | "system"
  senderLabel: string
  content: string
  gameMinute: number
  read: boolean
}

export interface RuntimeContactActionCostItemView {
  itemId: string
  itemName: string
  quantity: number
}

export interface RuntimeContactActionView {
  id: string
  label: string
  text: string
  tags: string[]
  baseFavorDelta: number
  cooldownHours: number
  costMoney: number
  costItems: RuntimeContactActionCostItemView[]
  disabled: boolean
  disabledReason: string | null
  invokeEventLabel: string | null
}

export interface RuntimeContactThreadView {
  roleKey: string
  contactLabel: string
  favor: number
  relationTrackId: RuntimeContactTrackId
  relationTrackLabel: string
  relationStageId: string
  relationStageLabel: string
  canContact: boolean
  lockMessage: string | null
  personalityId: string
  personalityLabel: string
  unreadCount: number
  messages: RuntimeContactThreadMessageView[]
  talks: RuntimeContactQuickMessageView[]
  actions: RuntimeContactActionView[]
  quickMessages: RuntimeContactQuickMessageView[]
  channelId: string
  channelName: string
  channelPreset: RuntimeContactChannelPreset
  channelLabels: Required<RuntimeContactChannelLabels>
}

export interface RuntimeDoingMenuView {
  id: string
  title: string
  parentId: string
  sortOrder: number
  descr: string
}

export interface RuntimeDoingActionView {
  id: string
  title: string
  menuId: string
  descr: string
  cooldownHours: number
  cooldownLeftHours: number
  usedCount: number
  once: boolean
  disabled: boolean
  disabledReason: string | null
}

export interface RuntimeDoingView {
  menus: RuntimeDoingMenuView[]
  doings: RuntimeDoingActionView[]
}

export interface RuntimeShopCategoryView {
  id: string
  name: string
  sortOrder: number
  descr: string
}

export interface RuntimeShopProductView {
  id: string
  categoryId: string
  itemId: string
  itemName: string
  price: number
  quantity: number
  sortOrder: number
  allowGift: boolean
  giftFavorDelta: number
  purchaseCooldownHours: number
  purchaseCooldownLeftHours: number
  giftCooldownHours: number
  ownedQuantity: number
  disabled: boolean
  disabledReason: string | null
  unavailableReason: string | null
}

export interface RuntimeShopView {
  currencyValueKey: string
  categories: RuntimeShopCategoryView[]
  products: RuntimeShopProductView[]
}

export interface RuntimeStoryViewModel {
  screen: "boot" | "profile" | "save-select" | "game" | "debug"
  storyTitle: string
  activeEventId: string | null
  activeEventTitle: string | null
  interaction: RuntimeInteraction
  notifications: string[]
  history: RuntimeHistoryEntry[]
  currentLocationId: string | null
  currentLocationName: string | null
  currentSceneLevel: number | null
  currentMessage: RuntimeRenderedMessage | null
  currentDialogue: RuntimeRenderedDialogue | null
  contactConversation: RuntimeRuntimeContactConversationView | null
  availableBranches: RuntimeBranchOptionView[]
  branchContextSummary: Array<{
    key: string
    value: string
  }>
  bagSummary: RuntimeBagSummary[]
  doing: RuntimeDoingView
  shop: RuntimeShopView
  debugSummary: {
    globalGroupCount: number
    systemGroupCount: number
    historyCount: number
    triggeredOnceCount: number
  }
}

export type RuntimeStorySessionAction =
  | { type: "continue" }
  | { type: "select-option"; optionId: string }
  | { type: "submit-text"; field: string; value: string }
  | { type: "invoke-once"; targetType: StoryInvokeTargetType; eventId: string; args?: Record<string, unknown> }
  | { type: "contact-select-conversation-reply"; optionId: string }
  | { type: "contact-send-talk"; roleKey: string; talkId: string }
  | { type: "contact-send-action"; roleKey: string; actionId: string }
  | { type: "contact-send-quick-message"; roleKey: string; quickMessageId: string }
  | { type: "contact-mark-read"; roleKey: string }
  | { type: "start-doing"; doingId: string }
  | { type: "bag-gift"; itemId: string; roleKey: string; quantity: number }
  | { type: "shop-buy"; productId: string }
  | { type: "shop-gift"; productId: string; roleKey: string }
  | { type: "open-debug" }
  | { type: "close-debug" }

/**
 * 创建 Runtime 会话所需依赖。
 *
 * bundle 必填；customOverrides 仅用于新游戏；saveState 存在时优先恢复存档。`wallClock` 和
 * `storyDirector` 可注入，测试和不同客户端因此能复用同一确定性运行逻辑。
 */
export interface CreateStorySessionOptions {
  bundle: RuntimeStoryBundle
  customOverrides?: RuntimeProfileCustomFile | null
  saveState?: RuntimeStorySaveState | null
  now?: Date
  wallClock?: () => Date
  storyDirector?: RuntimeStoryDirector | null
}

/**
 * 客户端可使用的稳定会话 API。
 *
 * 所有修改通过 dispatch/时间方法进入；getter 返回视图或克隆后的可保存状态，客户端不应直接修改
 * Runtime 内部对象。HTML 与未来 Cocos 客户端都依赖这一边界。
 */
export interface RuntimeStorySession {
  dispatch(action: RuntimeStorySessionAction): boolean | void
  invokeOnceEvent(targetType: StoryInvokeTargetType, eventId: string, args?: Record<string, unknown>): boolean
  tick(deltaMs: number): void
  setTimePause(paused: boolean): void
  setTimeSpeed(speed: number): void
  getViewModel(): RuntimeStoryViewModel
  getSnapshot(): RuntimeStorySessionSnapshot
  getPlaybackState(): RuntimePlaybackState
}

/** 运行时内部的行动节点状态；使用 camelCase，不直接作为 JSON 存档格式。 */
export interface RuntimeActionState {
  nodeId: string
  branchValues: Record<string, unknown>
}

/**
 * 一个会话实例在内存中的聚合状态。
 *
 * snapshot 是可持久化长期状态；其余字段主要是前台播放和领域服务的瞬时工作状态。保存时由
 * `createRuntimePlaybackState` 把必要游标转换成 snake_case 契约，其余实现细节不泄漏到存档。
 */
export interface RuntimeState {
  snapshot: RuntimeStorySessionSnapshot
  currentEventEntered: boolean
  currentDialogueIndex: number
  currentMessageElapsedMs: number
  pendingActions: RuntimeActionState[]
  lastAction: RuntimeActionState | null
  activeStandaloneEvent: RuntimeStandaloneEvent | null
  activeContactConversation: RuntimeStoryContactConversationRuntimeState | null
  storyDirector: RuntimeStoryDirector
}

/** @param action 存档中的 snake_case 行动游标。 @returns Runtime 内部行动状态；分支值会深拷贝。 */
export function toRuntimeActionState(action: RuntimePlaybackActionState): RuntimeActionState {
  return {
    nodeId: normalizeText(action.node_id),
    branchValues: cloneValue(action.branch_values ?? {})
  }
}

/**
 * 从当前 RuntimeState 提取 v2 存档所需的播放游标。
 *
 * @param runtimeState 当前会话内部状态。
 * @returns 与内部可变对象断开引用的 v2 播放状态。
 *
 * 返回值与内部对象断开引用，后续会话继续推进不会改变已经交给存档服务的数据。active scheduler
 * 的 call values 一并保存，使 invoke 事件加载后仍能读取原调用参数。
 */
export function createRuntimePlaybackState(runtimeState: RuntimeState): RuntimePlaybackState {
  /** @param action 内部行动状态。 @returns 使用存档字段名且已克隆分支值的行动游标。 */
  const toPlaybackAction = (action: RuntimeActionState): RuntimePlaybackActionState => ({
    node_id: action.nodeId,
    branch_values: cloneValue(action.branchValues)
  })

  return {
    current_event_entered: runtimeState.currentEventEntered,
    dialogue_index: runtimeState.currentDialogueIndex,
    message_elapsed_ms: runtimeState.currentMessageElapsedMs,
    pending_actions: runtimeState.pendingActions.map(toPlaybackAction),
    last_action: runtimeState.lastAction ? toPlaybackAction(runtimeState.lastAction) : null,
    call_values: getRuntimeActiveCallValues(runtimeState)
  }
}

export interface RuntimeRuntimeContactConversationReplyView {
  id: string
  text: string
  visible: boolean
}

export interface RuntimeRuntimeContactConversationNodeView {
  id: string
  contactMessages: string[]
  replies: RuntimeRuntimeContactConversationReplyView[]
  end: boolean
}

export interface RuntimeRuntimeContactConversationView {
  conversationId: string
  title: string
  roleKey: string
  roleLabel: string
  nodeId: string
  nodeTitle: string
  nodeIndex: number
  nodeTotal: number
  messages: RuntimeRenderedDialogue[]
  replies: RuntimeRuntimeContactConversationReplyView[]
  finished: boolean
  lockNormalChat: boolean
}

export interface RuntimeResolvedContactMeta {
  roleKey: string
  label: string
  enabled: boolean
  autoAdd: boolean
  favor: number
  initialFavor: number
  trackId: RuntimeContactTrackId
  trackLabel: string
  stageId: string
  stageLabel: string
  canContact: boolean
  lockMessage: string | null
  personalityId: string
  personalityLabel: string
  channelId: string
  channelName: string
  channelPreset: RuntimeContactChannelPreset
  channelLabels: Required<RuntimeContactChannelLabels>
  preferredTags: Set<string>
  profile: RuntimeStoryContactProfile | null
  unlockActionTags: Set<string>
}

export interface RuntimeResolvedContactTalkOption {
  id: string
  text: string
  tags: string[]
  baseFavorDelta: number
  cooldownHours: number
  suggested: boolean
  preferred: boolean
  invoke?: RuntimeStoryContactEventInvocation
  source: "talk-library" | "legacy-quick-message"
}

export interface RuntimeResolvedContactActionOption {
  id: string
  label: string
  text: string
  tags: string[]
  baseFavorDelta: number
  cooldownHours: number
  costMoney: number
  costItems: RuntimeContactActionCostItemView[]
  preferred: boolean
  disabled: boolean
  disabledReason: string | null
  invoke?: RuntimeStoryContactEventInvocation
}

export interface RuntimeEnterEventOptions {
  skipTriggerCheck?: boolean
}

export interface RuntimeDialogueNodeState {
  node: CompiledEvent
  currentMessage: RuntimeRenderedMessage | null
  currentDialogue: RuntimeRenderedDialogue | null
  availableActions: RuntimeActionState[]
  autoNextEventIds: string[]
  locationName: string | null
}

export type RuntimeGraphNode = CompiledEvent | CompiledAction

export type RuntimePlayableEvent = CompiledEvent | RuntimeStandaloneEvent

export const DEFAULT_MAX_CALC_NESTING_DEPTH = 5

export const MAX_SCHEDULER_AUDIT_LOGS = 120

export const MAX_RUNTIME_DIRECTOR_LOGS = 120

export const DEFAULT_CONTACT_RELATIONSHIP_TRACKS: RuntimeStoryContactRelationshipTrack[] = [
  {
    id: "romance",
    name: "恋爱关系",
    descr: "可发展恋爱关系的联系人轨道。",
    stages: [
      { id: "breakup", name: "分手/决裂", descr: "", min_favor: 0, max_favor: 9, allow_contact: false, lock_message: "她现在很讨厌我，肯定不会理我了。", unlock_action_tags: [] },
      { id: "cold", name: "冷淡", descr: "", min_favor: 10, max_favor: 19, allow_contact: true, lock_message: "", unlock_action_tags: [] },
      { id: "stranger", name: "陌生", descr: "", min_favor: 20, max_favor: 39, allow_contact: true, lock_message: "", unlock_action_tags: [] },
      { id: "familiar", name: "熟悉", descr: "", min_favor: 40, max_favor: 59, allow_contact: true, lock_message: "", unlock_action_tags: ["gift_basic"] },
      { id: "dateable", name: "暧昧", descr: "", min_favor: 60, max_favor: 89, allow_contact: true, lock_message: "", unlock_action_tags: ["gift_basic", "date"] },
      { id: "lover", name: "情人", descr: "", min_favor: 90, max_favor: 100, allow_contact: true, lock_message: "", unlock_action_tags: ["gift_basic", "date", "hotel"] }
    ]
  },
  {
    id: "official",
    name: "政务关系",
    descr: "政府、公职和资源型联系人轨道。",
    stages: [
      { id: "distant", name: "疏远", descr: "", min_favor: 0, max_favor: 19, allow_contact: true, lock_message: "", unlock_action_tags: [] },
      { id: "basic", name: "普通接触", descr: "", min_favor: 20, max_favor: 39, allow_contact: true, lock_message: "", unlock_action_tags: ["formal_visit"] },
      { id: "recognized", name: "认可", descr: "", min_favor: 40, max_favor: 59, allow_contact: true, lock_message: "", unlock_action_tags: ["formal_visit", "gift_basic"] },
      { id: "supportive", name: "支持", descr: "", min_favor: 60, max_favor: 79, allow_contact: true, lock_message: "", unlock_action_tags: ["formal_visit", "gift_basic", "private_dinner"] },
      { id: "backer", name: "全力支持者", descr: "", min_favor: 80, max_favor: 100, allow_contact: true, lock_message: "", unlock_action_tags: ["formal_visit", "gift_basic", "private_dinner"] }
    ]
  },
  {
    id: "social",
    name: "社交关系",
    descr: "普通社交联系人轨道。",
    stages: [
      { id: "enemy", name: "敌对", descr: "", min_favor: 0, max_favor: 9, allow_contact: false, lock_message: "他现在很讨厌我，肯定不会理我了。", unlock_action_tags: [] },
      { id: "dislike", name: "讨厌", descr: "", min_favor: 10, max_favor: 19, allow_contact: true, lock_message: "", unlock_action_tags: [] },
      { id: "stranger", name: "陌生", descr: "", min_favor: 20, max_favor: 39, allow_contact: true, lock_message: "", unlock_action_tags: [] },
      { id: "acquaintance", name: "熟人", descr: "", min_favor: 40, max_favor: 59, allow_contact: true, lock_message: "", unlock_action_tags: ["gift_basic"] },
      { id: "friend", name: "朋友", descr: "", min_favor: 60, max_favor: 79, allow_contact: true, lock_message: "", unlock_action_tags: ["gift_basic", "date"] },
      { id: "best_friend", name: "挚友", descr: "", min_favor: 80, max_favor: 100, allow_contact: true, lock_message: "", unlock_action_tags: ["gift_basic", "date"] }
    ]
  }
]

export const RUNTIME_SCHEDULER_AUDIT_KINDS: RuntimeSchedulerAuditKind[] = [
  "schedule-future",
  "queue-ready",
  "promote-due",
  "start-event",
  "skip-event",
  "complete-event",
  "loop-reschedule"
]

export interface RuntimeLoopEventDefinition {
  id: string
  title: string
  trigger_mode?: RuntimeEventTriggerMode
  trigger_expr: string
  invoke_params?: Array<{
    name: string
    descr?: string
  }>
  init_script: string
  object_keys: string[]
  presentation: RuntimeStoryPresentation
  location: string
  bgm: string
  end_script: string
  loop: {
    mode: "daily" | "weekly" | "monthly" | "interval_days"
    interval_days?: number
    weekday?: number
    month_day?: number
    at?: string
    priority?: number
    after?: string[]
    before?: string[]
  }
}
