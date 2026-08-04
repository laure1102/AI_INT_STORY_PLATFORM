/**
 * 将事件、手机、行动和商城配置压缩成 Agent 可阅读的领域摘要。
 *
 * 输入是已经通过 Core Schema 读取的 `StoryDocument`，输出是受字符上限保护的 JSON 文本。
 * 摘要只保留创作时需要判断“已有内容和可引用 id”的字段，不复制图片、长脚本和全部对白。
 * 本模块不做相关性评分、不校验引用，也不会修改或保存故事。
 */
import type { StoryDocument } from "@story-mgr/core"
import { formatJson } from "./model"

/**
 * 生成三类事件的紧凑目录。
 *
 * chain 同时可能包含事件节点和行动分支节点，所以先用 `exec_script` 区分结构；pool 和 schedule
 * 只保留触发方式、地点及定时规则。每类最多展示 80 项，避免超大故事把主要创作指令挤出 prompt。
 */
export function formatExistingEvents(story: StoryDocument, compact = false) {
  return formatJson({
    chain: story.chainEvents.slice(0, 80).map((event) => {
      if ("exec_script" in event) {
        return {
          node_type: "action",
          id: event.id,
          title: event.title,
          next: event.next
        }
      }

      return {
        node_type: "event",
        id: event.id,
        title: event.title,
        trigger_mode: event.trigger_mode ?? "default",
        location: event.location,
        next: event.next
      }
    }),
    pool: story.poolEvents.slice(0, 80).map((event) => ({
      id: event.id,
      title: event.title,
      trigger_mode: event.trigger_mode ?? "default",
      location: event.location
    })),
    schedule: story.scheduleEvents.slice(0, 80).map((event) => ({
      id: event.id,
      title: event.title,
      trigger_mode: event.trigger_mode ?? "default",
      location: event.location,
      loop: event.loop
    }))
  }, compact ? 8000 : 12000)
}

/**
 * 生成手机、连续手机剧情、主动行动和商城的组合摘要。
 *
 * 这些领域会互相引用：联系人引用角色，手机动作可能消耗物品或调用事件，商城商品引用物品，
 * 行动引用菜单和地点。因此它们被放在同一个上下文片段里，让 Agent 在生成新内容前看到现有 id。
 * 返回文本仅用于推理；引用是否合法仍由草稿规范化和最终 StoryDocument 校验负责。
 */
export function formatExistingPhoneAndDoing(story: StoryDocument, compact = false) {
  return formatJson({
    refer: {
      gender_value_key: story.refer.gender_value_key,
      gender_aliases: story.refer.gender_aliases,
      terms: story.refer.terms.map((term) => ({
        id: term.id,
        label: term.label,
        male: term.male,
        female: term.female,
        fallback: term.fallback,
        placeholder: `\${term.${term.id.replace(/^term\./, "")}}`
      }))
    },
    phone: {
      relationship_tracks: story.phone.relationship_tracks.map((track) => ({
        id: track.id,
        name: track.name,
        stages: track.stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          min_favor: stage.min_favor,
          max_favor: stage.max_favor,
          allow_contact: stage.allow_contact,
          unlock_action_tags: stage.unlock_action_tags
        }))
      })),
      personality_library: story.phone.personality_library.map((personality) => ({
        id: personality.id,
        name: personality.name,
        style_tags: personality.style_tags
      })),
      talk_library: story.phone.talk_library.slice(0, 80).map((entry) => ({
        id: entry.id,
        text: entry.text,
        tags: entry.tags,
        scope: entry.scope
      })),
      action_library: story.phone.action_library.slice(0, 80).map((entry) => ({
        id: entry.id,
        label: entry.label,
        tags: entry.tags,
        scope: entry.scope,
        cost_money: entry.cost_money
      })),
      reply_library: story.phone.reply_library.slice(0, 80).map((entry) => ({
        id: entry.id,
        tags: entry.tags,
        scope: entry.scope,
        replies: entry.replies.slice(0, 5)
      })),
      contact_profiles: story.phone.contact_profiles.map((profile) => ({
        role_key: profile.role_key,
        enabled: profile.enabled,
        auto_add: profile.auto_add,
        initial_favor: profile.initial_favor,
        preferred_tags: profile.preferred_tags,
        proactive_message_ids: profile.proactive_messages.map((rule) => rule.id)
      }))
    },
    phoneConversations: story.phoneConversations.conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      role_key: conversation.role_key,
      enabled: conversation.enabled,
      once: conversation.once,
      lock_normal_chat: conversation.lock_normal_chat,
      entry_node_id: conversation.entry_node_id,
      node_count: conversation.nodes.length
    })),
    doing: {
      menus: story.doing.menus.map((menu) => ({
        id: menu.id,
        title: menu.title,
        parent_id: menu.parent_id,
        visible_expr: menu.visible_expr
      })),
      doings: story.doing.doings.map((doing) => ({
        id: doing.id,
        title: doing.title,
        menu_id: doing.menu_id,
        visible_expr: doing.visible_expr,
        cooldown_hours: doing.cooldown_hours,
        once: doing.once,
        location: doing.location
      }))
    },
    shop: {
      currency_value_key: story.shop.currency_value_key,
      categories: story.shop.categories.map((category) => ({
        id: category.id,
        name: category.name,
        sort_order: category.sort_order,
        visible_expr: category.visible_expr
      })),
      products: story.shop.products.map((product) => ({
        id: product.id,
        category_id: product.category_id,
        item_id: product.item_id,
        price: product.price,
        quantity: product.quantity,
        enabled: product.enabled,
        available_expr: product.available_expr,
        allow_gift: product.allow_gift,
        gift_favor_delta: product.gift_favor_delta
      }))
    }
  }, compact ? 9000 : 16000)
}
