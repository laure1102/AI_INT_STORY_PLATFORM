/**
 * 角色标签、联系人线程与普通联系人选项。
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
import type { CompiledAction, CompiledEvent, RuntimeEventTriggerMode, RuntimeImportantRoleDefinition, RuntimeLocationAssignment, RuntimeNormalRoleDefinition, RuntimeContactEntryState, RuntimeContactMessageState, RuntimeContactThreadState, RuntimeStandaloneEvent, RuntimeStoryContactActionLibraryEntry, RuntimeStoryContactProactiveMessageRule, RuntimeStoryPresentation, RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimeGraphNode, RuntimePlayableEvent, RuntimeResolvedContactActionOption, RuntimeResolvedContactTalkOption, RuntimeState, RuntimeStoryBundle } from "./contracts-view"
import { findBundleDoing } from "./doing-shop"
import { buildRuntimeContactMeta, getBundleItemNameMap, getBundleContactConfig, getBundleContactProfile, getBundleContactQuickMessages, getLatestContactSuggestedOptionIds, matchesContactLibraryScope } from "./contact-config"
import { renderDialogueContent } from "./playback-render"
import { getCurrentGameMinute } from "./schedule-clock"
import { getBundleOnceEvents, getBundleScheduleEvents } from "./schedule-queue"
import { findBagEntry } from "./script-context"
import { clampInteger, cloneValue, normalizeBagQuantity, normalizeItemId, normalizeContactRoleKey, normalizeContactState, normalizeText, readSnapshotValue, readSystemNumber } from "./state-values"

/** @param node chain 图节点。 @returns 是否为具有剧情表现而非 exec_script 的事件节点，并收窄类型。 */
export function isCompiledEvent(node: RuntimeGraphNode | null | undefined): node is CompiledEvent {
  return Boolean(node && !("exec_script" in node))
}

/** @param node chain 图节点。 @returns 是否为包含 exec_script 的动作节点，并收窄类型。 */
export function isCompiledAction(node: RuntimeGraphNode | null | undefined): node is CompiledAction {
  return Boolean(node && "exec_script" in node)
}

/** @param node 可播放事件。 @returns 是否为从 pool/schedule/doing 临时构造的独立事件。 */
export function isRuntimeStandaloneEvent(node: RuntimePlayableEvent | null | undefined): node is RuntimeStandaloneEvent {
  return Boolean(node && "runtime_source_type" in node)
}

/** @param bundle 编译故事。 @param nodeId chain 节点 id。 @returns 图节点；id 为空或不存在时为 null。 */
export function getBundleGraphNode(bundle: RuntimeStoryBundle, nodeId: string | null) {
  if (!nodeId) {
    return null
  }

  return (getBundleChainNodes(bundle)[nodeId] as RuntimeGraphNode | undefined) ?? null
}

/** @param bundle 编译故事。 @returns 当前 chainEvents 字典，旧 bundle 则兼容读取 graphEvents。 */
export function getBundleChainNodes(bundle: RuntimeStoryBundle) {
  return bundle.chainEvents ?? bundle.graphEvents ?? {}
}

/**
 * 将 pool、schedule 或 doing 事件定义包装成统一可播放事件。
 * @param sourceType 来源领域。 @param event 原始事件定义。 @param triggerLocked 是否已在调度时锁定触发条件。
 * @param callValues invoke 调用参数。 @returns 带运行时来源标记和独立参数副本的事件。
 */
export function createStandaloneEvent(
  sourceType: "pool" | "schedule" | "doing",
  event: {
    id: string
    title: string
    trigger_expr?: string
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
    bgm?: string
  },
  callValues: Record<string, unknown> = {}
): RuntimeStandaloneEvent {
  return {
    runtime_source_type: sourceType,
    node_type: "event",
    id: event.id,
    title: event.title,
    trigger_expr: event.trigger_expr ?? "",
    trigger_mode: event.trigger_mode ?? "default",
    invoke_params: cloneValue(event.invoke_params ?? []),
    init_script: event.init_script,
    end_script: event.end_script,
    object_keys: cloneValue(event.object_keys),
    presentation: cloneValue(event.presentation),
    location: event.location,
    bgm: event.bgm ?? "",
    call_values: cloneValue(callValues),
    next: []
  }
}

/** @param bundle 编译故事。 @param runtimeState 会话状态。 @returns 当前独立事件或当前 chain 剧情事件；动作节点不直接返回。 */
export function getCurrentPlayableEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState
): RuntimePlayableEvent | null {
  if (runtimeState.activeStandaloneEvent) {
    return runtimeState.activeStandaloneEvent
  }

  const currentNode = getBundleGraphNode(bundle, runtimeState.snapshot.current_event_id)
  return isCompiledEvent(currentNode) ? currentNode : null
}

/**
 * 根据存档中的活动调度实例重建内存独立事件。
 * @param bundle 编译故事。 @param snapshot 已恢复快照。 @returns 对应 pool/schedule 事件，无法匹配时为 null。
 * 存档只保存稳定 id 和调用上下文，不保存整份事件副本，以免 bundle 更新后继续运行过期内容。
 */
export function restoreActiveStandaloneEvent(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
): RuntimeStandaloneEvent | null {
  const active = snapshot.scheduler.active
  if (!active || !snapshot.current_event_id) {
    return null
  }

  if (active.source_type === "pool" || (active.source_type === "invoke" && active.invoke_target_type === "pool")) {
    const event = getBundleOnceEvents(bundle).find((item) => item.id === snapshot.current_event_id)
    return event ? createStandaloneEvent("pool", event, active.call_values) : null
  }

  if (active.source_type === "schedule" || (active.source_type === "invoke" && active.invoke_target_type === "schedule")) {
    const event = getBundleScheduleEvents(bundle).find((item) => item.id === snapshot.current_event_id)
    return event ? createStandaloneEvent("schedule", event, active.call_values) : null
  }

  if (active.source_type === "doing") {
    const event = findBundleDoing(bundle, snapshot.current_event_id)
    return event ? createStandaloneEvent("doing", event, active.call_values) : null
  }

  return null
}

/** @param bundle 编译故事。 @returns 普通和重要角色数组均已补齐的角色集合。 */
export function getBundleRoles(bundle: RuntimeStoryBundle) {
  const roles = bundle.roles as {
    normal?: { roles?: RuntimeNormalRoleDefinition[] }
    important?: { roles?: RuntimeImportantRoleDefinition[] }
  } | null

  return {
    normal: roles?.normal?.roles ?? [],
    important: roles?.important?.roles ?? []
  }
}

/** @param bundle 编译故事。 @returns 地点分配数组；旧 bundle 没有地点时为空数组。 */
export function getBundleLocations(bundle: RuntimeStoryBundle) {
  const locations = bundle.eventLocations as {
    assignments?: RuntimeLocationAssignment[]
  } | null

  return locations?.assignments ?? []
}

/** @param bundle 编译故事。 @param roleKey 如 `normal:alice` 的角色键。 @returns 角色显示名；未知键原样返回，player 返回“主角”。 */
export function findRoleLabel(bundle: RuntimeStoryBundle, roleKey: string, snapshot?: RuntimeStorySessionSnapshot) {
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

  const override = snapshot?.role_name_overrides?.[`${scope}:${roleId}`]
  if (override?.surname && override.given_name) {
    return `${override.surname}${override.given_name}`
  }

  return normalizeText(role.name).trim() || role.descr.trim() || role.id
}

/** @param bundle 编译故事。 @param roleKey 带类别前缀的角色键。 @returns 是否指向 bundle 中现有非玩家角色。 */
export function isBundleRoleKey(bundle: RuntimeStoryBundle, roleKey: string) {
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

/** @param bundle 编译故事。 @param roleKey 未知输入。 @returns 规范且存在的联系人角色键。 @throws 为空或角色不存在时抛错。 */
export function assertRuntimeContactRoleKey(bundle: RuntimeStoryBundle, roleKey: unknown) {
  const normalizedRoleKey = normalizeContactRoleKey(roleKey)
  if (!normalizedRoleKey) {
    throw new Error("contact role key is required.")
  }

  if (!isBundleRoleKey(bundle, normalizedRoleKey)) {
    throw new Error(`contact role "${normalizedRoleKey}" does not exist in runtime role library.`)
  }

  return normalizedRoleKey
}

/** @param snapshot 会话快照。 @param roleKey 联系人角色键。 @returns 联系人状态，不存在时为 null。 */
export function getContact(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  normalizeContactState(snapshot)
  return snapshot.contact.contacts.find((contact) => contact.role_key === roleKey) ?? null
}

/** @param snapshot 会话快照。 @param roleKey 联系人角色键。 @returns 对应消息线程，不存在时为 null。 */
export function getContactThread(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  normalizeContactState(snapshot)
  return snapshot.contact.threads.find((thread) => thread.role_key === roleKey) ?? null
}

/** @param snapshot 会话快照。 @param roleKey 联系人角色键。 @returns 已存在或新建的空消息线程。 */
export function ensureContactThread(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  normalizeContactState(snapshot)
  const existing = getContactThread(snapshot, roleKey)
  if (existing) {
    return existing
  }

  const nextThread: RuntimeContactThreadState = {
    role_key: roleKey,
    messages: []
  }
  snapshot.contact.threads.push(nextThread)
  return nextThread
}

/**
 * 取得或创建联系人，并保证其消息线程存在。
 * @param bundle 编译故事。 @param snapshot 联系人状态。 @param roleKey 已校验角色键。 @returns 可变联系人状态。
 * 新联系人使用角色配置初始好感，解锁日期取当前故事日。
 */
export function ensureContact(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string
) {
  normalizeContactState(snapshot)
  const existing = getContact(snapshot, roleKey)
  if (existing) {
    return existing
  }

  const contactMeta = buildRuntimeContactMeta(
    bundle,
    roleKey,
    getBundleContactProfile(bundle, roleKey)?.initial_favor ?? 20,
    snapshot
  )
  const nextContact: RuntimeContactEntryState = {
    role_key: roleKey,
    favor: contactMeta.initialFavor,
    unlocked_at_day: Math.max(1, readSystemNumber(snapshot.system_vals, "system.now_day", 1))
  }
  snapshot.contact.contacts.push(nextContact)
  return nextContact
}

/** @param roleKey 联系人键。 @param gameMinute 消息游戏时间。 @param messageIndex 线程内序号。 @returns 可复现且适合作为键的消息 id。 */
export function createContactMessageId(roleKey: string, gameMinute: number, messageIndex: number) {
  const safeRoleKey = roleKey.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()
  return `contact-${safeRoleKey}-${gameMinute}-${messageIndex}`
}

/**
 * 向联系人线程追加一条规范消息。
 * @param snapshot 会话快照。 @param roleKey 联系人键。 @param sender 发送方。 @param content 消息正文。
 * @param options 已读状态、选项来源、会话节点和标签等元数据。 @returns 新建消息对象，同时写入线程。
 */
export function appendContactMessage(
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  sender: RuntimeContactMessageState["sender"],
  content: string,
  options: {
    read?: boolean
    optionId?: string
    optionKind?: "talk" | "action"
    quickMessageId?: string
    sourceRuleId?: string
    contactConversationId?: string
    contactConversationNodeId?: string
    contactConversationReminder?: boolean
    favorDelta?: number
    favorCooldownAnchor?: boolean
    tags?: string[]
  } = {}
) {
  const normalizedRoleKey = normalizeContactRoleKey(roleKey)
  const normalizedContent = normalizeText(content)

  if (!normalizedRoleKey || !normalizedContent) {
    return null
  }

  const thread = ensureContactThread(snapshot, normalizedRoleKey)
  const gameMinute = getCurrentGameMinute(snapshot)
  const nextMessage: RuntimeContactMessageState = {
    id: createContactMessageId(normalizedRoleKey, gameMinute, thread.messages.length + 1),
    sender,
    content: normalizedContent,
    game_minute: gameMinute,
    read: options.read ?? sender === "player",
    ...(options.optionId ? { option_id: normalizeText(options.optionId) } : {}),
    ...(options.optionKind ? { option_kind: options.optionKind } : {}),
    ...(options.quickMessageId ? { quick_message_id: options.quickMessageId } : {}),
    ...(options.sourceRuleId ? { source_rule_id: options.sourceRuleId } : {}),
    ...(options.contactConversationId ? { contact_conversation_id: normalizeText(options.contactConversationId) } : {}),
    ...(options.contactConversationNodeId ? { contact_conversation_node_id: normalizeText(options.contactConversationNodeId) } : {}),
    ...(options.contactConversationReminder ? { contact_conversation_reminder: true } : {}),
    ...(options.favorDelta !== undefined && Number.isFinite(options.favorDelta)
      ? { favor_delta: options.favorDelta }
      : {}),
    ...(options.favorCooldownAnchor !== undefined
      ? { favor_cooldown_anchor: options.favorCooldownAnchor }
      : {}),
    ...(options.tags && options.tags.length > 0
      ? { tags: Array.from(new Set(options.tags.map((tag) => normalizeText(tag)).filter(Boolean))) }
      : {})
  }

  thread.messages.push(nextMessage)
  return nextMessage
}

/** @param snapshot 会话快照。 @param roleKey 联系人键。 @returns 联系人或系统发来的未读消息数，不统计玩家自己的消息。 */
export function getContactUnreadCount(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  const thread = getContactThread(snapshot, roleKey)
  if (!thread) {
    return 0
  }

  return thread.messages.filter((message) => !message.read && message.sender !== "player").length
}

/** @param snapshot 会话快照。 @param roleKey 联系人键。 @returns 本次改为已读的消息数量；会原地修改消息状态。 */
export function markContactThreadRead(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  const thread = getContactThread(snapshot, roleKey)
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

/** @param snapshot 会话快照。 @param roleKey 联系人键。 @returns 最后一条内容、时间和线程总消息数，空线程用 null/0。 */
export function getLatestContactMessagePreview(snapshot: RuntimeStorySessionSnapshot, roleKey: string) {
  const thread = getContactThread(snapshot, roleKey)
  const lastMessage = thread?.messages[thread.messages.length - 1]

  return {
    preview: lastMessage?.content ?? null,
    gameMinute: lastMessage?.game_minute ?? null,
    messageCount: thread?.messages.length ?? 0
  }
}

/**
 * 合并全局话题库、联系人配置和关系阶段，生成当前可用聊天选项。
 * @param bundle 编译故事。 @param roleKey 联系人键。 @param snapshot 可选快照，用于条件表达式和阶段判断。
 * @returns 已去重、按配置顺序解析并带显示元数据的话题选项；不修改状态。
 */
export function resolveContactTalkOptionsForContact(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  snapshot?: RuntimeStorySessionSnapshot
): RuntimeResolvedContactTalkOption[] {
  const normalizedRoleKey = normalizeContactRoleKey(roleKey)
  if (!normalizedRoleKey) {
    return []
  }

  const contact = snapshot ? getContact(snapshot, normalizedRoleKey) : null
  const meta = buildRuntimeContactMeta(
    bundle,
    normalizedRoleKey,
    contact?.favor ?? getBundleContactProfile(bundle, normalizedRoleKey)?.initial_favor ?? 20,
    snapshot
  )
  if (!meta.canContact) {
    return []
  }

  const suggestedIds = getLatestContactSuggestedOptionIds(bundle, normalizedRoleKey, snapshot)
  const talkLibraryOptions = getBundleContactConfig(bundle).talk_library
    .filter((entry) => {
      const entryId = normalizeText(entry.id)
      if (!normalizeText(entry.text) || !matchesContactLibraryScope(entry.scope, meta)) {
        return false
      }

      return suggestedIds.size === 0 || suggestedIds.has(entryId)
    })
    .map((entry) => {
      const tags = Array.from(new Set((entry.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      return {
        id: normalizeText(entry.id),
        text: snapshot
          ? renderDialogueContent(bundle, snapshot, entry.text, {})
          : normalizeText(entry.text),
        tags,
        baseFavorDelta: Math.max(0, clampInteger(entry.base_favor_delta, 0)),
        cooldownHours: Math.max(0, clampInteger(entry.cooldown_hours, 0)),
        suggested: suggestedIds.has(normalizeText(entry.id)),
        preferred: tags.some((tag) => meta.preferredTags.has(tag)),
        invoke: entry.invoke,
        source: "talk-library"
      } satisfies RuntimeResolvedContactTalkOption
    })
    .filter((entry) => entry.id && entry.text)
  const legacyQuickMessages = getBundleContactQuickMessages(bundle)
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

      return suggestedIds.has(normalizeText(message.id))
    })
    .map((message) => {
      const tags = Array.from(new Set((message.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      return {
        id: normalizeText(message.id),
        text: snapshot
          ? renderDialogueContent(bundle, snapshot, message.text, {})
          : normalizeText(message.text),
        tags,
        baseFavorDelta: Math.max(0, clampInteger(message.base_favor_delta, 0)),
        cooldownHours: Math.max(0, clampInteger(message.cooldown_hours, 0)),
        suggested: suggestedIds.has(normalizeText(message.id)),
        preferred: tags.some((tag) => meta.preferredTags.has(tag)),
        source: "legacy-quick-message"
      } satisfies RuntimeResolvedContactTalkOption
    })
    .filter((entry) => entry.id && entry.text)

  const sortedOptions = [...talkLibraryOptions, ...legacyQuickMessages]
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
  const seenTexts = new Set<string>()

  return sortedOptions.filter((option) => {
    const textKey = normalizeText(option.text)
    if (!textKey || seenTexts.has(textKey)) {
      return false
    }

    seenTexts.add(textKey)
    return true
  })
}

/** @param bundle 编译故事。 @param roleKey 联系人键。 @returns 该联系人的主动消息规则，缺少档案时为空数组。 */
export function getContactProactiveRulesForContact(
  bundle: RuntimeStoryBundle,
  roleKey: string
): RuntimeStoryContactProactiveMessageRule[] {
  const profile = getBundleContactProfile(bundle, roleKey)
  if (!profile) {
    return []
  }

  return (profile.proactive_messages ?? [])
    .filter((rule) => rule.enabled && rule.messages.length > 0 && rule.trigger_expr.trim().length > 0)
    .sort((left, right) => left.id.localeCompare(right.id))
}

/** @param bundle 编译故事。 @param roleKey 联系人键。 @param talkId 话题 id。 @param snapshot 可选状态。 @returns 当前解析结果中的指定话题或 null。 */
export function findContactTalkOption(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  talkId: string,
  snapshot?: RuntimeStorySessionSnapshot
) {
  const normalizedTalkId = normalizeText(talkId)
  if (!normalizedTalkId) {
    return null
  }

  return resolveContactTalkOptionsForContact(bundle, roleKey, snapshot).find(
    (message) => message.id === normalizedTalkId
  ) ?? null
}

/** @param snapshot 会话快照。 @returns `player.money` 的数字余额；缺失或无法转换时为 null。 */
export function getPlayerMoneyBalance(snapshot: RuntimeStorySessionSnapshot) {
  const value = readSnapshotValue(snapshot, "player.money")
  const normalized = typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN

  return Number.isFinite(normalized) ? normalized : null
}

/**
 * 依次检查联系人互动动作的联系人、关系阶段、好感、金钱、物品和条件表达式。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param roleKey 联系人键。 @param action 动作定义。
 * @returns 可执行时为 null，否则返回第一个面向用户的禁用原因；只读，不扣资源。
 */
export function resolveContactActionDisabledReason(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  action: RuntimeStoryContactActionLibraryEntry
) {
  const contact = getContact(snapshot, roleKey)
  const meta = buildRuntimeContactMeta(
    bundle,
    roleKey,
    contact?.favor ?? getBundleContactProfile(bundle, roleKey)?.initial_favor ?? 20,
    snapshot
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

/**
 * 为联系人生成互动动作视图选项。
 * @param bundle 编译故事。 @param roleKey 联系人键。 @param snapshot 当前状态。
 * @returns 合并动作库、联系人限制和当前禁用原因后的选项数组；角色键无效时为空。
 */
export function resolveContactActionOptionsForContact(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  snapshot: RuntimeStorySessionSnapshot
): RuntimeResolvedContactActionOption[] {
  const normalizedRoleKey = normalizeContactRoleKey(roleKey)
  if (!normalizedRoleKey) {
    return []
  }

  const contact = getContact(snapshot, normalizedRoleKey)
  const meta = buildRuntimeContactMeta(
    bundle,
    normalizedRoleKey,
    contact?.favor ?? getBundleContactProfile(bundle, normalizedRoleKey)?.initial_favor ?? 20,
    snapshot
  )
  const itemNameMap = getBundleItemNameMap(bundle)

  return getBundleContactConfig(bundle).action_library
    .filter((entry) => normalizeText(entry.label) && normalizeText(entry.text) && matchesContactLibraryScope(entry.scope, meta))
    .map((entry) => {
      const tags = Array.from(new Set((entry.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      return {
        id: normalizeText(entry.id),
        label: renderDialogueContent(bundle, snapshot, entry.label, {}),
        text: renderDialogueContent(bundle, snapshot, entry.text, {}),
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
        disabledReason: resolveContactActionDisabledReason(bundle, snapshot, normalizedRoleKey, entry),
        invoke: entry.invoke
      } satisfies Omit<RuntimeResolvedContactActionOption, "disabled">
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
