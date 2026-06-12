import { z } from "zod"

const looseMetaSchema = z.record(z.unknown())

export const storyMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional()
})

const storyValValueTypeSchema = z.enum(["value", "calc"])

export const storyValEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  value_type: storyValValueTypeSchema.default("value"),
  value: z.unknown().optional(),
  calc_rule: z.string().default("")
}).superRefine((entry, context) => {
  if (entry.value_type === "calc" && entry.calc_rule.trim().length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "calc_rule is required when value_type is calc.",
      path: ["calc_rule"]
    })
  }
})

export const storyValSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  vals: z.array(storyValEntrySchema).default([])
})

export const storyValsSchema = z.object({
  variables: z.array(storyValSchema).default([])
})

export const storyPlayerOverrideValEntrySchema = z.object({
  var_key: z.string().min(1),
  need_player_override: z.boolean().default(false),
  tips: z.string().default(""),
  group_no: z.number().int().min(1).default(1)
})

export const storyPlayerOverrideValsSchema = z.object({
  entries: z.array(storyPlayerOverrideValEntrySchema).default([])
})

export const storySceneEntrySchema = z.object({
  level: z.number().int().min(1),
  description: z.string().default(""),
  music: z.string().default(""),
  day_img: z.string().default(""),
  night_img: z.string().default("")
})

export const storySceneAiConfigSchema = z.object({
  compress_quality: z.number().int().min(1).max(100).default(60)
})

export const storySceneSchema = z.object({
  ai: storySceneAiConfigSchema.default({
    compress_quality: 60
  }),
  scenes: z.array(storySceneEntrySchema).default([])
})

export const storyRoleAiConfigSchema = z.object({
  width: z.number().int().min(1).default(1536),
  height: z.number().int().min(1).default(1024),
  global_prompt: z.string().default(""),
  compress_quality_1: z.number().int().min(1).max(100).default(60),
  compress_quality_2: z.number().int().min(1).max(100).default(80)
})

export const storyNormalRoleSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().default(""),
  mingzi: z.string().optional(),
  zhiye: z.string().default(""),
  descr: z.string().default(""),
  prompt: z.string().default(""),
  img_raw: z.string().default(""),
  img_compress_1: z.string().default(""),
  img_compress_2: z.string().default("")
}).superRefine((role, context) => {
  if (!role.id?.trim() && !role.name?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "id is required.",
      path: ["id"]
    })
  }
}).transform((role) => ({
  id: role.id?.trim() ? role.id : role.name,
  name: role.id?.trim() ? (role.name || role.mingzi || "") : (role.mingzi || ""),
  zhiye: role.zhiye,
  descr: role.descr,
  prompt: role.prompt,
  img_raw: role.img_raw,
  img_compress_1: role.img_compress_1,
  img_compress_2: role.img_compress_2
}))

export const storyImportantRoleSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().default(""),
  mingzi: z.string().optional(),
  zhiye: z.string().default(""),
  descr: z.string().default(""),
  descr_male: z.string().default(""),
  descr_female: z.string().default(""),
  prompt: z.string().default(""),
  prompt_male: z.string().default(""),
  prompt_female: z.string().default(""),
  img_raw: z.string().default(""),
  img_compress_1: z.string().default(""),
  img_compress_2: z.string().default(""),
  xingge: z.string().default(""),
  qufen_xingbie: z.boolean().default(false),
  img_male_raw: z.string().default(""),
  img_male_compress_1: z.string().default(""),
  img_male_compress_2: z.string().default(""),
  img_female_raw: z.string().default(""),
  img_female_compress_1: z.string().default(""),
  img_female_compress_2: z.string().default("")
}).superRefine((role, context) => {
  if (!role.id?.trim() && !role.name?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "id is required.",
      path: ["id"]
    })
  }
}).transform((role) => {
  const baseRole = {
    id: role.id?.trim() ? role.id : role.name,
    name: role.id?.trim() ? (role.name || role.mingzi || "") : (role.mingzi || ""),
    zhiye: role.zhiye,
    descr: role.descr,
    descr_male: role.descr_male,
    descr_female: role.descr_female,
    prompt: role.prompt,
    prompt_male: role.prompt_male,
    prompt_female: role.prompt_female,
    img_raw: role.img_raw,
    img_compress_1: role.img_compress_1,
    img_compress_2: role.img_compress_2,
    xingge: role.xingge,
    qufen_xingbie: role.qufen_xingbie,
    img_male_raw: role.img_male_raw,
    img_male_compress_1: role.img_male_compress_1,
    img_male_compress_2: role.img_male_compress_2,
    img_female_raw: role.img_female_raw,
    img_female_compress_1: role.img_female_compress_1,
    img_female_compress_2: role.img_female_compress_2
  }

  if (role.qufen_xingbie) {
    return {
      ...baseRole,
      descr: "",
      prompt: "",
      img_raw: "",
      img_compress_1: "",
      img_compress_2: ""
    }
  }

  return {
    ...baseRole,
    descr_male: "",
    descr_female: "",
    prompt_male: "",
    prompt_female: "",
    img_male_raw: "",
    img_male_compress_1: "",
    img_male_compress_2: "",
    img_female_raw: "",
    img_female_compress_1: "",
    img_female_compress_2: ""
  }
})

export const storyNormalRolesDataFileSchema = z.object({
  ai: storyRoleAiConfigSchema.default({
    width: 1536,
    height: 1024,
    global_prompt: "",
    compress_quality_1: 60,
    compress_quality_2: 80
  }),
  roles: z.array(storyNormalRoleSchema).default([])
})

export const storyImportantRolesDataFileSchema = z.object({
  ai: storyRoleAiConfigSchema.default({
    width: 1536,
    height: 1024,
    global_prompt: "",
    compress_quality_1: 60,
    compress_quality_2: 80
  }),
  roles: z.array(storyImportantRoleSchema).default([])
})

export const storyRolesSchema = z.object({
  normal: storyNormalRolesDataFileSchema.default({
    ai: {
      width: 1536,
      height: 1024,
      global_prompt: "",
      compress_quality_1: 60,
      compress_quality_2: 80
    },
    roles: []
  }),
  important: storyImportantRolesDataFileSchema.default({
    ai: {
      width: 1536,
      height: 1024,
      global_prompt: "",
      compress_quality_1: 60,
      compress_quality_2: 80
    },
    roles: []
  })
})

export const storyEventLocationAiConfigSchema = z.object({
  width: z.number().int().min(1).default(1536),
  height: z.number().int().min(1).default(1024),
  global_prompt: z.string().default(""),
  compress_quality_1: z.number().int().min(1).max(100).default(60),
  compress_quality_2: z.number().int().min(1).max(100).default(80)
})

export const storyEventLocationAssignmentSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  descr: z.string().default(""),
  prompt: z.string().default(""),
  img_raw: z.string().default(""),
  img_compress_1: z.string().default(""),
  img_compress_2: z.string().default("")
}).superRefine((assignment, context) => {
  if (!assignment.id?.trim() && !assignment.name?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "id is required.",
      path: ["id"]
    })
  }
}).transform((assignment) => ({
  id: assignment.id ?? assignment.name ?? "",
  descr: assignment.descr,
  prompt: assignment.prompt,
  img_raw: assignment.img_raw,
  img_compress_1: assignment.img_compress_1,
  img_compress_2: assignment.img_compress_2
}))

export const storyEventLocationSchema = z.object({
  ai: storyEventLocationAiConfigSchema.default({
    width: 1536,
    height: 1024,
    global_prompt: "",
    compress_quality_1: 60,
    compress_quality_2: 80
  }),
  assignments: z.array(storyEventLocationAssignmentSchema).default([])
})

export const storyItemAiConfigSchema = z.object({
  width: z.number().int().min(1).default(1024),
  height: z.number().int().min(1).default(1024),
  global_prompt: z.string().default(""),
  compress_quality_1: z.number().int().min(1).max(100).default(60),
  compress_quality_2: z.number().int().min(1).max(100).default(80)
})

export const storyItemCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  descr: z.string().default(""),
  sort_order: z.number().int().default(0)
}).transform((category) => ({
  id: category.id.trim(),
  name: category.name.trim(),
  descr: category.descr,
  sort_order: category.sort_order
}))

export const storyItemDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  category_id: z.string().min(1),
  descr: z.string().default(""),
  prompt: z.string().default(""),
  tags: z.array(z.string()).default([]),
  rarity: z.string().default("common"),
  stackable: z.boolean().default(true),
  max_stack: z.number().int().min(1).default(1),
  usable: z.boolean().default(false),
  img_raw: z.string().default(""),
  img_compress_1: z.string().default(""),
  img_compress_2: z.string().default("")
}).transform((item) => ({
  id: item.id.trim(),
  name: item.name.trim(),
  category_id: item.category_id.trim(),
  descr: item.descr,
  prompt: item.prompt,
  tags: item.tags.map((tag) => tag.trim()).filter(Boolean),
  rarity: item.rarity.trim() || "common",
  stackable: item.stackable,
  max_stack: item.max_stack,
  usable: item.usable,
  img_raw: item.img_raw,
  img_compress_1: item.img_compress_1,
  img_compress_2: item.img_compress_2
}))

export const storyItemsSchema = z.object({
  ai: storyItemAiConfigSchema.default({
    width: 1024,
    height: 1024,
    global_prompt: "",
    compress_quality_1: 60,
    compress_quality_2: 80
  }),
  categories: z.array(storyItemCategorySchema).default([]),
  items: z.array(storyItemDefinitionSchema).default([])
}).superRefine((itemsFile, context) => {
  const categoryIds = new Set<string>()
  const itemIds = new Set<string>()

  for (const [categoryIndex, category] of itemsFile.categories.entries()) {
    if (categoryIds.has(category.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate item category id "${category.id}".`,
        path: ["categories", categoryIndex, "id"]
      })
    }

    categoryIds.add(category.id)
  }

  for (const [itemIndex, item] of itemsFile.items.entries()) {
    if (itemIds.has(item.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate item id "${item.id}".`,
        path: ["items", itemIndex, "id"]
      })
    }

    itemIds.add(item.id)

    if (!categoryIds.has(item.category_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Item "${item.id}" references missing category "${item.category_id}".`,
        path: ["items", itemIndex, "category_id"]
      })
    }
  }
})

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

export const storyPhoneQuickMessageSchema = z.object({
  id: z.string().min(1),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
  base_favor_delta: z.number().int().min(0).max(100).default(1),
  cooldown_hours: z.number().int().min(0).default(0),
  visibility: z.enum(["always", "suggested-only"]).default("always"),
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

export const storyPhoneSchema = z.object({
  player_quick_messages: z.array(storyPhoneQuickMessageSchema).default([]),
  contact_profiles: z.array(storyPhoneContactProfileSchema).default([]),
  fallback_replies: storyPhoneRepliesRecordSchema
}).superRefine((phoneFile, context) => {
  const quickMessageIds = new Set<string>()
  const contactProfileRoleKeys = new Set<string>()

  for (const [messageIndex, message] of phoneFile.player_quick_messages.entries()) {
    if (quickMessageIds.has(message.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate phone quick message id "${message.id}".`,
        path: ["player_quick_messages", messageIndex, "id"]
      })
    }

    quickMessageIds.add(message.id)
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
        if (!quickMessageIds.has(replyQuickMessageId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Phone proactive rule "${profile.role_key}/${rule.id}" references missing quick message "${replyQuickMessageId}".`,
            path: ["contact_profiles", profileIndex, "proactive_messages", ruleIndex, "reply_quick_message_ids", replyIndex]
          })
        }
      }
    }
  }
})

export const storyBibleSchema = z.object({
  background: z.string().default(""),
  golden_finger: z.string().default(""),
  protagonist: z.string().default(""),
  world_rules: z.string().default(""),
  outline: z.string().default(""),
  current_arc: z.string().default(""),
  gameplay_design: z.string().default(""),
  style_guide: z.string().default(""),
  constraints: z.string().default("")
})

export const appAiProviderSettingsSchema = z.object({
  apiKey: z.string().default(""),
  baseUrl: z.string().default(""),
  model: z.string().default("")
})

export const appAiAgentSettingsSchema = z.object({
  apiKey: z.string().default(""),
  baseUrl: z.string().default(""),
  chiefEditorModel: z.string().default(""),
  plotPlannerModel: z.string().default(""),
  assetDesignerModel: z.string().default(""),
  eventWriterModel: z.string().default(""),
  scriptDoctorModel: z.string().default(""),
  consistencyCheckerModel: z.string().default(""),
  temperature: z.number().min(0).max(2).default(0.7)
})

export const appAiSettingsSchema = z.object({
  image: appAiProviderSettingsSchema.default({
    apiKey: "",
    baseUrl: "",
    model: ""
  }),
  text: appAiProviderSettingsSchema.default({
    apiKey: "",
    baseUrl: "",
    model: ""
  }),
  agent: appAiAgentSettingsSchema.default({
    apiKey: "",
    baseUrl: "",
    chiefEditorModel: "",
    plotPlannerModel: "",
    assetDesignerModel: "",
    eventWriterModel: "",
    scriptDoctorModel: "",
    consistencyCheckerModel: "",
    temperature: 0.7
  })
})

export const appSettingsSchema = z.object({
  ai: appAiSettingsSchema.default({
    image: {
      apiKey: "",
      baseUrl: "",
      model: ""
    },
    text: {
      apiKey: "",
      baseUrl: "",
      model: ""
    },
    agent: {
      apiKey: "",
      baseUrl: "",
      chiefEditorModel: "",
      plotPlannerModel: "",
      assetDesignerModel: "",
      eventWriterModel: "",
      scriptDoctorModel: "",
      consistencyCheckerModel: "",
      temperature: 0.7
    }
  })
})

export const storyOnceDialogueSchema = z.object({
  speaker_type: z.enum(["player", "object"]).default("object"),
  speaker_key: z.string().default(""),
  content: z.string().default("")
})

export const storyEventPresentationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("silent")
  }),
  z.object({
    type: z.literal("message"),
    message: z.object({
      content: z.string().default(""),
      duration_seconds: z.number().min(0).default(3)
    })
  }),
  z.object({
    type: z.literal("dialogue"),
    dialogues: z.array(storyOnceDialogueSchema).default([])
  })
])

export const storyOnceInvokeParamSchema = z.object({
  name: z.string().min(1),
  descr: z.string().optional()
})

const storyEventTriggerModeSchema = z.enum(["default", "condition", "invoke"])

function validateInvokeParamNames(
  params: Array<{ name: string }>,
  context: z.RefinementCtx
) {
  const normalizedNames = new Set<string>()

  for (const [index, param] of params.entries()) {
    const trimmedName = param.name.trim()
    if (!trimmedName) {
      continue
    }

    if (normalizedNames.has(trimmedName)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate invoke param name "${trimmedName}".`,
        path: ["invoke_params", index, "name"]
      })
      continue
    }

    normalizedNames.add(trimmedName)
  }
}

function validateEventTriggerConfig(
  event: {
    trigger_mode: "default" | "condition" | "invoke"
    trigger_expr: string
    invoke_params: Array<{ name: string }>
  },
  context: z.RefinementCtx
) {
  if (event.trigger_mode === "condition" && !event.trigger_expr.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "trigger_expr is required when trigger_mode is condition.",
      path: ["trigger_expr"]
    })
  }

  if (
    event.trigger_mode === "invoke"
    && !event.invoke_params.some((param) => param.name.trim())
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "invoke_params is required when trigger_mode is invoke.",
      path: ["invoke_params"]
    })
  }
}

const storyEventBaseSchema = z.object({
  node_type: z.literal("event").optional(),
  id: z.string().min(1),
  title: z.string().min(1),
  trigger_mode: storyEventTriggerModeSchema.default("default"),
  trigger_expr: z.string().default(""),
  invoke_params: z.array(storyOnceInvokeParamSchema).default([]),
  init_script: z.string().default(""),
  end_script: z.string().default(""),
  object_keys: z.array(z.string()).default([]),
  presentation: storyEventPresentationSchema,
  location: z.string().default(""),
  next: z.array(z.string()),
  meta: z.record(z.unknown()).optional()
})

export const storyEventSchema = storyEventBaseSchema.superRefine((event, context) => {
  validateEventTriggerConfig(event, context)
  validateInvokeParamNames(event.invoke_params, context)
})

export const storyActionVarSchema = z.object({
  name: z.string().min(1),
  descr: z.string().optional(),
  initial_value: z.string().default("")
})

export const storyActionSchema = z.object({
  node_type: z.literal("action").optional(),
  id: z.string().min(1),
  title: z.string().min(1),
  vars: z.array(storyActionVarSchema).default([]),
  exec_script: z.string().default(""),
  next: z.array(z.string()).default([]),
  meta: z.record(z.unknown()).optional()
})

export const storyEventTriggerSchema = z.object({
  all: z.array(looseMetaSchema).optional(),
  any: z.array(looseMetaSchema).optional(),
  none: z.array(looseMetaSchema).optional()
})

export const storyGraphNodeSchema = z.union([storyEventSchema, storyActionSchema])
export const storyGraphEventsSchema = z.array(storyGraphNodeSchema).default([])
export const storyChainEventsSchema = storyGraphEventsSchema

export const storyOnceEventSchema = storyEventBaseSchema.extend({
  id: z.string().min(1),
  title: z.string().min(1),
  trigger_mode: storyEventTriggerModeSchema.default("default"),
  trigger_expr: z.string().default(""),
  invoke_params: z.array(storyOnceInvokeParamSchema).default([]),
  init_script: z.string().default(""),
  object_keys: z.array(z.string()).default([]),
  presentation: storyEventPresentationSchema,
  location: z.string().default(""),
  bgm: z.string().default(""),
  end_script: z.string().default(""),
  meta: z.record(z.unknown()).optional()
}).omit({
  next: true
}).superRefine((event, context) => {
  validateEventTriggerConfig(event, context)
  validateInvokeParamNames(event.invoke_params, context)
})

export const storyOnceEventsSchema = z.array(storyOnceEventSchema).default([])
export const storyPoolEventsSchema = storyOnceEventsSchema

export const storyLoopRuleSchema = z.object({
  mode: z.enum(["daily", "weekly", "monthly", "interval_days"]),
  interval_days: z.number().int().min(1).optional(),
  weekday: z.number().int().min(1).max(7).optional(),
  month_day: z.number().int().min(1).max(31).optional(),
  at: z.string().optional(),
  priority: z.number().int().optional(),
  after: z.array(z.string()).optional(),
  before: z.array(z.string()).optional()
})

export const storyLoopEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  trigger_mode: storyEventTriggerModeSchema.default("default"),
  trigger_expr: z.string().default(""),
  invoke_params: z.array(storyOnceInvokeParamSchema).default([]),
  init_script: z.string().default(""),
  object_keys: z.array(z.string()).default([]),
  presentation: storyEventPresentationSchema,
  location: z.string().default(""),
  bgm: z.string().default(""),
  end_script: z.string().default(""),
  meta: z.record(z.unknown()).optional(),
  loop: storyLoopRuleSchema
}).superRefine((event, context) => {
  validateEventTriggerConfig(event, context)
  validateInvokeParamNames(event.invoke_params, context)
})

export const storyLoopEventsSchema = z.array(storyLoopEventSchema).default([])
export const storyScheduleEventsSchema = storyLoopEventsSchema

export const storyDocumentSchema = z.object({
  story: storyMetaSchema,
  storyBible: storyBibleSchema.default({}),
  vals: storyValsSchema,
  playerOverrideVals: storyPlayerOverrideValsSchema,
  systemVals: storyValsSchema,
  scenes: storySceneSchema,
  roles: storyRolesSchema,
  eventLocations: storyEventLocationSchema,
  items: storyItemsSchema.default({}),
  initialBags: storyInitialBagsSchema,
  phone: storyPhoneSchema.default({}),
  chainEvents: storyChainEventsSchema.default([]),
  poolEvents: storyPoolEventsSchema.default([]),
  scheduleEvents: storyScheduleEventsSchema.default([]),
  graphEvents: storyGraphEventsSchema.default([]),
  onceEvents: storyOnceEventsSchema.default([]),
  loopEvents: storyLoopEventsSchema.default([])
}).transform((document) => {
  const chainEvents = document.chainEvents.length > 0 ? document.chainEvents : document.graphEvents
  const poolEvents = document.poolEvents.length > 0 ? document.poolEvents : document.onceEvents
  const scheduleEvents = document.scheduleEvents.length > 0 ? document.scheduleEvents : document.loopEvents

  return {
    ...document,
    chainEvents,
    poolEvents,
    scheduleEvents,
    graphEvents: chainEvents,
    onceEvents: poolEvents,
    loopEvents: scheduleEvents
  }
})
