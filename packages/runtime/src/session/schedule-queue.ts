/**
 * 协调所有事件来源进入统一的 scheduler，并保证一次只播放一个前台事件。
 *
 * 事件可能来自 chain 根节点、pool 自然事件、schedule 到期事件、玩家 Doing、联系人/脚本 invoke。
 * 它们不会各自直接改 `current_event_id`，而是先进入 `scheduled` 或 `ready_queue`，再由本模块按统一
 * 规则选出 `active`。这样时间暂停、去重、审计和存档恢复不会因事件来源不同而出现多套语义。
 *
 * 输入来源：编译 bundle、当前游戏分钟、导演决策和各领域排队请求。
 * 输出去向：snapshot.scheduler、当前事件播放状态与调度审计日志。
 * 不负责：执行事件脚本、推进对白游标、保存 snapshot 或渲染界面。
 */
import {
  createRuntimeDirectorDecisionLog,
  type RuntimeDirectorCandidate,
  type RuntimeStoryDirector
} from "../director"
import type { RuntimeEventTriggerMode, RuntimeStoryPresentation, RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimeGraphNode, RuntimeLoopEventDefinition, RuntimeState, RuntimeStoryBundle } from "./contracts-view"
import { assertRuntimeDoingId, findBundleDoing, resolveDoingAvailability } from "./doing-shop"
import { reconcileContactAutoMessages } from "./contact-actions"
import { reconcileActiveContactConversationReminder } from "./contact-conversations"
import { createStandaloneEvent, getBundleChainNodes, getBundleGraphNode, isCompiledEvent } from "./contact-threads"
import { enterCurrentEventResolved, moveToEventResolved, promoteDueScheduledEventsResolved } from "./playback-entry"
import { canEnterEvent, settlePassiveEvents } from "./playback-render"
import { appendRuntimeDirectorLog, appendSchedulerAudit, buildRuntimeDirectorFeatureSnapshot, calculateNextLoopDueGameMinute, createScheduledEvent, enqueueReadyEvent, enqueueScheduledEvent, getCurrentGameMinute, getLoopScheduleOrderConfig, getLoopSchedulerState, isScheduledEventQueued } from "./schedule-clock"
import { normalizeSchedulerState, syncSystemTimeFieldsFromClock } from "./state-scheduler"
import { clampInteger, cloneValue, isRuntimeEventScannable } from "./state-values"

/**
 * “到期 scheduled → ready”步骤的兼容入口。
 *
 * 具体实现与事件入场逻辑共享在 playback-entry，保留此函数让旧内部导入路径继续可用。
 */
export function promoteDueScheduledEvents(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  return promoteDueScheduledEventsResolved(bundle, snapshot)
}

/**
 * 清空“正在播放某事件”的全部瞬时状态。
 *
 * 这些字段必须一起重置；只清 `current_event_id` 会把旧对白游标、分支值或 standalone 事件带进下一
 * 个事件。函数不清 scheduler.active，调用方需根据“跳过节点”还是“整条链完成”决定如何处理 active。
 */
export function clearCurrentEventState(runtimeState: RuntimeState) {
  runtimeState.snapshot.current_event_id = null
  runtimeState.activeStandaloneEvent = null
  runtimeState.currentEventEntered = false
  runtimeState.currentDialogueIndex = 0
  runtimeState.currentMessageElapsedMs = 0
  runtimeState.pendingActions = []
  runtimeState.lastAction = null
}

/**
 * 自动发现 chain 图的入口事件。
 *
 * 先收集所有事件节点的入边目标，再返回没有任何事件/行动指向它们的事件节点。无需在 story.json5
 * 保存 startEventId，编辑器只要维护图连接即可。返回顺序跟随 bundle 节点顺序，保证导演候选稳定。
 */
export function getGraphRootEventIds(bundle: RuntimeStoryBundle) {
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

/** 当前已有前台、active 或 ready 项时，阻止导演再塞入一个自然剧情入口。 */
export function hasPendingDirectorEntryEvent(snapshot: RuntimeStorySessionSnapshot) {
  normalizeSchedulerState(snapshot)

  return Boolean(
    snapshot.current_event_id
    || snapshot.scheduler.active
    || snapshot.scheduler.ready_queue.length > 0
  )
}

/**
 * 收集当前可自然进入的 chain root 与 pool 候选，并交给 Runtime Director 选择一个。
 *
 * 候选必须同时满足：可扫描、未消费、未在任一队列中、当前 trigger 通过。导演只能从候选集中选择；
 * 返回未知 id 时记录审计但不执行。选中项以 `trigger_locked: true` 进入 ready，表示条件已在扫描时
 * 确认，排队期间变量变化不会让一次已承诺的剧情入口突然消失。
 */
export function scanDirectorEntryEvents(
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
  // Chain 根节点每个存档只自然消费一次；invoke 仍可按显式规则调用同一事件。
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
  // Pool 事件除 consumed 标记外还检查历史触发记录，兼容旧 snapshot 的一次性状态字段。
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

/**
 * 校验并排队一次玩家主动 Doing。
 *
 * 前台事件进行中时拒绝发起，避免两个交互流程重叠。可见条件、锁定、once 和 cooldown 都由领域
 * availability 统一判断。每次主动操作使用新的 seq 组成 dedupe key，因此同一个可重复行动在不同
 * 时刻可以再次进入队列；冷却小时数作为内部 call value 随事件一起保存。
 */
export function queueDoingEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  doingId: string
) {
  normalizeSchedulerState(runtimeState.snapshot)
  if (runtimeState.snapshot.scheduler.active || runtimeState.snapshot.current_event_id) {
    throw new Error("当前事件进行中，暂不能发起行动。")
  }

  const normalizedDoingId = assertRuntimeDoingId(bundle, doingId)
  const doing = findBundleDoing(bundle, normalizedDoingId)
  if (!doing) {
    throw new Error(`行动 "${normalizedDoingId}" 不存在。`)
  }

  const availability = resolveDoingAvailability(bundle, runtimeState.snapshot, doing)
  if (!availability.visible) {
    throw new Error("该行动当前不可见。")
  }

  if (availability.disabled) {
    throw new Error(availability.disabledReason ?? "该行动当前不可执行。")
  }

  const nextSeq = runtimeState.snapshot.scheduler.next_seq
  const dedupeKey = `doing:${doing.id}:${nextSeq}`
  const scheduledEvent = createScheduledEvent(
    runtimeState.snapshot,
    "doing",
    doing.id,
    doing.id,
    getCurrentGameMinute(runtimeState.snapshot),
    dedupeKey,
    true,
    {
      __doing_cooldown_hours: Math.max(0, clampInteger(doing.cooldown_hours, 0))
    }
  )

  return enqueueReadyEvent(
    runtimeState.snapshot,
    scheduledEvent,
    `行动进入就绪队列：${doing.title}`
  )
}

/**
 * 读取当前 poolEvents，并兼容旧 bundle 的 onceEvents 字段。
 *
 * 兼容只发生在读取边界；内部调用方始终拿到统一数组，新 Compiler 不会重新写出旧字段名。
 */
export function getBundleOnceEvents(bundle: RuntimeStoryBundle) {
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

/** 读取当前 scheduleEvents，并兼容旧 bundle 的 loopEvents 字段。 */
export function getBundleScheduleEvents(bundle: RuntimeStoryBundle) {
  const scheduleEventsSource = Array.isArray(bundle.scheduleEvents)
    ? bundle.scheduleEvents
    : Array.isArray(bundle.loopEvents)
      ? bundle.loopEvents
      : []

  return scheduleEventsSource as RuntimeLoopEventDefinition[]
}

/**
 * 确保每个可扫描 schedule 事件始终拥有一个“下一次到期”计划。
 *
 * 首次运行或上周期完成后，loop state 的 next_due 为空，此时根据 daily/weekly/monthly/interval 规则
 * 计算下一分钟并记录审计。同一个 `事件 id + 到期分钟` 使用稳定 dedupe key，反复 reconcile 不会
 * 重复排入相同周期。
 */
export function ensureLoopSchedules(
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

/**
 * 在前台空闲时，从 ready_queue 启动下一项。
 *
 * ready_queue 已由 scheduler 排好到期时间、schedule 依赖、priority 和 seq；这里严格从队首取出。
 * 启动任何来源都会设置 active、开启 event_pause、清空未消费的 clock.pending_minutes，并初始化
 * 播放游标。pool/schedule/doing 用 standalone 事件，chain 则移动到图节点。找不到 bundle 目标时
 * 跳过坏队列项继续尝试下一项，避免整个会话卡死。
 */
export function startNextReadyEventIfIdle(
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
      // Pool 不属于 chain 图，用 activeStandaloneEvent 提供统一的播放接口。
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
      // Schedule 与 pool 一样作为 standalone 播放，但完成后还会更新 loop state 和下一周期。
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

    if (nextScheduledEvent.source_type === "doing") {
      // Doing 的表现结构与平面事件相同，执行完成时领域模块还会记录次数和冷却。
      const event = findBundleDoing(bundle, nextScheduledEvent.entry_event_id)

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
        message: "开始执行行动"
      })
      runtimeState.activeStandaloneEvent = createStandaloneEvent(
        "doing",
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

    // 其余来源是 chain root 或 chain invoke，入口 id 必须指向编译图中的事件节点。
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

/**
 * 对运行时调度状态执行一次完整对账。
 *
 * 顺序非常重要：先规范旧状态并提升到期项；再让导演补自然事件；再补下一周期 schedule；按需生成
 * 联系人提醒/主动消息；最后仅在空闲时启动一个 ready 项，并同步 system 时间变量。各操作都设计为
 * 可重复调用，创建会话、每个 clock step、事件完成和联系人操作后都能安全 reconcile。
 */
export function reconcileScheduler(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  options: {
    runContactAutoMessages?: boolean
  } = {}
) {
  normalizeSchedulerState(runtimeState.snapshot)
  promoteDueScheduledEventsResolved(bundle, runtimeState.snapshot)
  scanDirectorEntryEvents(bundle, runtimeState, runtimeState.storyDirector)
  ensureLoopSchedules(bundle, runtimeState)
  if (options.runContactAutoMessages) {
    reconcileActiveContactConversationReminder(bundle, runtimeState, notifications)
    reconcileContactAutoMessages(bundle, runtimeState, notifications)
  }
  startNextReadyEventIfIdle(bundle, runtimeState, notifications)
  syncSystemTimeFieldsFromClock(runtimeState.snapshot)
}
