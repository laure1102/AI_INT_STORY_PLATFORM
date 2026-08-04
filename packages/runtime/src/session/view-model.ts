/**
 * 背包、行动、商城、手机和总视图模型。
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
import type { RuntimeBagItemView, RuntimeBagSummary, RuntimeDoingActionView, RuntimeDoingMenuView, RuntimeDoingView, RuntimeInteraction, RuntimePhoneContactView, RuntimePhoneThreadView, RuntimeRuntimePhoneConversationReplyView, RuntimeRuntimePhoneConversationView, RuntimeShopCategoryView, RuntimeShopProductView, RuntimeShopView, RuntimeState, RuntimeStoryBundle, RuntimeStoryViewModel } from "./contracts-view"
import { buildRuntimeDoingMenuState, findDoingRecord, getBundleDoingConfig, getBundleShopConfig, getDoingCooldownLeftHours, getRuntimeShopVisibleCategoryIds, getShopPurchaseCooldownLeftHours, resolveDoingAvailability, resolveShopProductDisabledReason } from "./doing-shop"
import { buildRuntimePhoneContactMeta, findBundlePhoneConversation, findPhoneConversationNode, getBundleItemNameMap } from "./phone-config"
import { getActivePhoneConversationState, isPhoneConversationOptionVisible } from "./phone-conversations"
import { findRoleLabel, getBundleGraphNode, getCurrentPlayableEvent, getLatestPhoneMessagePreview, getPhoneContact, getPhoneThread, getPhoneUnreadCount, isCompiledAction, resolvePhoneActionOptionsForContact, resolvePhoneTalkOptionsForContact } from "./phone-threads"
import { getCurrentEventState } from "./playback-entry"
import { renderDialogueContent } from "./playback-render"
import { findBagEntry } from "./script-context"
import { clampInteger, formatValueSummary, normalizeBagsState, normalizeDoingState, normalizeItemId, normalizeOwnerId, normalizePhoneRoleKey, normalizePhoneState, normalizeShopState, normalizeText } from "./state-values"

/**
 * 将内部背包状态转换成按所有者分组的只读展示数据。
 * @param bundle 编译故事，用于解析物品名称。 @param snapshot 会话快照。 @returns 所有者、条目和总数量组成的摘要数组。
 */
export function buildRuntimeBagSummary(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
): RuntimeBagSummary[] {
  normalizeBagsState(snapshot)

  const itemNames = getBundleItemNameMap(bundle)

  return Object.entries(snapshot.bags)
    .map(([ownerId, bag]) => {
      const normalizedOwnerId = normalizeOwnerId(ownerId)
      const entries = bag.entries
        .filter((entry) => entry.quantity > 0)
        .map((entry) => {
          const itemId = normalizeItemId(entry.item_id)
          return {
            ownerId: normalizedOwnerId,
            itemId,
            itemName: itemNames.get(itemId) ?? itemId,
            quantity: entry.quantity,
            bound: entry.bound,
            obtainedAtDay: entry.obtained_at_day,
            obtainedAtMinute: entry.obtained_at_minute
          } satisfies RuntimeBagItemView
        })
        .filter((entry) => entry.itemId)
        .sort((left, right) => {
          const nameCompare = left.itemName.localeCompare(right.itemName, "zh-Hans-CN")
          return nameCompare !== 0 ? nameCompare : left.itemId.localeCompare(right.itemId)
        })

      return {
        ownerId: normalizedOwnerId,
        itemCount: entries.length,
        totalQuantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
        entries
      } satisfies RuntimeBagSummary
    })
    .filter((bag) => bag.ownerId)
    .sort((left, right) => {
      if (left.ownerId === "player") {
        return right.ownerId === "player" ? 0 : -1
      }

      if (right.ownerId === "player") {
        return 1
      }

      return left.ownerId.localeCompare(right.ownerId)
    })
}

/**
 * 构建行动中心需要的菜单和行动列表。
 * @param bundle 编译故事。 @param snapshot 当前状态。 @returns 已应用父菜单可见性、条件、锁定和冷却的 Doing 视图。
 */
export function buildRuntimeDoingView(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
): RuntimeDoingView {
  normalizeDoingState(snapshot)

  const doingConfig = getBundleDoingConfig(bundle)
  const menuStates = buildRuntimeDoingMenuState(bundle, snapshot)
  const menus = doingConfig.menus
    .map((menu) => {
      const menuState = menuStates.get(menu.id) ?? {
        visible: false,
        hiddenReason: "菜单状态不可用。"
      }

      if (!menuState.visible) {
        return null
      }

      return {
        id: menu.id,
        title: menu.title,
        parentId: menu.parent_id,
        sortOrder: menu.sort_order,
        descr: menu.descr
      } satisfies RuntimeDoingMenuView
    })
    .filter((menu): menu is RuntimeDoingMenuView => Boolean(menu))
    .sort((left, right) => {
      if (left.parentId !== right.parentId) {
        return left.parentId.localeCompare(right.parentId)
      }

      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder
      }

      return left.title.localeCompare(right.title, "zh-Hans-CN")
    })

  const visibleMenuIds = new Set(menus.map((menu) => menu.id))
  const doings = doingConfig.doings
    .map((doing) => {
      if (!visibleMenuIds.has(doing.menu_id)) {
        return null
      }

      const availability = resolveDoingAvailability(bundle, snapshot, doing)
      if (!availability.visible) {
        return null
      }

      const record = findDoingRecord(snapshot, doing.id)
      return {
        id: doing.id,
        title: doing.title,
        menuId: doing.menu_id,
        descr: doing.descr,
        cooldownHours: Math.max(0, clampInteger(doing.cooldown_hours, 0)),
        cooldownLeftHours: getDoingCooldownLeftHours(snapshot, doing.id),
        usedCount: record?.used_count ?? 0,
        once: Boolean(doing.once),
        disabled: availability.disabled,
        disabledReason: availability.disabledReason
      } satisfies RuntimeDoingActionView
    })
    .filter((doing): doing is RuntimeDoingActionView => Boolean(doing))
    .sort((left, right) => {
      if (left.menuId !== right.menuId) {
        return left.menuId.localeCompare(right.menuId)
      }

      return left.title.localeCompare(right.title, "zh-Hans-CN")
    })

  return {
    menus,
    doings
  }
}

/**
 * 构建商店分类、商品、库存、余额和禁用原因视图。
 * @param bundle 编译故事。 @param snapshot 当前状态。 @returns 客户端可直接渲染的商店只读模型。
 * 构建过程只读取状态；购买资格由与实际购买相同的规则计算，避免按钮状态和提交结果不一致。
 */
export function buildRuntimeShopView(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
): RuntimeShopView {
  normalizeShopState(snapshot)
  normalizeBagsState(snapshot)

  const shopConfig = getBundleShopConfig(bundle)
  const itemNameMap = getBundleItemNameMap(bundle)
  const visibleCategoryIds = getRuntimeShopVisibleCategoryIds(bundle, snapshot)
  const categories = shopConfig.categories
    .filter((category) => visibleCategoryIds.has(category.id))
    .map((category) => ({
      id: category.id,
      name: category.name || category.id,
      sortOrder: category.sort_order,
      descr: category.descr
    } satisfies RuntimeShopCategoryView))
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder
      }

      return left.name.localeCompare(right.name, "zh-Hans-CN")
    })

  const products = shopConfig.products
    .filter((product) => visibleCategoryIds.has(product.category_id))
    .map((product) => {
      const itemId = normalizeItemId(product.item_id)
      const disabledReason = resolveShopProductDisabledReason(bundle, snapshot, product)
      const giftCooldownHours = Math.max(0, clampInteger(product.gift_cooldown_hours, 0))

      return {
        id: product.id,
        categoryId: product.category_id,
        itemId,
        itemName: itemNameMap.get(itemId) ?? itemId,
        price: Math.max(0, product.price),
        quantity: Math.max(1, clampInteger(product.quantity, 1)),
        sortOrder: product.sort_order,
        allowGift: Boolean(product.allow_gift),
        giftFavorDelta: clampInteger(product.gift_favor_delta, 0),
        purchaseCooldownHours: Math.max(0, clampInteger(product.purchase_cooldown_hours, 0)),
        purchaseCooldownLeftHours: getShopPurchaseCooldownLeftHours(snapshot, product.id),
        giftCooldownHours,
        ownedQuantity: findBagEntry(snapshot, "player", itemId)?.quantity ?? 0,
        disabled: Boolean(disabledReason),
        disabledReason,
        unavailableReason: product.unavailable_reason || null
      } satisfies RuntimeShopProductView
    })
    .filter((product) => product.id && product.categoryId && product.itemId)
    .sort((left, right) => {
      if (left.categoryId !== right.categoryId) {
        return left.categoryId.localeCompare(right.categoryId)
      }

      if (left.disabled !== right.disabled) {
        return left.disabled ? 1 : -1
      }

      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder
      }

      return left.itemName.localeCompare(right.itemName, "zh-Hans-CN")
    })

  return {
    currencyValueKey: shopConfig.currency_value_key,
    categories,
    products
  }
}

/** @param bundle 编译故事。 @param snapshot 手机状态。 @returns 含角色资料、关系阶段、最后消息和未读数的联系人列表。 */
export function buildRuntimePhoneContacts(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
): RuntimePhoneContactView[] {
  normalizePhoneState(snapshot)

  return snapshot.phone.contacts
    .map((contact) => {
      const latest = getLatestPhoneMessagePreview(snapshot, contact.role_key)
      const meta = buildRuntimePhoneContactMeta(bundle, contact.role_key, contact.favor)

      return {
        roleKey: contact.role_key,
        label: meta.label,
        favor: contact.favor,
        relationTrackId: meta.trackId,
        relationTrackLabel: meta.trackLabel,
        relationStageId: meta.stageId,
        relationStageLabel: meta.stageLabel,
        canContact: meta.canContact,
        lockMessage: meta.lockMessage,
        personalityId: meta.personalityId,
        personalityLabel: meta.personalityLabel,
        unreadCount: getPhoneUnreadCount(snapshot, contact.role_key),
        unlockedAtDay: contact.unlocked_at_day,
        lastMessageGameMinute: latest.gameMinute,
        lastMessagePreview: latest.preview,
        messageCount: latest.messageCount
      } satisfies RuntimePhoneContactView
    })
    .sort((left, right) => {
      const rightMinute = right.lastMessageGameMinute ?? -1
      const leftMinute = left.lastMessageGameMinute ?? -1

      if (leftMinute !== rightMinute) {
        return rightMinute - leftMinute
      }

      if (left.unreadCount !== right.unreadCount) {
        return right.unreadCount - left.unreadCount
      }

      return left.label.localeCompare(right.label, "zh-Hans-CN")
    })
}

/**
 * 构建单个联系人的完整聊天界面模型。
 * @param bundle 编译故事。 @param snapshot 手机状态。 @param roleKey 联系人键。 @returns 联系人、消息、话题和动作选项；无效角色返回 null。
 */
export function buildRuntimePhoneThreadView(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  roleKey: string
): RuntimePhoneThreadView | null {
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  if (!normalizedRoleKey) {
    return null
  }

  normalizePhoneState(snapshot)
  const contact = getPhoneContact(snapshot, normalizedRoleKey)
  if (!contact) {
    return null
  }

  const thread = getPhoneThread(snapshot, normalizedRoleKey)
  const messages = thread?.messages ?? []
  const meta = buildRuntimePhoneContactMeta(bundle, normalizedRoleKey, contact.favor)
  const talks = resolvePhoneTalkOptionsForContact(bundle, normalizedRoleKey, snapshot)
  const actions = resolvePhoneActionOptionsForContact(bundle, normalizedRoleKey, snapshot)

  return {
    roleKey: normalizedRoleKey,
    contactLabel: meta.label,
    favor: contact.favor,
    relationTrackId: meta.trackId,
    relationTrackLabel: meta.trackLabel,
    relationStageId: meta.stageId,
    relationStageLabel: meta.stageLabel,
    canContact: meta.canContact,
    lockMessage: meta.lockMessage,
    personalityId: meta.personalityId,
    personalityLabel: meta.personalityLabel,
    unreadCount: getPhoneUnreadCount(snapshot, normalizedRoleKey),
    messages: messages.map((message) => ({
      id: message.id,
      sender: message.sender,
      senderLabel: message.sender === "player"
        ? "我"
        : message.sender === "system"
          ? "系统"
          : findRoleLabel(bundle, normalizedRoleKey),
      content: message.content,
      gameMinute: message.game_minute,
      read: message.read
    })),
    talks: talks.map((message) => ({
      id: message.id,
      text: message.text,
      tags: [...message.tags],
      baseFavorDelta: message.baseFavorDelta,
      cooldownHours: message.cooldownHours,
      suggested: message.suggested
    })),
    actions: actions.map((action) => ({
      id: action.id,
      label: action.label,
      text: action.text,
      tags: [...action.tags],
      baseFavorDelta: action.baseFavorDelta,
      cooldownHours: action.cooldownHours,
      costMoney: action.costMoney,
      costItems: action.costItems.map((item) => ({
        itemId: item.itemId,
        itemName: item.itemName,
        quantity: item.quantity
      })),
      disabled: action.disabled,
      disabledReason: action.disabledReason,
      invokeEventLabel: action.invoke ? `${action.invoke.target_type}/${action.invoke.event_id}` : null
    })),
    quickMessages: talks.map((message) => ({
      id: message.id,
      text: message.text,
      tags: [...message.tags],
      baseFavorDelta: message.baseFavorDelta,
      cooldownHours: message.cooldownHours,
      suggested: message.suggested
    }))
  }
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @returns 当前结构化手机剧情的节点、消息和可见回复视图；没有活动会话时为 null。 */
export function buildRuntimePhoneConversationView(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
): RuntimeRuntimePhoneConversationView | null {
  const activeState = getActivePhoneConversationState(snapshot)
  if (!activeState) {
    return null
  }

  const conversation = findBundlePhoneConversation(bundle, activeState.conversation_id)
  if (!conversation) {
    return null
  }

  const node = findPhoneConversationNode(conversation, activeState.node_id)
  if (!node) {
    return null
  }

  const roleLabel = findRoleLabel(bundle, activeState.role_key)
  const nodeIndex = Math.max(0, conversation.nodes.findIndex((item) => item.id === node.id))
  const replies = node.player_options.map((option) => {
    const visible = isPhoneConversationOptionVisible(bundle, snapshot, option)
    return {
      id: option.id,
      text: renderDialogueContent(bundle, snapshot, option.text, {}),
      visible
    } satisfies RuntimeRuntimePhoneConversationReplyView
  })

  return {
    conversationId: conversation.id,
    title: conversation.title || conversation.id,
    roleKey: activeState.role_key,
    roleLabel,
    nodeId: node.id,
    nodeTitle: node.id,
    nodeIndex: nodeIndex >= 0 ? nodeIndex + 1 : 1,
    nodeTotal: Math.max(1, conversation.nodes.length),
    messages: node.contact_messages.map((message, index) => ({
      index: index + 1,
      total: Math.max(1, node.contact_messages.length),
      speakerLabel: roleLabel,
      speakerKey: activeState.role_key,
      content: renderDialogueContent(bundle, snapshot, message.content, {})
    })),
    replies,
    finished: Boolean(activeState.finished),
    lockNormalChat: Boolean(conversation.lock_normal_chat)
  }
}

/**
 * 汇总一次客户端渲染所需的完整运行时视图。
 * @param bundle 编译故事。 @param runtimeState 会话内部状态。 @param screen 当前主界面。 @param notifications 本轮通知。
 * @returns 当前事件/对白/动作、时钟、背包、手机、行动、商店和通知组成的不可持久化视图模型。
 * 视图从 snapshot 派生，不作为存档事实来源；客户端下一次操作后可以重新构建。
 */
export function buildViewModel(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  screen: RuntimeStoryViewModel["screen"],
  notifications: string[]
): RuntimeStoryViewModel {
  const currentEventState = getCurrentEventState(bundle, runtimeState)
  const currentEvent = getCurrentPlayableEvent(bundle, runtimeState)
  const currentMessage = currentEventState?.currentMessage ?? null
  const currentDialogue = currentEventState?.currentDialogue ?? null

  let interaction: RuntimeInteraction = null

  if (screen !== "debug") {
    if (currentMessage) {
      interaction = null
    } else if (currentDialogue) {
      interaction = {
        kind: "select",
        prompt: "请选择下一步。",
        options: [
          {
            id: "continue",
            label: currentDialogue.index < currentDialogue.total ? "继续对白" : "结束当前事件"
          }
        ]
      }
    } else if (currentEventState && currentEventState.availableActions.length > 0) {
      interaction = {
        kind: "select",
        prompt: "请选择一个操作分支。",
        options: currentEventState.availableActions.map((actionState) => {
          const actionNode = getBundleGraphNode(bundle, actionState.nodeId)
          const title = isCompiledAction(actionNode) ? actionNode.title : actionState.nodeId
          return {
            id: actionState.nodeId,
            label: title
          }
        })
      }
    } else if (currentEventState || runtimeState.snapshot.current_event_id === null) {
      interaction = {
        kind: "select",
        prompt: runtimeState.snapshot.current_event_id === null ? "当前没有可继续的事件。" : "请选择下一步。",
        options: runtimeState.snapshot.current_event_id === null
          ? []
          : [{
              id: "continue",
              label: "继续"
            }]
      }
    }
  }

  const branchContextSummary = Object.entries(runtimeState.lastAction?.branchValues ?? {}).map(
    ([key, value]) => ({
      key,
      value: formatValueSummary(value)
    })
  )

  const bagSummary = buildRuntimeBagSummary(bundle, runtimeState.snapshot)
  const doing = buildRuntimeDoingView(bundle, runtimeState.snapshot)
  const shop = buildRuntimeShopView(bundle, runtimeState.snapshot)
  const phoneConversation = buildRuntimePhoneConversationView(bundle, runtimeState.snapshot)

  const availableBranches = (currentEventState?.availableActions ?? []).flatMap((actionState) => {
    const actionNode = getBundleGraphNode(bundle, actionState.nodeId)
    if (!isCompiledAction(actionNode)) {
      return []
    }

    return [{
      id: actionNode.id,
      title: actionNode.title,
      nextEventId: actionNode.next[0] ?? null,
      vars: actionNode.vars.map((item) => ({
        name: item.name,
        descr: item.descr,
        initialValue: item.initial_value
      }))
    }]
  })

  return {
    screen,
    storyTitle: bundle.title,
    activeEventId: runtimeState.snapshot.current_event_id,
    activeEventTitle: currentEvent?.title ?? null,
    interaction,
    notifications,
    currentLocationId: normalizeText(currentEvent?.location ?? "") || null,
    currentLocationName: currentEventState?.locationName ?? null,
    currentSceneLevel: null,
    currentMessage,
    currentDialogue,
    phoneConversation,
    availableBranches,
    branchContextSummary,
    bagSummary,
    doing,
    shop,
    debugSummary: {
      globalGroupCount: runtimeState.snapshot.vals.variables.length,
      systemGroupCount: runtimeState.snapshot.system_vals.variables.length,
      historyCount: runtimeState.snapshot.history.length,
      triggeredOnceCount: runtimeState.snapshot.triggered_once_events.length
    }
  }
}
