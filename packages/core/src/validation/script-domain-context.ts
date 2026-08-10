/**
 * Core 校验阶段使用的“领域函数模拟器”。
 *
 * StoryScript 校验必须实际走一遍解释器，但校验时没有真实背包、联系人、行动和商城存档。本模块提供
 * 无副作用的同名函数：它们验证 id 和参数格式，并返回不会阻断脚本的占位结果，却绝不修改业务数据。
 */
import type { StoryScriptExecutionContext } from "@story-mgr/storyscript"

export type StoryScriptValidationBagMode = "read" | "write"
export type StoryScriptValidationContactMode = "read" | "write"
export type StoryScriptValidationDoingMode = "read" | "write"
export type StoryScriptValidationShopMode = "read" | "write"

export interface StoryScriptValidationContextOptions {
  values?: Record<string, unknown>
  assignableValues?: Record<string, unknown>
  functions?: Record<string, (...args: unknown[]) => unknown>
  itemIds?: Iterable<string>
  roleKeys?: Iterable<string>
  doingIds?: Iterable<string>
  shopProductIds?: Iterable<string>
  contactConversationIds?: Iterable<string>
  bagMode?: StoryScriptValidationBagMode
  contactMode?: StoryScriptValidationContactMode
  doingMode?: StoryScriptValidationDoingMode
  shopMode?: StoryScriptValidationShopMode
}

/**
 * 把校验输入中的未知值规范成字符串。
 *
 * @param value 可能来自 Schema 或脚本参数的值。
 * @returns 字符串原样返回，其他类型返回空串。
 */
function normalizeStoryScriptText(value: unknown) {
  return typeof value === "string" ? value : ""
}

/**
 * 创建背包只读函数，并把合法物品 id 固化成 Set。
 *
 * @param itemIds 故事物品库中的 id。
 * @returns 可供解释器调用的 bag_count 和 bag_has。
 *
 * 模拟函数固定返回空背包结果；重点是发现脚本引用了不存在的物品，而不是预测真实存档数量。
 */
function buildValidationBagReadableFunctionsFromIds(itemIds: Iterable<string>) {
  const itemIdSet = new Set(
    Array.from(itemIds, (itemId) => normalizeStoryScriptText(itemId).trim()).filter(Boolean)
  )

  /**
   * 校验一个脚本物品参数。
   *
   * @param itemId StoryScript 传入的物品 id。
   * @returns 无返回值；通过即代表 id 存在。
   * @throws 缺失、空白或不在物品库时抛错。
   */
  function assertItemId(itemId: unknown) {
    if (typeof itemId !== "string") {
      throw new Error("bag item id is required.")
    }

    const normalizedItemId = itemId.trim()
    if (!normalizedItemId) {
      throw new Error("bag item id is required.")
    }

    if (!itemIdSet.has(normalizedItemId)) {
      throw new Error(`bag item "${normalizedItemId}" does not exist in item library.`)
    }
  }

  return {
    /** @param _ownerId 背包拥有者；校验阶段不读取存档。 @param itemId 物品 id。 @returns 固定为 0。 */
    bag_count(_ownerId: unknown, itemId: unknown) {
      assertItemId(itemId)
      return 0
    },
    /** @param _ownerId 背包拥有者。 @param itemId 物品 id。 @returns 固定为 false。 */
    bag_has(_ownerId: unknown, itemId: unknown) {
      assertItemId(itemId)
      return false
    }
  }
}

/**
 * 按 read/write 模式创建完整背包函数集合。
 *
 * @param itemIds 合法物品 id。
 * @param bagMode read 只允许查询，write 额外允许 add/remove。
 * @returns 模拟背包函数表；所有函数只验证参数，不写存档。
 */
function buildValidationBagScriptFunctionsFromIds(
  itemIds: Iterable<string>,
  bagMode: StoryScriptValidationBagMode
) {
  const readableFunctions = buildValidationBagReadableFunctionsFromIds(itemIds)

  if (bagMode === "read") {
    return readableFunctions
  }

  return {
    /** @param _ownerId 背包拥有者。 @param itemId 物品 id。 @param quantity 数量。 @returns 规范后的非负整数。 */
    bag_add(_ownerId: unknown, itemId: unknown, quantity?: unknown) {
      readableFunctions.bag_count(_ownerId, itemId)
      return typeof quantity === "number" && Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 1
    },
    ...readableFunctions,
    /** @param _ownerId 背包拥有者。 @param itemId 物品 id。 @returns 固定为 false，不真实删除。 */
    bag_remove(_ownerId: unknown, itemId: unknown) {
      readableFunctions.bag_count(_ownerId, itemId)
      return false
    }
  }
}

/**
 * 创建联系人只读函数，并检查角色引用。
 *
 * @param roleKeys 可作为联系人使用的 `normal:id` / `important:id` 集合。
 * @returns 联系人存在、好感和未读数三个模拟查询函数。
 */
function buildValidationContactReadableFunctionsFromRoleKeys(roleKeys: Iterable<string>) {
  const roleKeySet = new Set(
    Array.from(roleKeys, (roleKey) => normalizeStoryScriptText(roleKey).trim()).filter(Boolean)
  )

  /**
   * 校验联系人函数收到的角色 key。
   *
   * @param roleKey StoryScript 传入的联系人 key。
   * @returns 去掉首尾空格的合法 key。
   * @throws key 缺失或角色不存在时抛错。
   */
  function assertRoleKey(roleKey: unknown) {
    if (typeof roleKey !== "string") throw new Error("contact role key is required.")
    const normalizedRoleKey = roleKey.trim()
    if (!normalizedRoleKey) throw new Error("contact role key is required.")
    if (!roleKeySet.has(normalizedRoleKey)) {
      throw new Error(`contact role "${normalizedRoleKey}" does not exist in role library.`)
    }
    return normalizedRoleKey
  }

  return {
    /** @param roleKey 联系人角色 key。 @returns 固定 false；只做引用校验。 */
    contact_has(roleKey: unknown) {
      assertRoleKey(roleKey)
      return false
    },
    /** @param roleKey 联系人角色 key。 @returns 固定 0 的模拟好感。 */
    contact_favor(roleKey: unknown) {
      assertRoleKey(roleKey)
      return 0
    },
    /** @param roleKey 联系人角色 key。 @returns 固定 0 的模拟未读数。 */
    contact_unread_count(roleKey: unknown) {
      assertRoleKey(roleKey)
      return 0
    }
  }
}

/**
 * 按模式创建联系人脚本函数集合。
 *
 * @param roleKeys 合法联系人角色 key。
 * @param contactConversationIds 合法连续联系人剧情 id。
 * @param contactMode read 只开放查询，write 额外开放联系人、消息和剧情操作。
 * @returns 无副作用的联系人函数表。
 */
function buildValidationContactScriptFunctionsFromRoleKeys(
  roleKeys: Iterable<string>,
  contactConversationIds: Iterable<string>,
  contactMode: StoryScriptValidationContactMode
) {
  const readableFunctions = buildValidationContactReadableFunctionsFromRoleKeys(roleKeys)
  const contactConversationIdSet = new Set(
    Array.from(contactConversationIds, (conversationId) => normalizeStoryScriptText(conversationId).trim()).filter(Boolean)
  )

  if (contactMode === "read") return readableFunctions

  return {
    /** @param roleKey 联系人 key。 @returns 固定 true，表示模拟添加成功。 */
    contact_add(roleKey: unknown) {
      readableFunctions.contact_has(roleKey)
      return true
    },
    /** @param roleKey 联系人 key。 @returns 固定 false，表示模拟删除后的状态。 */
    contact_remove(roleKey: unknown) {
      readableFunctions.contact_has(roleKey)
      return false
    },
    /** @param roleKey 联系人 key。 @param favor 新好感。 @returns 截断到 0..100 的整数。 */
    contact_set_favor(roleKey: unknown, favor?: unknown) {
      readableFunctions.contact_has(roleKey)
      return typeof favor === "number" && Number.isFinite(favor) ? Math.max(0, Math.min(100, Math.trunc(favor))) : 0
    },
    /** @param roleKey 联系人 key。 @param delta 好感变化。 @returns 用于校验的 0..100 整数。 */
    contact_add_favor(roleKey: unknown, delta?: unknown) {
      readableFunctions.contact_has(roleKey)
      return typeof delta === "number" && Number.isFinite(delta) ? Math.max(0, Math.min(100, Math.trunc(delta))) : 0
    },
    /** @param roleKey 联系人 key。 @param content 对方消息。 @returns 去空格后的消息。 */
    contact_send_from(roleKey: unknown, content?: unknown) {
      readableFunctions.contact_has(roleKey)
      if (typeof content !== "string" || !content.trim()) throw new Error("contact message content is required.")
      return content.trim()
    },
    /** @param roleKey 联系人 key。 @param content 玩家消息。 @returns 去空格后的消息。 */
    contact_send_to(roleKey: unknown, content?: unknown) {
      readableFunctions.contact_has(roleKey)
      if (typeof content !== "string" || !content.trim()) throw new Error("contact message content is required.")
      return content.trim()
    },
    /** @param roleKey 联系人 key。 @returns 固定 0，模拟清空未读。 */
    contact_mark_read(roleKey: unknown) {
      readableFunctions.contact_has(roleKey)
      return 0
    },
    /** @param conversationId 连续联系人剧情 id。 @returns 引用有效时固定 true。 */
    contact_start_conversation(conversationId: unknown) {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("contact conversation id is required.")
      }
      const normalizedConversationId = conversationId.trim()
      if (!contactConversationIdSet.has(normalizedConversationId)) {
        throw new Error(`contact conversation "${normalizedConversationId}" does not exist in contact conversation library.`)
      }
      return true
    },
    ...readableFunctions
  }
}

/**
 * 创建玩家行动的只读校验函数。
 *
 * @param doingIds 故事行动库中的 id。
 * @returns 解锁状态、使用次数和冷却查询函数。
 */
function buildValidationDoingReadableFunctionsFromIds(doingIds: Iterable<string>) {
  const doingIdSet = new Set(
    Array.from(doingIds, (doingId) => normalizeStoryScriptText(doingId).trim()).filter(Boolean)
  )

  /** @param doingId 行动 id。 @returns 规范后的合法 id。 @throws 缺失或不存在时抛错。 */
  function assertDoingId(doingId: unknown) {
    if (typeof doingId !== "string") throw new Error("doing id is required.")
    const normalizedDoingId = doingId.trim()
    if (!normalizedDoingId) throw new Error("doing id is required.")
    if (!doingIdSet.has(normalizedDoingId)) {
      throw new Error(`doing "${normalizedDoingId}" does not exist in doing library.`)
    }
    return normalizedDoingId
  }

  return {
    /** @param doingId 行动 id。 @returns 固定 false 的模拟解锁状态。 */
    doing_has(doingId: unknown) {
      assertDoingId(doingId)
      return false
    },
    /** @param doingId 行动 id。 @returns 固定 0 的模拟使用次数。 */
    doing_used_count(doingId: unknown) {
      assertDoingId(doingId)
      return 0
    },
    /** @param doingId 行动 id。 @returns 固定 0 的模拟剩余冷却。 */
    doing_cooldown_left(doingId: unknown) {
      assertDoingId(doingId)
      return 0
    }
  }
}

/**
 * 按模式创建行动脚本函数。
 *
 * @param doingIds 合法行动 id。
 * @param doingMode read 或 write 权限模式。
 * @returns 参数校验用的行动函数表。
 */
function buildValidationDoingScriptFunctionsFromIds(
  doingIds: Iterable<string>,
  doingMode: StoryScriptValidationDoingMode
) {
  const readableFunctions = buildValidationDoingReadableFunctionsFromIds(doingIds)
  if (doingMode === "read") return readableFunctions

  return {
    /** @param doingId 行动 id。 @returns 固定 true，模拟解锁。 */
    doing_unlock(doingId: unknown) {
      readableFunctions.doing_has(doingId)
      return true
    },
    /** @param doingId 行动 id。 @returns 固定 false，模拟锁定。 */
    doing_lock(doingId: unknown) {
      readableFunctions.doing_has(doingId)
      return false
    },
    /** @param doingId 行动 id。 @param hours 冷却小时。 @returns 规范后的非负整数。 */
    doing_set_cooldown(doingId: unknown, hours?: unknown) {
      readableFunctions.doing_has(doingId)
      return typeof hours === "number" && Number.isFinite(hours) ? Math.max(0, Math.trunc(hours)) : 0
    },
    ...readableFunctions
  }
}

/**
 * 创建商城只读校验函数。
 *
 * @param productIds 合法商品 id。
 * @returns 购买资格、购买冷却和赠礼冷却查询函数。
 */
function buildValidationShopReadableFunctionsFromIds(productIds: Iterable<string>) {
  const productIdSet = new Set(
    Array.from(productIds, (productId) => normalizeStoryScriptText(productId).trim()).filter(Boolean)
  )

  /** @param productId 商品 id。 @returns 规范后的合法 id。 @throws 缺失或不存在时抛错。 */
  function assertProductId(productId: unknown) {
    if (typeof productId !== "string") throw new Error("shop product id is required.")
    const normalizedProductId = productId.trim()
    if (!normalizedProductId) throw new Error("shop product id is required.")
    if (!productIdSet.has(normalizedProductId)) {
      throw new Error(`shop product "${normalizedProductId}" does not exist in shop library.`)
    }
    return normalizedProductId
  }

  return {
    /** @param productId 商品 id。 @returns 固定 false 的模拟购买资格。 */
    shop_can_buy(productId: unknown) {
      assertProductId(productId)
      return false
    },
    /** @param productId 商品 id。 @returns 固定 0 的模拟购买冷却。 */
    shop_purchase_cooldown_left(productId: unknown) {
      assertProductId(productId)
      return 0
    },
    /** @param productId 商品 id。 @param roleKey 收礼角色 key。 @returns 固定 0 的模拟赠礼冷却。 */
    shop_gift_cooldown_left(productId: unknown, roleKey: unknown) {
      assertProductId(productId)
      if (typeof roleKey !== "string" || !roleKey.trim()) throw new Error("shop gift role key is required.")
      return 0
    }
  }
}

/**
 * 按模式创建商城脚本函数。
 *
 * @param productIds 合法商品 id。
 * @param shopMode read 或 write 权限模式。
 * @returns 无副作用的商城函数表。
 */
function buildValidationShopScriptFunctionsFromIds(
  productIds: Iterable<string>,
  shopMode: StoryScriptValidationShopMode
) {
  const readableFunctions = buildValidationShopReadableFunctionsFromIds(productIds)
  if (shopMode === "read") return readableFunctions

  return {
    /** @param productId 商品 id。 @returns 固定 false，仅校验引用。 */
    shop_buy(productId: unknown) {
      readableFunctions.shop_can_buy(productId)
      return false
    },
    /** @param productId 商品 id。 @param roleKey 收礼角色。 @returns 固定 false，仅校验引用。 */
    shop_gift(productId: unknown, roleKey: unknown) {
      readableFunctions.shop_gift_cooldown_left(productId, roleKey)
      return false
    },
    ...readableFunctions
  }
}

/**
 * 组合一份可交给 StoryScript 解释器试运行的校验上下文。
 *
 * @param options 外部值、合法领域 id、权限模式和额外函数。
 * @returns 独立的 values/assignableValues 副本和完整函数白名单。
 *
 * 自定义 functions 最后展开，允许特定编辑器场景有意识地覆盖默认模拟器；默认四个领域均为 write，
 * 触发条件等只读场景必须显式传 read，才能发现脚本误用了写函数。
 */
export function createStoryScriptValidationContext(
  options: StoryScriptValidationContextOptions = {}
): StoryScriptExecutionContext {
  const bagMode = options.bagMode ?? "write"
  const contactMode = options.contactMode ?? "write"
  const doingMode = options.doingMode ?? "write"
  const shopMode = options.shopMode ?? "write"

  return {
    values: { ...(options.values ?? {}) },
    assignableValues: { ...(options.assignableValues ?? {}) },
    functions: {
      ...buildValidationBagScriptFunctionsFromIds(options.itemIds ?? [], bagMode),
      ...buildValidationContactScriptFunctionsFromRoleKeys(
        options.roleKeys ?? [],
        options.contactConversationIds ?? [],
        contactMode
      ),
      ...buildValidationDoingScriptFunctionsFromIds(options.doingIds ?? [], doingMode),
      ...buildValidationShopScriptFunctionsFromIds(options.shopProductIds ?? [], shopMode),
      ...(options.functions ?? {})
    }
  }
}
