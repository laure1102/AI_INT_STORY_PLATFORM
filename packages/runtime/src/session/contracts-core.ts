/**
 * 运行时 bundle、存档、背包、手机与调度状态契约。
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


export interface RuntimeStoryDialogueDefinition {
  speaker_type: "player" | "object"
  speaker_key: string
  content: string
}

export interface RuntimeStorySilentPresentation {
  type: "silent"
}

export interface RuntimeStoryMessagePresentation {
  type: "message"
  message: {
    content: string
    duration_seconds: number
  }
}

export interface RuntimeStoryDialoguePresentation {
  type: "dialogue"
  dialogues: RuntimeStoryDialogueDefinition[]
}

export type RuntimeStoryPresentation =
  | RuntimeStorySilentPresentation
  | RuntimeStoryMessagePresentation
  | RuntimeStoryDialoguePresentation

export type RuntimeEventTriggerMode = "default" | "condition" | "invoke"

export interface RuntimeLocationAssignment {
  id: string
  descr: string
}

export interface RuntimeStoryItemDefinition {
  id: string
  name?: string
  stackable?: boolean
  max_stack?: number
}

export interface RuntimeStoryItemsFile {
  items: RuntimeStoryItemDefinition[]
}

export type RuntimePhoneContactTrackId = "none" | "romance" | "official" | "social"

export interface RuntimeStoryPhoneLibraryScope {
  role_keys: string[]
  contact_tracks: RuntimePhoneContactTrackId[]
  personality_ids: string[]
  min_favor: number
  max_favor: number
}

export interface RuntimeStoryPhoneEventInvocation {
  target_type: StoryInvokeTargetType
  event_id: string
  delay?: StoryScriptInvokeDelay
}

export interface RuntimeStoryPhoneRelationshipStage {
  id: string
  name: string
  descr: string
  min_favor: number
  max_favor: number
  allow_contact: boolean
  lock_message: string
  unlock_action_tags: string[]
}

export interface RuntimeStoryPhoneRelationshipTrack {
  id: RuntimePhoneContactTrackId
  name: string
  descr: string
  stages: RuntimeStoryPhoneRelationshipStage[]
}

export interface RuntimeStoryPhonePersonalityDefinition {
  id: string
  name: string
  descr: string
  style_tags: string[]
}

export interface RuntimeStoryPhoneQuickMessageDefinition {
  id: string
  text: string
  tags: string[]
  base_favor_delta: number
  cooldown_hours: number
  visibility: "always" | "suggested-only"
  available_role_keys: string[]
}

export interface RuntimeStoryPhoneProactiveMessageRule {
  id: string
  enabled: boolean
  trigger_expr: string
  cooldown_hours: number
  favor_delta: number
  messages: string[]
  reply_quick_message_ids: string[]
}

export interface RuntimeStoryPhoneContactProfile {
  role_key: string
  enabled: boolean
  auto_add: boolean
  initial_favor: number
  preferred_tags: string[]
  reply_by_tag: Record<string, string[]>
  proactive_messages: RuntimeStoryPhoneProactiveMessageRule[]
}

export interface RuntimeStoryPhoneTalkLibraryEntry {
  id: string
  text: string
  tags: string[]
  scope: RuntimeStoryPhoneLibraryScope
  base_favor_delta: number
  cooldown_hours: number
  invoke?: RuntimeStoryPhoneEventInvocation
}

export interface RuntimeStoryPhoneActionCostItem {
  item_id: string
  quantity: number
}

export interface RuntimeStoryPhoneActionLibraryEntry {
  id: string
  label: string
  text: string
  tags: string[]
  scope: RuntimeStoryPhoneLibraryScope
  base_favor_delta: number
  cooldown_hours: number
  cost_money: number
  cost_items: RuntimeStoryPhoneActionCostItem[]
  invoke?: RuntimeStoryPhoneEventInvocation
}

export interface RuntimeStoryPhoneReplyLibraryEntry {
  id: string
  tags: string[]
  scope: RuntimeStoryPhoneLibraryScope
  replies: string[]
}

export interface RuntimeStoryPhoneFile {
  relationship_tracks: RuntimeStoryPhoneRelationshipTrack[]
  personality_library: RuntimeStoryPhonePersonalityDefinition[]
  talk_library: RuntimeStoryPhoneTalkLibraryEntry[]
  action_library: RuntimeStoryPhoneActionLibraryEntry[]
  reply_library: RuntimeStoryPhoneReplyLibraryEntry[]
  player_quick_messages: RuntimeStoryPhoneQuickMessageDefinition[]
  contact_profiles: RuntimeStoryPhoneContactProfile[]
  fallback_replies: Record<string, string[]>
}

export interface RuntimeStoryPhoneConversationMessage {
  content: string
}

export interface RuntimeStoryPhoneConversationReminder {
  enabled: boolean
  interval_minutes: number
}

export interface RuntimeStoryPhoneConversationOption {
  id: string
  text: string
  visible_expr: string
  script: string
  next_node_id: string
}

export interface RuntimeStoryPhoneConversationNode {
  id: string
  contact_messages: RuntimeStoryPhoneConversationMessage[]
  player_options: RuntimeStoryPhoneConversationOption[]
  reminder?: RuntimeStoryPhoneConversationReminder
  end: boolean
  end_script: string
  invoke?: RuntimeStoryPhoneEventInvocation
}

export interface RuntimeStoryPhoneConversationDefinition {
  id: string
  title: string
  role_key: string
  enabled: boolean
  once: boolean
  lock_normal_chat: boolean
  trigger_expr: string
  entry_node_id: string
  nodes: RuntimeStoryPhoneConversationNode[]
}

export interface RuntimeStoryPhoneConversationsFile {
  conversations: RuntimeStoryPhoneConversationDefinition[]
}

export interface RuntimeStoryPhoneConversationRuntimeState {
  conversation_id: string
  role_key: string
  node_id: string
  option_id?: string | null
  last_reminder_game_minute?: number | null
  finished: boolean
}

export interface RuntimeStoryDoingMenu {
  id: string
  title: string
  parent_id: string
  sort_order: number
  visible_expr: string
  descr: string
}

export interface RuntimeStoryDoingDefinition {
  id: string
  title: string
  trigger_mode?: RuntimeEventTriggerMode
  trigger_expr?: string
  invoke_params?: Array<{
    name: string
    descr?: string
  }>
  menu_id: string
  descr: string
  visible_expr: string
  cooldown_hours: number
  once: boolean
  init_script: string
  object_keys: string[]
  presentation: RuntimeStoryPresentation
  location: string
  bgm: string
  end_script: string
  meta?: Record<string, unknown>
}

export interface RuntimeStoryDoingFile {
  menus: RuntimeStoryDoingMenu[]
  doings: RuntimeStoryDoingDefinition[]
}

export interface RuntimeStoryShopCategory {
  id: string
  name: string
  sort_order: number
  visible_expr: string
  descr: string
}

export interface RuntimeStoryShopProduct {
  id: string
  category_id: string
  item_id: string
  price: number
  quantity: number
  sort_order: number
  enabled: boolean
  available_expr: string
  unavailable_reason: string
  allow_gift: boolean
  gift_favor_delta: number
  purchase_cooldown_hours: number
  gift_cooldown_hours: number
}

export interface RuntimeStoryShopFile {
  currency_value_key: string
  categories: RuntimeStoryShopCategory[]
  products: RuntimeStoryShopProduct[]
}

export interface RuntimeStoryReferTerm {
  id: string
  label: string
  male: string
  female: string
  fallback: string
}

export interface RuntimeStoryReferFile {
  gender_value_key: string
  gender_aliases: {
    male: string[]
    female: string[]
  }
  terms: RuntimeStoryReferTerm[]
}

export interface RuntimeBagEntry {
  item_id: string
  quantity: number
  bound: boolean
  obtained_at_day: number
  obtained_at_minute: number
  meta: Record<string, unknown>
}

export interface RuntimeBagState {
  entries: RuntimeBagEntry[]
}

export interface RuntimeBagsState {
  player: RuntimeBagState
  [ownerId: string]: RuntimeBagState
}

export interface RuntimePhoneContactState {
  role_key: string
  favor: number
  unlocked_at_day: number
}

export interface RuntimePhoneMessageState {
  id: string
  sender: "player" | "contact" | "system"
  content: string
  game_minute: number
  read: boolean
  option_id?: string
  option_kind?: "talk" | "action"
  quick_message_id?: string
  source_rule_id?: string
  phone_conversation_id?: string
  phone_conversation_node_id?: string
  phone_conversation_reminder?: boolean
  tags?: string[]
}

export interface RuntimePhoneThreadState {
  role_key: string
  messages: RuntimePhoneMessageState[]
}

export interface RuntimePhoneState {
  contacts: RuntimePhoneContactState[]
  threads: RuntimePhoneThreadState[]
}

export interface RuntimeDoingRecord {
  id: string
  used_count: number
  last_used_game_minute: number | null
  cooldown_until_game_minute: number | null
}

export interface RuntimeDoingState {
  unlocked_ids: string[]
  locked_ids: string[]
  records: RuntimeDoingRecord[]
}

export interface RuntimeShopPurchaseRecord {
  product_id: string
  purchased_count: number
  last_purchased_game_minute: number | null
  cooldown_until_game_minute: number | null
}

export interface RuntimeShopGiftRecord {
  product_id: string
  role_key: string
  gifted_count: number
  last_gifted_game_minute: number | null
  cooldown_until_game_minute: number | null
}

export interface RuntimeShopState {
  purchases: RuntimeShopPurchaseRecord[]
  gifts: RuntimeShopGiftRecord[]
}

export interface RuntimeInitialBagEntry {
  item_id: string
  quantity: number
  bound?: boolean
  meta?: Record<string, unknown>
}

export interface RuntimeInitialBagsFile {
  player: {
    entries: RuntimeInitialBagEntry[]
  }
  [ownerId: string]: {
    entries: RuntimeInitialBagEntry[]
  }
}

export interface RuntimeNormalRoleDefinition {
  id: string
  name?: string
  descr: string
  contact_enabled?: boolean
  contact_track?: RuntimePhoneContactTrackId
  contact_initial_favor?: number
  xingge_id?: string
  xingge_note?: string
}

export interface RuntimeImportantRoleDefinition {
  id: string
  name?: string
  descr: string
  contact_enabled?: boolean
  contact_track?: RuntimePhoneContactTrackId
  contact_initial_favor?: number
  xingge_id?: string
  xingge_note?: string
}

export interface CompiledEvent {
  node_type?: "event"
  id: string
  title: string
  trigger_mode?: RuntimeEventTriggerMode
  trigger_expr: string
  invoke_params?: Array<{
    name: string
    descr?: string
  }>
  init_script: string
  end_script: string
  object_keys: string[]
  presentation: RuntimeStoryPresentation
  location: string
  next: string[]
  meta?: Record<string, unknown>
}

export interface CompiledAction {
  node_type?: "action"
  id: string
  title: string
  vars: Array<{
    name: string
    descr?: string
    initial_value: string
  }>
  exec_script: string
  next: string[]
  meta?: Record<string, unknown>
}

export interface RuntimeStandaloneEvent extends CompiledEvent {
  runtime_source_type: "pool" | "schedule" | "doing"
  trigger_mode?: RuntimeEventTriggerMode
  invoke_params?: Array<{
    name: string
    descr?: string
  }>
  bgm: string
  call_values: Record<string, unknown>
  next: []
}

export interface RuntimeProfileCustomFile {
  profile_id: string
  story_id: string
  profile_name: string
  created_at: string
  custom_values: Record<string, unknown>
  player_setup?: RuntimePlayerProfileSetup
}

export interface RuntimePlayerProfileSetup {
  player_surname: string
  player_given_name: string
  player_name?: string
  county_name: string
  county_short_name: string
  city_name: string
  province_name: string
}

/**
 * Runtime v2 存档的持久化顶层结构。
 *
 * `session_state` 保存变量、背包、手机、商城、时钟和 scheduler 等长期状态；`playback` 单独保存
 * 当前事件进行到哪一句、等待哪些选项等瞬时游标。两者必须来自同一次会话快照，加载后才能从
 * “下一步”继续，而不是只恢复变量却从事件开头重复执行脚本。
 */
export interface RuntimeStorySaveState {
  schema_version: 2
  slot_id: string
  story_id: string
  profile_id: string
  bundle_content_hash: string
  /** @deprecated v1 存档字段，仅用于兼容读取 */
  bundle_version?: string
  saved_at: string
  playback: RuntimePlaybackState
  session_state: RuntimeStorySessionSnapshot
}

/** 一个待选行动及其分支局部值的可持久化形式。 */
export interface RuntimePlaybackActionState {
  node_id: string
  branch_values: Record<string, unknown>
}

/**
 * 当前前台事件的精确播放游标。
 *
 * `current_event_entered` 防止加载后重复执行 init_script；对白索引和消息已播毫秒数决定下一帧展示；
 * pending/last action 保存选择上下文；call_values 保存 invoke 参数。它不包含长期游戏数据，那些只
 * 属于 `session_state`，避免出现两份可互相冲突的变量状态。
 */
export interface RuntimePlaybackState {
  current_event_entered: boolean
  dialogue_index: number
  message_elapsed_ms: number
  pending_actions: RuntimePlaybackActionState[]
  last_action: RuntimePlaybackActionState | null
  call_values: Record<string, unknown>
}

export interface RuntimeTriggeredOnceState {
  event_id: string
  triggered_at: string
}

export interface RuntimeLoopEventState {
  event_id: string
  last_triggered_at?: string
  last_triggered_day?: number
  trigger_count: number
}

export interface RuntimeHistoryEntry {
  type: "event" | "action" | "dialogue" | "system"
  id: string
  title?: string
  content?: string
  timestamp: string
}

export type { RuntimeClockState } from "../clock"

export type { RuntimeRngState } from "../rng"

export type RuntimeSchedulerSourceType = "chain_root" | "pool" | "schedule" | "doing" | "invoke"

export type RuntimeSchedulerEventStatus =
  | "scheduled"
  | "ready"
  | "running"
  | "done"
  | "skipped"
  | "cancelled"

export interface RuntimeScheduledEvent {
  instance_id: string
  source_type: RuntimeSchedulerSourceType
  source_id: string
  invoke_target_type?: StoryInvokeTargetType
  entry_event_id: string
  due_game_minute: number
  priority: number
  after: string[]
  before: string[]
  seq: number
  dedupe_key: string
  call_values: Record<string, unknown>
  trigger_locked: boolean
  status: RuntimeSchedulerEventStatus
}

export interface RuntimeSchedulerLoopState {
  event_id: string
  next_due_game_minute: number | null
  last_triggered_game_minute: number | null
  trigger_count: number
}

export type RuntimeSchedulerAuditKind =
  | "schedule-future"
  | "queue-ready"
  | "promote-due"
  | "start-event"
  | "skip-event"
  | "complete-event"
  | "loop-reschedule"

export interface RuntimeSchedulerAuditEntry {
  kind: RuntimeSchedulerAuditKind
  game_minute: number
  source_type?: RuntimeSchedulerSourceType
  source_id?: string
  entry_event_id?: string
  due_game_minute?: number | null
  message: string
}

export interface RuntimeSchedulerState {
  scheduled: RuntimeScheduledEvent[]
  ready_queue: RuntimeScheduledEvent[]
  active: RuntimeScheduledEvent | null
  consumed_once_ids: string[]
  /** @deprecated 请改用 consumed_once_ids */
  consumed_graph_root_ids: string[]
  loop_states: RuntimeSchedulerLoopState[]
  audit_logs: RuntimeSchedulerAuditEntry[]
  director_logs: RuntimeDirectorDecisionLog[]
  manual_pause: boolean
  event_pause: boolean
  next_seq: number
}

export interface RuntimeStorySessionSnapshot {
  current_event_id: string | null
  vals: StoryValsFile
  system_vals: StoryValsFile
  clock: RuntimeClockState
  rng: RuntimeRngState
  scheduler: RuntimeSchedulerState
  bags: RuntimeBagsState
  phone: RuntimePhoneState
  phone_conversation?: RuntimeStoryPhoneConversationRuntimeState | null
  phone_conversations?: RuntimeStoryPhoneConversationRuntimeState[]
  doing: RuntimeDoingState
  shop: RuntimeShopState
  triggered_once_events: RuntimeTriggeredOnceState[]
  /** @deprecated 请改用 triggered_once_events */
  loop_event_states: RuntimeLoopEventState[]
  history: RuntimeHistoryEntry[]
}
