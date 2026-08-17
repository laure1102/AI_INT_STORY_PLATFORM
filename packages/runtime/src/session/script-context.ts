/**
 * 称谓、模板上下文、背包与领域脚本函数。
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
import type { RuntimeStoryReferFile, RuntimeStoryReferTerm, RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimePlayableEvent, RuntimeState, RuntimeStoryBundle } from "./contracts-view"
import { assertRuntimeDoingId, assertRuntimeShopProductId, buyShopProduct, canBuyShopProduct, ensureDoingRecord, findDoingRecord, getBundleItemIds, getDoingCooldownLeftHours, getShopGiftCooldownLeftHours, getShopPurchaseCooldownLeftHours, giftShopProduct } from "./doing-shop"
import { sendContactMessageFromContact, sendContactMessageToContact } from "./contact-actions"
import { startContactConversation } from "./contact-conversations"
import { assertRuntimeContactRoleKey, ensureContact, findRoleLabel, getBundleLocations, getContact, getContactUnreadCount, isRuntimeStandaloneEvent, markContactThreadRead } from "./contact-threads"
import { getCurrentGameMinute } from "./schedule-clock"
import { normalizeClockState } from "./state-scheduler"
import { clampContactFavor, cloneValue, createCombinedValsFile, createDefaultReferConfig, normalizeBagQuantity, normalizeBagsState, normalizeDoingState, normalizeItemId, normalizeOwnerId, normalizeContactState, normalizeText, readValEntryValue } from "./state-values"

/** @param bundle 编译后的故事。 @param locationId 地点 id。 @returns 地点显示名；id 为空或不存在时返回 null。 */
export function findLocationLabel(bundle: RuntimeStoryBundle, locationId: string) {
  const trimmedLocationId = normalizeText(locationId)
  if (!trimmedLocationId) {
    return null
  }

  const location = getBundleLocations(bundle).find((item) => item.id.trim() === trimmedLocationId)
  if (!location) {
    return trimmedLocationId
  }

  const descr = location.descr.trim()
  return descr ? `${location.id} - ${descr}` : location.id
}

/** @param event 可播放事件。 @returns 独立调用事件携带的参数副本；普通 chain 事件返回空对象。 */
export function getRuntimeEventCallValues(event: RuntimePlayableEvent | null | undefined) {
  if (!event || !isRuntimeStandaloneEvent(event)) {
    return {}
  }

  return cloneValue(event.call_values ?? {})
}

/** @param runtimeState 会话内部状态。 @returns 当前 invoke 调度实例的调用参数副本；没有活动调用时返回空对象。 */
export function getRuntimeActiveCallValues(runtimeState: RuntimeState) {
  const activeScheduledEvent = runtimeState.snapshot.scheduler.active
  if (!activeScheduledEvent || activeScheduledEvent.source_type !== "invoke") {
    return {}
  }

  return cloneValue(activeScheduledEvent.call_values ?? {})
}

/**
 * 取得当前事件脚本应看到的调用参数。
 * @param runtimeState 会话状态。 @param event 当前可播放事件。 @returns standalone 事件自身参数，或活动调度调用参数。
 */
export function getRuntimePlayableEventCallValues(
  runtimeState: RuntimeState,
  event: RuntimePlayableEvent | null | undefined
) {
  if (isRuntimeStandaloneEvent(event)) {
    return getRuntimeEventCallValues(event)
  }

  return getRuntimeActiveCallValues(runtimeState)
}

/** @param value 性别别名配置。 @param fallback 配置无效或为空时的默认别名。 @returns 去空白、去重后的别名数组。 */
export function normalizeReferAliasList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback
  }

  const aliases = Array.from(
    new Set(value.map((item) => normalizeText(item)).filter(Boolean))
  )

  return aliases.length > 0 ? aliases : fallback
}

/**
 * 读取并补齐 bundle 的称谓配置。
 * @param bundle 编译后的故事。 @returns 含性别变量键、别名和称谓表的可用配置，不修改 bundle。
 */
export function getBundleReferConfig(bundle: RuntimeStoryBundle): RuntimeStoryReferFile {
  const rawConfig = bundle.refer ?? createDefaultReferConfig()
  const rawAliases = rawConfig.gender_aliases ?? {
    male: ["男", "male", "m"],
    female: ["女", "female", "f"]
  }

  return {
    gender_value_key: normalizeText(rawConfig.gender_value_key) || "player.gender",
    gender_aliases: {
      male: normalizeReferAliasList(rawAliases.male, ["男", "male", "m"]),
      female: normalizeReferAliasList(rawAliases.female, ["女", "female", "f"])
    },
    terms: Array.isArray(rawConfig.terms)
      ? rawConfig.terms.map((term) => ({
          id: normalizeText(term.id),
          label: normalizeText(term.label),
          male: normalizeText(term.male),
          female: normalizeText(term.female),
          fallback: normalizeText(term.fallback)
        }))
      : []
  }
}

/** @param refer 称谓配置。 @param genderValue 玩家性别变量值。 @returns 匹配 male/female 时返回种类，无法识别返回 null。 */
export function resolveReferGenderKind(
  refer: RuntimeStoryReferFile,
  genderValue: unknown
): "male" | "female" | null {
  const normalizedGender = normalizeText(genderValue).toLowerCase()
  if (!normalizedGender) {
    return null
  }

  const maleAliases = refer.gender_aliases.male.map((item) => item.toLowerCase())
  if (maleAliases.includes(normalizedGender)) {
    return "male"
  }

  const femaleAliases = refer.gender_aliases.female.map((item) => item.toLowerCase())
  if (femaleAliases.includes(normalizedGender)) {
    return "female"
  }

  return null
}

/** @param term 一组男女及回退称谓。 @param genderKind 已识别性别。 @returns 优先性别专用值，否则使用 fallback。 */
export function getReferTermValue(term: RuntimeStoryReferTerm, genderKind: "male" | "female" | null) {
  if (genderKind === "male") {
    return term.male || term.fallback
  }

  if (genderKind === "female") {
    return term.female || term.fallback
  }

  return term.fallback || term.male || term.female
}

/**
 * 根据玩家性别变量构造脚本和文本模板可用的称谓字典。
 * @param bundle 编译故事。 @param snapshot 当前变量快照。 @returns 以称谓 key 为键的文本值对象。
 */
export function buildRuntimeReferContextValues(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  const refer = getBundleReferConfig(bundle)
  const combinedValsFile = createCombinedValsFile(snapshot)
  const genderValue = readValEntryValue(combinedValsFile, refer.gender_value_key)
  const genderKind = resolveReferGenderKind(refer, genderValue)
  const values: Record<string, unknown> = {}

  for (const term of refer.terms) {
    const rawTermId = normalizeText(term.id)
    const termId = rawTermId.startsWith("term.") ? rawTermId.slice("term.".length) : rawTermId

    if (!termId) {
      continue
    }

    values[`term.${termId}`] = getReferTermValue(term, genderKind)
  }

  return values
}

/**
 * 汇总 StoryScript 表达式可读取的上下文值。
 * @param bundle 编译故事。 @param snapshot 当前快照。 @param branchValues 当前分支临时值。
 * @param callValues invoke 调用参数。 @returns 称谓、普通/系统变量、分支值和调用值组成的扁平上下文。
 * 后加入的 branch/call 值可覆盖同名普通上下文，这是显式传参优先于全局变量的设计。
 */
export function buildRuntimeContextValues(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  branchValues: Record<string, unknown>,
  callValues: Record<string, unknown> = {}
) {
  const combinedValues: Record<string, unknown> = buildRuntimeReferContextValues(bundle, snapshot)

  const roles = bundle.roles as { important?: { roles?: Array<{ id: string; name?: string; descr?: string }> } } | null
  for (const role of roles?.important?.roles ?? []) {
    const roleKey = `important:${role.id}`
    const override = snapshot.role_name_overrides?.[roleKey]
    const fallback = normalizeText(role.name).trim() || normalizeText(role.descr).trim() || role.id
    combinedValues[`role.important.${role.id}.name`] = override
      ? `${override.surname}${override.given_name}`
      : fallback
  }

  for (const [key, value] of Object.entries(branchValues)) {
    combinedValues[`branch.${key}`] = cloneValue(value)
  }

  for (const [key, value] of Object.entries(callValues)) {
    combinedValues[`call.${key}`] = cloneValue(value)
  }

  return {
    values: combinedValues,
    random: () => nextRuntimeRandom(snapshot.rng),
    functions: {
      ...createRuntimeBagReadableFunctions(bundle, snapshot),
      ...createRuntimeContactReadableFunctions(bundle, snapshot),
      ...createRuntimeDoingReadableFunctions(bundle, snapshot),
      ...createRuntimeShopReadableFunctions(bundle, snapshot)
    }
  } satisfies StoryScriptExecutionContext
}

/** @param snapshot 会话快照。 @returns 当前游戏天数和总分钟，用于记录物品取得时间；会先规范时钟。 */
export function getCurrentRuntimeBagTimestamp(snapshot: RuntimeStorySessionSnapshot) {
  normalizeClockState(snapshot)
  return {
    day: Math.max(1, snapshot.clock.base_day + Math.floor(snapshot.clock.total_minutes / MINUTES_PER_DAY)),
    minute: snapshot.clock.total_minutes
  }
}

/** @param snapshot 会话快照。 @param ownerId 背包所有者。 @returns 已存在或现场创建的可变背包。 */
export function getBag(snapshot: RuntimeStorySessionSnapshot, ownerId: string) {
  normalizeBagsState(snapshot)

  if (!snapshot.bags[ownerId]) {
    snapshot.bags[ownerId] = {
      entries: []
    }
  }

  return snapshot.bags[ownerId]
}

/** @param snapshot 会话快照。 @param ownerId 所有者 id。 @param itemId 物品 id。 @returns 物品条目；没有时返回 null，并会确保背包存在。 */
export function getBagEntry(snapshot: RuntimeStorySessionSnapshot, ownerId: string, itemId: string) {
  return getBag(snapshot, ownerId).entries.find((entry) => entry.item_id === itemId) ?? null
}

/** @param snapshot 会话快照。 @param ownerId 所有者 id。 @param itemId 物品 id。 @returns 现有条目或 null，不创建缺失背包。 */
export function findBagEntry(snapshot: RuntimeStorySessionSnapshot, ownerId: string, itemId: string) {
  normalizeBagsState(snapshot)
  return snapshot.bags[ownerId]?.entries.find((entry) => entry.item_id === itemId) ?? null
}

/**
 * 清洗并验证脚本传入的背包参数。
 * @param ownerId 所有者输入。 @param itemId 物品输入。 @param quantity 数量，默认 1。
 * @returns 规范的 ownerId、itemId 和正整数 quantity。 @throws 任一 id 为空或数量不为正时抛错。
 */
export function assertRuntimeBagArgs(ownerId: unknown, itemId: unknown, quantity?: unknown) {
  const normalizedOwnerId = normalizeOwnerId(ownerId)
  const normalizedItemId = normalizeItemId(itemId)
  const normalizedQuantity = normalizeBagQuantity(quantity, 1)

  if (!normalizedOwnerId) {
    throw new Error("bag owner id is required.")
  }

  if (!normalizedItemId) {
    throw new Error("bag item id is required.")
  }

  if (normalizedQuantity <= 0) {
    throw new Error("bag quantity must be greater than 0.")
  }

  return {
    itemId: normalizedItemId,
    ownerId: normalizedOwnerId,
    quantity: normalizedQuantity
  }
}

/**
 * 创建只读背包 StoryScript 函数。
 * @param bundle 用于确认物品 id 存在的故事 bundle。 @param snapshot 当前背包状态。 @returns `bag_count` 和 `bag_has`。
 */
export function createRuntimeBagReadableFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  const itemIds = getBundleItemIds(bundle)
  /** @param ownerId 所有者输入。 @param itemId 物品输入。 @returns 合法参数；空 id 返回 null，未知物品抛错。 */
  const getReadArgs = (ownerId: unknown, itemId: unknown) => {
    const normalizedOwnerId = normalizeOwnerId(ownerId)
    const normalizedItemId = normalizeItemId(itemId)

    if (!normalizedOwnerId || !normalizedItemId) {
      return null
    }

    if (!itemIds.has(normalizedItemId)) {
      throw new Error(`bag item "${normalizedItemId}" does not exist in runtime item library.`)
    }

    return {
      itemId: normalizedItemId,
      ownerId: normalizedOwnerId
    }
  }

  return {
    /** @param ownerId 所有者 id。 @param itemId 物品 id。 @returns 背包中的整数数量，没有时为 0。 */
    bag_count(ownerId: unknown, itemId: unknown) {
      const args = getReadArgs(ownerId, itemId)
      return args ? (findBagEntry(snapshot, args.ownerId, args.itemId)?.quantity ?? 0) : 0
    },
    /** @param ownerId 所有者 id。 @param itemId 物品 id。 @param quantity 至少需要的数量。 @returns 是否拥有足够数量。 */
    bag_has(ownerId: unknown, itemId: unknown, quantity?: unknown) {
      const normalizedQuantity = normalizeBagQuantity(quantity, 1)

      if (normalizedQuantity <= 0) {
        return true
      }

      const args = getReadArgs(ownerId, itemId)
      return args
        ? (findBagEntry(snapshot, args.ownerId, args.itemId)?.quantity ?? 0) >= normalizedQuantity
        : false
    }
  }
}

/**
 * 创建可修改背包的 StoryScript 函数集合。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @returns 添加、移除和只读查询函数；写操作会直接更新快照。
 */
export function createRuntimeBagScriptFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  const itemIds = getBundleItemIds(bundle)
  const readableFunctions = createRuntimeBagReadableFunctions(bundle, snapshot)

  return {
    /** @param ownerId 所有者 id。 @param itemId 物品 id。 @param quantity 增加数量。 @returns 增加后的总数量。 */
    bag_add(ownerId: unknown, itemId: unknown, quantity?: unknown) {
      const args = assertRuntimeBagArgs(ownerId, itemId, quantity)
      const existingEntry = getBagEntry(snapshot, args.ownerId, args.itemId)

      if (!itemIds.has(args.itemId)) {
        throw new Error(`bag item "${args.itemId}" does not exist in runtime item library.`)
      }

      if (existingEntry) {
        existingEntry.quantity += args.quantity
        return existingEntry.quantity
      }

      const timestamp = getCurrentRuntimeBagTimestamp(snapshot)
      getBag(snapshot, args.ownerId).entries.push({
        item_id: args.itemId,
        quantity: args.quantity,
        bound: false,
        obtained_at_day: timestamp.day,
        obtained_at_minute: timestamp.minute,
        meta: {}
      })

      return args.quantity
    },
    ...readableFunctions,
    /** @param ownerId 所有者 id。 @param itemId 物品 id。 @param quantity 扣除数量。 @returns 成功扣除为 true，库存不足为 false。 */
    bag_remove(ownerId: unknown, itemId: unknown, quantity?: unknown) {
      const args = assertRuntimeBagArgs(ownerId, itemId, quantity)
      const bag = getBag(snapshot, args.ownerId)
      const entry = bag.entries.find((item) => item.item_id === args.itemId)

      if (!entry || entry.quantity < args.quantity) {
        return false
      }

      entry.quantity -= args.quantity
      if (entry.quantity <= 0) {
        bag.entries = bag.entries.filter((item) => item.item_id !== args.itemId)
      }

      return true
    }
  }
}

/** @param bundle 编译故事。 @param snapshot 联系人状态。 @returns 查询联系人、好感度和未读数的只读脚本函数。 */
export function createRuntimeContactReadableFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  return {
    /** @param roleKey 角色键。 @returns 该角色是否已加入联系人。 */
    contact_has(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      return Boolean(getContact(snapshot, normalizedRoleKey))
    },
    /** @param roleKey 角色键。 @returns 当前好感度，未添加联系人时为 0。 */
    contact_favor(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      return getContact(snapshot, normalizedRoleKey)?.favor ?? 0
    },
    /** @param roleKey 角色键。 @returns 该联系人的未读消息数量。 */
    contact_unread_count(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      return getContactUnreadCount(snapshot, normalizedRoleKey)
    }
  }
}

/**
 * 创建联系人领域的可写 StoryScript 函数。
 * @param bundle 编译故事。 @param runtimeState 内部会话状态。 @param notifications 收集给 UI 的提示。
 * @returns 联系人、好感、消息、会话及只读查询函数；所有写操作会更新可存档快照。
 */
export function createRuntimeContactScriptFunctions(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  const snapshot = runtimeState.snapshot
  const readableFunctions = createRuntimeContactReadableFunctions(bundle, snapshot)

  return {
    /** @param roleKey 角色键。 @returns true；首次添加时还会产生 UI 通知。 */
    contact_add(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      const existed = Boolean(getContact(snapshot, normalizedRoleKey))
      ensureContact(bundle, snapshot, normalizedRoleKey)
      if (!existed) {
        notifications.push(`已新增联系人：${findRoleLabel(bundle, normalizedRoleKey, snapshot)}`)
      }
      return true
    },
    /** @param roleKey 角色键。 @returns 是否实际移除了联系人；同时删除其消息线程。 */
    contact_remove(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      normalizeContactState(snapshot)
      const nextContacts = snapshot.contact.contacts.filter((contact) => contact.role_key !== normalizedRoleKey)
      const nextThreads = snapshot.contact.threads.filter((thread) => thread.role_key !== normalizedRoleKey)
      const removed = nextContacts.length !== snapshot.contact.contacts.length
      snapshot.contact.contacts = nextContacts
      snapshot.contact.threads = nextThreads
      return removed
    },
    /** @param roleKey 角色键。 @param favor 目标好感度。 @returns 限制在 0–100 的新好感度。 */
    contact_set_favor(roleKey: unknown, favor: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      const contact = ensureContact(bundle, snapshot, normalizedRoleKey)
      contact.favor = clampContactFavor(favor, contact.favor)
      return contact.favor
    },
    /** @param roleKey 角色键。 @param delta 好感变化量。 @returns 限制后的新好感度。 */
    contact_add_favor(roleKey: unknown, delta: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      const contact = ensureContact(bundle, snapshot, normalizedRoleKey)
      const normalizedDelta = typeof delta === "number" && Number.isFinite(delta)
        ? Math.trunc(delta)
        : 0
      contact.favor = clampContactFavor(contact.favor + normalizedDelta, contact.favor)
      return contact.favor
    },
    /** @param roleKey 发送者角色键。 @param content 消息文本。 @returns 规范文本；空文本抛错并会产生未读通知。 */
    contact_send_from(roleKey: unknown, content: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      const normalizedContent = normalizeText(content)
      if (!normalizedContent) {
        throw new Error("contact message content is required.")
      }
      sendContactMessageFromContact(bundle, snapshot, notifications, normalizedRoleKey, normalizedContent)
      return normalizedContent
    },
    /** @param roleKey 接收者角色键。 @param content 玩家消息文本。 @returns 规范文本；空文本抛错。 */
    contact_send_to(roleKey: unknown, content: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      const normalizedContent = normalizeText(content)
      if (!normalizedContent) {
        throw new Error("contact message content is required.")
      }
      sendContactMessageToContact(bundle, snapshot, normalizedRoleKey, normalizedContent)
      return normalizedContent
    },
    /** @param roleKey 角色键。 @returns 本次从未读改为已读的消息数。 */
    contact_mark_read(roleKey: unknown) {
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      return markContactThreadRead(snapshot, normalizedRoleKey)
    },
    /** @param conversationId 结构化会话 id。 @returns 启动后的会话状态；不满足条件时由下层抛错。 */
    contact_start_conversation(conversationId: unknown) {
      return startContactConversation(bundle, runtimeState, notifications, conversationId)
    },
    ...readableFunctions
  }
}

/** @param bundle 编译故事。 @param snapshot 行动状态。 @returns 查询解锁、使用次数和冷却的只读脚本函数。 */
export function createRuntimeDoingReadableFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  return {
    /** @param doingId 行动 id。 @returns 行动已解锁且未被显式锁定时为 true。 */
    doing_has(doingId: unknown) {
      const normalizedDoingId = assertRuntimeDoingId(bundle, doingId)
      normalizeDoingState(snapshot)
      return snapshot.doing.unlocked_ids.includes(normalizedDoingId)
        && !snapshot.doing.locked_ids.includes(normalizedDoingId)
    },
    /** @param doingId 行动 id。 @returns 历史使用次数，没有记录时为 0。 */
    doing_used_count(doingId: unknown) {
      const normalizedDoingId = assertRuntimeDoingId(bundle, doingId)
      return findDoingRecord(snapshot, normalizedDoingId)?.used_count ?? 0
    },
    /** @param doingId 行动 id。 @returns 向上取整的剩余冷却小时数。 */
    doing_cooldown_left(doingId: unknown) {
      const normalizedDoingId = assertRuntimeDoingId(bundle, doingId)
      return getDoingCooldownLeftHours(snapshot, normalizedDoingId)
    }
  }
}

/** @param bundle 编译故事。 @param snapshot 商店状态。 @returns 购买资格和购买/赠礼冷却查询函数。 */
export function createRuntimeShopReadableFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  return {
    /** @param productId 商品 id。 @returns 当前是否满足购买条件、库存、余额和冷却。 */
    shop_can_buy(productId: unknown) {
      const normalizedProductId = assertRuntimeShopProductId(bundle, productId)
      return canBuyShopProduct(bundle, snapshot, normalizedProductId)
    },
    /** @param productId 商品 id。 @returns 剩余购买冷却小时数。 */
    shop_purchase_cooldown_left(productId: unknown) {
      const normalizedProductId = assertRuntimeShopProductId(bundle, productId)
      return getShopPurchaseCooldownLeftHours(snapshot, normalizedProductId)
    },
    /** @param productId 商品 id。 @param roleKey 收礼角色键。 @returns 该组合剩余赠礼冷却小时数。 */
    shop_gift_cooldown_left(productId: unknown, roleKey: unknown) {
      const normalizedProductId = assertRuntimeShopProductId(bundle, productId)
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      return getShopGiftCooldownLeftHours(snapshot, normalizedProductId, normalizedRoleKey)
    }
  }
}

/** @param bundle 编译故事。 @param snapshot 行动状态。 @returns 解锁、锁定、设置冷却和只读查询脚本函数。 */
export function createRuntimeDoingScriptFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot
) {
  const readableFunctions = createRuntimeDoingReadableFunctions(bundle, snapshot)

  return {
    /** @param doingId 行动 id。 @returns true；加入解锁列表并从锁定列表移除。 */
    doing_unlock(doingId: unknown) {
      const normalizedDoingId = assertRuntimeDoingId(bundle, doingId)
      normalizeDoingState(snapshot)
      if (!snapshot.doing.unlocked_ids.includes(normalizedDoingId)) {
        snapshot.doing.unlocked_ids.push(normalizedDoingId)
      }
      snapshot.doing.locked_ids = snapshot.doing.locked_ids.filter((item) => item !== normalizedDoingId)
      return true
    },
    /** @param doingId 行动 id。 @returns false；把行动加入锁定列表，供表达式直接使用。 */
    doing_lock(doingId: unknown) {
      const normalizedDoingId = assertRuntimeDoingId(bundle, doingId)
      normalizeDoingState(snapshot)
      if (!snapshot.doing.locked_ids.includes(normalizedDoingId)) {
        snapshot.doing.locked_ids.push(normalizedDoingId)
      }
      return false
    },
    /** @param doingId 行动 id。 @param hours 从当前时间起的冷却小时。 @returns 冷却结束游戏分钟，0 小时返回 0。 */
    doing_set_cooldown(doingId: unknown, hours: unknown) {
      const normalizedDoingId = assertRuntimeDoingId(bundle, doingId)
      const normalizedHours = typeof hours === "number" && Number.isFinite(hours)
        ? Math.max(0, Math.trunc(hours))
        : 0
      const record = ensureDoingRecord(snapshot, normalizedDoingId)
      record.cooldown_until_game_minute = normalizedHours > 0
        ? getCurrentGameMinute(snapshot) + normalizedHours * 60
        : null
      return record.cooldown_until_game_minute ?? 0
    },
    ...readableFunctions
  }
}

/** @param bundle 编译故事。 @param snapshot 商店状态。 @param notifications UI 通知数组。 @returns 购买、赠礼和查询脚本函数。 */
export function createRuntimeShopScriptFunctions(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  notifications: string[]
) {
  const readableFunctions = createRuntimeShopReadableFunctions(bundle, snapshot)

  return {
    /** @param productId 商品 id。 @returns 购买结果；成功时会扣款、入包并写购买记录。 */
    shop_buy(productId: unknown) {
      const normalizedProductId = assertRuntimeShopProductId(bundle, productId)
      return buyShopProduct(bundle, snapshot, notifications, normalizedProductId)
    },
    /** @param productId 商品 id。 @param roleKey 收礼角色键。 @returns 赠礼结果；成功时扣款并直接送出，不进入背包。 */
    shop_gift(productId: unknown, roleKey: unknown) {
      const normalizedProductId = assertRuntimeShopProductId(bundle, productId)
      const normalizedRoleKey = assertRuntimeContactRoleKey(bundle, roleKey)
      return giftShopProduct(bundle, snapshot, notifications, normalizedProductId, normalizedRoleKey)
    },
    ...readableFunctions
  }
}
