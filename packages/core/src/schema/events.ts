/**
 * chain、pool、schedule 与 doing 事件的持久化 Schema。
 *
 * 这里校验单个事件的触发配置；跨事件依赖和引用由验证器统一检查。
 */
import { z } from "zod"
import { looseMetaSchema } from "./base"

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

/**
 * 在单个事件内检查 invoke 参数名是否重复。
 *
 * @param params 事件声明的参数数组。
 * @param context Zod refine 上下文，用于把问题定位到具体参数行。
 * @returns 无返回值；通过 `context.addIssue` 收集错误。
 */
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

/**
 * 检查 trigger_mode 与 trigger_expr 的组合约束。
 *
 * @param event 已完成基础字段解析的事件。
 * @param context Zod refine 上下文。
 * @returns 无返回值；condition 缺表达式或 invoke 带表达式时追加 issue。
 */
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
