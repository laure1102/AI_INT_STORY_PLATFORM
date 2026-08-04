/**
 * 商城货架与初始背包的持久化 Schema。
 *
 * 商品和背包中的物品引用会在完整故事验证阶段再次检查。
 */
import { z } from "zod"

export const storyShopCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  sort_order: z.number().int().default(0),
  visible_expr: z.string().default(""),
  descr: z.string().default("")
}).transform((category) => ({
  id: category.id.trim(),
  name: category.name.trim(),
  sort_order: category.sort_order,
  visible_expr: category.visible_expr.trim(),
  descr: category.descr
}))

export const storyShopProductSchema = z.object({
  id: z.string().min(1),
  category_id: z.string().min(1),
  item_id: z.string().min(1),
  price: z.number().min(0).default(0),
  quantity: z.number().int().min(1).default(1),
  sort_order: z.number().int().default(0),
  enabled: z.boolean().default(true),
  available_expr: z.string().default(""),
  unavailable_reason: z.string().default(""),
  allow_gift: z.boolean().default(true),
  gift_favor_delta: z.number().int().min(-100).max(100).default(0),
  purchase_cooldown_hours: z.number().int().min(0).default(0),
  gift_cooldown_hours: z.number().int().min(0).default(0)
}).transform((product) => ({
  id: product.id.trim(),
  category_id: product.category_id.trim(),
  item_id: product.item_id.trim(),
  price: product.price,
  quantity: product.quantity,
  sort_order: product.sort_order,
  enabled: product.enabled,
  available_expr: product.available_expr.trim(),
  unavailable_reason: product.unavailable_reason.trim(),
  allow_gift: product.allow_gift,
  gift_favor_delta: product.gift_favor_delta,
  purchase_cooldown_hours: product.purchase_cooldown_hours,
  gift_cooldown_hours: product.gift_cooldown_hours
}))

export const storyShopSchema = z.object({
  currency_value_key: z.string().default("player.money"),
  categories: z.array(storyShopCategorySchema).default([]),
  products: z.array(storyShopProductSchema).default([])
}).superRefine((shopFile, context) => {
  const categoryIds = new Set<string>()
  const productIds = new Set<string>()
  const giftProductIdsByItemId = new Map<string, string>()

  for (const [categoryIndex, category] of shopFile.categories.entries()) {
    if (categoryIds.has(category.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate shop category id "${category.id}".`,
        path: ["categories", categoryIndex, "id"]
      })
    }

    categoryIds.add(category.id)
  }

  for (const [productIndex, product] of shopFile.products.entries()) {
    if (productIds.has(product.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate shop product id "${product.id}".`,
        path: ["products", productIndex, "id"]
      })
    }

    productIds.add(product.id)

    if (!categoryIds.has(product.category_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Shop product "${product.id}" references missing category "${product.category_id}".`,
        path: ["products", productIndex, "category_id"]
      })
    }

    if (product.allow_gift) {
      const existingProductId = giftProductIdsByItemId.get(product.item_id)
      if (existingProductId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Shop products "${existingProductId}" and "${product.id}" both define gift behavior for item "${product.item_id}".`,
          path: ["products", productIndex, "item_id"]
        })
      } else {
        giftProductIdsByItemId.set(product.item_id, product.id)
      }
    }
  }
}).transform((shopFile) => ({
  currency_value_key: shopFile.currency_value_key.trim() || "player.money",
  categories: shopFile.categories,
  products: shopFile.products
}))

export const storyInitialBagEntrySchema = z.object({
  item_id: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  bound: z.boolean().default(false),
  meta: z.record(z.unknown()).default({})
}).transform((entry) => ({
  item_id: entry.item_id.trim(),
  quantity: entry.quantity,
  bound: entry.bound,
  meta: entry.meta
}))

export const storyInitialBagSchema = z.object({
  entries: z.array(storyInitialBagEntrySchema).default([])
})

export const storyInitialBagsSchema = z.record(storyInitialBagSchema)
  .default({
    player: {
      entries: []
    }
  })
  .transform((bags) => ({
    player: bags.player ?? { entries: [] },
    ...bags
  }))
  .superRefine((bags, context) => {
    for (const [ownerId, bag] of Object.entries(bags)) {
      if (!ownerId.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bag owner id is required.",
          path: [ownerId]
        })
      }

      const itemIds = new Set<string>()
      for (const [entryIndex, entry] of bag.entries.entries()) {
        if (itemIds.has(entry.item_id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate initial bag item "${entry.item_id}" for owner "${ownerId}".`,
            path: [ownerId, "entries", entryIndex, "item_id"]
          })
        }

        itemIds.add(entry.item_id)
      }
    }
  })
