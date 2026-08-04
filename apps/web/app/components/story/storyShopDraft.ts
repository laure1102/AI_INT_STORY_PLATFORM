/**
 * 商城编辑器的纯草稿契约与输入转换工具。
 *
 * 输入来自表单控件的字符串，输出给 StoryShopDialog 组装保存对象。
 * 这里不持有 Vue 状态，也不会直接修改故事或发送请求。
 */
import type { StoryShopCategory, StoryShopProduct } from "@story-mgr/core"

export interface ShopCategoryDraft extends StoryShopCategory {
  draftKey: string
  sortOrderText: string
}

export interface ShopProductDraft extends StoryShopProduct {
  draftKey: string
  priceText: string
  quantityText: string
  sortOrderText: string
  giftFavorDeltaText: string
  purchaseCooldownHoursText: string
  giftCooldownHoursText: string
}

/** 将 `Text` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

/** 将 `NumberText` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
export function normalizeNumberText(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback)
}

/** 清理 `IdInput` 输入中的非法字符或范围。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function sanitizeIdInput(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

/** 解析 `IntegerInput` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
export function parseIntegerInput(value: unknown, fallback = 0) {
  const parsed = Number(String(value ?? "").trim())
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

/** 解析 `NonNegativeNumberInput` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
export function parseNonNegativeNumberInput(value: unknown, fallback = 0) {
  const parsed = Number(String(value ?? "").trim())
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

/** 解析 `PositiveIntegerInput` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
export function parsePositiveIntegerInput(value: unknown, fallback = 1) {
  return Math.max(1, parseIntegerInput(value, fallback))
}
