/**
 * 组装并返回 RuntimeStorySession，是运行时唯一面向客户端的门面。
 *
 * HTML、Cocos 或测试代码只需要认识这个门面，不需要知道调度器、对白、联系人、行动、商城分别放在
 * 哪个模块。门面负责初始化/恢复共享状态，把外部 action 分发给领域函数，并在每次 tick 中协调
 * 消息播放、确定性时钟和调度器。
 *
 * 输入来源：Compiler 生成的 bundle、可选的玩家覆盖值、可选存档，以及可注入的时钟/导演实现。
 * 输出去向：客户端读取的 ViewModel、可保存 snapshot/playback，及领域 action 的执行结果。
 * 不负责：持久化存档文件、渲染 UI、修改故事源数据。
 */
import { createRuleBasedRuntimeDirector } from "../director"
import { normalizeRuntimeRngState } from "../rng"
import type { StoryInvokeTargetType } from "../types"
import type { CreateStorySessionOptions, RuntimeState, RuntimeStorySession, RuntimeStoryViewModel } from "./contracts-view"
import { createRuntimePlaybackState, toRuntimeActionState } from "./contracts-view"
import { giftBagItem } from "./bag-gifts"
import { buyShopProduct, giftShopProduct } from "./doing-shop"
import { sendContactAction, sendContactQuickMessage, sendContactTalk } from "./contact-actions"
import { advanceContactConversationReply } from "./contact-conversations"
import { assertRuntimeContactRoleKey, markContactThreadRead, restoreActiveStandaloneEvent } from "./contact-threads"
import { executeAction, finishCurrentEvent, getCurrentEventState } from "./playback-entry"
import { advanceCurrentMessagePresentation } from "./playback-render"
import { advanceClockBySingleStep, createBaseSnapshot, isRuntimeTimePaused, queueClockProgress, setSystemNumber } from "./schedule-clock"
import { queueDoingEvent, reconcileScheduler } from "./schedule-queue"
import { appendHistory, findBundleInvokeTargetEvent, getInvokeTargetLabel, queueInvokeEvent, validateInvokeArgs } from "./script-execution"
import { createDefaultClockState, normalizeInvokeTargetType, normalizeSchedulerState, syncSystemTimeFieldsFromClock } from "./state-scheduler"
import { applyCustomValuesToValsFile, clampInteger, clampNumber, cloneValue, createDefaultSchedulerState, normalizeBagsState, normalizeDoingState, normalizeContactConversationHistoryState, normalizeContactConversationState, normalizeContactState, normalizeShopState, normalizeText } from "./state-values"
import { buildViewModel } from "./view-model"

/**
 * 创建一个独立、可推进、可存档的故事运行时会话。
 *
 * 恢复层次按“bundle 默认值 → v3 save snapshot → playback 游标”组装。v1/v2 存档在读取任何领域
 * 状态前直接拒绝，避免把旧存档中的手机状态静默解释为联系人状态。
 * 返回对象保持稳定 API：客户端通过 `dispatch` 交互、`tick` 推进时间、getter 读取只读副本。
 */
export function createStorySession(options: CreateStorySessionOptions): RuntimeStorySession {
  if (options.saveState && options.saveState.schema_version !== 3) {
    const rawVersion = (options.saveState as { schema_version?: unknown }).schema_version
    const versionLabel = rawVersion === undefined ? "v1" : `v${String(rawVersion)}`
    throw new Error(`Save schema ${versionLabel} is incompatible with the contact runtime; only v3 saves are supported.`)
  }

  // 第 1 步：确定基础快照。读取存档时先克隆，避免会话运行过程反向修改调用方持有的 saveState；
  // 新游戏则从 bundle 的初始变量、背包、联系人、行动和商城配置创建快照。
  const now = options.now ?? options.wallClock?.() ?? new Date()
  const baseSnapshot = options.saveState
    ? cloneValue(options.saveState.session_state)
    : createBaseSnapshot(options.bundle)
  const notifications: string[] = []
  let screen: RuntimeStoryViewModel["screen"] = "game"
  const storyDirector = options.storyDirector ?? createRuleBasedRuntimeDirector()
  const savedPlayback = options.saveState?.playback
  const runtimeState: RuntimeState = {
    snapshot: baseSnapshot,
    currentEventEntered: Boolean(savedPlayback?.current_event_entered),
    currentDialogueIndex: Math.max(0, clampInteger(savedPlayback?.dialogue_index, 0)),
    currentMessageElapsedMs: Math.max(0, clampNumber(savedPlayback?.message_elapsed_ms, 0)),
    pendingActions: (savedPlayback?.pending_actions ?? []).map(toRuntimeActionState),
    lastAction: savedPlayback?.last_action ? toRuntimeActionState(savedPlayback.last_action) : null,
    activeStandaloneEvent: null,
    activeContactConversation: normalizeContactConversationState(baseSnapshot.contact_conversation),
    storyDirector
  }

  // 第 2 步：兼容旧快照中缺失的确定性基础设施与领域状态。
  // 所有 normalize 函数都只把缺失/旧格式收敛到当前结构，不能在加载时触发剧情或消耗资源。
  if (!runtimeState.snapshot.clock) {
    runtimeState.snapshot.clock = createDefaultClockState(
      runtimeState.snapshot.system_vals,
      options.bundle.gameSettings?.start_time
    )
  }

  if (!runtimeState.snapshot.scheduler) {
    runtimeState.snapshot.scheduler = createDefaultSchedulerState()
  }
  runtimeState.snapshot.rng = normalizeRuntimeRngState(runtimeState.snapshot.rng, options.bundle)

  normalizeBagsState(runtimeState.snapshot)
  normalizeContactState(runtimeState.snapshot)
  runtimeState.snapshot.contact_conversation = normalizeContactConversationState(runtimeState.snapshot.contact_conversation)
  runtimeState.snapshot.contact_conversations = normalizeContactConversationHistoryState(runtimeState.snapshot.contact_conversations)
  runtimeState.activeContactConversation = runtimeState.snapshot.contact_conversation ?? null
  normalizeDoingState(runtimeState.snapshot)
  normalizeShopState(runtimeState.snapshot)
  syncSystemTimeFieldsFromClock(runtimeState.snapshot)
  if (savedPlayback?.call_values && runtimeState.snapshot.scheduler.active) {
    runtimeState.snapshot.scheduler.active.call_values = cloneValue(savedPlayback.call_values)
  }
  runtimeState.activeStandaloneEvent = restoreActiveStandaloneEvent(
    options.bundle,
    runtimeState.snapshot
  )

  // 第 3 步：玩家自定义值只应用于“新游戏”。
  // 存档已经包含当时实际使用的变量，再叠加当前 profile 会篡改历史进度，所以 saveState 优先。
  if (!options.saveState && options.customOverrides) {
    applyCustomValuesToValsFile(runtimeState.snapshot.vals, options.customOverrides.custom_values)
    applyCustomValuesToValsFile(runtimeState.snapshot.system_vals, options.customOverrides.custom_values)
    runtimeState.snapshot.clock = createDefaultClockState(
      runtimeState.snapshot.system_vals,
      options.bundle.gameSettings?.start_time
    )
    syncSystemTimeFieldsFromClock(runtimeState.snapshot)
    notifications.push(`已加载角色自定义变量：${options.customOverrides.profile_name}`)
  }

  // 第 4 步：处理存档内容版本提示。
  // contentHash 不一致并不立即拒绝存档，因为单机编辑器常需要带旧档预览新 bundle；客户端会收到
  // 明确提示。存档 Schema 已在函数入口严格限定为 v3。
  if (options.saveState) {
    notifications.push(`已加载存档：${options.saveState.slot_id}`)
    const bundleHash = options.bundle.contentHash ?? options.bundle.generatedAt
    const saveHash = options.saveState.bundle_content_hash
    if (saveHash && bundleHash && saveHash !== bundleHash) {
      notifications.push("存档内容版本与当前故事不同，已按兼容模式加载。")
    }
  } else {
    notifications.push(`已创建运行时会话：${now.toISOString()}`)
  }

  // 第 5 步：恢复完成后统一对账调度器。它会补循环计划、提升到期项并在空闲时启动下一个事件。
  reconcileScheduler(options.bundle, runtimeState, notifications)

  /**
   * 校验并排队一次显式事件调用。
   *
   * 这里只把调用放入统一 scheduler，不直接“跳进”事件，避免绕过前台单事件限制、调用参数校验和
   * 审计日志。`notifyFailure` 区分脚本内部静默失败与用户主动操作需要看到的错误提示。
   */
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
    /**
     * 将客户端 action 分发到对应领域。
     *
     * dispatcher 是外部交互的唯一写入口：UI 不直接改 snapshot。每个领域错误被转换为 notification，
     * 保持会话可继续运行；成功后可能产生事件的操作会立即 reconcile 调度器。
     */
    dispatch(action) {
      // 纯界面 action 只切换 ViewModel screen，不改变故事进度。
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

      // Doing、商城和联系人属于独立领域，但最终的事件调用都进入同一个 scheduler，
      // 从而保证任何时刻只有一个前台事件播放。
      if (action.type === "start-doing") {
        try {
          const queued = queueDoingEvent(options.bundle, runtimeState, action.doingId)
          if (!queued) {
            notifications.push("行动未能进入队列。")
            return
          }
          reconcileScheduler(options.bundle, runtimeState, notifications)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "发起行动失败。")
        }
        return
      }

      if (action.type === "shop-buy") {
        try {
          buyShopProduct(options.bundle, runtimeState.snapshot, notifications, action.productId)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "购买商品失败。")
        }
        return
      }

      if (action.type === "bag-gift") {
        try {
          return giftBagItem(
            options.bundle,
            runtimeState.snapshot,
            notifications,
            action.itemId,
            action.roleKey,
            action.quantity
          )
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "赠送背包物品失败。")
          return false
        }
      }

      if (action.type === "shop-gift") {
        try {
          giftShopProduct(options.bundle, runtimeState.snapshot, notifications, action.productId, action.roleKey)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "赠送商品失败。")
        }
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

      if (action.type === "contact-mark-read") {
        try {
          const normalizedRoleKey = assertRuntimeContactRoleKey(options.bundle, action.roleKey)
          markContactThreadRead(runtimeState.snapshot, normalizedRoleKey)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "标记联系人消息已读失败。")
        }
        return
      }

      if (action.type === "contact-select-conversation-reply") {
        try {
          advanceContactConversationReply(options.bundle, runtimeState, notifications, action.optionId)
          reconcileScheduler(options.bundle, runtimeState, notifications)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "发送联系人剧情回复失败。")
        }
        return
      }

      if (action.type === "contact-send-quick-message") {
        try {
          sendContactQuickMessage(
            options.bundle,
            runtimeState,
            notifications,
            action.roleKey,
            action.quickMessageId
          )
          reconcileScheduler(options.bundle, runtimeState, notifications)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "发送联系人消息失败。")
        }
        return
      }

      if (action.type === "contact-send-talk") {
        try {
          sendContactTalk(
            options.bundle,
            runtimeState,
            notifications,
            action.roleKey,
            action.talkId
          )
          reconcileScheduler(options.bundle, runtimeState, notifications)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "发送联系人闲聊失败。")
        }
        return
      }

      if (action.type === "contact-send-action") {
        try {
          sendContactAction(
            options.bundle,
            runtimeState,
            notifications,
            action.roleKey,
            action.actionId
          )
          reconcileScheduler(options.bundle, runtimeState, notifications)
        } catch (error) {
          notifications.push(error instanceof Error ? error.message : "执行联系人动作失败。")
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
          // 当前句在用户确认“继续”时才写入历史，然后游标前进。游标到末尾后统一走事件结束流程，
          // 由它执行 end_script、处理分支或进入下一个事件。
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
    /**
     * 从外部显式调用一次 chain/pool/schedule 事件。
     * @param targetType 目标集合。 @param eventId 事件 id。 @param args 调用参数。 @returns 入队结果；参数无效时抛错。
     */
    invokeOnceEvent(targetType, eventId, args) {
      return invokeOnceEventResolved(targetType, eventId, args)
    },
    /**
     * 推进真实时间对应的游戏时间和消息表现。
     *
     * 先累计 delta，再按固定 clock step 一步步推进；每一步后都运行调度对账。如果事件在某一步到期，
     * `event_pause` 会立即阻止继续走时，避免一次大 delta 跨过本应播放的事件。RNG 和 clock 都保存在
     * snapshot 中，因此相同状态与输入可以在 HTML、Cocos 和测试中复现。
     */
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
          runContactAutoMessages: true
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
    /** @param paused 是否手动暂停。 @returns 无返回值；只修改 manual_pause，并同步系统时间镜像变量。 */
    setTimePause(paused: boolean) {
      normalizeSchedulerState(runtimeState.snapshot)
      runtimeState.snapshot.scheduler.manual_pause = Boolean(paused)
      syncSystemTimeFieldsFromClock(runtimeState.snapshot)
    },
    /** @param speed 游戏分钟相对现实时间的倍率。 @returns 无返回值；非法或负数按 0 写入系统变量。 */
    setTimeSpeed(speed: number) {
      const normalizedSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0
      setSystemNumber(runtimeState.snapshot, "system.time_speed", normalizedSpeed)
    },
    /** @returns 根据当前内部状态重新构建的客户端展示模型，以及本轮通知副本。 */
    getViewModel() {
      return buildViewModel(options.bundle, runtimeState, screen, [...notifications])
    },
    /** @returns 可安全保存或检查的快照深拷贝；调用方修改返回值不会影响正在运行的会话。 */
    getSnapshot() {
      // 对外返回深拷贝，防止客户端绕过 dispatch 直接修改运行时内部状态。
      runtimeState.snapshot.rng = normalizeRuntimeRngState(runtimeState.snapshot.rng, options.bundle)
      return cloneValue(runtimeState.snapshot)
    },
    /** @returns 当前事件进入阶段、对白/消息游标、分支和调用上下文组成的可存档播放状态。 */
    getPlaybackState() {
      // playback 只保存“如何继续当前事件”的瞬时游标，与 snapshot 中的持久领域状态分开。
      return createRuntimePlaybackState(runtimeState)
    }
  }
}
