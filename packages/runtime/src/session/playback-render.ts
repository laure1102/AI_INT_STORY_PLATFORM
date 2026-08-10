/**
 * 表现渲染、分支解析与事件导航。
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
import type { RuntimeStoryDialogueDefinition, RuntimeStoryMessagePresentation, RuntimeStoryPresentation, RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimeActionState, RuntimePlayableEvent, RuntimeRenderedDialogue, RuntimeRenderedMessage, RuntimeState, RuntimeStoryBundle } from "./contracts-view"
import { DEFAULT_MAX_CALC_NESTING_DEPTH } from "./contracts-view"
import { ensureDoingRecord } from "./doing-shop"
import { findRoleLabel, getBundleGraphNode, isCompiledAction, isCompiledEvent, isRuntimeStandaloneEvent } from "./contact-threads"
import { finishCurrentEvent, getCurrentEventState, moveToEventResolved } from "./playback-entry"
import { appendSchedulerAudit, getCurrentGameMinute, getGameDayFromGameMinute, getLoopSchedulerState } from "./schedule-clock"
import { clearCurrentEventState, reconcileScheduler } from "./schedule-queue"
import { buildRuntimeContextValues, getRuntimeEventCallValues } from "./script-context"
import { getRuntimeTimestamp, initializeActionValues } from "./script-execution"
import { normalizeSchedulerState } from "./state-scheduler"
import { clampInteger, createCombinedValsFile, normalizeRuntimeEventTriggerMode, normalizeText } from "./state-values"

/**
 * 用当前变量、称谓、分支值和调用参数渲染一段故事文本模板。
 * @param bundle 编译故事。 @param snapshot 当前快照。 @param content 模板源码。
 * @param branchValues 动作分支值。 @param callValues invoke 参数。 @returns 插值完成的显示文本。
 */
export function renderDialogueContent(
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

/** @param presentation 事件表现配置。 @returns 对白表现的对白数组；静默/消息表现返回空数组。 */
export function getPresentationDialogues(presentation: RuntimeStoryPresentation) {
  return presentation.type === "dialogue" ? presentation.dialogues : []
}

/** @param presentation 消息表现。 @returns 非负显示毫秒数，非法 duration 按 0 处理。 */
export function getMessageDurationMs(presentation: RuntimeStoryMessagePresentation) {
  const durationSeconds = Number.isFinite(presentation.message.duration_seconds)
    ? Math.max(0, presentation.message.duration_seconds)
    : 0
  return durationSeconds * 1000
}

/**
 * 根据已经播放的毫秒数创建当前消息视图。
 * @param bundle 编译故事。 @param snapshot 快照。 @param presentation 消息表现。 @param elapsedMs 已播放时间。
 * @param branchValues 分支值。 @param callValues 调用参数。 @returns 未播放完的渲染消息；到期或时长为 0 时返回 null。
 */
export function buildMessageView(
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

/**
 * 把一条对白定义转换成客户端可直接显示的视图。
 * @param bundle 编译故事。 @param snapshot 快照。 @param dialogue 对白定义。 @param index 当前索引。
 * @param total 总条数。 @param branchValues 分支值。 @param callValues 调用参数。 @returns 含说话者名称、渲染正文和进度的对白视图。
 */
export function buildDialogueView(
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

/**
 * 区分事件的玩家动作和无需选择的自动后继。
 * @param bundle 编译故事。 @param event 当前事件。 @returns `{ actions, autoNextEventIds }`；独立事件两者都为空。
 */
export function resolveEventActions(
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

/**
 * 按配置顺序找到第一个满足进入条件的后继事件。
 * @param bundle 编译故事。 @param snapshot 快照。 @param candidateEventIds 候选 id 顺序。
 * @param branchValues 分支值。 @param callValues 调用参数。 @returns 首个可进入 id，没有时为 null。
 */
export function pickFirstEnterableNextEventId(
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

/**
 * 结束当前调度链路并尝试启动下一项。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param completedEventTitle 可选完成标题。
 * @returns 下一个启动结果；副作用是清除播放状态、完成 active 调度并继续消费队列。
 */
export function completeScheduledChain(
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

/**
 * 判断事件触发条件是否允许进入。
 * @param bundle 编译故事。 @param snapshot 快照。 @param event 目标事件。 @param branchValues 分支值。
 * @param callValues 调用参数。 @returns default 总为 true，condition 求值结果，invoke 仅由已锁定调度上下文放行。
 */
export function canEnterEvent(
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

/** @param bundle 编译故事。 @param runtimeState 会话状态。 @param targetEventId 目标 chain 事件 id 或 null。 @param branchValues 分支值。 @returns 解析动作节点后实际进入的事件 id 或 null。 */
export function moveToEvent(
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

/**
 * 连续结算不需要玩家停留的静默事件和自动后继。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @returns 是否发生推进。
 * 最多循环 64 次，防止坏数据形成无交互自动环时卡死主线程。
 */
export function settlePassiveEvents(
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

/** @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param deltaMs 本帧毫秒。 @returns 是否推进了消息计时或完成事件。 */
export function advanceCurrentMessagePresentation(
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

/**
 * 标记当前 active 调度实例完成并释放事件暂停。
 * @param snapshot 会话快照。 @returns 被完成的调度实例；没有 active 时返回 null。
 * pool 事件会加入 consumed_once_ids，schedule 循环状态会更新，最后写审计并清空 active。
 */
export function completeActiveScheduledEvent(snapshot: RuntimeStorySessionSnapshot) {
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
        triggered_at: getRuntimeTimestamp(snapshot)
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
      matchedLoopEvent.last_triggered_at = getRuntimeTimestamp(snapshot)
      matchedLoopEvent.trigger_count = loopState.trigger_count
    } else {
      snapshot.loop_event_states.push({
        event_id: loopEvent,
        last_triggered_day: lastTriggeredGameDay,
        last_triggered_at: getRuntimeTimestamp(snapshot),
        trigger_count: loopState.trigger_count
      })
    }
  }

  if (activeScheduledEvent.source_type === "doing") {
    const doingRecord = ensureDoingRecord(snapshot, activeScheduledEvent.source_id)
    const completedGameMinute = getCurrentGameMinute(snapshot)
    const cooldownHours = Math.max(
      0,
      clampInteger(activeScheduledEvent.call_values?.__doing_cooldown_hours, 0)
    )

    doingRecord.used_count += 1
    doingRecord.last_used_game_minute = completedGameMinute
    doingRecord.cooldown_until_game_minute = cooldownHours > 0
      ? completedGameMinute + cooldownHours * 60
      : null
  }

  snapshot.scheduler.active = null
  snapshot.scheduler.event_pause = false
  return activeScheduledEvent
}
