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
import { evaluateStoryBooleanExpression } from "../vals"
import type { StoryInvokeTargetType } from "../types"
import type { CreateStorySessionOptions, RuntimeState, RuntimeStorySession, RuntimeStoryViewModel } from "./contracts-view"
import { createRuntimePlaybackState, toRuntimeActionState } from "./contracts-view"
import { giftBagItem } from "./bag-gifts"
import { buyShopProduct, giftShopProduct } from "./doing-shop"
import { sendContactAction, sendContactMessageFromContact, sendContactQuickMessage, sendContactTalk } from "./contact-actions"
import { advanceContactConversationReply, chooseContactReply } from "./contact-conversations"
import { assertRuntimeContactRoleKey, findContactTalkOption, findRoleLabel, markContactThreadRead, resolveContactActionOptionsForContact, restoreActiveStandaloneEvent } from "./contact-threads"
import { executeAction, finishCurrentEvent, getCurrentEventState } from "./playback-entry"
import { advanceCurrentMessagePresentation, renderDialogueContent } from "./playback-render"
import { advanceClockBySingleStep, createBaseSnapshot, isRuntimeTimePaused, queueClockProgress, setSystemNumber } from "./schedule-clock"
import { queueDoingEvent, reconcileScheduler } from "./schedule-queue"
import { appendHistory, findBundleInvokeTargetEvent, getInvokeTargetLabel, queueInvokeEvent, validateInvokeArgs } from "./script-execution"
import { createDefaultClockState, normalizeInvokeTargetType, normalizeSchedulerState, syncSystemTimeFieldsFromClock } from "./state-scheduler"
import { applyCustomValuesToValsFile, clampInteger, clampNumber, cloneValue, createCombinedValsFile, createDefaultSchedulerState, normalizeBagsState, normalizeDoingState, normalizeContactConversationHistoryState, normalizeContactConversationState, normalizeContactState, normalizeHistoryState, normalizeRoleNameOverrides, normalizeShopState, normalizeText } from "./state-values"
import { buildViewModel } from "./view-model"
import { orderEvolutionPackages, validateEvolutionPackage, type StoryEvolutionPackage, type StorySemanticContactIntent } from "@story-mgr/evolution"
import type { RuntimePackageInstallResult } from "./contracts-view"
import { createRuntimeContentRegistry, type RuntimeContentRegistry } from "../content-registry"

/**
 * 创建一个独立、可推进、可存档的故事运行时会话。
 *
 * 恢复层次按“bundle 默认值 → v5 save snapshot → playback 游标”组装。v4 及更早存档在读取任何领域
 * 状态前直接拒绝，避免把旧存档中的手机状态静默解释为联系人状态。
 * 返回对象保持稳定 API：客户端通过 `dispatch` 交互、`tick` 推进时间、getter 读取只读副本。
 */
export function createStorySession(options: CreateStorySessionOptions): RuntimeStorySession {
  if (options.saveState && options.saveState.schema_version !== 5) {
    const rawVersion = (options.saveState as { schema_version?: unknown }).schema_version
    const versionLabel = rawVersion === undefined ? "v1" : `v${String(rawVersion)}`
    throw new Error(`Save schema ${versionLabel} is incompatible with the evolution runtime; only v5 saves are supported.`)
  }

  // 第 1 步：确定基础快照。读取存档时先克隆，避免会话运行过程反向修改调用方持有的 saveState；
  // 新游戏则从 bundle 的初始变量、背包、联系人、行动和商城配置创建快照。
  const now = options.now ?? options.wallClock?.() ?? new Date()
  const contentRegistry: RuntimeContentRegistry = options.contentRegistry ?? createRuntimeContentRegistry({ baseBundle: options.bundle })
  options.bundle = contentRegistry.getEffectiveBundle()
  const baseSnapshot = options.saveState
    ? cloneValue(options.saveState.session_state)
    : createBaseSnapshot(options.bundle)
  const notifications: string[] = []
  let screen: RuntimeStoryViewModel["screen"] = "game"
  const storyDirector = options.storyDirector ?? createRuleBasedRuntimeDirector()
  const pendingPackages: StoryEvolutionPackage[] = []
  let pendingPackageSet: StoryEvolutionPackage[] | null = null
  const activePackages = new Map<string, StoryEvolutionPackage>()
  // bundle 中的内容已经物化；存档中的 package ids 只是索引，实际包仍由客户端同步后重新排队安装。
  const installedPackageIds = new Set(options.bundle.activePackageIds ?? [])
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

  /** 向运行历史写入一次系统或行动记录。 */
  function recordOperation(id: string, title: string, content: string, type: "system" | "action" = "system") {
    appendHistory(runtimeState.snapshot, {
      category: "operation",
      type,
      id,
      title,
      content
    })
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
  runtimeState.snapshot.history = normalizeHistoryState(runtimeState.snapshot.history)
  normalizeRoleNameOverrides(runtimeState.snapshot)
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

  /** 判断当前播放、分支、调度和联系人会话是否均已结束。 */
  function isSafeContentSwitchPoint(): boolean {
    return !runtimeState.snapshot.scheduler.active && runtimeState.pendingActions.length === 0 && !runtimeState.activeContactConversation && !getCurrentEventState(options.bundle, runtimeState)
  }

  /** 安装单包并同步 bundle、快照和活动包索引。 */
  function applyPackageToRuntime(pkg: StoryEvolutionPackage) {
    const registryResult = contentRegistry.queuePackage(pkg)
    if (!registryResult.queued && !registryResult.installed) throw new Error(registryResult.reason ?? "内容包无法排队。")
    const registryInstall = contentRegistry.applyPendingPackages()
    const effective = contentRegistry.getEffectiveBundle()
    Object.assign(options.bundle, effective)
    activePackages.set(pkg.package_id, pkg)
    for (const packageId of registryInstall.packageIds) installedPackageIds.add(packageId)
    runtimeState.snapshot.content_package_ids = [...installedPackageIds]
    runtimeState.snapshot.world_state = { ...(options.bundle.worldState ?? {}) }
    options.bundle.activePackageIds = [...runtimeState.snapshot.content_package_ids]
    runtimeState.snapshot.effective_content_hash = options.bundle.effectiveContentHash ?? options.bundle.contentHash ?? ""
    return registryInstall.packageIds.includes(pkg.package_id)
  }

  /** 把注册表完整替换结果同步到当前会话。 */
  function applyEffectiveRegistryResult(result: RuntimePackageInstallResult, packages: readonly StoryEvolutionPackage[]) {
    if (!result.installed && result.reason) return result
    const effective = contentRegistry.getEffectiveBundle()
    Object.assign(options.bundle, effective)
    installedPackageIds.clear()
    activePackages.clear()
    for (const packageId of result.packageIds) installedPackageIds.add(packageId)
    for (const pkg of packages) activePackages.set(pkg.package_id, structuredClone(pkg))
    runtimeState.snapshot.content_package_ids = [...installedPackageIds]
    runtimeState.snapshot.world_state = { ...(effective.worldState ?? {}) }
    runtimeState.snapshot.effective_content_hash = effective.effectiveContentHash ?? effective.contentHash ?? ""
    options.bundle.activePackageIds = [...installedPackageIds]
    return result
  }

  /** 将客户端 manifest 的完整包链与当前会话对齐。 */
  function reconcileEvolutionPackages(packages: readonly StoryEvolutionPackage[]): RuntimePackageInstallResult {
    const next = packages.map((pkg) => structuredClone(pkg))
    if (!isSafeContentSwitchPoint()) {
      pendingPackageSet = next
      return { installed: false, queued: true, packageIds: [...installedPackageIds] }
    }
    const result = contentRegistry.replacePackages(next)
    if (result.reason) return result
    pendingPackageSet = null
    pendingPackages.length = 0
    return applyEffectiveRegistryResult(result, next)
  }

  /** 校验单包，并在安全边界立即安装或进入等待队列。 */
  function queueEvolutionPackage(pkg: StoryEvolutionPackage): RuntimePackageInstallResult {
    const validation = validateEvolutionPackage(pkg, options.bundle.baseContentHash ?? options.bundle.contentHash)
    if (!validation.ok) return { installed: false, queued: false, packageIds: [...installedPackageIds], reason: validation.errors.join("；") }
    for (const parentId of pkg.parent_package_ids) if (!installedPackageIds.has(parentId) && !activePackages.has(parentId) && !pendingPackages.some((item) => item.package_id === parentId)) return { installed: false, queued: false, packageIds: [...installedPackageIds], reason: `父包未安装：${parentId}` }
    if (installedPackageIds.has(pkg.package_id) || pendingPackages.some((item) => item.package_id === pkg.package_id)) return { installed: false, queued: false, packageIds: [...installedPackageIds], reason: "内容包已经安装或排队。" }
    const parentsReady = pkg.parent_package_ids.every((parentId) => installedPackageIds.has(parentId) || activePackages.has(parentId))
    if (!isSafeContentSwitchPoint() || !parentsReady) {
      pendingPackages.push(pkg)
      return { installed: false, queued: true, packageIds: [...installedPackageIds] }
    }
    const installed = applyPackageToRuntime(pkg)
    if (!installed) {
      pendingPackages.push(pkg)
      return { installed: false, queued: true, packageIds: [...installedPackageIds], reason: "内容包等待父包安装。" }
    }
    return { installed: true, queued: false, packageIds: [...installedPackageIds] }
  }

  /** 在安全边界按父依赖应用所有待安装内容。 */
  function applyPendingEvolutionPackages(): RuntimePackageInstallResult {
    if (!isSafeContentSwitchPoint()) return { installed: false, queued: pendingPackages.length > 0 || pendingPackageSet !== null, packageIds: [...installedPackageIds] }
    if (pendingPackageSet) return reconcileEvolutionPackages(pendingPackageSet)
    let installed = false
    const pending = [...pendingPackages]
    pendingPackages.length = 0
    let orderedPending: StoryEvolutionPackage[]
    try { orderedPending = orderEvolutionPackages(pending) } catch { orderedPending = pending }
    for (const pendingPackage of orderedPending) {
      const result = contentRegistry.queuePackage(pendingPackage)
      if (!result.queued && !result.installed) {
        pendingPackages.push(pendingPackage)
        continue
      }
    }
    const registryResult = contentRegistry.applyPendingPackages()
    if (registryResult.installed) {
      const effective = contentRegistry.getEffectiveBundle()
      Object.assign(options.bundle, effective)
      for (const packageId of registryResult.packageIds) installedPackageIds.add(packageId)
      runtimeState.snapshot.content_package_ids = [...installedPackageIds]
      runtimeState.snapshot.world_state = { ...(effective.worldState ?? {}) }
      runtimeState.snapshot.effective_content_hash = effective.effectiveContentHash ?? effective.contentHash ?? ""
      options.bundle.activePackageIds = [...installedPackageIds]
      installed = true
    }
    return { installed, queued: pendingPackages.length > 0 || registryResult.queued, packageIds: [...installedPackageIds], reason: registryResult.reason }
  }

  /** 验证语义意图在当前联系人与变量状态下是否可用。 */
  function isSemanticContactIntentAvailable(entry: StorySemanticContactIntent, roleKey: string): boolean {
    if (entry.role_key !== roleKey || !Number.isFinite(entry.priority) || runtimeState.activeContactConversation) return false
    try { assertRuntimeContactRoleKey(options.bundle, roleKey) } catch { return false }
    const vals = createCombinedValsFile(runtimeState.snapshot)
    const world = runtimeState.snapshot.world_state ?? {}
    if (Object.keys(world).length > 0) vals.variables.push({ name: "world", vals: Object.entries(world).map(([name, value]) => ({ name, value_type: "value", value, calc_rule: "" })) })
    try {
      if (entry.condition_expr && !evaluateStoryBooleanExpression(vals, entry.condition_expr).result) return false
    } catch {
      return false
    }
    if (entry.response_kind === "talk") return Boolean(findContactTalkOption(options.bundle, roleKey, entry.response_id, runtimeState.snapshot))
    return Boolean(resolveContactActionOptionsForContact(options.bundle, roleKey, runtimeState.snapshot).find((action) => action.id === entry.response_id && !action.disabled))
  }

  /** 返回当前可供浏览器本地匹配的只读语义意图。 */
  function getAvailableSemanticContactIntents(roleKey?: string): StorySemanticContactIntent[] {
    return (options.bundle.semanticEntries ?? [])
      .filter((entry) => (!roleKey || entry.role_key === roleKey) && isSemanticContactIntentAvailable(entry, entry.role_key))
      .map((entry) => cloneValue(entry))
  }

  /** 二次校验浏览器匹配结果，并转发为现有 talk/action。 */
  function submitSemanticContactInput(roleKey: string, intentId: string, score: number): boolean {
    const entry = (options.bundle.semanticEntries ?? []).find((item) => item.id === intentId && item.role_key === roleKey)
    if (!entry || !Number.isFinite(score) || score < entry.min_score || score > 1 || !isSemanticContactIntentAvailable(entry, roleKey)) return false
    try {
      if (entry.response_kind === "talk") sendContactTalk(options.bundle, runtimeState, notifications, roleKey, entry.response_id)
      else sendContactAction(options.bundle, runtimeState, notifications, roleKey, entry.response_id)
    } catch { return false }
    reconcileScheduler(options.bundle, runtimeState, notifications)
    return true
  }

  /** 在未可靠匹配时发送联系人配置的本地兜底回复。 */
  function submitSemanticContactFallback(roleKey: string): boolean {
    if (runtimeState.activeContactConversation) return false
    try {
      const normalizedRoleKey = assertRuntimeContactRoleKey(options.bundle, roleKey)
      const reply = chooseContactReply(options.bundle, runtimeState.snapshot, normalizedRoleKey, ["semantic-fallback"])
        || "我暂时没听懂你的意思，可以换一种说法吗？"
      return Boolean(sendContactMessageFromContact(options.bundle, runtimeState.snapshot, notifications, normalizedRoleKey, reply))
    } catch {
      return false
    }
  }

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
  // 明确提示。存档 Schema 已在函数入口严格限定为 v5。
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
      const message = "调用事件时必须指定目标类型：chain、pool 或 schedule。"
      if (notifyFailure) {
        notifications.push(message)
      }
      recordOperation(`invoke-failed:${normalizedEventId}`, "调用事件失败", message)
      return false
    }

    const targetEvent = findBundleInvokeTargetEvent(options.bundle, normalizedTargetType, normalizedEventId)
    const validation = validateInvokeArgs(normalizedTargetType, targetEvent, normalizedArgs)

    if (!validation.ok || !targetEvent) {
      const message = validation.message || `${getInvokeTargetLabel(normalizedTargetType)} "${normalizedEventId}" 不存在。`
      if (notifyFailure) {
        notifications.push(message)
      }
      recordOperation(`invoke-failed:${normalizedEventId}`, "调用事件失败", message)
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
      const message = `${getInvokeTargetLabel(normalizedTargetType)} "${targetEvent.id}" 未能进入队列。`
      if (notifyFailure) {
        notifications.push(message)
      }
      recordOperation(`invoke-failed:${targetEvent.id}`, "调用事件失败", message)
      return false
    }

    reconcileScheduler(options.bundle, runtimeState, notifications)
    recordOperation(`invoke:${normalizedTargetType}:${targetEvent.id}`, "调用事件", `${getInvokeTargetLabel(normalizedTargetType)}：${targetEvent.title}`)
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

      if (action.type === "contact-semantic-input") {
        return submitSemanticContactInput(action.roleKey, action.intentId, action.score)
      }

      if (action.type === "contact-semantic-fallback") {
        return submitSemanticContactFallback(action.roleKey)
      }

      // Doing、商城和联系人属于独立领域，但最终的事件调用都进入同一个 scheduler，
      // 从而保证任何时刻只有一个前台事件播放。
      if (action.type === "start-doing") {
        try {
          const queued = queueDoingEvent(options.bundle, runtimeState, action.doingId)
          if (!queued) {
            const message = "行动未能进入队列。"
            notifications.push(message)
            recordOperation(`doing-failed:${action.doingId}`, "行动失败", message)
            return
          }
          recordOperation(`doing:${action.doingId}`, "行动", `发起行动：${action.doingId}`, "action")
          reconcileScheduler(options.bundle, runtimeState, notifications)
        } catch (error) {
          const message = error instanceof Error ? error.message : "发起行动失败。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `doing-failed:${action.doingId}`, title: "行动失败", content: message })
        }
        return
      }

      if (action.type === "shop-buy") {
        try {
          buyShopProduct(options.bundle, runtimeState.snapshot, notifications, action.productId)
        } catch (error) {
          const message = error instanceof Error ? error.message : "购买商品失败。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `shop-buy-failed:${action.productId}`, title: "购买失败", content: message })
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
          const message = error instanceof Error ? error.message : "赠送背包物品失败。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `bag-gift-failed:${action.itemId}:${action.roleKey}`, title: "赠礼失败", content: message })
          return false
        }
      }

      if (action.type === "shop-gift") {
        try {
          giftShopProduct(options.bundle, runtimeState.snapshot, notifications, action.productId, action.roleKey)
        } catch (error) {
          const message = error instanceof Error ? error.message : "赠送商品失败。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `shop-gift-failed:${action.productId}:${action.roleKey}`, title: "赠礼失败", content: message })
        }
        return
      }

      if (action.type === "submit-text") {
        notifications.push(`已提交输入字段：${action.field}`)
        appendHistory(runtimeState.snapshot, {
          category: "operation",
          type: "system",
          id: "submit-text",
          title: action.field,
          content: action.value
        })
        return
      }

      if (action.type === "submit-role-name") {
        const currentEventState = getCurrentEventState(options.bundle, runtimeState)
        const currentDialogue = currentEventState?.currentDialogue
        const requestedRoleKey = action.roleKey.trim()
        const roleNameInput = currentDialogue?.roleNameInput
        const surname = action.surname.trim()
        const givenName = action.givenName.trim()
        if (!currentDialogue || !roleNameInput || roleNameInput.roleKey !== requestedRoleKey) {
          const message = "当前没有等待提交的角色姓名。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `role-name-failed:${requestedRoleKey}`, title: "设置角色姓名失败", content: message })
          return false
        }
        if (runtimeState.snapshot.role_name_overrides[requestedRoleKey]) {
          const message = "该角色姓名已经设置，不能重复修改。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `role-name-failed:${requestedRoleKey}:already-set`, title: "设置角色姓名失败", content: message, role_key: requestedRoleKey })
          return false
        }
        if (!surname || !givenName) {
          const message = "角色姓和名都不能为空。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `role-name-failed:${requestedRoleKey}`, title: "设置角色姓名失败", content: message })
          return false
        }
        const roles = options.bundle.roles as { important?: { roles?: Array<{ id: string }> } } | null
        const roleId = requestedRoleKey.startsWith("important:") ? requestedRoleKey.slice("important:".length) : ""
        if (!roleId || !(roles?.important?.roles ?? []).some((role) => role.id === roleId)) {
          const message = "角色姓名目标无效。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `role-name-failed:${requestedRoleKey}`, title: "设置角色姓名失败", content: message })
          return false
        }
        runtimeState.snapshot.role_name_overrides[requestedRoleKey] = {
          surname,
          given_name: givenName
        }
        const roleLabel = findRoleLabel(options.bundle, requestedRoleKey, runtimeState.snapshot)
        notifications.push(`已设置${roleLabel}的姓名。`)
        appendHistory(runtimeState.snapshot, {
          category: "operation",
          type: "system",
          id: `role-name:${requestedRoleKey}:${currentDialogue.index}`,
          title: "设置角色姓名",
          content: `${roleLabel}：${surname}${givenName}`
        })
        appendHistory(runtimeState.snapshot, {
          category: "story",
          type: "dialogue",
          id: `${currentEventState.node.id}:${runtimeState.currentDialogueIndex}`,
          title: roleLabel,
          content: currentEventState.node.presentation.type === "dialogue"
            ? renderDialogueContent(
                options.bundle,
                runtimeState.snapshot,
                currentEventState.node.presentation.dialogues[runtimeState.currentDialogueIndex]?.content ?? currentDialogue.content,
                runtimeState.lastAction?.branchValues ?? {}
              )
            : currentDialogue.content,
          ...(currentDialogue.speakerKey !== "player" ? { role_key: currentDialogue.speakerKey } : {})
        })
        runtimeState.currentDialogueIndex += 1
        if (runtimeState.currentDialogueIndex >= currentDialogue.total) {
          finishCurrentEvent(options.bundle, runtimeState, notifications)
          applyPendingEvolutionPackages()
        }
        return true
      }

      if (action.type === "contact-mark-read") {
        try {
          const normalizedRoleKey = assertRuntimeContactRoleKey(options.bundle, action.roleKey)
          markContactThreadRead(runtimeState.snapshot, normalizedRoleKey)
        } catch (error) {
          const message = error instanceof Error ? error.message : "标记联系人消息已读失败。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `contact-read-failed:${action.roleKey}`, title: "联系人操作失败", content: message })
        }
        return
      }

      if (action.type === "contact-select-conversation-reply") {
        try {
          advanceContactConversationReply(options.bundle, runtimeState, notifications, action.optionId)
          reconcileScheduler(options.bundle, runtimeState, notifications)
          applyPendingEvolutionPackages()
        } catch (error) {
          const message = error instanceof Error ? error.message : "发送联系人剧情回复失败。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `contact-reply-failed:${action.optionId}`, title: "联系人回复失败", content: message })
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
          applyPendingEvolutionPackages()
        } catch (error) {
          const message = error instanceof Error ? error.message : "发送联系人消息失败。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `contact-talk-failed:${action.roleKey}:${action.quickMessageId}`, title: "联系人消息失败", content: message })
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
          applyPendingEvolutionPackages()
        } catch (error) {
          const message = error instanceof Error ? error.message : "发送联系人闲聊失败。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `contact-talk-failed:${action.roleKey}:${action.talkId}`, title: "联系人闲聊失败", content: message })
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
          applyPendingEvolutionPackages()
        } catch (error) {
          const message = error instanceof Error ? error.message : "执行联系人动作失败。"
          notifications.push(message)
          appendHistory(runtimeState.snapshot, { category: "operation", type: "system", id: `contact-action-failed:${action.roleKey}:${action.actionId}`, title: "联系人动作失败", content: message })
        }
        return
      }

      if (action.type === "continue") {
        const currentEventState = getCurrentEventState(options.bundle, runtimeState)

        if (!currentEventState) {
          const message = "当前没有可继续的事件。"
          notifications.push(message)
          recordOperation("continue-failed:no-event", "继续失败", message)
          return
        }

        if (currentEventState.currentDialogue) {
          // 当前句在用户确认“继续”时才写入历史，然后游标前进。游标到末尾后统一走事件结束流程，
          // 由它执行 end_script、处理分支或进入下一个事件。
          appendHistory(runtimeState.snapshot, {
            category: "story",
            type: "dialogue",
            id: `${currentEventState.node.id}:${runtimeState.currentDialogueIndex}`,
            title: currentEventState.currentDialogue.speakerLabel,
            content: currentEventState.currentDialogue.content,
            ...(currentEventState.currentDialogue.speakerKey !== "player"
              ? { role_key: currentEventState.currentDialogue.speakerKey }
              : {})
          })
          runtimeState.currentDialogueIndex += 1

          if (runtimeState.currentDialogueIndex >= currentEventState.currentDialogue.total) {
            finishCurrentEvent(options.bundle, runtimeState, notifications)
            applyPendingEvolutionPackages()
          }
          return
        }

        if (currentEventState.availableActions.length > 0) {
          const message = "当前事件需要先选择一个操作分支。"
          notifications.push(message)
          recordOperation(`continue-failed:${currentEventState.node.id}`, "继续失败", message)
          return
        }

        finishCurrentEvent(options.bundle, runtimeState, notifications)
        applyPendingEvolutionPackages()
        return
      }

      if (action.type === "select-option") {
        if (action.optionId === "continue") {
          this.dispatch({ type: "continue" })
          return
        }

        executeAction(options.bundle, runtimeState, action.optionId, notifications)
        applyPendingEvolutionPackages()
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
        applyPendingEvolutionPackages()
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
        applyPendingEvolutionPackages()
        return
      }

      syncSystemTimeFieldsFromClock(runtimeState.snapshot)
      applyPendingEvolutionPackages()
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
    /** @returns 当前基础 bundle 与活动演化包合并后的只读副本。 */
    getEffectiveBundle() {
      return contentRegistry.getEffectiveBundle()
    },
    getAvailableSemanticContactIntents,
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
    },
    queueEvolutionPackage,
    reconcileEvolutionPackages,
    applyPendingEvolutionPackages,
    submitSemanticContactInput,
    isSafeContentSwitchPoint
  }
}
