/**
 * 玩家背包赠礼领域：解析商城赠礼配置、验证联系人与库存，并原子完成赠礼。
 */
import type { RuntimeBagEntry, RuntimeStorySessionSnapshot, RuntimeStoryShopProduct } from "./contracts-core"
import type { RuntimeStoryBundle } from "./contracts-view"
import { ensureShopGiftRecord, getBundleShopConfig, getShopGiftCooldownLeftHours } from "./doing-shop"
import { sendPhoneMessageToContact } from "./phone-actions"
import { buildRuntimePhoneContactMeta, getBundleItemNameMap } from "./phone-config"
import { isPhoneConversationNormalChatLocked } from "./phone-conversations"
import { assertRuntimePhoneRoleKey, findRoleLabel, getPhoneContact } from "./phone-threads"
import { getCurrentGameMinute } from "./schedule-clock"
import { createRuntimeBagScriptFunctions, findBagEntry } from "./script-context"
import { appendHistory } from "./script-execution"
import { clampPhoneFavor, normalizeItemId } from "./state-values"

export interface RuntimeBagGiftProductResolution {
  product: RuntimeStoryShopProduct | null
  error: string | null
}

/** @param bundle 编译故事。 @param itemId 物品 id。 @returns 唯一可赠商城配置；缺失或重复时返回错误。 */
export function resolveBagGiftProduct(
  bundle: RuntimeStoryBundle,
  itemId: string
): RuntimeBagGiftProductResolution {
  const normalizedItemId = normalizeItemId(itemId)
  const products = getBundleShopConfig(bundle).products.filter(
    (product) => product.allow_gift && normalizeItemId(product.item_id) === normalizedItemId
  )

  if (products.length === 0) {
    return {
      product: null,
      error: "该物品没有可赠商城配置。"
    }
  }

  if (products.length > 1) {
    return {
      product: null,
      error: `物品 "${normalizedItemId}" 存在多个可赠商城配置。`
    }
  }

  return {
    product: products[0] ?? null,
    error: null
  }
}

/** @param bundle 编译故事。 @param entry 玩家背包条目。 @returns 客户端展示所需的可赠状态和商城赠礼参数。 */
export function resolveBagGiftEntryState(bundle: RuntimeStoryBundle, entry: RuntimeBagEntry) {
  const resolution = resolveBagGiftProduct(bundle, entry.item_id)
  const disabledReason = entry.bound
    ? "绑定物品不可赠送。"
    : resolution.error

  return {
    giftable: !disabledReason && Boolean(resolution.product),
    giftFavorDelta: resolution.product?.gift_favor_delta ?? 0,
    giftCooldownHours: resolution.product?.gift_cooldown_hours ?? 0,
    giftDisabledReason: disabledReason
  }
}

/**
 * 从玩家背包赠送物品给已有联系人。
 * @param bundle 编译故事。 @param snapshot 会话快照。 @param notifications UI 通知数组。
 * @param itemId 物品 id。 @param roleKey 收礼联系人。 @param quantity 正整数数量。 @returns 成功时为 true。
 * @throws 配置、联系人、剧情锁定、库存、绑定或冷却任一条件不满足时抛错，失败前不修改状态。
 */
export function giftBagItem(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  notifications: string[],
  itemId: string,
  roleKey: string,
  quantity: number
) {
  const normalizedItemId = normalizeItemId(itemId)
  if (!normalizedItemId) {
    throw new Error("赠礼物品不能为空。")
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("赠礼数量必须是正整数。")
  }

  const normalizedRoleKey = assertRuntimePhoneRoleKey(bundle, roleKey)
  const contact = getPhoneContact(snapshot, normalizedRoleKey)
  if (!contact) {
    throw new Error("只能赠送给当前好友列表中的联系人。")
  }

  const contactMeta = buildRuntimePhoneContactMeta(bundle, normalizedRoleKey, contact.favor)
  if (!contactMeta.canContact) {
    throw new Error(contactMeta.lockMessage ?? "当前无法联系该好友。")
  }

  if (isPhoneConversationNormalChatLocked(bundle, snapshot, normalizedRoleKey)) {
    throw new Error("该联系人正在进行剧情手机对话，暂时不能赠礼。")
  }

  const resolution = resolveBagGiftProduct(bundle, normalizedItemId)
  if (!resolution.product) {
    throw new Error(resolution.error ?? "该物品不能赠送。")
  }

  const entry = findBagEntry(snapshot, "player", normalizedItemId)
  if (!entry || entry.quantity < quantity) {
    throw new Error(`背包物品数量不足，需要 ${quantity}，当前只有 ${entry?.quantity ?? 0}。`)
  }

  if (entry.bound) {
    throw new Error("绑定物品不可赠送。")
  }

  const cooldownLeftHours = getShopGiftCooldownLeftHours(snapshot, resolution.product.id, normalizedRoleKey)
  if (cooldownLeftHours > 0) {
    throw new Error(`送礼冷却中，还需 ${Math.ceil(cooldownLeftHours)} 小时。`)
  }

  const removed = createRuntimeBagScriptFunctions(bundle, snapshot).bag_remove(
    "player",
    normalizedItemId,
    quantity
  )
  if (!removed) {
    throw new Error("赠礼扣除背包物品失败。")
  }

  const previousFavor = contact.favor
  contact.favor = clampPhoneFavor(
    previousFavor + resolution.product.gift_favor_delta * quantity,
    previousFavor
  )
  const appliedFavorDelta = contact.favor - previousFavor
  const currentGameMinute = getCurrentGameMinute(snapshot)
  const record = ensureShopGiftRecord(snapshot, resolution.product.id, normalizedRoleKey)
  record.gifted_count += 1
  record.last_gifted_game_minute = currentGameMinute
  record.cooldown_until_game_minute = resolution.product.gift_cooldown_hours > 0
    ? currentGameMinute + resolution.product.gift_cooldown_hours * 60
    : null

  const itemName = getBundleItemNameMap(bundle).get(normalizedItemId) ?? normalizedItemId
  const roleLabel = findRoleLabel(bundle, normalizedRoleKey)
  sendPhoneMessageToContact(bundle, snapshot, normalizedRoleKey, `我送给你${itemName} x${quantity}。`)
  notifications.push(`已送给 ${roleLabel}：${itemName} x${quantity}，好感 ${appliedFavorDelta >= 0 ? "+" : ""}${appliedFavorDelta}`)
  appendHistory(snapshot, {
    type: "system",
    id: `bag-gift:${resolution.product.id}:${normalizedRoleKey}:${record.gifted_count}`,
    title: "bag:gift",
    content: `从背包送给 ${roleLabel} ${itemName} x${quantity}，好感变化 ${appliedFavorDelta}。`
  })

  return true
}
