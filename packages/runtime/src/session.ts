import {
  evaluateStoryBooleanExpression,
  executeStoryScript,
  renderStoryTextTemplate
} from "./vals"
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
} from "./director"
import type {
  StoryScriptExecutionContext,
  StoryScriptInvocation,
  StoryScriptInvokeDelay
} from "./vals"
import type {
  StoryInvokeTargetType,
  StoryPlayerOverrideValsFile,
  StoryValDefinition,
  StoryValEntryDefinition,
  StoryValsFile
} from "./types"

interface RuntimeStoryDialogueDefinition {
  speaker_type: "player" | "object"
  speaker_key: string
  content: string
}

interface RuntimeStorySilentPresentation {
  type: "silent"
}

interface RuntimeStoryMessagePresentation {
  type: "message"
  message: {
    content: string
    duration_seconds: number
  }
}

interface RuntimeStoryDialoguePresentation {
  type: "dialogue"
  dialogues: RuntimeStoryDialogueDefinition[]
}

type RuntimeStoryPresentation =
  | RuntimeStorySilentPresentation
  | RuntimeStoryMessagePresentation
  | RuntimeStoryDialoguePresentation

type RuntimeEventTriggerMode = "default" | "condition" | "invoke"

interface RuntimeLocationAssignment {
  id: string
  descr: string
}

interface RuntimeStoryItemDefinition {
  id: string
  name?: string
  stackable?: boolean
  max_stack?: number
}

interface RuntimeStoryItemsFile {
  items: RuntimeStoryItemDefinition[]
}

type RuntimePhoneContactTrackId = "none" | "romance" | "official" | "social"

interface RuntimeStoryPhoneLibraryScope {
  role_keys: string[]
  contact_tracks: RuntimePhoneContactTrackId[]
  personality_ids: string[]
  min_favor: number
  max_favor: number
}

interface RuntimeStoryPhoneEventInvocation {
  target_type: StoryInvokeTargetType
  event_id: string
  delay?: StoryScriptInvokeDelay
}

interface RuntimeStoryPhoneRelationshipStage {
  id: string
  name: string
  descr: string
  min_favor: number
  max_favor: number
  allow_contact: boolean
  lock_message: string
  unlock_action_tags: string[]
}

interface RuntimeStoryPhoneRelationshipTrack {
  id: RuntimePhoneContactTrackId
  name: string
  descr: string
  stages: RuntimeStoryPhoneRelationshipStage[]
}

interface RuntimeStoryPhonePersonalityDefinition {
  id: string
  name: string
  descr: string
  style_tags: string[]
}

interface RuntimeStoryPhoneQuickMessageDefinition {
  id: string
  text: string
  tags: string[]
  base_favor_delta: number
  cooldown_hours: number
  visibility: "always" | "suggested-only"
  available_role_keys: string[]
}

interface RuntimeStoryPhoneProactiveMessageRule {
  id: string
  enabled: boolean
  trigger_expr: string
  cooldown_hours: number
  favor_delta: number
  messages: string[]
  reply_quick_message_ids: string[]
}

interface RuntimeStoryPhoneContactProfile {
  role_key: string
  enabled: boolean
  auto_add: boolean
  initial_favor: number
  preferred_tags: string[]
  reply_by_tag: Record<string, string[]>
  proactive_messages: RuntimeStoryPhoneProactiveMessageRule[]
}

interface RuntimeStoryPhoneTalkLibraryEntry {
  id: string
  text: string
  tags: string[]
  scope: RuntimeStoryPhoneLibraryScope
  base_favor_delta: number
  cooldown_hours: number
  invoke?: RuntimeStoryPhoneEventInvocation
}

interface RuntimeStoryPhoneActionCostItem {
  item_id: string
  quantity: number
}

interface RuntimeStoryPhoneActionLibraryEntry {
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

interface RuntimeStoryPhoneReplyLibraryEntry {
  id: string
  tags: string[]
  scope: RuntimeStoryPhoneLibraryScope
  replies: string[]
}

interface RuntimeStoryPhoneFile {
  relationship_tracks: RuntimeStoryPhoneRelationshipTrack[]
  personality_library: RuntimeStoryPhonePersonalityDefinition[]
  talk_library: RuntimeStoryPhoneTalkLibraryEntry[]
  action_library: RuntimeStoryPhoneActionLibraryEntry[]
  reply_library: RuntimeStoryPhoneReplyLibraryEntry[]
  player_quick_messages: RuntimeStoryPhoneQuickMessageDefinition[]
  contact_profiles: RuntimeStoryPhoneContactProfile[]
  fallback_replies: Record<string, string[]>
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

interface RuntimeInitialBagEntry {
  item_id: string
  quantity: number
  bound?: boolean
  meta?: Record<string, unknown>
}

interface RuntimeInitialBagsFile {
  player: {
    entries: RuntimeInitialBagEntry[]
  }
  [ownerId: string]: {
    entries: RuntimeInitialBagEntry[]
  }
}

interface RuntimeNormalRoleDefinition {
  id: string
  name?: string
  descr: string
  contact_enabled?: boolean
  contact_track?: RuntimePhoneContactTrackId
  contact_initial_favor?: number
  xingge_id?: string
  xingge_note?: string
}

interface RuntimeImportantRoleDefinition {
  id: string
  name?: string
  descr: string
  contact_enabled?: boolean
  contact_track?: RuntimePhoneContactTrackId
  contact_initial_favor?: number
  xingge_id?: string
  xingge_note?: string
}

interface CompiledEvent {
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

interface CompiledAction {
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

interface RuntimeStandaloneEvent extends CompiledEvent {
  runtime_source_type: "pool" | "schedule"
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

export interface RuntimeStorySaveState {
  slot_id: string
  story_id: string
  profile_id: string
  bundle_version: string
  saved_at: string
  session_state: RuntimeStorySessionSnapshot
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

export interface RuntimeClockState {
  base_date: string
  base_day: number
  total_minutes: number
  pending_minutes: number
  step_minutes: number
}

export type RuntimeSchedulerSourceType = "chain_root" | "pool" | "schedule" | "invoke"

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
  scheduler: RuntimeSchedulerState
  bags: RuntimeBagsState
  phone: RuntimePhoneState
  triggered_once_events: RuntimeTriggeredOnceState[]
  /** @deprecated 请改用 triggered_once_events */
  loop_event_states: RuntimeLoopEventState[]
  history: RuntimeHistoryEntry[]
}

export interface RuntimeStoryBundle {
  storyId: string
  title: string
  generatedAt: string
  vals: StoryValsFile
  playerOverrideVals: StoryPlayerOverrideValsFile
  systemVals: StoryValsFile
  scenes: unknown
  roles: unknown
  eventLocations: unknown
  items?: RuntimeStoryItemsFile
  initialBags?: RuntimeInitialBagsFile
  phone?: RuntimeStoryPhoneFile
  chainEvents?: Record<string, unknown>
  poolEvents?: unknown[]
  scheduleEvents?: unknown[]
  /** @deprecated 请改用 chainEvents */
  graphEvents: Record<string, unknown>
  /** @deprecated 请改用 poolEvents */
  onceEvents: unknown[]
  /** @deprecated 请改用 scheduleEvents */
  loopEvents: unknown[]
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
}

export interface RuntimeBagSummary {
  ownerId: string
  itemCount: number
  totalQuantity: number
  entries: RuntimeBagItemView[]
}

export interface RuntimePhoneQuickMessageView {
  id: string
  text: string
  tags: string[]
  baseFavorDelta: number
  cooldownHours: number
  suggested: boolean
}

export interface RuntimePhoneContactView {
  roleKey: string
  label: string
  favor: number
  relationTrackId: RuntimePhoneContactTrackId
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
}

export interface RuntimePhoneThreadMessageView {
  id: string
  sender: "player" | "contact" | "system"
  senderLabel: string
  content: string
  gameMinute: number
  read: boolean
}

export interface RuntimePhoneActionCostItemView {
  itemId: string
  itemName: string
  quantity: number
}

export interface RuntimePhoneActionView {
  id: string
  label: string
  text: string
  tags: string[]
  baseFavorDelta: number
  cooldownHours: number
  costMoney: number
  costItems: RuntimePhoneActionCostItemView[]
  disabled: boolean
  disabledReason: string | null
  invokeEventLabel: string | null
}

export interface RuntimePhoneThreadView {
  roleKey: string
  contactLabel: string
  favor: number
  relationTrackId: RuntimePhoneContactTrackId
  relationTrackLabel: string
  relationStageId: string
  relationStageLabel: string
  canContact: boolean
  lockMessage: string | null
  personalityId: string
  personalityLabel: string
  unreadCount: number
  messages: RuntimePhoneThreadMessageView[]
  talks: RuntimePhoneQuickMessageView[]
  actions: RuntimePhoneActionView[]
  quickMessages: RuntimePhoneQuickMessageView[]
}

export interface RuntimeStoryViewModel {
  screen: "boot" | "profile" | "save-select" | "game" | "debug"
  storyTitle: string
  activeEventId: string | null
  activeEventTitle: string | null
  interaction: RuntimeInteraction
  notifications: string[]
  currentLocationId: string | null
  currentLocationName: string | null
  currentSceneLevel: number | null
  currentMessage: RuntimeRenderedMessage | null
  currentDialogue: RuntimeRenderedDialogue | null
  availableBranches: RuntimeBranchOptionView[]
  branchContextSummary: Array<{
    key: string
    value: string
  }>
  bagSummary: RuntimeBagSummary[]
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
  | { type: "phone-send-talk"; roleKey: string; talkId: string }
  | { type: "phone-send-action"; roleKey: string; actionId: string }
  | { type: "phone-send-quick-message"; roleKey: string; quickMessageId: string }
  | { type: "phone-mark-read"; roleKey: string }
  | { type: "open-debug" }
  | { type: "close-debug" }

export interface CreateStorySessionOptions {
  bundle: RuntimeStoryBundle
  customOverrides?: RuntimeProfileCustomFile | null
  saveState?: RuntimeStorySaveState | null
  now?: Date
  storyDirector?: RuntimeStoryDirector | null
}

export interface RuntimeStorySession {
  dispatch(action: RuntimeStorySessionAction): void
  invokeOnceEvent(targetType: StoryInvokeTargetType, eventId: string, args?: Record<string, unknown>): boolean
  tick(deltaMs: number): void
  setTimePause(paused: boolean): void
  setTimeSpeed(speed: number): void
  getViewModel(): RuntimeStoryViewModel
  getSnapshot(): RuntimeStorySessionSnapshot
}

interface RuntimeActionState {
  nodeId: string
  branchValues: Record<string, unknown>
}

interface RuntimeState {
  snapshot: RuntimeStorySessionSnapshot
  currentEventEntered: boolean
  currentDialogueIndex: number
  currentMessageElapsedMs: number
  pendingActions: RuntimeActionState[]
  lastAction: RuntimeActionState | null
  activeStandaloneEvent: RuntimeStandaloneEvent | null
  storyDirector: RuntimeStoryDirector
}

interface RuntimeResolvedPhoneContactMeta {
  roleKey: string
  label: string
  enabled: boolean
  autoAdd: boolean
  favor: number
  initialFavor: number
  trackId: RuntimePhoneContactTrackId
  trackLabel: string
  stageId: string
  stageLabel: string
  canContact: boolean
  lockMessage: string | null
  personalityId: string
  personalityLabel: string
  preferredTags: Set<string>
  profile: RuntimeStoryPhoneContactProfile | null
  unlockActionTags: Set<string>
}

interface RuntimeResolvedPhoneTalkOption {
  id: string
  text: string
  tags: string[]
  baseFavorDelta: number
  cooldownHours: number
  suggested: boolean
  preferred: boolean
  invoke?: RuntimeStoryPhoneEventInvocation
  source: "talk-library" | "legacy-quick-message"
}

interface RuntimeResolvedPhoneActionOption {
  id: string
  label: string
  text: string
  tags: string[]
  baseFavorDelta: number
  cooldownHours: number
  costMoney: number
  costItems: RuntimePhoneActionCostItemView[]
  preferred: boolean
  disabled: boolean
  disabledReason: string | null
  invoke?: RuntimeStoryPhoneEventInvocation
}

interface RuntimeEnterEventOptions {
  skipTriggerCheck?: boolean
}

interface RuntimeDialogueNodeState {
  node: CompiledEvent
  currentMessage: RuntimeRenderedMessage | null
  currentDialogue: RuntimeRenderedDialogue | null
  availableActions: RuntimeActionState[]
  autoNextEventIds: string[]
  locationName: string | null
}

type RuntimeGraphNode = CompiledEvent | CompiledAction
type RuntimePlayableEvent = CompiledEvent | RuntimeStandaloneEvent

const DEFAULT_MAX_CALC_NESTING_DEPTH = 5
const DEFAULT_CLOCK_STEP_MINUTES = 10
const MINUTES_PER_DAY = 24 * 60
const MAX_SCHEDULER_AUDIT_LOGS = 120
const MAX_RUNTIME_DIRECTOR_LOGS = 120
const DEFAULT_PHONE_RELATIONSHIP_TRACKS: RuntimeStoryPhoneRelationshipTrack[] = [
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
const RUNTIME_SCHEDULER_AUDIT_KINDS: RuntimeSchedulerAuditKind[] = [
  "schedule-future",
  "queue-ready",
  "promote-due",
  "start-event",
  "skip-event",
  "complete-event",
  "loop-reschedule"
]

interface RuntimeDateParts {
  year: number
  month: number
  day: number
}

interface RuntimeLoopEventDefinition {
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

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)])
    ) as T
  }

  return value
}

function cloneValsFile(vals: StoryValsFile): StoryValsFile {
  return {
    variables: vals.variables.map((group) => ({
      name: group.name,
      description: group.description,
      vals: group.vals.map((row) => ({
        name: row.name,
        description: row.description,
        value_type: row.value_type,
        value: cloneValue(row.value),
        calc_rule: row.calc_rule
      }))
    }))
  }
}

function padTwoDigits(value: number) {
  return String(value).padStart(2, "0")
}

function parseStoryDate(value: string): RuntimeDateParts | null {
  const trimmedValue = value.trim()
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmedValue)

  if (!match) {
    return null
  }

  const year = Number.parseInt(match[1]!, 10)
  const month = Number.parseInt(match[2]!, 10)
  const day = Number.parseInt(match[3]!, 10)

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

function formatStoryDate(parts: RuntimeDateParts) {
  return `${parts.year}-${parts.month}-${parts.day}`
}

function datePartsToUtcDayNumber(parts: RuntimeDateParts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000)
}

function utcDayNumberToDateParts(utcDayNumber: number): RuntimeDateParts {
  const date = new Date(utcDayNumber * 86400000)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  }
}

function clampInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback
}

function clampNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function snapMinuteToStep(minute: number, stepMinutes: number) {
  if (!Number.isFinite(minute)) {
    return 0
  }

  const normalizedMinute = Math.max(0, Math.min(59, Math.trunc(minute)))
  if (stepMinutes <= 1) {
    return normalizedMinute
  }

  return Math.floor(normalizedMinute / stepMinutes) * stepMinutes
}

function createCombinedValsFile(snapshot: RuntimeStorySessionSnapshot): StoryValsFile {
  return {
    variables: [
      ...cloneValsFile(snapshot.vals).variables,
      ...cloneValsFile(snapshot.system_vals).variables
    ]
  }
}

function applyCombinedValsFile(
  snapshot: RuntimeStorySessionSnapshot,
  nextValsFile: StoryValsFile
) {
  const globalGroupNames = new Set(snapshot.vals.variables.map((group) => group.name.trim()))
  const systemGroupNames = new Set(snapshot.system_vals.variables.map((group) => group.name.trim()))

  snapshot.vals = {
    variables: nextValsFile.variables
      .filter((group) => globalGroupNames.has(group.name.trim()))
      .map((group) => cloneValue(group))
  }

  snapshot.system_vals = {
    variables: nextValsFile.variables
      .filter((group) => systemGroupNames.has(group.name.trim()))
      .map((group) => cloneValue(group))
  }
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeRuntimeEventTriggerMode(mode: unknown): RuntimeEventTriggerMode {
  if (mode === "condition" || mode === "invoke") {
    return mode
  }

  return "default"
}

function isRuntimeEventScannable(event: { trigger_mode?: RuntimeEventTriggerMode }) {
  return normalizeRuntimeEventTriggerMode(event.trigger_mode) !== "invoke"
}

function formatValueSummary(value: unknown) {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function findValEntry(
  valsFile: StoryValsFile,
  token: string
): { group: StoryValDefinition; row: StoryValEntryDefinition } | null {
  const [groupName, rowName, ...rest] = token.split(".")

  if (!groupName || !rowName || rest.length > 0) {
    return null
  }

  const group = valsFile.variables.find((item) => item.name.trim() === groupName.trim())
  if (!group) {
    return null
  }

  const row = group.vals.find((item) => item.name.trim() === rowName.trim())
  if (!row) {
    return null
  }

  return { group, row }
}

function applyCustomValuesToValsFile(valsFile: StoryValsFile, customValues: Record<string, unknown>) {
  for (const [token, value] of Object.entries(customValues)) {
    const match = findValEntry(valsFile, token)

    if (!match || match.row.value_type === "calc") {
      continue
    }

    match.row.value = cloneValue(value)
  }
}

function readValEntryValue(snapshotVals: StoryValsFile, token: string) {
  return findValEntry(snapshotVals, token)?.row.value
}

function readSystemNumber(snapshotVals: StoryValsFile, token: string, fallback = 0) {
  const value = readValEntryValue(snapshotVals, token)
  return clampNumber(value, fallback)
}

function readSystemBoolean(snapshotVals: StoryValsFile, token: string, fallback = false) {
  const value = readValEntryValue(snapshotVals, token)
  return typeof value === "boolean" ? value : fallback
}

function readSystemString(snapshotVals: StoryValsFile, token: string, fallback = "") {
  const value = readValEntryValue(snapshotVals, token)
  return typeof value === "string" ? value : fallback
}

function writeSystemValue(snapshotVals: StoryValsFile, token: string, value: unknown) {
  const match = findValEntry(snapshotVals, token)
  if (!match || match.row.value_type === "calc") {
    return
  }

  match.row.value = cloneValue(value)
}

function readSnapshotValue(snapshot: RuntimeStorySessionSnapshot, token: string) {
  const runtimeValue = readValEntryValue(snapshot.vals, token)
  if (runtimeValue !== undefined) {
    return runtimeValue
  }

  return readValEntryValue(snapshot.system_vals, token)
}

function writeSnapshotValue(
  snapshot: RuntimeStorySessionSnapshot,
  token: string,
  value: unknown
) {
  const runtimeMatch = findValEntry(snapshot.vals, token)
  if (runtimeMatch && runtimeMatch.row.value_type !== "calc") {
    runtimeMatch.row.value = cloneValue(value)
    return true
  }

  const systemMatch = findValEntry(snapshot.system_vals, token)
  if (systemMatch && systemMatch.row.value_type !== "calc") {
    systemMatch.row.value = cloneValue(value)
    return true
  }

  return false
}

function resolveShiduan(hour: number) {
  return hour >= 12 ? "下午" : "上午"
}

function resolveWeekday(dayNumberUtc: number) {
  const weekday = ((dayNumberUtc + 3) % 7 + 7) % 7
  return weekday + 1
}

function resolveJieqi(_date: RuntimeDateParts) {
  return ""
}

function resolveJieri(date: RuntimeDateParts) {
  const key = `${padTwoDigits(date.month)}-${padTwoDigits(date.day)}`
  const festivalMap: Record<string, string> = {
    "01-01": "元旦",
    "02-14": "情人节",
    "03-08": "妇女节",
    "05-01": "劳动节",
    "06-01": "儿童节",
    "10-01": "国庆节",
    "12-25": "圣诞节"
  }

  return festivalMap[key] ?? ""
}

function createDefaultSchedulerState(): RuntimeSchedulerState {
  return {
    scheduled: [],
    ready_queue: [],
    active: null,
    consumed_once_ids: [],
    consumed_graph_root_ids: [],
    loop_states: [],
    audit_logs: [],
    director_logs: [],
    manual_pause: false,
    event_pause: false,
    next_seq: 1
  }
}

function createDefaultBagsState(): RuntimeBagsState {
  return {
    player: {
      entries: []
    }
  }
}

function createDefaultPhoneConfig(): RuntimeStoryPhoneFile {
  return {
    relationship_tracks: cloneValue(DEFAULT_PHONE_RELATIONSHIP_TRACKS),
    personality_library: [],
    talk_library: [],
    action_library: [],
    reply_library: [],
    player_quick_messages: [],
    contact_profiles: [],
    fallback_replies: {}
  }
}

function createDefaultPhoneState(): RuntimePhoneState {
  return {
    contacts: [],
    threads: []
  }
}

function normalizeOwnerId(ownerId: unknown) {
  return typeof ownerId === "string" ? ownerId.trim() : ""
}

function normalizeItemId(itemId: unknown) {
  return typeof itemId === "string" ? itemId.trim() : ""
}

function normalizePhoneRoleKey(roleKey: unknown) {
  return typeof roleKey === "string" ? roleKey.trim() : ""
}

function normalizePhoneContactTrackId(value: unknown): RuntimePhoneContactTrackId {
  return value === "romance" || value === "official" || value === "social" || value === "none"
    ? value
    : "none"
}

function clampPhoneFavor(value: unknown, fallback = 0) {
  return Math.max(0, Math.min(100, clampInteger(value, fallback)))
}

function normalizeBagQuantity(quantity: unknown, fallback = 1) {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
    return fallback
  }

  return Math.max(0, Math.trunc(quantity))
}

function normalizeBagState(bag: RuntimeBagState | undefined): RuntimeBagState {
  const entries = Array.isArray(bag?.entries) ? bag.entries : []
  const normalizedEntries = new Map<string, RuntimeBagEntry>()

  for (const entry of entries) {
    const itemId = normalizeItemId(entry.item_id)
    const quantity = normalizeBagQuantity(entry.quantity, 0)

    if (!itemId || quantity <= 0) {
      continue
    }

    const existing = normalizedEntries.get(itemId)
    if (existing) {
      existing.quantity += quantity
      continue
    }

    normalizedEntries.set(itemId, {
      item_id: itemId,
      quantity,
      bound: Boolean(entry.bound),
      obtained_at_day: Math.max(0, clampInteger(entry.obtained_at_day, 0)),
      obtained_at_minute: Math.max(0, clampInteger(entry.obtained_at_minute, 0)),
      meta: entry.meta && typeof entry.meta === "object"
        ? cloneValue(entry.meta)
        : {}
    })
  }

  return {
    entries: Array.from(normalizedEntries.values())
  }
}

function normalizeBagsState(snapshot: RuntimeStorySessionSnapshot) {
  const rawBags = snapshot.bags ?? createDefaultBagsState()
  const nextBags: RuntimeBagsState = createDefaultBagsState()

  for (const [ownerId, bag] of Object.entries(rawBags)) {
    const normalizedOwnerId = normalizeOwnerId(ownerId)
    if (!normalizedOwnerId) {
      continue
    }

    nextBags[normalizedOwnerId] = normalizeBagState(bag)
  }

  if (!nextBags.player) {
    nextBags.player = {
      entries: []
    }
  }

  snapshot.bags = nextBags
}

function normalizePhoneMessages(messages: RuntimePhoneMessageState[] | undefined): RuntimePhoneMessageState[] {
  const nextMessages = Array.isArray(messages) ? messages : []

  return nextMessages
    .map((message) => {
      const sender: RuntimePhoneMessageState["sender"] = message.sender === "contact" || message.sender === "system"
        ? message.sender
        : "player"
      const optionKind: RuntimePhoneMessageState["option_kind"] = message.option_kind === "action"
        ? "action"
        : message.option_kind === "talk"
          ? "talk"
          : undefined

      return {
        id: normalizeText(message.id),
        sender,
        content: normalizeText(message.content),
        game_minute: Math.max(0, clampInteger(message.game_minute, 0)),
        read: Boolean(message.read),
        option_id: normalizeOptionalText(message.option_id),
        option_kind: optionKind,
        quick_message_id: normalizeOptionalText(message.quick_message_id),
        source_rule_id: normalizeOptionalText(message.source_rule_id),
        tags: Array.isArray(message.tags)
          ? Array.from(new Set(message.tags.map((tag) => normalizeText(tag)).filter(Boolean)))
          : undefined
      }
    })
    .filter((message) => message.id && message.content)
}

function normalizePhoneState(snapshot: RuntimeStorySessionSnapshot) {
  const rawPhone = snapshot.phone ?? createDefaultPhoneState()
  const contacts = Array.isArray(rawPhone.contacts) ? rawPhone.contacts : []
  const threads = Array.isArray(rawPhone.threads) ? rawPhone.threads : []

  snapshot.phone = {
    contacts: contacts
      .map((contact) => ({
        role_key: normalizePhoneRoleKey(contact.role_key),
        favor: clampPhoneFavor(contact.favor, 0),
        unlocked_at_day: Math.max(1, clampInteger(contact.unlocked_at_day, 1))
      }))
      .filter((contact) => contact.role_key),
    threads: threads
      .map((thread) => ({
        role_key: normalizePhoneRoleKey(thread.role_key),
        messages: normalizePhoneMessages(thread.messages)
      }))
      .filter((thread) => thread.role_key)
  }
}

function createDefaultClockState(systemVals: StoryValsFile): RuntimeClockState {
  const nowDate = readSystemString(systemVals, "system.now_date", "1990-1-1")
  const parsedNowDate = parseStoryDate(nowDate) ?? { year: 1990, month: 1, day: 1 }
  const nowDay = Math.max(1, clampInteger(readSystemNumber(systemVals, "system.now_day", 1), 1))
  const nowHour = Math.max(0, Math.min(23, clampInteger(readSystemNumber(systemVals, "system.now_hour", 0), 0)))
  const rawMinute = clampInteger(readSystemNumber(systemVals, "system.now_minute", 0), 0)
  const snappedMinute = snapMinuteToStep(rawMinute, DEFAULT_CLOCK_STEP_MINUTES)

  return {
    base_date: formatStoryDate(parsedNowDate),
    base_day: nowDay,
    total_minutes: nowHour * 60 + snappedMinute,
    pending_minutes: 0,
    step_minutes: DEFAULT_CLOCK_STEP_MINUTES
  }
}

function normalizeClockState(snapshot: RuntimeStorySessionSnapshot) {
  const clock = snapshot.clock
  const parsedBaseDate = parseStoryDate(clock.base_date) ?? { year: 1990, month: 1, day: 1 }

  clock.base_date = formatStoryDate(parsedBaseDate)
  clock.base_day = clampInteger(clock.base_day, 0)
  clock.total_minutes = Math.max(0, clampInteger(clock.total_minutes, 0))
  clock.pending_minutes = Math.max(0, clampNumber(clock.pending_minutes, 0))
  clock.step_minutes = Math.max(1, clampInteger(clock.step_minutes, DEFAULT_CLOCK_STEP_MINUTES))
}

function normalizeSchedulePriority(value: unknown) {
  return clampInteger(value, 100)
}

function normalizeScheduleDependencyIds(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean)))
    : []
}

function normalizeScheduledEventOrderFields(item: Partial<RuntimeScheduledEvent>) {
  return {
    priority: normalizeSchedulePriority(item.priority),
    after: normalizeScheduleDependencyIds(item.after),
    before: normalizeScheduleDependencyIds(item.before)
  }
}

function normalizeSchedulerState(snapshot: RuntimeStorySessionSnapshot) {
  const scheduler = snapshot.scheduler ?? createDefaultSchedulerState()
  scheduler.scheduled = Array.isArray(scheduler.scheduled)
    ? scheduler.scheduled.map((item) => {
        const sourceType = normalizeSchedulerSourceType(item.source_type) ?? "chain_root"

        return {
          instance_id: normalizeText(item.instance_id),
          source_type: sourceType,
          source_id: normalizeText(item.source_id),
          invoke_target_type: normalizeInvokeTargetType(item.invoke_target_type),
          entry_event_id: normalizeText(item.entry_event_id),
          due_game_minute: Math.max(0, clampInteger(item.due_game_minute, 0)),
          ...normalizeScheduledEventOrderFields(item),
          seq: Math.max(1, clampInteger(item.seq, 1)),
          dedupe_key: normalizeSchedulerDedupeKey(item.dedupe_key, sourceType),
          call_values: item.call_values && typeof item.call_values === "object"
            ? cloneValue(item.call_values as Record<string, unknown>)
            : {},
          trigger_locked: Boolean(item.trigger_locked),
          status: item.status
        }
      })
    : []
  scheduler.ready_queue = Array.isArray(scheduler.ready_queue)
    ? scheduler.ready_queue.map((item) => {
        const sourceType = normalizeSchedulerSourceType(item.source_type) ?? "chain_root"

        return {
          instance_id: normalizeText(item.instance_id),
          source_type: sourceType,
          source_id: normalizeText(item.source_id),
          invoke_target_type: normalizeInvokeTargetType(item.invoke_target_type),
          entry_event_id: normalizeText(item.entry_event_id),
          due_game_minute: Math.max(0, clampInteger(item.due_game_minute, 0)),
          ...normalizeScheduledEventOrderFields(item),
          seq: Math.max(1, clampInteger(item.seq, 1)),
          dedupe_key: normalizeSchedulerDedupeKey(item.dedupe_key, sourceType),
          call_values: item.call_values && typeof item.call_values === "object"
            ? cloneValue(item.call_values as Record<string, unknown>)
            : {},
          trigger_locked: Boolean(item.trigger_locked),
          status: item.status
        }
      })
    : []
  scheduler.active = scheduler.active
    ? (() => {
        const sourceType = normalizeSchedulerSourceType(scheduler.active.source_type) ?? "chain_root"

        return {
          instance_id: normalizeText(scheduler.active.instance_id),
          source_type: sourceType,
          source_id: normalizeText(scheduler.active.source_id),
          invoke_target_type: normalizeInvokeTargetType(scheduler.active.invoke_target_type),
          entry_event_id: normalizeText(scheduler.active.entry_event_id),
          due_game_minute: Math.max(0, clampInteger(scheduler.active.due_game_minute, 0)),
          ...normalizeScheduledEventOrderFields(scheduler.active),
          seq: Math.max(1, clampInteger(scheduler.active.seq, 1)),
          dedupe_key: normalizeSchedulerDedupeKey(scheduler.active.dedupe_key, sourceType),
          call_values: scheduler.active.call_values && typeof scheduler.active.call_values === "object"
            ? cloneValue(scheduler.active.call_values as Record<string, unknown>)
            : {},
          trigger_locked: Boolean(scheduler.active.trigger_locked),
          status: scheduler.active.status
        }
      })()
    : null
  const consumedOnceIdsSource = Array.isArray(scheduler.consumed_once_ids)
    ? scheduler.consumed_once_ids
    : []
  scheduler.consumed_once_ids = consumedOnceIdsSource.map((item) => normalizeText(item)).filter(Boolean)
  scheduler.consumed_graph_root_ids = Array.isArray(scheduler.consumed_graph_root_ids)
    ? scheduler.consumed_graph_root_ids.map((item) => normalizeText(item)).filter(Boolean)
    : []
  scheduler.loop_states = Array.isArray(scheduler.loop_states)
    ? scheduler.loop_states.map((item) => ({
        event_id: normalizeText(item.event_id),
        next_due_game_minute: item.next_due_game_minute === null || item.next_due_game_minute === undefined
          ? null
          : Math.max(0, clampInteger(item.next_due_game_minute, 0)),
        last_triggered_game_minute: item.last_triggered_game_minute === null || item.last_triggered_game_minute === undefined
          ? null
          : Math.max(0, clampInteger(item.last_triggered_game_minute, 0)),
        trigger_count: Math.max(0, clampInteger(item.trigger_count, 0))
      }))
    : []
  scheduler.audit_logs = Array.isArray(scheduler.audit_logs)
    ? scheduler.audit_logs.map((item) => ({
        kind: normalizeSchedulerAuditKind(item.kind),
        game_minute: Math.max(0, clampInteger(item.game_minute, 0)),
        source_type: normalizeSchedulerSourceType(item.source_type),
        source_id: normalizeOptionalText(item.source_id),
        entry_event_id: normalizeOptionalText(item.entry_event_id),
        due_game_minute: item.due_game_minute === null || item.due_game_minute === undefined
          ? null
          : Math.max(0, clampInteger(item.due_game_minute, 0)),
        message: normalizeText(item.message)
      })).slice(-MAX_SCHEDULER_AUDIT_LOGS)
    : []
  scheduler.director_logs = Array.isArray(scheduler.director_logs)
    ? scheduler.director_logs.map(normalizeRuntimeDirectorDecisionLog).slice(-MAX_RUNTIME_DIRECTOR_LOGS)
    : []
  scheduler.manual_pause = Boolean(scheduler.manual_pause)
  scheduler.event_pause = Boolean(scheduler.event_pause)
  scheduler.next_seq = Math.max(1, clampInteger(scheduler.next_seq, 1))
  snapshot.scheduler = scheduler

  const triggeredOnceEventsSource = Array.isArray(snapshot.triggered_once_events)
    ? snapshot.triggered_once_events
    : []
  snapshot.triggered_once_events = triggeredOnceEventsSource.map((item) => ({
    event_id: normalizeText((item as RuntimeTriggeredOnceState | undefined)?.event_id),
    triggered_at: normalizeText((item as RuntimeTriggeredOnceState | undefined)?.triggered_at)
  })).filter((item) => item.event_id && item.triggered_at)

  snapshot.loop_event_states = Array.isArray(snapshot.loop_event_states)
    ? snapshot.loop_event_states.map((item) => ({
        event_id: normalizeText(item.event_id),
        last_triggered_at: normalizeOptionalText(item.last_triggered_at),
        last_triggered_day: item.last_triggered_day === undefined
          ? undefined
          : Math.max(0, clampInteger(item.last_triggered_day, 0)),
        trigger_count: Math.max(0, clampInteger(item.trigger_count, 0))
      })).filter((item) => item.event_id)
    : []

  snapshot.history = Array.isArray(snapshot.history)
    ? snapshot.history.map((item) => ({
        type: item.type,
        id: normalizeText(item.id),
        title: normalizeOptionalText(item.title),
        content: normalizeOptionalText(item.content),
        timestamp: normalizeText(item.timestamp)
      })).filter((item) => item.id && item.timestamp)
    : []
}

function normalizeOptionalText(value: unknown) {
  const normalized = normalizeText(value)
  return normalized || undefined
}

function normalizeSchedulerDedupeKey(
  value: unknown,
  sourceType: RuntimeSchedulerSourceType | undefined
) {
  const normalized = normalizeText(value)
  return normalized
}

function normalizeSchedulerSourceType(value: unknown): RuntimeSchedulerSourceType | undefined {
  if (value === "chain_root" || value === "pool" || value === "schedule" || value === "invoke") {
    return value
  }

  if (value === "graph_root") {
    return "chain_root"
  }

  if (value === "once") {
    return "pool"
  }

  if (value === "loop") {
    return "schedule"
  }

  return undefined
}

function normalizeInvokeTargetType(value: unknown): StoryInvokeTargetType | undefined {
  if (value === "chain" || value === "pool" || value === "schedule") {
    return value
  }

  if (value === "graph") {
    return "chain"
  }

  if (value === "once") {
    return "pool"
  }

  if (value === "loop") {
    return "schedule"
  }

  return undefined
}

function normalizeSchedulerAuditKind(value: unknown): RuntimeSchedulerAuditKind {
  if (typeof value === "string" && RUNTIME_SCHEDULER_AUDIT_KINDS.includes(value as RuntimeSchedulerAuditKind)) {
    return value as RuntimeSchedulerAuditKind
  }

  return "queue-ready"
}

function normalizeRuntimeDirectorCandidateSourceType(
  value: unknown,
  fallback: RuntimeDirectorCandidateSourceType = "pool"
): RuntimeDirectorCandidateSourceType {
  if (value === "chain_root" || value === "pool") {
    return value
  }

  if (value === "graph_root") {
    return "chain_root"
  }

  if (value === "once") {
    return "pool"
  }

  return fallback
}

function normalizeUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? cloneValue(value as Record<string, unknown>)
    : {}
}

function normalizeRuntimeDirectorHistoryEntry(value: unknown): RuntimeDirectorHistoryEntry {
  const entry = normalizeUnknownRecord(value)
  const type: RuntimeDirectorHistoryEntry["type"] =
    entry.type === "event" || entry.type === "action" || entry.type === "dialogue" || entry.type === "system"
    ? entry.type
    : "system"

  return {
    type,
    id: normalizeText(entry.id),
    title: normalizeOptionalText(entry.title)
  }
}

function normalizeRuntimeDirectorFeatureSnapshot(value: unknown): RuntimeDirectorFeatureSnapshot {
  const feature = normalizeUnknownRecord(value)

  return {
    storyId: normalizeText(feature.storyId),
    gameMinute: Math.max(0, clampInteger(feature.gameMinute, 0)),
    day: Math.max(0, clampInteger(feature.day, 0)),
    hour: Math.max(0, Math.min(23, clampInteger(feature.hour, 0))),
    minute: Math.max(0, Math.min(59, clampInteger(feature.minute, 0))),
    weekday: Math.max(0, Math.min(7, clampInteger(feature.weekday, 0))),
    values: normalizeUnknownRecord(feature.values),
    consumedPoolEventIds: Array.isArray(feature.consumedPoolEventIds)
      ? feature.consumedPoolEventIds.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    triggeredPoolEventIds: Array.isArray(feature.triggeredPoolEventIds)
      ? feature.triggeredPoolEventIds.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    recentHistory: Array.isArray(feature.recentHistory)
      ? feature.recentHistory
          .map(normalizeRuntimeDirectorHistoryEntry)
          .filter((item) => Boolean(item.id))
      : []
  }
}

function normalizeRuntimeDirectorDecisionLog(value: unknown): RuntimeDirectorDecisionLog {
  const log = normalizeUnknownRecord(value)
  const candidates = Array.isArray(log.candidates)
    ? log.candidates.map((item) => {
        const candidate = normalizeUnknownRecord(item)

        return {
          sourceType: normalizeRuntimeDirectorCandidateSourceType(candidate.sourceType ?? candidate.source_type),
          eventId: normalizeText(candidate.eventId),
          title: normalizeText(candidate.title),
          score: clampNumber(candidate.score, 0),
          reasons: Array.isArray(candidate.reasons)
            ? candidate.reasons.map((reason) => normalizeText(reason)).filter(Boolean)
            : []
        }
      }).filter((candidate) => candidate.eventId)
    : []

  return {
    game_minute: Math.max(0, clampInteger(log.game_minute, 0)),
    selected_source_type: log.selected_event_id === null || log.selected_event_id === undefined
      ? null
      : normalizeRuntimeDirectorCandidateSourceType(log.selected_source_type ?? log.selectedSourceType),
    selected_event_id: log.selected_event_id === null || log.selected_event_id === undefined
      ? null
      : normalizeText(log.selected_event_id),
    selected_event_title: normalizeOptionalText(log.selected_event_title),
    candidate_count: Math.max(0, clampInteger(log.candidate_count, candidates.length)),
    candidates,
    features: normalizeRuntimeDirectorFeatureSnapshot(log.features),
    reason: normalizeText(log.reason)
  }
}

function syncSystemTimeFieldsFromClock(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)
  normalizeSchedulerState(snapshot)

  const { clock } = snapshot
  const baseDate = parseStoryDate(clock.base_date) ?? { year: 1990, month: 1, day: 1 }
  const baseDayNumberUtc = datePartsToUtcDayNumber(baseDate)
  const dayOffset = Math.floor(clock.total_minutes / MINUTES_PER_DAY)
  const minuteOfDay = ((clock.total_minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const currentDayNumberUtc = baseDayNumberUtc + dayOffset
  const currentDate = utcDayNumberToDateParts(currentDayNumberUtc)
  const currentHour = Math.floor(minuteOfDay / 60)
  const currentMinute = minuteOfDay % 60
  const currentDay = clock.base_day + dayOffset

  writeSystemValue(snapshot.system_vals, "system.now_day", currentDay)
  writeSystemValue(snapshot.system_vals, "system.now_date", formatStoryDate(currentDate))
  writeSystemValue(snapshot.system_vals, "system.now_hour", currentHour)
  writeSystemValue(snapshot.system_vals, "system.now_minute", currentMinute)
  writeSystemValue(snapshot.system_vals, "system.now_weekday", resolveWeekday(currentDayNumberUtc))
  writeSystemValue(snapshot.system_vals, "system.now_shiduan", resolveShiduan(currentHour))
  writeSystemValue(snapshot.system_vals, "system.now_jieqi", resolveJieqi(currentDate))
  writeSystemValue(snapshot.system_vals, "system.now_jieri", resolveJieri(currentDate))
  writeSystemValue(snapshot.system_vals, "system.time_pause", isRuntimeTimePaused(snapshot))
}

function getBundleItemIds(bundle: RuntimeStoryBundle) {
  return new Set((bundle.items?.items ?? []).map((item) => item.id.trim()).filter(Boolean))
}

function getBundlePhoneConfig(bundle: RuntimeStoryBundle): RuntimeStoryPhoneFile {
  const rawConfig = bundle.phone ?? createDefaultPhoneConfig()
  return {
    relationship_tracks: Array.isArray(rawConfig.relationship_tracks)
      ? rawConfig.relationship_tracks
      : cloneValue(DEFAULT_PHONE_RELATIONSHIP_TRACKS),
    personality_library: Array.isArray(rawConfig.personality_library)
      ? rawConfig.personality_library
      : [],
    talk_library: Array.isArray(rawConfig.talk_library)
      ? rawConfig.talk_library
      : [],
    action_library: Array.isArray(rawConfig.action_library)
      ? rawConfig.action_library
      : [],
    reply_library: Array.isArray(rawConfig.reply_library)
      ? rawConfig.reply_library
      : [],
    player_quick_messages: Array.isArray(rawConfig.player_quick_messages)
      ? rawConfig.player_quick_messages
      : [],
    contact_profiles: Array.isArray(rawConfig.contact_profiles)
      ? rawConfig.contact_profiles
      : [],
    fallback_replies: rawConfig.fallback_replies && typeof rawConfig.fallback_replies === "object"
      ? rawConfig.fallback_replies
      : {}
  }
}

function getBundlePhoneQuickMessages(bundle: RuntimeStoryBundle) {
  return getBundlePhoneConfig(bundle).player_quick_messages ?? []
}

function getBundlePhoneContactProfile(bundle: RuntimeStoryBundle, roleKey: string) {
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  if (!normalizedRoleKey) {
    return null
  }

  return getBundlePhoneConfig(bundle).contact_profiles.find(
    (profile) => profile.role_key.trim() === normalizedRoleKey
  ) ?? null
}

function findBundleRoleDefinition(bundle: RuntimeStoryBundle, roleKey: string) {
  const [scope, roleId] = normalizePhoneRoleKey(roleKey).split(":")
  if (!scope || !roleId) {
    return null
  }

  const roles = getBundleRoles(bundle)
  return scope === "important"
    ? roles.important.find((item) => item.id === roleId) ?? null
    : scope === "normal"
      ? roles.normal.find((item) => item.id === roleId) ?? null
      : null
}

function getBundlePhoneRelationshipTrack(
  bundle: RuntimeStoryBundle,
  trackId: RuntimePhoneContactTrackId
) {
  const normalizedTrackId = normalizePhoneContactTrackId(trackId)
  if (normalizedTrackId === "none") {
    return null
  }

  const configuredTrack = getBundlePhoneConfig(bundle).relationship_tracks.find(
    (track) => track.id === normalizedTrackId
  )
  if (configuredTrack) {
    return configuredTrack
  }

  return DEFAULT_PHONE_RELATIONSHIP_TRACKS.find((track) => track.id === normalizedTrackId)
    ?? DEFAULT_PHONE_RELATIONSHIP_TRACKS.find((track) => track.id === "social")
    ?? null
}

function getBundlePhonePersonality(
  bundle: RuntimeStoryBundle,
  personalityId: string
) {
  const normalizedPersonalityId = normalizeText(personalityId)
  if (!normalizedPersonalityId) {
    return null
  }

  return getBundlePhoneConfig(bundle).personality_library.find(
    (entry) => entry.id.trim() === normalizedPersonalityId
  ) ?? null
}

function resolvePhoneRelationshipStage(
  bundle: RuntimeStoryBundle,
  trackId: RuntimePhoneContactTrackId,
  favor: number
) {
  const track = getBundlePhoneRelationshipTrack(bundle, trackId)
  if (!track) {
    return {
      id: "default",
      name: "默认",
      descr: "",
      min_favor: 0,
      max_favor: 100,
      allow_contact: true,
      lock_message: "",
      unlock_action_tags: []
    } satisfies RuntimeStoryPhoneRelationshipStage
  }

  const normalizedFavor = clampPhoneFavor(favor, 20)
  const matchedStage = track.stages.find(
    (stage) => normalizedFavor >= stage.min_favor && normalizedFavor <= stage.max_favor
  )
  if (matchedStage) {
    return matchedStage
  }

  return track.stages
    .slice()
    .sort((left, right) => left.min_favor - right.min_favor)
    .find((stage) => normalizedFavor <= stage.max_favor)
    ?? track.stages[track.stages.length - 1]
    ?? {
      id: "default",
      name: track.name,
      descr: track.descr,
      min_favor: 0,
      max_favor: 100,
      allow_contact: true,
      lock_message: "",
      unlock_action_tags: []
    }
}

function buildRuntimePhoneContactMeta(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  favor: number
): RuntimeResolvedPhoneContactMeta {
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  const roleDefinition = findBundleRoleDefinition(bundle, normalizedRoleKey)
  const profile = getBundlePhoneContactProfile(bundle, normalizedRoleKey)
  const roleEnabled = Boolean(roleDefinition?.contact_enabled)
  const roleTrack = normalizePhoneContactTrackId(roleDefinition?.contact_track)
  const inferredEnabled = roleEnabled || roleTrack !== "none" || Boolean(profile?.enabled)
  const enabled = profile ? Boolean(profile.enabled) : inferredEnabled
  const autoAdd = profile ? Boolean(profile.auto_add) : enabled
  const initialFavor = clampPhoneFavor(
    profile?.initial_favor ?? roleDefinition?.contact_initial_favor ?? 20,
    20
  )
  const personalityId = normalizeText(roleDefinition?.xingge_id)
  const personalityDefinition = getBundlePhonePersonality(bundle, personalityId)
  const trackId = roleTrack !== "none"
    ? roleTrack
    : enabled
      ? "social"
      : "none"
  const track = getBundlePhoneRelationshipTrack(bundle, trackId)
  const relationStage = resolvePhoneRelationshipStage(bundle, trackId, favor)
  const personalityLabel = normalizeText(personalityDefinition?.name)
    || personalityId
    || normalizeText(roleDefinition?.xingge_note)
    || ""
  const canContact = enabled && relationStage.allow_contact
  const lockMessage = canContact
    ? null
    : normalizeText(relationStage.lock_message) || (enabled ? "当前无法主动联系。" : "当前还未成为联系人。")

  return {
    roleKey: normalizedRoleKey,
    label: findRoleLabel(bundle, normalizedRoleKey),
    enabled,
    autoAdd,
    favor: clampPhoneFavor(favor, initialFavor),
    initialFavor,
    trackId,
    trackLabel: normalizeText(track?.name) || "社交关系",
    stageId: normalizeText(relationStage.id) || "default",
    stageLabel: normalizeText(relationStage.name) || "默认",
    canContact,
    lockMessage,
    personalityId,
    personalityLabel,
    preferredTags: new Set((profile?.preferred_tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)),
    profile,
    unlockActionTags: new Set((relationStage.unlock_action_tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean))
  }
}

function getLatestPhoneSuggestedOptionIds(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  snapshot?: RuntimeStorySessionSnapshot
) {
  const latestSuggestedMessage = snapshot
    ? getPhoneThread(snapshot, roleKey)?.messages
      .slice()
      .reverse()
      .find((message) => message.sender === "contact" && message.source_rule_id)
    : null
  const suggestedRule = latestSuggestedMessage?.source_rule_id
    ? getPhoneProactiveRulesForContact(bundle, roleKey).find(
        (rule) => rule.id === latestSuggestedMessage.source_rule_id
      ) ?? null
    : null

  return new Set((suggestedRule?.reply_quick_message_ids ?? []).map((item) => normalizeText(item)).filter(Boolean))
}

function matchesPhoneLibraryScope(
  scope: RuntimeStoryPhoneLibraryScope | undefined,
  meta: RuntimeResolvedPhoneContactMeta
) {
  if (!scope) {
    return true
  }

  const roleKeys = Array.isArray(scope.role_keys)
    ? scope.role_keys.map((item) => normalizeText(item)).filter(Boolean)
    : []
  if (roleKeys.length > 0 && !roleKeys.includes(meta.roleKey)) {
    return false
  }

  const contactTracks: Array<Exclude<RuntimePhoneContactTrackId, "none">> = Array.isArray(scope.contact_tracks)
    ? scope.contact_tracks
      .map((item) => normalizePhoneContactTrackId(item))
      .filter((item): item is Exclude<RuntimePhoneContactTrackId, "none"> => item !== "none")
    : []
  if (contactTracks.length > 0 && (meta.trackId === "none" || !contactTracks.includes(meta.trackId))) {
    return false
  }

  const personalityIds = Array.isArray(scope.personality_ids)
    ? scope.personality_ids.map((item) => normalizeText(item)).filter(Boolean)
    : []
  if (personalityIds.length > 0 && (!meta.personalityId || !personalityIds.includes(meta.personalityId))) {
    return false
  }

  const minFavor = Number.isFinite(scope.min_favor) ? scope.min_favor : 0
  const maxFavor = Number.isFinite(scope.max_favor) ? scope.max_favor : 100
  return meta.favor >= minFavor && meta.favor <= maxFavor
}

function getPhoneScopeSpecificityScore(
  scope: RuntimeStoryPhoneLibraryScope | undefined,
  roleKey: string
) {
  if (!scope) {
    return 0
  }

  let score = 0
  const roleKeys = Array.isArray(scope.role_keys)
    ? scope.role_keys.map((item) => normalizeText(item)).filter(Boolean)
    : []
  if (roleKeys.length > 0) {
    score += roleKeys.includes(roleKey) ? 8 : 4
  }

  const contactTracks = Array.isArray(scope.contact_tracks)
    ? scope.contact_tracks.filter((item) => item && item !== "none")
    : []
  if (contactTracks.length > 0) {
    score += 4
  }

  const personalityIds = Array.isArray(scope.personality_ids)
    ? scope.personality_ids.map((item) => normalizeText(item)).filter(Boolean)
    : []
  if (personalityIds.length > 0) {
    score += 4
  }

  const minFavor = Number.isFinite(scope.min_favor) ? scope.min_favor : 0
  const maxFavor = Number.isFinite(scope.max_favor) ? scope.max_favor : 100
  score += Math.max(0, 10 - Math.max(1, maxFavor - minFavor + 1) / 10)
  return score
}

function getPhoneTagOverlapScore(optionTags: string[], targetTags: string[]) {
  if (optionTags.length === 0 || targetTags.length === 0) {
    return 0
  }

  const targetSet = new Set(targetTags)
  return optionTags.reduce((count, tag) => count + (targetSet.has(tag) ? 1 : 0), 0)
}

function getBundleItemNameMap(bundle: RuntimeStoryBundle) {
  const result = new Map<string, string>()

  for (const item of bundle.items?.items ?? []) {
    const itemId = normalizeItemId(item.id)
    if (!itemId) {
      continue
    }

    result.set(itemId, normalizeText(item.name) || itemId)
  }

  return result
}

function createInitialBagsState(bundle: RuntimeStoryBundle, clock: RuntimeClockState): RuntimeBagsState {
  const initialBags = bundle.initialBags ?? {
    player: {
      entries: []
    }
  }
  const itemIds = getBundleItemIds(bundle)
  const bags: RuntimeBagsState = createDefaultBagsState()
  const currentDay = Math.max(1, clock.base_day + Math.floor(clock.total_minutes / MINUTES_PER_DAY))
  const currentMinute = clock.total_minutes

  for (const [ownerId, bag] of Object.entries(initialBags)) {
    const normalizedOwnerId = normalizeOwnerId(ownerId)
    if (!normalizedOwnerId) {
      continue
    }

    const entries: RuntimeBagEntry[] = []
    const quantities = new Map<string, RuntimeBagEntry>()

    for (const entry of bag.entries ?? []) {
      const itemId = normalizeItemId(entry.item_id)
      const quantity = normalizeBagQuantity(entry.quantity, 1)

      if (!itemId || quantity <= 0 || !itemIds.has(itemId)) {
        continue
      }

      const existing = quantities.get(itemId)
      if (existing) {
        existing.quantity += quantity
        continue
      }

      const nextEntry: RuntimeBagEntry = {
        item_id: itemId,
        quantity,
        bound: Boolean(entry.bound),
        obtained_at_day: currentDay,
        obtained_at_minute: currentMinute,
        meta: entry.meta && typeof entry.meta === "object"
          ? cloneValue(entry.meta)
          : {}
      }
      quantities.set(itemId, nextEntry)
      entries.push(nextEntry)
    }

    bags[normalizedOwnerId] = {
      entries
    }
  }

  if (!bags.player) {
    bags.player = {
      entries: []
    }
  }

  return bags
}

function createBaseSnapshot(bundle: RuntimeStoryBundle): RuntimeStorySessionSnapshot {
  const systemVals = cloneValsFile(bundle.systemVals)
  const clock = createDefaultClockState(systemVals)
  const snapshot: RuntimeStorySessionSnapshot = {
    current_event_id: null,
    vals: cloneValsFile(bundle.vals),
    system_vals: systemVals,
    clock,
    scheduler: createDefaultSchedulerState(),
    bags: createInitialBagsState(bundle, clock),
    phone: createDefaultPhoneState(),
    triggered_once_events: [],
    loop_event_states: [],
    history: []
  }

  syncSystemTimeFieldsFromClock(snapshot)

  return snapshot
}

function isRuntimeTimePaused(snapshot: RuntimeStorySessionSnapshot) {
  normalizeSchedulerState(snapshot)
  const manualPause = snapshot.scheduler.manual_pause
  const eventPause = snapshot.scheduler.event_pause
  return manualPause || eventPause
}

function queueClockProgress(snapshot: RuntimeStorySessionSnapshot, deltaMs: number) {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return false
  }

  if (isRuntimeTimePaused(snapshot)) {
    return false
  }

  const timeSpeed = readSystemNumber(snapshot.system_vals, "system.time_speed", 0)
  if (!Number.isFinite(timeSpeed) || timeSpeed <= 0) {
    return false
  }

  normalizeClockState(snapshot)

  const scaledMinutes = deltaMs / 60000 * timeSpeed
  if (!Number.isFinite(scaledMinutes) || scaledMinutes <= 0) {
    return false
  }

  snapshot.clock.pending_minutes += scaledMinutes

  return true
}

function advanceClockBySingleStep(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)

  if (snapshot.clock.pending_minutes < snapshot.clock.step_minutes) {
    return false
  }

  snapshot.clock.pending_minutes -= snapshot.clock.step_minutes
  snapshot.clock.total_minutes += snapshot.clock.step_minutes
  syncSystemTimeFieldsFromClock(snapshot)
  return true
}

function setSystemBoolean(snapshot: RuntimeStorySessionSnapshot, token: string, value: boolean) {
  writeSystemValue(snapshot.system_vals, token, value)
}

function setSystemNumber(snapshot: RuntimeStorySessionSnapshot, token: string, value: number) {
  writeSystemValue(snapshot.system_vals, token, value)
}

function getCurrentGameMinute(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)
  return Math.max(0, clampInteger(snapshot.clock.total_minutes, 0))
}

function appendSchedulerAudit(
  snapshot: RuntimeStorySessionSnapshot,
  entry: Omit<RuntimeSchedulerAuditEntry, "game_minute">
) {
  normalizeSchedulerState(snapshot)

  snapshot.scheduler.audit_logs.push({
    kind: normalizeSchedulerAuditKind(entry.kind),
    game_minute: getCurrentGameMinute(snapshot),
    source_type: normalizeSchedulerSourceType(entry.source_type),
    source_id: normalizeOptionalText(entry.source_id),
    entry_event_id: normalizeOptionalText(entry.entry_event_id),
    due_game_minute: entry.due_game_minute === null || entry.due_game_minute === undefined
      ? null
      : Math.max(0, clampInteger(entry.due_game_minute, 0)),
    message: normalizeText(entry.message)
  })

  if (snapshot.scheduler.audit_logs.length > MAX_SCHEDULER_AUDIT_LOGS) {
    snapshot.scheduler.audit_logs = snapshot.scheduler.audit_logs.slice(-MAX_SCHEDULER_AUDIT_LOGS)
  }
}

function appendRuntimeDirectorLog(
  snapshot: RuntimeStorySessionSnapshot,
  log: RuntimeDirectorDecisionLog
) {
  normalizeSchedulerState(snapshot)
  snapshot.scheduler.director_logs.push(cloneValue(log))

  if (snapshot.scheduler.director_logs.length > MAX_RUNTIME_DIRECTOR_LOGS) {
    snapshot.scheduler.director_logs = snapshot.scheduler.director_logs.slice(-MAX_RUNTIME_DIRECTOR_LOGS)
  }
}

function buildRuntimeDirectorFeatureSnapshot(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
): RuntimeDirectorFeatureSnapshot {
  normalizeClockState(snapshot)
  normalizeSchedulerState(snapshot)
  syncSystemTimeFieldsFromClock(snapshot)

  const minuteOfDay = ((snapshot.clock.total_minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY

  return {
    storyId: bundle.storyId,
    gameMinute: getCurrentGameMinute(snapshot),
    day: readSystemNumber(snapshot.system_vals, "system.now_day", snapshot.clock.base_day),
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    weekday: readSystemNumber(snapshot.system_vals, "system.now_weekday", 0),
    values: flattenDirectorValues(snapshot.vals, snapshot.system_vals),
    consumedPoolEventIds: [...snapshot.scheduler.consumed_once_ids],
    triggeredPoolEventIds: snapshot.triggered_once_events.map((item) => item.event_id),
    recentHistory: snapshot.history.slice(-20).map((entry): RuntimeDirectorHistoryEntry => ({
      type: entry.type,
      id: entry.id,
      title: entry.title
    }))
  }
}

function getCurrentDatePartsFromSnapshot(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)
  const baseDate = parseStoryDate(snapshot.clock.base_date) ?? { year: 1990, month: 1, day: 1 }
  const baseDayNumberUtc = datePartsToUtcDayNumber(baseDate)
  const dayOffset = Math.floor(snapshot.clock.total_minutes / MINUTES_PER_DAY)
  return utcDayNumberToDateParts(baseDayNumberUtc + dayOffset)
}

function getStartOfCurrentDayGameMinute(snapshot: RuntimeStorySessionSnapshot) {
  const nowGameMinute = getCurrentGameMinute(snapshot)
  return Math.floor(nowGameMinute / MINUTES_PER_DAY) * MINUTES_PER_DAY
}

function getLoopSchedulerState(
  snapshot: RuntimeStorySessionSnapshot,
  eventId: string
) {
  normalizeSchedulerState(snapshot)
  const normalizedEventId = normalizeText(eventId)
  let matchedState = snapshot.scheduler.loop_states.find((item) => item.event_id === normalizedEventId)

  if (matchedState) {
    return matchedState
  }

  matchedState = {
    event_id: normalizedEventId,
    next_due_game_minute: null,
    last_triggered_game_minute: null,
    trigger_count: 0
  }
  snapshot.scheduler.loop_states.push(matchedState)
  return matchedState
}

function clampLoopMonthDay(input: unknown) {
  const value = clampInteger(input, 1)
  return Math.max(1, Math.min(31, value))
}

function clampLoopWeekday(input: unknown) {
  const value = clampInteger(input, 1)
  return Math.max(1, Math.min(7, value))
}

function clampLoopIntervalDays(input: unknown) {
  const value = clampInteger(input, 1)
  return Math.max(1, value)
}

function getLoopTimeOffsetMinutes(loopEvent: RuntimeLoopEventDefinition) {
  const rawAt = normalizeText(loopEvent.loop.at) || "00:00"
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(rawAt)

  if (!match) {
    return 0
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour * 60 + minute
}

function buildDatePartsAtStartOfMonth(parts: RuntimeDateParts) {
  return {
    year: parts.year,
    month: parts.month,
    day: 1
  }
}

function getDaysInMonth(parts: RuntimeDateParts) {
  const firstDayNumber = datePartsToUtcDayNumber(buildDatePartsAtStartOfMonth(parts))
  const nextMonth = parts.month === 12
    ? { year: parts.year + 1, month: 1, day: 1 }
    : { year: parts.year, month: parts.month + 1, day: 1 }
  const nextMonthDayNumber = datePartsToUtcDayNumber(nextMonth)
  return nextMonthDayNumber - firstDayNumber
}

function addDaysToDateParts(parts: RuntimeDateParts, days: number) {
  const currentDayNumber = datePartsToUtcDayNumber(parts)
  return utcDayNumberToDateParts(currentDayNumber + days)
}

function getNextMonthlyDateParts(parts: RuntimeDateParts, monthDay: number) {
  const nextMonth = parts.month === 12
    ? { year: parts.year + 1, month: 1, day: 1 }
    : { year: parts.year, month: parts.month + 1, day: 1 }
  const nextMonthDays = getDaysInMonth(nextMonth)

  return {
    year: nextMonth.year,
    month: nextMonth.month,
    day: Math.min(monthDay, nextMonthDays)
  }
}

function getCurrentMonthlyDateParts(parts: RuntimeDateParts, monthDay: number) {
  return {
    year: parts.year,
    month: parts.month,
    day: Math.min(monthDay, getDaysInMonth(parts))
  }
}

function getFirstMonthlyDueDateParts(parts: RuntimeDateParts, monthDay: number) {
  const currentMonthDateParts = getCurrentMonthlyDateParts(parts, monthDay)

  if (parts.day < currentMonthDateParts.day) {
    return currentMonthDateParts
  }

  return getNextMonthlyDateParts(parts, monthDay)
}

function getDatePartsFromGameMinute(
  snapshot: RuntimeStorySessionSnapshot,
  gameMinute: number
) {
  normalizeClockState(snapshot)
  const baseDate = parseStoryDate(snapshot.clock.base_date) ?? { year: 1990, month: 1, day: 1 }
  const baseDayNumberUtc = datePartsToUtcDayNumber(baseDate)
  const dayOffset = Math.floor(Math.max(0, clampInteger(gameMinute, 0)) / MINUTES_PER_DAY)
  return utcDayNumberToDateParts(baseDayNumberUtc + dayOffset)
}

function getMinuteOffsetWithinDay(gameMinute: number) {
  const normalizedGameMinute = Math.max(0, clampInteger(gameMinute, 0))
  return ((normalizedGameMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

function addMonthsToDateParts(parts: RuntimeDateParts, months: number) {
  const normalizedMonths = Math.max(0, clampInteger(months, 0))
  if (normalizedMonths === 0) {
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day
    }
  }

  const monthIndex = (parts.month - 1) + normalizedMonths
  const targetYear = parts.year + Math.floor(monthIndex / 12)
  const targetMonth = (monthIndex % 12) + 1
  const targetMonthParts = {
    year: targetYear,
    month: targetMonth,
    day: 1
  }

  return {
    year: targetYear,
    month: targetMonth,
    day: Math.min(parts.day, getDaysInMonth(targetMonthParts))
  }
}

function addYearsToDateParts(parts: RuntimeDateParts, years: number) {
  const normalizedYears = Math.max(0, clampInteger(years, 0))
  if (normalizedYears === 0) {
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day
    }
  }

  const targetYear = parts.year + normalizedYears
  const targetMonthParts = {
    year: targetYear,
    month: parts.month,
    day: 1
  }

  return {
    year: targetYear,
    month: parts.month,
    day: Math.min(parts.day, getDaysInMonth(targetMonthParts))
  }
}

function getGameMinuteFromDateParts(
  snapshot: RuntimeStorySessionSnapshot,
  parts: RuntimeDateParts,
  minuteOffsetWithinDay: number
) {
  normalizeClockState(snapshot)
  const normalizedBaseDate = parseStoryDate(snapshot.clock.base_date) ?? { year: 1990, month: 1, day: 1 }
  const baseDayNumberUtc = datePartsToUtcDayNumber(normalizedBaseDate)
  const targetDayNumberUtc = datePartsToUtcDayNumber(parts)
  const dayOffset = targetDayNumberUtc - baseDayNumberUtc
  return dayOffset * MINUTES_PER_DAY + minuteOffsetWithinDay
}

function resolveInvokeDelayDueGameMinute(
  snapshot: RuntimeStorySessionSnapshot,
  delay: StoryScriptInvokeDelay
) {
  const nowGameMinute = getCurrentGameMinute(snapshot)

  if (delay.value <= 0) {
    return nowGameMinute
  }

  if (delay.unit === "hours") {
    return nowGameMinute + delay.value * 60
  }

  if (delay.unit === "days") {
    return nowGameMinute + delay.value * MINUTES_PER_DAY
  }

  const currentDateParts = getDatePartsFromGameMinute(snapshot, nowGameMinute)
  const minuteOffsetWithinDay = getMinuteOffsetWithinDay(nowGameMinute)
  const targetDateParts = delay.unit === "months"
    ? addMonthsToDateParts(currentDateParts, delay.value)
    : addYearsToDateParts(currentDateParts, delay.value)

  return getGameMinuteFromDateParts(snapshot, targetDateParts, minuteOffsetWithinDay)
}

function getGameDayFromGameMinute(
  snapshot: RuntimeStorySessionSnapshot,
  gameMinute: number
) {
  normalizeClockState(snapshot)
  const normalizedGameMinute = Math.max(0, clampInteger(gameMinute, 0))
  const dayOffset = Math.floor(normalizedGameMinute / MINUTES_PER_DAY)
  return snapshot.clock.base_day + dayOffset
}

function calculateNextLoopDueGameMinute(
  snapshot: RuntimeStorySessionSnapshot,
  loopEvent: RuntimeLoopEventDefinition,
  previousDueGameMinute: number | null
) {
  const currentDayStartGameMinute = getStartOfCurrentDayGameMinute(snapshot)
  const currentDateParts = getCurrentDatePartsFromSnapshot(snapshot)
  const timeOffsetMinutes = getLoopTimeOffsetMinutes(loopEvent)

  if (loopEvent.loop.mode === "daily") {
    return previousDueGameMinute === null
      ? currentDayStartGameMinute + MINUTES_PER_DAY + timeOffsetMinutes
      : previousDueGameMinute + MINUTES_PER_DAY
  }

  if (loopEvent.loop.mode === "interval_days") {
    const intervalDays = clampLoopIntervalDays(loopEvent.loop.interval_days)
    return previousDueGameMinute === null
      ? currentDayStartGameMinute + intervalDays * MINUTES_PER_DAY + timeOffsetMinutes
      : previousDueGameMinute + intervalDays * MINUTES_PER_DAY
  }

  if (loopEvent.loop.mode === "weekly") {
    if (previousDueGameMinute !== null) {
      return previousDueGameMinute + 7 * MINUTES_PER_DAY
    }

    const targetWeekday = clampLoopWeekday(loopEvent.loop.weekday)
    const currentWeekday = resolveWeekday(datePartsToUtcDayNumber(currentDateParts))
    const offsetDays = ((targetWeekday - currentWeekday + 7) % 7) || 7
    return currentDayStartGameMinute + offsetDays * MINUTES_PER_DAY + timeOffsetMinutes
  }

  const targetMonthDay = clampLoopMonthDay(loopEvent.loop.month_day)
  const monthlyAnchorDateParts = previousDueGameMinute === null
    ? currentDateParts
    : getDatePartsFromGameMinute(snapshot, previousDueGameMinute)
  const nextMonthlyDateParts = previousDueGameMinute === null
    ? getFirstMonthlyDueDateParts(monthlyAnchorDateParts, targetMonthDay)
    : getNextMonthlyDateParts(monthlyAnchorDateParts, targetMonthDay)
  const currentDayNumber = datePartsToUtcDayNumber(monthlyAnchorDateParts)
  const nextDayNumber = datePartsToUtcDayNumber(nextMonthlyDateParts)
  if (previousDueGameMinute !== null) {
    return previousDueGameMinute + (nextDayNumber - currentDayNumber) * MINUTES_PER_DAY
  }

  return currentDayStartGameMinute + (nextDayNumber - currentDayNumber) * MINUTES_PER_DAY + timeOffsetMinutes
}

function isScheduledEventQueued(snapshot: RuntimeStorySessionSnapshot, dedupeKey: string) {
  normalizeSchedulerState(snapshot)
  const normalizedDedupeKey = normalizeText(dedupeKey)
  if (!normalizedDedupeKey) {
    return false
  }

  return (
    snapshot.scheduler.active?.dedupe_key === normalizedDedupeKey
    || snapshot.scheduler.scheduled.some((item) => item.dedupe_key === normalizedDedupeKey)
    || snapshot.scheduler.ready_queue.some((item) => item.dedupe_key === normalizedDedupeKey)
  )
}

interface RuntimeScheduleOrderConfig {
  priority?: number
  after?: string[]
  before?: string[]
}

function getLoopScheduleOrderConfig(loopEvent: RuntimeLoopEventDefinition): RuntimeScheduleOrderConfig {
  return {
    priority: loopEvent.loop.priority,
    after: loopEvent.loop.after,
    before: loopEvent.loop.before
  }
}

function createScheduledEvent(
  snapshot: RuntimeStorySessionSnapshot,
  sourceType: RuntimeSchedulerSourceType,
  sourceId: string,
  entryEventId: string,
  dueGameMinute: number,
  dedupeKey: string,
  triggerLocked = false,
  callValues: Record<string, unknown> = {},
  invokeTargetType?: StoryInvokeTargetType,
  orderConfig: RuntimeScheduleOrderConfig = {}
): RuntimeScheduledEvent {
  normalizeSchedulerState(snapshot)
  const seq = snapshot.scheduler.next_seq
  snapshot.scheduler.next_seq += 1

  return {
    instance_id: `evt-${seq}`,
    source_type: sourceType,
    source_id: normalizeText(sourceId),
    invoke_target_type: invokeTargetType,
    entry_event_id: normalizeText(entryEventId),
    due_game_minute: Math.max(0, clampInteger(dueGameMinute, 0)),
    priority: normalizeSchedulePriority(orderConfig.priority),
    after: normalizeScheduleDependencyIds(orderConfig.after),
    before: normalizeScheduleDependencyIds(orderConfig.before),
    seq,
    dedupe_key: normalizeText(dedupeKey),
    trigger_locked: triggerLocked,
    call_values: cloneValue(callValues),
    status: "ready"
  }
}

function scheduledEventMatchesDependency(event: RuntimeScheduledEvent, dependencyId: string) {
  const normalizedDependencyId = normalizeText(dependencyId)
  return Boolean(
    normalizedDependencyId
    && (
      event.source_id === normalizedDependencyId
      || event.entry_event_id === normalizedDependencyId
    )
  )
}

function scheduledEventDependsOn(left: RuntimeScheduledEvent, right: RuntimeScheduledEvent) {
  return left.after.some((dependencyId) => scheduledEventMatchesDependency(right, dependencyId))
    || right.before.some((dependencyId) => scheduledEventMatchesDependency(left, dependencyId))
}

function compareScheduledEvents(left: RuntimeScheduledEvent, right: RuntimeScheduledEvent) {
  if (left.due_game_minute !== right.due_game_minute) {
    return left.due_game_minute - right.due_game_minute
  }

  const leftAfterRight = scheduledEventDependsOn(left, right)
  const rightAfterLeft = scheduledEventDependsOn(right, left)

  if (leftAfterRight && !rightAfterLeft) {
    return 1
  }

  if (rightAfterLeft && !leftAfterRight) {
    return -1
  }

  if (left.priority !== right.priority) {
    return left.priority - right.priority
  }

  return left.seq - right.seq
}

function sortScheduledEvents(events: RuntimeScheduledEvent[]) {
  events.sort((left, right) => {
    if (left.due_game_minute !== right.due_game_minute) {
      return left.due_game_minute - right.due_game_minute
    }

    return compareScheduledEvents(left, right)
  })
}

function sortReadyQueue(snapshot: RuntimeStorySessionSnapshot) {
  normalizeSchedulerState(snapshot)
  sortScheduledEvents(snapshot.scheduler.ready_queue)
}

function enqueueReadyEvent(
  snapshot: RuntimeStorySessionSnapshot,
  scheduledEvent: RuntimeScheduledEvent,
  auditMessage?: string
) {
  normalizeSchedulerState(snapshot)
  if (!scheduledEvent.dedupe_key || isScheduledEventQueued(snapshot, scheduledEvent.dedupe_key)) {
    return false
  }

  snapshot.scheduler.ready_queue.push({
    ...cloneValue(scheduledEvent),
    status: "ready"
  })
  sortReadyQueue(snapshot)
  appendSchedulerAudit(snapshot, {
    kind: "queue-ready",
    source_type: scheduledEvent.source_type,
    source_id: scheduledEvent.source_id,
    entry_event_id: scheduledEvent.entry_event_id,
    due_game_minute: scheduledEvent.due_game_minute,
    message: auditMessage ?? "加入就绪队列"
  })
  return true
}

function enqueueScheduledEvent(
  snapshot: RuntimeStorySessionSnapshot,
  scheduledEvent: RuntimeScheduledEvent,
  auditMessage?: string
) {
  normalizeSchedulerState(snapshot)
  if (!scheduledEvent.dedupe_key || isScheduledEventQueued(snapshot, scheduledEvent.dedupe_key)) {
    return false
  }

  snapshot.scheduler.scheduled.push({
    ...cloneValue(scheduledEvent),
    status: "scheduled"
  })
  sortScheduledEvents(snapshot.scheduler.scheduled)
  appendSchedulerAudit(snapshot, {
    kind: "schedule-future",
    source_type: scheduledEvent.source_type,
    source_id: scheduledEvent.source_id,
    entry_event_id: scheduledEvent.entry_event_id,
    due_game_minute: scheduledEvent.due_game_minute,
    message: auditMessage ?? "加入未来调度"
  })
  return true
}

function promoteDueScheduledEvents(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  return promoteDueScheduledEventsResolved(bundle, snapshot)
  /*
  normalizeSchedulerState(snapshot)
  if (snapshot.scheduler.scheduled.length === 0) {
    return
  }

  const nowGameMinute = getCurrentGameMinute(snapshot)
  const dueScheduledEvents: RuntimeScheduledEvent[] = []
  const remainingScheduledEvents: RuntimeScheduledEvent[] = []

  for (const scheduledEvent of snapshot.scheduler.scheduled) {
    if (scheduledEvent.due_game_minute <= nowGameMinute) {
      dueScheduledEvents.push({
        ...cloneValue(scheduledEvent),
        status: "ready"
      })
      continue
    }

    remainingScheduledEvents.push(scheduledEvent)
  }

  snapshot.scheduler.scheduled = remainingScheduledEvents

  for (const scheduledEvent of dueScheduledEvents) {
    if (scheduledEvent.source_type === "schedule") {
      const loopEvent = getBundleScheduleEvents(bundle).find(
        (item) => item.id === scheduledEvent.source_id
      )

      if (!loopEvent) {
        continue
      }

      const standaloneLoopEvent = createStandaloneEvent("schedule", loopEvent)
      // 循环事件只有在到点时条件成立，才真正进入就绪队列。
      if (!canEnterEvent(bundle, snapshot, standaloneLoopEvent, {})) {
        const loopState = getLoopSchedulerState(snapshot, loopEvent.id)
        loopState.next_due_game_minute = calculateNextLoopDueGameMinute(
          snapshot,
          loopEvent,
          scheduledEvent.due_game_minute
        )
        appendSchedulerAudit(snapshot, {
          kind: "skip-event",
          source_type: "schedule",
          source_id: loopEvent.id,
          entry_event_id: loopEvent.id,
          due_game_minute: scheduledEvent.due_game_minute,
          message: "循环事件到点但未满足触发条件，已跳过当前周期"
        })
        appendSchedulerAudit(snapshot, {
          kind: "loop-reschedule",
          source_type: "schedule",
          source_id: loopEvent.id,
          entry_event_id: loopEvent.id,
          due_game_minute: loopState.next_due_game_minute,
          message: "循环事件跳过当前周期后已重排下次触发时间"
        })
        continue
      }
    }

    appendSchedulerAudit(snapshot, {
      kind: "promote-due",
      source_type: scheduledEvent.source_type,
      source_id: scheduledEvent.source_id,
      entry_event_id: scheduledEvent.entry_event_id,
      due_game_minute: scheduledEvent.due_game_minute,
      message: "到时转入就绪队列"
    })
    enqueueReadyEvent(snapshot, scheduledEvent)
  }
  */
}

function clearCurrentEventState(runtimeState: RuntimeState) {
  runtimeState.snapshot.current_event_id = null
  runtimeState.activeStandaloneEvent = null
  runtimeState.currentEventEntered = false
  runtimeState.currentDialogueIndex = 0
  runtimeState.currentMessageElapsedMs = 0
  runtimeState.pendingActions = []
  runtimeState.lastAction = null
}

function getGraphRootEventIds(bundle: RuntimeStoryBundle) {
  const incomingTargets = new Set<string>()
  const graphNodes = Object.values(getBundleChainNodes(bundle)) as RuntimeGraphNode[]

  for (const node of graphNodes) {
    if (!Array.isArray(node.next)) {
      continue
    }

    for (const nextId of node.next) {
      const nextNode = getBundleGraphNode(bundle, nextId)
      if (isCompiledEvent(nextNode)) {
        incomingTargets.add(nextNode.id)
      }
    }
  }

  return graphNodes
    .filter(isCompiledEvent)
    .filter((node) => !incomingTargets.has(node.id))
    .map((node) => node.id)
}

function hasPendingDirectorEntryEvent(snapshot: RuntimeStorySessionSnapshot) {
  normalizeSchedulerState(snapshot)

  return Boolean(
    snapshot.current_event_id
    || snapshot.scheduler.active
    || snapshot.scheduler.ready_queue.length > 0
  )
}

function scanDirectorEntryEvents(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  storyDirector: RuntimeStoryDirector
) {
  const candidates: RuntimeDirectorCandidate[] = []
  let candidateIndex = 0

  if (hasPendingDirectorEntryEvent(runtimeState.snapshot)) {
    return
  }

  const rootEventIds = getGraphRootEventIds(bundle)
  for (const rootEventId of rootEventIds) {
    const dedupeKey = `chain_root:${rootEventId}`
    if (runtimeState.snapshot.scheduler.consumed_graph_root_ids.includes(rootEventId)) {
      continue
    }

    if (isScheduledEventQueued(runtimeState.snapshot, dedupeKey)) {
      continue
    }

    const rootNode = getBundleGraphNode(bundle, rootEventId)
    if (
      !isCompiledEvent(rootNode)
      || !isRuntimeEventScannable(rootNode)
      || !canEnterEvent(bundle, runtimeState.snapshot, rootNode, {})
    ) {
      continue
    }

    candidates.push({
      sourceType: "chain_root",
      event: rootNode,
      index: candidateIndex,
      reasons: [
        "chain-root",
        "scannable",
        "not-consumed",
        "trigger-passed"
      ]
    })
    candidateIndex += 1
  }

  const onceEvents = getBundleOnceEvents(bundle)
  for (const [eventIndex, event] of onceEvents.entries()) {
    if (!isRuntimeEventScannable(event)) {
      continue
    }

    const dedupeKey = `pool:${event.id}`
    if (runtimeState.snapshot.scheduler.consumed_once_ids.includes(event.id)) {
      continue
    }

    if (runtimeState.snapshot.triggered_once_events.some((item) => item.event_id === event.id)) {
      continue
    }

    if (isScheduledEventQueued(runtimeState.snapshot, dedupeKey)) {
      continue
    }

    const standaloneEvent = createStandaloneEvent("pool", event)
    if (!canEnterEvent(bundle, runtimeState.snapshot, standaloneEvent, {})) {
      continue
    }

    candidates.push({
      sourceType: "pool",
      event,
      index: candidateIndex + eventIndex,
      reasons: [
        "pool",
        "scannable",
        "not-consumed",
        "trigger-passed"
      ]
    })
  }

  if (candidates.length === 0) {
    return
  }

  const features = buildRuntimeDirectorFeatureSnapshot(bundle, runtimeState.snapshot)
  const decision = storyDirector.decide({
    candidates,
    features
  })
  appendRuntimeDirectorLog(
    runtimeState.snapshot,
    createRuntimeDirectorDecisionLog(decision, features)
  )

  if (!decision.selectedEventId) {
    appendSchedulerAudit(runtimeState.snapshot, {
      kind: "skip-event",
      due_game_minute: getCurrentGameMinute(runtimeState.snapshot),
      message: "AI剧情导演未选择自然剧情入口候选"
    })
    return
  }

  const selectedCandidate = candidates.find((candidate) =>
    candidate.sourceType === decision.selectedSourceType
    && candidate.event.id === decision.selectedEventId
  )
  if (!selectedCandidate) {
    appendSchedulerAudit(runtimeState.snapshot, {
      kind: "skip-event",
      source_type: decision.selectedSourceType ?? undefined,
      source_id: decision.selectedEventId,
      entry_event_id: decision.selectedEventId,
      due_game_minute: getCurrentGameMinute(runtimeState.snapshot),
      message: "AI剧情导演选择的事件不在候选集中"
    })
    return
  }

  const selectedEvent = selectedCandidate.event
  const selectedDedupeKey = `${selectedCandidate.sourceType}:${selectedEvent.id}`
  const readyEvent = createScheduledEvent(
    runtimeState.snapshot,
    selectedCandidate.sourceType,
    selectedEvent.id,
    selectedEvent.id,
    getCurrentGameMinute(runtimeState.snapshot),
    selectedDedupeKey,
    true
  )
  enqueueReadyEvent(runtimeState.snapshot, readyEvent)
}

function getBundleOnceEvents(bundle: RuntimeStoryBundle) {
  const onceEventsSource = Array.isArray(bundle.poolEvents)
    ? bundle.poolEvents
    : Array.isArray(bundle.onceEvents)
      ? bundle.onceEvents
      : []

  return onceEventsSource as Array<{
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
  }>
}

function getBundleScheduleEvents(bundle: RuntimeStoryBundle) {
  const scheduleEventsSource = Array.isArray(bundle.scheduleEvents)
    ? bundle.scheduleEvents
    : Array.isArray(bundle.loopEvents)
      ? bundle.loopEvents
      : []

  return scheduleEventsSource as RuntimeLoopEventDefinition[]
}

function ensureLoopSchedules(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState
) {
  const loopEvents = getBundleScheduleEvents(bundle)

  for (const loopEvent of loopEvents) {
    if (!isRuntimeEventScannable(loopEvent)) {
      continue
    }

    const loopState = getLoopSchedulerState(runtimeState.snapshot, loopEvent.id)

    if (loopState.next_due_game_minute === null) {
      loopState.next_due_game_minute = calculateNextLoopDueGameMinute(
        runtimeState.snapshot,
        loopEvent,
        loopState.last_triggered_game_minute
      )
      appendSchedulerAudit(runtimeState.snapshot, {
        kind: "loop-reschedule",
        source_type: "schedule",
        source_id: loopEvent.id,
        entry_event_id: loopEvent.id,
        due_game_minute: loopState.next_due_game_minute,
        message: loopState.trigger_count > 0 ? "循环事件已重排下次触发时间" : "循环事件已初始化首个触发时间"
      })
    }

    const nextDueGameMinute = loopState.next_due_game_minute
    if (nextDueGameMinute === null) {
      continue
    }

    const dedupeKey = `schedule:${loopEvent.id}:${nextDueGameMinute}`

    if (isScheduledEventQueued(runtimeState.snapshot, dedupeKey)) {
      continue
    }

    const scheduledEvent = createScheduledEvent(
      runtimeState.snapshot,
      "schedule",
      loopEvent.id,
      loopEvent.id,
      nextDueGameMinute,
      dedupeKey,
      false,
      {},
      undefined,
      getLoopScheduleOrderConfig(loopEvent)
    )
    enqueueScheduledEvent(runtimeState.snapshot, scheduledEvent)
  }
}

function startNextReadyEventIfIdle(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  normalizeSchedulerState(runtimeState.snapshot)
  if (runtimeState.snapshot.scheduler.active || runtimeState.snapshot.current_event_id) {
    return
  }

  while (!runtimeState.snapshot.scheduler.active && !runtimeState.snapshot.current_event_id) {
    const nextScheduledEvent = runtimeState.snapshot.scheduler.ready_queue.shift()
    if (!nextScheduledEvent) {
      return
    }

    if (
      nextScheduledEvent.source_type === "pool"
      || (nextScheduledEvent.source_type === "invoke" && nextScheduledEvent.invoke_target_type === "pool")
    ) {
      const event = getBundleOnceEvents(bundle).find((item) => item.id === nextScheduledEvent.entry_event_id)

      if (!event) {
        continue
      }

      runtimeState.snapshot.scheduler.active = {
        ...cloneValue(nextScheduledEvent),
        status: "running"
      }
      runtimeState.snapshot.scheduler.event_pause = true
      runtimeState.snapshot.clock.pending_minutes = 0
      appendSchedulerAudit(runtimeState.snapshot, {
        kind: "start-event",
        source_type: nextScheduledEvent.source_type,
        source_id: nextScheduledEvent.source_id,
        entry_event_id: nextScheduledEvent.entry_event_id,
        due_game_minute: nextScheduledEvent.due_game_minute,
        message: "开始执行事件"
      })
      runtimeState.activeStandaloneEvent = createStandaloneEvent(
        "pool",
        event,
        nextScheduledEvent.call_values
      )
      runtimeState.snapshot.current_event_id = event.id
      runtimeState.currentEventEntered = false
      runtimeState.currentDialogueIndex = 0
      runtimeState.currentMessageElapsedMs = 0
      runtimeState.pendingActions = []
      runtimeState.lastAction = null
      enterCurrentEventResolved(bundle, runtimeState, notifications, {
        skipTriggerCheck: Boolean(nextScheduledEvent.trigger_locked)
      })
      settlePassiveEvents(bundle, runtimeState, notifications)
      return
    }

    if (
      nextScheduledEvent.source_type === "schedule"
      || (nextScheduledEvent.source_type === "invoke" && nextScheduledEvent.invoke_target_type === "schedule")
    ) {
      const event = getBundleScheduleEvents(bundle).find(
        (item) => item.id === nextScheduledEvent.entry_event_id
      )

      if (!event) {
        continue
      }

      runtimeState.snapshot.scheduler.active = {
        ...cloneValue(nextScheduledEvent),
        status: "running"
      }
      runtimeState.snapshot.scheduler.event_pause = true
      runtimeState.snapshot.clock.pending_minutes = 0
      appendSchedulerAudit(runtimeState.snapshot, {
        kind: "start-event",
        source_type: nextScheduledEvent.source_type,
        source_id: nextScheduledEvent.source_id,
        entry_event_id: nextScheduledEvent.entry_event_id,
        due_game_minute: nextScheduledEvent.due_game_minute,
        message: "开始执行事件"
      })
      runtimeState.activeStandaloneEvent = createStandaloneEvent(
        "schedule",
        event,
        nextScheduledEvent.call_values
      )
      runtimeState.snapshot.current_event_id = event.id
      runtimeState.currentEventEntered = false
      runtimeState.currentDialogueIndex = 0
      runtimeState.currentMessageElapsedMs = 0
      runtimeState.pendingActions = []
      runtimeState.lastAction = null
      enterCurrentEventResolved(bundle, runtimeState, notifications, {
        skipTriggerCheck: Boolean(nextScheduledEvent.trigger_locked)
      })
      settlePassiveEvents(bundle, runtimeState, notifications)
      return
    }

    runtimeState.snapshot.scheduler.active = {
      ...cloneValue(nextScheduledEvent),
      status: "running"
    }
    runtimeState.snapshot.scheduler.event_pause = true
    runtimeState.snapshot.clock.pending_minutes = 0
    appendSchedulerAudit(runtimeState.snapshot, {
      kind: "start-event",
      source_type: nextScheduledEvent.source_type,
      source_id: nextScheduledEvent.source_id,
      entry_event_id: nextScheduledEvent.entry_event_id,
      due_game_minute: nextScheduledEvent.due_game_minute,
      message: "开始执行事件"
    })
    moveToEventResolved(bundle, runtimeState, nextScheduledEvent.entry_event_id, {}, {
      skipTriggerCheck: Boolean(nextScheduledEvent.trigger_locked)
    })
    enterCurrentEventResolved(bundle, runtimeState, notifications, {
      skipTriggerCheck: Boolean(nextScheduledEvent.trigger_locked)
    })
    settlePassiveEvents(bundle, runtimeState, notifications)
  }
}

function reconcileScheduler(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  options: {
    runPhoneAutoMessages?: boolean
  } = {}
) {
  normalizeSchedulerState(runtimeState.snapshot)
  promoteDueScheduledEventsResolved(bundle, runtimeState.snapshot)
  scanDirectorEntryEvents(bundle, runtimeState, runtimeState.storyDirector)
  ensureLoopSchedules(bundle, runtimeState)
  if (options.runPhoneAutoMessages) {
    reconcilePhoneAutoMessages(bundle, runtimeState, notifications)
  }
  startNextReadyEventIfIdle(bundle, runtimeState, notifications)
  syncSystemTimeFieldsFromClock(runtimeState.snapshot)
}

function isCompiledEvent(node: RuntimeGraphNode | null | undefined): node is CompiledEvent {
  return Boolean(node && !("exec_script" in node))
}

function isCompiledAction(node: RuntimeGraphNode | null | undefined): node is CompiledAction {
  return Boolean(node && "exec_script" in node)
}

function isRuntimeStandaloneEvent(node: RuntimePlayableEvent | null | undefined): node is RuntimeStandaloneEvent {
  return Boolean(node && "runtime_source_type" in node)
}

function getBundleGraphNode(bundle: RuntimeStoryBundle, nodeId: string | null) {
  if (!nodeId) {
    return null
  }

  return (getBundleChainNodes(bundle)[nodeId] as RuntimeGraphNode | undefined) ?? null
}

function getBundleChainNodes(bundle: RuntimeStoryBundle) {
  return bundle.chainEvents ?? bundle.graphEvents ?? {}
}

function createStandaloneEvent(
  sourceType: "pool" | "schedule",
  event: {
    id: string
    title: string
    trigger_expr: string
    trigger_mode?: RuntimeEventTriggerMode
    invoke_params?: Array<{
      name: string
      descr?: string
    }>
    init_script: string
    end_script: string
    object_keys: string[]
    presentation: RuntimeStoryPresentation
    location: string
    bgm: string
  },
  callValues: Record<string, unknown> = {}
): RuntimeStandaloneEvent {
  return {
    runtime_source_type: sourceType,
    node_type: "event",
    id: event.id,
    title: event.title,
    trigger_expr: event.trigger_expr,
    trigger_mode: event.trigger_mode,
    invoke_params: cloneValue(event.invoke_params ?? []),
    init_script: event.init_script,
    end_script: event.end_script,
    object_keys: cloneValue(event.object_keys),
    presentation: cloneValue(event.presentation),
    location: event.location,
    bgm: event.bgm,
    call_values: cloneValue(callValues),
    next: []
  }
}

function getCurrentPlayableEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState
): RuntimePlayableEvent | null {
  if (runtimeState.activeStandaloneEvent) {
    return runtimeState.activeStandaloneEvent
  }

  const currentNode = getBundleGraphNode(bundle, runtimeState.snapshot.current_event_id)
  return isCompiledEvent(currentNode) ? currentNode : null
}

function getBundleRoles(bundle: RuntimeStoryBundle) {
  const roles = bundle.roles as {
    normal?: { roles?: RuntimeNormalRoleDefinition[] }
    important?: { roles?: RuntimeImportantRoleDefinition[] }
  } | null

  return {
    normal: roles?.normal?.roles ?? [],
    important: roles?.important?.roles ?? []
  }
}

function getBundleLocations(bundle: RuntimeStoryBundle) {
  const locations = bundle.eventLocations as {
    assignments?: RuntimeLocationAssignment[]
  } | null

  return locations?.assignments ?? []
}

function findRoleLabel(bundle: RuntimeStoryBundle, roleKey: string) {
  if (roleKey === "player") {
    return "主角"
  }

  const [scope, roleId] = roleKey.split(":")
  if (!scope || !roleId) {
    return roleKey
  }

  const roles = getBundleRoles(bundle)
  const role = scope === "important"
    ? roles.important.find((item) => item.id === roleId)
    : roles.normal.find((item) => item.id === roleId)

  if (!role) {
    return roleKey
  }

  return normalizeText(role.name).trim() || role.descr.trim() || role.id
}

function isBundleRoleKey(bundle: RuntimeStoryBundle, roleKey: string) {
  if (!roleKey || roleKey === "player") {
    return false
  }

  const [scope, roleId] = roleKey.split(":")
  if (!scope || !roleId) {
    return false
  }

  const roles = getBundleRoles(bundle)
  return scope === "important"
    ? roles.important.some((item) => item.id === roleId)
    : scope === "normal"
      ? roles.normal.some((item) => item.id === roleId)
      : false
}

function assertRuntimePhoneRoleKey(bundle: RuntimeStoryBundle, roleKey: unknown) {
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  if (!normalizedRoleKey) {
    throw new Error("phone role key is required.")
  }

  if (!isBundleRoleKey(bundle, normalizedRoleKey)) {
    throw new Error(`phone role "${normalizedRoleKey}" does not exist in runtime role library.`)
  }

  return normalizedRoleKey
}

function getPhoneContact(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  normalizePhoneState(snapshot)
  return snapshot.phone.contacts.find((contact) => contact.role_key === roleKey) ?? null
}

function getPhoneThread(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  normalizePhoneState(snapshot)
  return snapshot.phone.threads.find((thread) => thread.role_key === roleKey) ?? null
}

function ensurePhoneThread(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  normalizePhoneState(snapshot)
  const existing = getPhoneThread(snapshot, roleKey)
  if (existing) {
    return existing
  }

  const nextThread: RuntimePhoneThreadState = {
    role_key: roleKey,
    messages: []
  }
  snapshot.phone.threads.push(nextThread)
  return nextThread
}

function ensurePhoneContact(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string
) {
  normalizePhoneState(snapshot)
  const existing = getPhoneContact(snapshot, roleKey)
  if (existing) {
    return existing
  }

  const contactMeta = buildRuntimePhoneContactMeta(
    bundle,
    roleKey,
    getBundlePhoneContactProfile(bundle, roleKey)?.initial_favor ?? 20
  )
  const nextContact: RuntimePhoneContactState = {
    role_key: roleKey,
    favor: contactMeta.initialFavor,
    unlocked_at_day: Math.max(1, readSystemNumber(snapshot.system_vals, "system.now_day", 1))
  }
  snapshot.phone.contacts.push(nextContact)
  return nextContact
}

function createPhoneMessageId(roleKey: string, gameMinute: number, messageIndex: number) {
  const safeRoleKey = roleKey.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()
  return `phone-${safeRoleKey}-${gameMinute}-${messageIndex}`
}

function appendPhoneMessage(
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  sender: RuntimePhoneMessageState["sender"],
  content: string,
  options: {
    read?: boolean
    optionId?: string
    optionKind?: "talk" | "action"
    quickMessageId?: string
    sourceRuleId?: string
    tags?: string[]
  } = {}
) {
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  const normalizedContent = normalizeText(content)

  if (!normalizedRoleKey || !normalizedContent) {
    return null
  }

  const thread = ensurePhoneThread(snapshot, normalizedRoleKey)
  const gameMinute = getCurrentGameMinute(snapshot)
  const nextMessage: RuntimePhoneMessageState = {
    id: createPhoneMessageId(normalizedRoleKey, gameMinute, thread.messages.length + 1),
    sender,
    content: normalizedContent,
    game_minute: gameMinute,
    read: options.read ?? sender === "player",
    ...(options.optionId ? { option_id: normalizeText(options.optionId) } : {}),
    ...(options.optionKind ? { option_kind: options.optionKind } : {}),
    ...(options.quickMessageId ? { quick_message_id: options.quickMessageId } : {}),
    ...(options.sourceRuleId ? { source_rule_id: options.sourceRuleId } : {}),
    ...(options.tags && options.tags.length > 0
      ? { tags: Array.from(new Set(options.tags.map((tag) => normalizeText(tag)).filter(Boolean))) }
      : {})
  }

  thread.messages.push(nextMessage)
  return nextMessage
}

function getPhoneUnreadCount(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  const thread = getPhoneThread(snapshot, roleKey)
  if (!thread) {
    return 0
  }

  return thread.messages.filter((message) => !message.read && message.sender !== "player").length
}

function markPhoneThreadRead(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  const thread = getPhoneThread(snapshot, roleKey)
  if (!thread) {
    return 0
  }

  let changedCount = 0
  for (const message of thread.messages) {
    if (message.sender !== "player" && !message.read) {
      message.read = true
      changedCount += 1
    }
  }

  return changedCount
}

function getLatestPhoneMessagePreview(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  const thread = getPhoneThread(snapshot, roleKey)
  const lastMessage = thread?.messages[thread.messages.length - 1]

  return {
    preview: lastMessage?.content ?? null,
    gameMinute: lastMessage?.game_minute ?? null,
    messageCount: thread?.messages.length ?? 0
  }
}

function resolvePhoneTalkOptionsForContact(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  snapshot?: RuntimeStorySessionSnapshot
): RuntimeResolvedPhoneTalkOption[] {
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  if (!normalizedRoleKey) {
    return []
  }

  const contact = snapshot ? getPhoneContact(snapshot, normalizedRoleKey) : null
  const meta = buildRuntimePhoneContactMeta(
    bundle,
    normalizedRoleKey,
    contact?.favor ?? getBundlePhoneContactProfile(bundle, normalizedRoleKey)?.initial_favor ?? 20
  )
  if (!meta.canContact) {
    return []
  }

  const suggestedIds = getLatestPhoneSuggestedOptionIds(bundle, normalizedRoleKey, snapshot)
  const talkLibraryOptions = getBundlePhoneConfig(bundle).talk_library
    .filter((entry) => normalizeText(entry.text) && matchesPhoneLibraryScope(entry.scope, meta))
    .map((entry) => {
      const tags = Array.from(new Set((entry.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      return {
        id: normalizeText(entry.id),
        text: normalizeText(entry.text),
        tags,
        baseFavorDelta: Math.max(0, clampInteger(entry.base_favor_delta, 0)),
        cooldownHours: Math.max(0, clampInteger(entry.cooldown_hours, 0)),
        suggested: suggestedIds.has(normalizeText(entry.id)),
        preferred: tags.some((tag) => meta.preferredTags.has(tag)),
        invoke: entry.invoke,
        source: "talk-library"
      } satisfies RuntimeResolvedPhoneTalkOption
    })
    .filter((entry) => entry.id && entry.text)
  const legacyQuickMessages = getBundlePhoneQuickMessages(bundle)
    .filter((message) => {
      if (!normalizeText(message.text)) {
        return false
      }

      const availableRoleKeys = Array.isArray(message.available_role_keys)
        ? message.available_role_keys.map((item) => normalizeText(item)).filter(Boolean)
        : []
      if (availableRoleKeys.length > 0 && !availableRoleKeys.includes(normalizedRoleKey)) {
        return false
      }

      return message.visibility !== "suggested-only" || suggestedIds.has(normalizeText(message.id))
    })
    .map((message) => {
      const tags = Array.from(new Set((message.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      return {
        id: normalizeText(message.id),
        text: normalizeText(message.text),
        tags,
        baseFavorDelta: Math.max(0, clampInteger(message.base_favor_delta, 0)),
        cooldownHours: Math.max(0, clampInteger(message.cooldown_hours, 0)),
        suggested: suggestedIds.has(normalizeText(message.id)),
        preferred: tags.some((tag) => meta.preferredTags.has(tag)),
        source: "legacy-quick-message"
      } satisfies RuntimeResolvedPhoneTalkOption
    })
    .filter((entry) => entry.id && entry.text)

  return [...talkLibraryOptions, ...legacyQuickMessages]
    .sort((left, right) => {
      if (left.suggested !== right.suggested) {
        return left.suggested ? -1 : 1
      }

      if (left.preferred !== right.preferred) {
        return left.preferred ? -1 : 1
      }

      if (left.baseFavorDelta !== right.baseFavorDelta) {
        return right.baseFavorDelta - left.baseFavorDelta
      }

      return left.id.localeCompare(right.id, "zh-Hans-CN")
    })
}

function getPhoneProactiveRulesForContact(
  bundle: RuntimeStoryBundle,
  roleKey: string
): RuntimeStoryPhoneProactiveMessageRule[] {
  const profile = getBundlePhoneContactProfile(bundle, roleKey)
  if (!profile) {
    return []
  }

  return (profile.proactive_messages ?? [])
    .filter((rule) => rule.enabled && rule.messages.length > 0 && rule.trigger_expr.trim().length > 0)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function findPhoneTalkOption(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  talkId: string,
  snapshot?: RuntimeStorySessionSnapshot
) {
  const normalizedTalkId = normalizeText(talkId)
  if (!normalizedTalkId) {
    return null
  }

  return resolvePhoneTalkOptionsForContact(bundle, roleKey, snapshot).find(
    (message) => message.id === normalizedTalkId
  ) ?? null
}

function getPlayerMoneyBalance(snapshot: RuntimeStorySessionSnapshot) {
  const value = readSnapshotValue(snapshot, "player.money")
  const normalized = typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN

  return Number.isFinite(normalized) ? normalized : null
}

function resolvePhoneActionDisabledReason(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  action: RuntimeStoryPhoneActionLibraryEntry
) {
  const contact = getPhoneContact(snapshot, roleKey)
  const meta = buildRuntimePhoneContactMeta(
    bundle,
    roleKey,
    contact?.favor ?? getBundlePhoneContactProfile(bundle, roleKey)?.initial_favor ?? 20
  )
  if (!meta.canContact) {
    return meta.lockMessage ?? "当前无法主动联系。"
  }

  const normalizedTags = Array.from(new Set((action.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
  if (normalizedTags.length > 0) {
    const unlocked = normalizedTags.some((tag) => meta.unlockActionTags.has(tag))
    if (!unlocked) {
      return `${meta.stageLabel}阶段尚未解锁这个动作。`
    }
  }

  if (action.cost_money > 0) {
    const currentMoney = getPlayerMoneyBalance(snapshot)
    if (currentMoney === null) {
      return "当前故事没有可写入的 player.money 变量，暂时无法支付。"
    }

    if (currentMoney < action.cost_money) {
      return `需要 ${action.cost_money} 元，当前只有 ${Math.max(0, Math.trunc(currentMoney))} 元。`
    }
  }

  for (const costItem of action.cost_items ?? []) {
    const itemId = normalizeItemId(costItem.item_id)
    const quantity = normalizeBagQuantity(costItem.quantity, 1)
    if (!itemId || quantity <= 0) {
      continue
    }

    const currentQuantity = findBagEntry(snapshot, "player", itemId)?.quantity ?? 0
    if (currentQuantity < quantity) {
      const itemName = getBundleItemNameMap(bundle).get(itemId) ?? itemId
      return `需要 ${itemName} x${quantity}，当前只有 ${currentQuantity}。`
    }
  }

  return null
}

function resolvePhoneActionOptionsForContact(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  snapshot: RuntimeStorySessionSnapshot
): RuntimeResolvedPhoneActionOption[] {
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  if (!normalizedRoleKey) {
    return []
  }

  const contact = getPhoneContact(snapshot, normalizedRoleKey)
  const meta = buildRuntimePhoneContactMeta(
    bundle,
    normalizedRoleKey,
    contact?.favor ?? getBundlePhoneContactProfile(bundle, normalizedRoleKey)?.initial_favor ?? 20
  )
  const itemNameMap = getBundleItemNameMap(bundle)

  return getBundlePhoneConfig(bundle).action_library
    .filter((entry) => normalizeText(entry.label) && normalizeText(entry.text) && matchesPhoneLibraryScope(entry.scope, meta))
    .map((entry) => {
      const tags = Array.from(new Set((entry.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      return {
        id: normalizeText(entry.id),
        label: normalizeText(entry.label),
        text: normalizeText(entry.text),
        tags,
        baseFavorDelta: Math.max(0, clampInteger(entry.base_favor_delta, 0)),
        cooldownHours: Math.max(0, clampInteger(entry.cooldown_hours, 0)),
        costMoney: Math.max(0, clampInteger(entry.cost_money, 0)),
        costItems: (entry.cost_items ?? [])
          .map((item) => ({
            itemId: normalizeItemId(item.item_id),
            itemName: itemNameMap.get(normalizeItemId(item.item_id)) ?? normalizeItemId(item.item_id),
            quantity: normalizeBagQuantity(item.quantity, 1)
          }))
          .filter((item) => item.itemId && item.quantity > 0),
        preferred: tags.some((tag) => meta.preferredTags.has(tag)),
        disabledReason: resolvePhoneActionDisabledReason(bundle, snapshot, normalizedRoleKey, entry),
        invoke: entry.invoke
      } satisfies Omit<RuntimeResolvedPhoneActionOption, "disabled">
    })
    .filter((entry) => entry.id && entry.label && entry.text)
    .map((entry) => ({
      ...entry,
      disabled: Boolean(entry.disabledReason)
    }))
    .sort((left, right) => {
      if (left.disabled !== right.disabled) {
        return left.disabled ? 1 : -1
      }

      if (left.preferred !== right.preferred) {
        return left.preferred ? -1 : 1
      }

      if (left.costMoney !== right.costMoney) {
        return left.costMoney - right.costMoney
      }

      return left.id.localeCompare(right.id, "zh-Hans-CN")
    })
}

function choosePhoneReply(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  tags: string[]
) {
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  const normalizedTags = Array.from(new Set(tags.map((tag) => normalizeText(tag)).filter(Boolean)))
  const contact = getPhoneContact(snapshot, normalizedRoleKey)
  const meta = buildRuntimePhoneContactMeta(
    bundle,
    normalizedRoleKey,
    contact?.favor ?? getBundlePhoneContactProfile(bundle, normalizedRoleKey)?.initial_favor ?? 20
  )
  const fallbackReplies = getBundlePhoneConfig(bundle).fallback_replies
  const replyEntries = getBundlePhoneConfig(bundle).reply_library
    .filter((entry) => {
      const entryTags = Array.from(new Set((entry.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      if (entryTags.length > 0 && normalizedTags.length > 0 && !entryTags.some((tag) => normalizedTags.includes(tag))) {
        return false
      }

      return entry.replies.length > 0 && matchesPhoneLibraryScope(entry.scope, meta)
    })
    .sort((left, right) => {
      const leftTags = Array.from(new Set((left.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      const rightTags = Array.from(new Set((right.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      const tagDelta = getPhoneTagOverlapScore(rightTags, normalizedTags) - getPhoneTagOverlapScore(leftTags, normalizedTags)
      if (tagDelta !== 0) {
        return tagDelta
      }

      const specificityDelta =
        getPhoneScopeSpecificityScore(right.scope, normalizedRoleKey)
        - getPhoneScopeSpecificityScore(left.scope, normalizedRoleKey)
      if (specificityDelta !== 0) {
        return specificityDelta
      }

      return left.id.localeCompare(right.id, "zh-Hans-CN")
    })
  const replyEntry = replyEntries[0]
  if (replyEntry && replyEntry.replies.length > 0) {
    const thread = getPhoneThread(snapshot, normalizedRoleKey)
    const previousReplyCount = thread?.messages.filter((message) => message.sender === "contact").length ?? 0
    return replyEntry.replies[previousReplyCount % replyEntry.replies.length] ?? replyEntry.replies[0] ?? ""
  }

  for (const tag of normalizedTags) {
    const profileReplies = meta.profile?.reply_by_tag?.[tag] ?? []
    if (profileReplies.length > 0) {
      return profileReplies[0] ?? ""
    }

    const fallbackTagReplies = fallbackReplies[tag] ?? []
    if (fallbackTagReplies.length > 0) {
      return fallbackTagReplies[0] ?? ""
    }
  }

  const defaultReplies = fallbackReplies.default ?? []
  return defaultReplies[0] ?? ""
}

function findLatestPhoneProactiveRuleMessage(
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  ruleId: string
) {
  const thread = getPhoneThread(snapshot, roleKey)
  return thread?.messages
    .slice()
    .reverse()
    .find((message) => message.sender === "contact" && message.source_rule_id === ruleId) ?? null
}

function choosePhoneProactiveRuleMessage(
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  rule: RuntimeStoryPhoneProactiveMessageRule
) {
  const thread = getPhoneThread(snapshot, roleKey)
  const previousCount = thread?.messages.filter(
    (message) => message.sender === "contact" && message.source_rule_id === rule.id
  ).length ?? 0

  if (rule.messages.length === 0) {
    return ""
  }

  return rule.messages[previousCount % rule.messages.length] ?? rule.messages[0] ?? ""
}

function canFirePhoneProactiveRule(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  rule: RuntimeStoryPhoneProactiveMessageRule
) {
  if (!getPhoneContact(snapshot, roleKey)) {
    return false
  }

  const latestRuleMessage = findLatestPhoneProactiveRuleMessage(snapshot, roleKey, rule.id)
  if (latestRuleMessage) {
    const cooldownMinutes = Math.max(1, rule.cooldown_hours) * 60
    const minuteGap = Math.max(0, getCurrentGameMinute(snapshot) - latestRuleMessage.game_minute)
    if (minuteGap < cooldownMinutes) {
      return false
    }
  }

  const executionContext = buildRuntimeContextValues(bundle, snapshot, {})
  const combinedValsFile = createCombinedValsFile(snapshot)

  try {
    return evaluateStoryBooleanExpression(
      combinedValsFile,
      rule.trigger_expr,
      DEFAULT_MAX_CALC_NESTING_DEPTH,
      executionContext
    )
  } catch {
    return false
  }
}

function reconcilePhoneAutoMessages(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  normalizePhoneState(runtimeState.snapshot)

  for (const contact of runtimeState.snapshot.phone.contacts) {
    const proactiveRules = getPhoneProactiveRulesForContact(bundle, contact.role_key)
    for (const rule of proactiveRules) {
      if (!canFirePhoneProactiveRule(bundle, runtimeState.snapshot, contact.role_key, rule)) {
        continue
      }

      const content = choosePhoneProactiveRuleMessage(runtimeState.snapshot, contact.role_key, rule)
      if (!content) {
        continue
      }

      const message = sendPhoneMessageFromContact(
        bundle,
        runtimeState.snapshot,
        notifications,
        contact.role_key,
        content,
        {
          sourceRuleId: rule.id
        }
      )
      if (!message) {
        continue
      }

      if (rule.favor_delta !== 0) {
        contact.favor = clampPhoneFavor(contact.favor + rule.favor_delta, contact.favor)
      }
    }
  }
}

function calculatePhoneFavorDelta(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  option: {
    id: string
    baseFavorDelta: number
    cooldownHours: number
  }
) {
  const thread = getPhoneThread(snapshot, roleKey)
  const previousPlayerMessage = thread?.messages
    .slice()
    .reverse()
    .find((message) => message.sender === "player") ?? null
  let favorDelta = Math.max(0, option.baseFavorDelta)

  if (previousPlayerMessage?.option_id === option.id || previousPlayerMessage?.quick_message_id === option.id) {
    favorDelta = Math.max(0, favorDelta - 1)
  }

  if (option.cooldownHours > 0 && previousPlayerMessage) {
    const cooldownMinutes = option.cooldownHours * 60
    const minuteGap = Math.max(0, getCurrentGameMinute(snapshot) - previousPlayerMessage.game_minute)
    if (
      (previousPlayerMessage.option_id === option.id || previousPlayerMessage.quick_message_id === option.id)
      && minuteGap < cooldownMinutes
    ) {
      favorDelta = Math.max(0, favorDelta - 1)
    }
  }

  const contact = ensurePhoneContact(bundle, snapshot, roleKey)
  if (contact.favor >= 80) {
    favorDelta = Math.max(0, favorDelta - 1)
  }

  return favorDelta
}

function autoRegisterPhoneContactsFromEvent(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  event: RuntimePlayableEvent,
  notifications: string[]
) {
  if (event.presentation.type !== "dialogue") {
    return
  }

  const speakerRoleKeys = Array.from(
    new Set(
      event.presentation.dialogues
        .filter((dialogue) => dialogue.speaker_type === "object")
        .map((dialogue) => normalizeText(dialogue.speaker_key))
        .filter(Boolean)
    )
  )

  for (const roleKey of speakerRoleKeys) {
    const contactMeta = buildRuntimePhoneContactMeta(
      bundle,
      roleKey,
      getBundlePhoneContactProfile(bundle, roleKey)?.initial_favor ?? 20
    )
    if (!contactMeta.enabled || !contactMeta.autoAdd) {
      continue
    }

    if (!isBundleRoleKey(bundle, roleKey)) {
      continue
    }

    const existed = Boolean(getPhoneContact(snapshot, roleKey))
    ensurePhoneContact(bundle, snapshot, roleKey)
    if (!existed) {
      notifications.push(`手机已新增联系人：${findRoleLabel(bundle, roleKey)}`)
    }
  }
}

function sendPhoneMessageFromContact(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  notifications: string[],
  roleKey: string,
  content: string,
  options: {
    sourceRuleId?: string
  } = {}
) {
  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  const message = appendPhoneMessage(snapshot, normalizedRoleKey, "contact", content, {
    read: false,
    sourceRuleId: options.sourceRuleId
  })
  if (!message) {
    return null
  }

  notifications.push(`联系人 ${findRoleLabel(bundle, normalizedRoleKey)} 发来新消息。`)
  appendHistory(snapshot, {
    type: "system",
    id: message.id,
    title: `phone:${normalizedRoleKey}`,
    content: `${findRoleLabel(bundle, normalizedRoleKey)}: ${message.content}`
  })
  return message
}

function sendPhoneMessageToContact(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  content: string
) {
  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  const message = appendPhoneMessage(snapshot, normalizedRoleKey, "player", content, {
    read: true
  })
  if (!message) {
    return null
  }

  appendHistory(snapshot, {
    type: "system",
    id: message.id,
    title: "phone:player",
    content: `主角 -> ${findRoleLabel(bundle, normalizedRoleKey)}: ${message.content}`
  })
  return message
}

function applyPhoneActionCosts(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  action: RuntimeResolvedPhoneActionOption
) {
  if (action.costMoney > 0) {
    const currentMoney = getPlayerMoneyBalance(snapshot)
    if (currentMoney === null) {
      throw new Error("当前故事没有可写入的 player.money 变量，暂时无法支付。")
    }

    if (currentMoney < action.costMoney) {
      throw new Error(`需要 ${action.costMoney} 元，当前只有 ${Math.max(0, Math.trunc(currentMoney))} 元。`)
    }

    if (!writeSnapshotValue(snapshot, "player.money", Math.max(0, Math.trunc(currentMoney - action.costMoney)))) {
      throw new Error("player.money 不是可写 value 变量，暂时无法支付。")
    }
  }

  for (const costItem of action.costItems) {
    if (!costItem.itemId || costItem.quantity <= 0) {
      continue
    }

    const removed = createRuntimeBagScriptFunctions(bundle, snapshot).bag_remove(
      "player",
      costItem.itemId,
      costItem.quantity
    )
    if (!removed) {
      throw new Error(`消耗物品失败：${costItem.itemName} x${costItem.quantity}`)
    }
  }
}

function sendPhoneTalk(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  roleKey: string,
  talkId: string
) {
  const snapshot = runtimeState.snapshot
  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  const talkOption = findPhoneTalkOption(bundle, normalizedRoleKey, talkId, snapshot)

  if (!talkOption) {
    throw new Error(`phone talk "${talkId}" is not available for "${normalizedRoleKey}".`)
  }

  ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  const favorDelta = calculatePhoneFavorDelta(bundle, snapshot, normalizedRoleKey, talkOption)
  const outgoingMessage = appendPhoneMessage(snapshot, normalizedRoleKey, "player", talkOption.text, {
    read: true,
    optionId: talkOption.id,
    optionKind: "talk",
    quickMessageId: talkOption.source === "legacy-quick-message" ? talkOption.id : undefined,
    tags: talkOption.tags
  })
  if (!outgoingMessage) {
    return false
  }

  const contact = ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  contact.favor = clampPhoneFavor(contact.favor + favorDelta, contact.favor)

  appendHistory(snapshot, {
    type: "system",
    id: outgoingMessage.id,
    title: `phone:${normalizedRoleKey}`,
    content: `主角向 ${findRoleLabel(bundle, normalizedRoleKey)} 发送消息：${outgoingMessage.content}`
  })

  if (talkOption.invoke) {
    queueInvokeEvent(
      bundle,
      runtimeState,
      talkOption.invoke.target_type,
      talkOption.invoke.event_id,
      {},
      talkOption.invoke.delay
    )
  }

  const replyContent = choosePhoneReply(bundle, snapshot, normalizedRoleKey, talkOption.tags)
  if (replyContent) {
    sendPhoneMessageFromContact(bundle, snapshot, notifications, normalizedRoleKey, replyContent)
  }

  return true
}

function sendPhoneAction(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  roleKey: string,
  actionId: string
) {
  const snapshot = runtimeState.snapshot
  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  const actionOption = resolvePhoneActionOptionsForContact(bundle, normalizedRoleKey, snapshot).find(
    (entry) => entry.id === normalizeText(actionId)
  )

  if (!actionOption) {
    throw new Error(`phone action "${actionId}" is not available for "${normalizedRoleKey}".`)
  }

  if (actionOption.disabled) {
    throw new Error(actionOption.disabledReason ?? `phone action "${actionId}" is currently unavailable.`)
  }

  applyPhoneActionCosts(bundle, snapshot, actionOption)
  const favorDelta = calculatePhoneFavorDelta(bundle, snapshot, normalizedRoleKey, actionOption)
  const outgoingMessage = appendPhoneMessage(snapshot, normalizedRoleKey, "player", actionOption.text, {
    read: true,
    optionId: actionOption.id,
    optionKind: "action",
    tags: actionOption.tags
  })
  if (!outgoingMessage) {
    return false
  }

  const contact = ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  contact.favor = clampPhoneFavor(contact.favor + favorDelta, contact.favor)

  appendHistory(snapshot, {
    type: "system",
    id: outgoingMessage.id,
    title: `phone:${normalizedRoleKey}`,
    content: `主角对 ${findRoleLabel(bundle, normalizedRoleKey)} 执行动作：${actionOption.label}`
  })

  if (actionOption.invoke) {
    queueInvokeEvent(
      bundle,
      runtimeState,
      actionOption.invoke.target_type,
      actionOption.invoke.event_id,
      {},
      actionOption.invoke.delay
    )
  }

  const replyContent = choosePhoneReply(bundle, snapshot, normalizedRoleKey, actionOption.tags)
  if (replyContent) {
    sendPhoneMessageFromContact(bundle, snapshot, notifications, normalizedRoleKey, replyContent)
  }

  return true
}

function sendPhoneQuickMessage(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  roleKey: string,
  quickMessageId: string
) {
  return sendPhoneTalk(bundle, runtimeState, notifications, roleKey, quickMessageId)
}

function findLocationLabel(bundle: RuntimeStoryBundle, locationId: string) {
  const trimmedLocationId = normalizeText(locationId)
  if (!trimmedLocationId) {
    return null
  }

  const location = getBundleLocations(bundle).find((item) => item.id.trim() === trimmedLocationId)
  if (!location) {
    return trimmedLocationId
  }

  const descr = location.descr.trim()
  return descr ? `${location.id} - ${descr}` : location.id
}

function getRuntimeEventCallValues(event: RuntimePlayableEvent | null | undefined) {
  if (!event || !isRuntimeStandaloneEvent(event)) {
    return {}
  }

  return cloneValue(event.call_values ?? {})
}

function getRuntimeActiveCallValues(runtimeState: RuntimeState) {
  const activeScheduledEvent = runtimeState.snapshot.scheduler.active
  if (!activeScheduledEvent || activeScheduledEvent.source_type !== "invoke") {
    return {}
  }

  return cloneValue(activeScheduledEvent.call_values ?? {})
}

function getRuntimePlayableEventCallValues(
  runtimeState: RuntimeState,
  event: RuntimePlayableEvent | null | undefined
) {
  if (isRuntimeStandaloneEvent(event)) {
    return getRuntimeEventCallValues(event)
  }

  return getRuntimeActiveCallValues(runtimeState)
}

function buildRuntimeContextValues(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  branchValues: Record<string, unknown>,
  callValues: Record<string, unknown> = {}
) {
  const combinedValues: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(branchValues)) {
    combinedValues[`branch.${key}`] = cloneValue(value)
  }

  for (const [key, value] of Object.entries(callValues)) {
    combinedValues[`call.${key}`] = cloneValue(value)
  }

  return {
    values: combinedValues,
    functions: {
      ...createRuntimeBagReadableFunctions(bundle, snapshot),
      ...createRuntimePhoneReadableFunctions(bundle, snapshot)
    }
  } satisfies StoryScriptExecutionContext
}

function getCurrentRuntimeBagTimestamp(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)
  return {
    day: Math.max(1, snapshot.clock.base_day + Math.floor(snapshot.clock.total_minutes / MINUTES_PER_DAY)),
    minute: snapshot.clock.total_minutes
  }
}

function getBag(snapshot: RuntimeStorySessionSnapshot, ownerId: string) {
  normalizeBagsState(snapshot)

  if (!snapshot.bags[ownerId]) {
    snapshot.bags[ownerId] = {
      entries: []
    }
  }

  return snapshot.bags[ownerId]
}

function getBagEntry(snapshot: RuntimeStorySessionSnapshot, ownerId: string, itemId: string) {
  return getBag(snapshot, ownerId).entries.find((entry) => entry.item_id === itemId) ?? null
}

function findBagEntry(snapshot: RuntimeStorySessionSnapshot, ownerId: string, itemId: string) {
  normalizeBagsState(snapshot)
  return snapshot.bags[ownerId]?.entries.find((entry) => entry.item_id === itemId) ?? null
}

function assertRuntimeBagArgs(ownerId: unknown, itemId: unknown, quantity?: unknown) {
  const normalizedOwnerId = normalizeOwnerId(ownerId)
  const normalizedItemId = normalizeItemId(itemId)
  const normalizedQuantity = normalizeBagQuantity(quantity, 1)

  if (!normalizedOwnerId) {
    throw new Error("bag owner id is required.")
  }

  if (!normalizedItemId) {
    throw new Error("bag item id is required.")
  }

  if (normalizedQuantity <= 0) {
    throw new Error("bag quantity must be greater than 0.")
  }

  return {
    itemId: normalizedItemId,
    ownerId: normalizedOwnerId,
    quantity: normalizedQuantity
  }
}

function createRuntimeBagReadableFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  const itemIds = getBundleItemIds(bundle)
  const getReadArgs = (ownerId: unknown, itemId: unknown) => {
    const normalizedOwnerId = normalizeOwnerId(ownerId)
    const normalizedItemId = normalizeItemId(itemId)

    if (!normalizedOwnerId || !normalizedItemId) {
      return null
    }

    if (!itemIds.has(normalizedItemId)) {
      throw new Error(`bag item "${normalizedItemId}" does not exist in runtime item library.`)
    }

    return {
      itemId: normalizedItemId,
      ownerId: normalizedOwnerId
    }
  }

  return {
    bag_count(ownerId: unknown, itemId: unknown) {
      const args = getReadArgs(ownerId, itemId)
      return args ? (findBagEntry(snapshot, args.ownerId, args.itemId)?.quantity ?? 0) : 0
    },
    bag_has(ownerId: unknown, itemId: unknown, quantity?: unknown) {
      const normalizedQuantity = normalizeBagQuantity(quantity, 1)

      if (normalizedQuantity <= 0) {
        return true
      }

      const args = getReadArgs(ownerId, itemId)
      return args
        ? (findBagEntry(snapshot, args.ownerId, args.itemId)?.quantity ?? 0) >= normalizedQuantity
        : false
    }
  }
}

function createRuntimeBagScriptFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  const itemIds = getBundleItemIds(bundle)
  const readableFunctions = createRuntimeBagReadableFunctions(bundle, snapshot)

  return {
    bag_add(ownerId: unknown, itemId: unknown, quantity?: unknown) {
      const args = assertRuntimeBagArgs(ownerId, itemId, quantity)
      const existingEntry = getBagEntry(snapshot, args.ownerId, args.itemId)

      if (!itemIds.has(args.itemId)) {
        throw new Error(`bag item "${args.itemId}" does not exist in runtime item library.`)
      }

      if (existingEntry) {
        existingEntry.quantity += args.quantity
        return existingEntry.quantity
      }

      const timestamp = getCurrentRuntimeBagTimestamp(snapshot)
      getBag(snapshot, args.ownerId).entries.push({
        item_id: args.itemId,
        quantity: args.quantity,
        bound: false,
        obtained_at_day: timestamp.day,
        obtained_at_minute: timestamp.minute,
        meta: {}
      })

      return args.quantity
    },
    ...readableFunctions,
    bag_remove(ownerId: unknown, itemId: unknown, quantity?: unknown) {
      const args = assertRuntimeBagArgs(ownerId, itemId, quantity)
      const bag = getBag(snapshot, args.ownerId)
      const entry = bag.entries.find((item) => item.item_id === args.itemId)

      if (!entry || entry.quantity < args.quantity) {
        return false
      }

      entry.quantity -= args.quantity
      if (entry.quantity <= 0) {
        bag.entries = bag.entries.filter((item) => item.item_id !== args.itemId)
      }

      return true
    }
  }
}

function createRuntimePhoneReadableFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  return {
    phone_has_contact(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      return Boolean(getPhoneContact(snapshot, normalizedRoleKey))
    },
    phone_favor(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      return getPhoneContact(snapshot, normalizedRoleKey)?.favor ?? 0
    },
    phone_unread_count(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      return getPhoneUnreadCount(snapshot, normalizedRoleKey)
    }
  }
}

function createRuntimePhoneScriptFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  notifications: string[]
) {
  const readableFunctions = createRuntimePhoneReadableFunctions(bundle, snapshot)

  return {
    phone_add_contact(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      const existed = Boolean(getPhoneContact(snapshot, normalizedRoleKey))
      ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
      if (!existed) {
        notifications.push(`手机已新增联系人：${findRoleLabel(bundle, normalizedRoleKey)}`)
      }
      return true
    },
    phone_remove_contact(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      normalizePhoneState(snapshot)
      const nextContacts = snapshot.phone.contacts.filter((contact) => contact.role_key !== normalizedRoleKey)
      const nextThreads = snapshot.phone.threads.filter((thread) => thread.role_key !== normalizedRoleKey)
      const removed = nextContacts.length !== snapshot.phone.contacts.length
      snapshot.phone.contacts = nextContacts
      snapshot.phone.threads = nextThreads
      return removed
    },
    phone_set_favor(roleKey: unknown, favor: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      const contact = ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
      contact.favor = clampPhoneFavor(favor, contact.favor)
      return contact.favor
    },
    phone_add_favor(roleKey: unknown, delta: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      const contact = ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
      const normalizedDelta = typeof delta === "number" && Number.isFinite(delta)
        ? Math.trunc(delta)
        : 0
      contact.favor = clampPhoneFavor(contact.favor + normalizedDelta, contact.favor)
      return contact.favor
    },
    phone_send_from_contact(roleKey: unknown, content: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      const normalizedContent = normalizeText(content)
      if (!normalizedContent) {
        throw new Error("phone message content is required.")
      }
      sendPhoneMessageFromContact(bundle, snapshot, notifications, normalizedRoleKey, normalizedContent)
      return normalizedContent
    },
    phone_send_to_contact(roleKey: unknown, content: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      const normalizedContent = normalizeText(content)
      if (!normalizedContent) {
        throw new Error("phone message content is required.")
      }
      sendPhoneMessageToContact(bundle, snapshot, normalizedRoleKey, normalizedContent)
      return normalizedContent
    },
    phone_mark_read(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
      return markPhoneThreadRead(snapshot, normalizedRoleKey)
    },
    ...readableFunctions
  }
}

function buildRuntimeScriptContext(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  notifications: string[],
  branchValues: Record<string, unknown>,
  callValues: Record<string, unknown> = {}
) {
  const combinedValues: Record<string, unknown> = {}
  const assignableValues: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(branchValues)) {
    combinedValues[`branch.${key}`] = cloneValue(value)
    assignableValues[`branch.${key}`] = cloneValue(value)
  }

  for (const [key, value] of Object.entries(callValues)) {
    combinedValues[`call.${key}`] = cloneValue(value)
  }

  return {
    values: combinedValues,
    assignableValues,
    functions: {
      ...createRuntimeBagScriptFunctions(bundle, snapshot),
      ...createRuntimePhoneScriptFunctions(bundle, snapshot, notifications)
    }
  } satisfies StoryScriptExecutionContext
}

function initializeActionValues(action: CompiledAction) {
  const branchValues: Record<string, unknown> = {}

  for (const actionVar of action.vars ?? []) {
    const name = normalizeText(actionVar.name)
    if (!name) {
      continue
    }

    branchValues[name] = actionVar.initial_value
  }

  return branchValues
}

function appendHistory(
  snapshot: RuntimeStorySessionSnapshot,
  entry: Omit<RuntimeHistoryEntry, "timestamp">
) {
  snapshot.history.push({
    ...entry,
    timestamp: new Date().toISOString()
  })
}

function executeEventScript(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  script: string,
  branchValues: Record<string, unknown>,
  callValues: Record<string, unknown> = {}
) {
  const trimmedScript = normalizeText(script)
  if (!trimmedScript) {
    return branchValues
  }

  const executionContext = buildRuntimeScriptContext(
    bundle,
    runtimeState.snapshot,
    notifications,
    branchValues,
    callValues
  )
  const combinedValsFile = createCombinedValsFile(runtimeState.snapshot)
  const result = executeStoryScript(
    combinedValsFile,
    trimmedScript,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    executionContext
  )

  applyCombinedValsFile(runtimeState.snapshot, result.vals)
  enqueueStoryScriptInvocations(bundle, runtimeState, result.invocations)

  const nextBranchValues: Record<string, unknown> = {}
  for (const [token, value] of Object.entries(result.externalValues)) {
    if (!token.startsWith("branch.")) {
      continue
    }

    nextBranchValues[token.slice("branch.".length)] = cloneValue(value)
  }

  return nextBranchValues
}

function findBundleOnceEvent(
  bundle: RuntimeStoryBundle,
  eventId: string
) {
  return getBundleOnceEvents(bundle).find((item) => item.id === eventId) ?? null
}

function findBundleLoopEvent(
  bundle: RuntimeStoryBundle,
  eventId: string
) {
  return getBundleScheduleEvents(bundle).find((item) => item.id === eventId) ?? null
}

function findBundleInvokeTargetEvent(
  bundle: RuntimeStoryBundle,
  targetType: StoryInvokeTargetType,
  eventId: string
) {
  const normalizedTargetType = normalizeInvokeTargetType(targetType)

  if (normalizedTargetType === "pool") {
    return findBundleOnceEvent(bundle, eventId)
  }

  if (normalizedTargetType === "schedule") {
    return findBundleLoopEvent(bundle, eventId)
  }

  const graphNode = getBundleGraphNode(bundle, eventId)
  return isCompiledEvent(graphNode) ? graphNode : null
}

function getInvokeTargetLabel(targetType: StoryInvokeTargetType) {
  const normalizedTargetType = normalizeInvokeTargetType(targetType)

  if (normalizedTargetType === "pool") {
    return "平面事件池事件"
  }

  if (normalizedTargetType === "schedule") {
    return "定时规则事件"
  }

  return "链式剧情线事件"
}

function getInvokeDelayUnitLabel(unit: StoryScriptInvokeDelay["unit"]) {
  switch (unit) {
    case "hours":
      return "小时"
    case "days":
      return "天"
    case "months":
      return "个月"
    case "years":
      return "年"
    default:
      return ""
  }
}

function formatInvokeDelayAuditLabel(delay: StoryScriptInvokeDelay | undefined) {
  if (!delay || delay.value <= 0) {
    return "立即"
  }

  return `${delay.value}${getInvokeDelayUnitLabel(delay.unit)}后`
}

function buildInvokeAuditMessage(
  targetType: StoryInvokeTargetType,
  eventId: string,
  args: Record<string, unknown>,
  mode: "ready" | "scheduled" | "promoted",
  delay?: StoryScriptInvokeDelay
) {
  const normalizedTargetType = normalizeInvokeTargetType(targetType) ?? "chain"
  const targetLabel = `${normalizedTargetType}.${normalizeText(eventId)}`
  const argKeys = Object.keys(args).filter(Boolean)
  const argsLabel = argKeys.length > 0 ? `，参数: ${argKeys.join(", ")}` : ""

  if (mode === "scheduled") {
    return `invoke 延迟入队: ${targetLabel}，${formatInvokeDelayAuditLabel(delay)}${argsLabel}`
  }

  if (mode === "promoted") {
    return `invoke 到时转入就绪队列: ${targetLabel}${argsLabel}`
  }

  return `invoke 进入就绪队列: ${targetLabel}${argsLabel}`
}

function validateInvokeArgs(
  targetType: StoryInvokeTargetType,
  event: ReturnType<typeof findBundleInvokeTargetEvent>,
  args: Record<string, unknown>
) {
  const targetLabel = getInvokeTargetLabel(targetType)

  if (!event) {
    return {
      ok: false,
      message: `目标${targetLabel}不存在。`
    }
  }

  if (normalizeRuntimeEventTriggerMode(event.trigger_mode) !== "invoke") {
    return {
      ok: false,
      message: `${targetLabel} "${event.id}" 不是“被调用”触发方式。`
    }
  }

  const requiredParamNames = (event.invoke_params ?? [])
    .map((item) => normalizeText(item.name).trim())
    .filter(Boolean)

  for (const paramName of requiredParamNames) {
    if (!Object.prototype.hasOwnProperty.call(args, paramName)) {
      return {
        ok: false,
        message: `调用${targetLabel} "${event.id}" 时缺少参数 "${paramName}"。`
      }
    }
  }

  return {
    ok: true,
    message: ""
  }
}

function queueInvokeEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  targetType: StoryInvokeTargetType,
  eventId: string,
  args: Record<string, unknown>,
  delay?: StoryScriptInvokeDelay
) {
  const normalizedEventId = normalizeText(eventId)
  if (!normalizedEventId) {
    return false
  }

  const normalizedTargetType = normalizeInvokeTargetType(targetType)
  if (!normalizedTargetType) {
    return false
  }

  const targetEvent = findBundleInvokeTargetEvent(bundle, normalizedTargetType, normalizedEventId)
  const normalizedArgs = cloneValue(args)
  const validation = validateInvokeArgs(normalizedTargetType, targetEvent, normalizedArgs)
  if (!validation.ok || !targetEvent) {
    return false
  }

  const nextSeq = runtimeState.snapshot.scheduler.next_seq
  const dedupeKey = `invoke:${normalizedTargetType}:${targetEvent.id}:${nextSeq}`
  const dueGameMinute = delay
    ? resolveInvokeDelayDueGameMinute(runtimeState.snapshot, delay)
    : getCurrentGameMinute(runtimeState.snapshot)
  const scheduledEvent = createScheduledEvent(
    runtimeState.snapshot,
    "invoke",
    `${normalizedTargetType}:${targetEvent.id}`,
    targetEvent.id,
    dueGameMinute,
    dedupeKey,
    true,
    normalizedArgs,
    normalizedTargetType
  )

  if (delay && dueGameMinute > getCurrentGameMinute(runtimeState.snapshot)) {
    return enqueueScheduledEvent(
      runtimeState.snapshot,
      scheduledEvent,
      buildInvokeAuditMessage(
        normalizedTargetType,
        targetEvent.id,
        normalizedArgs,
        "scheduled",
        delay
      )
    )
  }

  return enqueueReadyEvent(
    runtimeState.snapshot,
    scheduledEvent,
    buildInvokeAuditMessage(
      normalizedTargetType,
      targetEvent.id,
      normalizedArgs,
      "ready",
      delay
    )
  )
}

function enqueueStoryScriptInvocations(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  invocations: StoryScriptInvocation[]
) {
  for (const invocation of invocations) {
    queueInvokeEvent(
      bundle,
      runtimeState,
      invocation.targetType,
      invocation.eventId,
      invocation.args,
      invocation.delay
    )
  }
}

function renderDialogueContent(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  content: string,
  branchValues: Record<string, unknown>,
  callValues: Record<string, unknown> = {}
) {
  const combinedValsFile = createCombinedValsFile(snapshot)
  return renderStoryTextTemplate(
    combinedValsFile,
    content,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    buildRuntimeContextValues(bundle, snapshot, branchValues, callValues)
  )
}

function getPresentationDialogues(presentation: RuntimeStoryPresentation) {
  return presentation.type === "dialogue" ? presentation.dialogues : []
}

function getMessageDurationMs(presentation: RuntimeStoryMessagePresentation) {
  const durationSeconds = Number.isFinite(presentation.message.duration_seconds)
    ? Math.max(0, presentation.message.duration_seconds)
    : 0
  return durationSeconds * 1000
}

function buildMessageView(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  presentation: RuntimeStoryMessagePresentation,
  elapsedMs: number,
  branchValues: Record<string, unknown>,
  callValues: Record<string, unknown> = {}
): RuntimeRenderedMessage | null {
  const durationMs = getMessageDurationMs(presentation)
  if (durationMs <= 0 || elapsedMs >= durationMs) {
    return null
  }

  const elapsedSeconds = Math.max(0, elapsedMs) / 1000
  const durationSeconds = durationMs / 1000
  return {
    content: renderDialogueContent(
      bundle,
      snapshot,
      presentation.message.content,
      branchValues,
      callValues
    ),
    durationSeconds,
    elapsedSeconds,
    remainingSeconds: Math.max(0, durationSeconds - elapsedSeconds)
  }
}

function buildDialogueView(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  dialogue: RuntimeStoryDialogueDefinition,
  index: number,
  total: number,
  branchValues: Record<string, unknown>,
  callValues: Record<string, unknown> = {}
): RuntimeRenderedDialogue {
  const speakerLabel = dialogue.speaker_type === "player"
    ? "主角"
    : findRoleLabel(bundle, dialogue.speaker_key)

  return {
    index: index + 1,
    total,
    speakerLabel,
    speakerKey: dialogue.speaker_key,
    content: renderDialogueContent(bundle, snapshot, dialogue.content, branchValues, callValues)
  }
}

function resolveEventActions(
  bundle: RuntimeStoryBundle,
  event: RuntimePlayableEvent
) {
  if (isRuntimeStandaloneEvent(event)) {
    return {
      actions: [],
      autoNextEventIds: []
    }
  }

  const eventNext = Array.isArray(event.next) ? event.next : []
  const actions: RuntimeActionState[] = []
  const autoNextEventIds: string[] = []

  for (const nextNodeId of eventNext) {
    const nextNode = getBundleGraphNode(bundle, nextNodeId)
    if (isCompiledAction(nextNode)) {
      actions.push({
        nodeId: nextNode.id,
        branchValues: initializeActionValues(nextNode)
      })
      continue
    }

    if (isCompiledEvent(nextNode)) {
      autoNextEventIds.push(nextNode.id)
    }
  }

  return {
    actions,
    autoNextEventIds
  }
}

function pickFirstEnterableNextEventId(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  candidateEventIds: string[],
  branchValues: Record<string, unknown>,
  callValues: Record<string, unknown> = {}
) {
  for (const candidateEventId of candidateEventIds) {
    const candidateNode = getBundleGraphNode(bundle, candidateEventId)
    if (!isCompiledEvent(candidateNode)) {
      continue
    }

    if (canEnterEvent(bundle, snapshot, candidateNode, branchValues, callValues)) {
      return candidateNode.id
    }
  }

  return null
}

function completeScheduledChain(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  completedEventTitle?: string | null
) {
  // 链路真正结束时，统一释放 active 并继续拉起后续排队事件。
  clearCurrentEventState(runtimeState)
  completeActiveScheduledEvent(runtimeState.snapshot)
  if (completedEventTitle) {
    notifications.push(`事件 "${completedEventTitle}" 已结束。`)
  }
  reconcileScheduler(bundle, runtimeState, notifications)
}

function canEnterEvent(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  event: RuntimePlayableEvent,
  branchValues: Record<string, unknown>,
  callValues?: Record<string, unknown>
) {
  const triggerMode = normalizeRuntimeEventTriggerMode(event.trigger_mode)
  if (triggerMode === "default") {
    return true
  }

  if (triggerMode === "invoke") {
    return false
  }

  const triggerExpr = normalizeText(event.trigger_expr)
  if (!triggerExpr) {
    return false
  }

  const combinedValsFile = createCombinedValsFile(snapshot)
  const triggerResult = evaluateStoryBooleanExpression(
    combinedValsFile,
    triggerExpr,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    buildRuntimeContextValues(bundle, snapshot, branchValues, callValues ?? getRuntimeEventCallValues(event))
  )

  return triggerResult.result
}

function moveToEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  targetEventId: string | null,
  branchValues: Record<string, unknown>
) {
  return moveToEventResolved(bundle, runtimeState, targetEventId, branchValues)
  /*
  if (!targetEventId) {
    clearCurrentEventState(runtimeState)
    return false
  }

  const targetNode = getBundleGraphNode(bundle, targetEventId)
  if (!isCompiledEvent(targetNode)) {
    throw new Error(`Target node "${targetEventId}" is not an event node.`)
  }

  if (!canEnterEvent(runtimeState.snapshot, targetNode, branchValues)) {
    appendSchedulerAudit(runtimeState.snapshot, {
      kind: "skip-event",
      source_type: runtimeState.snapshot.scheduler.active?.source_type,
      source_id: runtimeState.snapshot.scheduler.active?.source_id ?? targetNode.id,
      entry_event_id: targetNode.id,
      due_game_minute: runtimeState.snapshot.scheduler.active?.due_game_minute ?? getCurrentGameMinute(runtimeState.snapshot),
      message: "后续事件触发条件不满足，跳过节点"
    })
    appendHistory(runtimeState.snapshot, {
      type: "system",
      id: "skip-event",
      title: targetNode.id,
      content: `skip ${targetNode.id}`
    })
    clearCurrentEventState(runtimeState)
    return false
  }

  runtimeState.snapshot.current_event_id = targetNode.id
  runtimeState.activeStandaloneEvent = null
  runtimeState.currentEventEntered = false
  runtimeState.currentDialogueIndex = 0
  runtimeState.pendingActions = []
  runtimeState.lastAction = branchValues && Object.keys(branchValues).length > 0
    ? {
        nodeId: targetNode.id,
        branchValues: cloneValue(branchValues)
      }
    : null
  return true
  */
}

function settlePassiveEvents(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  for (let step = 0; step < 64; step += 1) {
    const currentEventState = getCurrentEventState(bundle, runtimeState)
    if (!currentEventState) {
      if (runtimeState.snapshot.scheduler.active && !runtimeState.snapshot.current_event_id) {
        completeScheduledChain(bundle, runtimeState, notifications)
      }
      return
    }

    if (currentEventState.currentDialogue || currentEventState.availableActions.length > 0) {
      return
    }

    if (currentEventState.currentMessage) {
      return
    }

    finishCurrentEvent(bundle, runtimeState, notifications)
  }

  notifications.push("自动推进的空事件链过长，已停止继续自动推进。")
}

function advanceCurrentMessagePresentation(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  deltaMs: number
) {
  const normalizedDeltaMs = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0
  if (normalizedDeltaMs <= 0) {
    return false
  }

  const currentEventState = getCurrentEventState(bundle, runtimeState)
  if (!currentEventState?.currentMessage) {
    return false
  }

  runtimeState.currentMessageElapsedMs += normalizedDeltaMs
  const nextEventState = getCurrentEventState(bundle, runtimeState)
  if (!nextEventState?.currentMessage) {
    finishCurrentEvent(bundle, runtimeState, notifications)
    settlePassiveEvents(bundle, runtimeState, notifications)
  }

  return true
}

function completeActiveScheduledEvent(snapshot: RuntimeStorySessionSnapshot) {
  normalizeSchedulerState(snapshot)
  const activeScheduledEvent = snapshot.scheduler.active
  if (!activeScheduledEvent) {
    snapshot.scheduler.event_pause = false
    return null
  }

  appendSchedulerAudit(snapshot, {
    kind: "complete-event",
    source_type: activeScheduledEvent.source_type,
    source_id: activeScheduledEvent.source_id,
    entry_event_id: activeScheduledEvent.entry_event_id,
    due_game_minute: activeScheduledEvent.due_game_minute,
    message: "事件执行完成"
  })

  if (activeScheduledEvent.source_type === "chain_root") {
    if (!snapshot.scheduler.consumed_graph_root_ids.includes(activeScheduledEvent.source_id)) {
      snapshot.scheduler.consumed_graph_root_ids.push(activeScheduledEvent.source_id)
    }
  }

  if (activeScheduledEvent.source_type === "pool") {
    if (!snapshot.scheduler.consumed_once_ids.includes(activeScheduledEvent.source_id)) {
      snapshot.scheduler.consumed_once_ids.push(activeScheduledEvent.source_id)
    }

    if (!snapshot.triggered_once_events.some((item) => item.event_id === activeScheduledEvent.source_id)) {
      snapshot.triggered_once_events.push({
        event_id: activeScheduledEvent.source_id,
        triggered_at: new Date().toISOString()
      })
    }
  }

  if (activeScheduledEvent.source_type === "schedule") {
    const loopState = getLoopSchedulerState(snapshot, activeScheduledEvent.source_id)
    const lastTriggeredGameMinute = activeScheduledEvent.due_game_minute
    const lastTriggeredGameDay = getGameDayFromGameMinute(snapshot, lastTriggeredGameMinute)
    loopState.last_triggered_game_minute = lastTriggeredGameMinute
    loopState.trigger_count += 1
    loopState.next_due_game_minute = null

    const loopEvent = activeScheduledEvent.source_id
    const matchedLoopEvent = (snapshot.loop_event_states ?? []).find((item) => item.event_id === loopEvent)
    if (matchedLoopEvent) {
      matchedLoopEvent.last_triggered_day = lastTriggeredGameDay
      matchedLoopEvent.last_triggered_at = new Date().toISOString()
      matchedLoopEvent.trigger_count = loopState.trigger_count
    } else {
      snapshot.loop_event_states.push({
        event_id: loopEvent,
        last_triggered_day: lastTriggeredGameDay,
        last_triggered_at: new Date().toISOString(),
        trigger_count: loopState.trigger_count
      })
    }
  }

  snapshot.scheduler.active = null
  snapshot.scheduler.event_pause = false
  return activeScheduledEvent
}

function enterCurrentEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  return enterCurrentEventResolved(bundle, runtimeState, notifications)
  /*
  const currentNode = getCurrentPlayableEvent(bundle, runtimeState)
  if (!currentNode || runtimeState.currentEventEntered) {
    return
  }

  const branchValues = runtimeState.lastAction?.branchValues ?? {}

  if (!canEnterEvent(runtimeState.snapshot, currentNode, branchValues)) {
    appendSchedulerAudit(runtimeState.snapshot, {
      kind: "skip-event",
      source_type: runtimeState.snapshot.scheduler.active?.source_type,
      source_id: runtimeState.snapshot.scheduler.active?.source_id ?? currentNode.id,
      entry_event_id: currentNode.id,
      due_game_minute: runtimeState.snapshot.scheduler.active?.due_game_minute ?? getCurrentGameMinute(runtimeState.snapshot),
      message: "触发条件不满足，跳过事件"
    })
    notifications.push(`事件 "${currentNode.title}" 未满足触发条件，已跳过。`)
    appendHistory(runtimeState.snapshot, {
      type: "system",
      id: "skip-event",
      title: currentNode.id,
      content: `skip ${currentNode.id}`
    })
    clearCurrentEventState(runtimeState)
    completeActiveScheduledEvent(runtimeState.snapshot)
    reconcileScheduler(bundle, runtimeState, notifications)
    return
  }

  const nextBranchValues = executeEventScript(
    runtimeState,
    currentNode.init_script,
    branchValues
  )

  appendHistory(runtimeState.snapshot, {
    type: "event",
    id: currentNode.id,
    title: currentNode.title
  })

  runtimeState.currentEventEntered = true
  runtimeState.currentDialogueIndex = 0
  runtimeState.lastAction = {
    nodeId: currentNode.id,
    branchValues: nextBranchValues
  }

  const actionResolution = resolveEventActions(bundle, currentNode)
  runtimeState.pendingActions = actionResolution.actions
  */
}

function promoteDueScheduledEventsResolved(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  normalizeSchedulerState(snapshot)
  if (snapshot.scheduler.scheduled.length === 0) {
    return
  }

  const nowGameMinute = getCurrentGameMinute(snapshot)
  const dueScheduledEvents: RuntimeScheduledEvent[] = []
  const remainingScheduledEvents: RuntimeScheduledEvent[] = []

  for (const scheduledEvent of snapshot.scheduler.scheduled) {
    if (scheduledEvent.due_game_minute <= nowGameMinute) {
      dueScheduledEvents.push({
        ...cloneValue(scheduledEvent),
        status: "ready"
      })
      continue
    }

    remainingScheduledEvents.push(scheduledEvent)
  }

  snapshot.scheduler.scheduled = remainingScheduledEvents

  for (const scheduledEvent of dueScheduledEvents) {
    if (scheduledEvent.source_type === "schedule") {
      const loopEvent = getBundleScheduleEvents(bundle).find(
        (item) => item.id === scheduledEvent.source_id
      )

      if (!loopEvent) {
        continue
      }

      const standaloneLoopEvent = createStandaloneEvent("schedule", loopEvent)
      // 循环事件在到点时才判断触发条件，不满足则跳过本周期并重排下次时间。
      if (!canEnterEvent(bundle, snapshot, standaloneLoopEvent, {})) {
        const loopState = getLoopSchedulerState(snapshot, loopEvent.id)
        loopState.next_due_game_minute = calculateNextLoopDueGameMinute(
          snapshot,
          loopEvent,
          scheduledEvent.due_game_minute
        )
        appendSchedulerAudit(snapshot, {
          kind: "skip-event",
          source_type: "schedule",
          source_id: loopEvent.id,
          entry_event_id: loopEvent.id,
          due_game_minute: scheduledEvent.due_game_minute,
          message: "循环事件到点但未满足触发条件，已跳过当前周期"
        })
        appendSchedulerAudit(snapshot, {
          kind: "loop-reschedule",
          source_type: "schedule",
          source_id: loopEvent.id,
          entry_event_id: loopEvent.id,
          due_game_minute: loopState.next_due_game_minute,
          message: "循环事件跳过当前周期后已重排下次触发时间"
        })
        continue
      }
    }

    appendSchedulerAudit(snapshot, {
      kind: "promote-due",
      source_type: scheduledEvent.source_type,
      source_id: scheduledEvent.source_id,
      entry_event_id: scheduledEvent.entry_event_id,
      due_game_minute: scheduledEvent.due_game_minute,
      message: scheduledEvent.source_type === "invoke"
        ? buildInvokeAuditMessage(
            scheduledEvent.invoke_target_type ?? "chain",
            scheduledEvent.entry_event_id,
            scheduledEvent.call_values ?? {},
            "promoted"
          )
        : "到时转入就绪队列"
    })
    enqueueReadyEvent(snapshot, {
      ...scheduledEvent,
      trigger_locked: true
    })
  }
}

function moveToEventResolved(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  targetEventId: string | null,
  branchValues: Record<string, unknown>,
  options: RuntimeEnterEventOptions = {}
) {
  if (!targetEventId) {
    clearCurrentEventState(runtimeState)
    return false
  }

  const targetNode = getBundleGraphNode(bundle, targetEventId)
  if (!isCompiledEvent(targetNode)) {
    throw new Error(`Target node "${targetEventId}" is not an event node.`)
  }

  if (
    !options.skipTriggerCheck
    && !canEnterEvent(bundle, runtimeState.snapshot, targetNode, branchValues, getRuntimeActiveCallValues(runtimeState))
  ) {
    appendSchedulerAudit(runtimeState.snapshot, {
      kind: "skip-event",
      source_type: runtimeState.snapshot.scheduler.active?.source_type,
      source_id: runtimeState.snapshot.scheduler.active?.source_id ?? targetNode.id,
      entry_event_id: targetNode.id,
      due_game_minute: runtimeState.snapshot.scheduler.active?.due_game_minute ?? getCurrentGameMinute(runtimeState.snapshot),
      message: "后续事件触发条件不满足，跳过节点"
    })
    appendHistory(runtimeState.snapshot, {
      type: "system",
      id: "skip-event",
      title: targetNode.id,
      content: `skip ${targetNode.id}`
    })
    clearCurrentEventState(runtimeState)
    return false
  }

  runtimeState.snapshot.current_event_id = targetNode.id
  runtimeState.activeStandaloneEvent = null
  runtimeState.currentEventEntered = false
  runtimeState.currentDialogueIndex = 0
  runtimeState.currentMessageElapsedMs = 0
  runtimeState.pendingActions = []
  runtimeState.lastAction = branchValues && Object.keys(branchValues).length > 0
    ? {
        nodeId: targetNode.id,
        branchValues: cloneValue(branchValues)
      }
    : null
  return true
}

function enterCurrentEventResolved(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  options: RuntimeEnterEventOptions = {}
) {
  const currentNode = getCurrentPlayableEvent(bundle, runtimeState)
  if (!currentNode || runtimeState.currentEventEntered) {
    return
  }

  const branchValues = runtimeState.lastAction?.branchValues ?? {}
  const callValues = getRuntimePlayableEventCallValues(runtimeState, currentNode)

  if (!options.skipTriggerCheck && !canEnterEvent(bundle, runtimeState.snapshot, currentNode, branchValues, callValues)) {
    appendSchedulerAudit(runtimeState.snapshot, {
      kind: "skip-event",
      source_type: runtimeState.snapshot.scheduler.active?.source_type,
      source_id: runtimeState.snapshot.scheduler.active?.source_id ?? currentNode.id,
      entry_event_id: currentNode.id,
      due_game_minute: runtimeState.snapshot.scheduler.active?.due_game_minute ?? getCurrentGameMinute(runtimeState.snapshot),
      message: "触发条件不满足，跳过事件"
    })
    notifications.push(`事件 "${currentNode.title}" 未满足触发条件，已跳过。`)
    appendHistory(runtimeState.snapshot, {
      type: "system",
      id: "skip-event",
      title: currentNode.id,
      content: `skip ${currentNode.id}`
    })
    clearCurrentEventState(runtimeState)
    completeActiveScheduledEvent(runtimeState.snapshot)
    reconcileScheduler(bundle, runtimeState, notifications)
    return
  }

  const nextBranchValues = executeEventScript(
    bundle,
    runtimeState,
    notifications,
    currentNode.init_script,
    branchValues,
    callValues
  )

  autoRegisterPhoneContactsFromEvent(bundle, runtimeState.snapshot, currentNode, notifications)

  appendHistory(runtimeState.snapshot, {
    type: "event",
    id: currentNode.id,
    title: currentNode.title
  })

  runtimeState.currentEventEntered = true
  runtimeState.currentDialogueIndex = 0
  runtimeState.currentMessageElapsedMs = 0
  runtimeState.lastAction = {
    nodeId: currentNode.id,
    branchValues: nextBranchValues
  }

  const actionResolution = resolveEventActions(bundle, currentNode)
  runtimeState.pendingActions = actionResolution.actions
}

function finishCurrentEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  const currentNode = getCurrentPlayableEvent(bundle, runtimeState)
  if (!currentNode) {
    return
  }

  const branchValues = runtimeState.lastAction?.branchValues ?? {}
  const callValues = getRuntimePlayableEventCallValues(runtimeState, currentNode)
  const nextBranchValues = executeEventScript(
    bundle,
    runtimeState,
    notifications,
    currentNode.end_script,
    branchValues,
    callValues
  )
  const actionResolution = resolveEventActions(bundle, currentNode)

  if (actionResolution.actions.length > 0) {
    runtimeState.pendingActions = actionResolution.actions
    runtimeState.currentMessageElapsedMs = 0
    runtimeState.lastAction = {
      nodeId: currentNode.id,
      branchValues: nextBranchValues
    }
    return
  }

  const nextEventId = pickFirstEnterableNextEventId(
    bundle,
    runtimeState.snapshot,
    actionResolution.autoNextEventIds,
    nextBranchValues,
    callValues
  )
  if (nextEventId) {
    moveToEvent(bundle, runtimeState, nextEventId, nextBranchValues)
    enterCurrentEvent(bundle, runtimeState, notifications)
    settlePassiveEvents(bundle, runtimeState, notifications)
    return
  }

  completeScheduledChain(bundle, runtimeState, notifications, currentNode.title)
}

function executeAction(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  optionId: string,
  notifications: string[]
) {
  const sourceEvent = getCurrentPlayableEvent(bundle, runtimeState)
  const targetActionState = runtimeState.pendingActions.find((item) => item.nodeId === optionId)
  if (!targetActionState) {
    notifications.push(`未找到操作分支：${optionId}`)
    return
  }

  const actionNode = getBundleGraphNode(bundle, targetActionState.nodeId)
  if (!isCompiledAction(actionNode)) {
    notifications.push(`节点 "${optionId}" 不是操作节点。`)
    return
  }

  const executionContext = buildRuntimeScriptContext(
    bundle,
    runtimeState.snapshot,
    notifications,
    targetActionState.branchValues,
    getRuntimePlayableEventCallValues(runtimeState, sourceEvent)
  )
  const combinedValsFile = createCombinedValsFile(runtimeState.snapshot)
  const scriptResult = executeStoryScript(
    combinedValsFile,
    actionNode.exec_script,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    executionContext
  )

  applyCombinedValsFile(runtimeState.snapshot, scriptResult.vals)
  enqueueStoryScriptInvocations(bundle, runtimeState, scriptResult.invocations)

  const nextBranchValues: Record<string, unknown> = {}
  for (const [token, value] of Object.entries(scriptResult.externalValues)) {
    if (!token.startsWith("branch.")) {
      continue
    }

    nextBranchValues[token.slice("branch.".length)] = cloneValue(value)
  }

  appendHistory(runtimeState.snapshot, {
    type: "action",
    id: actionNode.id,
    title: actionNode.title
  })

  runtimeState.pendingActions = []
  runtimeState.lastAction = {
    nodeId: actionNode.id,
    branchValues: nextBranchValues
  }

  const nextEventId = actionNode.next[0] ?? null
  const moved = moveToEvent(bundle, runtimeState, nextEventId, nextBranchValues)
  if (!moved) {
    completeScheduledChain(bundle, runtimeState, notifications, sourceEvent?.title ?? null)
    return
  }
  enterCurrentEvent(bundle, runtimeState, notifications)
  settlePassiveEvents(bundle, runtimeState, notifications)
}

function getCurrentEventState(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState
): RuntimeDialogueNodeState | null {
  const currentNode = getCurrentPlayableEvent(bundle, runtimeState)
  if (!currentNode || !runtimeState.currentEventEntered) {
    return null
  }

  const branchValues = runtimeState.lastAction?.branchValues ?? {}
  const callValues = getRuntimePlayableEventCallValues(runtimeState, currentNode)
  const presentation = currentNode.presentation
  const currentMessage = presentation.type === "message"
    ? buildMessageView(
        bundle,
        runtimeState.snapshot,
        presentation,
        runtimeState.currentMessageElapsedMs,
        branchValues,
        callValues
      )
    : null
  const dialogues = getPresentationDialogues(presentation)
  const currentDialogue = presentation.type === "dialogue"
    && dialogues.length > 0
    && runtimeState.currentDialogueIndex < dialogues.length
    ? buildDialogueView(
        bundle,
        runtimeState.snapshot,
        dialogues[runtimeState.currentDialogueIndex]!,
        runtimeState.currentDialogueIndex,
        dialogues.length,
        branchValues,
        callValues
      )
    : null

  const actionResolution = resolveEventActions(bundle, currentNode)
  const availableActions = runtimeState.pendingActions.length > 0
    ? runtimeState.pendingActions
    : actionResolution.actions

  return {
    node: currentNode,
    currentMessage,
    currentDialogue,
    availableActions,
    autoNextEventIds: actionResolution.autoNextEventIds,
    locationName: findLocationLabel(bundle, currentNode.location)
  }
}

function buildRuntimeBagSummary(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
): RuntimeBagSummary[] {
  normalizeBagsState(snapshot)

  const itemNames = getBundleItemNameMap(bundle)

  return Object.entries(snapshot.bags)
    .map(([ownerId, bag]) => {
      const normalizedOwnerId = normalizeOwnerId(ownerId)
      const entries = bag.entries
        .filter((entry) => entry.quantity > 0)
        .map((entry) => {
          const itemId = normalizeItemId(entry.item_id)
          return {
            ownerId: normalizedOwnerId,
            itemId,
            itemName: itemNames.get(itemId) ?? itemId,
            quantity: entry.quantity,
            bound: entry.bound,
            obtainedAtDay: entry.obtained_at_day,
            obtainedAtMinute: entry.obtained_at_minute
          } satisfies RuntimeBagItemView
        })
        .filter((entry) => entry.itemId)
        .sort((left, right) => {
          const nameCompare = left.itemName.localeCompare(right.itemName, "zh-Hans-CN")
          return nameCompare !== 0 ? nameCompare : left.itemId.localeCompare(right.itemId)
        })

      return {
        ownerId: normalizedOwnerId,
        itemCount: entries.length,
        totalQuantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
        entries
      } satisfies RuntimeBagSummary
    })
    .filter((bag) => bag.ownerId)
    .sort((left, right) => {
      if (left.ownerId === "player") {
        return right.ownerId === "player" ? 0 : -1
      }

      if (right.ownerId === "player") {
        return 1
      }

      return left.ownerId.localeCompare(right.ownerId)
    })
}

export function buildRuntimePhoneContacts(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
): RuntimePhoneContactView[] {
  normalizePhoneState(snapshot)

  return snapshot.phone.contacts
    .map((contact) => {
      const latest = getLatestPhoneMessagePreview(snapshot, contact.role_key)
      const meta = buildRuntimePhoneContactMeta(bundle, contact.role_key, contact.favor)

      return {
        roleKey: contact.role_key,
        label: meta.label,
        favor: contact.favor,
        relationTrackId: meta.trackId,
        relationTrackLabel: meta.trackLabel,
        relationStageId: meta.stageId,
        relationStageLabel: meta.stageLabel,
        canContact: meta.canContact,
        lockMessage: meta.lockMessage,
        personalityId: meta.personalityId,
        personalityLabel: meta.personalityLabel,
        unreadCount: getPhoneUnreadCount(snapshot, contact.role_key),
        unlockedAtDay: contact.unlocked_at_day,
        lastMessageGameMinute: latest.gameMinute,
        lastMessagePreview: latest.preview,
        messageCount: latest.messageCount
      } satisfies RuntimePhoneContactView
    })
    .sort((left, right) => {
      const rightMinute = right.lastMessageGameMinute ?? -1
      const leftMinute = left.lastMessageGameMinute ?? -1

      if (leftMinute !== rightMinute) {
        return rightMinute - leftMinute
      }

      if (left.unreadCount !== right.unreadCount) {
        return right.unreadCount - left.unreadCount
      }

      return left.label.localeCompare(right.label, "zh-Hans-CN")
    })
}

export function buildRuntimePhoneThreadView(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string
): RuntimePhoneThreadView | null {
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  if (!normalizedRoleKey) {
    return null
  }

  normalizePhoneState(snapshot)
  const contact = getPhoneContact(snapshot, normalizedRoleKey)
  if (!contact) {
    return null
  }

  const thread = getPhoneThread(snapshot, normalizedRoleKey)
  const messages = thread?.messages ?? []
  const meta = buildRuntimePhoneContactMeta(bundle, normalizedRoleKey, contact.favor)
  const talks = resolvePhoneTalkOptionsForContact(bundle, normalizedRoleKey, snapshot)
  const actions = resolvePhoneActionOptionsForContact(bundle, normalizedRoleKey, snapshot)

  return {
    roleKey: normalizedRoleKey,
    contactLabel: meta.label,
    favor: contact.favor,
    relationTrackId: meta.trackId,
    relationTrackLabel: meta.trackLabel,
    relationStageId: meta.stageId,
    relationStageLabel: meta.stageLabel,
    canContact: meta.canContact,
    lockMessage: meta.lockMessage,
    personalityId: meta.personalityId,
    personalityLabel: meta.personalityLabel,
    unreadCount: getPhoneUnreadCount(snapshot, normalizedRoleKey),
    messages: messages.map((message) => ({
      id: message.id,
      sender: message.sender,
      senderLabel: message.sender === "player"
        ? "我"
        : message.sender === "system"
          ? "系统"
          : findRoleLabel(bundle, normalizedRoleKey),
      content: message.content,
      gameMinute: message.game_minute,
      read: message.read
    })),
    talks: talks.map((message) => ({
      id: message.id,
      text: message.text,
      tags: [...message.tags],
      baseFavorDelta: message.baseFavorDelta,
      cooldownHours: message.cooldownHours,
      suggested: message.suggested
    })),
    actions: actions.map((action) => ({
      id: action.id,
      label: action.label,
      text: action.text,
      tags: [...action.tags],
      baseFavorDelta: action.baseFavorDelta,
      cooldownHours: action.cooldownHours,
      costMoney: action.costMoney,
      costItems: action.costItems.map((item) => ({
        itemId: item.itemId,
        itemName: item.itemName,
        quantity: item.quantity
      })),
      disabled: action.disabled,
      disabledReason: action.disabledReason,
      invokeEventLabel: action.invoke ? `${action.invoke.target_type}/${action.invoke.event_id}` : null
    })),
    quickMessages: talks.map((message) => ({
      id: message.id,
      text: message.text,
      tags: [...message.tags],
      baseFavorDelta: message.baseFavorDelta,
      cooldownHours: message.cooldownHours,
      suggested: message.suggested
    }))
  }
}

function buildViewModel(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  screen: RuntimeStoryViewModel["screen"],
  notifications: string[]
): RuntimeStoryViewModel {
  const currentEventState = getCurrentEventState(bundle, runtimeState)
  const currentEvent = getCurrentPlayableEvent(bundle, runtimeState)
  const currentMessage = currentEventState?.currentMessage ?? null
  const currentDialogue = currentEventState?.currentDialogue ?? null

  let interaction: RuntimeInteraction = null

  if (screen !== "debug") {
    if (currentMessage) {
      interaction = null
    } else if (currentDialogue) {
      interaction = {
        kind: "select",
        prompt: "请选择下一步。",
        options: [
          {
            id: "continue",
            label: currentDialogue.index < currentDialogue.total ? "继续对白" : "结束当前事件"
          }
        ]
      }
    } else if (currentEventState && currentEventState.availableActions.length > 0) {
      interaction = {
        kind: "select",
        prompt: "请选择一个操作分支。",
        options: currentEventState.availableActions.map((actionState) => {
          const actionNode = getBundleGraphNode(bundle, actionState.nodeId)
          const title = isCompiledAction(actionNode) ? actionNode.title : actionState.nodeId
          return {
            id: actionState.nodeId,
            label: title
          }
        })
      }
    } else if (currentEventState || runtimeState.snapshot.current_event_id === null) {
      interaction = {
        kind: "select",
        prompt: runtimeState.snapshot.current_event_id === null ? "当前没有可继续的事件。" : "请选择下一步。",
        options: runtimeState.snapshot.current_event_id === null
          ? []
          : [{
              id: "continue",
              label: "继续"
            }]
      }
    }
  }

  const branchContextSummary = Object.entries(runtimeState.lastAction?.branchValues ?? {}).map(
    ([key, value]) => ({
      key,
      value: formatValueSummary(value)
    })
  )

  const bagSummary = buildRuntimeBagSummary(bundle, runtimeState.snapshot)

  const availableBranches = (currentEventState?.availableActions ?? []).flatMap((actionState) => {
    const actionNode = getBundleGraphNode(bundle, actionState.nodeId)
    if (!isCompiledAction(actionNode)) {
      return []
    }

    return [{
      id: actionNode.id,
      title: actionNode.title,
      nextEventId: actionNode.next[0] ?? null,
      vars: actionNode.vars.map((item) => ({
        name: item.name,
        descr: item.descr,
        initialValue: item.initial_value
      }))
    }]
  })

  return {
    screen,
    storyTitle: bundle.title,
    activeEventId: runtimeState.snapshot.current_event_id,
    activeEventTitle: currentEvent?.title ?? null,
    interaction,
    notifications,
    currentLocationId: normalizeText(currentEvent?.location ?? "") || null,
    currentLocationName: currentEventState?.locationName ?? null,
    currentSceneLevel: null,
    currentMessage,
    currentDialogue,
    availableBranches,
    branchContextSummary,
    bagSummary,
    debugSummary: {
      globalGroupCount: runtimeState.snapshot.vals.variables.length,
      systemGroupCount: runtimeState.snapshot.system_vals.variables.length,
      historyCount: runtimeState.snapshot.history.length,
      triggeredOnceCount: runtimeState.snapshot.triggered_once_events.length
    }
  }
}

export function createStorySession(options: CreateStorySessionOptions): RuntimeStorySession {
  const now = options.now ?? new Date()
  const baseSnapshot = options.saveState
    ? cloneValue(options.saveState.session_state)
    : createBaseSnapshot(options.bundle)
  const notifications: string[] = []
  let screen: RuntimeStoryViewModel["screen"] = "game"
  const storyDirector = options.storyDirector ?? createRuleBasedRuntimeDirector()
  const runtimeState: RuntimeState = {
    snapshot: baseSnapshot,
    currentEventEntered: false,
    currentDialogueIndex: 0,
    currentMessageElapsedMs: 0,
    pendingActions: [],
    lastAction: null,
    activeStandaloneEvent: null,
    storyDirector
  }

  if (!runtimeState.snapshot.clock) {
    runtimeState.snapshot.clock = createDefaultClockState(runtimeState.snapshot.system_vals)
  }

  if (!runtimeState.snapshot.scheduler) {
    runtimeState.snapshot.scheduler = createDefaultSchedulerState()
  }

  normalizeBagsState(runtimeState.snapshot)
  normalizePhoneState(runtimeState.snapshot)
  syncSystemTimeFieldsFromClock(runtimeState.snapshot)

  if (!options.saveState && options.customOverrides) {
    applyCustomValuesToValsFile(runtimeState.snapshot.vals, options.customOverrides.custom_values)
    applyCustomValuesToValsFile(runtimeState.snapshot.system_vals, options.customOverrides.custom_values)
    runtimeState.snapshot.clock = createDefaultClockState(runtimeState.snapshot.system_vals)
    syncSystemTimeFieldsFromClock(runtimeState.snapshot)
    notifications.push(`已加载角色自定义变量：${options.customOverrides.profile_name}`)
  }

  if (options.saveState) {
    notifications.push(`已加载存档：${options.saveState.slot_id}`)
  } else {
    notifications.push(`已创建运行时会话：${now.toISOString()}`)
  }

  reconcileScheduler(options.bundle, runtimeState, notifications)

  function invokeOnceEventResolved(
    targetType: StoryInvokeTargetType,
    eventId: string,
    args?: Record<string, unknown>,
    notifyFailure = false
  ) {
    const normalizedTargetType = normalizeInvokeTargetType(targetType)
    const normalizedEventId = normalizeText(eventId)
    const normalizedArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? cloneValue(args)
        : {}
    if (!normalizedTargetType) {
      if (notifyFailure) {
        notifications.push("调用事件时必须指定目标类型：chain、pool 或 schedule。")
      }
      return false
    }

    const targetEvent = findBundleInvokeTargetEvent(options.bundle, normalizedTargetType, normalizedEventId)
    const validation = validateInvokeArgs(normalizedTargetType, targetEvent, normalizedArgs)

    if (!validation.ok || !targetEvent) {
      if (notifyFailure && validation.message) {
        notifications.push(validation.message)
      }
      return false
    }

    const queued = queueInvokeEvent(
      options.bundle,
      runtimeState,
      normalizedTargetType,
      targetEvent.id,
      normalizedArgs
    )
    if (!queued) {
      if (notifyFailure) {
        notifications.push(`${getInvokeTargetLabel(normalizedTargetType)} "${targetEvent.id}" 未能进入队列。`)
      }
      return false
    }

    reconcileScheduler(options.bundle, runtimeState, notifications)
    return true
  }

  return {
    dispatch(action) {
      if (action.type === "open-debug") {
        screen = "debug"
        return
      }

      if (action.type === "close-debug") {
        screen = "game"
        return
      }

      if (action.type === "select-option" && action.optionId === "debug") {
        screen = "debug"
        return
      }

      if (action.type === "invoke-once") {
        invokeOnceEventResolved(action.targetType, action.eventId, action.args, true)
        return
      }

      if (action.type === "submit-text") {
        notifications.push(`已提交输入字段：${action.field}`)
        appendHistory(runtimeState.snapshot, {
          type: "system",
          id: "submit-text",
          title: action.field,
          content: action.value
        })
        return
      }

      if (action.type === "phone-mark-read") {
        try {
          const normalizedRoleKey = assertRuntimePhoneRoleKey(options.bundle, action.roleKey)
          markPhoneThreadRead(runtimeState.snapshot, normalizedRoleKey)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "标记手机消息已读失败。")
        }
        return
      }

      if (action.type === "phone-send-quick-message") {
        try {
          sendPhoneQuickMessage(
            options.bundle,
            runtimeState,
            notifications,
            action.roleKey,
            action.quickMessageId
          )
          reconcileScheduler(options.bundle, runtimeState, notifications)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "发送手机消息失败。")
        }
        return
      }

      if (action.type === "phone-send-talk") {
        try {
          sendPhoneTalk(
            options.bundle,
            runtimeState,
            notifications,
            action.roleKey,
            action.talkId
          )
          reconcileScheduler(options.bundle, runtimeState, notifications)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "发送手机闲聊失败。")
        }
        return
      }

      if (action.type === "phone-send-action") {
        try {
          sendPhoneAction(
            options.bundle,
            runtimeState,
            notifications,
            action.roleKey,
            action.actionId
          )
          reconcileScheduler(options.bundle, runtimeState, notifications)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "执行手机动作失败。")
        }
        return
      }

      if (action.type === "continue") {
        const currentEventState = getCurrentEventState(options.bundle, runtimeState)

        if (!currentEventState) {
          notifications.push("当前没有可继续的事件。")
          return
        }

        if (currentEventState.currentDialogue) {
          appendHistory(runtimeState.snapshot, {
            type: "dialogue",
            id: `${currentEventState.node.id}:${runtimeState.currentDialogueIndex}`,
            title: currentEventState.currentDialogue.speakerLabel,
            content: currentEventState.currentDialogue.content
          })
          runtimeState.currentDialogueIndex += 1

          if (runtimeState.currentDialogueIndex >= currentEventState.currentDialogue.total) {
            finishCurrentEvent(options.bundle, runtimeState, notifications)
          }
          return
        }

        if (currentEventState.availableActions.length > 0) {
          notifications.push("当前事件需要先选择一个操作分支。")
          return
        }

        finishCurrentEvent(options.bundle, runtimeState, notifications)
        return
      }

      if (action.type === "select-option") {
        if (action.optionId === "continue") {
          this.dispatch({ type: "continue" })
          return
        }

        executeAction(options.bundle, runtimeState, action.optionId, notifications)
      }
    },
    invokeOnceEvent(targetType, eventId, args) {
      return invokeOnceEventResolved(targetType, eventId, args)
    },
    tick(deltaMs) {
      advanceCurrentMessagePresentation(options.bundle, runtimeState, notifications, deltaMs)

      const queued = queueClockProgress(runtimeState.snapshot, deltaMs)
      if (!queued) {
        syncSystemTimeFieldsFromClock(runtimeState.snapshot)
        return
      }

      let advanced = false
      while (advanceClockBySingleStep(runtimeState.snapshot)) {
        advanced = true
        reconcileScheduler(options.bundle, runtimeState, notifications, {
          runPhoneAutoMessages: true
        })

        if (isRuntimeTimePaused(runtimeState.snapshot)) {
          break
        }
      }

      if (advanced) {
        return
      }

      syncSystemTimeFieldsFromClock(runtimeState.snapshot)
    },
    setTimePause(paused: boolean) {
      normalizeSchedulerState(runtimeState.snapshot)
      runtimeState.snapshot.scheduler.manual_pause = Boolean(paused)
      syncSystemTimeFieldsFromClock(runtimeState.snapshot)
    },
    setTimeSpeed(speed: number) {
      const normalizedSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0
      setSystemNumber(runtimeState.snapshot, "system.time_speed", normalizedSpeed)
    },
    getViewModel() {
      return buildViewModel(options.bundle, runtimeState, screen, [...notifications])
    },
    getSnapshot() {
      return cloneValue(runtimeState.snapshot)
    }
  }
}
