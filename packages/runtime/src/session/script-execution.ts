/**
 * StoryScript 执行、调用校验与事件入队。
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
import type { CompiledAction, RuntimeHistoryEntry, RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimeState, RuntimeStoryBundle } from "./contracts-view"
import { DEFAULT_MAX_CALC_NESTING_DEPTH } from "./contracts-view"
import { getBundleGraphNode, isCompiledEvent } from "./contact-threads"
import { createScheduledEvent, enqueueReadyEvent, enqueueScheduledEvent, getCurrentGameMinute, resolveInvokeDelayDueGameMinute } from "./schedule-clock"
import { getBundleOnceEvents, getBundleScheduleEvents } from "./schedule-queue"
import { buildRuntimeReferContextValues, createRuntimeBagScriptFunctions, createRuntimeDoingScriptFunctions, createRuntimeContactScriptFunctions, createRuntimeShopScriptFunctions } from "./script-context"
import { normalizeClockState, normalizeInvokeTargetType } from "./state-scheduler"
import { applyCombinedValsFile, cloneValue, createCombinedValsFile, normalizeRuntimeEventTriggerMode, normalizeText } from "./state-values"

/**
 * 构造事件脚本可使用的完整安全执行上下文。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知数组。
 * @param branchValues 当前 action 分支变量。 @param callValues invoke 调用参数。 @returns 变量、称谓及背包/联系人/行动/商店白名单函数。
 * 返回的写函数只修改传入快照，不暴露文件系统、网络或任意 JavaScript 全局对象。
 */
export function buildRuntimeScriptContext(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  branchValues: Record<string, unknown>,
  callValues: Record<string, unknown> = {}
) {
  const snapshot = runtimeState.snapshot
  const referValues = buildRuntimeReferContextValues(bundle, snapshot)
  const combinedValues: Record<string, unknown> = {
    ...referValues
  }
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
    random: () => nextRuntimeRandom(snapshot.rng),
    functions: {
      ...createRuntimeBagScriptFunctions(bundle, snapshot),
      ...createRuntimeContactScriptFunctions(bundle, runtimeState, notifications),
      ...createRuntimeDoingScriptFunctions(bundle, snapshot),
      ...createRuntimeShopScriptFunctions(bundle, snapshot, notifications)
    }
  } satisfies StoryScriptExecutionContext
}

/** @param action chain 动作节点。 @returns 由动作 vars 初始值构成的分支变量对象，空名称会被忽略。 */
export function initializeActionValues(action: CompiledAction) {
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

/** @param snapshot 会话快照。 @param entry 不含时间戳的历史项。 @returns 无返回值；补当前确定性时间后追加到 history。 */
export function appendHistory(
  snapshot: RuntimeStorySessionSnapshot,
  entry: Omit<RuntimeHistoryEntry, "timestamp" | "game_minute">
) {
  snapshot.history.push({
    ...entry,
    game_minute: getCurrentGameMinute(snapshot),
    timestamp: getRuntimeTimestamp(snapshot)
  })
}

/** @param snapshot 时钟快照。 @returns 以 base_date 加累计游戏分钟计算的 ISO 时间，不读取真实系统时间。 */
export function getRuntimeTimestamp(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)
  const baseDate = parseStoryDate(snapshot.clock.base_date) ?? { year: 1990, month: 1, day: 1 }
  const baseTimestamp = Date.UTC(baseDate.year, baseDate.month - 1, baseDate.day)
  return new Date(baseTimestamp + snapshot.clock.total_minutes * 60000).toISOString()
}

/**
 * 执行一段 StoryScript，并把变量修改和 invoke 请求提交到运行状态。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。
 * @param script 脚本源码。 @param branchValues 当前分支变量。 @param callValues 调用参数。 @returns 脚本执行结果；空脚本返回空结果。
 * 普通/系统变量先合并执行，再按原组拆回；脚本产生的 invoke 最后统一入队，避免执行中途改变当前事件。
 */
export function executeEventScript(
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
    runtimeState,
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

/** @param bundle 编译故事。 @param eventId pool 事件 id。 @returns 对应事件，不存在时为 null。 */
export function findBundleOnceEvent(
  bundle: RuntimeStoryBundle,
  eventId: string
) {
  return getBundleOnceEvents(bundle).find((item) => item.id === eventId) ?? null
}

/** @param bundle 编译故事。 @param eventId schedule 事件 id。 @returns 对应事件，不存在时为 null。 */
export function findBundleLoopEvent(
  bundle: RuntimeStoryBundle,
  eventId: string
) {
  return getBundleScheduleEvents(bundle).find((item) => item.id === eventId) ?? null
}

/** @param bundle 编译故事。 @param targetType 调用集合类型。 @param eventId 目标 id。 @returns 对应 chain/pool/schedule 事件或 null。 */
export function findBundleInvokeTargetEvent(
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

/** @param targetType 调用目标类型。 @returns 面向用户的中文集合名称。 */
export function getInvokeTargetLabel(targetType: StoryInvokeTargetType) {
  const normalizedTargetType = normalizeInvokeTargetType(targetType)

  if (normalizedTargetType === "pool") {
    return "平面事件池事件"
  }

  if (normalizedTargetType === "schedule") {
    return "定时规则事件"
  }

  return "链式剧情线事件"
}

/** @param unit 延迟单位。 @returns 用于审计文案的中文单位。 */
export function getInvokeDelayUnitLabel(unit: StoryScriptInvokeDelay["unit"]) {
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

/** @param delay 可选调用延迟。 @returns “立即”或类似“2小时后”的审计文案。 */
export function formatInvokeDelayAuditLabel(delay: StoryScriptInvokeDelay | undefined) {
  if (!delay || delay.value <= 0) {
    return "立即"
  }

  return `${delay.value}${getInvokeDelayUnitLabel(delay.unit)}后`
}

/**
 * 生成人类可读的 invoke 调度审计信息。
 * @param targetType 目标集合。 @param eventId 事件 id。 @param args 调用参数。
 * @param mode 立即入队、未来调度或到期提升。 @param delay 可选延迟。 @returns 含目标、参数键和时机的中文日志。
 */
export function buildInvokeAuditMessage(
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

/**
 * 对照目标事件的 invoke_params 检查调用参数。
 * @param targetType 目标集合。 @param event 已查找到的目标事件或 null。 @param args 实际参数字典。
 * @returns `{ ok, message? }`；检查目标存在、必填参数、未知参数以及基础值类型，不修改参数。
 */
export function validateInvokeArgs(
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

/**
 * 将一次 StoryScript invoke 转换为立即或未来调度实例。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param targetType 目标集合。
 * @param eventId 事件 id。 @param args 调用参数。 @param delay 可选延迟。 @returns 是否成功入队。
 * 先验证目标和参数，再创建稳定去重键；零延迟进 ready_queue，其余按确定性日历时间进入 scheduled。
 */
export function queueInvokeEvent(
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

/** @param bundle 编译故事。 @param runtimeState 会话状态。 @param invocations 脚本执行产生的调用列表。 @returns 无返回值；按脚本原顺序逐个入队。 */
export function enqueueStoryScriptInvocations(
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
