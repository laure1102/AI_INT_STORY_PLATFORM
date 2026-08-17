/**
 * 将 AI 草稿中的角色、资产、联系人、行动和商城内容转换成“可以尝试合并”的领域对象。
 *
 * 这是纯内存的防护层：它重新解析未知草稿，并根据当前故事与用户本次选择过滤无效引用。
 * 例如，商城商品引用了未选中的物品时，商品会被跳过并产生 warning，而不会偷偷创建一个物品；
 * 联系人动作调用不存在的事件时，只移除无效调用，不让整个草稿在更晚阶段突然变成坏数据。
 *
 * 输入来源：前端提交的草稿、当前故事中已有资产、用户勾选后得到的可用 id 集合。
 * 输出去向：`apply.ts` 组装候选 `StoryDocument`。
 * 不负责：最终整篇校验、版本冲突检查、事务提交和文件写入。
 */
import {
  type StoryDoingDefinition,
  type StoryDoingMenu,
  type StoryEventLocationAssignment,
  type StoryImportantRoleDefinition,
  type StoryItemDefinition,
  type StoryNormalRoleDefinition,
  type StoryContactActionLibraryEntry,
  type StoryContactProfile,
  type StoryContactConversationDefinition,
  type StoryContactTalkLibraryEntry,
  type StoryShopProduct,
  type StoryRolesFile
} from "@story-mgr/core"
import { FileStoreError } from "@story-mgr/file-store"
import type {
  StoryCreationDraft,
  StoryCreationDraftEvent,
  StoryCreationDraftItem,
  StoryCreationDraftRole
} from "@story-mgr/shared"
import { draftApplySchema } from "./contracts-agents"
import { normalizeDraft } from "./draft-normalize"

/**
 * 在应用草稿前重新建立运行时输入边界。
 *
 * 即使草稿最初来自可信 Agent，它也可能经过前端缓存、历史任务恢复或人工编辑，因此不能依赖
 * 之前某次校验。这里先用 Zod 拒绝结构错误，再统一旧字段；失败会转换成 API 可识别的 400，
 * 而不是让后续代码访问缺失字段并返回难以理解的 500。
 */
export function parseDraftForApply(draft: unknown) {
  try {
    return normalizeDraft(draftApplySchema.parse(draft))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new FileStoreError(`Creation draft is invalid: ${detail}`, 400, "ai.agent-draft-invalid")
  }
}

/**
 * 把前端勾选 id 规范成去重集合。
 *
 * 空白项会被忽略，重复项只保留一次。后续大量 `has` 查询使用 Set，既能表达“只应用被选择项”，
 * 也避免每处理一条草稿都重新线性扫描选择数组。
 */
export function toSelectionSet(values: string[]) {
  return new Set(values.map((value) => value.trim()).filter(Boolean))
}

/** 为事件生成包含集合类型的稳定选择 key，避免不同事件文件中的同名 id 混淆。 */
export function draftEventKey(event: StoryCreationDraftEvent) {
  return `${event.collectionType}:${event.id}`
}

/**
 * 按 `id` 新增或替换一项，并保持原数组顺序。
 *
 * 已有项会在原位置被完整替换，新项才追加到末尾。函数不修改输入数组，方便候选文档在验证失败时
 * 直接丢弃，不会污染刚读取的原故事对象。
 */
export function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id)

  if (existingIndex < 0) {
    return [...items, nextItem]
  }

  return items.map((item, index) => (index === existingIndex ? nextItem : item))
}

/** 与 `upsertById` 相同，但允许调用方指定复合 key，例如联系人使用 `role_key`。 */
export function upsertByKey<T>(items: T[], nextItem: T, getKey: (item: T) => string) {
  const nextKey = getKey(nextItem)
  const existingIndex = items.findIndex((item) => getKey(item) === nextKey)

  if (existingIndex < 0) {
    return [...items, nextItem]
  }

  return items.map((item, index) => (index === existingIndex ? nextItem : item))
}

/**
 * 把地点草稿转换为持久化地点，并保留已有图片路径。
 *
 * AI 负责文本设定和美术提示词，不应因为应用一版新描述就清空用户已经生成或上传的图片。
 */
export function toEventLocationAssignment(
  draftLocation: StoryCreationDraft["locations"][number],
  existing?: StoryEventLocationAssignment
): StoryEventLocationAssignment {
  return {
    id: draftLocation.id,
    descr: draftLocation.descr,
    prompt: draftLocation.prompt,
    img_raw: existing?.img_raw ?? "",
    img_compress_1: existing?.img_compress_1 ?? "",
    img_compress_2: existing?.img_compress_2 ?? ""
  }
}

/**
 * 把普通角色草稿合并到持久化结构。
 *
 * 草稿能更新角色基础设定；联系人开关、好感、性格绑定和图片属于编辑器已有资产，优先保留。
 */
export function toNormalRole(
  draftRole: StoryCreationDraftRole,
  existing?: StoryNormalRoleDefinition
): StoryNormalRoleDefinition {
  return {
    contact_enabled: existing?.contact_enabled ?? false,
    contact_initial_favor: existing?.contact_initial_favor ?? 20,
    contact_track: existing?.contact_track ?? "none",
    id: draftRole.id,
    name: draftRole.name,
    zhiye: draftRole.zhiye,
    descr: draftRole.descr,
    prompt: draftRole.prompt,
    img_raw: existing?.img_raw ?? "",
    img_compress_1: existing?.img_compress_1 ?? "",
    img_compress_2: existing?.img_compress_2 ?? "",
    xingge_id: existing?.xingge_id ?? "",
    xingge_note: existing?.xingge_note ?? draftRole.xingge ?? ""
  }
}

/**
 * 把重要角色草稿合并到持久化结构，并保留性别差分文案、图片和联系人设置。
 *
 * 这些扩展字段不在当前 Agent 草稿能力范围内，若用空默认值覆盖会造成用户已有内容丢失。
 */
export function toImportantRole(
  draftRole: StoryCreationDraftRole,
  existing?: StoryImportantRoleDefinition
): StoryImportantRoleDefinition {
  return {
    contact_enabled: existing?.contact_enabled ?? false,
    contact_initial_favor: existing?.contact_initial_favor ?? 20,
    contact_track: existing?.contact_track ?? "none",
    id: draftRole.id,
    name: draftRole.name,
    zhiye: draftRole.zhiye,
    descr: draftRole.descr,
    descr_male: existing?.descr_male ?? "",
    descr_female: existing?.descr_female ?? "",
    prompt: draftRole.prompt,
    prompt_male: existing?.prompt_male ?? "",
    prompt_female: existing?.prompt_female ?? "",
    img_raw: existing?.img_raw ?? "",
    img_compress_1: existing?.img_compress_1 ?? "",
    img_compress_2: existing?.img_compress_2 ?? "",
    xingge: draftRole.xingge ?? existing?.xingge ?? "",
    xingge_id: existing?.xingge_id ?? "",
    xingge_note: existing?.xingge_note ?? "",
    qufen_xingbie: existing?.qufen_xingbie ?? false,
    img_male_raw: existing?.img_male_raw ?? "",
    img_male_compress_1: existing?.img_male_compress_1 ?? "",
    img_male_compress_2: existing?.img_male_compress_2 ?? "",
    img_female_raw: existing?.img_female_raw ?? "",
    img_female_compress_1: existing?.img_female_compress_1 ?? "",
    img_female_compress_2: existing?.img_female_compress_2 ?? ""
  }
}

/**
 * 把物品草稿转换成持久化物品，并保留已有图片。
 *
 * `category_id` 是否可用不在这里判断；主应用流程会结合现有分类先过滤，再调用此纯转换函数。
 */
export function toStoryItem(
  draftItem: StoryCreationDraftItem,
  existing?: StoryItemDefinition
): StoryItemDefinition {
  return {
    id: draftItem.id,
    name: draftItem.name,
    category_id: draftItem.category_id,
    descr: draftItem.descr,
    prompt: draftItem.prompt,
    tags: draftItem.tags,
    rarity: draftItem.rarity,
    stackable: draftItem.stackable,
    max_stack: draftItem.max_stack,
    usable: draftItem.usable,
    img_raw: existing?.img_raw ?? "",
    img_compress_1: existing?.img_compress_1 ?? "",
    img_compress_2: existing?.img_compress_2 ?? ""
  }
}

/** 建立事件、联系人、行动对白都能共用的角色引用集合；`player` 是内建对象，始终可用。 */
export function collectAvailableRoleKeys(roles: StoryRolesFile) {
  return new Set([
    "player",
    ...roles.normal.roles.map((role) => `normal:${role.id}`),
    ...roles.important.roles.map((role) => `important:${role.id}`)
  ])
}

/**
 * 清理联系人库条目的适用范围。
 *
 * 角色和性格只有在当前故事已存在或本批内容已被用户选中时才可保留。被移除的引用会写入 warnings，
 * 让用户知道 Agent 的哪条建议被调整；关系轨道和好感范围不在本函数职责内。
 */
export function filterContactScopeForApply(
  scope: StoryContactTalkLibraryEntry["scope"],
  options: {
    availableRoleKeys: Set<string>
    availablePersonalityIds: Set<string>
    warnings: string[]
    label: string
  }
): StoryContactTalkLibraryEntry["scope"] {
  const roleKeys = scope.role_keys.filter((roleKey) => {
    if (options.availableRoleKeys.has(roleKey)) {
      return true
    }

    options.warnings.push(`${options.label} 引用了不存在或未应用的联系人角色 ${roleKey}，已从适用范围移除。`)
    return false
  })
  const personalityIds = scope.personality_ids.filter((personalityId) => {
    if (options.availablePersonalityIds.has(personalityId)) {
      return true
    }

    options.warnings.push(`${options.label} 引用了不存在或未应用的性格 ${personalityId}，已从适用范围移除。`)
    return false
  })

  return {
    ...scope,
    role_keys: roleKeys,
    personality_ids: personalityIds
  }
}

/**
 * 删除指向不可用事件的联系人调用。
 *
 * 泛型保证返回对象保留原具体类型。这里选择“保留联系人条目、移除 invoke”，因为条目的聊天或动作
 * 本身仍可用；最终候选故事仍会经过 Core 验证，不能把此过滤当成完整校验替代品。
 */
export function filterContactInvokeForApply<T extends { invoke?: StoryContactTalkLibraryEntry["invoke"] }>(
  entry: T,
  options: {
    availableEventIdsByType: Record<"chain" | "pool" | "schedule", Set<string>>
    warnings: string[]
    label: string
  }
): T {
  if (!entry.invoke) {
    return entry
  }

  if (options.availableEventIdsByType[entry.invoke.target_type].has(entry.invoke.event_id)) {
    return entry
  }

  options.warnings.push(
    `${options.label} 调用了不存在或未应用的${entry.invoke.target_type}事件 ${entry.invoke.event_id}，已移除该调用。`
  )

  const { invoke: _invoke, ...rest } = entry
  return rest as T
}

/** 过滤联系人动作中不可用的物品消耗，防止运行时尝试扣除不存在的物品。 */
export function filterContactActionCostItems(
  entry: StoryContactActionLibraryEntry,
  availableItemIds: Set<string>,
  warnings: string[]
) {
  return {
    ...entry,
    cost_items: entry.cost_items.filter((item) => {
      if (availableItemIds.has(item.item_id)) {
        return true
      }

      warnings.push(`联系人动作 ${entry.id} 消耗了不存在或未应用的物品 ${item.item_id}，已移除该消耗。`)
      return false
    })
  }
}

/**
 * 合并联系人专属配置。
 *
 * `reply_by_tag` 按标签覆盖；主动消息按规则 id 覆盖，其余旧规则保留。这样应用局部 AI 建议时，
 * 不会把用户未选择修改的联系人回复和主动消息一起删除。
 */
export function mergeContactProfile(
  draftProfile: StoryContactProfile,
  existing?: StoryContactProfile
): StoryContactProfile {
  return {
    ...draftProfile,
    reply_by_tag: {
      ...(existing?.reply_by_tag ?? {}),
      ...draftProfile.reply_by_tag
    },
    proactive_messages: [
      ...(existing?.proactive_messages ?? []).filter((rule) =>
        !draftProfile.proactive_messages.some((draftRule) => draftRule.id === rule.id)
      ),
      ...draftProfile.proactive_messages
    ]
  }
}

/** 遍历连续联系人剧情节点，移除指向不可用事件的结束调用，并保留对话本体。 */
export function filterContactConversationInvokeForApply(
  conversation: StoryContactConversationDefinition,
  options: {
    availableEventIdsByType: Record<"chain" | "pool" | "schedule", Set<string>>
    warnings: string[]
  }
): StoryContactConversationDefinition {
  return {
    ...conversation,
    nodes: conversation.nodes.map((node) => {
      if (!node.invoke) {
        return node
      }

      if (options.availableEventIdsByType[node.invoke.target_type].has(node.invoke.event_id)) {
        return node
      }

      options.warnings.push(
        `联系人剧情 ${conversation.id} 的节点 ${node.id} 调用了不存在或未应用的${node.invoke.target_type}事件 ${node.invoke.event_id}，已移除该调用。`
      )
      const { invoke: _invoke, ...rest } = node
      return rest
    })
  }
}

/**
 * 修正行动对白中的说话人引用。
 *
 * 对象说话人必须同时出现在行动 `object_keys` 中且确实存在；否则运行时无法解析显示名。遇到无效
 * 说话人时退回 player 并提示用户，而不是留下一个播放到中途才失败的对白。
 */
export function filterDoingPresentationForApply(
  doing: StoryDoingDefinition,
  availableRoleKeys: Set<string>,
  warnings: string[]
): StoryDoingDefinition["presentation"] {
  if (doing.presentation.type !== "dialogue") {
    return doing.presentation
  }

  const objectKeys = new Set(doing.object_keys)
  return {
    type: "dialogue",
    dialogues: doing.presentation.dialogues.map((dialogue) => {
      if (dialogue.speaker_type === "player") {
        const { role_name_input: _roleNameInput, ...playerDialogue } = dialogue
        return {
          ...playerDialogue,
          speaker_key: "player"
        }
      }

      if (objectKeys.has(dialogue.speaker_key) && availableRoleKeys.has(dialogue.speaker_key)) {
        const rawRoleNameInput = dialogue.role_name_input
        const roleNameInput = rawRoleNameInput
          && dialogue.speaker_key.startsWith("important:")
          && rawRoleNameInput.role_key === dialogue.speaker_key
          ? {
              role_key: dialogue.speaker_key,
              ...(rawRoleNameInput.prompt?.trim() ? { prompt: rawRoleNameInput.prompt.trim() } : {})
            }
          : undefined
        if (rawRoleNameInput && !roleNameInput) {
          warnings.push(`行动 ${doing.id} 的 role_name_input 目标无效，已移除。`)
        }
        return {
          ...dialogue,
          ...(roleNameInput ? { role_name_input: roleNameInput } : {})
        }
      }

      warnings.push(`行动 ${doing.id} 的对白说话人 ${dialogue.speaker_key} 不可用，已改为 player。`)
      const { role_name_input: _roleNameInput, ...fallbackDialogue } = dialogue
      return {
        ...fallbackDialogue,
        speaker_type: "player" as const,
        speaker_key: "player"
      }
    })
  }
}

/**
 * 规范化一个玩家主动行动的跨领域引用。
 *
 * 菜单不存在意味着行动没有入口，因此整条跳过；地点和角色只是表现信息，失效时可安全清空或
 * 移除。返回 `null` 明确表示“不要应用此行动”，warning 则用于前端解释原因。
 */
export function normalizeDoingForApply(
  doing: StoryDoingDefinition,
  options: {
    availableLocationIds: Set<string>
    availableRoleKeys: Set<string>
    availableMenuIds: Set<string>
    warnings: string[]
  }
): StoryDoingDefinition | null {
  if (!options.availableMenuIds.has(doing.menu_id)) {
    options.warnings.push(`行动 ${doing.id} 引用了不存在或未应用的菜单 ${doing.menu_id}，未写入 doing.json5。`)
    return null
  }

  const location = doing.location.trim()
  const nextLocation = location && options.availableLocationIds.has(location) ? location : ""
  if (location && !nextLocation) {
    options.warnings.push(`行动 ${doing.id} 引用了不存在或未应用的地点 ${location}，已清空地点。`)
  }

  const objectKeys = doing.object_keys.filter((objectKey) => {
    if (objectKey === "player" || options.availableRoleKeys.has(objectKey)) {
      return true
    }

    options.warnings.push(`行动 ${doing.id} 引用了不存在或未应用的角色 ${objectKey}，已从对象列表移除。`)
    return false
  })
  const nextDoing = {
    ...doing,
    location: nextLocation,
    object_keys: objectKeys
  }

  return {
    ...nextDoing,
    presentation: filterDoingPresentationForApply(nextDoing, options.availableRoleKeys, options.warnings)
  }
}

/**
 * 规范化行动菜单的父子关系。
 *
 * 空父级、自指或不存在的父级都会收敛为根菜单，避免形成最直接的坏引用。更复杂的菜单规则仍由
 * 最终文档校验负责。
 */
export function normalizeDoingMenuForApply(
  menu: StoryDoingMenu,
  availableMenuIds: Set<string>,
  warnings: string[]
): StoryDoingMenu {
  const parentId = menu.parent_id.trim()

  if (!parentId || parentId === menu.id) {
    return {
      ...menu,
      parent_id: ""
    }
  }

  if (availableMenuIds.has(parentId)) {
    return {
      ...menu,
      parent_id: parentId
    }
  }

  warnings.push(`行动菜单 ${menu.id} 引用了不存在或未应用的父级菜单 ${parentId}，已作为根菜单写入。`)
  return {
    ...menu,
    parent_id: ""
  }
}

/**
 * 检查商城商品能否安全落地。
 *
 * 商城只负责上架已有物品，不能隐式创建分类或物品。因此任一引用不可用时返回 `null`，由主流程
 * 跳过商品并把原因反馈给用户。
 */
export function normalizeShopProductForApply(
  product: StoryShopProduct,
  options: {
    availableItemIds: Set<string>
    availableShopCategoryIds: Set<string>
    warnings: string[]
  }
): StoryShopProduct | null {
  if (!options.availableShopCategoryIds.has(product.category_id)) {
    options.warnings.push(`商城商品 ${product.id} 引用了不存在或未应用的商城分类 ${product.category_id}，未写入 shop.json5。`)
    return null
  }

  if (!options.availableItemIds.has(product.item_id)) {
    options.warnings.push(`商城商品 ${product.id} 引用了不存在或未应用的物品 ${product.item_id}，未写入 shop.json5。`)
    return null
  }

  return product
}
