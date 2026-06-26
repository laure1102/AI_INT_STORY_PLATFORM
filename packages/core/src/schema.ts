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

const storyPlayerOverrideInputTypeSchema = z.enum(["text", "select"])

export const storyPlayerOverrideInputOptionSchema = z.object({
  label: z.string().default(""),
  value: z.string().default("")
})

export const storyPlayerOverrideValEntrySchema = z.object({
  var_key: z.string().min(1),
  need_player_override: z.boolean().default(false),
  tips: z.string().default(""),
  group_no: z.number().int().min(1).default(1),
  input_type: storyPlayerOverrideInputTypeSchema.default("text"),
  input_options: z.array(storyPlayerOverrideInputOptionSchema).default([])
})

export const storyPlayerOverrideValsSchema = z.object({
  entries: z.array(storyPlayerOverrideValEntrySchema).default([])
})

export const storyReferGenderAliasesSchema = z.object({
  male: z.array(z.string()).default(["男", "male", "m"]),
  female: z.array(z.string()).default(["女", "female", "f"])
}).transform((aliases) => ({
  male: Array.from(new Set(aliases.male.map((item) => item.trim()).filter(Boolean))),
  female: Array.from(new Set(aliases.female.map((item) => item.trim()).filter(Boolean)))
}))

export const storyReferTermSchema = z.object({
  id: z.string().min(1),
  label: z.string().default(""),
  male: z.string().default(""),
  female: z.string().default(""),
  fallback: z.string().default("")
}).transform((term) => ({
  id: term.id.trim(),
  label: term.label.trim(),
  male: term.male.trim(),
  female: term.female.trim(),
  fallback: term.fallback.trim()
}))

export const storyReferSchema = z.object({
  gender_value_key: z.string().default("player.gender"),
  gender_aliases: storyReferGenderAliasesSchema.default({
    male: ["男", "male", "m"],
    female: ["女", "female", "f"]
  }),
  terms: z.array(storyReferTermSchema).default([])
}).default({
  gender_value_key: "player.gender",
  gender_aliases: {
    male: ["男", "male", "m"],
    female: ["女", "female", "f"]
  },
  terms: []
}).superRefine((refer, context) => {
  const termIds = new Set<string>()

  for (const [termIndex, term] of refer.terms.entries()) {
    if (termIds.has(term.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate refer term id "${term.id}".`,
        path: ["terms", termIndex, "id"]
      })
    }

    termIds.add(term.id)
  }
}).transform((refer) => ({
  gender_value_key: refer.gender_value_key.trim() || "player.gender",
  gender_aliases: refer.gender_aliases,
  terms: refer.terms
}))

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

const storyPhoneContactTrackIdSchema = z.enum(["none", "romance", "official", "social"])

export const storyNormalRoleSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().default(""),
  mingzi: z.string().optional(),
  zhiye: z.string().default(""),
  descr: z.string().default(""),
  prompt: z.string().default(""),
  img_raw: z.string().default(""),
  img_compress_1: z.string().default(""),
  img_compress_2: z.string().default(""),
  contact_enabled: z.boolean().default(false),
  contact_track: storyPhoneContactTrackIdSchema.default("none"),
  contact_initial_favor: z.number().int().min(0).max(100).default(20),
  xingge_id: z.string().default(""),
  xingge_note: z.string().default("")
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
  img_compress_2: role.img_compress_2,
  contact_enabled: role.contact_enabled,
  contact_track: role.contact_track,
  contact_initial_favor: role.contact_initial_favor,
  xingge_id: role.xingge_id.trim(),
  xingge_note: role.xingge_note.trim()
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
  xingge_id: z.string().default(""),
  xingge_note: z.string().default(""),
  contact_enabled: z.boolean().default(false),
  contact_track: storyPhoneContactTrackIdSchema.default("none"),
  contact_initial_favor: z.number().int().min(0).max(100).default(20),
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
    xingge_id: role.xingge_id.trim(),
    xingge_note: role.xingge_note.trim(),
    contact_enabled: role.contact_enabled,
    contact_track: role.contact_track,
    contact_initial_favor: role.contact_initial_favor,
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

export const storyPhoneConversationNodeSchema = z.object({
  id: z.string().min(1),
  contact_messages: z.array(z.object({
    content: z.string().default("")
  })).default([]),
  player_options: z.array(storyPhoneConversationOptionSchema).default([]),
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

export const storyDoingMenuSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  parent_id: z.string().default(""),
  sort_order: z.number().int().default(0),
  visible_expr: z.string().default(""),
  descr: z.string().default("")
}).transform((menu) => ({
  id: menu.id.trim(),
  title: menu.title.trim(),
  parent_id: menu.parent_id.trim(),
  sort_order: menu.sort_order,
  visible_expr: menu.visible_expr.trim(),
  descr: menu.descr
}))

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

  if (event.trigger_mode === "invoke" && event.trigger_expr.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "trigger_expr must stay empty when trigger_mode is invoke.",
      path: ["trigger_expr"]
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

const storyOnceEventObjectSchema = storyEventBaseSchema.extend({
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
})

export const storyOnceEventSchema = storyOnceEventObjectSchema.superRefine((event, context) => {
  validateEventTriggerConfig(event, context)
  validateInvokeParamNames(event.invoke_params, context)
})

export const storyOnceEventsSchema = z.array(storyOnceEventSchema).default([])
export const storyPoolEventsSchema = storyOnceEventsSchema

export const storyDoingDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  menu_id: z.string().min(1),
  descr: z.string().default(""),
  visible_expr: z.string().default(""),
  cooldown_hours: z.number().int().min(0).default(0),
  once: z.boolean().default(false),
  init_script: z.string().default(""),
  object_keys: z.array(z.string()).default([]),
  presentation: storyEventPresentationSchema,
  location: z.string().default(""),
  bgm: z.string().default(""),
  end_script: z.string().default(""),
  meta: z.record(z.unknown()).optional()
}).transform((doing) => ({
  id: doing.id.trim(),
  title: doing.title.trim(),
  menu_id: doing.menu_id.trim(),
  descr: doing.descr,
  visible_expr: doing.visible_expr.trim(),
  cooldown_hours: doing.cooldown_hours,
  once: doing.once,
  init_script: doing.init_script,
  object_keys: Array.from(new Set(doing.object_keys.map((objectKey) => objectKey.trim()).filter(Boolean))),
  presentation: doing.presentation,
  location: doing.location.trim(),
  bgm: doing.bgm.trim(),
  end_script: doing.end_script,
  meta: doing.meta
}))

export const storyDoingSchema = z.object({
  menus: z.array(storyDoingMenuSchema).default([]),
  doings: z.array(storyDoingDefinitionSchema).default([])
}).default({
  menus: [],
  doings: []
}).superRefine((doingFile, context) => {
  const menuIds = new Set<string>()
  const doingIds = new Set<string>()

  for (const [menuIndex, menu] of doingFile.menus.entries()) {
    if (menuIds.has(menu.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate doing menu id "${menu.id}".`,
        path: ["menus", menuIndex, "id"]
      })
    }

    menuIds.add(menu.id)
  }

  for (const [menuIndex, menu] of doingFile.menus.entries()) {
    if (menu.parent_id && !menuIds.has(menu.parent_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Doing menu "${menu.id}" references missing parent menu "${menu.parent_id}".`,
        path: ["menus", menuIndex, "parent_id"]
      })
    }

    if (menu.parent_id === menu.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Doing menu "${menu.id}" cannot use itself as parent.`,
        path: ["menus", menuIndex, "parent_id"]
      })
    }
  }

  for (const [doingIndex, doing] of doingFile.doings.entries()) {
    if (doingIds.has(doing.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate doing id "${doing.id}".`,
        path: ["doings", doingIndex, "id"]
      })
    }

    doingIds.add(doing.id)

    if (!menuIds.has(doing.menu_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Doing "${doing.id}" references missing menu "${doing.menu_id}".`,
        path: ["doings", doingIndex, "menu_id"]
      })
    }
  }
})

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
  refer: storyReferSchema.default({}),
  scenes: storySceneSchema,
  roles: storyRolesSchema,
  eventLocations: storyEventLocationSchema,
  items: storyItemsSchema.default({}),
  shop: storyShopSchema.default({}),
  initialBags: storyInitialBagsSchema,
  phone: storyPhoneSchema.default({}),
  phoneConversations: storyPhoneConversationsSchema.default({ conversations: [] }),
  doing: storyDoingSchema.default({}),
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
