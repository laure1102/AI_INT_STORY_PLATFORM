import { z } from "zod"

const looseMetaSchema = z.record(z.unknown())

export const storyMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  startEventId: z.string().min(1).optional(),
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
  name: z.string().min(1),
  zhiye: z.string().default(""),
  descr: z.string().default(""),
  prompt: z.string().default(""),
  img_raw: z.string().default(""),
  img_compress_1: z.string().default(""),
  img_compress_2: z.string().default("")
})

export const storyImportantRoleSchema = z.object({
  name: z.string().min(1),
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
}).transform((role) => {
  if (role.qufen_xingbie) {
    return {
      ...role,
      descr: "",
      prompt: "",
      img_raw: "",
      img_compress_1: "",
      img_compress_2: ""
    }
  }

  return {
    ...role,
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
  name: z.string().min(1),
  descr: z.string().default(""),
  prompt: z.string().default(""),
  img_raw: z.string().default(""),
  img_compress_1: z.string().default(""),
  img_compress_2: z.string().default("")
})

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

export const appAiProviderSettingsSchema = z.object({
  apiKey: z.string().default(""),
  baseUrl: z.string().default(""),
  model: z.string().default("")
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
    }
  })
})

export const storyEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.string().min(1),
  body: z.string().optional(),
  next: z.array(z.string()),
  meta: z.record(z.unknown()).optional()
})

export const storyBigOnceDialogueSchema = z.object({
  speaker_type: z.enum(["player", "object"]).default("object"),
  speaker_key: z.string().default(""),
  content: z.string().default("")
})

export const storyEventTriggerSchema = z.object({
  all: z.array(looseMetaSchema).optional(),
  any: z.array(looseMetaSchema).optional(),
  none: z.array(looseMetaSchema).optional()
})

export const storyGraphEventsSchema = z.array(storyEventSchema).default([])

export const storyBigOnceEventSchema = storyEventSchema.extend({
  id: z.string().min(1),
  title: z.string().min(1),
  trigger_expr: z.string().default(""),
  init_script: z.string().default(""),
  object_keys: z.array(z.string()).default([]),
  dialogues: z.array(storyBigOnceDialogueSchema).default([]),
  location: z.string().default(""),
  bgm: z.string().default(""),
  end_script: z.string().default("")
}).omit({
  body: true,
  kind: true,
  next: true
})

export const storyBigOnceEventsSchema = z.array(storyBigOnceEventSchema).default([])

export const storyLoopRuleSchema = z.object({
  mode: z.enum(["daily", "weekly", "monthly", "interval_days"]),
  interval_days: z.number().int().min(1).optional(),
  weekday: z.number().int().min(1).max(7).optional(),
  month_day: z.number().int().min(1).max(31).optional()
})

export const storyLoopEventSchema = storyBigOnceEventSchema.extend({
  loop: storyLoopRuleSchema
})

export const storyLoopEventsSchema = z.array(storyLoopEventSchema).default([])

export const storyDocumentSchema = z.object({
  story: storyMetaSchema,
  vals: storyValsSchema,
  scenes: storySceneSchema,
  roles: storyRolesSchema,
  eventLocations: storyEventLocationSchema,
  graphEvents: storyGraphEventsSchema,
  bigOnceEvents: storyBigOnceEventsSchema,
  loopEvents: storyLoopEventsSchema
})
