/**
 * 为创作 Agent 检索并格式化地点、角色、场景和物品资产。
 *
 * 输入是当前故事、用户指令和可选的上一步草稿；输出是提示词片段。地点、角色和场景使用紧凑
 * 摘要，物品同时提供完整索引与高相关详情，因为商城、联系人动作和事件脚本经常需要复用物品 id。
 * 本模块只读取内存中的 `StoryDocument`，不会生成图片、修改资产，也不会写入 JSON5 文件。
 */
import type { StoryDocument, StoryItemDefinition } from "@story-mgr/core"
import type { StoryCreationDraft } from "@story-mgr/shared"
import { RELEVANT_ITEM_DETAIL_LIMIT } from "./contracts-draft"
import {
  buildStorySearchCorpus,
  collectSearchTerms
} from "./context-shared"
import { formatJson } from "./model"

/**
 * 生成物品检索使用的创作语料。
 *
 * 与变量检索共用同一份语料来源，保证同一条用户指令在不同领域得到一致关键词；单独保留此函数
 * 是为了让物品领域以后可以加入自己的信息，而不影响调用方。
 */
export function buildItemSearchCorpus(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  return buildStorySearchCorpus(story, instruction, baseDraft)
}

/**
 * 把一个物品和它所属分类的可检索字段拼成小写文本。
 *
 * 除名称、说明外还加入标签、稀有度和美术提示词。这样用户提到“公文”“稀有礼物”或提示词中的
 * 特征时，也有机会找到已经存在、可以直接复用的物品。
 */
export function buildItemSearchText(
  item: StoryItemDefinition,
  categoryById: Map<string, { name: string; descr: string }>
) {
  const category = categoryById.get(item.category_id)
  return [
    item.id,
    item.name,
    item.category_id,
    category?.name ?? "",
    category?.descr ?? "",
    item.descr,
    item.prompt,
    item.rarity,
    item.tags.join(" ")
  ].join("\n").toLowerCase()
}

/**
 * 计算一个物品与当前创作需求的相关性。
 *
 * 完全命中 id 或名称得分最高；分类和标签次之；说明、提示词等全文命中只给较低分。分数仅用于
 * 提示词排序，不代表物品质量，也不会保存到 `items.json5`。
 */
export function scoreRelevantItem(
  item: StoryItemDefinition,
  categoryById: Map<string, { name: string; descr: string }>,
  terms: Set<string>
) {
  if (terms.size === 0) {
    return 0
  }

  const itemId = item.id.toLowerCase()
  const itemName = item.name.toLowerCase()
  const categoryId = item.category_id.toLowerCase()
  const categoryName = categoryById.get(item.category_id)?.name.toLowerCase() ?? ""
  const tags = item.tags.map((tag) => tag.toLowerCase())
  const searchText = buildItemSearchText(item, categoryById)
  let score = 0

  for (const term of terms) {
    if (itemId === term || itemName === term) {
      score += 50
      continue
    }

    if (categoryId === term || categoryName === term) {
      score += 18
      continue
    }

    if (tags.includes(term)) {
      score += 16
      continue
    }

    if (itemId.includes(term) || itemName.includes(term)) {
      score += term.length >= 4 ? 12 : 7
      continue
    }

    if (searchText.includes(term)) {
      score += term.length >= 4 ? 5 : 2
    }
  }

  return score
}

/**
 * 从完整物品库中选出少量高相关详情。
 *
 * 处理顺序是“建立分类索引 → 提取关键词 → 给每个物品评分 → 过滤零分项 → 稳定排序 → 截取”。
 * 同分时保留原文件顺序，使提示词在相同输入下保持确定性。空结果不等于没有物品，完整存在性
 * 检查仍应查看 `formatItemIndex` 生成的索引。
 */
export function selectRelevantItemDetails(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  const categoryById = new Map(
    story.items.categories.map((category) => [
      category.id,
      {
        descr: category.descr,
        name: category.name
      }
    ])
  )
  const terms = collectSearchTerms(buildItemSearchCorpus(story, instruction, baseDraft))

  return story.items.items
    .map((item, index) => ({
      index,
      item,
      score: scoreRelevantItem(item, categoryById, terms)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, RELEVANT_ITEM_DETAIL_LIMIT)
    .map(({ item, score }) => ({
      id: item.id,
      name: item.name,
      category_id: item.category_id,
      descr: item.descr,
      prompt: item.prompt,
      tags: item.tags,
      rarity: item.rarity,
      stackable: item.stackable,
      max_stack: item.max_stack,
      usable: item.usable,
      relevance_score: score
    }))
}

/**
 * 生成包含全部物品的一行式索引。
 *
 * 索引只保留识别和复用物品所需的字段，不放图片路径和长描述，从而在固定 prompt 预算内尽量
 * 保留所有 id。Agent 应先查这个索引，再决定是否创建同类新物品。
 */
export function formatItemIndex(story: StoryDocument) {
  if (story.items.items.length === 0) {
    return "(empty)"
  }

  return story.items.items
    .map((item) => {
      const flags = [
        item.stackable ? "stackable" : "",
        item.usable ? "usable" : ""
      ].filter(Boolean).join(",")

      return [
        item.id,
        item.name,
        item.category_id,
        item.tags.join(","),
        item.rarity,
        flags || "-"
      ].join(" | ")
    })
    .join("\n")
}

/**
 * 组装最终放入 Agent prompt 的资产上下文。
 *
 * 地点、角色、场景和物品分类先给出紧凑摘要；物品再提供“全部索引 + 高相关详情”。`compact`
 * 只改变 JSON 字符预算，供后续 Agent 在上下文紧张时使用，不会改变原始故事数据。
 */
export function formatExistingAssets(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null,
  compact = false
) {
  return [
    formatJson({
      locations: story.eventLocations.assignments.map((location) => ({
        id: location.id,
        descr: location.descr
      })),
      normalRoles: story.roles.normal.roles.map((role) => ({
        id: role.id,
        name: role.name,
        zhiye: role.zhiye,
        descr: role.descr
      })),
      importantRoles: story.roles.important.roles.map((role) => ({
        id: role.id,
        name: role.name,
        zhiye: role.zhiye,
        descr: role.descr,
        xingge: role.xingge
      })),
      scenes: story.scenes.scenes.map((scene) => ({
        level: scene.level,
        description: scene.description
      })),
      itemCategories: story.items.categories.map((category) => ({
        id: category.id,
        name: category.name,
        descr: category.descr
      }))
    }, compact ? 6000 : 9000),
    "",
    "itemIndexAll: all existing items, compact format `id | name | category_id | tags | rarity | flags`.",
    formatItemIndex(story),
    "",
    `relevantItemDetails: top ${RELEVANT_ITEM_DETAIL_LIMIT} local keyword matches with richer fields. Empty does not mean the item library is empty; use itemIndexAll for full existence checks.`,
    formatJson(selectRelevantItemDetails(story, instruction, baseDraft), compact ? 8000 : 14000)
  ].join("\n")
}
