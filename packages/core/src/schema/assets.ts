/**
 * 场景、角色、地点和物品资产的持久化 Schema。
 *
 * 这里只确认单个文件的结构正确，不检查事件是否引用了不存在的资产。
 */
import { z } from "zod"

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

export const storyPhoneContactTrackIdSchema = z.enum(["none", "romance", "official", "social"])

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
