import {
  evaluateStoryBooleanExpression,
  executeStoryScript,
  renderStoryTextTemplate
} from "./vals"
import type { StoryScriptExecutionContext } from "./vals"
import type {
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

interface RuntimeLocationAssignment {
  id: string
  descr: string
}

interface RuntimeNormalRoleDefinition {
  id: string
  name?: string
  descr: string
}

interface RuntimeImportantRoleDefinition {
  id: string
  name?: string
  descr: string
}

interface CompiledEvent {
  node_type?: "event"
  id: string
  title: string
  trigger_expr: string
  init_script: string
  end_script: string
  object_keys: string[]
  dialogues: RuntimeStoryDialogueDefinition[]
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
  runtime_source_type: "big_once" | "loop"
  bgm: string
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

export interface RuntimeTriggeredBigOnceState {
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

export type RuntimeSchedulerSourceType = "graph_root" | "big_once" | "loop"

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
  entry_event_id: string
  due_game_minute: number
  seq: number
  dedupe_key: string
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
  consumed_big_once_ids: string[]
  consumed_graph_root_ids: string[]
  loop_states: RuntimeSchedulerLoopState[]
  audit_logs: RuntimeSchedulerAuditEntry[]
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
  triggered_big_once_events: RuntimeTriggeredBigOnceState[]
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
  graphEvents: Record<string, unknown>
  bigOnceEvents: unknown[]
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

export interface RuntimeStoryViewModel {
  screen: "boot" | "profile" | "save-select" | "game" | "debug"
  storyTitle: string
  activeEventId: string | null
  activeEventTitle: string | null
  interaction: RuntimeInteraction
  notifications: string[]
  currentLocationName: string | null
  currentSceneLevel: number | null
  currentDialogue: RuntimeRenderedDialogue | null
  availableBranches: RuntimeBranchOptionView[]
  branchContextSummary: Array<{
    key: string
    value: string
  }>
  debugSummary: {
    globalGroupCount: number
    systemGroupCount: number
    historyCount: number
    triggeredBigOnceCount: number
  }
}

export type RuntimeStorySessionAction =
  | { type: "continue" }
  | { type: "select-option"; optionId: string }
  | { type: "submit-text"; field: string; value: string }
  | { type: "open-debug" }
  | { type: "close-debug" }

export interface CreateStorySessionOptions {
  bundle: RuntimeStoryBundle
  customOverrides?: RuntimeProfileCustomFile | null
  saveState?: RuntimeStorySaveState | null
  now?: Date
}

export interface RuntimeStorySession {
  dispatch(action: RuntimeStorySessionAction): void
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
  pendingActions: RuntimeActionState[]
  lastAction: RuntimeActionState | null
  activeStandaloneEvent: RuntimeStandaloneEvent | null
}

interface RuntimeDialogueNodeState {
  node: CompiledEvent
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
  trigger_expr: string
  init_script: string
  object_keys: string[]
  dialogues: RuntimeStoryDialogueDefinition[]
  location: string
  bgm: string
  end_script: string
  loop: {
    mode: "daily" | "weekly" | "monthly" | "interval_days"
    interval_days?: number
    weekday?: number
    month_day?: number
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
    consumed_big_once_ids: [],
    consumed_graph_root_ids: [],
    loop_states: [],
    audit_logs: [],
    manual_pause: false,
    event_pause: false,
    next_seq: 1
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

function normalizeSchedulerState(snapshot: RuntimeStorySessionSnapshot) {
  const scheduler = snapshot.scheduler ?? createDefaultSchedulerState()
  scheduler.scheduled = Array.isArray(scheduler.scheduled)
    ? scheduler.scheduled.map((item) => ({
        instance_id: normalizeText(item.instance_id),
        source_type: item.source_type,
        source_id: normalizeText(item.source_id),
        entry_event_id: normalizeText(item.entry_event_id),
        due_game_minute: Math.max(0, clampInteger(item.due_game_minute, 0)),
        seq: Math.max(1, clampInteger(item.seq, 1)),
        dedupe_key: normalizeText(item.dedupe_key),
        status: item.status
      }))
    : []
  scheduler.ready_queue = Array.isArray(scheduler.ready_queue)
    ? scheduler.ready_queue.map((item) => ({
        instance_id: normalizeText(item.instance_id),
        source_type: item.source_type,
        source_id: normalizeText(item.source_id),
        entry_event_id: normalizeText(item.entry_event_id),
        due_game_minute: Math.max(0, clampInteger(item.due_game_minute, 0)),
        seq: Math.max(1, clampInteger(item.seq, 1)),
        dedupe_key: normalizeText(item.dedupe_key),
        status: item.status
      }))
    : []
  scheduler.active = scheduler.active
    ? {
        instance_id: normalizeText(scheduler.active.instance_id),
        source_type: scheduler.active.source_type,
        source_id: normalizeText(scheduler.active.source_id),
        entry_event_id: normalizeText(scheduler.active.entry_event_id),
        due_game_minute: Math.max(0, clampInteger(scheduler.active.due_game_minute, 0)),
        seq: Math.max(1, clampInteger(scheduler.active.seq, 1)),
        dedupe_key: normalizeText(scheduler.active.dedupe_key),
        status: scheduler.active.status
      }
    : null
  scheduler.consumed_big_once_ids = Array.isArray(scheduler.consumed_big_once_ids)
    ? scheduler.consumed_big_once_ids.map((item) => normalizeText(item)).filter(Boolean)
    : []
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
  scheduler.manual_pause = Boolean(scheduler.manual_pause)
  scheduler.event_pause = Boolean(scheduler.event_pause)
  scheduler.next_seq = Math.max(1, clampInteger(scheduler.next_seq, 1))
  snapshot.scheduler = scheduler
}

function normalizeOptionalText(value: unknown) {
  const normalized = normalizeText(value)
  return normalized || undefined
}

function normalizeSchedulerSourceType(value: unknown): RuntimeSchedulerSourceType | undefined {
  if (value === "graph_root" || value === "big_once" || value === "loop") {
    return value
  }

  return undefined
}

function normalizeSchedulerAuditKind(value: unknown): RuntimeSchedulerAuditKind {
  if (typeof value === "string" && RUNTIME_SCHEDULER_AUDIT_KINDS.includes(value as RuntimeSchedulerAuditKind)) {
    return value as RuntimeSchedulerAuditKind
  }

  return "queue-ready"
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

function createBaseSnapshot(bundle: RuntimeStoryBundle): RuntimeStorySessionSnapshot {
  const systemVals = cloneValsFile(bundle.systemVals)
  const snapshot: RuntimeStorySessionSnapshot = {
    current_event_id: null,
    vals: cloneValsFile(bundle.vals),
    system_vals: systemVals,
    clock: createDefaultClockState(systemVals),
    scheduler: createDefaultSchedulerState(),
    triggered_big_once_events: [],
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

  if (loopEvent.loop.mode === "daily") {
    const anchor = previousDueGameMinute ?? currentDayStartGameMinute
    return anchor + MINUTES_PER_DAY
  }

  if (loopEvent.loop.mode === "interval_days") {
    const intervalDays = clampLoopIntervalDays(loopEvent.loop.interval_days)
    const anchor = previousDueGameMinute ?? currentDayStartGameMinute
    return anchor + intervalDays * MINUTES_PER_DAY
  }

  if (loopEvent.loop.mode === "weekly") {
    if (previousDueGameMinute !== null) {
      return previousDueGameMinute + 7 * MINUTES_PER_DAY
    }

    const targetWeekday = clampLoopWeekday(loopEvent.loop.weekday)
    const currentWeekday = resolveWeekday(datePartsToUtcDayNumber(currentDateParts))
    const offsetDays = ((targetWeekday - currentWeekday + 7) % 7) || 7
    return currentDayStartGameMinute + offsetDays * MINUTES_PER_DAY
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
  const anchorGameMinute = previousDueGameMinute ?? currentDayStartGameMinute
  return anchorGameMinute + (nextDayNumber - currentDayNumber) * MINUTES_PER_DAY
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

function createScheduledEvent(
  snapshot: RuntimeStorySessionSnapshot,
  sourceType: RuntimeSchedulerSourceType,
  sourceId: string,
  entryEventId: string,
  dueGameMinute: number,
  dedupeKey: string
): RuntimeScheduledEvent {
  normalizeSchedulerState(snapshot)
  const seq = snapshot.scheduler.next_seq
  snapshot.scheduler.next_seq += 1

  return {
    instance_id: `evt-${seq}`,
    source_type: sourceType,
    source_id: normalizeText(sourceId),
    entry_event_id: normalizeText(entryEventId),
    due_game_minute: Math.max(0, clampInteger(dueGameMinute, 0)),
    seq,
    dedupe_key: normalizeText(dedupeKey),
    status: "ready"
  }
}

function sortReadyQueue(snapshot: RuntimeStorySessionSnapshot) {
  normalizeSchedulerState(snapshot)
  snapshot.scheduler.ready_queue.sort((left, right) => {
    if (left.due_game_minute !== right.due_game_minute) {
      return left.due_game_minute - right.due_game_minute
    }

    return left.seq - right.seq
  })
}

function enqueueReadyEvent(snapshot: RuntimeStorySessionSnapshot, scheduledEvent: RuntimeScheduledEvent) {
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
    message: "加入就绪队列"
  })
  return true
}

function enqueueScheduledEvent(snapshot: RuntimeStorySessionSnapshot, scheduledEvent: RuntimeScheduledEvent) {
  normalizeSchedulerState(snapshot)
  if (!scheduledEvent.dedupe_key || isScheduledEventQueued(snapshot, scheduledEvent.dedupe_key)) {
    return false
  }

  snapshot.scheduler.scheduled.push({
    ...cloneValue(scheduledEvent),
    status: "scheduled"
  })
  snapshot.scheduler.scheduled.sort((left, right) => {
    if (left.due_game_minute !== right.due_game_minute) {
      return left.due_game_minute - right.due_game_minute
    }

    return left.seq - right.seq
  })
  appendSchedulerAudit(snapshot, {
    kind: "schedule-future",
    source_type: scheduledEvent.source_type,
    source_id: scheduledEvent.source_id,
    entry_event_id: scheduledEvent.entry_event_id,
    due_game_minute: scheduledEvent.due_game_minute,
    message: "加入未来调度"
  })
  return true
}

function promoteDueScheduledEvents(snapshot: RuntimeStorySessionSnapshot) {
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
}

function clearCurrentEventState(runtimeState: RuntimeState) {
  runtimeState.snapshot.current_event_id = null
  runtimeState.activeStandaloneEvent = null
  runtimeState.currentEventEntered = false
  runtimeState.currentDialogueIndex = 0
  runtimeState.pendingActions = []
  runtimeState.lastAction = null
}

function getGraphRootEventIds(bundle: RuntimeStoryBundle) {
  const incomingTargets = new Set<string>()
  const graphNodes = Object.values(bundle.graphEvents) as RuntimeGraphNode[]

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

function scanGraphRootEvents(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState
) {
  const rootEventIds = getGraphRootEventIds(bundle)

  for (const rootEventId of rootEventIds) {
    const dedupeKey = `graph_root:${rootEventId}`
    if (runtimeState.snapshot.scheduler.consumed_graph_root_ids.includes(rootEventId)) {
      continue
    }

    if (isScheduledEventQueued(runtimeState.snapshot, dedupeKey)) {
      continue
    }

    const rootNode = getBundleGraphNode(bundle, rootEventId)
    if (!isCompiledEvent(rootNode) || !canEnterEvent(runtimeState.snapshot, rootNode, {})) {
      continue
    }

    const readyEvent = createScheduledEvent(
      runtimeState.snapshot,
      "graph_root",
      rootEventId,
      rootEventId,
      getCurrentGameMinute(runtimeState.snapshot),
      dedupeKey
    )
    enqueueReadyEvent(runtimeState.snapshot, readyEvent)
  }
}

function scanBigOnceEvents(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState
) {
  const bigOnceEvents = bundle.bigOnceEvents as Array<{
    id: string
    title: string
    trigger_expr: string
    init_script: string
    object_keys: string[]
    dialogues: RuntimeStoryDialogueDefinition[]
    location: string
    bgm: string
    end_script: string
  }>

  for (const event of bigOnceEvents) {
    const dedupeKey = `big_once:${event.id}`
    if (runtimeState.snapshot.scheduler.consumed_big_once_ids.includes(event.id)) {
      continue
    }

    if (runtimeState.snapshot.triggered_big_once_events.some((item) => item.event_id === event.id)) {
      continue
    }

    if (isScheduledEventQueued(runtimeState.snapshot, dedupeKey)) {
      continue
    }

    const standaloneEvent = createStandaloneEvent("big_once", event)
    if (!canEnterEvent(runtimeState.snapshot, standaloneEvent, {})) {
      continue
    }

    const readyEvent = createScheduledEvent(
      runtimeState.snapshot,
      "big_once",
      event.id,
      event.id,
      getCurrentGameMinute(runtimeState.snapshot),
      dedupeKey
    )
    enqueueReadyEvent(runtimeState.snapshot, readyEvent)
  }
}

function ensureLoopSchedules(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState
) {
  const loopEvents = bundle.loopEvents as RuntimeLoopEventDefinition[]

  for (const loopEvent of loopEvents) {
    const loopState = getLoopSchedulerState(runtimeState.snapshot, loopEvent.id)

    if (loopState.next_due_game_minute === null) {
      loopState.next_due_game_minute = calculateNextLoopDueGameMinute(
        runtimeState.snapshot,
        loopEvent,
        loopState.last_triggered_game_minute
      )
      appendSchedulerAudit(runtimeState.snapshot, {
        kind: "loop-reschedule",
        source_type: "loop",
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

    const dedupeKey = `loop:${loopEvent.id}:${nextDueGameMinute}`

    if (isScheduledEventQueued(runtimeState.snapshot, dedupeKey)) {
      continue
    }

    const scheduledEvent = createScheduledEvent(
      runtimeState.snapshot,
      "loop",
      loopEvent.id,
      loopEvent.id,
      nextDueGameMinute,
      dedupeKey
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

    if (nextScheduledEvent.source_type === "big_once") {
      const event = (bundle.bigOnceEvents as Array<{
        id: string
        title: string
        trigger_expr: string
        init_script: string
        object_keys: string[]
        dialogues: RuntimeStoryDialogueDefinition[]
        location: string
        bgm: string
        end_script: string
      }>).find((item) => item.id === nextScheduledEvent.source_id)

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
      runtimeState.activeStandaloneEvent = createStandaloneEvent("big_once", event)
      runtimeState.snapshot.current_event_id = event.id
      runtimeState.currentEventEntered = false
      runtimeState.currentDialogueIndex = 0
      runtimeState.pendingActions = []
      runtimeState.lastAction = null
      enterCurrentEvent(bundle, runtimeState, notifications)
      settlePassiveEvents(bundle, runtimeState, notifications)
      return
    }

    if (nextScheduledEvent.source_type === "loop") {
      const event = (bundle.loopEvents as RuntimeLoopEventDefinition[]).find(
        (item) => item.id === nextScheduledEvent.source_id
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
      runtimeState.activeStandaloneEvent = createStandaloneEvent("loop", event)
      runtimeState.snapshot.current_event_id = event.id
      runtimeState.currentEventEntered = false
      runtimeState.currentDialogueIndex = 0
      runtimeState.pendingActions = []
      runtimeState.lastAction = null
      enterCurrentEvent(bundle, runtimeState, notifications)
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
    moveToEvent(bundle, runtimeState, nextScheduledEvent.entry_event_id, {})
    enterCurrentEvent(bundle, runtimeState, notifications)
    settlePassiveEvents(bundle, runtimeState, notifications)
  }
}

function reconcileScheduler(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  normalizeSchedulerState(runtimeState.snapshot)
  promoteDueScheduledEvents(runtimeState.snapshot)
  scanGraphRootEvents(bundle, runtimeState)
  scanBigOnceEvents(bundle, runtimeState)
  ensureLoopSchedules(bundle, runtimeState)
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

  return (bundle.graphEvents[nodeId] as RuntimeGraphNode | undefined) ?? null
}

function createStandaloneEvent(
  sourceType: "big_once" | "loop",
  event: {
    id: string
    title: string
    trigger_expr: string
    init_script: string
    end_script: string
    object_keys: string[]
    dialogues: RuntimeStoryDialogueDefinition[]
    location: string
    bgm: string
  }
): RuntimeStandaloneEvent {
  return {
    runtime_source_type: sourceType,
    node_type: "event",
    id: event.id,
    title: event.title,
    trigger_expr: event.trigger_expr,
    init_script: event.init_script,
    end_script: event.end_script,
    object_keys: cloneValue(event.object_keys),
    dialogues: cloneValue(event.dialogues),
    location: event.location,
    bgm: event.bgm,
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

function buildRuntimeContextValues(
  snapshot: RuntimeStorySessionSnapshot,
  branchValues: Record<string, unknown>
) {
  const combinedValues: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(branchValues)) {
    combinedValues[`branch.${key}`] = cloneValue(value)
  }

  return {
    values: combinedValues
  } satisfies StoryScriptExecutionContext
}

function buildRuntimeScriptContext(
  snapshot: RuntimeStorySessionSnapshot,
  branchValues: Record<string, unknown>
) {
  const combinedValues: Record<string, unknown> = {}
  const assignableValues: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(branchValues)) {
    combinedValues[`branch.${key}`] = cloneValue(value)
    assignableValues[`branch.${key}`] = cloneValue(value)
  }

  return {
    values: combinedValues,
    assignableValues
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
  runtimeState: RuntimeState,
  script: string,
  branchValues: Record<string, unknown>
) {
  const trimmedScript = normalizeText(script)
  if (!trimmedScript) {
    return branchValues
  }

  const executionContext = buildRuntimeScriptContext(runtimeState.snapshot, branchValues)
  const combinedValsFile = createCombinedValsFile(runtimeState.snapshot)
  const result = executeStoryScript(
    combinedValsFile,
    trimmedScript,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    executionContext
  )

  applyCombinedValsFile(runtimeState.snapshot, result.vals)

  const nextBranchValues: Record<string, unknown> = {}
  for (const [token, value] of Object.entries(result.externalValues)) {
    if (!token.startsWith("branch.")) {
      continue
    }

    nextBranchValues[token.slice("branch.".length)] = cloneValue(value)
  }

  return nextBranchValues
}

function renderDialogueContent(
  snapshot: RuntimeStorySessionSnapshot,
  content: string,
  branchValues: Record<string, unknown>
) {
  const combinedValsFile = createCombinedValsFile(snapshot)
  return renderStoryTextTemplate(
    combinedValsFile,
    content,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    buildRuntimeContextValues(snapshot, branchValues)
  )
}

function buildDialogueView(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  dialogue: RuntimeStoryDialogueDefinition,
  index: number,
  total: number,
  branchValues: Record<string, unknown>
): RuntimeRenderedDialogue {
  const speakerLabel = dialogue.speaker_type === "player"
    ? "主角"
    : findRoleLabel(bundle, dialogue.speaker_key)

  return {
    index: index + 1,
    total,
    speakerLabel,
    speakerKey: dialogue.speaker_key,
    content: renderDialogueContent(snapshot, dialogue.content, branchValues)
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
  branchValues: Record<string, unknown>
) {
  for (const candidateEventId of candidateEventIds) {
    const candidateNode = getBundleGraphNode(bundle, candidateEventId)
    if (!isCompiledEvent(candidateNode)) {
      continue
    }

    if (canEnterEvent(snapshot, candidateNode, branchValues)) {
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
  snapshot: RuntimeStorySessionSnapshot,
  event: RuntimePlayableEvent,
  branchValues: Record<string, unknown>
) {
  const combinedValsFile = createCombinedValsFile(snapshot)
  const triggerResult = evaluateStoryBooleanExpression(
    combinedValsFile,
    event.trigger_expr,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    buildRuntimeContextValues(snapshot, branchValues)
  )

  return triggerResult.result
}

function moveToEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  targetEventId: string | null,
  branchValues: Record<string, unknown>
) {
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

    finishCurrentEvent(bundle, runtimeState, notifications)
  }

  notifications.push("自动推进的空事件链过长，已停止继续自动推进。")
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

  if (activeScheduledEvent.source_type === "graph_root") {
    if (!snapshot.scheduler.consumed_graph_root_ids.includes(activeScheduledEvent.source_id)) {
      snapshot.scheduler.consumed_graph_root_ids.push(activeScheduledEvent.source_id)
    }
  }

  if (activeScheduledEvent.source_type === "big_once") {
    if (!snapshot.scheduler.consumed_big_once_ids.includes(activeScheduledEvent.source_id)) {
      snapshot.scheduler.consumed_big_once_ids.push(activeScheduledEvent.source_id)
    }

    if (!snapshot.triggered_big_once_events.some((item) => item.event_id === activeScheduledEvent.source_id)) {
      snapshot.triggered_big_once_events.push({
        event_id: activeScheduledEvent.source_id,
        triggered_at: new Date().toISOString()
      })
    }
  }

  if (activeScheduledEvent.source_type === "loop") {
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
  const nextBranchValues = executeEventScript(
    runtimeState,
    currentNode.end_script,
    branchValues
  )
  const actionResolution = resolveEventActions(bundle, currentNode)

  if (actionResolution.actions.length > 0) {
    runtimeState.pendingActions = actionResolution.actions
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
    nextBranchValues
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
    runtimeState.snapshot,
    targetActionState.branchValues
  )
  const combinedValsFile = createCombinedValsFile(runtimeState.snapshot)
  const scriptResult = executeStoryScript(
    combinedValsFile,
    actionNode.exec_script,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    executionContext
  )

  applyCombinedValsFile(runtimeState.snapshot, scriptResult.vals)

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
  const dialogues = currentNode.dialogues ?? []
  const currentDialogue = dialogues.length > 0 && runtimeState.currentDialogueIndex < dialogues.length
    ? buildDialogueView(
        bundle,
        runtimeState.snapshot,
        dialogues[runtimeState.currentDialogueIndex]!,
        runtimeState.currentDialogueIndex,
        dialogues.length,
        branchValues
      )
    : null

  const actionResolution = resolveEventActions(bundle, currentNode)
  const availableActions = runtimeState.pendingActions.length > 0
    ? runtimeState.pendingActions
    : actionResolution.actions

  return {
    node: currentNode,
    currentDialogue,
    availableActions,
    autoNextEventIds: actionResolution.autoNextEventIds,
    locationName: findLocationLabel(bundle, currentNode.location)
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
  const currentDialogue = currentEventState?.currentDialogue ?? null

  let interaction: RuntimeInteraction = null

  if (screen !== "debug") {
    if (currentDialogue) {
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
    currentLocationName: currentEventState?.locationName ?? null,
    currentSceneLevel: null,
    currentDialogue,
    availableBranches,
    branchContextSummary,
    debugSummary: {
      globalGroupCount: runtimeState.snapshot.vals.variables.length,
      systemGroupCount: runtimeState.snapshot.system_vals.variables.length,
      historyCount: runtimeState.snapshot.history.length,
      triggeredBigOnceCount: runtimeState.snapshot.triggered_big_once_events.length
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
  const runtimeState: RuntimeState = {
    snapshot: baseSnapshot,
    currentEventEntered: false,
    currentDialogueIndex: 0,
    pendingActions: [],
    lastAction: null,
    activeStandaloneEvent: null
  }

  if (!runtimeState.snapshot.clock) {
    runtimeState.snapshot.clock = createDefaultClockState(runtimeState.snapshot.system_vals)
  }

  if (!runtimeState.snapshot.scheduler) {
    runtimeState.snapshot.scheduler = createDefaultSchedulerState()
  }

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
    tick(deltaMs) {
      const queued = queueClockProgress(runtimeState.snapshot, deltaMs)
      if (!queued) {
        syncSystemTimeFieldsFromClock(runtimeState.snapshot)
        return
      }

      let advanced = false
      while (advanceClockBySingleStep(runtimeState.snapshot)) {
        advanced = true
        reconcileScheduler(options.bundle, runtimeState, notifications)

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
