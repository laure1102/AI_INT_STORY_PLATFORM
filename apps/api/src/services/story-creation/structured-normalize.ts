/**
 * 模型结构化输出到草稿的规范化。
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
  type StoryPhoneActionLibraryEntry,
  type StoryPhoneContactProfile,
  type StoryPhoneConversationDefinition,
  type StoryPhoneConversationsFile,
  type StoryPhoneFile,
  type StoryPhonePersonalityDefinition,
  type StoryPhoneReplyLibraryEntry,
  type StoryPhoneTalkLibraryEntry,
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
  StoryCreationDraftPhone,
  StoryCreationDraftPhoneConversations,
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
import type { StructuredCreationDoingDraft, StructuredCreationDraft, StructuredCreationDraftLoopRule, StructuredCreationDraftPresentation, StructuredCreationPhoneConversationsDraft, StructuredCreationPhoneDraft, StructuredCreationShopDraft } from "./contracts-agents"
import { structuredPhoneInvocationSchema } from "./contracts-agents"

/** @param value 模型输出时间。@returns 合法 HH:mm；缺失或非法时返回 00:00。 */
export function normalizeScheduleAt(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : "00:00"
}

/** @param value 模型输出优先级。@returns 有限数取整数，否则使用默认 100。 */
export function normalizeSchedulePriority(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 100
}

/** @param value after/before id 列表。@returns trim、去空和去重后的数组。 */
export function normalizeScheduleDependencyIds(value: string[] | null | undefined) {
  return Array.from(
    new Set((value ?? []).map((item) => item.trim()).filter(Boolean))
  )
}

/**
 * 规范所有 schedule 模式共用的执行顺序字段。
 * @param loop Agent Schema 的循环规则。
 * @returns at、priority、after、before 的安全值。
 */
export function toDraftLoopOrderFields(loop: StructuredCreationDraftLoopRule) {
  return {
    at: normalizeScheduleAt(loop.at),
    priority: normalizeSchedulePriority(loop.priority),
    after: normalizeScheduleDependencyIds(loop.after),
    before: normalizeScheduleDependencyIds(loop.before)
  }
}

/**
 * 把 Agent 的 nullable 循环联合类型转换成内部草稿规则。
 * @param loop 结构化循环规则或 null。
 * @returns null 变 undefined；其余按 daily/weekly/monthly/interval_days 只保留对应字段。
 */
export function toDraftLoopRule(loop: StructuredCreationDraftLoopRule | null): StoryCreationDraftEvent["loop"] {
  if (!loop) {
    return undefined
  }

  const orderFields = toDraftLoopOrderFields(loop)

  if (loop.mode === "weekly") {
    return {
      mode: "weekly",
      ...orderFields,
      ...(loop.weekday === null ? {} : { weekday: loop.weekday })
    }
  }

  if (loop.mode === "monthly") {
    return {
      mode: "monthly",
      ...orderFields,
      ...(loop.month_day === null ? {} : { month_day: loop.month_day })
    }
  }

  if (loop.mode === "interval_days") {
    return {
      mode: "interval_days",
      ...orderFields,
      ...(loop.interval_days === null ? {} : { interval_days: loop.interval_days })
    }
  }

  return {
    mode: "daily",
    ...orderFields
  }
}

/**
 * 把 Agent structured presentation 转成内部判别联合。
 * @param presentation 已通过 Agent Schema 的表现。
 * @returns silent/message/dialogue 草稿；缺失 message 使用空内容和 3 秒，时长不小于 0。
 */
export function toDraftPresentation(
  presentation: StructuredCreationDraftPresentation
): StoryCreationDraftPresentation {
  if (presentation.type === "silent") {
    return {
      type: "silent"
    }
  }

  if (presentation.type === "message") {
    const durationSeconds = presentation.message
      ? Math.max(0, presentation.message.duration_seconds)
      : 3

    return {
      type: "message",
      message: {
        content: presentation.message?.content ?? "",
        duration_seconds: durationSeconds
      }
    }
  }

  return {
    type: "dialogue",
    dialogues: presentation.dialogues
  }
}

/**
 * 把 Agent 可空手机调用转换成 Core invoke。
 * @param invoke structured-output 调用或 null。
 * @returns null 变 undefined；有值时复制目标并仅在存在时加入 delay。
 */
export function toStructuredPhoneInvocation(
  invoke: z.infer<typeof structuredPhoneInvocationSchema> | null
): NonNullable<StoryPhoneTalkLibraryEntry["invoke"]> | undefined {
  if (!invoke) {
    return undefined
  }

  return {
    target_type: invoke.target_type,
    event_id: invoke.event_id,
    ...(invoke.delay ? { delay: invoke.delay } : {})
  }
}

/**
 * 转换 structured phone，并把 Agent 友好的 reply_by_tag 数组还原为对象映射。
 * @param phone Agent 输出手机草稿。
 * @returns 内部 StoryCreationDraftPhone；空 tag/replies 被过滤，回复去重。
 */
export function normalizeStructuredPhoneDraft(phone: StructuredCreationPhoneDraft): StoryCreationDraftPhone {
  return {
    personality_library: phone.personality_library.map((personality) => ({
      id: personality.id,
      name: personality.name,
      descr: personality.descr,
      style_tags: personality.style_tags
    })),
    talk_library: phone.talk_library.map((entry) => ({
      id: entry.id,
      text: entry.text,
      tags: entry.tags,
      scope: entry.scope,
      base_favor_delta: entry.base_favor_delta,
      cooldown_hours: entry.cooldown_hours,
      ...(entry.invoke ? { invoke: toStructuredPhoneInvocation(entry.invoke) } : {})
    })),
    action_library: phone.action_library.map((entry) => ({
      id: entry.id,
      label: entry.label,
      text: entry.text,
      tags: entry.tags,
      scope: entry.scope,
      base_favor_delta: entry.base_favor_delta,
      cooldown_hours: entry.cooldown_hours,
      cost_money: entry.cost_money,
      cost_items: entry.cost_items,
      ...(entry.invoke ? { invoke: toStructuredPhoneInvocation(entry.invoke) } : {})
    })),
    reply_library: phone.reply_library.map((entry) => ({
      id: entry.id,
      tags: entry.tags,
      scope: entry.scope,
      replies: entry.replies
    })),
    contact_profiles: phone.contact_profiles.map((profile) => ({
      role_key: profile.role_key,
      enabled: profile.enabled,
      auto_add: profile.auto_add,
      initial_favor: profile.initial_favor,
      preferred_tags: profile.preferred_tags,
      reply_by_tag: Object.fromEntries(
        profile.reply_by_tag
          .map((entry) => {
            const tag = entry.tag.trim()
            const replies = Array.from(
              new Set((entry.replies ?? []).map((reply) => reply.trim()).filter(Boolean))
            )

            return [tag, replies] as const
          })
          .filter(([tag, replies]) => tag && replies.length > 0)
      ),
      proactive_messages: profile.proactive_messages
    }))
  }
}

/**
 * 转换手机剧情对话的节点树。
 * @param phoneConversations Agent 输出。
 * @returns 内部对话草稿；提醒间隔至少为 1 分钟，节点 invoke 转为可选字段。
 */
export function normalizeStructuredPhoneConversationsDraft(
  phoneConversations: StructuredCreationPhoneConversationsDraft
): StoryCreationDraftPhoneConversations {
  return {
    conversations: phoneConversations.conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      role_key: conversation.role_key,
      enabled: conversation.enabled,
      once: conversation.once,
      lock_normal_chat: conversation.lock_normal_chat,
      trigger_expr: conversation.trigger_expr,
      entry_node_id: conversation.entry_node_id,
      nodes: conversation.nodes.map((node) => ({
        id: node.id,
        contact_messages: node.contact_messages.map((message) => ({
          content: message.content
        })),
        player_options: node.player_options.map((option) => ({
          id: option.id,
          text: option.text,
          visible_expr: option.visible_expr,
          script: option.script,
          next_node_id: option.next_node_id
        })),
        reminder: {
          enabled: node.reminder.enabled,
          interval_minutes: Math.max(1, Math.trunc(node.reminder.interval_minutes))
        },
        end: node.end,
        end_script: node.end_script,
        ...(node.invoke ? { invoke: toStructuredPhoneInvocation(node.invoke) } : {})
      }))
    }))
  }
}

/**
 * 转换行动菜单和行动表现。
 * @param doing Agent structured-output 行动草稿。
 * @returns 字段同构的内部草稿，presentation 通过统一转换函数处理。
 */
export function normalizeStructuredDoingDraft(doing: StructuredCreationDoingDraft): StoryCreationDraftDoing {
  return {
    menus: doing.menus.map((menu) => ({
      id: menu.id,
      title: menu.title,
      parent_id: menu.parent_id,
      sort_order: menu.sort_order,
      visible_expr: menu.visible_expr,
      descr: menu.descr
    })),
    doings: doing.doings.map((entry) => ({
      id: entry.id,
      title: entry.title,
      menu_id: entry.menu_id,
      descr: entry.descr,
      visible_expr: entry.visible_expr,
      cooldown_hours: entry.cooldown_hours,
      once: entry.once,
      init_script: entry.init_script,
      object_keys: entry.object_keys,
      presentation: toDraftPresentation(entry.presentation),
      location: entry.location,
      bgm: entry.bgm,
      end_script: entry.end_script
    }))
  }
}

/**
 * 转换商城分类和商品。
 * @param shop Agent structured-output 商城草稿。
 * @returns 内部商城草稿；这里只改变类型边界，不修正引用或数值，后续 normalizeDraft 负责。
 */
export function normalizeStructuredShopDraft(shop: StructuredCreationShopDraft): StoryCreationDraftShop {
  return {
    categories: shop.categories.map((category) => ({
      id: category.id,
      name: category.name,
      sort_order: category.sort_order,
      visible_expr: category.visible_expr,
      descr: category.descr
    })),
    products: shop.products.map((product) => ({
      id: product.id,
      category_id: product.category_id,
      item_id: product.item_id,
      price: product.price,
      quantity: product.quantity,
      sort_order: product.sort_order,
      enabled: product.enabled,
      available_expr: product.available_expr,
      unavailable_reason: product.unavailable_reason,
      allow_gift: product.allow_gift,
      gift_favor_delta: product.gift_favor_delta,
      purchase_cooldown_hours: product.purchase_cooldown_hours,
      gift_cooldown_hours: product.gift_cooldown_hours
    }))
  }
}

/**
 * 把六 Agent 最终 structured-output 完整转换成内部 AI 草稿。
 * @param draft 已通过严格 Agent Schema 的结果。
 * @returns StoryCreationDraft；nullable 可选字段转成省略字段，各领域交给上方转换器。
 *
 * 这是“严格模型契约”到“编辑器草稿契约”的边界；之后还会运行 normalizeDraft 和静态校验，不能
 * 直接把本函数结果写入正式故事。
 */
export function normalizeStructuredDraft(draft: StructuredCreationDraft): StoryCreationDraft {
  return {
    title: draft.title,
    summary: draft.summary,
    arc: draft.arc,
    locations: draft.locations,
    roles: draft.roles.map((role) => ({
      id: role.id,
      name: role.name,
      zhiye: role.zhiye,
      descr: role.descr,
      prompt: role.prompt,
      important: role.important,
      ...(role.xingge === null ? {} : { xingge: role.xingge })
    })),
    items: draft.items.map((item) => ({
      id: item.id,
      name: item.name,
      category_id: item.category_id,
      descr: item.descr,
      prompt: item.prompt,
      tags: item.tags,
      rarity: item.rarity,
      stackable: item.stackable,
      max_stack: item.max_stack,
      usable: item.usable
    })),
    events: draft.events.map((event) => {
      const loop = toDraftLoopRule(event.loop)

      return {
        collectionType: event.collectionType,
        id: event.id,
        title: event.title,
        trigger_mode: event.trigger_mode,
        trigger_expr: event.trigger_expr,
        invoke_params: event.invoke_params.map((param) => ({
          name: param.name,
          ...(param.descr === null ? {} : { descr: param.descr })
        })),
        object_keys: event.object_keys,
        location: event.location,
        presentation: toDraftPresentation(event.presentation),
        init_script: event.init_script,
        end_script: event.end_script,
        next: event.next,
        ...(event.bgm === null ? {} : { bgm: event.bgm }),
        ...(loop ? { loop } : {})
      }
    }),
    variables: draft.variables.map((variable) => ({
      group: variable.group,
      name: variable.name,
      description: variable.description,
      value_type: variable.value_type,
      calc_rule: variable.calc_rule,
      ...(variable.value_type === "value" ? { value: variable.value } : {})
    })),
    phone: normalizeStructuredPhoneDraft(draft.phone),
    phoneConversations: normalizeStructuredPhoneConversationsDraft(draft.phoneConversations),
    doing: normalizeStructuredDoingDraft(draft.doing),
    shop: normalizeStructuredShopDraft(draft.shop),
    notes: draft.notes,
    warnings: draft.warnings
  }
}
