/**
 * 时钟、调度器与导演状态的规范化。
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
import type { RuntimeScheduledEvent, RuntimeSchedulerAuditKind, RuntimeSchedulerSourceType, RuntimeStorySessionSnapshot, RuntimeTriggeredOnceState } from "./contracts-core"
import { MAX_RUNTIME_DIRECTOR_LOGS, MAX_SCHEDULER_AUDIT_LOGS, RUNTIME_SCHEDULER_AUDIT_KINDS } from "./contracts-view"
import { isRuntimeTimePaused } from "./schedule-clock"
import { clampInteger, clampNumber, cloneValue, createDefaultSchedulerState, normalizeText, readSystemNumber, readSystemString, resolveJieqi, resolveJieri, resolveShiduan, resolveWeekday, writeSystemValue } from "./state-values"

/** @param value 故事设置中的开始时间。 @returns 合法 `HH:mm` 的小时和分钟，类型/格式非法时为 null。 */
export function parseStoryStartTime(value: unknown) {
  if (typeof value !== "string") {
    return null
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) {
    return null
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  }
}

/**
 * 从系统变量和可选游戏设置创建初始确定性时钟。
 * @param systemVals 初始系统变量。 @param startTime 可选 `HH:mm`，存在时覆盖旧变量中的日/时/分。
 * @returns 基准日期、累计分钟、待结算分钟和固定步长组成的时钟状态。
 */
export function createDefaultClockState(systemVals: StoryValsFile, startTime?: unknown): RuntimeClockState {
  const nowDate = readSystemString(systemVals, "system.now_date", "1990-1-1")
  const parsedNowDate = parseStoryDate(nowDate) ?? { year: 1990, month: 1, day: 1 }
  const parsedStartTime = parseStoryStartTime(startTime)
  const nowDay = parsedStartTime
    ? 1
    : Math.max(1, clampInteger(readSystemNumber(systemVals, "system.now_day", 1), 1))
  const nowHour = parsedStartTime
    ? parsedStartTime.hour
    : Math.max(0, Math.min(23, clampInteger(readSystemNumber(systemVals, "system.now_hour", 0), 0)))
  const rawMinute = parsedStartTime
    ? parsedStartTime.minute
    : clampInteger(readSystemNumber(systemVals, "system.now_minute", 0), 0)
  const snappedMinute = snapMinuteToStep(rawMinute, DEFAULT_CLOCK_STEP_MINUTES)

  return {
    base_date: formatStoryDate(parsedNowDate),
    base_day: nowDay,
    total_minutes: nowHour * 60 + snappedMinute,
    pending_minutes: 0,
    step_minutes: DEFAULT_CLOCK_STEP_MINUTES
  }
}

/** @param snapshot 会话快照。 @returns 无返回值；修复日期、负数、非数字和非法步长并原地写回时钟。 */
export function normalizeClockState(snapshot: RuntimeStorySessionSnapshot) {
  const clock = snapshot.clock
  const parsedBaseDate = parseStoryDate(clock.base_date) ?? { year: 1990, month: 1, day: 1 }

  clock.base_date = formatStoryDate(parsedBaseDate)
  clock.base_day = clampInteger(clock.base_day, 0)
  clock.total_minutes = Math.max(0, clampInteger(clock.total_minutes, 0))
  clock.pending_minutes = Math.max(0, clampNumber(clock.pending_minutes, 0))
  clock.step_minutes = Math.max(1, clampInteger(clock.step_minutes, DEFAULT_CLOCK_STEP_MINUTES))
}

/** @param value 优先级输入。 @returns 整数优先级，缺失或非法时使用默认 100。 */
export function normalizeSchedulePriority(value: unknown) {
  return clampInteger(value, 100)
}

/** @param value after/before 输入。 @returns 去空白、去重后的依赖 id 数组；非数组为空。 */
export function normalizeScheduleDependencyIds(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean)))
    : []
}

/** @param item 可能来自旧存档的调度事件。 @returns 规范的 priority、after 和 before 字段。 */
export function normalizeScheduledEventOrderFields(item: Partial<RuntimeScheduledEvent>) {
  return {
    priority: normalizeSchedulePriority(item.priority),
    after: normalizeScheduleDependencyIds(item.after),
    before: normalizeScheduleDependencyIds(item.before)
  }
}

/**
 * 将旧版或部分损坏的调度存档迁移成当前完整状态。
 * @param snapshot 会话快照。 @returns 无返回值；规范未来/就绪/活动事件、循环状态、审计、导演日志和序号。
 * 旧 `graph_root`、`once`、`loop` 名称在此转换；队列最后重新确定性排序，确保加载后顺序稳定。
 */
export function normalizeSchedulerState(snapshot: RuntimeStorySessionSnapshot) {
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
        category: item.category,
        type: item.type,
        id: normalizeText(item.id),
        game_minute: Math.max(0, clampInteger(item.game_minute, 0)),
        ...(normalizeOptionalText(item.title) ? { title: normalizeOptionalText(item.title) } : {}),
        ...(normalizeOptionalText(item.content) ? { content: normalizeOptionalText(item.content) } : {}),
        timestamp: normalizeText(item.timestamp)
      })).filter((item) => (item.category === "operation" || item.category === "story" || item.category === "system") && item.id && item.timestamp)
    : []
}

/** @param value 未知输入。 @returns 非空去空白文本；空值返回 undefined，便于省略可选字段。 */
export function normalizeOptionalText(value: unknown) {
  const normalized = normalizeText(value)
  return normalized || undefined
}

/** @param value 去重键输入。 @param sourceType 来源类型，保留参数以兼容旧调用。 @returns 去空白的去重键。 */
export function normalizeSchedulerDedupeKey(
  value: unknown,
  sourceType: RuntimeSchedulerSourceType | undefined
) {
  const normalized = normalizeText(value)
  return normalized
}

/** @param value 当前或旧版来源名。 @returns 当前来源类型；兼容 graph_root/once/loop，未知值为 undefined。 */
export function normalizeSchedulerSourceType(value: unknown): RuntimeSchedulerSourceType | undefined {
  if (value === "chain_root" || value === "pool" || value === "schedule" || value === "doing" || value === "invoke") {
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

/** @param value invoke 目标类型。 @returns chain/pool/schedule；兼容旧 graph/once/loop，未知值为 undefined。 */
export function normalizeInvokeTargetType(value: unknown): StoryInvokeTargetType | undefined {
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

/** @param value 审计种类输入。 @returns 合法种类，未知值回退为 queue-ready。 */
export function normalizeSchedulerAuditKind(value: unknown): RuntimeSchedulerAuditKind {
  if (typeof value === "string" && RUNTIME_SCHEDULER_AUDIT_KINDS.includes(value as RuntimeSchedulerAuditKind)) {
    return value as RuntimeSchedulerAuditKind
  }

  return "queue-ready"
}

/** @param value 导演候选来源。 @param fallback 无法识别时的默认来源。 @returns chain_root 或 pool；兼容旧 graph_root/once。 */
export function normalizeRuntimeDirectorCandidateSourceType(
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

/** @param value 未知输入。 @returns 非数组对象的深拷贝；其它输入返回空对象。 */
export function normalizeUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? cloneValue(value as Record<string, unknown>)
    : {}
}

/** @param value 旧存档中的导演历史项。 @returns type/id/title 字段安全的当前历史结构。 */
export function normalizeRuntimeDirectorHistoryEntry(value: unknown): RuntimeDirectorHistoryEntry {
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

/** @param value 未知特征快照。 @returns 时间范围、数组和字典均规范化的导演特征。 */
export function normalizeRuntimeDirectorFeatureSnapshot(value: unknown): RuntimeDirectorFeatureSnapshot {
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

/**
 * 迁移并清洗一条导演决策日志。
 * @param value 旧版或未知日志。 @returns 当前字段命名、候选来源和特征快照均规范的日志。
 */
export function normalizeRuntimeDirectorDecisionLog(value: unknown): RuntimeDirectorDecisionLog {
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

/**
 * 把确定性时钟派生值同步到作者可读的 `system.now_*` 变量。
 * @param snapshot 会话快照。 @returns 无返回值；写入日期、天、时、分、星期、时段、节气、节日和暂停状态。
 * 时钟是唯一事实来源，系统变量只作为脚本读取镜像，不能反过来各自推进。
 */
export function syncSystemTimeFieldsFromClock(snapshot: RuntimeStorySessionSnapshot) {
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
