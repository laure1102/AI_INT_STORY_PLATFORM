/**
 * 普通手机功能与连续剧情手机对话的持久化 Schema。
 *
 * 本模块整理联系人、消息库和对话节点；运行时状态不属于这里。
 */
import { z } from "zod"
import { storyPhoneContactTrackIdSchema } from "./assets"

export const storyPhoneLibraryScopeSchema = z.object({
  role_keys: z.array(z.string()).default([]),
  contact_tracks: z.array(storyPhoneContactTrackIdSchema).default([]),
  personality_ids: z.array(z.string()).default([]),
  min_favor: z.number().int().min(0).max(100).default(0),
  max_favor: z.number().int().min(0).max(100).default(100)
}).superRefine((scope, context) => {
  if (scope.min_favor > scope.max_favor) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "min_favor cannot be greater than max_favor.",
      path: ["min_favor"]
    })
  }
}).transform((scope) => ({
  role_keys: Array.from(new Set(scope.role_keys.map((roleKey) => roleKey.trim()).filter(Boolean))),
  contact_tracks: Array.from(new Set(scope.contact_tracks)),
  personality_ids: Array.from(
    new Set(scope.personality_ids.map((personalityId) => personalityId.trim()).filter(Boolean))
  ),
  min_favor: scope.min_favor,
  max_favor: scope.max_favor
}))

export const storyPhoneInvokeDelaySchema = z.object({
  unit: z.enum(["hours", "days", "months", "years"]),
  value: z.number().int().min(1)
})

export const storyPhoneEventInvocationSchema = z.object({
  target_type: z.enum(["chain", "pool", "schedule"]).default("chain"),
  event_id: z.string().min(1),
  delay: storyPhoneInvokeDelaySchema.optional()
}).transform((invoke) => ({
  target_type: invoke.target_type,
  event_id: invoke.event_id.trim(),
  delay: invoke.delay
}))

export const storyPhoneRelationshipStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  descr: z.string().default(""),
  min_favor: z.number().int().min(0).max(100).default(0),
  max_favor: z.number().int().min(0).max(100).default(100),
  allow_contact: z.boolean().default(true),
  lock_message: z.string().default(""),
  unlock_action_tags: z.array(z.string()).default([])
}).superRefine((stage, context) => {
  if (stage.min_favor > stage.max_favor) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "min_favor cannot be greater than max_favor.",
      path: ["min_favor"]
    })
  }
}).transform((stage) => ({
  id: stage.id.trim(),
  name: stage.name.trim(),
  descr: stage.descr.trim(),
  min_favor: stage.min_favor,
  max_favor: stage.max_favor,
  allow_contact: stage.allow_contact,
  lock_message: stage.lock_message.trim(),
  unlock_action_tags: Array.from(
    new Set(stage.unlock_action_tags.map((tag) => tag.trim()).filter(Boolean))
  )
}))

export const storyPhoneRelationshipTrackSchema = z.object({
  id: storyPhoneContactTrackIdSchema,
  name: z.string().default(""),
  descr: z.string().default(""),
  stages: z.array(storyPhoneRelationshipStageSchema).default([])
}).superRefine((track, context) => {
  const stageIds = new Set<string>()

  for (const [stageIndex, stage] of track.stages.entries()) {
    if (stageIds.has(stage.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate relationship stage id "${stage.id}".`,
        path: ["stages", stageIndex, "id"]
      })
    }

    stageIds.add(stage.id)
  }
}).transform((track) => ({
  id: track.id,
  name: track.name.trim(),
  descr: track.descr.trim(),
  stages: track.stages
}))

export const storyPhonePersonalityDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  descr: z.string().default(""),
  style_tags: z.array(z.string()).default([])
}).transform((personality) => ({
  id: personality.id.trim(),
  name: personality.name.trim(),
  descr: personality.descr.trim(),
  style_tags: Array.from(new Set(personality.style_tags.map((tag) => tag.trim()).filter(Boolean)))
}))

export const storyPhoneQuickMessageSchema = z.object({
  id: z.string().min(1),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
  base_favor_delta: z.number().int().min(0).max(100).default(1),
  cooldown_hours: z.number().int().min(0).default(0),
  visibility: z.enum(["always", "suggested-only"]).default("suggested-only"),
  available_role_keys: z.array(z.string()).default([])
}).transform((message) => ({
  id: message.id.trim(),
  text: message.text.trim(),
  tags: Array.from(new Set(message.tags.map((tag) => tag.trim()).filter(Boolean))),
  base_favor_delta: message.base_favor_delta,
  cooldown_hours: message.cooldown_hours,
  visibility: message.visibility,
  available_role_keys: Array.from(
    new Set(message.available_role_keys.map((roleKey) => roleKey.trim()).filter(Boolean))
  )
}))

const storyPhoneRepliesRecordSchema = z.record(z.array(z.string()).default([]))
  .default({})
  .transform((replyMap) => {
    const normalizedReplyMap: Record<string, string[]> = {}

    for (const [tag, replies] of Object.entries(replyMap)) {
      const normalizedTag = tag.trim()
      if (!normalizedTag) {
        continue
      }

      normalizedReplyMap[normalizedTag] = replies.map((reply) => reply.trim()).filter(Boolean)
    }

    return normalizedReplyMap
  })

export const storyPhoneProactiveMessageRuleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger_expr: z.string().min(1),
  cooldown_hours: z.number().int().min(1).default(24),
  favor_delta: z.number().int().min(-100).max(100).default(0),
  messages: z.array(z.string()).min(1),
  reply_quick_message_ids: z.array(z.string()).default([])
}).superRefine((rule, context) => {
  if (!rule.trigger_expr.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "trigger_expr is required.",
      path: ["trigger_expr"]
    })
  }

  if (rule.messages.map((message) => message.trim()).filter(Boolean).length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one non-empty proactive message is required.",
      path: ["messages"]
    })
  }
}).transform((rule) => ({
  id: rule.id.trim(),
  enabled: rule.enabled,
  trigger_expr: rule.trigger_expr.trim(),
  cooldown_hours: rule.cooldown_hours,
  favor_delta: rule.favor_delta,
  messages: rule.messages.map((message) => message.trim()).filter(Boolean),
  reply_quick_message_ids: Array.from(
    new Set(rule.reply_quick_message_ids.map((quickMessageId) => quickMessageId.trim()).filter(Boolean))
  )
}))

export const storyPhoneContactProfileSchema = z.object({
  role_key: z.string().min(1),
  enabled: z.boolean().default(true),
  auto_add: z.boolean().default(true),
  initial_favor: z.number().int().min(0).max(100).default(0),
  preferred_tags: z.array(z.string()).default([]),
  reply_by_tag: storyPhoneRepliesRecordSchema,
  proactive_messages: z.array(storyPhoneProactiveMessageRuleSchema).default([])
}).transform((profile) => ({
  role_key: profile.role_key.trim(),
  enabled: profile.enabled,
  auto_add: profile.auto_add,
  initial_favor: profile.initial_favor,
  preferred_tags: Array.from(new Set(profile.preferred_tags.map((tag) => tag.trim()).filter(Boolean))),
  reply_by_tag: profile.reply_by_tag,
  proactive_messages: profile.proactive_messages
}))

export const storyPhoneTalkLibraryEntrySchema = z.object({
  id: z.string().min(1),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
  scope: storyPhoneLibraryScopeSchema.default({
    role_keys: [],
    contact_tracks: [],
    personality_ids: [],
    min_favor: 0,
    max_favor: 100
  }),
  base_favor_delta: z.number().int().min(-100).max(100).default(0),
  cooldown_hours: z.number().int().min(0).default(0),
  invoke: storyPhoneEventInvocationSchema.optional()
}).transform((entry) => ({
  id: entry.id.trim(),
  text: entry.text.trim(),
  tags: Array.from(new Set(entry.tags.map((tag) => tag.trim()).filter(Boolean))),
  scope: entry.scope,
  base_favor_delta: entry.base_favor_delta,
  cooldown_hours: entry.cooldown_hours,
  invoke: entry.invoke
}))

export const storyPhoneActionCostItemSchema = z.object({
  item_id: z.string().min(1),
  quantity: z.number().int().min(1).default(1)
}).transform((item) => ({
  item_id: item.item_id.trim(),
  quantity: item.quantity
}))

export const storyPhoneActionLibraryEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().default(""),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
  scope: storyPhoneLibraryScopeSchema.default({
    role_keys: [],
    contact_tracks: [],
    personality_ids: [],
    min_favor: 0,
    max_favor: 100
  }),
  base_favor_delta: z.number().int().min(-100).max(100).default(0),
  cooldown_hours: z.number().int().min(0).default(0),
  cost_money: z.number().min(0).default(0),
  cost_items: z.array(storyPhoneActionCostItemSchema).default([]),
  invoke: storyPhoneEventInvocationSchema.optional()
}).transform((entry) => ({
  id: entry.id.trim(),
  label: entry.label.trim(),
  text: entry.text.trim(),
  tags: Array.from(new Set(entry.tags.map((tag) => tag.trim()).filter(Boolean))),
  scope: entry.scope,
  base_favor_delta: entry.base_favor_delta,
  cooldown_hours: entry.cooldown_hours,
  cost_money: entry.cost_money,
  cost_items: entry.cost_items,
  invoke: entry.invoke
}))

export const storyPhoneReplyLibraryEntrySchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string()).default([]),
  scope: storyPhoneLibraryScopeSchema.default({
    role_keys: [],
    contact_tracks: [],
    personality_ids: [],
    min_favor: 0,
    max_favor: 100
  }),
  replies: z.array(z.string()).default([])
}).transform((entry) => ({
  id: entry.id.trim(),
  tags: Array.from(new Set(entry.tags.map((tag) => tag.trim()).filter(Boolean))),
  scope: entry.scope,
  replies: entry.replies.map((reply) => reply.trim()).filter(Boolean)
}))

export const storyPhoneSchema = z.object({
  relationship_tracks: z.array(storyPhoneRelationshipTrackSchema).default([]),
  personality_library: z.array(storyPhonePersonalityDefinitionSchema).default([]),
  talk_library: z.array(storyPhoneTalkLibraryEntrySchema).default([]),
  action_library: z.array(storyPhoneActionLibraryEntrySchema).default([]),
  reply_library: z.array(storyPhoneReplyLibraryEntrySchema).default([]),
  player_quick_messages: z.array(storyPhoneQuickMessageSchema).default([]),
  contact_profiles: z.array(storyPhoneContactProfileSchema).default([]),
  fallback_replies: storyPhoneRepliesRecordSchema
}).superRefine((phoneFile, context) => {
  const relationshipTrackIds = new Set<string>()
  const personalityIds = new Set<string>()
  const quickMessageIds = new Set<string>()
  const proactiveSuggestionIds = new Set<string>()
  const contactProfileRoleKeys = new Set<string>()
  const talkLibraryIds = new Set<string>()
  const actionLibraryIds = new Set<string>()
  const replyLibraryIds = new Set<string>()

  for (const [trackIndex, track] of phoneFile.relationship_tracks.entries()) {
    if (relationshipTrackIds.has(track.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate relationship track id "${track.id}".`,
        path: ["relationship_tracks", trackIndex, "id"]
      })
    }

    relationshipTrackIds.add(track.id)
  }

  for (const [personalityIndex, personality] of phoneFile.personality_library.entries()) {
    if (personalityIds.has(personality.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate personality id "${personality.id}".`,
        path: ["personality_library", personalityIndex, "id"]
      })
    }

    personalityIds.add(personality.id)
  }

  for (const [messageIndex, message] of phoneFile.player_quick_messages.entries()) {
    if (quickMessageIds.has(message.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate phone quick message id "${message.id}".`,
        path: ["player_quick_messages", messageIndex, "id"]
      })
    }

    quickMessageIds.add(message.id)
    proactiveSuggestionIds.add(message.id)
  }

  for (const [entryIndex, entry] of phoneFile.talk_library.entries()) {
    if (talkLibraryIds.has(entry.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate talk library id "${entry.id}".`,
        path: ["talk_library", entryIndex, "id"]
      })
    }

    talkLibraryIds.add(entry.id)
    proactiveSuggestionIds.add(entry.id)
  }

  for (const [entryIndex, entry] of phoneFile.action_library.entries()) {
    if (actionLibraryIds.has(entry.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate action library id "${entry.id}".`,
        path: ["action_library", entryIndex, "id"]
      })
    }

    actionLibraryIds.add(entry.id)
  }

  for (const [entryIndex, entry] of phoneFile.reply_library.entries()) {
    if (replyLibraryIds.has(entry.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate reply library id "${entry.id}".`,
        path: ["reply_library", entryIndex, "id"]
      })
    }

    replyLibraryIds.add(entry.id)
  }

  for (const [profileIndex, profile] of phoneFile.contact_profiles.entries()) {
    if (contactProfileRoleKeys.has(profile.role_key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate phone contact profile role_key "${profile.role_key}".`,
        path: ["contact_profiles", profileIndex, "role_key"]
      })
    }

    contactProfileRoleKeys.add(profile.role_key)

    const proactiveRuleIds = new Set<string>()
    for (const [ruleIndex, rule] of profile.proactive_messages.entries()) {
      if (proactiveRuleIds.has(rule.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate proactive phone rule id "${rule.id}" under "${profile.role_key}".`,
          path: ["contact_profiles", profileIndex, "proactive_messages", ruleIndex, "id"]
        })
      }

      proactiveRuleIds.add(rule.id)

      for (const [replyIndex, replyQuickMessageId] of rule.reply_quick_message_ids.entries()) {
        if (!proactiveSuggestionIds.has(replyQuickMessageId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Phone proactive rule "${profile.role_key}/${rule.id}" references missing reply suggestion "${replyQuickMessageId}".`,
            path: ["contact_profiles", profileIndex, "proactive_messages", ruleIndex, "reply_quick_message_ids", replyIndex]
          })
        }
      }
    }
  }
})

export const storyPhoneConversationOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().default(""),
  visible_expr: z.string().default(""),
  script: z.string().default(""),
  next_node_id: z.string().default("")
}).transform((option) => ({
  id: option.id.trim(),
  text: option.text.trim(),
  visible_expr: option.visible_expr.trim(),
  script: option.script,
  next_node_id: option.next_node_id.trim()
}))

export const storyPhoneConversationReminderSchema = z.object({
  enabled: z.boolean().default(false),
  interval_minutes: z.number().int().min(1).default(60)
}).default({
  enabled: false,
  interval_minutes: 60
}).transform((reminder) => ({
  enabled: reminder.enabled,
  interval_minutes: Math.max(1, Math.trunc(reminder.interval_minutes))
}))

export const storyPhoneConversationNodeSchema = z.object({
  id: z.string().min(1),
  contact_messages: z.array(z.object({
    content: z.string().default("")
  })).default([]),
  player_options: z.array(storyPhoneConversationOptionSchema).default([]),
  reminder: storyPhoneConversationReminderSchema,
  end: z.boolean().default(false),
  end_script: z.string().default(""),
  invoke: storyPhoneEventInvocationSchema.optional()
}).superRefine((node, context) => {
  if (node.id.trim().length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Conversation node id is required.",
      path: ["id"]
    })
  }
}).transform((node) => ({
  id: node.id.trim(),
  contact_messages: node.contact_messages
    .map((message) => ({ content: message.content.trim() }))
    .filter((message) => message.content.length > 0),
  player_options: node.player_options,
  reminder: node.reminder,
  end: node.end,
  end_script: node.end_script,
  ...(node.invoke ? { invoke: node.invoke } : {})
}))

export const storyPhoneConversationDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  role_key: z.string().min(1),
  enabled: z.boolean().default(true),
  once: z.boolean().default(true),
  lock_normal_chat: z.boolean().default(true),
  trigger_expr: z.string().default(""),
  entry_node_id: z.string().min(1),
  nodes: z.array(storyPhoneConversationNodeSchema).default([])
}).superRefine((conversation, context) => {
  const nodeIds = new Set<string>()
  const optionIds = new Set<string>()

  for (const [nodeIndex, node] of conversation.nodes.entries()) {
    if (nodeIds.has(node.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate phone conversation node id "${node.id}".`,
        path: ["nodes", nodeIndex, "id"]
      })
    }
    nodeIds.add(node.id)

    if (node.invoke && !node.end) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Phone conversation node "${node.id}" cannot define invoke unless it is an end node.`,
        path: ["nodes", nodeIndex, "invoke"]
      })
    }

    for (const [optionIndex, option] of node.player_options.entries()) {
      if (optionIds.has(option.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate phone conversation option id "${option.id}".`,
          path: ["nodes", nodeIndex, "player_options", optionIndex, "id"]
        })
      }
      optionIds.add(option.id)
    }
  }

  if (!nodeIds.has(conversation.entry_node_id)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Phone conversation "${conversation.id}" entry_node_id references missing node "${conversation.entry_node_id}".`,
      path: ["entry_node_id"]
    })
  }

  for (const [nodeIndex, node] of conversation.nodes.entries()) {
    for (const [optionIndex, option] of node.player_options.entries()) {
      if (option.next_node_id && !nodeIds.has(option.next_node_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Phone conversation option "${option.id}" references missing next node "${option.next_node_id}".`,
          path: ["nodes", nodeIndex, "player_options", optionIndex, "next_node_id"]
        })
      }
    }
  }
}).transform((conversation) => ({
  id: conversation.id.trim(),
  title: conversation.title.trim(),
  role_key: conversation.role_key.trim(),
  enabled: conversation.enabled,
  once: conversation.once,
  lock_normal_chat: conversation.lock_normal_chat,
  trigger_expr: conversation.trigger_expr.trim(),
  entry_node_id: conversation.entry_node_id.trim(),
  nodes: conversation.nodes
}))

export const storyPhoneConversationsSchema = z.object({
  conversations: z.array(storyPhoneConversationDefinitionSchema).default([])
}).default({
  conversations: []
}).superRefine((file, context) => {
  const conversationIds = new Set<string>()
  for (const [conversationIndex, conversation] of file.conversations.entries()) {
    if (conversationIds.has(conversation.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate phone conversation id "${conversation.id}".`,
        path: ["conversations", conversationIndex, "id"]
      })
    }
    conversationIds.add(conversation.id)
  }
})

