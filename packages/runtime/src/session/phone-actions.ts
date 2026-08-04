/**
 * 手机自动消息、好感、花费和发送动作。
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
import type { RuntimePlayableEvent, RuntimeResolvedPhoneActionOption, RuntimeState, RuntimeStoryBundle } from "./contracts-view"
import { buildRuntimePhoneContactMeta, getBundlePhoneContactProfile } from "./phone-config"
import { canFirePhoneProactiveRule, choosePhoneProactiveRuleMessage, choosePhoneReply, getActivePhoneConversationState, isPhoneConversationNormalChatLocked } from "./phone-conversations"
import { appendPhoneMessage, assertRuntimePhoneRoleKey, ensurePhoneContact, findPhoneTalkOption, findRoleLabel, getPhoneContact, getPhoneProactiveRulesForContact, getPhoneThread, getPlayerMoneyBalance, isBundleRoleKey, resolvePhoneActionOptionsForContact } from "./phone-threads"
import { renderDialogueContent } from "./playback-render"
import { getCurrentGameMinute } from "./schedule-clock"
import { createRuntimeBagScriptFunctions } from "./script-context"
import { appendHistory, queueInvokeEvent } from "./script-execution"
import { clampPhoneFavor, normalizePhoneState, normalizeText, writeSnapshotValue } from "./state-values"

/**
 * 在时间推进后扫描并发送符合条件的联系人主动消息。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @returns 无返回值。
 * 结构化剧情会话进行中暂停普通主动消息；每个联系人每轮最多触发一条，避免同一 tick 消息轰炸。
 */
export function reconcilePhoneAutoMessages(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  normalizePhoneState(runtimeState.snapshot)
  if (getActivePhoneConversationState(runtimeState.snapshot)) {
    return
  }

  for (const contact of runtimeState.snapshot.phone.contacts) {
    const proactiveRules = getPhoneProactiveRulesForContact(bundle, contact.role_key)
    for (const rule of proactiveRules) {
      if (!canFirePhoneProactiveRule(bundle, runtimeState.snapshot, contact.role_key, rule)) {
        continue
      }

      const content = choosePhoneProactiveRuleMessage(runtimeState.snapshot, contact.role_key, rule)
      if (!content) {
        continue
      }

      const message = sendPhoneMessageFromContact(
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
        contact.favor = clampPhoneFavor(contact.favor + rule.favor_delta, contact.favor)
      }
    }
  }
}

/**
 * 计算一次聊天或动作实际增加的好感度。
 * @param bundle 编译故事。 @param snapshot 快照。 @param roleKey 联系人键。 @param option 基础变化和冷却设置。
 * @returns 根据重复使用冷却衰减后的整数变化量；不会直接修改好感度。
 */
export function calculatePhoneFavorDelta(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  option: {
    id: string
    baseFavorDelta: number
    cooldownHours: number
  }
) {
  const thread = getPhoneThread(snapshot, roleKey)
  const previousPlayerMessage = thread?.messages
    .slice()
    .reverse()
    .find((message) => message.sender === "player") ?? null
  let favorDelta = Math.max(0, option.baseFavorDelta)

  if (previousPlayerMessage?.option_id === option.id || previousPlayerMessage?.quick_message_id === option.id) {
    favorDelta = Math.max(0, favorDelta - 1)
  }

  if (option.cooldownHours > 0 && previousPlayerMessage) {
    const cooldownMinutes = option.cooldownHours * 60
    const minuteGap = Math.max(0, getCurrentGameMinute(snapshot) - previousPlayerMessage.game_minute)
    if (
      (previousPlayerMessage.option_id === option.id || previousPlayerMessage.quick_message_id === option.id)
      && minuteGap < cooldownMinutes
    ) {
      favorDelta = Math.max(0, favorDelta - 1)
    }
  }

  const contact = ensurePhoneContact(bundle, snapshot, roleKey)
  if (contact.favor >= 80) {
    favorDelta = Math.max(0, favorDelta - 1)
  }

  return favorDelta
}

/**
 * 在剧情对白首次出现角色时自动加入允许联系的角色。
 * @param bundle 编译故事。 @param snapshot 手机状态。 @param event 当前事件。 @param notifications UI 通知。 @returns 无返回值。
 * 只检查 dialogue 表现中的非玩家说话者，并尊重角色/档案的 contact_enabled 设置。
 */
export function autoRegisterPhoneContactsFromEvent(
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
    const contactMeta = buildRuntimePhoneContactMeta(
      bundle,
      roleKey,
      getBundlePhoneContactProfile(bundle, roleKey)?.initial_favor ?? 20
    )
    if (!contactMeta.enabled || !contactMeta.autoAdd) {
      continue
    }

    if (!isBundleRoleKey(bundle, roleKey)) {
      continue
    }

    const existed = Boolean(getPhoneContact(snapshot, roleKey))
    ensurePhoneContact(bundle, snapshot, roleKey)
    if (!existed) {
      notifications.push(`手机已新增联系人：${findRoleLabel(bundle, roleKey)}`)
    }
  }
}

/**
 * 记录一条联系人发给玩家的消息。
 * @param bundle 编译故事。 @param snapshot 手机状态。 @param notifications UI 通知。
 * @param roleKey 联系人键。 @param content 支持模板的正文。 @param options 主动规则或剧情会话来源信息。
 * @returns 新消息；会确保联系人存在、渲染模板、标记未读并推送通知。
 */
export function sendPhoneMessageFromContact(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  notifications: string[],
  roleKey: string,
  content: string,
  options: {
    sourceRuleId?: string
    phoneConversationId?: string
    phoneConversationNodeId?: string
    phoneConversationReminder?: boolean
  } = {}
) {
  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  const renderedContent = renderDialogueContent(bundle, snapshot, content, {})
  ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  const message = appendPhoneMessage(snapshot, normalizedRoleKey, "contact", renderedContent, {
    read: false,
    sourceRuleId: options.sourceRuleId,
    phoneConversationId: options.phoneConversationId,
    phoneConversationNodeId: options.phoneConversationNodeId,
    phoneConversationReminder: options.phoneConversationReminder
  })
  if (!message) {
    return null
  }

  notifications.push(`联系人 ${findRoleLabel(bundle, normalizedRoleKey)} 发来新消息。`)
  appendHistory(snapshot, {
    type: "system",
    id: message.id,
    title: `phone:${normalizedRoleKey}`,
    content: `${findRoleLabel(bundle, normalizedRoleKey)}: ${message.content}`
  })
  return message
}

/** @param bundle 编译故事。 @param snapshot 手机状态。 @param roleKey 联系人键。 @param content 玩家消息模板。 @returns 已渲染并标记已读的玩家消息。 */
export function sendPhoneMessageToContact(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string,
  content: string
) {
  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  const renderedContent = renderDialogueContent(bundle, snapshot, content, {})
  ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  const message = appendPhoneMessage(snapshot, normalizedRoleKey, "player", renderedContent, {
    read: true
  })
  if (!message) {
    return null
  }

  appendHistory(snapshot, {
    type: "system",
    id: message.id,
    title: "phone:player",
    content: `主角 -> ${findRoleLabel(bundle, normalizedRoleKey)}: ${message.content}`
  })
  return message
}

/**
 * 扣除手机动作声明的金钱和物品成本。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param action 已解析动作选项。 @returns 无返回值。
 * 调用方必须先完成 disabledReason 检查；本函数仍二次验证余额/库存，异常时抛错，防止竞态或脚本改值后透支。
 */
export function applyPhoneActionCosts(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  action: RuntimeResolvedPhoneActionOption
) {
  if (action.costMoney > 0) {
    const currentMoney = getPlayerMoneyBalance(snapshot)
    if (currentMoney === null) {
      throw new Error("当前故事没有可写入的 player.money 变量，暂时无法支付。")
    }

    if (currentMoney < action.costMoney) {
      throw new Error(`需要 ${action.costMoney} 元，当前只有 ${Math.max(0, Math.trunc(currentMoney))} 元。`)
    }

    if (!writeSnapshotValue(snapshot, "player.money", Math.max(0, Math.trunc(currentMoney - action.costMoney)))) {
      throw new Error("player.money 不是可写 value 变量，暂时无法支付。")
    }
  }

  for (const costItem of action.costItems) {
    if (!costItem.itemId || costItem.quantity <= 0) {
      continue
    }

    const removed = createRuntimeBagScriptFunctions(bundle, snapshot).bag_remove(
      "player",
      costItem.itemId,
      costItem.quantity
    )
    if (!removed) {
      throw new Error(`消耗物品失败：${costItem.itemName} x${costItem.quantity}`)
    }
  }
}

/**
 * 执行一次普通手机话题聊天。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param roleKey 联系人键。 @param talkId 话题 id。
 * @returns 玩家消息、联系人回复和好感变化结果。 @throws 剧情会话锁定、话题不可用或条件不满足时抛错。
 */
export function sendPhoneTalk(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  roleKey: string,
  talkId: string
) {
  const snapshot = runtimeState.snapshot
  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  if (isPhoneConversationNormalChatLocked(bundle, snapshot, normalizedRoleKey)) {
    throw new Error("该联系人正在进行剧情手机对话，暂时不能普通闲聊。")
  }

  const talkOption = findPhoneTalkOption(bundle, normalizedRoleKey, talkId, snapshot)

  if (!talkOption) {
    throw new Error(`phone talk "${talkId}" is not available for "${normalizedRoleKey}".`)
  }

  ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  const favorDelta = calculatePhoneFavorDelta(bundle, snapshot, normalizedRoleKey, talkOption)
  const outgoingMessage = appendPhoneMessage(snapshot, normalizedRoleKey, "player", talkOption.text, {
    read: true,
    optionId: talkOption.id,
    optionKind: "talk",
    quickMessageId: talkOption.source === "legacy-quick-message" ? talkOption.id : undefined,
    tags: talkOption.tags
  })
  if (!outgoingMessage) {
    return false
  }

  const contact = ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  contact.favor = clampPhoneFavor(contact.favor + favorDelta, contact.favor)

  appendHistory(snapshot, {
    type: "system",
    id: outgoingMessage.id,
    title: `phone:${normalizedRoleKey}`,
    content: `主角向 ${findRoleLabel(bundle, normalizedRoleKey)} 发送消息：${outgoingMessage.content}`
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

  const replyContent = choosePhoneReply(bundle, snapshot, normalizedRoleKey, talkOption.tags)
  if (replyContent) {
    sendPhoneMessageFromContact(bundle, snapshot, notifications, normalizedRoleKey, replyContent)
  }

  return true
}

/**
 * 执行一次带成本和脚本的手机互动动作。
 * @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param roleKey 联系人键。 @param actionId 动作 id。
 * @returns 消息、好感和动作结果。 @throws 动作不可用时抛错；所有检查通过后才扣成本、执行脚本和写消息。
 */
export function sendPhoneAction(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  roleKey: string,
  actionId: string
) {
  const snapshot = runtimeState.snapshot
  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  if (isPhoneConversationNormalChatLocked(bundle, snapshot, normalizedRoleKey)) {
    throw new Error("该联系人正在进行剧情手机对话，暂时不能执行普通动作。")
  }

  const actionOption = resolvePhoneActionOptionsForContact(bundle, normalizedRoleKey, snapshot).find(
    (entry) => entry.id === normalizeText(actionId)
  )

  if (!actionOption) {
    throw new Error(`phone action "${actionId}" is not available for "${normalizedRoleKey}".`)
  }

  if (actionOption.disabled) {
    throw new Error(actionOption.disabledReason ?? `phone action "${actionId}" is currently unavailable.`)
  }

  applyPhoneActionCosts(bundle, snapshot, actionOption)
  const favorDelta = calculatePhoneFavorDelta(bundle, snapshot, normalizedRoleKey, actionOption)
  const outgoingMessage = appendPhoneMessage(snapshot, normalizedRoleKey, "player", actionOption.text, {
    read: true,
    optionId: actionOption.id,
    optionKind: "action",
    tags: actionOption.tags
  })
  if (!outgoingMessage) {
    return false
  }

  const contact = ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  contact.favor = clampPhoneFavor(contact.favor + favorDelta, contact.favor)

  appendHistory(snapshot, {
    type: "system",
    id: outgoingMessage.id,
    title: `phone:${normalizedRoleKey}`,
    content: `主角对 ${findRoleLabel(bundle, normalizedRoleKey)} 执行动作：${actionOption.label}`
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

  const replyContent = choosePhoneReply(bundle, snapshot, normalizedRoleKey, actionOption.tags)
  if (replyContent) {
    sendPhoneMessageFromContact(bundle, snapshot, notifications, normalizedRoleKey, replyContent)
  }

  return true
}

/** @param bundle 编译故事。 @param runtimeState 会话状态。 @param notifications UI 通知。 @param roleKey 联系人键。 @param quickMessageId 快捷消息 id。 @returns 与普通话题发送相同的结果。 */
export function sendPhoneQuickMessage(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[],
  roleKey: string,
  quickMessageId: string
) {
  return sendPhoneTalk(bundle, runtimeState, notifications, roleKey, quickMessageId)
}
