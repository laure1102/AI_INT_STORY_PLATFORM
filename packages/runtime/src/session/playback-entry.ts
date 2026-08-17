/**
 * 管理一个前台事件从“准备进入”到“播放完成”的完整生命周期。
 *
 * 调度器只决定哪个事件获得前台执行权；本模块负责检查触发条件、运行 init/end 脚本、维护对白与
 * 消息游标、执行玩家分支、进入后继事件，并在整条链结束时把控制权交还调度器。
 *
 * 输入来源：已编译 bundle、会话内部 RuntimeState 和用户选择的 optionId。
 * 输出去向：snapshot 历史/变量/调度状态，以及 ViewModel 读取的当前播放状态。
 * 不负责：真实时间换算、持久化存档、UI 渲染和挑选下一个自然触发事件。
 */
import { executeStoryScript } from "../vals"
import type { RuntimeScheduledEvent, RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimeDialogueNodeState, RuntimeEnterEventOptions, RuntimeState, RuntimeStoryBundle } from "./contracts-view"
import { DEFAULT_MAX_CALC_NESTING_DEPTH } from "./contracts-view"
import { autoRegisterContactsFromEvent } from "./contact-actions"
import { createStandaloneEvent, getBundleGraphNode, getCurrentPlayableEvent, isCompiledAction, isCompiledEvent } from "./contact-threads"
import { buildDialogueView, buildMessageView, canEnterEvent, completeActiveScheduledEvent, completeScheduledChain, getPresentationDialogues, moveToEvent, pickFirstEnterableNextEventId, renderDialogueContent, resolveEventActions, settlePassiveEvents } from "./playback-render"
import { appendSchedulerAudit, calculateNextLoopDueGameMinute, enqueueReadyEvent, getCurrentGameMinute, getLoopSchedulerState } from "./schedule-clock"
import { clearCurrentEventState, getBundleScheduleEvents, reconcileScheduler } from "./schedule-queue"
import { findLocationLabel, getRuntimeActiveCallValues, getRuntimePlayableEventCallValues } from "./script-context"
import { appendHistory, buildInvokeAuditMessage, buildRuntimeScriptContext, enqueueStoryScriptInvocations, executeEventScript } from "./script-execution"
import { normalizeSchedulerState } from "./state-scheduler"
import { applyCombinedValsFile, cloneValue, createCombinedValsFile } from "./state-values"

/**
 * 事件进入的稳定兼容入口。
 *
 * 实际逻辑集中在 `enterCurrentEventResolved`；保留这个薄包装，使其他 Runtime 模块不必随内部拆分
 * 改变导入和调用方式。
 */
export function enterCurrentEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  return enterCurrentEventResolved(bundle, runtimeState, notifications)
}

/**
 * 把已到游戏时间的 scheduled 项提升到 ready 队列。
 *
 * 关键顺序是先把到期项从 `scheduled` 整批移除，再逐个入 ready；如果反过来，统一去重逻辑可能把
 * 它们误认为“仍在 scheduled 中”而拒绝入队。schedule 循环事件只在真正到点时检查 condition；
 * 条件为 false 时跳过本周期、计算下一周期，但不增加成功触发次数。
 */
export function promoteDueScheduledEventsResolved(
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
      // 循环事件在到点时才判断触发条件。提前判断会锁定旧变量值，晚于到点判断又可能错过周期。
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

/**
 * 将当前播放位置切换到指定 chain 事件，但暂不执行该事件。
 *
 * 先验证目标确实是事件节点，再按需要检查触发条件。成功时重置对白、消息和待选分支游标，同时
 * 携带上一分支产生的 branch values；真正执行 init_script 由随后调用的 enter 函数完成。
 * 返回 false 表示没有目标或目标条件不满足，调用方据此结束整条 scheduled chain。
 */
export function moveToEventResolved(
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
      category: "system",
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

/**
 * 正式进入当前事件并只执行一次入场副作用。
 *
 * 顺序是：读取当前节点 → 检查 condition → 执行 init_script → 自动登记联系人 → 写历史 →
 * 标记 entered 并初始化播放游标 → 解析可选行动。`currentEventEntered` 是幂等保护，避免每次刷新
 * ViewModel 都重复运行脚本。显式恢复旧存档时可用 `skipTriggerCheck` 重放已开始事件。
 */
export function enterCurrentEventResolved(
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
    // 条件不满足说明事件没有真正进入：不执行 init/end 脚本，清理前台状态并让 scheduler 继续。
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
      category: "system",
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

  autoRegisterContactsFromEvent(bundle, runtimeState.snapshot, currentNode, notifications)

  appendHistory(runtimeState.snapshot, {
    category: "story",
    type: "event",
    id: currentNode.id,
    title: currentNode.title
  })

  if (currentNode.presentation.type === "message") {
    appendHistory(runtimeState.snapshot, {
      category: "story",
      type: "system",
      id: `${currentNode.id}:message`,
      title: currentNode.title,
      content: renderDialogueContent(bundle, runtimeState.snapshot, currentNode.presentation.message.content, nextBranchValues, callValues)
    })
  }

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

/**
 * 完成当前事件，并决定停在行动选项、进入后继事件还是结束整条调度链。
 *
 * end_script 始终先执行，其产生的 branch values 会传给后续条件与脚本。如果事件存在行动分支，
 * 会保留前台事件等待用户选择；否则按声明顺序选择第一个可进入的 next。没有后继时统一调用
 * `completeScheduledChain` 清理 active、解除事件暂停，并让 scheduler 接管下一个事件。
 */
export function finishCurrentEvent(
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

/**
 * 执行玩家选中的 chain action 节点。
 *
 * optionId 必须来自当前 `pendingActions`，不能直接调用任意图节点。脚本在“全局值 + 系统值 +
 * branch/call 上下文”中执行；只有 `branch.*` 外部值会带到后继事件。脚本产生的 invoke 请求进入
 * scheduler，不会抢占当前前台事件。action 最多取第一个 next，符合 Core 的图结构约束。
 */
export function executeAction(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  optionId: string,
  notifications: string[]
) {
  const sourceEvent = getCurrentPlayableEvent(bundle, runtimeState)
  const targetActionState = runtimeState.pendingActions.find((item) => item.nodeId === optionId)
  if (!targetActionState) {
    const message = `未找到操作分支：${optionId}`
    notifications.push(message)
    appendHistory(runtimeState.snapshot, {
      category: "operation",
      type: "action",
      id: `action-failed:${optionId}`,
      title: "分支选择失败",
      content: message
    })
    return
  }

  const actionNode = getBundleGraphNode(bundle, targetActionState.nodeId)
  if (!isCompiledAction(actionNode)) {
    const message = `节点 "${optionId}" 不是操作节点。`
    notifications.push(message)
    appendHistory(runtimeState.snapshot, {
      category: "operation",
      type: "action",
      id: `action-failed:${optionId}`,
      title: "分支选择失败",
      content: message
    })
    return
  }

  const executionContext = buildRuntimeScriptContext(
    bundle,
    runtimeState,
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
  // StoryScript 可能返回其他外部命名空间；分支只拥有 branch.*，不能把 call.* 等只读上下文带走。
  for (const [token, value] of Object.entries(scriptResult.externalValues)) {
    if (!token.startsWith("branch.")) {
      continue
    }

    nextBranchValues[token.slice("branch.".length)] = cloneValue(value)
  }

  appendHistory(runtimeState.snapshot, {
    category: "operation",
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

/**
 * 将内部播放游标投影成客户端当前可展示的事件状态。
 *
 * 只有事件已完成 enter 后才返回内容；message/dialogue 会在这里按当前变量渲染模板，但不会推进
 * 游标或执行脚本。pendingActions 优先于重新解析结果，以便 v2 存档恢复时精确保留待选分支。
 */
export function getCurrentEventState(
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
