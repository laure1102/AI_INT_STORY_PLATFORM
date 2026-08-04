/** 物品表单的草稿契约和 Core → 表单转换，不负责图片状态或保存。 */
import type { StoryItemCategory, StoryItemDefinition } from "@story-mgr/core"
import { normalizeAssetText } from "./storyAssetEditor"

export interface ItemCategoryDraft extends StoryItemCategory {
  draftKey: string
}

export interface ItemDraft extends StoryItemDefinition {
  draftKey: string
  selected: boolean
  tagsText: string
  maxStackText: string
}

/** 复制 `ItemCategory`，避免共享可变引用。 @param category 调用方传入的 `category`。 @param nextDraftKey 调用方传入的 `nextDraftKey`。 @returns 计算、查找或构建后的结果。 */
export function cloneItemCategory(
  category: StoryItemCategory,
  nextDraftKey: (prefix: string) => string
): ItemCategoryDraft {
  return {
    draftKey: nextDraftKey("category"),
    id: normalizeAssetText(category.id),
    name: normalizeAssetText(category.name),
    descr: normalizeAssetText(category.descr),
    sort_order: Number.isInteger(category.sort_order) ? category.sort_order : 0
  }
}

/** 复制 `ItemDefinition`，避免共享可变引用。 @param item 调用方传入的 `item`。 @param nextDraftKey 调用方传入的 `nextDraftKey`。 @returns 计算、查找或构建后的结果。 */
export function cloneItemDefinition(
  item: StoryItemDefinition,
  nextDraftKey: (prefix: string) => string
): ItemDraft {
  const maxStack = Number.isInteger(item.max_stack) && item.max_stack > 0 ? item.max_stack : 1
  return {
    draftKey: nextDraftKey("item"),
    id: normalizeAssetText(item.id),
    name: normalizeAssetText(item.name),
    category_id: normalizeAssetText(item.category_id),
    descr: normalizeAssetText(item.descr),
    prompt: normalizeAssetText(item.prompt),
    tags: Array.isArray(item.tags) ? item.tags : [],
    tagsText: Array.isArray(item.tags) ? item.tags.join(", ") : "",
    rarity: normalizeAssetText(item.rarity) || "common",
    stackable: item.stackable ?? true,
    max_stack: maxStack,
    maxStackText: String(maxStack),
    usable: item.usable ?? false,
    img_raw: normalizeAssetText(item.img_raw),
    img_compress_1: normalizeAssetText(item.img_compress_1),
    img_compress_2: normalizeAssetText(item.img_compress_2),
    selected: false
  }
}
