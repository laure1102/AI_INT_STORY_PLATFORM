/**
 * 行动与商城状态、条件和修改操作。
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
import type { RuntimeStoryDoingDefinition, RuntimeStoryDoingFile, RuntimeStoryDoingMenu, RuntimeStorySessionSnapshot, RuntimeStoryShopCategory, RuntimeStoryShopFile, RuntimeStoryShopProduct } from "./contracts-core"
import type { RuntimeStoryBundle } from "./contracts-view"
import { DEFAULT_MAX_CALC_NESTING_DEPTH } from "./contracts-view"
import { sendPhoneMessageToContact } from "./phone-actions"
import { getBundleItemNameMap } from "./phone-config"
import { assertRuntimePhoneRoleKey, ensurePhoneContact, findRoleLabel } from "./phone-threads"
import { getCurrentGameMinute } from "./schedule-clock"
import { buildRuntimeContextValues, createRuntimeBagScriptFunctions, findBagEntry } from "./script-context"
import { appendHistory } from "./script-execution"
import { clampPhoneFavor, createCombinedValsFile, createDefaultDoingConfig, createDefaultShopConfig, normalizeDoingId, normalizeDoingState, normalizeItemId, normalizePhoneRoleKey, normalizeShopProductId, normalizeShopState, normalizeText, readSnapshotValue, writeSnapshotValue } from "./state-values"

/** @param bundle 编译故事。 @returns 去空白后的全部合法物品 id 集合，用于快速校验脚本输入。 */
export function getBundleItemIds(bundle: RuntimeStoryBundle) {
  return new Set((bundle.items?.items ?? []).map((item) => item.id.trim()).filter(Boolean))
}

/** @param bundle 编译故事。 @returns 数组字段已补齐的行动配置；旧 bundle 缺字段时返回空配置。 */
export function getBundleDoingConfig(bundle: RuntimeStoryBundle): RuntimeStoryDoingFile {
  const rawConfig = bundle.doing ?? createDefaultDoingConfig()
  return {
    menus: Array.isArray(rawConfig.menus) ? rawConfig.menus : [],
    doings: Array.isArray(rawConfig.doings) ? rawConfig.doings : []
  }
}

/** @param bundle 编译故事。 @returns 货币键、分类和商品字段完整的商店配置。 */
export function getBundleShopConfig(bundle: RuntimeStoryBundle): RuntimeStoryShopFile {
  const rawConfig = bundle.shop ?? createDefaultShopConfig()
  return {
    currency_value_key: normalizeText(rawConfig.currency_value_key) || "player.money",
    categories: Array.isArray(rawConfig.categories) ? rawConfig.categories : [],
    products: Array.isArray(rawConfig.products) ? rawConfig.products : []
  }
}

/** @param bundle 编译故事。 @returns 所有规范行动 id 的 Set。 */
export function getBundleDoingIds(bundle: RuntimeStoryBundle) {
  return new Set(getBundleDoingConfig(bundle).doings.map((doing) => normalizeDoingId(doing.id)).filter(Boolean))
}

/** @param bundle 编译故事。 @returns 所有规范商品 id 的 Set。 */
export function getBundleShopProductIds(bundle: RuntimeStoryBundle) {
  return new Set(getBundleShopConfig(bundle).products.map((product) => normalizeShopProductId(product.id)).filter(Boolean))
}

/** @param bundle 编译故事。 @param doingId 行动 id。 @returns 对应定义，id 为空或不存在时为 null。 */
export function findBundleDoing(bundle: RuntimeStoryBundle, doingId: string) {
  const normalizedDoingId = normalizeDoingId(doingId)
  if (!normalizedDoingId) {
    return null
  }

  return getBundleDoingConfig(bundle).doings.find((doing) => doing.id === normalizedDoingId) ?? null
}

/** @param bundle 编译故事。 @param productId 商品 id。 @returns 对应商品定义，不存在时为 null。 */
export function findBundleShopProduct(bundle: RuntimeStoryBundle, productId: string) {
  const normalizedProductId = normalizeShopProductId(productId)
  if (!normalizedProductId) {
    return null
  }

  return getBundleShopConfig(bundle).products.find((product) => product.id === normalizedProductId) ?? null
}

/** @param snapshot 会话快照。 @param doingId 行动 id。 @returns 已有使用/冷却记录，不存在时为 null。 */
export function findDoingRecord(snapshot: RuntimeStorySessionSnapshot, doingId: string) {
  normalizeDoingState(snapshot)
  const normalizedDoingId = normalizeDoingId(doingId)
  if (!normalizedDoingId) {
    return null
  }

  return snapshot.doing.records.find((record) => record.id === normalizedDoingId) ?? null
}

/** @param snapshot 会话快照。 @param doingId 行动 id。 @returns 已有或新建的可变行动记录。 */
export function ensureDoingRecord(snapshot: RuntimeStorySessionSnapshot, doingId: string) {
  normalizeDoingState(snapshot)
  const normalizedDoingId = normalizeDoingId(doingId)
  let record = snapshot.doing.records.find((item) => item.id === normalizedDoingId)
  if (!record) {
    record = {
      id: normalizedDoingId,
      used_count: 0,
      last_used_game_minute: null,
      cooldown_until_game_minute: null
    }
    snapshot.doing.records.push(record)
  }

  return record
}

/** @param snapshot 会话快照。 @param doingId 行动 id。 @returns 以小时表示的非负剩余冷却，允许小数。 */
export function getDoingCooldownLeftHours(snapshot: RuntimeStorySessionSnapshot, doingId: string) {
  const record = findDoingRecord(snapshot, doingId)
  if (!record?.cooldown_until_game_minute) {
    return 0
  }

  const remainingMinutes = Math.max(0, record.cooldown_until_game_minute - getCurrentGameMinute(snapshot))
  return remainingMinutes / 60
}

/** @param bundle 编译故事。 @param doingId 未知输入。 @returns 规范且确实存在的行动 id。 @throws id 为空或未定义时抛错。 */
export function assertRuntimeDoingId(bundle: RuntimeStoryBundle, doingId: unknown) {
  const normalizedDoingId = normalizeDoingId(doingId)
  if (!normalizedDoingId) {
    throw new Error("doing id is required.")
  }

  if (!getBundleDoingIds(bundle).has(normalizedDoingId)) {
    throw new Error(`doing "${normalizedDoingId}" does not exist in runtime doing library.`)
  }

  return normalizedDoingId
}

/** @param bundle 编译故事。 @param productId 未知输入。 @returns 规范且存在的商品 id。 @throws id 为空或未定义时抛错。 */
export function assertRuntimeShopProductId(bundle: RuntimeStoryBundle, productId: unknown) {
  const normalizedProductId = normalizeShopProductId(productId)
  if (!normalizedProductId) {
    throw new Error("shop product id is required.")
  }

  if (!getBundleShopProductIds(bundle).has(normalizedProductId)) {
    throw new Error(`shop product "${normalizedProductId}" does not exist in runtime shop library.`)
  }

  return normalizedProductId
}

/** @param snapshot 会话快照。 @param productId 商品 id。 @returns 已有购买记录，不存在时为 null。 */
export function findShopPurchaseRecord(snapshot: RuntimeStorySessionSnapshot, productId: string) {
  normalizeShopState(snapshot)
  const normalizedProductId = normalizeShopProductId(productId)
  if (!normalizedProductId) {
    return null
  }

  return snapshot.shop.purchases.find((record) => record.product_id === normalizedProductId) ?? null
}

/** @param snapshot 会话快照。 @param productId 商品 id。 @returns 已有或新建的可变购买记录。 */
export function ensureShopPurchaseRecord(snapshot: RuntimeStorySessionSnapshot, productId: string) {
  normalizeShopState(snapshot)
  const normalizedProductId = normalizeShopProductId(productId)
  let record = snapshot.shop.purchases.find((item) => item.product_id === normalizedProductId)
  if (!record) {
    record = {
      product_id: normalizedProductId,
      purchased_count: 0,
      last_purchased_game_minute: null,
      cooldown_until_game_minute: null
    }
    snapshot.shop.purchases.push(record)
  }

  return record
}

/** @param snapshot 会话快照。 @param productId 商品 id。 @param roleKey 收礼角色。 @returns 该组合赠礼记录或 null。 */
export function findShopGiftRecord(snapshot: RuntimeStorySessionSnapshot, productId: string, roleKey: string) {
  normalizeShopState(snapshot)
  const normalizedProductId = normalizeShopProductId(productId)
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  if (!normalizedProductId || !normalizedRoleKey) {
    return null
  }

  return snapshot.shop.gifts.find(
    (record) => record.product_id === normalizedProductId && record.role_key === normalizedRoleKey
  ) ?? null
}

/** @param snapshot 会话快照。 @param productId 商品 id。 @param roleKey 收礼角色。 @returns 已有或新建的赠礼记录。 */
export function ensureShopGiftRecord(snapshot: RuntimeStorySessionSnapshot, productId: string, roleKey: string) {
  normalizeShopState(snapshot)
  const normalizedProductId = normalizeShopProductId(productId)
  const normalizedRoleKey = normalizePhoneRoleKey(roleKey)
  let record = snapshot.shop.gifts.find(
    (item) => item.product_id === normalizedProductId && item.role_key === normalizedRoleKey
  )
  if (!record) {
    record = {
      product_id: normalizedProductId,
      role_key: normalizedRoleKey,
      gifted_count: 0,
      last_gifted_game_minute: null,
      cooldown_until_game_minute: null
    }
    snapshot.shop.gifts.push(record)
  }

  return record
}

/** @param snapshot 会话快照。 @param productId 商品 id。 @returns 剩余购买冷却小时数，没有记录时为 0。 */
export function getShopPurchaseCooldownLeftHours(snapshot: RuntimeStorySessionSnapshot, productId: string) {
  const record = findShopPurchaseRecord(snapshot, productId)
  if (!record?.cooldown_until_game_minute) {
    return 0
  }

  const remainingMinutes = Math.max(0, record.cooldown_until_game_minute - getCurrentGameMinute(snapshot))
  return remainingMinutes / 60
}

/** @param snapshot 会话快照。 @param productId 商品 id。 @param roleKey 收礼角色。 @returns 该组合剩余赠礼冷却小时数。 */
export function getShopGiftCooldownLeftHours(
  snapshot: RuntimeStorySessionSnapshot,
  productId: string,
  roleKey: string
) {
  const record = findShopGiftRecord(snapshot, productId, roleKey)
  if (!record?.cooldown_until_game_minute) {
    return 0
  }

  const remainingMinutes = Math.max(0, record.cooldown_until_game_minute - getCurrentGameMinute(snapshot))
  return remainingMinutes / 60
}

/** @param snapshot 会话快照。 @param token 变量路径。 @returns 数字或可转数字字符串的值，无法转换时为 null。 */
export function getSnapshotNumericValue(snapshot: RuntimeStorySessionSnapshot, token: string) {
  const value = readSnapshotValue(snapshot, token)
  const normalized = typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN

  return Number.isFinite(normalized) ? normalized : null
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @returns 商店配置货币变量的余额，变量无效时为 null。 */
export function getShopCurrencyBalance(bundle: RuntimeStoryBundle, snapshot: RuntimeStorySessionSnapshot) {
  return getSnapshotNumericValue(snapshot, getBundleShopConfig(bundle).currency_value_key)
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @param value 新余额。 @returns 写入结果；余额会截整并限制为非负数。 */
export function writeShopCurrencyBalance(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  value: number
) {
  return writeSnapshotValue(
    snapshot,
    getBundleShopConfig(bundle).currency_value_key,
    Math.max(0, Math.trunc(value))
  )
}

/**
 * 在安全 StoryScript 上下文中计算商店显示/购买条件。
 * @param bundle 编译故事。 @param snapshot 当前快照。 @param source 布尔表达式源码。
 * @returns `{ ok, error? }`；空表达式视为通过，语法或执行错误转为失败说明而不让界面崩溃。
 */
export function evaluateRuntimeShopPredicate(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  source: string
) {
  const normalizedSource = normalizeText(source)
  if (!normalizedSource) {
    return {
      ok: true,
      error: ""
    }
  }

  try {
    const result = evaluateStoryBooleanExpression(
      createCombinedValsFile(snapshot),
      normalizedSource,
      DEFAULT_MAX_CALC_NESTING_DEPTH,
      buildRuntimeContextValues(bundle, snapshot, {})
    )
    return {
      ok: Boolean(result.result),
      error: ""
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "条件计算失败。"
    }
  }
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @param category 商店分类。 @returns 分类 visible_expr 是否通过。 */
export function isRuntimeShopCategoryVisible(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  category: RuntimeStoryShopCategory
) {
  const visibleResult = evaluateRuntimeShopPredicate(bundle, snapshot, category.visible_expr)
  return visibleResult.ok
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @returns 当前所有可见分类 id 的 Set。 */
export function getRuntimeShopVisibleCategoryIds(bundle: RuntimeStoryBundle, snapshot: RuntimeStorySessionSnapshot) {
  const shopConfig = getBundleShopConfig(bundle)
  return new Set(
    shopConfig.categories
      .filter((category) => isRuntimeShopCategoryVisible(bundle, snapshot, category))
      .map((category) => category.id)
  )
}

/**
 * 按固定顺序检查商品为何不可购买。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param product 商品定义。
 * @param options 可关闭余额检查，供仅展示其它限制的场景。 @returns 可购买时为 null，否则返回面向用户的首个阻止原因。
 * 检查分类可见、商品条件、购买次数、冷却和余额；只返回首个原因，保证按钮提示稳定易懂。
 */
export function resolveShopProductDisabledReason(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  product: RuntimeStoryShopProduct,
  options: {
    checkMoney?: boolean
  } = {}
) {
  const checkMoney = options.checkMoney ?? true
  const itemId = normalizeItemId(product.item_id)

  if (!product.enabled) {
    return "商品已下架。"
  }

  if (!getRuntimeShopVisibleCategoryIds(bundle, snapshot).has(product.category_id)) {
    return "商品所属分类当前不可见。"
  }

  if (!itemId || !getBundleItemIds(bundle).has(itemId)) {
    return `商品引用的物品 "${itemId || product.item_id}" 不存在。`
  }

  const availableResult = evaluateRuntimeShopPredicate(bundle, snapshot, product.available_expr)
  if (!availableResult.ok) {
    return availableResult.error || product.unavailable_reason || "当前展示条件不满足。"
  }

  const cooldownLeftHours = getShopPurchaseCooldownLeftHours(snapshot, product.id)
  if (cooldownLeftHours > 0) {
    return `购买冷却中，还需 ${Math.ceil(cooldownLeftHours)} 小时。`
  }

  if (checkMoney && product.price > 0) {
    const currentMoney = getShopCurrencyBalance(bundle, snapshot)
    if (currentMoney === null) {
      return `扣款变量 ${getBundleShopConfig(bundle).currency_value_key} 当前不可读取。`
    }

    if (currentMoney < product.price) {
      return `需要 ${product.price} 元，当前只有 ${Math.max(0, Math.trunc(currentMoney))} 元。`
    }
  }

  return null
}

/** @param bundle 编译故事。 @param snapshot 会话快照。 @param productId 商品 id。 @returns 商品存在且没有禁用原因时为 true。 */
export function canBuyShopProduct(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  productId: string
) {
  const product = findBundleShopProduct(bundle, productId)
  if (!product) {
    return false
  }

  return !resolveShopProductDisabledReason(bundle, snapshot, product)
}

/**
 * 完成一次原子式的运行时购买。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param notifications UI 通知数组。 @param productId 商品 id。
 * @returns 购买后的商品/余额等结果。 @throws 商品不存在、不可买或货币配置不可用时抛错，失败前不改状态。
 * 通过全部检查后依次扣余额、增加玩家背包、更新次数与冷却并发通知。
 */
export function buyShopProduct(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  notifications: string[],
  productId: string
) {
  const normalizedProductId = assertRuntimeShopProductId(bundle, productId)
  const product = findBundleShopProduct(bundle, normalizedProductId)
  if (!product) {
    throw new Error(`商城商品 "${normalizedProductId}" 不存在。`)
  }

  const disabledReason = resolveShopProductDisabledReason(bundle, snapshot, product)
  if (disabledReason) {
    throw new Error(disabledReason)
  }

  if (product.price > 0) {
    const currentMoney = getShopCurrencyBalance(bundle, snapshot)
    if (currentMoney === null) {
      throw new Error(`扣款变量 ${getBundleShopConfig(bundle).currency_value_key} 当前不可读取。`)
    }

    if (currentMoney < product.price) {
      throw new Error(`需要 ${product.price} 元，当前只有 ${Math.max(0, Math.trunc(currentMoney))} 元。`)
    }

    if (!writeShopCurrencyBalance(bundle, snapshot, currentMoney - product.price)) {
      throw new Error(`${getBundleShopConfig(bundle).currency_value_key} 不是可写 value 变量，无法扣款。`)
    }
  }

  createRuntimeBagScriptFunctions(bundle, snapshot).bag_add("player", product.item_id, product.quantity)

  const record = ensureShopPurchaseRecord(snapshot, product.id)
  const currentGameMinute = getCurrentGameMinute(snapshot)
  record.purchased_count += 1
  record.last_purchased_game_minute = currentGameMinute
  record.cooldown_until_game_minute = product.purchase_cooldown_hours > 0
    ? currentGameMinute + product.purchase_cooldown_hours * 60
    : null

  const itemName = getBundleItemNameMap(bundle).get(product.item_id) ?? product.item_id
  notifications.push(`已购买：${itemName} x${product.quantity}`)
  appendHistory(snapshot, {
    type: "system",
    id: `shop-buy:${product.id}:${record.purchased_count}`,
    title: "shop:buy",
    content: `购买 ${itemName} x${product.quantity}，花费 ${product.price}。`
  })

  return true
}

/**
 * 将玩家背包中的可赠商品送给联系人。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param notifications UI 通知数组。
 * @param productId 商品 id。 @param roleKey 收礼角色键。 @returns 更新后的赠礼结果。
 * @throws 商品不可赠、未添加联系人、库存不足或仍在冷却时抛错；校验通过后才扣物品并写记录。
 */
export function giftShopProduct(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  notifications: string[],
  productId: string,
  roleKey: string
) {
  const normalizedProductId = assertRuntimeShopProductId(bundle, productId)
  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  const product = findBundleShopProduct(bundle, normalizedProductId)
  if (!product) {
    throw new Error(`商城商品 "${normalizedProductId}" 不存在。`)
  }

  if (!product.allow_gift) {
    throw new Error("该商品不能送人。")
  }

  const itemId = normalizeItemId(product.item_id)
  if (!itemId || !getBundleItemIds(bundle).has(itemId)) {
    throw new Error(`商品引用的物品 "${itemId || product.item_id}" 不存在。`)
  }

  const cooldownLeftHours = getShopGiftCooldownLeftHours(snapshot, product.id, normalizedRoleKey)
  if (cooldownLeftHours > 0) {
    throw new Error(`送礼冷却中，还需 ${Math.ceil(cooldownLeftHours)} 小时。`)
  }

  const currentQuantity = findBagEntry(snapshot, "player", itemId)?.quantity ?? 0
  if (currentQuantity < product.quantity) {
    const itemName = getBundleItemNameMap(bundle).get(itemId) ?? itemId
    throw new Error(`背包里 ${itemName} 数量不足，需要 ${product.quantity}，当前只有 ${currentQuantity}。`)
  }

  const removed = createRuntimeBagScriptFunctions(bundle, snapshot).bag_remove("player", itemId, product.quantity)
  if (!removed) {
    throw new Error("送礼扣除背包物品失败。")
  }

  const contact = ensurePhoneContact(bundle, snapshot, normalizedRoleKey)
  contact.favor = clampPhoneFavor(contact.favor + product.gift_favor_delta, contact.favor)

  const record = ensureShopGiftRecord(snapshot, product.id, normalizedRoleKey)
  const currentGameMinute = getCurrentGameMinute(snapshot)
  record.gifted_count += 1
  record.last_gifted_game_minute = currentGameMinute
  record.cooldown_until_game_minute = product.gift_cooldown_hours > 0
    ? currentGameMinute + product.gift_cooldown_hours * 60
    : null

  const itemName = getBundleItemNameMap(bundle).get(itemId) ?? itemId
  const roleLabel = findRoleLabel(bundle, normalizedRoleKey)
  sendPhoneMessageToContact(bundle, snapshot, normalizedRoleKey, `我给你准备了${itemName}。`)
  notifications.push(`已送给 ${roleLabel}：${itemName} x${product.quantity}，好感 ${product.gift_favor_delta >= 0 ? "+" : ""}${product.gift_favor_delta}`)
  appendHistory(snapshot, {
    type: "system",
    id: `shop-gift:${product.id}:${normalizedRoleKey}:${record.gifted_count}`,
    title: "shop:gift",
    content: `送给 ${roleLabel} ${itemName} x${product.quantity}，好感变化 ${product.gift_favor_delta}。`
  })

  return true
}

/**
 * 计算行动菜单或行动条目的可见/可用条件。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param source StoryScript 布尔表达式。
 * @returns 空表达式为通过；其它情况返回 ok 及可展示错误，不把表达式异常抛到 UI。
 */
export function evaluateRuntimeDoingPredicate(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  source: string
) {
  const normalizedSource = normalizeText(source)
  if (!normalizedSource) {
    return {
      ok: true,
      error: ""
    }
  }

  try {
    const result = evaluateStoryBooleanExpression(
      createCombinedValsFile(snapshot),
      normalizedSource,
      DEFAULT_MAX_CALC_NESTING_DEPTH,
      buildRuntimeContextValues(bundle, snapshot, {})
    )
    return {
      ok: Boolean(result.result),
      error: ""
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "条件计算失败。"
    }
  }
}

/**
 * 解析所有行动菜单的可见状态，包括父菜单继承。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @returns menu id 到可见状态/隐藏原因的 Map。
 * 使用递归并缓存结果；访问链 Set 用于发现意外父级环，避免无限递归。
 */
export function buildRuntimeDoingMenuState(bundle: RuntimeStoryBundle, snapshot: RuntimeStorySessionSnapshot) {
  const doingConfig = getBundleDoingConfig(bundle)
  const menuById = new Map(doingConfig.menus.map((menu) => [menu.id, menu]))
  const stateById = new Map<string, {
    visible: boolean
    hiddenReason: string | null
  }>()

  /** @param menuId 当前菜单 id。 @param visiting 当前递归链。 @returns 计算并缓存后的菜单状态。 */
  const resolveMenuState = (
    menu: RuntimeStoryDoingMenu,
    visiting = new Set<string>()
  ): { visible: boolean; hiddenReason: string | null } => {
    const cached = stateById.get(menu.id)
    if (cached) {
      return cached
    }

    if (visiting.has(menu.id)) {
      const cyclicState = {
        visible: false,
        hiddenReason: "菜单父级配置存在循环。"
      }
      stateById.set(menu.id, cyclicState)
      return cyclicState
    }

    visiting.add(menu.id)

    const visibleResult = evaluateRuntimeDoingPredicate(bundle, snapshot, menu.visible_expr)
    if (!visibleResult.ok) {
      const hiddenState = {
        visible: false,
        hiddenReason: visibleResult.error || null
      }
      stateById.set(menu.id, hiddenState)
      return hiddenState
    }

    const parentMenu = menu.parent_id ? menuById.get(menu.parent_id) : null
    if (parentMenu) {
      const parentState = resolveMenuState(parentMenu, visiting)
      if (!parentState.visible) {
        const hiddenState = {
          visible: false,
          hiddenReason: parentState.hiddenReason
        }
        stateById.set(menu.id, hiddenState)
        return hiddenState
      }
    }

    const state = {
      visible: true,
      hiddenReason: null
    }
    stateById.set(menu.id, state)
    return state
  }

  for (const menu of doingConfig.menus) {
    resolveMenuState(menu)
  }

  return stateById
}

/**
 * 汇总某项行动在当前时刻的完整可用性。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param doing 行动定义。
 * @returns 是否可见、是否可执行、原因和剩余冷却等视图数据；不修改行动记录。
 */
export function resolveDoingAvailability(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  doing: RuntimeStoryDoingDefinition
) {
  normalizeDoingState(snapshot)
  const menuStates = buildRuntimeDoingMenuState(bundle, snapshot)
  const menuState = menuStates.get(doing.menu_id)
  if (!menuState?.visible) {
    return {
      visible: false,
      disabled: true,
      disabledReason: menuState?.hiddenReason ?? "行动所属菜单不可见。"
    }
  }

  const visibleResult = evaluateRuntimeDoingPredicate(bundle, snapshot, doing.visible_expr)
  if (!visibleResult.ok) {
    return {
      visible: false,
      disabled: true,
      disabledReason: visibleResult.error || "行动条件不满足。"
    }
  }

  if (snapshot.doing.locked_ids.includes(doing.id)) {
    return {
      visible: true,
      disabled: true,
      disabledReason: "该行动已锁定。"
    }
  }

  const record = findDoingRecord(snapshot, doing.id)
  if (doing.once && (record?.used_count ?? 0) > 0) {
    return {
      visible: true,
      disabled: true,
      disabledReason: "该行动已经完成。"
    }
  }

  const cooldownLeftHours = getDoingCooldownLeftHours(snapshot, doing.id)
  if (cooldownLeftHours > 0) {
    return {
      visible: true,
      disabled: true,
      disabledReason: `冷却中，还需 ${Math.ceil(cooldownLeftHours)} 小时。`
    }
  }

  return {
    visible: true,
    disabled: false,
    disabledReason: null
  }
}
