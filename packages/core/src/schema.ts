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

export const storyOnceDialogueSchema = z.object({
  speaker_type: z.enum(["player", "object"]).default("object"),
  speaker_key: z.string().default(""),
  content: z.string().default("")
})

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
  dialogues: z.array(storyOnceDialogueSchema).default([]),
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

export const storyOnceEventSchema = storyEventBaseSchema.extend({
  id: z.string().min(1),
  title: z.string().min(1),
  trigger_mode: storyEventTriggerModeSchema.default("default"),
  trigger_expr: z.string().default(""),
  invoke_params: z.array(storyOnceInvokeParamSchema).default([]),
  init_script: z.string().default(""),
  object_keys: z.array(z.string()).default([]),
  dialogues: z.array(storyOnceDialogueSchema).default([]),
  location: z.string().default(""),
  bgm: z.string().default(""),
  end_script: z.string().default("")
}).omit({
  next: true
}).superRefine((event, context) => {
  validateEventTriggerConfig(event, context)
  validateInvokeParamNames(event.invoke_params, context)
})

export const storyOnceEventsSchema = z.array(storyOnceEventSchema).default([])

export const storyLoopRuleSchema = z.object({
  mode: z.enum(["daily", "weekly", "monthly", "interval_days"]),
  interval_days: z.number().int().min(1).optional(),
  weekday: z.number().int().min(1).max(7).optional(),
  month_day: z.number().int().min(1).max(31).optional()
})

export const storyLoopEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  trigger_mode: storyEventTriggerModeSchema.default("default"),
  trigger_expr: z.string().default(""),
  invoke_params: z.array(storyOnceInvokeParamSchema).default([]),
  init_script: z.string().default(""),
  object_keys: z.array(z.string()).default([]),
  dialogues: z.array(storyOnceDialogueSchema).default([]),
  location: z.string().default(""),
  bgm: z.string().default(""),
  end_script: z.string().default(""),
  loop: storyLoopRuleSchema
}).superRefine((event, context) => {
  validateEventTriggerConfig(event, context)
  validateInvokeParamNames(event.invoke_params, context)
})

export const storyLoopEventsSchema = z.array(storyLoopEventSchema).default([])

export const storyDocumentSchema = z.object({
  story: storyMetaSchema,
  vals: storyValsSchema,
  playerOverrideVals: storyPlayerOverrideValsSchema,
  systemVals: storyValsSchema,
  scenes: storySceneSchema,
  roles: storyRolesSchema,
  eventLocations: storyEventLocationSchema,
  graphEvents: storyGraphEventsSchema,
  onceEvents: storyOnceEventsSchema,
  loopEvents: storyLoopEventsSchema
})
