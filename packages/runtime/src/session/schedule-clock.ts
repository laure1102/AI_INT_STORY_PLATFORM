/**
 * 游戏时钟、循环日期和计划事件创建。
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
import type { RuntimeScheduledEvent, RuntimeSchedulerAuditEntry, RuntimeSchedulerSourceType, RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimeLoopEventDefinition, RuntimeStoryBundle } from "./contracts-view"
import { MAX_RUNTIME_DIRECTOR_LOGS, MAX_SCHEDULER_AUDIT_LOGS } from "./contracts-view"
import { createInitialBagsState } from "./contact-config"
import { createDefaultClockState, normalizeClockState, normalizeOptionalText, normalizeScheduleDependencyIds, normalizeSchedulePriority, normalizeSchedulerAuditKind, normalizeSchedulerSourceType, normalizeSchedulerState, syncSystemTimeFieldsFromClock } from "./state-scheduler"
import { clampInteger, cloneValsFile, cloneValue, createDefaultDoingState, createDefaultContactConversationState, createDefaultContactState, createDefaultSchedulerState, createDefaultShopState, normalizeText, readSystemNumber, resolveWeekday, writeSystemValue } from "./state-values"

/**
 * 从只读 bundle 创建一份可修改、可存档的新游戏快照。
 * @param bundle 编译后的故事内容。 @returns 变量深拷贝、默认领域状态、确定性时钟/RNG 和空播放记录组成的快照。
 * 所有可变对象都新建或复制，避免运行游戏时意外修改编译产物。
 */
export function createBaseSnapshot(bundle: RuntimeStoryBundle): RuntimeStorySessionSnapshot {
  const systemVals = cloneValsFile(bundle.systemVals)
  const clock = createDefaultClockState(systemVals, bundle.gameSettings?.start_time)
  const snapshot: RuntimeStorySessionSnapshot = {
    current_event_id: null,
    vals: cloneValsFile(bundle.vals),
    system_vals: systemVals,
    clock,
    rng: createRuntimeRngState(bundle),
    scheduler: createDefaultSchedulerState(),
    bags: createInitialBagsState(bundle, clock),
    contact: createDefaultContactState(),
    contact_conversation: createDefaultContactConversationState(),
    doing: createDefaultDoingState(),
    shop: createDefaultShopState(),
    triggered_once_events: [],
    loop_event_states: [],
    history: [],
    role_name_overrides: {},
    content_package_ids: [...(bundle.activePackageIds ?? [])],
    effective_content_hash: bundle.effectiveContentHash ?? bundle.contentHash ?? "",
    world_state: { ...(bundle.worldState ?? {}) }
  }

  syncSystemTimeFieldsFromClock(snapshot)

  return snapshot
}

/** @param snapshot 会话快照。 @returns 用户手动暂停或事件要求暂停时为 true；会先补齐旧存档调度字段。 */
export function isRuntimeTimePaused(snapshot: RuntimeStorySessionSnapshot) {
  normalizeSchedulerState(snapshot)
  const manualPause = snapshot.scheduler.manual_pause
  const eventPause = snapshot.scheduler.event_pause
  return manualPause || eventPause
}

/**
 * 将现实经过时间换算为待结算的游戏分钟。
 * @param snapshot 时钟快照。 @param deltaMs 本帧真实毫秒数。 @returns 是否成功累积了时间。
 * 暂停时不累积；速度来自系统变量。分钟先进入 pending，由固定步长结算，避免不同帧率产生不同事件顺序。
 */
export function queueClockProgress(snapshot: RuntimeStorySessionSnapshot, deltaMs: number) {
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

/** @param snapshot 时钟快照。 @returns pending 足够一个步长时推进并返回 true，否则不改变时间并返回 false。 */
export function advanceClockBySingleStep(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)

  if (snapshot.clock.pending_minutes < snapshot.clock.step_minutes) {
    return false
  }

  snapshot.clock.pending_minutes -= snapshot.clock.step_minutes
  snapshot.clock.total_minutes += snapshot.clock.step_minutes
  syncSystemTimeFieldsFromClock(snapshot)
  return true
}

/** @param snapshot 会话快照。 @param token 系统变量路径。 @param value 布尔新值。 @returns 无返回值；写入已有非 calc 变量。 */
export function setSystemBoolean(snapshot: RuntimeStorySessionSnapshot, token: string, value: boolean) {
  writeSystemValue(snapshot.system_vals, token, value)
}

/** @param snapshot 会话快照。 @param token 系统变量路径。 @param value 数字新值。 @returns 无返回值；写入已有非 calc 变量。 */
export function setSystemNumber(snapshot: RuntimeStorySessionSnapshot, token: string, value: number) {
  writeSystemValue(snapshot.system_vals, token, value)
}

/** @param snapshot 会话快照。 @returns 从故事起点累计的非负整数游戏分钟。 */
export function getCurrentGameMinute(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)
  return Math.max(0, clampInteger(snapshot.clock.total_minutes, 0))
}

/**
 * 追加一条带当前游戏时间的调度审计日志。
 * @param snapshot 会话快照。 @param entry 除 game_minute 外的日志内容。 @returns 无返回值；日志过长时仅保留最近记录。
 */
export function appendSchedulerAudit(
  snapshot: RuntimeStorySessionSnapshot,
  entry: Omit<RuntimeSchedulerAuditEntry, "game_minute">
) {
  normalizeSchedulerState(snapshot)

  const normalizedEntry = {
    kind: normalizeSchedulerAuditKind(entry.kind),
    game_minute: getCurrentGameMinute(snapshot),
    source_type: normalizeSchedulerSourceType(entry.source_type),
    source_id: normalizeOptionalText(entry.source_id),
    entry_event_id: normalizeOptionalText(entry.entry_event_id),
    due_game_minute: entry.due_game_minute === null || entry.due_game_minute === undefined
      ? null
      : Math.max(0, clampInteger(entry.due_game_minute, 0)),
    message: normalizeText(entry.message)
  }

  snapshot.scheduler.audit_logs.push(normalizedEntry)

  // 调度审计同时进入持久化历史，便于 L 消息面板呈现自动调度和运行结果；同一存档恢复时去重。
  const historyId = `scheduler:${snapshot.scheduler.audit_logs.length - 1}`
  if (!snapshot.history.some((item) => item.id === historyId)) {
    const baseDate = parseStoryDate(snapshot.clock.base_date) ?? { year: 1990, month: 1, day: 1 }
    const timestamp = new Date(Date.UTC(baseDate.year, baseDate.month - 1, baseDate.day) + normalizedEntry.game_minute * 60000).toISOString()
    snapshot.history.push({
      category: "system",
      type: "system",
      id: historyId,
      game_minute: normalizedEntry.game_minute,
      title: "系统调度",
      content: normalizedEntry.message,
      timestamp
    })
  }

  if (snapshot.scheduler.audit_logs.length > MAX_SCHEDULER_AUDIT_LOGS) {
    snapshot.scheduler.audit_logs = snapshot.scheduler.audit_logs.slice(-MAX_SCHEDULER_AUDIT_LOGS)
  }
}

/** @param snapshot 会话快照。 @param log 导演决策日志。 @returns 无返回值；深拷贝后追加并限制历史长度。 */
export function appendRuntimeDirectorLog(
  snapshot: RuntimeStorySessionSnapshot,
  log: RuntimeDirectorDecisionLog
) {
  normalizeSchedulerState(snapshot)
  snapshot.scheduler.director_logs.push(cloneValue(log))

  if (snapshot.scheduler.director_logs.length > MAX_RUNTIME_DIRECTOR_LOGS) {
    snapshot.scheduler.director_logs = snapshot.scheduler.director_logs.slice(-MAX_RUNTIME_DIRECTOR_LOGS)
  }
}

/**
 * 提取一次导演决策所需的稳定特征。
 * @param bundle 编译故事。 @param snapshot 当前快照。 @returns 时间、展平变量、已消费事件和最近历史的独立副本。
 */
export function buildRuntimeDirectorFeatureSnapshot(
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

/** @param snapshot 时钟快照。 @returns 根据 base_date 与累计分钟计算的当前公历年月日。 */
export function getCurrentDatePartsFromSnapshot(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)
  const baseDate = parseStoryDate(snapshot.clock.base_date) ?? { year: 1990, month: 1, day: 1 }
  const baseDayNumberUtc = datePartsToUtcDayNumber(baseDate)
  const dayOffset = Math.floor(snapshot.clock.total_minutes / MINUTES_PER_DAY)
  return utcDayNumberToDateParts(baseDayNumberUtc + dayOffset)
}

/** @param snapshot 时钟快照。 @returns 当前游戏日 00:00 对应的累计游戏分钟。 */
export function getStartOfCurrentDayGameMinute(snapshot: RuntimeStorySessionSnapshot) {
  const nowGameMinute = getCurrentGameMinute(snapshot)
  return Math.floor(nowGameMinute / MINUTES_PER_DAY) * MINUTES_PER_DAY
}

/** @param snapshot 会话快照。 @param eventId schedule 事件 id。 @returns 已存在或新建的循环调度记录。 */
export function getLoopSchedulerState(
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

/** @param input 每月日期输入。 @returns 限制在 1–31 的整数。 */
export function clampLoopMonthDay(input: unknown) {
  const value = clampInteger(input, 1)
  return Math.max(1, Math.min(31, value))
}

/** @param input 星期输入。 @returns 限制在周一 1 到周日 7 的整数。 */
export function clampLoopWeekday(input: unknown) {
  const value = clampInteger(input, 1)
  return Math.max(1, Math.min(7, value))
}

/** @param input 间隔天数输入。 @returns 至少为 1 的整数天数。 */
export function clampLoopIntervalDays(input: unknown) {
  const value = clampInteger(input, 1)
  return Math.max(1, value)
}

/** @param loopEvent 循环事件定义。 @returns `HH:mm` 转成的当天分钟偏移；格式异常时返回 0。 */
export function getLoopTimeOffsetMinutes(loopEvent: RuntimeLoopEventDefinition) {
  const rawAt = normalizeText(loopEvent.loop.at) || "00:00"
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(rawAt)

  if (!match) {
    return 0
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour * 60 + minute
}

/** @param parts 任意日期。 @returns 同年同月 1 日的新日期对象。 */
export function buildDatePartsAtStartOfMonth(parts: RuntimeDateParts) {
  return {
    year: parts.year,
    month: parts.month,
    day: 1
  }
}

/** @param parts 目标年月中的任意日期。 @returns 该月实际天数，使用相邻月份 UTC 日编号差计算。 */
export function getDaysInMonth(parts: RuntimeDateParts) {
  const firstDayNumber = datePartsToUtcDayNumber(buildDatePartsAtStartOfMonth(parts))
  const nextMonth = parts.month === 12
    ? { year: parts.year + 1, month: 1, day: 1 }
    : { year: parts.year, month: parts.month + 1, day: 1 }
  const nextMonthDayNumber = datePartsToUtcDayNumber(nextMonth)
  return nextMonthDayNumber - firstDayNumber
}

/** @param parts 起始日期。 @param days 增加的整天数，可跨月年。 @returns 新日期。 */
export function addDaysToDateParts(parts: RuntimeDateParts, days: number) {
  const currentDayNumber = datePartsToUtcDayNumber(parts)
  return utcDayNumberToDateParts(currentDayNumber + days)
}

/** @param parts 当前锚点日期。 @param monthDay 目标日。 @returns 下个月的目标日期，短月份自动落在月末。 */
export function getNextMonthlyDateParts(parts: RuntimeDateParts, monthDay: number) {
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

/** @param parts 当前日期。 @param monthDay 目标日。 @returns 本月目标日期，超过当月天数时取月末。 */
export function getCurrentMonthlyDateParts(parts: RuntimeDateParts, monthDay: number) {
  return {
    year: parts.year,
    month: parts.month,
    day: Math.min(monthDay, getDaysInMonth(parts))
  }
}

/** @param parts 当前日期。 @param monthDay 每月触发日。 @returns 严格晚于当前日的本月或下月首次到期日期。 */
export function getFirstMonthlyDueDateParts(parts: RuntimeDateParts, monthDay: number) {
  const currentMonthDateParts = getCurrentMonthlyDateParts(parts, monthDay)

  if (parts.day < currentMonthDateParts.day) {
    return currentMonthDateParts
  }

  return getNextMonthlyDateParts(parts, monthDay)
}

/** @param snapshot 时钟快照。 @param gameMinute 累计游戏分钟。 @returns 相对 base_date 换算出的公历日期。 */
export function getDatePartsFromGameMinute(
  snapshot: RuntimeStorySessionSnapshot,
  gameMinute: number
) {
  normalizeClockState(snapshot)
  const baseDate = parseStoryDate(snapshot.clock.base_date) ?? { year: 1990, month: 1, day: 1 }
  const baseDayNumberUtc = datePartsToUtcDayNumber(baseDate)
  const dayOffset = Math.floor(Math.max(0, clampInteger(gameMinute, 0)) / MINUTES_PER_DAY)
  return utcDayNumberToDateParts(baseDayNumberUtc + dayOffset)
}

/** @param gameMinute 累计游戏分钟。 @returns 0 到 1439 的当天分钟偏移。 */
export function getMinuteOffsetWithinDay(gameMinute: number) {
  const normalizedGameMinute = Math.max(0, clampInteger(gameMinute, 0))
  return ((normalizedGameMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

/** @param parts 起始日期。 @param months 非负月份数。 @returns 月份推进后的日期；目标月较短时取月末。 */
export function addMonthsToDateParts(parts: RuntimeDateParts, months: number) {
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

/** @param parts 起始日期。 @param years 非负年数。 @returns 年份推进后的日期；闰日会在平年落到 2 月末。 */
export function addYearsToDateParts(parts: RuntimeDateParts, years: number) {
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

/** @param snapshot 时钟快照。 @param parts 目标日期。 @param minuteOffsetWithinDay 当天分钟。 @returns 相对 base_date 的累计分钟。 */
export function getGameMinuteFromDateParts(
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

/**
 * 把脚本 `invoke_once` 延迟换算成绝对到期游戏分钟。
 * @param snapshot 当前时钟。 @param delay 数值与 hours/days/months/years 单位。 @returns 到期累计分钟。
 * 月、年按日历推进并保留当天时刻，不能简单按固定天数乘法，否则月底和闰年会漂移。
 */
export function resolveInvokeDelayDueGameMinute(
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

/** @param snapshot 时钟快照。 @param gameMinute 累计分钟。 @returns 从 base_day 开始计算的故事天数。 */
export function getGameDayFromGameMinute(
  snapshot: RuntimeStorySessionSnapshot,
  gameMinute: number
) {
  normalizeClockState(snapshot)
  const normalizedGameMinute = Math.max(0, clampInteger(gameMinute, 0))
  const dayOffset = Math.floor(normalizedGameMinute / MINUTES_PER_DAY)
  return snapshot.clock.base_day + dayOffset
}

/**
 * 计算 daily、weekly、monthly 或 interval_days 循环事件的下一次到期时间。
 * @param snapshot 当前时钟。 @param loopEvent 循环规则。 @param previousDueGameMinute 上次到期时间，首次为 null。
 * @returns 下一次绝对游戏分钟。首次触发一定安排在未来；后续基于上次到期点推进，避免帧延迟造成漂移。
 */
export function calculateNextLoopDueGameMinute(
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

/** @param snapshot 会话快照。 @param dedupeKey 调度去重键。 @returns 活动、未来或就绪队列任一处已有相同键时为 true。 */
export function isScheduledEventQueued(snapshot: RuntimeStorySessionSnapshot, dedupeKey: string) {
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

export interface RuntimeScheduleOrderConfig {
  priority?: number
  after?: string[]
  before?: string[]
}

/** @param loopEvent 循环事件定义。 @returns 供通用调度器使用的 priority、after、before 排序配置。 */
export function getLoopScheduleOrderConfig(loopEvent: RuntimeLoopEventDefinition): RuntimeScheduleOrderConfig {
  return {
    priority: loopEvent.loop.priority,
    after: loopEvent.loop.after,
    before: loopEvent.loop.before
  }
}

/**
 * 创建一个拥有稳定序号和规范字段的调度实例。
 * @param snapshot 会话快照。 @param sourceType 来源类型。 @param sourceId 来源事件 id。
 * @param entryEventId 实际进入的事件 id。 @param dueGameMinute 到期分钟。 @param dedupeKey 去重键。
 * @param triggerLocked 是否锁定触发。 @param callValues invoke 参数。 @param invokeTargetType 调用目标类型。
 * @param orderConfig 同时到期时的优先级和依赖。 @returns 尚未插入队列的 `ready` 调度对象。
 * 副作用是消耗并递增 snapshot.scheduler.next_seq，保证实例 id 和同级顺序稳定。
 */
export function createScheduledEvent(
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

/** @param snapshot 会话快照。 @returns 无返回值；按到期、依赖、优先级和 seq 原地排序就绪队列。 */
export function sortReadyQueue(snapshot: RuntimeStorySessionSnapshot) {
  normalizeSchedulerState(snapshot)
  sortScheduledEvents(snapshot.scheduler.ready_queue)
}

/**
 * 将立即可执行事件加入就绪队列。
 * @param snapshot 会话快照。 @param scheduledEvent 调度实例。 @param auditMessage 可选审计说明。
 * @returns 成功加入为 true；去重键为空或已存在为 false。成功时排序队列并追加审计日志。
 */
export function enqueueReadyEvent(
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

/**
 * 将未来事件加入定时队列。
 * @param snapshot 会话快照。 @param scheduledEvent 调度实例。 @param auditMessage 可选审计说明。
 * @returns 成功加入为 true；重复或无去重键为 false。成功时按确定性规则排序并记审计。
 */
export function enqueueScheduledEvent(
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
