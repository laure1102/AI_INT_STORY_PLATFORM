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

export const storyRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  avatar: z.string().min(1).optional(),
  description: z.string().optional(),
  meta: looseMetaSchema.optional()
})

export const storyRolesSchema = z.object({
  roles: z.array(storyRoleSchema).default([])
})

export const storyEventLocationAiConfigSchema = z.object({
  image_size: z.string().default("1536x1024"),
  global_prompt: z.string().default(""),
  compress_quality: z.number().int().min(1).max(100).default(60)
})

export const storyEventLocationAssignmentSchema = z.object({
  name: z.string().min(1),
  descr: z.string().default(""),
  img: z.string().default(""),
  prompt: z.string().default("")
})

export const storyEventLocationSchema = z.object({
  ai: storyEventLocationAiConfigSchema.default({
    image_size: "1536x1024",
    global_prompt: "",
    compress_quality: 60
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

export const storyEventTriggerSchema = z.object({
  all: z.array(looseMetaSchema).optional(),
  any: z.array(looseMetaSchema).optional(),
  none: z.array(looseMetaSchema).optional()
})

export const storyGraphEventsSchema = z.array(storyEventSchema).default([])

export const storyBigOnceEventSchema = storyEventSchema.extend({
  trigger: storyEventTriggerSchema.optional()
})

export const storyBigOnceEventsSchema = z.array(storyBigOnceEventSchema).default([])

export const storyLoopEventSchema = storyEventSchema.extend({
  trigger: storyEventTriggerSchema.optional(),
  cooldown: looseMetaSchema.optional()
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
