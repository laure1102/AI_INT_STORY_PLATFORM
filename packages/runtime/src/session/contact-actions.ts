/**
 * 联系人自动消息、好感、花费和发送动作。
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
import type { RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimePlayableEvent, RuntimeResolvedContactActionOption, RuntimeState, RuntimeStoryBundle } from "./contracts-view"
import { buildRuntimeContactMeta, getBundleContactProfile } from "./contact-config"
import { canFireContactProactiveRule, chooseContactProactiveRuleMessage, chooseContactReply, getActiveContactConversationState, isContactConversationNormalChatLocked } from "./contact-conversations"
import { appendContactMessage, assertRuntimeContactRoleKey, ensureContact, findContactTalkOption, findRoleLabel, getContact, getContactProactiveRulesForContact, getContactThread, getPlayerMoneyBalance, isBundleRoleKey, resolveContactActionOptionsForContact } from "./contact-threads"
import { renderDialogueContent } from "./playback-render"
import { getCurrentGameMinute } from "./schedule-clock"
import { createRuntimeBagScriptFunctions, findBagEntry } from "./script-context"
import { appendHistory, queueInvokeEvent } from "./script-execution"
import { clampContactFavor, normalizeContactState, normalizeText, writeSnapshotValue } from "./state-values"

/**
 * 在时间推进后扫描并发送符合条件的联系人主动消息。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @returns 无返回值。
 * 结构化剧情会话进行中暂停普通主动消息；每个联系人每轮最多触发一条，避免同一 tick 消息轰炸。
 */
export function reconcileContactAutoMessages(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  normalizeContactState(runtimeState.snapshot)
  if (getActiveContactConversationState(runtimeState.snapshot)) {
    return
  }

  for (const contact of runtimeState.snapshot.contact.contacts) {
    const proactiveRules = getContactProactiveRulesForContact(bundle, contact.role_key)
    for (const rule of proactiveRules) {
      if (!canFireContactProactiveRule(bundle, runtimeState.snapshot, contact.role_key, rule)) {
        continue
      }

      const content = chooseContactProactiveRuleMessage(runtimeState.snapshot, contact.role_key, rule)
      if (!content) {
        continue
      }

      const message = sendContactMessageFromContact(
        bundle,
        runtimeState.snapshot,
        notifications,
        contact.role_key,
        content,
        {
          sourceRuleId: rule.id
        }
      )
      if (!message) {
        continue
      }

      if (rule.favor_delta !== 0) {
        contact.favor = clampContactFavor(contact.favor + rule.favor_delta, contact.favor)
      }
    }
  }
}

/**
 * 计算一次聊天或动作实际增加的好感度。
 * @param bundle 编译故事。 @param snapshot 快照。 @param roleKey 联系人键。 @param option 基础变化和冷却设置。
 * @returns 按该具体话题最近一次发送时间计算冷却后的实际变化量；不会直接修改好感度。
 */
export function calculateContactFavorDelta(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  option: {
    id: string
    baseFavorDelta: number
    cooldownHours: number
  }
) {
  const thread = getContactThread(snapshot, roleKey)
  const previousSameOptionMessage = thread?.messages
    .slice()
    .reverse()
    .find((message) => (
      message.sender === "player"
      && (message.option_id === option.id || message.quick_message_id === option.id)
      // 新消息明确标记冷却锚点；未标记的旧存档消息按历史操作兼容处理。
      && message.favor_cooldown_anchor !== false
    )) ?? null
  let favorDelta = Math.max(0, option.baseFavorDelta)

  if (option.cooldownHours > 0 && previousSameOptionMessage) {
    const cooldownMinutes = option.cooldownHours * 60
    const minuteGap = Math.max(0, getCurrentGameMinute(snapshot) - previousSameOptionMessage.game_minute)
    if (minuteGap < cooldownMinutes) {
      // 冷却按具体话题计算，期间即使发送了其它话题也不能再次获得该话题好感。
      favorDelta = 0
    }
  }

  const contact = ensureContact(bundle, snapshot, roleKey)
  if (contact.favor >= 80) {
    favorDelta = Math.max(0, favorDelta - 1)
  }

  return favorDelta
}

/**
 * 计算当前选项真正会写入联系人的好感变化。
 * 配置值还要经过话题冷却、关系阶段规则和 0~100 上限钳制，界面只能展示最终结果。
 */
export function calculateAppliedContactFavorDelta(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  option: {
    id: string
    baseFavorDelta: number
    cooldownHours: number
  }
) {
  const contact = ensureContact(bundle, snapshot, roleKey)
  const candidate = calculateContactFavorDelta(bundle, snapshot, roleKey, option)
  return clampContactFavor(contact.favor + candidate, contact.favor) - contact.favor
}

/** @returns 将实际好感变化写入联系人聊天线程的系统提示；变化为 0 时不追加。 */
export function appendContactFavorChangeMessage(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  appliedFavorDelta: number
) {
  if (appliedFavorDelta === 0) {
    return null
  }

  const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
  const sign = appliedFavorDelta > 0 ? "+" : ""
  return appendContactMessage(
    snapshot,
    normalizedRoleKey,
    "system",
    `与${findRoleLabel(bundle, normalizedRoleKey, snapshot)}的好友度 ${sign}${appliedFavorDelta}。`,
    { read: true }
  )
}

/** @returns 当前互动是否处于该话题的好感冷却中。冷却内重复消息不会成为新的锚点。 */
function isContactFavorCooldownActive(
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  option: { id: string; cooldownHours: number }
) {
  if (option.cooldownHours <= 0) {
    return false
  }

  const thread = getContactThread(snapshot, roleKey)
  const anchor = thread?.messages
    .slice()
    .reverse()
    .find((message) => (
      message.sender === "player"
      && (message.option_id === option.id || message.quick_message_id === option.id)
      && message.favor_cooldown_anchor !== false
    )) ?? null
  if (!anchor) {
    return false
  }

  return Math.max(0, getCurrentGameMinute(snapshot) - anchor.game_minute) < option.cooldownHours * 60
}

/**
 * 在剧情对白首次出现角色时自动加入允许联系的角色。
 * @param bundle 编译故事。 @param snapshot 联系人状态。 @param event 当前事件。 @param notifications UI 通知。 @returns 无返回值。
 * 只检查 dialogue 表现中的非玩家说话者，并尊重角色/档案的 contact_enabled 设置。
 */
export function autoRegisterContactsFromEvent(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  event: RuntimePlayableEvent,
  notifications: string[]
) {
  if (event.presentation.type !== "dialogue") {
    return
  }

  const speakerRoleKeys = Array.from(
    new Set(
      event.presentation.dialogues
        .filter((dialogue) => dialogue.speaker_type === "object")
        .map((dialogue) => normalizeText(dialogue.speaker_key))
        .filter(Boolean)
    )
  )

  for (const roleKey of speakerRoleKeys) {
    const contactMeta = buildRuntimeContactMeta(
      bundle,
      roleKey,
      getBundleContactProfile(bundle, roleKey)?.initial_favor ?? 20,
      snapshot
    )
    if (!contactMeta.enabled || !contactMeta.autoAdd) {
      continue
    }

    if (!isBundleRoleKey(bundle, roleKey)) {
      continue
    }

    const existed = Boolean(getContact(snapshot, roleKey))
    ensureContact(bundle, snapshot, roleKey)
    if (!existed) {
      notifications.push(`已新增联系人：${findRoleLabel(bundle, roleKey, snapshot)}`)
    }
  }
}

/**
 * 记录一条联系人发给玩家的消息。
 * @param bundle 编译故事。 @param snapshot 联系人状态。 @param notifications UI 通知。
 * @param roleKey 联系人键。 @param content 支持模板的正文。 @param options 主动规则或剧情会话来源信息。
 * @returns 新消息；会确保联系人存在、渲染模板、标记未读并推送通知。
 */
export function sendContactMessageFromContact(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  notifications: string[],
  roleKey: string,
  content: string,
  options: {
    sourceRuleId?: string
    contactConversationId?: string
    contactConversationNodeId?: string
    contactConversationReminder?: boolean
  } = {}
) {
  const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
  const renderedContent = renderDialogueContent(bundle, snapshot, content, {})
  ensureContact(bundle, snapshot, normalizedRoleKey)
  const message = appendContactMessage(snapshot, normalizedRoleKey, "contact", renderedContent, {
    read: false,
    sourceRuleId: options.sourceRuleId,
    contactConversationId: options.contactConversationId,
    contactConversationNodeId: options.contactConversationNodeId,
    contactConversationReminder: options.contactConversationReminder
  })
  if (!message) {
    return null
  }

  notifications.push(`联系人 ${findRoleLabel(bundle, normalizedRoleKey, snapshot)} 发来新消息。`)
  appendHistory(snapshot, {
    category: "system",
    type: "system",
    id: message.id,
    role_key: normalizedRoleKey,
    title: `contact:${normalizedRoleKey}`,
    content: `${findRoleLabel(bundle, normalizedRoleKey, snapshot)}: ${message.content}`
  })
  return message
}

/** @param bundle 编译故事。 @param snapshot 联系人状态。 @param roleKey 联系人键。 @param content 玩家消息模板。 @returns 已渲染并标记已读的玩家消息。 */
export function sendContactMessageToContact(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  content: string
) {
  const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
  const renderedContent = renderDialogueContent(bundle, snapshot, content, {})
  ensureContact(bundle, snapshot, normalizedRoleKey)
  const message = appendContactMessage(snapshot, normalizedRoleKey, "player", renderedContent, {
    read: true
  })
  if (!message) {
    return null
  }

  appendHistory(snapshot, {
    category: "operation",
    type: "system",
    id: message.id,
    role_key: normalizedRoleKey,
    title: "contact:player",
    content: `主角 -> ${findRoleLabel(bundle, normalizedRoleKey, snapshot)}: ${message.content}`
  })
  return message
}

/**
 * 扣除联系人动作声明的金钱和物品成本。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param action 已解析动作选项。 @returns 无返回值。
 * 调用方必须先完成 disabledReason 检查；本函数仍二次验证余额/库存，异常时抛错，防止竞态或脚本改值后透支。
 */
export function applyContactActionCosts(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  action: RuntimeResolvedContactActionOption
) {
  // 先完整校验余额和库存，再执行任何扣除，避免后续物品不足时只扣了部分金钱。
  if (action.costMoney > 0) {
    const currentMoney = getPlayerMoneyBalance(snapshot)
    if (currentMoney === null) {
      throw new Error("当前故事没有可写入的 player.money 变量，暂时无法支付。")
    }

    if (currentMoney < action.costMoney) {
      throw new Error(`需要 ${action.costMoney} 元，当前只有 ${Math.max(0, Math.trunc(currentMoney))} 元。`)
    }

  }

  const requiredItems = new Map<string, number>()
  for (const costItem of action.costItems) {
    if (!costItem.itemId || costItem.quantity <= 0) {
      continue
    }

    requiredItems.set(costItem.itemId, (requiredItems.get(costItem.itemId) ?? 0) + costItem.quantity)
  }

  for (const [itemId, quantity] of requiredItems) {
    const entry = findBagEntry(snapshot, "player", itemId)
    if (!entry || entry.quantity < quantity) {
      const label = action.costItems.find((item) => item.itemId === itemId)?.itemName ?? itemId
      throw new Error(`消耗物品失败：${label} x${quantity}`)
    }
  }

  if (action.costMoney > 0) {
    const currentMoney = getPlayerMoneyBalance(snapshot)
    if (currentMoney === null || !writeSnapshotValue(snapshot, "player.money", Math.max(0, Math.trunc(currentMoney - action.costMoney)))) {
      throw new Error("player.money 不是可写 value 变量，暂时无法支付。")
    }
  }

  for (const [itemId, quantity] of requiredItems) {
    if (itemId && quantity > 0) {
      const removed = createRuntimeBagScriptFunctions(bundle, snapshot).bag_remove("player", itemId, quantity)
      if (!removed) {
        throw new Error(`消耗物品失败：${itemId} x${quantity}`)
      }
    }
  }
}

/**
 * 执行一次普通联系人话题互动。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param roleKey 联系人键。 @param talkId 话题 id。
 * @returns 玩家消息、联系人回复和好感变化结果。 @throws 剧情会话锁定、话题不可用或条件不满足时抛错。
 */
export function sendContactTalk(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  roleKey: string,
  talkId: string
) {
  const snapshot = runtimeState.snapshot
  const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
  if (isContactConversationNormalChatLocked(bundle, snapshot, normalizedRoleKey)) {
    throw new Error("该联系人正在进行联系人剧情，暂时不能普通闲聊。")
  }

  const talkOption = findContactTalkOption(bundle, normalizedRoleKey, talkId, snapshot)

  if (!talkOption) {
    throw new Error(`contact talk "${talkId}" is not available for "${normalizedRoleKey}".`)
  }

  ensureContact(bundle, snapshot, normalizedRoleKey)
  const favorDelta = calculateContactFavorDelta(bundle, snapshot, normalizedRoleKey, talkOption)
  const favorCooldownActive = isContactFavorCooldownActive(snapshot, normalizedRoleKey, talkOption)
  const outgoingMessage = appendContactMessage(snapshot, normalizedRoleKey, "player", talkOption.text, {
    read: true,
    optionId: talkOption.id,
    optionKind: "talk",
    quickMessageId: talkOption.source === "legacy-quick-message" ? talkOption.id : undefined,
    tags: talkOption.tags,
    favorDelta,
    favorCooldownAnchor: !favorCooldownActive
  })
  if (!outgoingMessage) {
    return false
  }

  const contact = ensureContact(bundle, snapshot, normalizedRoleKey)
  const previousFavor = contact.favor
  contact.favor = clampContactFavor(previousFavor + favorDelta, previousFavor)
  const appliedFavorDelta = contact.favor - previousFavor
  outgoingMessage.favor_delta = appliedFavorDelta
  appendContactFavorChangeMessage(bundle, snapshot, normalizedRoleKey, appliedFavorDelta)

  appendHistory(snapshot, {
    category: "operation",
    type: "system",
    id: outgoingMessage.id,
    role_key: normalizedRoleKey,
    title: `contact:${normalizedRoleKey}`,
    content: `主角向 ${findRoleLabel(bundle, normalizedRoleKey, snapshot)} 发送消息：${outgoingMessage.content}；好感 ${appliedFavorDelta >= 0 ? "+" : ""}${appliedFavorDelta}（当前 ${contact.favor}）`
  })

  if (talkOption.invoke) {
    queueInvokeEvent(
      bundle,
      runtimeState,
      talkOption.invoke.target_type,
      talkOption.invoke.event_id,
      {},
      talkOption.invoke.delay
    )
  }

  const replyContent = chooseContactReply(bundle, snapshot, normalizedRoleKey, talkOption.tags)
  if (replyContent) {
    sendContactMessageFromContact(bundle, snapshot, notifications, normalizedRoleKey, replyContent)
  }

  return true
}

/**
 * 执行一次带成本和脚本的联系人互动动作。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param roleKey 联系人键。 @param actionId 动作 id。
 * @returns 消息、好感和动作结果。 @throws 动作不可用时抛错；所有检查通过后才扣成本、执行脚本和写消息。
 */
export function sendContactAction(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  roleKey: string,
  actionId: string
) {
  const snapshot = runtimeState.snapshot
  const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
  if (isContactConversationNormalChatLocked(bundle, snapshot, normalizedRoleKey)) {
    throw new Error("该联系人正在进行联系人剧情，暂时不能执行普通动作。")
  }

  const actionOption = resolveContactActionOptionsForContact(bundle, normalizedRoleKey, snapshot).find(
    (entry) => entry.id === normalizeText(actionId)
  )

  if (!actionOption) {
    throw new Error(`contact action "${actionId}" is not available for "${normalizedRoleKey}".`)
  }

  if (actionOption.disabled) {
    throw new Error(actionOption.disabledReason ?? `contact action "${actionId}" is currently unavailable.`)
  }

  applyContactActionCosts(bundle, snapshot, actionOption)
  const favorDelta = calculateContactFavorDelta(bundle, snapshot, normalizedRoleKey, actionOption)
  const favorCooldownActive = isContactFavorCooldownActive(snapshot, normalizedRoleKey, actionOption)
  const outgoingMessage = appendContactMessage(snapshot, normalizedRoleKey, "player", actionOption.text, {
    read: true,
    optionId: actionOption.id,
    optionKind: "action",
    tags: actionOption.tags,
    favorDelta,
    favorCooldownAnchor: !favorCooldownActive
  })
  if (!outgoingMessage) {
    return false
  }

  const contact = ensureContact(bundle, snapshot, normalizedRoleKey)
  const previousFavor = contact.favor
  contact.favor = clampContactFavor(previousFavor + favorDelta, previousFavor)
  const appliedFavorDelta = contact.favor - previousFavor
  outgoingMessage.favor_delta = appliedFavorDelta
  appendContactFavorChangeMessage(bundle, snapshot, normalizedRoleKey, appliedFavorDelta)

  appendHistory(snapshot, {
    category: "operation",
    type: "system",
    id: outgoingMessage.id,
    role_key: normalizedRoleKey,
    title: `contact:${normalizedRoleKey}`,
    content: `主角对 ${findRoleLabel(bundle, normalizedRoleKey, snapshot)} 执行动作：${actionOption.label}；好感 ${appliedFavorDelta >= 0 ? "+" : ""}${appliedFavorDelta}（当前 ${contact.favor}）`
  })

  if (actionOption.invoke) {
    queueInvokeEvent(
      bundle,
      runtimeState,
      actionOption.invoke.target_type,
      actionOption.invoke.event_id,
      {},
      actionOption.invoke.delay
    )
  }

  const replyContent = chooseContactReply(bundle, snapshot, normalizedRoleKey, actionOption.tags)
  if (replyContent) {
    sendContactMessageFromContact(bundle, snapshot, notifications, normalizedRoleKey, replyContent)
  }

  return true
}

/** @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param roleKey 联系人键。 @param quickMessageId 快捷消息 id。 @returns 与普通话题发送相同的结果。 */
export function sendContactQuickMessage(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  roleKey: string,
  quickMessageId: string
) {
  return sendContactTalk(bundle, runtimeState, notifications, roleKey, quickMessageId)
}
