/**
 * 草稿 ID、角色、事件和领域引用规范化。
 *
 * 本模块从原创作服务按顶层依赖拆出；不会单独写故事文件。
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Annotation, END, START, StateGraph } from "@langchain/langgraph"
import { ChatOpenAI } from "@langchain/openai"
import {
  createStoryScriptValidationContext,
  findStoryRoleReference,
  validateStoryDocument,
  validateStoryScriptContent,
  type AppAiAgentSettings,
  type AppSettingsFile,
  type StoryDocument,
  type StoryDoingDefinition,
  type StoryDoingFile,
  type StoryDoingMenu,
  type StoryEventCollectionType,
  type StoryEventFile,
  type StoryEventLocationAssignment,
  type StoryEventLocationFile,
  type StoryEventTriggerMode,
  type StoryImportantRoleDefinition,
  type StoryItemDefinition,
  type StoryItemsFile,
  type StoryLoopEventFile,
  type StoryLoopRule,
  type StoryNormalRoleDefinition,
  type StoryContactActionLibraryEntry,
  type StoryContactProfile,
  type StoryContactConversationDefinition,
  type StoryContactConversationsFile,
  type StoryContactFile,
  type StoryContactPersonalityDefinition,
  type StoryContactReplyLibraryEntry,
  type StoryContactTalkLibraryEntry,
  type StoryShopProduct,
  type StoryScriptValidationIssue,
  type StoryOnceDialogueDefinition,
  type StoryOnceEventFile,
  type StoryRolesFile,
  type StoryValDefinition,
  type StoryValEntryDefinition,
  type StoryValsFile
} from "@story-mgr/core"
import { FileStoreError, type StoryFileStore } from "@story-mgr/file-store"
import type {
  ApplyStoryCreationDraftRequest,
  ApplyStoryCreationDraftResponse,
  GenerateStoryDialogueRequest,
  GenerateStoryDialogueResponse,
  RunStoryCreationAgentResponse,
  StoryCreationAgentLog,
  StoryCreationAgentRole,
  StoryCreationDraft,
  StoryCreationDraftDoing,
  StoryCreationDraftEvent,
  StoryCreationDraftItem,
  StoryCreationDraftContact,
  StoryCreationDraftContactConversations,
  StoryCreationDraftPresentation,
  StoryCreationDraftRole,
  StoryCreationDraftShop,
  StoryCreationDraftVariable
} from "@story-mgr/shared"
import { z } from "zod"
import {
  createStoryCreationModelConfig,
  type StoryCreationWorkflowObserver,
  type StoryCreationWorkflowOptions
} from "../story-creation-workflow"
import { draftEventKey } from "./apply-domain"

/**
 * 把模型给出的任意 id 清理为唯一 ASCII id。
 * @param rawId 原 id。
 * @param fallback 清理后为空时使用的基础名。
 * @param usedIds 当前同一命名空间已占用 id；函数会写入最终结果。
 * @returns 小写、仅含字母数字/下划线/短横线且不重复的 id；冲突时追加 `-2`、`-3`。
 */
export function makeUniqueId(rawId: string, fallback: string, usedIds: Set<string>) {
  const normalizedId = rawId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  const baseId = normalizedId || fallback
  let candidateId = baseId
  let suffix = 2

  while (usedIds.has(candidateId)) {
    candidateId = `${baseId}-${suffix}`
    suffix += 1
  }

  usedIds.add(candidateId)
  return candidateId
}

/** @param role 草稿角色。@returns important=true 时返回 important，否则返回 normal。 */
export function getDraftRoleNamespace(role: StoryCreationDraftRole) {
  return role.important ? "important" : "normal"
}

/** @param role 草稿角色。@returns `normal:id` 或 `important:id` 形式的稳定引用 key。 */
export function draftRoleKey(role: StoryCreationDraftRole) {
  return `${getDraftRoleNamespace(role)}:${role.id}`
}

/**
 * 把模型输出的角色引用改成规范 id，并同步角色 id 重命名。
 * @param roleKey player、命名空间角色 key 或其他原值。
 * @param roleIdMap 原角色 id 到唯一新 id 的映射。
 * @returns player/空值统一为 player；合法角色引用替换 id；未知格式只做 trim。
 */
export function normalizeRoleReference(roleKey: string, roleIdMap: Map<string, string>) {
  const trimmedKey = roleKey.trim()

  if (!trimmedKey || trimmedKey === "player") {
    return "player"
  }

  const [namespace, rawId] = trimmedKey.split(":")
  if ((namespace === "normal" || namespace === "important") && rawId) {
    const normalizedId = makeLooseId(rawId)
    const mappedId =
      roleIdMap.get(`${namespace}:${rawId}`) ??
      roleIdMap.get(`${namespace}:${normalizedId}`) ??
      normalizedId

    return mappedId ? `${namespace}:${mappedId}` : ""
  }

  return trimmedKey
}

/**
 * 生成宽松 ASCII id，不负责判重。
 * @param rawId 原始名称或 id。
 * @returns 小写并用短横线替换非法字符的字符串，可能为空。
 */
export function makeLooseId(rawId: string) {
  return rawId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * 把变量组名或变量名整理成 StoryScript 标识符风格。
 * @param rawName 原名称。
 * @param fallback 清理为空时使用的名称。
 * @returns 小写、非法字符改为下划线并合并重复下划线的名称。
 */
export function makeVariableName(rawName: string, fallback: string) {
  const normalizedName = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  return normalizedName || fallback
}

/** @param presentation 事件表现。@returns dialogue 的对白数组；silent/message 返回空数组。 */
export function getDraftPresentationDialogues(presentation: StoryCreationDraftPresentation) {
  return presentation.type === "dialogue" ? presentation.dialogues : []
}

/**
 * 规范事件表现并同步对白说话人引用。
 * @param presentation AI 草稿表现。
 * @param roleIdMap 角色旧 id 到新 id 的映射。
 * @returns 字段完整的新表现对象；消息时长最小为 0，玩家说话人固定为 player。
 */
export function normalizeDraftPresentation(
  presentation: StoryCreationDraftPresentation,
  roleIdMap: Map<string, string>
): StoryCreationDraftPresentation {
  if (presentation.type === "silent") {
    return {
      type: "silent"
    }
  }

  if (presentation.type === "message") {
    const durationSeconds = Number.isFinite(presentation.message.duration_seconds)
      ? Math.max(0, presentation.message.duration_seconds)
      : 3

    return {
      type: "message",
      message: {
        content: presentation.message.content ?? "",
        duration_seconds: durationSeconds
      }
    }
  }

  return {
    type: "dialogue",
    dialogues: presentation.dialogues.map((dialogue) => {
      const speakerKey = dialogue.speaker_type === "player"
        ? "player"
        : normalizeRoleReference(dialogue.speaker_key, roleIdMap)
      const roleNameInput = dialogue.role_name_input
        ? {
            role_key: normalizeRoleReference(dialogue.role_name_input.role_key, roleIdMap),
            ...(dialogue.role_name_input.prompt?.trim() ? { prompt: dialogue.role_name_input.prompt.trim() } : {})
          }
        : undefined

      return {
        ...dialogue,
        speaker_key: speakerKey,
        ...(roleNameInput?.role_key && speakerKey === roleNameInput.role_key && speakerKey.startsWith("important:")
          ? { role_name_input: roleNameInput }
          : {})
      }
    })
  }
}

/**
 * 清理联系人短句/动作的适用范围。
 * @param scope 原 scope。
 * @param roleIdMap 角色 id 映射。
 * @returns 去重引用和 0~100 好感区间；若最小/最大写反会自动交换。
 */
export function normalizeContactScope(
  scope: StoryContactTalkLibraryEntry["scope"],
  roleIdMap: Map<string, string>
): StoryContactTalkLibraryEntry["scope"] {
  const minFavor = Number.isFinite(scope.min_favor) ? Math.max(0, Math.min(100, Math.trunc(scope.min_favor))) : 0
  const maxFavor = Number.isFinite(scope.max_favor) ? Math.max(0, Math.min(100, Math.trunc(scope.max_favor))) : 100

  return {
    role_keys: Array.from(
      new Set((scope.role_keys ?? []).map((roleKey) => normalizeRoleReference(roleKey, roleIdMap)).filter(Boolean))
    ),
    contact_tracks: Array.from(new Set((scope.contact_tracks ?? []).filter((track) => track !== "none"))),
    personality_ids: Array.from(new Set((scope.personality_ids ?? []).map(makeLooseId).filter(Boolean))),
    min_favor: Math.min(minFavor, maxFavor),
    max_favor: Math.max(minFavor, maxFavor)
  }
}

/**
 * 同步联系人 invoke 指向的事件 id。
 * @param targetType chain/pool/schedule。
 * @param eventId 模型输出 id。
 * @param eventIdMap 草稿事件重命名映射。
 * @returns 映射后的 id；找不到时使用宽松清理 id。
 */
export function normalizeContactInvokeTargetId(
  targetType: NonNullable<StoryContactTalkLibraryEntry["invoke"]>["target_type"],
  eventId: string,
  eventIdMap?: Map<string, string>
) {
  const looseEventId = makeLooseId(eventId)
  return eventIdMap?.get(`${targetType}:${eventId}`)
    ?? eventIdMap?.get(`${targetType}:${looseEventId}`)
    ?? looseEventId
}

/**
 * 不可变地规范一个可选联系人 invoke。
 * @param entry 含可选 invoke 的短句、动作或对话节点。
 * @param eventIdMap 事件重命名映射。
 * @returns 没有 invoke 时原对象；有值时返回仅替换 event_id 的新对象。
 */
export function normalizeContactInvoke<T extends { invoke?: StoryContactTalkLibraryEntry["invoke"] }>(
  entry: T,
  eventIdMap?: Map<string, string>
): T {
  if (!entry.invoke) {
    return entry
  }

  return {
    ...entry,
    invoke: {
      ...entry.invoke,
      event_id: normalizeContactInvokeTargetId(entry.invoke.target_type, entry.invoke.event_id, eventIdMap)
    }
  }
}

/**
 * 规范完整联系人草稿的领域资产。
 * @param contact 可缺省的联系人草稿。
 * @param roleIdMap 角色 id 映射。
 * @param eventIdMap invoke 事件 id 映射。
 * @returns id 唯一、引用同步、标签去重、数值限幅后的联系人草稿。
 *
 * 联系人按 role_key 去重并拒绝 player；无触发条件/消息的主动规则会过滤，防止生成无效运行时项。
 */
export function normalizeDraftContact(
  contact: StoryCreationDraft["contact"],
  roleIdMap: Map<string, string>,
  eventIdMap?: Map<string, string>
): StoryCreationDraftContact {
  const usedChannelIds = new Set<string>()
  const usedPersonalityIds = new Set<string>()
  const usedTalkIds = new Set<string>()
  const usedActionIds = new Set<string>()
  const usedReplyIds = new Set<string>()
  const usedProfileRoleKeys = new Set<string>()
  const channelIdMap = new Map<string, string>()

  const channels = (contact?.channels ?? []).map((channel, index) => {
    const id = makeUniqueId(channel.id, `contact-channel-${index + 1}`, usedChannelIds)
    const rawId = channel.id.trim()
    const looseId = makeLooseId(channel.id)
    if (rawId && !channelIdMap.has(rawId)) {
      channelIdMap.set(rawId, id)
    }
    if (looseId && !channelIdMap.has(looseId)) {
      channelIdMap.set(looseId, id)
    }

    return {
      id,
      name: channel.name.trim() || id,
      preset: channel.preset ?? "generic",
      labels: Object.fromEntries(
        Object.entries(channel.labels ?? {})
          .map(([key, value]) => [key, value?.trim()] as const)
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
      )
    }
  })

  const personalities = (contact?.personality_library ?? []).map((personality, index) => ({
    id: makeUniqueId(personality.id, `contact-personality-${index + 1}`, usedPersonalityIds),
    name: personality.name?.trim() ?? "",
    descr: personality.descr ?? "",
    style_tags: Array.from(new Set((personality.style_tags ?? []).map((tag) => tag.trim()).filter(Boolean)))
  }))

  const talks = (contact?.talk_library ?? []).map((entry, index) => normalizeContactInvoke({
    id: makeUniqueId(entry.id, `contact-talk-${index + 1}`, usedTalkIds),
    text: entry.text ?? "",
    tags: Array.from(new Set((entry.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    scope: normalizeContactScope(entry.scope, roleIdMap),
    base_favor_delta: Math.max(-100, Math.min(100, Math.trunc(entry.base_favor_delta ?? 0))),
    cooldown_hours: Math.max(0, Math.trunc(entry.cooldown_hours ?? 0)),
    ...(entry.invoke ? { invoke: entry.invoke } : {})
  }, eventIdMap))

  const actions = (contact?.action_library ?? []).map((entry, index) => normalizeContactInvoke({
    id: makeUniqueId(entry.id, `contact-action-${index + 1}`, usedActionIds),
    label: entry.label ?? "",
    text: entry.text ?? "",
    tags: Array.from(new Set((entry.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    scope: normalizeContactScope(entry.scope, roleIdMap),
    base_favor_delta: Math.max(-100, Math.min(100, Math.trunc(entry.base_favor_delta ?? 0))),
    cooldown_hours: Math.max(0, Math.trunc(entry.cooldown_hours ?? 0)),
    cost_money: Math.max(0, entry.cost_money ?? 0),
    cost_items: (entry.cost_items ?? []).map((item) => ({
      item_id: makeLooseId(item.item_id),
      quantity: Math.max(1, Math.trunc(item.quantity ?? 1))
    })).filter((item) => item.item_id),
    ...(entry.invoke ? { invoke: entry.invoke } : {})
  }, eventIdMap))

  const replies = (contact?.reply_library ?? []).map((entry, index) => ({
    id: makeUniqueId(entry.id, `contact-reply-${index + 1}`, usedReplyIds),
    tags: Array.from(new Set((entry.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    scope: normalizeContactScope(entry.scope, roleIdMap),
    replies: (entry.replies ?? []).map((reply) => reply.trim()).filter(Boolean)
  }))

  const contactProfiles = (contact?.contact_profiles ?? []).flatMap((profile) => {
    const roleKey = normalizeRoleReference(profile.role_key, roleIdMap)
    if (!roleKey || roleKey === "player" || usedProfileRoleKeys.has(roleKey)) {
      return []
    }

    usedProfileRoleKeys.add(roleKey)

    return [{
      role_key: roleKey,
      channel_id: channelIdMap.get(profile.channel_id?.trim() ?? "")
        ?? makeLooseId(profile.channel_id ?? ""),
      enabled: profile.enabled ?? true,
      auto_add: profile.auto_add ?? true,
      initial_favor: Math.max(0, Math.min(100, Math.trunc(profile.initial_favor ?? 20))),
      preferred_tags: Array.from(new Set((profile.preferred_tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
      reply_by_tag: Object.fromEntries(
        Object.entries(profile.reply_by_tag ?? {})
          .map(([tag, replies]) => {
            const nextTag = tag.trim()
            const nextReplies = (replies ?? []).map((reply) => reply.trim()).filter(Boolean)
            return [nextTag, nextReplies] as const
          })
          .filter(([tag, replies]) => tag && replies.length > 0)
      ),
      proactive_messages: (profile.proactive_messages ?? []).map((rule, index) => ({
        id: makeLooseId(rule.id) || `proactive-${index + 1}`,
        enabled: rule.enabled ?? true,
        trigger_expr: rule.trigger_expr ?? "",
        cooldown_hours: Math.max(1, Math.trunc(rule.cooldown_hours ?? 24)),
        favor_delta: Math.max(-100, Math.min(100, Math.trunc(rule.favor_delta ?? 0))),
        messages: (rule.messages ?? []).map((message) => message.trim()).filter(Boolean),
        reply_quick_message_ids: Array.from(new Set((rule.reply_quick_message_ids ?? []).map(makeLooseId).filter(Boolean)))
      })).filter((rule) => rule.trigger_expr.trim() && rule.messages.length > 0)
    }]
  })

  return {
    channels,
    personality_library: personalities,
    talk_library: talks,
    action_library: actions,
    reply_library: replies,
    contact_profiles: contactProfiles
  }
}

/**
 * 规范树状联系人剧情。
 * @param contactConversations 可缺省的对话草稿。
 * @param roleIdMap 联系人角色映射。
 * @param eventIdMap 结束节点 invoke 映射。
 * @returns 对话、节点、选项 id 唯一且跳转引用同步的草稿；没有有效节点的对话会丢弃。
 */
export function normalizeDraftContactConversations(
  contactConversations: StoryCreationDraft["contactConversations"],
  roleIdMap: Map<string, string>,
  eventIdMap: Map<string, string>
): StoryCreationDraftContactConversations {
  const usedConversationIds = new Set<string>()

  const conversations = (contactConversations?.conversations ?? []).flatMap((conversation, conversationIndex) => {
    const roleKey = normalizeRoleReference(conversation.role_key, roleIdMap)
    if (!roleKey || roleKey === "player") {
      return []
    }

    const id = makeUniqueId(
      conversation.id,
      `contact-conversation-${conversationIndex + 1}`,
      usedConversationIds
    )
    const usedNodeIds = new Set<string>()
    const usedOptionIds = new Set<string>()
    const nodeIdMap = new Map<string, string>()

    const nodeSeeds = (conversation.nodes ?? []).map((node, nodeIndex) => {
      const nodeId = makeUniqueId(node.id, `node-${nodeIndex + 1}`, usedNodeIds)
      nodeIdMap.set(node.id, nodeId)
      nodeIdMap.set(makeLooseId(node.id), nodeId)
      return {
        source: node,
        id: nodeId
      }
    })

    if (nodeSeeds.length === 0) {
      return []
    }

    const nodes = nodeSeeds.map(({ source, id: nodeId }) => {
      const end = source.end ?? false
      const invoke = end && source.invoke
        ? normalizeContactInvoke({ invoke: source.invoke }, eventIdMap).invoke
        : undefined

      return {
        id: nodeId,
        contact_messages: (source.contact_messages ?? [])
          .map((message) => ({ content: message.content?.trim() ?? "" }))
          .filter((message) => message.content.length > 0),
        player_options: (source.player_options ?? []).map((option, optionIndex) => {
          const optionId = makeUniqueId(option.id, `option-${optionIndex + 1}`, usedOptionIds)
          const nextNodeId = option.next_node_id
            ? nodeIdMap.get(option.next_node_id)
              ?? nodeIdMap.get(makeLooseId(option.next_node_id))
              ?? ""
            : ""

          return {
            id: optionId,
            text: option.text ?? "",
            visible_expr: option.visible_expr ?? "",
            script: option.script ?? "",
            next_node_id: nextNodeId
          }
        }),
        reminder: {
          enabled: source.reminder?.enabled ?? false,
          interval_minutes: Math.max(1, Math.trunc(source.reminder?.interval_minutes ?? 60))
        },
        end,
        end_script: source.end_script ?? "",
        ...(invoke ? { invoke } : {})
      } satisfies StoryContactConversationDefinition["nodes"][number]
    })
    const entryNodeId =
      nodeIdMap.get(conversation.entry_node_id)
      ?? nodeIdMap.get(makeLooseId(conversation.entry_node_id))
      ?? nodes[0]!.id

    return [{
      id,
      title: conversation.title?.trim() || id,
      role_key: roleKey,
      enabled: conversation.enabled ?? true,
      once: conversation.once ?? true,
      lock_normal_chat: conversation.lock_normal_chat ?? true,
      trigger_expr: conversation.trigger_expr ?? "",
      entry_node_id: entryNodeId,
      nodes
    }]
  })

  return {
    conversations
  }
}

/**
 * 规范玩家主动行动的菜单树和行动项。
 * @param doing 可缺省行动草稿。
 * @param roleIdMap 行动对象角色映射。
 * @param locationIdMap 地点 id 映射。
 * @returns 父菜单/地点/角色引用有效、数值安全的完整行动草稿。
 *
 * 自己指向自己或不存在的父菜单会清空；找不到菜单的行动回退到首个菜单，无菜单时过滤该行动。
 */
export function normalizeDraftDoing(
  doing: StoryCreationDraft["doing"],
  roleIdMap: Map<string, string>,
  locationIdMap: Map<string, string>
): StoryCreationDraftDoing {
  const usedMenuIds = new Set<string>()
  const usedDoingIds = new Set<string>()
  const menuIdMap = new Map<string, string>()

  const menus = (doing?.menus ?? []).map((menu, index) => {
    const id = makeUniqueId(menu.id, `doing-menu-${index + 1}`, usedMenuIds)
    menuIdMap.set(menu.id, id)
    menuIdMap.set(makeLooseId(menu.id), id)

    return {
      id,
      title: menu.title?.trim() || id,
      parent_id: "",
      sort_order: Number.isFinite(menu.sort_order) ? Math.trunc(menu.sort_order) : 100,
      visible_expr: menu.visible_expr ?? "",
      descr: menu.descr ?? ""
    }
  })

  const menuIds = new Set(menus.map((menu) => menu.id))
  const normalizedMenus = menus.map((menu, index) => {
    const sourceMenu = doing?.menus?.[index]
    const parentId = sourceMenu?.parent_id
      ? menuIdMap.get(sourceMenu.parent_id) ?? menuIdMap.get(makeLooseId(sourceMenu.parent_id)) ?? makeLooseId(sourceMenu.parent_id)
      : ""

    return {
      ...menu,
      parent_id: parentId && parentId !== menu.id && menuIds.has(parentId) ? parentId : ""
    }
  })

  const firstMenuId = normalizedMenus[0]?.id ?? ""
  const doings = (doing?.doings ?? []).map((entry, index) => {
    const id = makeUniqueId(entry.id, `doing-${index + 1}`, usedDoingIds)
    const menuId = menuIdMap.get(entry.menu_id) ?? menuIdMap.get(makeLooseId(entry.menu_id)) ?? makeLooseId(entry.menu_id)
    const location = entry.location.trim()
      ? locationIdMap.get(entry.location) ?? makeLooseId(entry.location)
      : ""

    return {
      id,
      title: entry.title?.trim() || id,
      menu_id: menuIds.has(menuId) ? menuId : firstMenuId,
      descr: entry.descr ?? "",
      visible_expr: entry.visible_expr ?? "",
      cooldown_hours: Math.max(0, Math.trunc(entry.cooldown_hours ?? 0)),
      once: entry.once ?? false,
      init_script: entry.init_script ?? "",
      object_keys: Array.from(
        new Set((entry.object_keys ?? []).map((roleKey) => normalizeRoleReference(roleKey, roleIdMap)).filter(Boolean))
      ),
      presentation: normalizeDraftPresentation(entry.presentation, roleIdMap),
      location,
      bgm: entry.bgm ?? "",
      end_script: entry.end_script ?? ""
    }
  }).filter((entry) => entry.menu_id)

  return {
    menus: normalizedMenus,
    doings
  }
}

/**
 * 规范商城分类和商品。
 * @param shop 可缺省商城草稿。
 * @param itemIdMap 物品旧 id 到新 id 的映射。
 * @returns 唯一分类/商品 id、同步引用且价格数量/冷却/好感已限幅的商城草稿。
 */
export function normalizeDraftShop(
  shop: StoryCreationDraft["shop"],
  itemIdMap: Map<string, string>
): StoryCreationDraftShop {
  const usedCategoryIds = new Set<string>()
  const usedProductIds = new Set<string>()
  const categoryIdMap = new Map<string, string>()

  const categories = (shop?.categories ?? []).map((category, index) => {
    const id = makeUniqueId(category.id, `shop-category-${index + 1}`, usedCategoryIds)
    categoryIdMap.set(category.id, id)
    categoryIdMap.set(makeLooseId(category.id), id)

    return {
      id,
      name: category.name?.trim() || id,
      sort_order: Number.isFinite(category.sort_order) ? Math.trunc(category.sort_order) : 100,
      visible_expr: category.visible_expr ?? "",
      descr: category.descr ?? ""
    }
  })

  const products = (shop?.products ?? []).map((product, index) => {
    const id = makeUniqueId(product.id, `shop-product-${index + 1}`, usedProductIds)
    const categoryId =
      categoryIdMap.get(product.category_id) ??
      categoryIdMap.get(makeLooseId(product.category_id)) ??
      makeLooseId(product.category_id)
    const itemId =
      itemIdMap.get(product.item_id) ??
      itemIdMap.get(makeLooseId(product.item_id)) ??
      makeLooseId(product.item_id)

    return {
      id,
      category_id: categoryId,
      item_id: itemId,
      price: Math.max(0, Number.isFinite(product.price) ? product.price : 0),
      quantity: Math.max(1, Math.trunc(product.quantity ?? 1)),
      sort_order: Number.isFinite(product.sort_order) ? Math.trunc(product.sort_order) : 100,
      enabled: product.enabled ?? true,
      available_expr: product.available_expr ?? "",
      unavailable_reason: product.unavailable_reason ?? "",
      allow_gift: product.allow_gift ?? true,
      gift_favor_delta: Math.max(-100, Math.min(100, Math.trunc(product.gift_favor_delta ?? 0))),
      purchase_cooldown_hours: Math.max(0, Math.trunc(product.purchase_cooldown_hours ?? 0)),
      gift_cooldown_hours: Math.max(0, Math.trunc(product.gift_cooldown_hours ?? 0))
    }
  })

  return {
    categories,
    products
  }
}

/**
 * 对整份 AI 草稿建立一致、唯一、可继续校验的内部表示。
 * @param draft 已通过 Agent Schema 的草稿。
 * @returns 新草稿；不会修改输入对象。
 *
 * 算法分两遍：先为地点、角色、物品、事件建立唯一 id 映射，再规范所有引用、变量和领域数据。
 * 必须先建完事件映射再处理 chain.next/contact.invoke，否则前向引用会因目标尚未处理而丢失。
 */
export function normalizeDraft(draft: StoryCreationDraft): StoryCreationDraft {
  const locationIdMap = new Map<string, string>()
  const roleIdMap = new Map<string, string>()
  const eventIdMap = new Map<string, string>()
  const itemIdMap = new Map<string, string>()
  const usedLocationIds = new Set<string>()
  const usedItemIds = new Set<string>()
  const usedVariableKeys = new Set<string>()
  const usedRoleIdsByNamespace = {
    normal: new Set<string>(),
    important: new Set<string>()
  }
  const usedEventIdsByCollection: Record<StoryCreationDraftEvent["collectionType"], Set<string>> = {
    chain: new Set<string>(),
    pool: new Set<string>(),
    schedule: new Set<string>()
  }

  const locations = draft.locations.map((location, index) => {
    const id = makeUniqueId(location.id, `location-${index + 1}`, usedLocationIds)
    locationIdMap.set(location.id, id)

    return {
      ...location,
      id
    }
  })

  const roles = draft.roles.map((role, index) => {
    const namespace = getDraftRoleNamespace(role)
    const id = makeUniqueId(role.id, `role-${index + 1}`, usedRoleIdsByNamespace[namespace])
    roleIdMap.set(`${namespace}:${role.id}`, id)
    roleIdMap.set(`${namespace}:${makeLooseId(role.id)}`, id)

    return {
      ...role,
      id
    }
  })

  const items = (draft.items ?? []).map((item, index) => {
    const id = makeUniqueId(item.id, `item-${index + 1}`, usedItemIds)
    itemIdMap.set(item.id, id)
    itemIdMap.set(makeLooseId(item.id), id)
    const maxStack = Number.isInteger(item.max_stack) && item.max_stack > 0
      ? item.max_stack
      : 1

    return {
      ...item,
      id,
      name: item.name?.trim() ?? "",
      category_id: makeLooseId(item.category_id),
      descr: item.descr ?? "",
      prompt: item.prompt ?? "",
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => tag.trim()).filter(Boolean) : [],
      rarity: item.rarity?.trim() || "common",
      stackable: item.stackable ?? true,
      max_stack: maxStack,
      usable: item.usable ?? false
    }
  })

  for (const [index, event] of draft.events.entries()) {
    const eventId = makeUniqueId(event.id, `event-${index + 1}`, usedEventIdsByCollection[event.collectionType])
    eventIdMap.set(draftEventKey(event), eventId)
    eventIdMap.set(`${event.collectionType}:${makeLooseId(event.id)}`, eventId)
  }

  const events = draft.events.map((event) => {
    const eventId = eventIdMap.get(draftEventKey(event)) ?? makeLooseId(event.id)
    const normalizedLocation = event.location.trim()
      ? locationIdMap.get(event.location) ?? makeLooseId(event.location)
      : ""

    return {
      ...event,
      id: eventId,
      location: normalizedLocation,
      object_keys: Array.from(
        new Set(event.object_keys.map((roleKey) => normalizeRoleReference(roleKey, roleIdMap)))
      ),
      presentation: normalizeDraftPresentation(event.presentation, roleIdMap),
      invoke_params: event.invoke_params ?? [],
      loop: event.collectionType === "schedule" ? event.loop : undefined,
      next: event.collectionType === "chain"
        ? event.next
            .map((nextId) => eventIdMap.get(`chain:${nextId}`) ?? makeLooseId(nextId))
            .filter(Boolean)
        : []
    }
  })

  const variables = draft.variables.map((variable, index) => {
    const group = makeVariableName(variable.group, "story")
    const baseName = makeVariableName(variable.name, `var_${index + 1}`)
    let name = baseName
    let suffix = 2

    while (usedVariableKeys.has(`${group}.${name}`)) {
      name = `${baseName}_${suffix}`
      suffix += 1
    }

    usedVariableKeys.add(`${group}.${name}`)

    return {
      ...variable,
      group,
      name,
      description: variable.description ?? "",
      value_type: variable.value_type,
      value: variable.value_type === "calc" ? undefined : variable.value ?? null,
      calc_rule: variable.value_type === "calc" ? variable.calc_rule : ""
    }
  })

  return {
    ...draft,
    locations,
    roles,
    items,
    events,
    variables,
    contact: normalizeDraftContact(draft.contact, roleIdMap, eventIdMap),
    contactConversations: normalizeDraftContactConversations(draft.contactConversations, roleIdMap, eventIdMap),
    doing: normalizeDraftDoing(draft.doing, roleIdMap, locationIdMap),
    shop: normalizeDraftShop(draft.shop, itemIdMap)
  }
}
