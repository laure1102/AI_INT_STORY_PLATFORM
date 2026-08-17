/**
 * 连续联系人剧情与提醒。
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
import type { RuntimeStoryContactConversationDefinition, RuntimeStoryContactConversationNode, RuntimeStoryContactConversationOption, RuntimeStoryContactConversationRuntimeState, RuntimeStoryContactProactiveMessageRule, RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimeState, RuntimeStoryBundle } from "./contracts-view"
import { DEFAULT_MAX_CALC_NESTING_DEPTH } from "./contracts-view"
import { sendContactMessageFromContact } from "./contact-actions"
import { buildRuntimeContactMeta, findBundleContactConversation, findContactConversationNode, getBundleContactConfig, getBundleContactProfile, getContactScopeSpecificityScore, getContactTagOverlapScore, hasFinishedContactConversation, matchesContactLibraryScope } from "./contact-config"
import { appendContactMessage, assertRuntimeContactRoleKey, ensureContact, findRoleLabel, getContact, getContactThread } from "./contact-threads"
import { renderDialogueContent } from "./playback-render"
import { getCurrentGameMinute } from "./schedule-clock"
import { buildRuntimeContextValues } from "./script-context"
import { appendHistory, executeEventScript, queueInvokeEvent } from "./script-execution"
import { clampInteger, cloneValue, createCombinedValsFile, normalizeContactConversationHistoryState, normalizeContactConversationState, normalizeContactRoleKey, normalizeText, syncActiveContactConversationState } from "./state-values"

/**
 * 从联系人回复库中选择一条最合适的回复。
 * @param bundle 编译故事。 @param snapshot 当前状态。 @param roleKey 联系人键。 @param tags 本次话题标签。
 * @returns 按作用域具体度、标签重合度和配置顺序选出的回复；没有匹配时返回 null。
 * 只使用确定性评分和稳定顺序，不调用随机数，保证存档重放结果一致。
 */
export function chooseContactReply(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  tags: string[]
) {
  const normalizedRoleKey = normalizeContactRoleKey(roleKey)
  const normalizedTags = Array.from(new Set(tags.map((tag) => normalizeText(tag)).filter(Boolean)))
  const contact = getContact(snapshot, normalizedRoleKey)
  const meta = buildRuntimeContactMeta(
    bundle,
    normalizedRoleKey,
    contact?.favor ?? getBundleContactProfile(bundle, normalizedRoleKey)?.initial_favor ?? 20,
    snapshot
  )
  const fallbackReplies = getBundleContactConfig(bundle).fallback_replies
  const replyEntries = getBundleContactConfig(bundle).reply_library
    .filter((entry) => {
      const entryTags = Array.from(new Set((entry.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      if (entryTags.length > 0 && normalizedTags.length > 0 && !entryTags.some((tag) => normalizedTags.includes(tag))) {
        return false
      }

      return entry.replies.length > 0 && matchesContactLibraryScope(entry.scope, meta)
    })
    .sort((left, right) => {
      const leftTags = Array.from(new Set((left.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      const rightTags = Array.from(new Set((right.tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)))
      const tagDelta = getContactTagOverlapScore(rightTags, normalizedTags) - getContactTagOverlapScore(leftTags, normalizedTags)
      if (tagDelta !== 0) {
        return tagDelta
      }

      const specificityDelta =
        getContactScopeSpecificityScore(right.scope, normalizedRoleKey)
        - getContactScopeSpecificityScore(left.scope, normalizedRoleKey)
      if (specificityDelta !== 0) {
        return specificityDelta
      }

      return left.id.localeCompare(right.id, "zh-Hans-CN")
    })
  const replyEntry = replyEntries[0]
  if (replyEntry && replyEntry.replies.length > 0) {
    const thread = getContactThread(snapshot, normalizedRoleKey)
    const previousReplyCount = thread?.messages.filter((message) => message.sender === "contact").length ?? 0
    return replyEntry.replies[previousReplyCount % replyEntry.replies.length] ?? replyEntry.replies[0] ?? ""
  }

  for (const tag of normalizedTags) {
    const profileReplies = meta.profile?.reply_by_tag?.[tag] ?? []
    if (profileReplies.length > 0) {
      return profileReplies[0] ?? ""
    }

    const fallbackTagReplies = fallbackReplies[tag] ?? []
    if (fallbackTagReplies.length > 0) {
      return fallbackTagReplies[0] ?? ""
    }
  }

  const defaultReplies = fallbackReplies.default ?? []
  return defaultReplies[0] ?? ""
}

/** @param snapshot 会话快照。 @param roleKey 联系人键。 @param ruleId 主动规则 id。 @returns 最近一次由该规则产生的联系人消息或 null。 */
export function findLatestContactProactiveRuleMessage(
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  ruleId: string
) {
  const thread = getContactThread(snapshot, roleKey)
  return thread?.messages
    .slice()
    .reverse()
    .find((message) => message.sender === "contact" && message.source_rule_id === ruleId) ?? null
}

/** @param snapshot 会话快照。 @param roleKey 联系人键。 @param rule 主动消息规则。 @returns 按历史次数轮换选择的消息文本。 */
export function chooseContactProactiveRuleMessage(
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  rule: RuntimeStoryContactProactiveMessageRule
) {
  const thread = getContactThread(snapshot, roleKey)
  const previousCount = thread?.messages.filter(
    (message) => message.sender === "contact" && message.source_rule_id === rule.id
  ).length ?? 0

  if (rule.messages.length === 0) {
    return ""
  }

  return rule.messages[previousCount % rule.messages.length] ?? rule.messages[0] ?? ""
}

/**
 * 检查一条主动消息规则当前能否触发。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param roleKey 联系人键。 @param rule 规则定义。
 * @returns 联系人存在、好感/关系/表达式满足，且触发次数和冷却均允许时为 true。
 */
export function canFireContactProactiveRule(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  rule: RuntimeStoryContactProactiveMessageRule
) {
  if (!getContact(snapshot, roleKey)) {
    return false
  }

  const latestRuleMessage = findLatestContactProactiveRuleMessage(snapshot, roleKey, rule.id)
  if (latestRuleMessage) {
    const cooldownMinutes = Math.max(1, rule.cooldown_hours) * 60
    const minuteGap = Math.max(0, getCurrentGameMinute(snapshot) - latestRuleMessage.game_minute)
    if (minuteGap < cooldownMinutes) {
      return false
    }
  }

  const executionContext = buildRuntimeContextValues(bundle, snapshot, {})
  const combinedValsFile = createCombinedValsFile(snapshot)

  try {
    return evaluateStoryBooleanExpression(
      combinedValsFile,
      rule.trigger_expr,
      DEFAULT_MAX_CALC_NESTING_DEPTH,
      executionContext
    )
  } catch {
    return false
  }
}

/** @param snapshot 会话快照。 @returns 规范且尚未结束的结构化联系人剧情状态，否则为 null；会写回规范状态。 */
export function getActiveContactConversationState(snapshot: RuntimeStorySessionSnapshot) {
  snapshot.contact_conversation = normalizeContactConversationState(snapshot.contact_conversation)
  return snapshot.contact_conversation && !snapshot.contact_conversation.finished
    ? snapshot.contact_conversation
    : null
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @returns 活动状态对应的会话定义，没有或已被删除时为 null。 */
export function getActiveContactConversationDefinition(bundle: RuntimeStoryBundle, snapshot: RuntimeStorySessionSnapshot) {
  const activeState = getActiveContactConversationState(snapshot)
  return activeState ? findBundleContactConversation(bundle, activeState.conversation_id) : null
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @param roleKey 联系人键。 @returns 活动剧情会话是否禁止该联系人的普通聊天。 */
export function isContactConversationNormalChatLocked(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string
) {
  const normalizedRoleKey = normalizeContactRoleKey(roleKey)
  const activeState = getActiveContactConversationState(snapshot)
  if (!activeState || activeState.role_key !== normalizedRoleKey) {
    return false
  }

  const conversation = findBundleContactConversation(bundle, activeState.conversation_id)
  return Boolean(conversation?.lock_normal_chat)
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @param source StoryScript 布尔表达式。 @returns 空表达式或求值为真时为 true。 @throws 表达式错误时抛错。 */
export function evaluateContactConversationPredicate(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  source: string
) {
  const normalizedSource = normalizeText(source)
  if (!normalizedSource) {
    return true
  }

  const result = evaluateStoryBooleanExpression(
    createCombinedValsFile(snapshot),
    normalizedSource,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    buildRuntimeContextValues(bundle, snapshot, {})
  )
  return Boolean(result.result)
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @param option 玩家回复选项。 @returns 可见表达式通过时为 true；表达式异常安全降为 false。 */
export function isContactConversationOptionVisible(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  option: RuntimeStoryContactConversationOption
) {
  try {
    return evaluateContactConversationPredicate(bundle, snapshot, option.visible_expr)
  } catch {
    return false
  }
}

/**
 * 将当前会话节点预设的联系人消息依次加入联系人线程。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知数组。
 * @param conversation 会话定义。 @param node 当前节点。 @returns 实际追加的消息数量。
 * 每条消息都标记会话/节点来源，最后同步活动状态和提醒时间，便于存档后继续。
 */
export function appendContactConversationContactMessages(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  conversation: RuntimeStoryContactConversationDefinition,
  node: RuntimeStoryContactConversationNode
) {
  const roleKey = assertRuntimeContactRoleKey(bundle, conversation.role_key)
  ensureContact(bundle, runtimeState.snapshot, roleKey)

  for (const message of node.contact_messages) {
    const content = normalizeText(message.content)
    if (!content) {
      continue
    }

    sendContactMessageFromContact(bundle, runtimeState.snapshot, notifications, roleKey, content, {
      contactConversationId: conversation.id,
      contactConversationNodeId: node.id
    })
  }

  const activeState = syncActiveContactConversationState(runtimeState)
  if (
    activeState
    && activeState.conversation_id === conversation.id
    && activeState.node_id === node.id
  ) {
    activeState.last_reminder_game_minute = (
      getContactConversationReminderIntervalMinutes(node) > 0
      && getContactConversationReminderContent(node)
    )
      ? getCurrentGameMinute(runtimeState.snapshot)
      : null
    runtimeState.snapshot.contact_conversation = activeState
    runtimeState.activeContactConversation = activeState
  }
}

/** @param node 当前会话节点。 @returns 启用提醒时至少 1 分钟的间隔，未启用时为 0。 */
export function getContactConversationReminderIntervalMinutes(node: RuntimeStoryContactConversationNode) {
  if (!node.reminder?.enabled) {
    return 0
  }

  return Math.max(1, clampInteger(node.reminder.interval_minutes, 60))
}

/** @param node 当前会话节点。 @returns 从后向前找到的最后一条非空联系人消息，用作提醒文本。 */
export function getContactConversationReminderContent(node: RuntimeStoryContactConversationNode) {
  for (const message of node.contact_messages.slice().reverse()) {
    const content = normalizeText(message.content)
    if (content) {
      return content
    }
  }

  return ""
}

/**
 * 在时钟推进后补发活动联系人剧情的提醒消息。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知数组。
 * @returns 本次是否发出提醒。节点、间隔、文本或到期条件不满足时返回 false。
 * 发出后按当前游戏分钟更新下次提醒点，避免同一 tick 重复发送。
 */
export function reconcileActiveContactConversationReminder(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  const activeState = syncActiveContactConversationState(runtimeState)
  if (!activeState) {
    return false
  }

  const conversation = findBundleContactConversation(bundle, activeState.conversation_id)
  const node = findContactConversationNode(conversation, activeState.node_id)
  if (!conversation || !node || node.end || node.player_options.length === 0) {
    return false
  }

  const hasVisibleReply = node.player_options.some((option) =>
    isContactConversationOptionVisible(bundle, runtimeState.snapshot, option)
  )
  if (!hasVisibleReply) {
    return false
  }

  const intervalMinutes = getContactConversationReminderIntervalMinutes(node)
  const content = getContactConversationReminderContent(node)
  if (intervalMinutes <= 0 || !content) {
    return false
  }

  const nowGameMinute = getCurrentGameMinute(runtimeState.snapshot)
  if (activeState.last_reminder_game_minute === null || activeState.last_reminder_game_minute === undefined) {
    activeState.last_reminder_game_minute = nowGameMinute
    runtimeState.snapshot.contact_conversation = activeState
    runtimeState.activeContactConversation = activeState
    return false
  }

  const minuteGap = Math.max(0, nowGameMinute - activeState.last_reminder_game_minute)
  if (minuteGap < intervalMinutes) {
    return false
  }

  const message = sendContactMessageFromContact(
    bundle,
    runtimeState.snapshot,
    notifications,
    conversation.role_key,
    content,
    {
      contactConversationId: conversation.id,
      contactConversationNodeId: node.id,
      contactConversationReminder: true
    }
  )
  if (!message) {
    return false
  }

  activeState.last_reminder_game_minute = nowGameMinute
  runtimeState.snapshot.contact_conversation = activeState
  runtimeState.activeContactConversation = activeState
  return true
}

/**
 * 完成结构化联系人剧情并执行结束副作用。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。
 * @param conversation 会话定义。 @param node 结束节点。 @returns 成功完成为 true，没有活动状态为 false。
 * 结束脚本先执行，随后把状态标为 finished、移入历史并清空活动会话，确保保存后不会重复结算。
 */
export function completeContactConversation(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  conversation: RuntimeStoryContactConversationDefinition,
  node: RuntimeStoryContactConversationNode
) {
  const activeState = syncActiveContactConversationState(runtimeState)
  if (!activeState) {
    return false
  }

  activeState.finished = true
  activeState.node_id = node.id
  runtimeState.snapshot.contact_conversations = normalizeContactConversationHistoryState(runtimeState.snapshot.contact_conversations)

  const existingHistoryIndex = runtimeState.snapshot.contact_conversations.findIndex(
    (state) => state.conversation_id === activeState.conversation_id
  )
  const historyState = cloneValue(activeState)
  if (existingHistoryIndex >= 0) {
    runtimeState.snapshot.contact_conversations[existingHistoryIndex] = historyState
  } else {
    runtimeState.snapshot.contact_conversations.push(historyState)
  }

  executeEventScript(
    bundle,
    runtimeState,
    notifications,
    node.end_script,
    {},
    {}
  )

  if (node.invoke) {
    queueInvokeEvent(
      bundle,
      runtimeState,
      node.invoke.target_type,
      node.invoke.event_id,
      {},
      node.invoke.delay
    )
  }

  runtimeState.snapshot.contact_conversation = null
  runtimeState.activeContactConversation = null
  appendHistory(runtimeState.snapshot, {
    category: "system",
    type: "system",
    id: `contact-conversation:${conversation.id}`,
    title: conversation.title || conversation.id,
    content: "联系人剧情结束"
  })
  return true
}

/**
 * 启动一个结构化联系人剧情会话。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param conversationId 会话 id 输入。
 * @returns 新活动会话状态。 @throws id/联系人/入口节点无效、条件不满足或已有冲突会话时抛错。
 * 完成所有前置校验后才写活动状态，再发送入口节点消息，避免失败留下半启动状态。
 */
export function startContactConversation(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  conversationId: unknown
) {
  const normalizedConversationId = normalizeText(conversationId)
  if (!normalizedConversationId) {
    throw new Error("contact conversation id is required.")
  }

  const existingActiveState = syncActiveContactConversationState(runtimeState)
  if (existingActiveState && !existingActiveState.finished) {
    throw new Error(`联系人剧情 "${existingActiveState.conversation_id}" 正在进行中。`)
  }

  const conversation = findBundleContactConversation(bundle, normalizedConversationId)
  if (!conversation) {
    throw new Error(`contact conversation "${normalizedConversationId}" does not exist.`)
  }

  if (!conversation.enabled) {
    return false
  }

  if (conversation.once && hasFinishedContactConversation(runtimeState.snapshot, conversation.id)) {
    return false
  }

  const roleKey = assertRuntimeContactRoleKey(bundle, conversation.role_key)
  if (conversation.trigger_expr && !evaluateContactConversationPredicate(bundle, runtimeState.snapshot, conversation.trigger_expr)) {
    return false
  }

  const entryNode = findContactConversationNode(conversation, conversation.entry_node_id)
  if (!entryNode) {
    throw new Error(`contact conversation "${conversation.id}" entry node "${conversation.entry_node_id}" does not exist.`)
  }

  ensureContact(bundle, runtimeState.snapshot, roleKey)
  const nextState: RuntimeStoryContactConversationRuntimeState = {
    conversation_id: conversation.id,
    role_key: roleKey,
    node_id: entryNode.id,
    option_id: null,
    finished: false
  }
  runtimeState.snapshot.contact_conversation = nextState
  runtimeState.activeContactConversation = nextState

  appendContactConversationContactMessages(bundle, runtimeState, notifications, conversation, entryNode)
  appendHistory(runtimeState.snapshot, {
    category: "system",
    type: "system",
    id: `contact-conversation:${conversation.id}`,
    title: conversation.title || conversation.id,
    content: "联系人剧情开始"
  })

  if (entryNode.end) {
    completeContactConversation(bundle, runtimeState, notifications, conversation, entryNode)
  }

  return true
}

/**
 * 让玩家选择回复，并把会话推进到下一个节点或完成。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param optionId 玩家选择的选项 id。
 * @returns 推进后的活动状态，结束时返回完成结果。 @throws 没有活动会话、选项不存在/不可见或目标节点无效时抛错。
 * 玩家消息先记录，选项脚本再执行，然后切换节点；每一步状态都会进入可存档快照。
 */
export function advanceContactConversationReply(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  optionId: string
) {
  const activeState = syncActiveContactConversationState(runtimeState)
  if (!activeState) {
    throw new Error("当前没有进行中的联系人剧情。")
  }

  const conversation = findBundleContactConversation(bundle, activeState.conversation_id)
  if (!conversation) {
    throw new Error(`contact conversation "${activeState.conversation_id}" does not exist.`)
  }

  const currentNode = findContactConversationNode(conversation, activeState.node_id)
  if (!currentNode) {
    throw new Error(`contact conversation node "${activeState.node_id}" does not exist.`)
  }

  const normalizedOptionId = normalizeText(optionId)
  const option = currentNode.player_options.find((item) => item.id === normalizedOptionId)
  if (!option || !isContactConversationOptionVisible(bundle, runtimeState.snapshot, option)) {
    throw new Error(`联系人剧情回复 "${normalizedOptionId}" 当前不可用。`)
  }

  const renderedReplyText = renderDialogueContent(bundle, runtimeState.snapshot, option.text, {})
  const playerMessage = appendContactMessage(runtimeState.snapshot, activeState.role_key, "player", renderedReplyText, {
    read: true,
    optionId: option.id,
    optionKind: "talk",
    tags: ["conversation", conversation.id]
  })

  if (playerMessage) {
    appendHistory(runtimeState.snapshot, {
      category: "operation",
      type: "system",
      id: playerMessage.id,
      role_key: activeState.role_key,
      title: `contact:${activeState.role_key}`,
      content: `主角向 ${findRoleLabel(bundle, activeState.role_key, runtimeState.snapshot)} 发送剧情回复：${playerMessage.content}`
    })
  }

  executeEventScript(bundle, runtimeState, notifications, option.script, {}, {})

  const nextNodeId = normalizeText(option.next_node_id)
  if (!nextNodeId) {
    activeState.option_id = option.id
    activeState.finished = true
    completeContactConversation(bundle, runtimeState, notifications, conversation, currentNode)
    return true
  }

  const nextNode = findContactConversationNode(conversation, nextNodeId)
  if (!nextNode) {
    throw new Error(`contact conversation next node "${nextNodeId}" does not exist.`)
  }

  activeState.node_id = nextNode.id
  activeState.option_id = option.id
  runtimeState.snapshot.contact_conversation = activeState
  runtimeState.activeContactConversation = activeState
  appendContactConversationContactMessages(bundle, runtimeState, notifications, conversation, nextNode)

  if (nextNode.end) {
    completeContactConversation(bundle, runtimeState, notifications, conversation, nextNode)
  }

  return true
}
