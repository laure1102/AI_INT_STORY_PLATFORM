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

type AgentModelKey =
  | "chiefEditorModel"
  | "plotPlannerModel"
  | "assetDesignerModel"
  | "eventWriterModel"
  | "scriptDoctorModel"
  | "consistencyCheckerModel"

interface RequiredAgentSettings extends AppAiAgentSettings {
  baseUrl: string
  apiKey: string
}

const ROLE_MODEL_KEYS: AgentModelKey[] = [
  "chiefEditorModel",
  "plotPlannerModel",
  "assetDesignerModel",
  "eventWriterModel",
  "scriptDoctorModel",
  "consistencyCheckerModel"
]

const ROLE_TITLES: Record<StoryCreationAgentRole, string> = {
  chiefEditor: "总主编",
  plotPlanner: "剧情规划",
  assetDesigner: "资产设计",
  eventWriter: "事件写作",
  scriptDoctor: "脚本审校",
  consistencyChecker: "一致性检查"
}

const ROLE_ERROR_CODES: Record<StoryCreationAgentRole, string> = {
  chiefEditor: "ai.agent-chief-editor-failed",
  plotPlanner: "ai.agent-plot-planner-failed",
  assetDesigner: "ai.agent-asset-designer-failed",
  eventWriter: "ai.agent-event-writer-failed",
  scriptDoctor: "ai.agent-script-doctor-failed",
  consistencyChecker: "ai.agent-consistency-checker-failed"
}

const RELEVANT_ITEM_DETAIL_LIMIT = 40
const RELEVANT_VARIABLE_DETAIL_LIMIT = 40
const MAX_ITEM_SEARCH_TERMS = 180
const MAX_VARIABLE_SEARCH_TERMS = 180
const SCRIPT_VALIDATION_REPAIR_ATTEMPTS = 2
const STRUCTURED_OUTPUT_PARSE_RETRY_ATTEMPTS = 2
const STORYSCRIPT_PROMPT_SECTION_MAX_CHARS = 14000
const STORYSCRIPT_DOC_PATH = resolve(process.cwd(), "StoryScript.md")
const SCRIPT_REMOVAL_INTENT_PATTERNS = [
  /(清空|删除|移除|去掉|禁用|取消|不要|留空).{0,10}(初始化脚本|结束脚本|条件脚本|trigger_expr|init_script|end_script|脚本)/i,
  /(初始化脚本|结束脚本|条件脚本|trigger_expr|init_script|end_script|脚本).{0,10}(清空|删除|移除|去掉|禁用|取消|不要|留空)/i,
  /\b(remove|delete|clear|disable)\b.{0,12}\b(script|init_script|end_script|trigger_expr)\b/i,
  /\b(script|init_script|end_script|trigger_expr)\b.{0,12}\b(remove|delete|clear|disable)\b/i
] as const

const STRUCTURED_OUTPUT_PARSE_RETRY_PROMPT = [
  "【结构化输出格式修正】",
  "上一次回复没有通过结构化解析。请只重新输出符合当前 response schema 的结果。",
  "不要输出 Markdown、解释文字、代码块或额外字段。",
  "所有数组字段没有内容时填空数组；所有字符串字段没有内容时填空字符串；nullable 字段没有内容时填 null。",
  "phone.contact_profiles[].reply_by_tag 在 Agent 结构化输出里必须是数组，格式为 [{\"tag\":\"pressure\",\"replies\":[\"...\"]}]；不要输出对象映射。"
].join("\n")

let cachedStoryScriptPromptSection: string | null | undefined

function loadStoryScriptPromptSection() {
  if (cachedStoryScriptPromptSection !== undefined) {
    return cachedStoryScriptPromptSection
  }

  if (!existsSync(STORYSCRIPT_DOC_PATH)) {
    cachedStoryScriptPromptSection = null
    return cachedStoryScriptPromptSection
  }

  const source = readFileSync(STORYSCRIPT_DOC_PATH, "utf8")
  const startIndex = source.indexOf("## 2. 脚本类别")
  const endIndex = source.indexOf("## 8. 编译与运行时约束")
  const excerpt = startIndex >= 0
    ? source.slice(startIndex, endIndex > startIndex ? endIndex : undefined)
    : source

  cachedStoryScriptPromptSection = excerpt.trim().slice(0, STORYSCRIPT_PROMPT_SECTION_MAX_CHARS)
  return cachedStoryScriptPromptSection
}

function buildStoryScriptPromptSection() {
  const promptSection = loadStoryScriptPromptSection()

  if (!promptSection) {
    return "【StoryScript.md】当前进程未读取到规范文件；语法与权限判断必须以运行时静态校验为准，不要自行脑补缺失语法。"
  }

  return [
    "【StoryScript.md 摘要（唯一规范来源）】",
    promptSection
  ].join("\n")
}

function instructionAllowsScriptRemoval(instruction: string) {
  return SCRIPT_REMOVAL_INTENT_PATTERNS.some((pattern) => pattern.test(instruction))
}

const draftDialogueSchema = z.object({
  speaker_type: z.enum(["player", "object"]).describe("player 表示玩家主角，object 表示事件对象。"),
  speaker_key: z.string().describe("player 或 normal:<roleId> / important:<roleId>。"),
  content: z.string().describe("对白文本，可使用 ${group.value} 占位。")
})

const draftPresentationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("silent").describe("静默执行：只执行脚本，不向客户端显示内容。")
  }),
  z.object({
    type: z.literal("message").describe("消息提示：客户端显示短提示并自动消失。"),
    message: z.object({
      content: z.string().describe("提示消息文本，可使用 ${group.value} 占位。"),
      duration_seconds: z.number().min(0).default(3).describe("提示显示秒数。")
    })
  }),
  z.object({
    type: z.literal("dialogue").describe("对白：客户端按对白列表逐条推进。"),
    dialogues: z.array(draftDialogueSchema).describe("对白列表。")
  })
])

const draftInvokeParamSchema = z.object({
  name: z.string().min(1).describe("调用参数名，必须是标识符。"),
  descr: z.string().optional().describe("参数说明。")
})

const draftLoopRuleSchema = z.object({
  mode: z.enum(["daily", "weekly", "monthly", "interval_days"]).describe("定时规则类型。"),
  interval_days: z.number().int().min(1).optional().describe("interval_days 模式的间隔天数。"),
  weekday: z.number().int().min(1).max(7).optional().describe("weekly 模式的星期几，1 到 7。"),
  month_day: z.number().int().min(1).max(31).optional().describe("monthly 模式的日期，1 到 31。"),
  at: z.string().optional().describe("触发时间，HH:mm，例如 00:00。"),
  priority: z.number().int().optional().describe("同一触发时间内的优先级，数字越小越先执行；默认 100。"),
  after: z.array(z.string()).optional().describe("必须排在这些 schedule 事件之后执行的事件 id。"),
  before: z.array(z.string()).optional().describe("必须排在这些 schedule 事件之前执行的事件 id。")
})

const draftVariableValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

const draftVariableSchema = z.object({
  group: z.string().min(1).describe("变量组名，例如 player、county、arc。"),
  name: z.string().min(1).describe("变量名，例如 reputation、mood。"),
  description: z.string().describe("变量用途说明。"),
  value_type: z.enum(["value", "calc"]).describe("value 表示普通值，calc 表示计算值。"),
  value: draftVariableValueSchema.optional().describe("value 类型变量的初始值。"),
  calc_rule: z.string().describe("calc 类型变量的计算规则；value 类型留空。")
})

const legacyDraftVariableSchema = z.string().min(1).transform((variableKey): StoryCreationDraftVariable => {
  const [rawGroup = "story", ...rawNameParts] = variableKey.trim().split(".")
  const rawName = rawNameParts.join(".")
  const group = rawName ? rawGroup : "story"
  const name = rawName || rawGroup

  return {
    group,
    name,
    description: "",
    value_type: "value",
    value: null,
    calc_rule: ""
  }
})

const draftLocationSchema = z.object({
  id: z.string().min(1).describe("ASCII 风格地点 id，例如 county_gate。"),
  descr: z.string().describe("地点说明，面向编辑器和生成图片提示词。"),
  prompt: z.string().describe("英文环境美术提示词草稿。")
})

const draftRoleSchema = z.object({
  id: z.string().min(1).describe("ASCII 风格角色 id，例如 debt_collector。"),
  name: z.string().describe("角色显示名。"),
  zhiye: z.string().describe("职业或身份。"),
  descr: z.string().describe("角色设定说明。"),
  prompt: z.string().describe("英文角色美术提示词草稿。"),
  xingge: z.string().optional().describe("重要角色的性格说明。"),
  important: z.boolean().describe("true 写入重要角色池，false 写入普通角色池。")
})

const draftItemSchema = z.object({
  id: z.string().min(1).describe("ASCII 风格物品 id，例如 population_flow_report。"),
  name: z.string().default("").describe("物品显示名。"),
  category_id: z.string().min(1).describe("必须引用现有物品分类 id。"),
  descr: z.string().default("").describe("物品说明、用途、来源和剧情价值。"),
  prompt: z.string().default("").describe("英文物品美术提示词草稿。"),
  tags: z.array(z.string()).default([]).describe("物品标签。"),
  rarity: z.string().default("common").describe("稀有度，例如 common、rare、legendary。"),
  stackable: z.boolean().default(true).describe("是否可堆叠。"),
  max_stack: z.number().int().min(1).default(1).describe("最大堆叠数量。"),
  usable: z.boolean().default(false).describe("是否可作为可使用道具。")
})

const phoneContactTrackSchema = z.enum(["none", "romance", "official", "social"])

const draftPhoneLibraryScopeSchema = z.object({
  role_keys: z.array(z.string()).default([]),
  contact_tracks: z.array(phoneContactTrackSchema).default([]),
  personality_ids: z.array(z.string()).default([]),
  min_favor: z.number().int().min(0).max(100).default(0),
  max_favor: z.number().int().min(0).max(100).default(100)
})

const draftPhoneInvokeDelaySchema = z.object({
  unit: z.enum(["hours", "days", "months", "years"]),
  value: z.number().int().min(1)
})

const draftPhoneInvocationSchema = z.object({
  target_type: z.enum(["chain", "pool", "schedule"]).default("chain"),
  event_id: z.string().min(1),
  delay: draftPhoneInvokeDelaySchema.optional()
})

const draftPhonePersonalitySchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  descr: z.string().default(""),
  style_tags: z.array(z.string()).default([])
})

const draftPhoneTalkSchema = z.object({
  id: z.string().min(1),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
  scope: draftPhoneLibraryScopeSchema.default({
    role_keys: [],
    contact_tracks: [],
    personality_ids: [],
    min_favor: 0,
    max_favor: 100
  }),
  base_favor_delta: z.number().int().min(-100).max(100).default(0),
  cooldown_hours: z.number().int().min(0).default(0),
  invoke: draftPhoneInvocationSchema.optional()
})

const draftPhoneActionCostItemSchema = z.object({
  item_id: z.string().min(1),
  quantity: z.number().int().min(1).default(1)
})

const draftPhoneActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().default(""),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
  scope: draftPhoneLibraryScopeSchema.default({
    role_keys: [],
    contact_tracks: [],
    personality_ids: [],
    min_favor: 0,
    max_favor: 100
  }),
  base_favor_delta: z.number().int().min(-100).max(100).default(0),
  cooldown_hours: z.number().int().min(0).default(0),
  cost_money: z.number().min(0).default(0),
  cost_items: z.array(draftPhoneActionCostItemSchema).default([]),
  invoke: draftPhoneInvocationSchema.optional()
})

const draftPhoneReplySchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string()).default([]),
  scope: draftPhoneLibraryScopeSchema.default({
    role_keys: [],
    contact_tracks: [],
    personality_ids: [],
    min_favor: 0,
    max_favor: 100
  }),
  replies: z.array(z.string()).default([])
})

const draftPhoneProactiveMessageSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger_expr: z.string().min(1),
  cooldown_hours: z.number().int().min(1).default(24),
  favor_delta: z.number().int().min(-100).max(100).default(0),
  messages: z.array(z.string()).min(1),
  reply_quick_message_ids: z.array(z.string()).default([])
})

const draftPhoneContactProfileSchema = z.object({
  role_key: z.string().min(1),
  enabled: z.boolean().default(true),
  auto_add: z.boolean().default(true),
  initial_favor: z.number().int().min(0).max(100).default(20),
  preferred_tags: z.array(z.string()).default([]),
  reply_by_tag: z.record(z.array(z.string()).default([])).default({}),
  proactive_messages: z.array(draftPhoneProactiveMessageSchema).default([])
})

const emptyDraftPhone = {
  personality_library: [],
  talk_library: [],
  action_library: [],
  reply_library: [],
  contact_profiles: []
}

const draftPhoneSchema = z.object({
  personality_library: z.array(draftPhonePersonalitySchema).default([]),
  talk_library: z.array(draftPhoneTalkSchema).default([]),
  action_library: z.array(draftPhoneActionSchema).default([]),
  reply_library: z.array(draftPhoneReplySchema).default([]),
  contact_profiles: z.array(draftPhoneContactProfileSchema).default([])
}).default(emptyDraftPhone)

const draftPhoneConversationMessageSchema = z.object({
  content: z.string().default("")
})

const draftPhoneConversationOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().default(""),
  visible_expr: z.string().default(""),
  script: z.string().default(""),
  next_node_id: z.string().default("")
})

const draftPhoneConversationReminderSchema = z.object({
  enabled: z.boolean().default(false),
  interval_minutes: z.number().int().min(1).default(60)
}).default({
  enabled: false,
  interval_minutes: 60
})

const draftPhoneConversationNodeSchema = z.object({
  id: z.string().min(1),
  contact_messages: z.array(draftPhoneConversationMessageSchema).default([]),
  player_options: z.array(draftPhoneConversationOptionSchema).default([]),
  reminder: draftPhoneConversationReminderSchema,
  end: z.boolean().default(false),
  end_script: z.string().default(""),
  invoke: draftPhoneInvocationSchema.optional()
})

const draftPhoneConversationDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  role_key: z.string().min(1),
  enabled: z.boolean().default(true),
  once: z.boolean().default(true),
  lock_normal_chat: z.boolean().default(true),
  trigger_expr: z.string().default(""),
  entry_node_id: z.string().min(1),
  nodes: z.array(draftPhoneConversationNodeSchema).default([])
})

const emptyDraftPhoneConversations = {
  conversations: []
}

const draftPhoneConversationsSchema = z.object({
  conversations: z.array(draftPhoneConversationDefinitionSchema).default([])
}).default(emptyDraftPhoneConversations)

const draftEventSchema = z.object({
  collectionType: z.enum(["chain", "pool", "schedule"]).describe("目标事件集合。"),
  id: z.string().min(1).describe("ASCII 风格事件 id。"),
  title: z.string().min(1).describe("事件标题。"),
  trigger_mode: z.enum(["default", "condition", "invoke"]).describe("事件触发方式。"),
  trigger_expr: z.string().describe("condition 事件需要 StoryScript 条件表达式；其他模式留空。"),
  invoke_params: z.array(draftInvokeParamSchema).default([]).describe("invoke 事件的调用参数。"),
  object_keys: z.array(z.string()).describe("事件对象引用，例如 player、normal:xxx、important:xxx。"),
  location: z.string().describe("地点 id，可为空。"),
  presentation: draftPresentationSchema.describe("事件表现：静默执行、消息提示或对白。"),
  init_script: z.string().describe("事件进入时 StoryScript；不确定时留空。"),
  end_script: z.string().describe("事件结束时 StoryScript；不确定时留空。"),
  next: z.array(z.string()).describe("chain 事件的后续事件 id；pool/schedule 使用空数组。"),
  bgm: z.string().optional().describe("pool/schedule 事件可用 bgm。"),
  loop: draftLoopRuleSchema.optional().describe("schedule 事件的定时规则。")
})

const draftDoingMenuSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  parent_id: z.string().default(""),
  sort_order: z.number().int().default(100),
  visible_expr: z.string().default(""),
  descr: z.string().default("")
})

const draftDoingDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  menu_id: z.string().min(1),
  descr: z.string().default(""),
  visible_expr: z.string().default(""),
  cooldown_hours: z.number().int().min(0).default(0),
  once: z.boolean().default(false),
  init_script: z.string().default(""),
  object_keys: z.array(z.string()).default([]),
  presentation: draftPresentationSchema.default({ type: "silent" }),
  location: z.string().default(""),
  bgm: z.string().default(""),
  end_script: z.string().default("")
})

const emptyDraftDoing = {
  menus: [],
  doings: []
}

const draftDoingSchema = z.object({
  menus: z.array(draftDoingMenuSchema).default([]),
  doings: z.array(draftDoingDefinitionSchema).default([])
}).default(emptyDraftDoing)

const draftShopCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sort_order: z.number().int().default(100),
  visible_expr: z.string().default(""),
  descr: z.string().default("")
})

const draftShopProductSchema = z.object({
  id: z.string().min(1),
  category_id: z.string().min(1),
  item_id: z.string().min(1),
  price: z.number().min(0).default(0),
  quantity: z.number().int().min(1).default(1),
  sort_order: z.number().int().default(100),
  enabled: z.boolean().default(true),
  available_expr: z.string().default(""),
  unavailable_reason: z.string().default(""),
  allow_gift: z.boolean().default(true),
  gift_favor_delta: z.number().int().min(-100).max(100).default(0),
  purchase_cooldown_hours: z.number().int().min(0).default(0),
  gift_cooldown_hours: z.number().int().min(0).default(0)
})

const emptyDraftShop = {
  categories: [],
  products: []
}

const draftShopSchema = z.object({
  categories: z.array(draftShopCategorySchema).default([]),
  products: z.array(draftShopProductSchema).default([])
}).default(emptyDraftShop)

const draftSchema = z.object({
  title: z.string().min(1).describe("这批生成内容的标题。"),
  summary: z.string().describe("这批内容如何服务可玩网文体验。"),
  arc: z.string().describe("所属篇章或小剧情线。"),
  locations: z.array(draftLocationSchema).describe("建议新增或复用的地点。"),
  roles: z.array(draftRoleSchema).describe("建议新增或复用的角色。"),
  items: z.array(draftItemSchema).default([]).describe("建议新增或复用的物品。"),
  events: z.array(draftEventSchema).describe("建议新增的剧情事件草稿。"),
  variables: z.array(draftVariableSchema).describe("建议新增变量草稿，只写入 vals.json5，不写 system_vals.json5。"),
  phone: draftPhoneSchema,
  phoneConversations: draftPhoneConversationsSchema,
  doing: draftDoingSchema,
  shop: draftShopSchema,
  notes: z.array(z.string()).describe("给编辑器作者的落地说明。"),
  warnings: z.array(z.string()).describe("风险、待人工确认点和不确定项。")
})

const draftApplySchema = draftSchema.extend({
  variables: z.array(z.union([draftVariableSchema, legacyDraftVariableSchema]))
})

const structuredDraftInvokeParamSchema = z.object({
  name: z.string().min(1).describe("调用参数名，必须是标识符。"),
  descr: z.string().nullable().describe("参数说明；没有说明时填 null。")
})

const structuredDraftLoopRuleSchema = z.object({
  mode: z.enum(["daily", "weekly", "monthly", "interval_days"]).describe("定时规则类型。"),
  interval_days: z.number().int().min(1).nullable().describe("interval_days 模式的间隔天数；其他模式填 null。"),
  weekday: z.number().int().min(1).max(7).nullable().describe("weekly 模式的星期几，1 到 7；其他模式填 null。"),
  month_day: z.number().int().min(1).max(31).nullable().describe("monthly 模式的日期，1 到 31；其他模式填 null。"),
  at: z.string().nullable().describe("触发时间，HH:mm；默认或不确定时填 00:00。"),
  priority: z.number().int().nullable().describe("同一触发时间内的优先级；结算类建议 10-49，发放/奖励类建议 50-99，展示/日报类建议 100+；默认填 100。"),
  after: z.array(z.string()).describe("必须排在这些 schedule 事件之后执行的事件 id；没有时填空数组。"),
  before: z.array(z.string()).describe("必须排在这些 schedule 事件之前执行的事件 id；没有时填空数组。")
})

const structuredDraftVariableSchema = z.object({
  group: z.string().min(1).describe("变量组名，例如 player、county、arc。"),
  name: z.string().min(1).describe("变量名，例如 reputation、mood。"),
  description: z.string().describe("变量用途说明。"),
  value_type: z.enum(["value", "calc"]).describe("value 表示普通值，calc 表示计算值。"),
  value: draftVariableValueSchema.describe("value 类型变量的初始值；calc 类型填 null。"),
  calc_rule: z.string().describe("calc 类型变量的计算规则；value 类型留空。")
})

const structuredDraftRoleSchema = z.object({
  id: z.string().min(1).describe("ASCII 风格角色 id，例如 debt_collector。"),
  name: z.string().describe("角色显示名。"),
  zhiye: z.string().describe("职业或身份。"),
  descr: z.string().describe("角色设定说明。"),
  prompt: z.string().describe("英文角色美术提示词草稿。"),
  xingge: z.string().nullable().describe("重要角色的性格说明；没有时填 null。"),
  important: z.boolean().describe("true 写入重要角色池，false 写入普通角色池。")
})

const structuredDraftItemSchema = z.object({
  id: z.string().min(1).describe("ASCII 风格物品 id，例如 population_flow_report。"),
  name: z.string().describe("物品显示名。"),
  category_id: z.string().min(1).describe("必须引用现有物品分类 id。"),
  descr: z.string().describe("物品说明、用途、来源和剧情价值。"),
  prompt: z.string().describe("英文物品美术提示词草稿；如果复用已有物品可留空字符串。"),
  tags: z.array(z.string()).describe("物品标签；没有时填空数组。"),
  rarity: z.string().describe("稀有度，例如 common、rare、legendary。"),
  stackable: z.boolean().describe("是否可堆叠。"),
  max_stack: z.number().int().min(1).describe("最大堆叠数量。"),
  usable: z.boolean().describe("是否可作为可使用道具。")
})

const structuredDraftPresentationSchema = z.object({
  type: z.enum(["silent", "message", "dialogue"]).describe("事件表现类型：silent 静默执行、message 消息提示、dialogue 对白。"),
  message: z.object({
    content: z.string().describe("消息提示文本；非 message 类型填空字符串。"),
    duration_seconds: z.number().min(0).describe("提示显示秒数；非 message 类型填 0。")
  }).nullable().describe("message 类型必填对象；其他类型填 null。"),
  dialogues: z.array(draftDialogueSchema).describe("dialogue 类型的对白列表；其他类型填空数组。")
})

const structuredPhoneLibraryScopeSchema = z.object({
  role_keys: z.array(z.string()).describe("适用角色 key，例如 important:zhuli；不限角色时填空数组。"),
  contact_tracks: z.array(phoneContactTrackSchema).describe("适用关系轨道；不限轨道时填空数组。"),
  personality_ids: z.array(z.string()).describe("适用性格 id；不限性格时填空数组。"),
  min_favor: z.number().int().min(0).max(100).describe("最低好感度。"),
  max_favor: z.number().int().min(0).max(100).describe("最高好感度。")
})

const structuredPhoneInvokeDelaySchema = z.object({
  unit: z.enum(["hours", "days", "months", "years"]).describe("游戏内延迟单位。"),
  value: z.number().int().min(1).describe("游戏内延迟数值。")
})

const structuredPhoneInvocationSchema = z.object({
  target_type: z.enum(["chain", "pool", "schedule"]).describe("调用事件集合。"),
  event_id: z.string().describe("调用目标事件 id。"),
  delay: structuredPhoneInvokeDelaySchema.nullable().describe("延迟调用；不延迟时填 null。")
})

const structuredPhonePersonalitySchema = z.object({
  id: z.string().min(1).describe("性格 id。"),
  name: z.string().describe("性格名称。"),
  descr: z.string().describe("性格说明。"),
  style_tags: z.array(z.string()).describe("说话风格标签。")
})

const structuredPhoneTalkSchema = z.object({
  id: z.string().min(1).describe("闲聊短句 id。"),
  text: z.string().describe("玩家可选的闲聊短句文本。"),
  tags: z.array(z.string()).describe("短句标签。"),
  scope: structuredPhoneLibraryScopeSchema.describe("适用范围。"),
  base_favor_delta: z.number().int().min(-100).max(100).describe("基础好感变化。"),
  cooldown_hours: z.number().int().min(0).describe("冷却小时数。"),
  invoke: structuredPhoneInvocationSchema.nullable().describe("发送后调用事件；不调用事件时填 null。")
})

const structuredPhoneActionCostItemSchema = z.object({
  item_id: z.string().min(1).describe("消耗物品 id。"),
  quantity: z.number().int().min(1).describe("消耗数量。")
})

const structuredPhoneReplyByTagEntrySchema = z.object({
  tag: z.string().min(1).describe("回复标签 key。"),
  replies: z.array(z.string()).describe("该标签下的回复短句。")
})

const structuredPhoneActionSchema = z.object({
  id: z.string().min(1).describe("动作 id。"),
  label: z.string().describe("动作按钮名称。"),
  text: z.string().describe("主角发出的动作消息文本。"),
  tags: z.array(z.string()).describe("动作标签，例如 gift_basic、date、hotel。"),
  scope: structuredPhoneLibraryScopeSchema.describe("适用范围。"),
  base_favor_delta: z.number().int().min(-100).max(100).describe("基础好感变化。"),
  cooldown_hours: z.number().int().min(0).describe("冷却小时数。"),
  cost_money: z.number().min(0).describe("消耗资金；不消耗填 0。"),
  cost_items: z.array(structuredPhoneActionCostItemSchema).describe("消耗物品；没有时填空数组。"),
  invoke: structuredPhoneInvocationSchema.nullable().describe("动作后调用事件；不调用事件时填 null。")
})

const structuredPhoneReplySchema = z.object({
  id: z.string().min(1).describe("回复库 id。"),
  tags: z.array(z.string()).describe("匹配标签。"),
  scope: structuredPhoneLibraryScopeSchema.describe("适用范围。"),
  replies: z.array(z.string()).describe("NPC 可回复文本。")
})

const structuredPhoneProactiveMessageSchema = z.object({
  id: z.string().min(1).describe("主动消息规则 id。"),
  enabled: z.boolean().describe("是否启用。"),
  trigger_expr: z.string().min(1).describe("触发条件 StoryScript 表达式。"),
  cooldown_hours: z.number().int().min(1).describe("冷却小时数。"),
  favor_delta: z.number().int().min(-100).max(100).describe("发送后好感变化。"),
  messages: z.array(z.string()).describe("NPC 主动发送的消息；至少一条。"),
  reply_quick_message_ids: z.array(z.string()).describe("推荐玩家回复短句 id；没有时填空数组。")
})

const structuredPhoneContactProfileSchema = z.object({
  role_key: z.string().min(1).describe("联系人角色 key，例如 important:zhuli。"),
  enabled: z.boolean().describe("是否启用联系人配置。"),
  auto_add: z.boolean().describe("是否交互后自动加入联系人。"),
  initial_favor: z.number().int().min(0).max(100).describe("初始好感度。"),
  preferred_tags: z.array(z.string()).describe("该联系人偏好的短句/动作标签。"),
  reply_by_tag: z.array(structuredPhoneReplyByTagEntrySchema).describe("按标签定制 NPC 回复；没有时填空数组。"),
  proactive_messages: z.array(structuredPhoneProactiveMessageSchema).describe("主动消息规则；没有填空数组。")
})

const structuredPhoneDraftSchema = z.object({
  personality_library: z.array(structuredPhonePersonalitySchema).describe("建议新增或覆盖的性格定义；没有填空数组。"),
  talk_library: z.array(structuredPhoneTalkSchema).describe("建议新增或覆盖的闲聊短句；没有填空数组。"),
  action_library: z.array(structuredPhoneActionSchema).describe("建议新增或覆盖的联系人动作；没有填空数组。"),
  reply_library: z.array(structuredPhoneReplySchema).describe("建议新增或覆盖的 NPC 回复；没有填空数组。"),
  contact_profiles: z.array(structuredPhoneContactProfileSchema).describe("建议新增或覆盖的联系人特配；没有填空数组。")
})

const structuredPhoneConversationMessageSchema = z.object({
  content: z.string().describe("NPC 发给玩家的消息文本，可使用 ${group.value} 或 ${term.xxx} 占位。")
})

const structuredPhoneConversationOptionSchema = z.object({
  id: z.string().min(1).describe("玩家回复选项 id，同一个剧情手机对话内唯一。"),
  text: z.string().describe("玩家回复文本，可使用 ${group.value} 或 ${term.xxx} 占位。"),
  visible_expr: z.string().describe("该回复选项显示条件 StoryScript；默认显示填空字符串。"),
  script: z.string().describe("选择该回复后执行的 StoryScript；没有填空字符串。非空脚本必须写中文注释。"),
  next_node_id: z.string().describe("回复后进入的下一节点 id；结束节点或无下一步时填空字符串。")
})

const structuredPhoneConversationReminderSchema = z.object({
  enabled: z.boolean().describe("玩家未回复时是否重复发送该节点最后一条 NPC 消息。"),
  interval_minutes: z.number().int().min(1).describe("重复提醒间隔，单位为游戏内分钟，例如 10、30、60。")
})

const structuredPhoneConversationNodeSchema = z.object({
  id: z.string().min(1).describe("剧情手机对话节点 id。"),
  contact_messages: z.array(structuredPhoneConversationMessageSchema).describe("进入该节点时 NPC 连续发出的消息；没有时填空数组。"),
  player_options: z.array(structuredPhoneConversationOptionSchema).describe("该节点可选的玩家回复；结束节点填空数组。"),
  reminder: structuredPhoneConversationReminderSchema.describe("未回复重复提醒设置；不需要提醒时填 {enabled:false, interval_minutes:60}。"),
  end: z.boolean().describe("是否为结束节点。"),
  end_script: z.string().describe("进入结束节点后执行的 StoryScript；没有填空字符串。非空脚本必须写中文注释。"),
  invoke: structuredPhoneInvocationSchema.nullable().describe("结束节点可静默调用后续事件；不调用事件时填 null。")
})

const structuredPhoneConversationDefinitionSchema = z.object({
  id: z.string().min(1).describe("剧情手机对话 id，用于 phone_start_conversation(id)。"),
  title: z.string().describe("剧情手机对话标题。"),
  role_key: z.string().min(1).describe("联系人角色 key，例如 normal:debt_collector。"),
  enabled: z.boolean().describe("是否启用。"),
  once: z.boolean().describe("是否每个存档只允许完成一次。"),
  lock_normal_chat: z.boolean().describe("进行该剧情对话时是否锁定普通闲聊和动作。"),
  trigger_expr: z.string().describe("自动开始条件 StoryScript；如果只由脚本 phone_start_conversation 触发，填空字符串。"),
  entry_node_id: z.string().min(1).describe("入口节点 id，必须引用 nodes 内的节点。"),
  nodes: z.array(structuredPhoneConversationNodeSchema).describe("对话节点列表。")
})

const structuredPhoneConversationsDraftSchema = z.object({
  conversations: z.array(structuredPhoneConversationDefinitionSchema).describe("建议新增或覆盖的连续剧情手机对话；没有填空数组。")
})

const structuredDoingMenuSchema = z.object({
  id: z.string().min(1).describe("行动菜单 id。"),
  title: z.string().min(1).describe("行动菜单显示名。"),
  parent_id: z.string().describe("父菜单 id；根菜单填空字符串。"),
  sort_order: z.number().int().describe("排序值，越小越靠前。"),
  visible_expr: z.string().describe("显示条件 StoryScript；默认显示填空字符串。"),
  descr: z.string().describe("菜单说明。")
})

const structuredDoingDefinitionSchema = z.object({
  id: z.string().min(1).describe("行动 id。"),
  title: z.string().min(1).describe("行动显示名。"),
  menu_id: z.string().min(1).describe("所属行动菜单 id。"),
  descr: z.string().describe("行动说明。"),
  visible_expr: z.string().describe("显示条件 StoryScript；默认显示填空字符串。"),
  cooldown_hours: z.number().int().min(0).describe("执行后冷却小时数。"),
  once: z.boolean().describe("是否一次性行动。"),
  init_script: z.string().describe("进入行动时执行的 StoryScript；没有填空字符串。"),
  object_keys: z.array(z.string()).describe("事件对象引用，例如 player、normal:xxx、important:xxx。"),
  presentation: structuredDraftPresentationSchema.describe("行动事件表现。"),
  location: z.string().describe("地点 id；没有填空字符串。"),
  bgm: z.string().describe("背景音乐；没有填空字符串。"),
  end_script: z.string().describe("行动结束时执行的 StoryScript；没有填空字符串。")
})

const structuredDoingDraftSchema = z.object({
  menus: z.array(structuredDoingMenuSchema).describe("建议新增或覆盖的行动菜单；没有填空数组。"),
  doings: z.array(structuredDoingDefinitionSchema).describe("建议新增或覆盖的行动事件；没有填空数组。")
})

const structuredShopCategorySchema = z.object({
  id: z.string().min(1).describe("商城分类 id。"),
  name: z.string().min(1).describe("商城分类显示名。"),
  sort_order: z.number().int().describe("排序值，越小越靠前。"),
  visible_expr: z.string().describe("分类显示条件 StoryScript；默认显示填空字符串。"),
  descr: z.string().describe("分类说明。")
})

const structuredShopProductSchema = z.object({
  id: z.string().min(1).describe("商城商品 id。"),
  category_id: z.string().min(1).describe("所属商城分类 id，必须引用现有或本次 shop.categories。"),
  item_id: z.string().min(1).describe("售卖的物品 id，必须引用现有物品或本次 draft.items 中的物品。"),
  price: z.number().min(0).describe("商品价格。"),
  quantity: z.number().int().min(1).describe("每次购买加入背包的数量。"),
  sort_order: z.number().int().describe("排序值，越小越靠前。"),
  enabled: z.boolean().describe("是否启用商品。"),
  available_expr: z.string().describe("购买条件 StoryScript；条件不满足时商品灰色显示，默认可买填空字符串。"),
  unavailable_reason: z.string().describe("不可购买时显示原因；没有填空字符串。"),
  allow_gift: z.boolean().describe("是否允许从背包送给手机联系人。"),
  gift_favor_delta: z.number().int().min(-100).max(100).describe("送礼给联系人时增加的好感度。"),
  purchase_cooldown_hours: z.number().int().min(0).describe("购买冷却小时数；没有冷却填 0。"),
  gift_cooldown_hours: z.number().int().min(0).describe("送礼冷却小时数；没有冷却填 0。")
})

const structuredShopDraftSchema = z.object({
  categories: z.array(structuredShopCategorySchema).describe("建议新增或覆盖的商城分类；没有填空数组。"),
  products: z.array(structuredShopProductSchema).describe("建议新增或覆盖的商城商品；没有填空数组。")
})

const structuredDraftEventSchema = z.object({
  collectionType: z.enum(["chain", "pool", "schedule"]).describe("目标事件集合。"),
  id: z.string().min(1).describe("ASCII 风格事件 id。"),
  title: z.string().min(1).describe("事件标题。"),
  trigger_mode: z.enum(["default", "condition", "invoke"]).describe("事件触发方式。"),
  trigger_expr: z.string().describe("condition 事件需要 StoryScript 条件表达式；其他模式留空。"),
  invoke_params: z.array(structuredDraftInvokeParamSchema).describe("invoke 事件的调用参数；没有时填空数组。"),
  object_keys: z.array(z.string()).describe("事件对象引用，例如 player、normal:xxx、important:xxx。"),
  location: z.string().describe("地点 id，可为空。"),
  presentation: structuredDraftPresentationSchema.describe("事件表现：silent 静默执行、message 消息提示、dialogue 对白。"),
  init_script: z.string().describe("事件进入时 StoryScript；不确定时留空。"),
  end_script: z.string().describe("事件结束时 StoryScript；不确定时留空。"),
  next: z.array(z.string()).describe("chain 事件的后续事件 id；pool/schedule 使用空数组。"),
  bgm: z.string().nullable().describe("pool/schedule 事件可用 bgm；没有时填 null。"),
  loop: structuredDraftLoopRuleSchema.nullable().describe("schedule 事件的定时规则；非 schedule 事件填 null。")
})

const structuredDraftLocationSchema = draftLocationSchema

const structuredDraftSchema = z.object({
  title: z.string().min(1).describe("这批生成内容的标题。"),
  summary: z.string().describe("这批内容如何服务可玩网文体验。"),
  arc: z.string().describe("所属篇章或小剧情线。"),
  locations: z.array(structuredDraftLocationSchema).describe("建议新增或复用的地点。"),
  roles: z.array(structuredDraftRoleSchema).describe("建议新增或复用的角色。"),
  items: z.array(structuredDraftItemSchema).describe("建议新增或复用的物品；没有物品时填空数组。"),
  events: z.array(structuredDraftEventSchema).describe("建议新增的剧情事件草稿。"),
  variables: z.array(structuredDraftVariableSchema).describe("建议新增变量草稿，只写入 vals.json5，不写 system_vals.json5。"),
  phone: structuredPhoneDraftSchema.describe("建议新增或覆盖的手机联系人资产；没有时所有数组填空。"),
  phoneConversations: structuredPhoneConversationsDraftSchema.describe("建议新增或覆盖的连续剧情手机对话；没有时 conversations 填空数组。"),
  doing: structuredDoingDraftSchema.describe("建议新增或覆盖的玩家主动行动资产；没有时所有数组填空。"),
  shop: structuredShopDraftSchema.describe("建议新增或覆盖的商城资产；没有时所有数组填空。"),
  notes: z.array(z.string()).describe("给编辑器作者的落地说明。"),
  warnings: z.array(z.string()).describe("风险、待人工确认点和不确定项。")
})

type StructuredCreationDraft = z.infer<typeof structuredDraftSchema>
type StructuredCreationDraftLoopRule = z.infer<typeof structuredDraftLoopRuleSchema>
type StructuredCreationDraftPresentation = z.infer<typeof structuredDraftPresentationSchema>
type StructuredCreationPhoneDraft = z.infer<typeof structuredPhoneDraftSchema>
type StructuredCreationPhoneConversationsDraft = z.infer<typeof structuredPhoneConversationsDraftSchema>
type StructuredCreationDoingDraft = z.infer<typeof structuredDoingDraftSchema>
type StructuredCreationShopDraft = z.infer<typeof structuredShopDraftSchema>

const generatedDialogueSchema = z.object({
  summary: z.string().describe("对白生成简述。"),
  dialogues: z.array(draftDialogueSchema).describe("对白列表。"),
  warnings: z.array(z.string()).describe("风险、待确认点和需要人工调整的内容。")
})

type GeneratedDialogueOutput = z.infer<typeof generatedDialogueSchema>

const chiefEditorOutputSchema = z.object({
  log: z.string(),
  creativeBrief: z.string(),
  goals: z.array(z.string()),
  risks: z.array(z.string())
})

const plotPlannerOutputSchema = z.object({
  log: z.string(),
  arc: z.string(),
  beats: z.array(z.string()),
  choices: z.array(z.string()),
  pacingNotes: z.array(z.string())
})

const assetDesignerOutputSchema = z.object({
  log: z.string(),
  locations: z.array(structuredDraftLocationSchema),
  roles: z.array(structuredDraftRoleSchema),
  items: z.array(structuredDraftItemSchema),
  notes: z.array(z.string())
})

const eventWriterOutputSchema = z.object({
  log: z.string(),
  draft: structuredDraftSchema
})

const scriptDoctorOutputSchema = z.object({
  log: z.string(),
  draft: structuredDraftSchema,
  issues: z.array(z.string())
})

const consistencyCheckerOutputSchema = z.object({
  log: z.string(),
  draft: structuredDraftSchema,
  warnings: z.array(z.string())
})

const CreationState = Annotation.Root({
  storyTitle: Annotation<string>(),
  instruction: Annotation<string>(),
  storyContext: Annotation<string>(),
  baseDraft: Annotation<StoryCreationDraft | null>(),
  creativeBrief: Annotation<string>(),
  plotPlan: Annotation<string>(),
  assetPlan: Annotation<string>(),
  draft: Annotation<StoryCreationDraft | null>(),
  logs: Annotation<StoryCreationAgentLog[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  })
})

type CreationStateValue = typeof CreationState.State

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim()

  if (!trimmed) {
    return ""
  }

  let url: URL

  try {
    url = new URL(trimmed)
  } catch {
    throw new FileStoreError("Agent model baseUrl is invalid.", 400, "ai.agent-base-url-invalid")
  }

  const pathname = url.pathname.replace(/\/+$/, "")
  url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`

  return url.toString().replace(/\/+$/, "")
}

function requireAgentSettings(settings: AppSettingsFile): RequiredAgentSettings {
  const agent = settings.ai.agent

  if (!agent.baseUrl.trim()) {
    throw new FileStoreError("Agent model baseUrl is required.", 400, "ai.agent-base-url-required")
  }

  if (!agent.apiKey.trim()) {
    throw new FileStoreError("Agent model apiKey is required.", 400, "ai.agent-api-key-required")
  }

  return {
    ...agent,
    apiKey: agent.apiKey.trim(),
    baseUrl: normalizeBaseUrl(agent.baseUrl),
    temperature: Math.max(0, Math.min(2, agent.temperature))
  }
}

function resolveRoleModel(agent: RequiredAgentSettings, modelKey: AgentModelKey) {
  const preferredModel = agent[modelKey].trim()

  if (preferredModel) {
    return preferredModel
  }

  const fallbackModel = ROLE_MODEL_KEYS
    .map((key) => agent[key].trim())
    .find((model) => model.length > 0)

  if (!fallbackModel) {
    throw new FileStoreError("Agent model name is required.", 400, "ai.agent-model-required")
  }

  return fallbackModel
}

function createChatModel(agent: RequiredAgentSettings, modelKey: AgentModelKey) {
  return new ChatOpenAI({
    apiKey: agent.apiKey,
    configuration: {
      baseURL: agent.baseUrl
    },
    maxRetries: 2,
    model: resolveRoleModel(agent, modelKey),
    temperature: agent.temperature,
    timeout: 10 * 60 * 1000
  })
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text
  }

  return `${text.slice(0, maxChars).trimEnd()}\n...`
}

function formatJson(value: unknown, maxChars: number) {
  return truncateText(JSON.stringify(value, null, 2), maxChars)
}

function getErrorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isStructuredOutputParsingError(error: unknown) {
  const detail = getErrorDetail(error)

  if (/Invalid schema|response_format|Zod field|required is required|MODEL_RATE_LIMIT|429|401|403/i.test(detail)) {
    return false
  }

  return /OUTPUT_PARSING_FAILURE|OutputParserException|Failed to parse|Could not parse|parse/i.test(detail)
}

function toAgentVisiblePhoneDraft(phone: StoryCreationDraftPhone | undefined) {
  const nextPhone = phone ?? emptyDraftPhone

  return {
    ...nextPhone,
    contact_profiles: nextPhone.contact_profiles.map((profile) => ({
      ...profile,
      reply_by_tag: Object.entries(profile.reply_by_tag ?? {})
        .map(([tag, replies]) => ({
          tag,
          replies
        }))
        .filter((entry) => entry.tag.trim() && entry.replies.length > 0)
    }))
  }
}

function toAgentVisibleDraft(draft: StoryCreationDraft) {
  return {
    ...draft,
    roles: draft.roles.map((role) => ({
      ...role,
      xingge: role.xingge ?? null
    })),
    phone: toAgentVisiblePhoneDraft(draft.phone),
    phoneConversations: draft.phoneConversations ?? emptyDraftPhoneConversations,
    doing: draft.doing ?? emptyDraftDoing,
    shop: draft.shop ?? emptyDraftShop
  }
}

function formatDraftForAgent(draft: StoryCreationDraft, maxChars: number) {
  return formatJson(toAgentVisibleDraft(draft), maxChars)
}

function formatStoryBible(story: StoryDocument) {
  const bible = story.storyBible
  return [
    `故事背景: ${bible.background}`,
    `金手指: ${bible.golden_finger}`,
    `主角设定: ${bible.protagonist}`,
    `世界规则: ${bible.world_rules}`,
    `故事大纲: ${bible.outline}`,
    `当前篇章: ${bible.current_arc}`,
    `玩法设计: ${bible.gameplay_design}`,
    `文风口味: ${bible.style_guide}`,
    `约束禁忌: ${bible.constraints}`
  ].join("\n")
}

function formatVariables(story: StoryDocument) {
  return formatJson({
    global: story.vals.variables,
    playerOverride: story.playerOverrideVals.entries,
    system: story.systemVals.variables
  }, 9000)
}

function formatValuePreview(value: unknown) {
  if (value === undefined) {
    return ""
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

const COMMON_ITEM_SEARCH_TERMS = new Set([
  "一个",
  "不会",
  "之前",
  "之后",
  "什么",
  "他们",
  "任务",
  "优化",
  "修改",
  "全部",
  "可以",
  "反馈",
  "已有",
  "当前",
  "我们",
  "故事",
  "新增",
  "方式",
  "是否",
  "玩家",
  "生成",
  "用户",
  "角色",
  "规则",
  "设置",
  "这个",
  "进行",
  "选择",
  "通过",
  "需要",
  "剧情",
  "地点",
  "物品",
  "事件",
  "agent",
  "and",
  "for",
  "the",
  "with"
])

function appendSearchTerm(terms: Set<string>, rawTerm: string) {
  const term = rawTerm.trim().toLowerCase()

  if (term.length < 2 || COMMON_ITEM_SEARCH_TERMS.has(term)) {
    return
  }

  terms.add(term)
}

function collectSearchTerms(rawText: string) {
  const terms = new Set<string>()
  const normalizedText = rawText.toLowerCase()
  const matches = normalizedText.match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []

  for (const match of matches) {
    appendSearchTerm(terms, match)

    if (/^[\u4e00-\u9fff]+$/.test(match)) {
      for (const size of [2, 3, 4]) {
        for (let index = 0; index <= match.length - size; index += 1) {
          appendSearchTerm(terms, match.slice(index, index + size))
        }
      }
    }

    if (terms.size >= MAX_ITEM_SEARCH_TERMS) {
      break
    }
  }

  return terms
}

function buildVariableSearchCorpus(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  const bible = story.storyBible
  return [
    instruction,
    story.story.title,
    story.story.description ?? "",
    ...(story.story.tags ?? []),
    bible.background,
    bible.golden_finger,
    bible.protagonist,
    bible.world_rules,
    bible.outline,
    bible.current_arc,
    bible.gameplay_design,
    bible.style_guide,
    bible.constraints,
    baseDraft ? formatDraftForAgent(baseDraft, 8000) : ""
  ].join("\n")
}

function buildVariableSearchText(
  sourceLabel: string,
  group: StoryValDefinition,
  entry: StoryValEntryDefinition
) {
  return [
    sourceLabel,
    group.name,
    group.description ?? "",
    entry.name,
    entry.description ?? "",
    entry.value_type,
    entry.calc_rule,
    formatValuePreview(entry.value)
  ].join("\n").toLowerCase()
}

function scoreRelevantVariable(
  sourceLabel: string,
  group: StoryValDefinition,
  entry: StoryValEntryDefinition,
  terms: Set<string>
) {
  if (terms.size === 0) {
    return 0
  }

  const fullKey = `${sourceLabel}.${group.name}.${entry.name}`.toLowerCase()
  const shortKey = `${group.name}.${entry.name}`.toLowerCase()
  const groupName = group.name.toLowerCase()
  const groupDescription = (group.description ?? "").toLowerCase()
  const entryName = entry.name.toLowerCase()
  const entryDescription = (entry.description ?? "").toLowerCase()
  const calcRule = entry.calc_rule.toLowerCase()
  const valuePreview = formatValuePreview(entry.value).toLowerCase()
  const searchText = buildVariableSearchText(sourceLabel, group, entry)
  let score = 0

  for (const term of terms) {
    if (fullKey === term || shortKey === term || entryName === term) {
      score += 50
      continue
    }

    if (groupName === term || groupDescription === term) {
      score += 18
      continue
    }

    if (entryDescription === term) {
      score += 16
      continue
    }

    if (calcRule.includes(term)) {
      score += term.length >= 4 ? 8 : 4
      continue
    }

    if (valuePreview.includes(term)) {
      score += term.length >= 4 ? 8 : 4
      continue
    }

    if (fullKey.includes(term) || shortKey.includes(term) || entryName.includes(term)) {
      score += term.length >= 4 ? 12 : 7
      continue
    }

    if (searchText.includes(term)) {
      score += term.length >= 4 ? 5 : 2
    }
  }

  return score
}

function selectRelevantVariableDetails(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  const terms = collectSearchTerms(buildVariableSearchCorpus(story, instruction, baseDraft))
  const searchableVariables = [
    ...story.vals.variables.flatMap((group, groupIndex) =>
      group.vals.map((entry, entryIndex) => ({
        source: "global" as const,
        group,
        groupIndex,
        entry,
        entryIndex
      }))
    ),
    ...story.systemVals.variables.flatMap((group, groupIndex) =>
      group.vals.map((entry, entryIndex) => ({
        source: "system" as const,
        group,
        groupIndex,
        entry,
        entryIndex
      }))
    )
  ]

  return searchableVariables
    .map((item) => ({
      ...item,
      score: scoreRelevantVariable(item.source, item.group, item.entry, terms)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      const sourceOrder = left.source === right.source
        ? 0
        : left.source === "global"
          ? -1
          : 1

      return right.score - left.score
        || sourceOrder
        || left.groupIndex - right.groupIndex
        || left.entryIndex - right.entryIndex
    })
    .slice(0, RELEVANT_VARIABLE_DETAIL_LIMIT)
    .map(({ source, group, entry, score }) => ({
      source,
      group: group.name,
      group_description: group.description ?? "",
      key: `${source}.${group.name}.${entry.name}`,
      name: entry.name,
      description: entry.description ?? "",
      value_type: entry.value_type,
      write_permission: getVariableWritePermission(source, entry),
      value: entry.value ?? null,
      calc_rule: entry.calc_rule,
      relevance_score: score
    }))
}

function getVariableWritePermission(
  sourceLabel: string,
  entry: Pick<StoryValEntryDefinition, "value_type">
) {
  if (sourceLabel === "system") {
    return "read_only: system"
  }

  if (entry.value_type === "calc") {
    return "read_only: calc"
  }

  return "writable: value"
}

function formatVariableIndexSection(sourceLabel: string, groups: StoryValDefinition[]) {
  if (groups.length === 0) {
    return `${sourceLabel}: (empty)`
  }

  const lines: string[] = [`${sourceLabel}:`]

  for (const group of groups) {
    for (const entry of group.vals) {
      const preview = entry.value_type === "calc"
        ? truncateText(entry.calc_rule, 120)
        : truncateText(formatValuePreview(entry.value), 120)

      lines.push([
        `${group.name}.${entry.name}`,
        entry.description ?? "",
        entry.value_type,
        getVariableWritePermission(sourceLabel, entry),
        preview || "-"
      ].join(" | "))
    }
  }

  return lines.join("\n")
}

function formatVariableIndex(story: StoryDocument) {
  return [
    formatVariableIndexSection("global", story.vals.variables),
    "",
    formatVariableIndexSection("system", story.systemVals.variables)
  ].join("\n")
}

function formatExistingVariables(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  return [
    formatVariables(story),
    "",
    "variableIndexAll: all existing variables, compact format `group.name | description | value_type | write_permission | value/calc_rule`. Global and system variables are the first place to look before creating new ones.",
    formatVariableIndex(story),
    "",
    "StoryScript write rules: global value variables are writable in init_script/end_script/action.exec_script; global calc variables are read-only derived rules; system.* and call.* are read-only. If a calc aggregate must change, write one or more writable value variables used by its calc_rule.",
    "",
    `relevantVariableDetails: top ${RELEVANT_VARIABLE_DETAIL_LIMIT} local keyword matches with richer fields. Empty does not mean the variable library is empty; use variableIndexAll for full existence checks.`,
    formatJson(selectRelevantVariableDetails(story, instruction, baseDraft), 14000)
  ].join("\n")
}

function buildItemSearchCorpus(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  const bible = story.storyBible
  return [
    instruction,
    story.story.title,
    story.story.description ?? "",
    ...(story.story.tags ?? []),
    bible.background,
    bible.golden_finger,
    bible.protagonist,
    bible.world_rules,
    bible.outline,
    bible.current_arc,
    bible.gameplay_design,
    bible.style_guide,
    bible.constraints,
    baseDraft ? formatDraftForAgent(baseDraft, 8000) : ""
  ].join("\n")
}

function buildItemSearchText(
  item: StoryItemDefinition,
  categoryById: Map<string, { name: string; descr: string }>
) {
  const category = categoryById.get(item.category_id)
  return [
    item.id,
    item.name,
    item.category_id,
    category?.name ?? "",
    category?.descr ?? "",
    item.descr,
    item.prompt,
    item.rarity,
    item.tags.join(" ")
  ].join("\n").toLowerCase()
}

function scoreRelevantItem(
  item: StoryItemDefinition,
  categoryById: Map<string, { name: string; descr: string }>,
  terms: Set<string>
) {
  if (terms.size === 0) {
    return 0
  }

  const itemId = item.id.toLowerCase()
  const itemName = item.name.toLowerCase()
  const categoryId = item.category_id.toLowerCase()
  const categoryName = categoryById.get(item.category_id)?.name.toLowerCase() ?? ""
  const tags = item.tags.map((tag) => tag.toLowerCase())
  const searchText = buildItemSearchText(item, categoryById)
  let score = 0

  for (const term of terms) {
    if (itemId === term || itemName === term) {
      score += 50
      continue
    }

    if (categoryId === term || categoryName === term) {
      score += 18
      continue
    }

    if (tags.includes(term)) {
      score += 16
      continue
    }

    if (itemId.includes(term) || itemName.includes(term)) {
      score += term.length >= 4 ? 12 : 7
      continue
    }

    if (searchText.includes(term)) {
      score += term.length >= 4 ? 5 : 2
    }
  }

  return score
}

function selectRelevantItemDetails(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  const categoryById = new Map(
    story.items.categories.map((category) => [
      category.id,
      {
        descr: category.descr,
        name: category.name
      }
    ])
  )
  const terms = collectSearchTerms(buildItemSearchCorpus(story, instruction, baseDraft))

  return story.items.items
    .map((item, index) => ({
      index,
      item,
      score: scoreRelevantItem(item, categoryById, terms)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, RELEVANT_ITEM_DETAIL_LIMIT)
    .map(({ item, score }) => ({
      id: item.id,
      name: item.name,
      category_id: item.category_id,
      descr: item.descr,
      prompt: item.prompt,
      tags: item.tags,
      rarity: item.rarity,
      stackable: item.stackable,
      max_stack: item.max_stack,
      usable: item.usable,
      relevance_score: score
    }))
}

function formatItemIndex(story: StoryDocument) {
  if (story.items.items.length === 0) {
    return "(empty)"
  }

  return story.items.items
    .map((item) => {
      const flags = [
        item.stackable ? "stackable" : "",
        item.usable ? "usable" : ""
      ].filter(Boolean).join(",")

      return [
        item.id,
        item.name,
        item.category_id,
        item.tags.join(","),
        item.rarity,
        flags || "-"
      ].join(" | ")
    })
    .join("\n")
}

function formatExistingAssets(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  return [
    formatJson({
      locations: story.eventLocations.assignments.map((location) => ({
        id: location.id,
        descr: location.descr
      })),
      normalRoles: story.roles.normal.roles.map((role) => ({
        id: role.id,
        name: role.name,
        zhiye: role.zhiye,
        descr: role.descr
      })),
      importantRoles: story.roles.important.roles.map((role) => ({
        id: role.id,
        name: role.name,
        zhiye: role.zhiye,
        descr: role.descr,
        xingge: role.xingge
      })),
      scenes: story.scenes.scenes.map((scene) => ({
        level: scene.level,
        description: scene.description
      })),
      itemCategories: story.items.categories.map((category) => ({
        id: category.id,
        name: category.name,
        descr: category.descr
      }))
    }, 9000),
    "",
    "itemIndexAll: all existing items, compact format `id | name | category_id | tags | rarity | flags`.",
    formatItemIndex(story),
    "",
    `relevantItemDetails: top ${RELEVANT_ITEM_DETAIL_LIMIT} local keyword matches with richer fields. Empty does not mean the item library is empty; use itemIndexAll for full existence checks.`,
    formatJson(selectRelevantItemDetails(story, instruction, baseDraft), 14000)
  ].join("\n")
}

function formatExistingEvents(story: StoryDocument) {
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
  }, 12000)
}

function formatExistingPhoneAndDoing(story: StoryDocument) {
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
  }, 16000)
}

function buildStoryContext(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  return [
    `故事: ${story.story.title} (${story.story.id})`,
    `简介: ${story.story.description ?? ""}`,
    `标签: ${(story.story.tags ?? []).join(", ")}`,
    "",
    "【创作设定】",
    formatStoryBible(story),
    "",
    "【现有变量】",
    formatExistingVariables(story, instruction, baseDraft),
    "",
    "【现有地点/角色/场景/物品】",
    formatExistingAssets(story, instruction, baseDraft),
    "",
    "【现有称谓库/手机联系人/行动/商城资产】",
    formatExistingPhoneAndDoing(story),
    "",
    "【现有事件简表】",
    formatExistingEvents(story)
  ].join("\n")
}

function buildBasePrompt(roleTitle: string, state: CreationStateValue) {
  const lines = [
    `你是 Story Manager 的${roleTitle} Agent。`,
    "项目目标：把网络小说变成玩家可以代入主角、可以选择、可以演进的开放游戏。",
    "你不是单纯写小说；你的输出必须服务结构化游戏内容生产。",
    "当前运行在后台编辑器创作阶段，不能直接假设玩家已经做出未来选择。",
    "必须保留玩家选择空间，避免把所有后果写死成单线小说。",
    "事件必须贴近项目数据格式：chain 是链式剧情线，pool 是平面一次性事件池，schedule 是定时规则事件。",
    "chain/pool/schedule 中 trigger_mode 为 invoke 的事件只供脚本调用，不参与普通调度。",
    "角色引用使用 player、normal:<roleId>、important:<roleId>。",
    "涉及玩家性别差异的称呼、自称和代词时，必须优先使用 refer.json5 称谓库占位符，例如 `${term.player.respect}`、`${term.player.self_proud}`；不要硬编码先生/女士/少爷/小姐。",
    "生成对白、消息提示、手机短句、NPC 主动消息、phone_send_from_contact/phone_send_to_contact 文本时，都可以使用 `${term.xxx}`。称谓库只读，不要把 term.* 当作普通变量写入。",
    "地点使用地点 id。所有 id 尽量使用 ASCII 小写、数字、下划线或短横线。",
    "变量必须优先复用现有变量；判断变量是否已存在时必须先查 variableIndexAll 全量轻量索引；relevantVariableDetails 只提供本次更相关变量的详细字段，不代表完整变量库。",
    "现有变量里的 calc 变量就是现成规则资产，尤其是教育、就业、医疗、治安、基础建设等指数；不要默认不存在，也不要为了表达方便新造同义变量。",
    "StoryScript 过程脚本允许直接写回普通全局 value 变量，例如 `${player.money} += 100`、`${county.renkou_young} = Math.max(0, ${county.renkou_young} + delta)`。",
    "StoryScript 禁止写 calc、system.*、call.*：calc 是只读派生值；如果要改变 calc 汇总值，必须写它 calc_rule 依赖的普通 value 分项，或在 variables 草稿中新增普通 value 变量作为持久化字段。",
    "不要声称脚本接口缺少安全写回能力；当前引擎支持在 init_script、end_script、action.exec_script 中写普通 value 变量。",
    "StoryScript 过程脚本必须严格遵循 StoryScript.md 的当前规范；语句、变量权限、注释、invoke_once、背包函数都以 StoryScript.md 为唯一来源。不要使用文档未定义的语法；如果需要新能力，先升级规范文档和运行时，再生成脚本。",
    "invoke_once 已支持 delay_hours、delay_days、delay_months、delay_years 这 4 个延迟调度元参数；它们只影响调度，不会进入目标事件的 ${call.xxx} 参数空间，也不能和多个 delay 字段混用。",
    "invoke_once 是 StoryScript 保留语句，不是 JS/TS 函数调用；只能写 `invoke_once chain event_id delay_days=1 param=${group.name}`，禁止写 `invoke_once(\"chain\", \"event_id\", { delay_days: 1 })` 或 `delay_days: 1`。",
    "trigger_mode=invoke 的目标事件可以没有 invoke_params；当目标事件不需要 ${call.xxx} 参数时，invoke_params 必须填空数组，不要改成 default，也不要虚构无用参数。",
    "生成非空 StoryScript 过程脚本时必须写清楚中文注释：说明读取了哪些变量、计算规则为什么这样设计、最终写回哪些 value 变量。复杂脚本要分段注释，避免只有公式没有解释。",
    "物品必须优先复用现有物品 id；确需新增时输出 items 草稿，category_id 必须来自现有物品分类。",
    "判断物品是否已存在时必须先查 itemIndexAll 全量轻量索引；relevantItemDetails 只提供本次更相关物品的详细字段，不代表完整物品库。",
    "物品获得、消耗和检查必须走 StoryScript 背包函数，不要编造 reward/items/consume 等未知事件字段。",
    "背包函数：bag_add(\"player\", \"item_id\", 1) 添加物品；bag_remove(\"player\", \"item_id\", 1) 扣除物品并返回 boolean；bag_count(\"player\", \"item_id\") 返回数量；bag_has(\"player\", \"item_id\", 1) 检查数量。",
    "背包函数里的 item_id 必须来自现有物品或本次 items 草稿；如果新增物品，事件脚本必须引用该新增物品 id。",
    "手机联系人资产写入 phone 草稿：新增/调整联系人短句、动作、回复、联系人特配、主动消息规则时输出 phone，不要只在 notes 里描述。事件脚本只用于运行时行为，例如 phone_add_contact、phone_send_from_contact、phone_add_favor。",
    "手机联系人普通“说话/闲聊”必须写入 phone.talk_library；player_quick_messages 只作为 NPC 主动消息的推荐回复库使用，不要把泛用闲聊短句当成全局快捷消息。",
    "proactive_messages[].reply_quick_message_ids 可以引用 phone.talk_library 的短句 id，也可以引用已有 player_quick_messages 的专用回复 id；主动消息涉及具体剧情时，必须推荐语境匹配的回复，不要推荐无关泛用社交短句。",
    "phone.talk_library/action_library 的 invoke 只会在玩家通过手机 UI 选择对应短句或动作时触发；StoryScript 里的 phone_send_to_contact/phone_send_from_contact 只是直接写入消息，不会自动匹配短句库并触发 invoke。剧情脚本需要延迟调度事件时，直接使用 invoke_once 保留语句。",
    "行动资产写入 doing 草稿：玩家可主动选择的玩法入口必须输出 doing 菜单/行动。doing 行动不配置 trigger_mode、trigger_expr、invoke_params；显示条件写 visible_expr，触发只来自菜单选择。",
    "商城资产写入 shop 草稿：新增或调整商城分类、商品货架时输出 shop.categories/shop.products，不要只在 notes 里描述。商城不能创建物品资产，只能引用现有 item id 或本次 draft.items 里同时生成的 item id。",
    "商城商品的 category_id 必须引用现有 shop 分类或本次 shop.categories；item_id 必须引用现有物品或本次 draft.items。商品购买条件写 available_expr，分类显示条件写 visible_expr。",
    "商城相关脚本可使用 shop_can_buy、shop_purchase_cooldown_left、shop_gift_cooldown_left、shop_buy、shop_gift；商品 id 必须来自现有 shop.products 或本次 draft.shop.products。",
    "如果手机消息或剧情会临时开放一个玩家主动入口，应同时生成 doing 草稿，并在事件脚本或手机相关事件中使用 doing_unlock(\"doing_id\")。",
    "schedule 事件的 loop 必须包含 at、priority、after、before：at 用 HH:mm；同一时间点内 priority 数字越小越先执行；如果事件依赖另一个定时事件结果，必须把前置事件 id 写入 after。",
    "schedule priority 建议：结算/统计类 10-49，发放/奖励类 50-99，展示/日报/提示类 100+。例如每日发钱依赖每日人口结算时，发钱事件 after 应包含人口结算事件 id。",
    "只有在新增脚本且 StoryScript.md 明确不支持所需能力时才允许留空；如果当前待优化草稿里已有非空脚本，除非用户明确要求删除，否则必须保留并按规范修正。",
    "",
    `故事标题: ${state.storyTitle}`,
    `用户创作指令:\n${state.instruction}`,
    "",
    `项目上下文:\n${state.storyContext}`
  ]

  if (state.baseDraft) {
    lines.push(
      "",
      "【当前待优化草稿】",
      formatDraftForAgent(state.baseDraft, 18000),
      "",
      "当前任务是基于用户反馈修订这份草稿。输出必须是完整修订版，不是增量补丁。除非反馈要求重做，否则尽量保留已有 id、变量 key、角色 key、事件引用，以及已有非空脚本。不要因为保守或不确定就把脚本清空。"
    )
  }

  return lines.join("\n")
}

function normalizeDialogueGenerationCollectionType(
  collectionType: StoryEventCollectionType
): "chain" | "pool" | "schedule" {
  if (collectionType === "pool" || collectionType === "schedule" || collectionType === "chain") {
    return collectionType
  }

  if (collectionType === "once") {
    return "pool"
  }

  if (collectionType === "loop") {
    return "schedule"
  }

  return "chain"
}

function normalizeDialogueSpeakerKey(
  roles: StoryRolesFile,
  dialogue: StoryOnceDialogueDefinition
) {
  if (dialogue.speaker_type === "player") {
    return "player"
  }

  return findStoryRoleReference(roles, dialogue.speaker_key)?.key ?? dialogue.speaker_key.trim()
}

function summarizeDialoguePresentation(dialogues: StoryOnceDialogueDefinition[]) {
  if (dialogues.length === 0) {
    return "当前还没有对白。"
  }

  return dialogues
    .slice(0, 10)
    .map((dialogue, index) => {
      const speaker =
        dialogue.speaker_type === "player"
          ? "player"
          : dialogue.speaker_key

      return `${index + 1}. [${speaker}] ${dialogue.content}`
    })
    .join("\n")
}

function summarizeEventForDialogueGeneration(
  story: StoryDocument,
  collectionType: "chain" | "pool" | "schedule",
  event: GenerateStoryDialogueRequest["event"]
) {
  const locationDescr = event.location.trim()
    ? story.eventLocations.assignments.find((item) => item.id === event.location.trim())?.descr ?? ""
    : ""
  const roleSummaries = event.object_keys.map((roleKey) => {
    if (roleKey === "player") {
      return "player: 主角"
    }

    const roleReference = findStoryRoleReference(story.roles, roleKey)
    if (!roleReference) {
      return `${roleKey}: 未找到角色资料`
    }

    const sourceRoles = roleReference.scope === "important"
      ? story.roles.important.roles
      : story.roles.normal.roles
    const role = sourceRoles.find((item) => item.id === roleReference.id)

    if (!role) {
      return `${roleReference.key}: 未找到角色资料`
    }

    const details = [
      role.name?.trim() || role.id,
      role.zhiye?.trim() || "",
      role.descr?.trim() || ""
    ].filter(Boolean)

    return `${roleReference.key}: ${details.join(" | ")}`
  })
  const triggerMode = event.trigger_mode ?? "default"
  const existingDialogues =
    event.presentation.type === "dialogue"
      ? event.presentation.dialogues.map((dialogue) => ({
          ...dialogue,
          speaker_key: normalizeDialogueSpeakerKey(story.roles, dialogue)
        }))
      : []
  const scheduleSummary =
    collectionType === "schedule" && "loop" in event
      ? formatJson(event.loop, 1200)
      : ""
  const nextSummary =
    collectionType === "chain" && "next" in event
      ? formatJson(event.next, 1200)
      : ""

  return [
    `事件集合: ${collectionType}`,
    `事件 ID: ${event.id}`,
    `标题: ${event.title}`,
    `触发方式: ${triggerMode}`,
    `地点: ${event.location || "(无)"}`,
    locationDescr ? `地点说明: ${locationDescr}` : "",
    `对象角色: ${roleSummaries.length ? roleSummaries.join("\n") : "(无)"}`,
    `初始化脚本: ${event.init_script || "(空)"}`,
    `结束脚本: ${event.end_script || "(空)"}`,
    triggerMode === "condition" ? `触发条件: ${event.trigger_expr || "(空)"}` : "",
    triggerMode === "invoke" ? `调用参数: ${formatJson(event.invoke_params ?? [], 1200)}` : "",
    scheduleSummary ? `定时规则:\n${scheduleSummary}` : "",
    nextSummary ? `后续节点: ${nextSummary}` : "",
    `当前表现类型: ${event.presentation.type}`,
    `当前对白预览:\n${summarizeDialoguePresentation(existingDialogues)}`
  ]
    .filter(Boolean)
    .join("\n")
}

async function invokeStructured<T extends Record<string, unknown>>(
  role: StoryCreationAgentRole,
  llm: ChatOpenAI,
  schema: z.ZodType<T>,
  prompt: string,
  signal?: AbortSignal
) {
  const structuredLlm = llm.withStructuredOutput<T>(schema, {
    name: `${role}Output`
  })

  let parseFailureDetail = ""

  for (let attempt = 1; attempt <= STRUCTURED_OUTPUT_PARSE_RETRY_ATTEMPTS; attempt += 1) {
    const nextPrompt = attempt === 1
      ? prompt
      : [
          prompt,
          "",
          STRUCTURED_OUTPUT_PARSE_RETRY_PROMPT,
          parseFailureDetail ? `上一次解析错误:\n${parseFailureDetail}` : ""
        ].filter(Boolean).join("\n\n")

    try {
      return await structuredLlm.invoke(nextPrompt, signal ? { signal } : undefined)
    } catch (error) {
      if (isAbortError(error)) {
        throw new FileStoreError(
          `${ROLE_TITLES[role]} Agent 已中止。`,
          499,
          `${ROLE_ERROR_CODES[role]}-aborted`
        )
      }

      const detail = getErrorDetail(error)

      if (isStructuredOutputParsingError(error) && attempt < STRUCTURED_OUTPUT_PARSE_RETRY_ATTEMPTS) {
        parseFailureDetail = detail
        continue
      }

      const retryDetail = parseFailureDetail
        ? `Structured output parsing failed after retry. First error: ${parseFailureDetail}\nLast error: ${detail}`
        : detail

      throw new FileStoreError(
        `${ROLE_TITLES[role]} Agent failed: ${retryDetail}`,
        502,
        ROLE_ERROR_CODES[role]
      )
    }
  }

  throw new FileStoreError(
    `${ROLE_TITLES[role]} Agent failed: Structured output parsing failed.`,
    502,
    ROLE_ERROR_CODES[role]
  )
}

function createLog(role: StoryCreationAgentRole, summary: string): StoryCreationAgentLog {
  return {
    role,
    title: ROLE_TITLES[role],
    summary
  }
}

function isAbortError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.name === "AbortError" || error.message.toLowerCase().includes("aborted")
}

function buildPlotPlanText(output: z.infer<typeof plotPlannerOutputSchema>) {
  return [
    `篇章: ${output.arc}`,
    "",
    "节拍:",
    ...output.beats.map((beat) => `- ${beat}`),
    "",
    "玩家选择空间:",
    ...output.choices.map((choice) => `- ${choice}`),
    "",
    "节奏说明:",
    ...output.pacingNotes.map((note) => `- ${note}`)
  ].join("\n")
}

function buildAssetPlanText(output: z.infer<typeof assetDesignerOutputSchema>) {
  return formatJson({
    locations: output.locations,
    roles: output.roles,
    items: output.items,
    notes: output.notes
  }, 12000)
}

function normalizeScheduleAt(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : "00:00"
}

function normalizeSchedulePriority(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 100
}

function normalizeScheduleDependencyIds(value: string[] | null | undefined) {
  return Array.from(
    new Set((value ?? []).map((item) => item.trim()).filter(Boolean))
  )
}

function toDraftLoopOrderFields(loop: StructuredCreationDraftLoopRule) {
  return {
    at: normalizeScheduleAt(loop.at),
    priority: normalizeSchedulePriority(loop.priority),
    after: normalizeScheduleDependencyIds(loop.after),
    before: normalizeScheduleDependencyIds(loop.before)
  }
}

function toDraftLoopRule(loop: StructuredCreationDraftLoopRule | null): StoryCreationDraftEvent["loop"] {
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

function toDraftPresentation(
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

function toStructuredPhoneInvocation(
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

function normalizeStructuredPhoneDraft(phone: StructuredCreationPhoneDraft): StoryCreationDraftPhone {
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

function normalizeStructuredPhoneConversationsDraft(
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

function normalizeStructuredDoingDraft(doing: StructuredCreationDoingDraft): StoryCreationDraftDoing {
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

function normalizeStructuredShopDraft(shop: StructuredCreationShopDraft): StoryCreationDraftShop {
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

function normalizeStructuredDraft(draft: StructuredCreationDraft): StoryCreationDraft {
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

interface DraftStoryScriptValidationIssue {
  collectionType: StoryCreationDraftEvent["collectionType"]
  eventId: string
  field: string
  message: string
}

interface DraftScriptValidationTarget {
  collectionType: StoryCreationDraftEvent["collectionType"]
  id: string
}

function cloneStoryValGroup(group: StoryValDefinition): StoryValDefinition {
  return {
    name: group.name,
    description: group.description,
    vals: group.vals.map((entry) => ({
      name: entry.name,
      description: entry.description,
      value_type: entry.value_type,
      value: entry.value,
      calc_rule: entry.calc_rule
    }))
  }
}

function appendValidationValGroup(
  groups: Map<string, StoryValDefinition>,
  sourceGroup: StoryValDefinition
) {
  const groupName = sourceGroup.name.trim()

  if (!groupName) {
    return
  }

  const groupKey = groupName.toLowerCase()
  const targetGroup = groups.get(groupKey)

  if (!targetGroup) {
    groups.set(groupKey, cloneStoryValGroup(sourceGroup))
    return
  }

  const existingRows = new Set(targetGroup.vals.map((entry) => entry.name.trim().toLowerCase()))
  for (const entry of sourceGroup.vals) {
    const rowName = entry.name.trim()

    if (!rowName || existingRows.has(rowName.toLowerCase())) {
      continue
    }

    targetGroup.vals.push({
      name: entry.name,
      description: entry.description,
      value_type: entry.value_type,
      value: entry.value,
      calc_rule: entry.calc_rule
    })
    existingRows.add(rowName.toLowerCase())
  }
}

function buildDraftValidationVals(story: StoryDocument, draft: StoryCreationDraft): StoryValsFile {
  const groups = new Map<string, StoryValDefinition>()

  for (const group of story.vals.variables) {
    appendValidationValGroup(groups, group)
  }

  for (const group of story.systemVals.variables) {
    appendValidationValGroup(groups, group)
  }

  for (const variable of draft.variables) {
    appendValidationValGroup(groups, {
      name: variable.group,
      vals: [{
        name: variable.name,
        description: variable.description,
        value_type: variable.value_type,
        value: variable.value_type === "value" ? variable.value : undefined,
        calc_rule: variable.calc_rule
      }]
    })
  }

  return {
    variables: Array.from(groups.values())
  }
}

function collectDraftValidationItemIds(story: StoryDocument, draft: StoryCreationDraft) {
  const itemIds = new Set<string>()

  for (const item of story.items.items) {
    const itemId = item.id.trim()
    if (itemId) {
      itemIds.add(itemId)
    }
  }

  for (const item of draft.items) {
    const itemId = item.id.trim()
    if (!itemId) {
      continue
    }

    itemIds.add(itemId)
    itemIds.add(makeLooseId(itemId))
  }

  return Array.from(itemIds)
}

function collectDraftValidationRoleKeys(story: StoryDocument, draft: StoryCreationDraft) {
  const roleKeys = new Set<string>()

  for (const role of story.roles.normal.roles) {
    const roleId = role.id.trim()
    if (roleId) {
      roleKeys.add(`normal:${roleId}`)
    }
  }

  for (const role of story.roles.important.roles) {
    const roleId = role.id.trim()
    if (roleId) {
      roleKeys.add(`important:${roleId}`)
    }
  }

  for (const role of draft.roles) {
    roleKeys.add(draftRoleKey(role))
  }

  return Array.from(roleKeys)
}

function collectDraftValidationDoingIds(story: StoryDocument, draft: StoryCreationDraft) {
  const doingIds = new Set<string>()

  for (const doing of story.doing.doings) {
    const doingId = doing.id.trim()
    if (doingId) {
      doingIds.add(doingId)
    }
  }

  for (const doing of draft.doing?.doings ?? []) {
    const doingId = doing.id.trim()
    if (!doingId) {
      continue
    }

    doingIds.add(doingId)
    doingIds.add(makeLooseId(doingId))
  }

  return Array.from(doingIds)
}

function collectDraftValidationShopProductIds(story: StoryDocument, draft: StoryCreationDraft) {
  const productIds = new Set<string>()

  for (const product of story.shop.products) {
    const productId = product.id.trim()
    if (productId) {
      productIds.add(productId)
    }
  }

  for (const product of draft.shop?.products ?? []) {
    const productId = product.id.trim()
    if (!productId) {
      continue
    }

    productIds.add(productId)
    productIds.add(makeLooseId(productId))
  }

  return Array.from(productIds)
}

function collectDraftValidationPhoneConversationIds(story: StoryDocument, draft: StoryCreationDraft) {
  const conversationIds = new Set<string>()

  for (const conversation of story.phoneConversations.conversations) {
    const conversationId = conversation.id.trim()
    if (conversationId) {
      conversationIds.add(conversationId)
    }
  }

  for (const conversation of draft.phoneConversations?.conversations ?? []) {
    const conversationId = conversation.id.trim()
    if (!conversationId) {
      continue
    }

    conversationIds.add(conversationId)
    conversationIds.add(makeLooseId(conversationId))
  }

  return Array.from(conversationIds)
}

function formatStoryScriptIssue(issue: StoryScriptValidationIssue) {
  return issue.lineNumber > 0
    ? `第 ${issue.lineNumber} 行: ${issue.message}`
    : issue.message
}

function pushDraftScriptValidationIssues(
  issues: DraftStoryScriptValidationIssue[],
  target: DraftScriptValidationTarget,
  field: string,
  scriptIssues: StoryScriptValidationIssue[]
) {
  for (const issue of scriptIssues) {
    issues.push({
      collectionType: target.collectionType,
      eventId: target.id,
      field,
      message: formatStoryScriptIssue(issue)
    })
  }
}

function getDraftEventCallTokens(event: StoryCreationDraftEvent) {
  return Object.fromEntries(
    (event.invoke_params ?? [])
      .map((param) => param.name.trim())
      .filter(Boolean)
      .map((name) => [`call.${name}`, null] as const)
  )
}

function getStoryReferTokens(story: StoryDocument) {
  return Object.fromEntries(
    story.refer.terms
      .map((term) => term.id.trim().replace(/^term\./, ""))
      .filter(Boolean)
      .map((termId) => [`term.${termId}`, null] as const)
  )
}

function createDraftEventValidationContext(
  event: StoryCreationDraftEvent,
  context: {
    itemIds: string[]
    roleKeys: string[]
    doingIds: string[]
    shopProductIds: string[]
    phoneConversationIds: string[]
    referTokens: Record<string, null>
  },
  mode: "read" | "write"
) {
  return createStoryScriptValidationContext({
    values: {
      ...context.referTokens,
      ...(mode === "write" ? getDraftEventCallTokens(event) : {})
    },
    assignableValues: {},
    itemIds: context.itemIds,
    roleKeys: context.roleKeys,
    doingIds: context.doingIds,
    shopProductIds: context.shopProductIds,
    phoneConversationIds: context.phoneConversationIds,
    bagMode: mode,
    phoneMode: mode,
    doingMode: mode,
    shopMode: mode
  })
}

function createDraftGlobalValidationContext(
  context: {
    itemIds: string[]
    roleKeys: string[]
    doingIds: string[]
    shopProductIds: string[]
    phoneConversationIds: string[]
    referTokens: Record<string, null>
  },
  mode: "read" | "write"
) {
  return createStoryScriptValidationContext({
    values: context.referTokens,
    itemIds: context.itemIds,
    roleKeys: context.roleKeys,
    doingIds: context.doingIds,
    shopProductIds: context.shopProductIds,
    phoneConversationIds: context.phoneConversationIds,
    bagMode: mode,
    phoneMode: mode,
    doingMode: mode,
    shopMode: mode
  })
}

function validateDraftEventPresentationTemplates(
  vals: StoryValsFile,
  event: StoryCreationDraftEvent,
  issues: DraftStoryScriptValidationIssue[],
  context: {
    itemIds: string[]
    roleKeys: string[]
    doingIds: string[]
    shopProductIds: string[]
    phoneConversationIds: string[]
    referTokens: Record<string, null>
  }
) {
  if (event.presentation.type === "message") {
    pushDraftScriptValidationIssues(
      issues,
      event,
      "presentation.message.content",
      validateStoryScriptContent(
        vals,
        event.presentation.message.content,
        "template",
        undefined,
        createDraftEventValidationContext(event, context, "write")
      )
    )
    return
  }

  if (event.presentation.type !== "dialogue") {
    return
  }

  event.presentation.dialogues.forEach((dialogue, index) => {
    pushDraftScriptValidationIssues(
      issues,
      event,
      `presentation.dialogues[${index}].content`,
      validateStoryScriptContent(
        vals,
        dialogue.content,
        "template",
        undefined,
        createDraftEventValidationContext(event, context, "write")
      )
    )
  })
}

function validateDraftPhoneConversationScripts(
  vals: StoryValsFile,
  draft: StoryCreationDraft,
  issues: DraftStoryScriptValidationIssue[],
  context: {
    itemIds: string[]
    roleKeys: string[]
    doingIds: string[]
    shopProductIds: string[]
    phoneConversationIds: string[]
    referTokens: Record<string, null>
  }
) {
  for (const conversation of draft.phoneConversations?.conversations ?? []) {
    const target = {
      collectionType: "pool" as const,
      id: `phone.conversation:${conversation.id}`
    }

    if (conversation.trigger_expr.trim()) {
      pushDraftScriptValidationIssues(
        issues,
        target,
        "trigger_expr",
        validateStoryScriptContent(
          vals,
          conversation.trigger_expr,
          "predicate",
          undefined,
          createDraftGlobalValidationContext(context, "read")
        )
      )
    }

    conversation.nodes.forEach((node, nodeIndex) => {
      node.contact_messages.forEach((message, messageIndex) => {
        pushDraftScriptValidationIssues(
          issues,
          target,
          `nodes[${nodeIndex}].contact_messages[${messageIndex}].content`,
          validateStoryScriptContent(
            vals,
            message.content,
            "template",
            undefined,
            createDraftGlobalValidationContext(context, "write")
          )
        )
      })

      node.player_options.forEach((option, optionIndex) => {
        pushDraftScriptValidationIssues(
          issues,
          target,
          `nodes[${nodeIndex}].player_options[${optionIndex}].text`,
          validateStoryScriptContent(
            vals,
            option.text,
            "template",
            undefined,
            createDraftGlobalValidationContext(context, "write")
          )
        )

        if (option.visible_expr.trim()) {
          pushDraftScriptValidationIssues(
            issues,
            target,
            `nodes[${nodeIndex}].player_options[${optionIndex}].visible_expr`,
            validateStoryScriptContent(
              vals,
              option.visible_expr,
              "predicate",
              undefined,
              createDraftGlobalValidationContext(context, "read")
            )
          )
        }

        pushDraftScriptValidationIssues(
          issues,
          target,
          `nodes[${nodeIndex}].player_options[${optionIndex}].script`,
          validateStoryScriptContent(
            vals,
            option.script,
            "procedure",
            undefined,
            createDraftGlobalValidationContext(context, "write")
          )
        )
      })

      pushDraftScriptValidationIssues(
        issues,
        target,
        `nodes[${nodeIndex}].end_script`,
        validateStoryScriptContent(
          vals,
          node.end_script,
          "procedure",
          undefined,
          createDraftGlobalValidationContext(context, "write")
        )
      )
    })
  }
}

function collectDraftStoryScriptValidationIssues(
  story: StoryDocument,
  draft: StoryCreationDraft
) {
  const vals = buildDraftValidationVals(story, draft)
  const validationContext = {
    itemIds: collectDraftValidationItemIds(story, draft),
    roleKeys: collectDraftValidationRoleKeys(story, draft),
    doingIds: collectDraftValidationDoingIds(story, draft),
    shopProductIds: collectDraftValidationShopProductIds(story, draft),
    phoneConversationIds: collectDraftValidationPhoneConversationIds(story, draft),
    referTokens: getStoryReferTokens(story)
  }
  const issues: DraftStoryScriptValidationIssue[] = []

  for (const event of draft.events) {
    if (event.trigger_mode === "condition") {
      if (!event.trigger_expr.trim()) {
        issues.push({
          collectionType: event.collectionType,
          eventId: event.id,
          field: "trigger_expr",
          message: "条件触发事件必须填写 trigger_expr。"
        })
      } else {
        pushDraftScriptValidationIssues(
          issues,
          event,
          "trigger_expr",
          validateStoryScriptContent(
            vals,
            event.trigger_expr,
            "predicate",
            undefined,
            createDraftEventValidationContext(event, validationContext, "read")
          )
        )
      }
    }

    pushDraftScriptValidationIssues(
      issues,
      event,
      "init_script",
      validateStoryScriptContent(
        vals,
        event.init_script,
        "procedure",
        undefined,
        createDraftEventValidationContext(event, validationContext, "write")
      )
    )

    pushDraftScriptValidationIssues(
      issues,
      event,
      "end_script",
      validateStoryScriptContent(
        vals,
        event.end_script,
        "procedure",
        undefined,
        createDraftEventValidationContext(event, validationContext, "write")
      )
    )

    validateDraftEventPresentationTemplates(vals, event, issues, validationContext)
  }

  for (const doing of draft.doing?.menus ?? []) {
    if (!doing.visible_expr.trim()) {
      continue
    }

    pushDraftScriptValidationIssues(
      issues,
      {
        collectionType: "pool",
        id: `doing.menu:${doing.id}`
      },
      "visible_expr",
      validateStoryScriptContent(
        vals,
        doing.visible_expr,
        "predicate",
        undefined,
        createDraftGlobalValidationContext(validationContext, "read")
      )
    )
  }

  for (const doing of draft.doing?.doings ?? []) {
    const target = {
      collectionType: "pool" as const,
      id: `doing:${doing.id}`
    }

    if (doing.visible_expr.trim()) {
      pushDraftScriptValidationIssues(
        issues,
        target,
        "visible_expr",
        validateStoryScriptContent(
          vals,
          doing.visible_expr,
          "predicate",
          undefined,
          createDraftGlobalValidationContext(validationContext, "read")
        )
      )
    }

    pushDraftScriptValidationIssues(
      issues,
      target,
      "init_script",
      validateStoryScriptContent(
        vals,
        doing.init_script,
        "procedure",
        undefined,
        createDraftGlobalValidationContext(validationContext, "write")
      )
    )

    pushDraftScriptValidationIssues(
      issues,
      target,
      "end_script",
      validateStoryScriptContent(
        vals,
        doing.end_script,
        "procedure",
        undefined,
        createDraftGlobalValidationContext(validationContext, "write")
      )
    )
  }

  for (const profile of draft.phone?.contact_profiles ?? []) {
    for (const rule of profile.proactive_messages) {
      pushDraftScriptValidationIssues(
        issues,
        {
          collectionType: "pool",
          id: `phone:${profile.role_key}:${rule.id}`
        },
        "proactive_messages.trigger_expr",
        validateStoryScriptContent(
          vals,
          rule.trigger_expr,
          "predicate",
          undefined,
          createDraftGlobalValidationContext(validationContext, "read")
        )
      )
    }
  }

  validateDraftPhoneConversationScripts(vals, draft, issues, validationContext)

  for (const category of draft.shop?.categories ?? []) {
    if (!category.visible_expr.trim()) {
      continue
    }

    pushDraftScriptValidationIssues(
      issues,
      {
        collectionType: "pool",
        id: `shop.category:${category.id}`
      },
      "visible_expr",
      validateStoryScriptContent(
        vals,
        category.visible_expr,
        "predicate",
        undefined,
        createDraftGlobalValidationContext(validationContext, "read")
      )
    )
  }

  for (const product of draft.shop?.products ?? []) {
    if (!product.available_expr.trim()) {
      continue
    }

    pushDraftScriptValidationIssues(
      issues,
      {
        collectionType: "pool",
        id: `shop.product:${product.id}`
      },
      "available_expr",
      validateStoryScriptContent(
        vals,
        product.available_expr,
        "predicate",
        undefined,
        createDraftGlobalValidationContext(validationContext, "read")
      )
    )
  }

  return issues
}

function formatDraftStoryScriptValidationIssues(issues: DraftStoryScriptValidationIssue[]) {
  return issues
    .map((issue, index) => {
      return [
        `${index + 1}.`,
        `${issue.collectionType}/${issue.eventId}`,
        issue.field,
        issue.message
      ].join(" ")
    })
    .join("\n")
}

function preserveBaseDraftScripts(
  baseDraft: StoryCreationDraft | null,
  draft: StoryCreationDraft,
  instruction: string
): { draft: StoryCreationDraft; messages: string[] } {
  if (!baseDraft || instructionAllowsScriptRemoval(instruction)) {
    return {
      draft,
      messages: []
    }
  }

  const baseEvents = new Map(
    baseDraft.events.map((event) => [draftEventKey(event), event] as const)
  )
  const messages: string[] = []
  let hasChanges = false

  const events = draft.events.map((event) => {
    const baseEvent = baseEvents.get(draftEventKey(event))

    if (!baseEvent) {
      return event
    }

    let nextEvent = event

    for (const field of ["init_script", "end_script"] as const) {
      const baseScript = baseEvent[field].trim()
      const nextScript = nextEvent[field].trim()

      if (!baseScript || nextScript) {
        continue
      }

      nextEvent = {
        ...nextEvent,
        [field]: baseEvent[field]
      }
      hasChanges = true
      messages.push(
        `已恢复 ${event.collectionType}/${event.id} 的 ${field}：本次反馈未明确要求删脚本，不能把已有非空脚本静默清空。`
      )
    }

    return nextEvent
  })

  return hasChanges
    ? {
        draft: {
          ...draft,
          events
        },
        messages
      }
    : {
        draft,
        messages
      }
}

function makeUniqueId(rawId: string, fallback: string, usedIds: Set<string>) {
  const normalizedId = rawId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  const baseId = normalizedId || fallback
  let candidateId = baseId
  let suffix = 2

  while (usedIds.has(candidateId)) {
    candidateId = `${baseId}-${suffix}`
    suffix += 1
  }

  usedIds.add(candidateId)
  return candidateId
}

function getDraftRoleNamespace(role: StoryCreationDraftRole) {
  return role.important ? "important" : "normal"
}

function draftRoleKey(role: StoryCreationDraftRole) {
  return `${getDraftRoleNamespace(role)}:${role.id}`
}

function normalizeRoleReference(roleKey: string, roleIdMap: Map<string, string>) {
  const trimmedKey = roleKey.trim()

  if (!trimmedKey || trimmedKey === "player") {
    return "player"
  }

  const [namespace, rawId] = trimmedKey.split(":")
  if ((namespace === "normal" || namespace === "important") && rawId) {
    const normalizedId = makeLooseId(rawId)
    const mappedId =
      roleIdMap.get(`${namespace}:${rawId}`) ??
      roleIdMap.get(`${namespace}:${normalizedId}`) ??
      normalizedId

    return mappedId ? `${namespace}:${mappedId}` : ""
  }

  return trimmedKey
}

function makeLooseId(rawId: string) {
  return rawId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function makeVariableName(rawName: string, fallback: string) {
  const normalizedName = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  return normalizedName || fallback
}

function getDraftPresentationDialogues(presentation: StoryCreationDraftPresentation) {
  return presentation.type === "dialogue" ? presentation.dialogues : []
}

function normalizeDraftPresentation(
  presentation: StoryCreationDraftPresentation,
  roleIdMap: Map<string, string>
): StoryCreationDraftPresentation {
  if (presentation.type === "silent") {
    return {
      type: "silent"
    }
  }

  if (presentation.type === "message") {
    const durationSeconds = Number.isFinite(presentation.message.duration_seconds)
      ? Math.max(0, presentation.message.duration_seconds)
      : 3

    return {
      type: "message",
      message: {
        content: presentation.message.content ?? "",
        duration_seconds: durationSeconds
      }
    }
  }

  return {
    type: "dialogue",
    dialogues: presentation.dialogues.map((dialogue) => ({
      ...dialogue,
      speaker_key:
        dialogue.speaker_type === "player"
          ? "player"
          : normalizeRoleReference(dialogue.speaker_key, roleIdMap)
    }))
  }
}

function normalizePhoneScope(
  scope: StoryPhoneTalkLibraryEntry["scope"],
  roleIdMap: Map<string, string>
): StoryPhoneTalkLibraryEntry["scope"] {
  const minFavor = Number.isFinite(scope.min_favor) ? Math.max(0, Math.min(100, Math.trunc(scope.min_favor))) : 0
  const maxFavor = Number.isFinite(scope.max_favor) ? Math.max(0, Math.min(100, Math.trunc(scope.max_favor))) : 100

  return {
    role_keys: Array.from(
      new Set((scope.role_keys ?? []).map((roleKey) => normalizeRoleReference(roleKey, roleIdMap)).filter(Boolean))
    ),
    contact_tracks: Array.from(new Set((scope.contact_tracks ?? []).filter((track) => track !== "none"))),
    personality_ids: Array.from(new Set((scope.personality_ids ?? []).map(makeLooseId).filter(Boolean))),
    min_favor: Math.min(minFavor, maxFavor),
    max_favor: Math.max(minFavor, maxFavor)
  }
}

function normalizePhoneInvokeTargetId(
  targetType: NonNullable<StoryPhoneTalkLibraryEntry["invoke"]>["target_type"],
  eventId: string,
  eventIdMap?: Map<string, string>
) {
  const looseEventId = makeLooseId(eventId)
  return eventIdMap?.get(`${targetType}:${eventId}`)
    ?? eventIdMap?.get(`${targetType}:${looseEventId}`)
    ?? looseEventId
}

function normalizePhoneInvoke<T extends { invoke?: StoryPhoneTalkLibraryEntry["invoke"] }>(
  entry: T,
  eventIdMap?: Map<string, string>
): T {
  if (!entry.invoke) {
    return entry
  }

  return {
    ...entry,
    invoke: {
      ...entry.invoke,
      event_id: normalizePhoneInvokeTargetId(entry.invoke.target_type, entry.invoke.event_id, eventIdMap)
    }
  }
}

function normalizeDraftPhone(
  phone: StoryCreationDraft["phone"],
  roleIdMap: Map<string, string>,
  eventIdMap?: Map<string, string>
): StoryCreationDraftPhone {
  const usedPersonalityIds = new Set<string>()
  const usedTalkIds = new Set<string>()
  const usedActionIds = new Set<string>()
  const usedReplyIds = new Set<string>()
  const usedProfileRoleKeys = new Set<string>()

  const personalities = (phone?.personality_library ?? []).map((personality, index) => ({
    id: makeUniqueId(personality.id, `phone-personality-${index + 1}`, usedPersonalityIds),
    name: personality.name?.trim() ?? "",
    descr: personality.descr ?? "",
    style_tags: Array.from(new Set((personality.style_tags ?? []).map((tag) => tag.trim()).filter(Boolean)))
  }))

  const talks = (phone?.talk_library ?? []).map((entry, index) => normalizePhoneInvoke({
    id: makeUniqueId(entry.id, `phone-talk-${index + 1}`, usedTalkIds),
    text: entry.text ?? "",
    tags: Array.from(new Set((entry.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    scope: normalizePhoneScope(entry.scope, roleIdMap),
    base_favor_delta: Math.max(-100, Math.min(100, Math.trunc(entry.base_favor_delta ?? 0))),
    cooldown_hours: Math.max(0, Math.trunc(entry.cooldown_hours ?? 0)),
    ...(entry.invoke ? { invoke: entry.invoke } : {})
  }, eventIdMap))

  const actions = (phone?.action_library ?? []).map((entry, index) => normalizePhoneInvoke({
    id: makeUniqueId(entry.id, `phone-action-${index + 1}`, usedActionIds),
    label: entry.label ?? "",
    text: entry.text ?? "",
    tags: Array.from(new Set((entry.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    scope: normalizePhoneScope(entry.scope, roleIdMap),
    base_favor_delta: Math.max(-100, Math.min(100, Math.trunc(entry.base_favor_delta ?? 0))),
    cooldown_hours: Math.max(0, Math.trunc(entry.cooldown_hours ?? 0)),
    cost_money: Math.max(0, entry.cost_money ?? 0),
    cost_items: (entry.cost_items ?? []).map((item) => ({
      item_id: makeLooseId(item.item_id),
      quantity: Math.max(1, Math.trunc(item.quantity ?? 1))
    })).filter((item) => item.item_id),
    ...(entry.invoke ? { invoke: entry.invoke } : {})
  }, eventIdMap))

  const replies = (phone?.reply_library ?? []).map((entry, index) => ({
    id: makeUniqueId(entry.id, `phone-reply-${index + 1}`, usedReplyIds),
    tags: Array.from(new Set((entry.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    scope: normalizePhoneScope(entry.scope, roleIdMap),
    replies: (entry.replies ?? []).map((reply) => reply.trim()).filter(Boolean)
  }))

  const contactProfiles = (phone?.contact_profiles ?? []).flatMap((profile) => {
    const roleKey = normalizeRoleReference(profile.role_key, roleIdMap)
    if (!roleKey || roleKey === "player" || usedProfileRoleKeys.has(roleKey)) {
      return []
    }

    usedProfileRoleKeys.add(roleKey)

    return [{
      role_key: roleKey,
      enabled: profile.enabled ?? true,
      auto_add: profile.auto_add ?? true,
      initial_favor: Math.max(0, Math.min(100, Math.trunc(profile.initial_favor ?? 20))),
      preferred_tags: Array.from(new Set((profile.preferred_tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
      reply_by_tag: Object.fromEntries(
        Object.entries(profile.reply_by_tag ?? {})
          .map(([tag, replies]) => {
            const nextTag = tag.trim()
            const nextReplies = (replies ?? []).map((reply) => reply.trim()).filter(Boolean)
            return [nextTag, nextReplies] as const
          })
          .filter(([tag, replies]) => tag && replies.length > 0)
      ),
      proactive_messages: (profile.proactive_messages ?? []).map((rule, index) => ({
        id: makeLooseId(rule.id) || `proactive-${index + 1}`,
        enabled: rule.enabled ?? true,
        trigger_expr: rule.trigger_expr ?? "",
        cooldown_hours: Math.max(1, Math.trunc(rule.cooldown_hours ?? 24)),
        favor_delta: Math.max(-100, Math.min(100, Math.trunc(rule.favor_delta ?? 0))),
        messages: (rule.messages ?? []).map((message) => message.trim()).filter(Boolean),
        reply_quick_message_ids: Array.from(new Set((rule.reply_quick_message_ids ?? []).map(makeLooseId).filter(Boolean)))
      })).filter((rule) => rule.trigger_expr.trim() && rule.messages.length > 0)
    }]
  })

  return {
    personality_library: personalities,
    talk_library: talks,
    action_library: actions,
    reply_library: replies,
    contact_profiles: contactProfiles
  }
}

function normalizeDraftPhoneConversations(
  phoneConversations: StoryCreationDraft["phoneConversations"],
  roleIdMap: Map<string, string>,
  eventIdMap: Map<string, string>
): StoryCreationDraftPhoneConversations {
  const usedConversationIds = new Set<string>()

  const conversations = (phoneConversations?.conversations ?? []).flatMap((conversation, conversationIndex) => {
    const roleKey = normalizeRoleReference(conversation.role_key, roleIdMap)
    if (!roleKey || roleKey === "player") {
      return []
    }

    const id = makeUniqueId(
      conversation.id,
      `phone-conversation-${conversationIndex + 1}`,
      usedConversationIds
    )
    const usedNodeIds = new Set<string>()
    const usedOptionIds = new Set<string>()
    const nodeIdMap = new Map<string, string>()

    const nodeSeeds = (conversation.nodes ?? []).map((node, nodeIndex) => {
      const nodeId = makeUniqueId(node.id, `node-${nodeIndex + 1}`, usedNodeIds)
      nodeIdMap.set(node.id, nodeId)
      nodeIdMap.set(makeLooseId(node.id), nodeId)
      return {
        source: node,
        id: nodeId
      }
    })

    if (nodeSeeds.length === 0) {
      return []
    }

    const nodes = nodeSeeds.map(({ source, id: nodeId }) => {
      const end = source.end ?? false
      const invoke = end && source.invoke
        ? normalizePhoneInvoke({ invoke: source.invoke }, eventIdMap).invoke
        : undefined

      return {
        id: nodeId,
        contact_messages: (source.contact_messages ?? [])
          .map((message) => ({ content: message.content?.trim() ?? "" }))
          .filter((message) => message.content.length > 0),
        player_options: (source.player_options ?? []).map((option, optionIndex) => {
          const optionId = makeUniqueId(option.id, `option-${optionIndex + 1}`, usedOptionIds)
          const nextNodeId = option.next_node_id
            ? nodeIdMap.get(option.next_node_id)
              ?? nodeIdMap.get(makeLooseId(option.next_node_id))
              ?? ""
            : ""

          return {
            id: optionId,
            text: option.text ?? "",
            visible_expr: option.visible_expr ?? "",
            script: option.script ?? "",
            next_node_id: nextNodeId
          }
        }),
        reminder: {
          enabled: source.reminder?.enabled ?? false,
          interval_minutes: Math.max(1, Math.trunc(source.reminder?.interval_minutes ?? 60))
        },
        end,
        end_script: source.end_script ?? "",
        ...(invoke ? { invoke } : {})
      } satisfies StoryPhoneConversationDefinition["nodes"][number]
    })
    const entryNodeId =
      nodeIdMap.get(conversation.entry_node_id)
      ?? nodeIdMap.get(makeLooseId(conversation.entry_node_id))
      ?? nodes[0]!.id

    return [{
      id,
      title: conversation.title?.trim() || id,
      role_key: roleKey,
      enabled: conversation.enabled ?? true,
      once: conversation.once ?? true,
      lock_normal_chat: conversation.lock_normal_chat ?? true,
      trigger_expr: conversation.trigger_expr ?? "",
      entry_node_id: entryNodeId,
      nodes
    }]
  })

  return {
    conversations
  }
}

function normalizeDraftDoing(
  doing: StoryCreationDraft["doing"],
  roleIdMap: Map<string, string>,
  locationIdMap: Map<string, string>
): StoryCreationDraftDoing {
  const usedMenuIds = new Set<string>()
  const usedDoingIds = new Set<string>()
  const menuIdMap = new Map<string, string>()

  const menus = (doing?.menus ?? []).map((menu, index) => {
    const id = makeUniqueId(menu.id, `doing-menu-${index + 1}`, usedMenuIds)
    menuIdMap.set(menu.id, id)
    menuIdMap.set(makeLooseId(menu.id), id)

    return {
      id,
      title: menu.title?.trim() || id,
      parent_id: "",
      sort_order: Number.isFinite(menu.sort_order) ? Math.trunc(menu.sort_order) : 100,
      visible_expr: menu.visible_expr ?? "",
      descr: menu.descr ?? ""
    }
  })

  const menuIds = new Set(menus.map((menu) => menu.id))
  const normalizedMenus = menus.map((menu, index) => {
    const sourceMenu = doing?.menus?.[index]
    const parentId = sourceMenu?.parent_id
      ? menuIdMap.get(sourceMenu.parent_id) ?? menuIdMap.get(makeLooseId(sourceMenu.parent_id)) ?? makeLooseId(sourceMenu.parent_id)
      : ""

    return {
      ...menu,
      parent_id: parentId && parentId !== menu.id && menuIds.has(parentId) ? parentId : ""
    }
  })

  const firstMenuId = normalizedMenus[0]?.id ?? ""
  const doings = (doing?.doings ?? []).map((entry, index) => {
    const id = makeUniqueId(entry.id, `doing-${index + 1}`, usedDoingIds)
    const menuId = menuIdMap.get(entry.menu_id) ?? menuIdMap.get(makeLooseId(entry.menu_id)) ?? makeLooseId(entry.menu_id)
    const location = entry.location.trim()
      ? locationIdMap.get(entry.location) ?? makeLooseId(entry.location)
      : ""

    return {
      id,
      title: entry.title?.trim() || id,
      menu_id: menuIds.has(menuId) ? menuId : firstMenuId,
      descr: entry.descr ?? "",
      visible_expr: entry.visible_expr ?? "",
      cooldown_hours: Math.max(0, Math.trunc(entry.cooldown_hours ?? 0)),
      once: entry.once ?? false,
      init_script: entry.init_script ?? "",
      object_keys: Array.from(
        new Set((entry.object_keys ?? []).map((roleKey) => normalizeRoleReference(roleKey, roleIdMap)).filter(Boolean))
      ),
      presentation: normalizeDraftPresentation(entry.presentation, roleIdMap),
      location,
      bgm: entry.bgm ?? "",
      end_script: entry.end_script ?? ""
    }
  }).filter((entry) => entry.menu_id)

  return {
    menus: normalizedMenus,
    doings
  }
}

function normalizeDraftShop(
  shop: StoryCreationDraft["shop"],
  itemIdMap: Map<string, string>
): StoryCreationDraftShop {
  const usedCategoryIds = new Set<string>()
  const usedProductIds = new Set<string>()
  const categoryIdMap = new Map<string, string>()

  const categories = (shop?.categories ?? []).map((category, index) => {
    const id = makeUniqueId(category.id, `shop-category-${index + 1}`, usedCategoryIds)
    categoryIdMap.set(category.id, id)
    categoryIdMap.set(makeLooseId(category.id), id)

    return {
      id,
      name: category.name?.trim() || id,
      sort_order: Number.isFinite(category.sort_order) ? Math.trunc(category.sort_order) : 100,
      visible_expr: category.visible_expr ?? "",
      descr: category.descr ?? ""
    }
  })

  const products = (shop?.products ?? []).map((product, index) => {
    const id = makeUniqueId(product.id, `shop-product-${index + 1}`, usedProductIds)
    const categoryId =
      categoryIdMap.get(product.category_id) ??
      categoryIdMap.get(makeLooseId(product.category_id)) ??
      makeLooseId(product.category_id)
    const itemId =
      itemIdMap.get(product.item_id) ??
      itemIdMap.get(makeLooseId(product.item_id)) ??
      makeLooseId(product.item_id)

    return {
      id,
      category_id: categoryId,
      item_id: itemId,
      price: Math.max(0, Number.isFinite(product.price) ? product.price : 0),
      quantity: Math.max(1, Math.trunc(product.quantity ?? 1)),
      sort_order: Number.isFinite(product.sort_order) ? Math.trunc(product.sort_order) : 100,
      enabled: product.enabled ?? true,
      available_expr: product.available_expr ?? "",
      unavailable_reason: product.unavailable_reason ?? "",
      allow_gift: product.allow_gift ?? true,
      gift_favor_delta: Math.max(-100, Math.min(100, Math.trunc(product.gift_favor_delta ?? 0))),
      purchase_cooldown_hours: Math.max(0, Math.trunc(product.purchase_cooldown_hours ?? 0)),
      gift_cooldown_hours: Math.max(0, Math.trunc(product.gift_cooldown_hours ?? 0))
    }
  })

  return {
    categories,
    products
  }
}

function normalizeDraft(draft: StoryCreationDraft): StoryCreationDraft {
  const locationIdMap = new Map<string, string>()
  const roleIdMap = new Map<string, string>()
  const eventIdMap = new Map<string, string>()
  const itemIdMap = new Map<string, string>()
  const usedLocationIds = new Set<string>()
  const usedItemIds = new Set<string>()
  const usedVariableKeys = new Set<string>()
  const usedRoleIdsByNamespace = {
    normal: new Set<string>(),
    important: new Set<string>()
  }
  const usedEventIdsByCollection: Record<StoryCreationDraftEvent["collectionType"], Set<string>> = {
    chain: new Set<string>(),
    pool: new Set<string>(),
    schedule: new Set<string>()
  }

  const locations = draft.locations.map((location, index) => {
    const id = makeUniqueId(location.id, `location-${index + 1}`, usedLocationIds)
    locationIdMap.set(location.id, id)

    return {
      ...location,
      id
    }
  })

  const roles = draft.roles.map((role, index) => {
    const namespace = getDraftRoleNamespace(role)
    const id = makeUniqueId(role.id, `role-${index + 1}`, usedRoleIdsByNamespace[namespace])
    roleIdMap.set(`${namespace}:${role.id}`, id)
    roleIdMap.set(`${namespace}:${makeLooseId(role.id)}`, id)

    return {
      ...role,
      id
    }
  })

  const items = (draft.items ?? []).map((item, index) => {
    const id = makeUniqueId(item.id, `item-${index + 1}`, usedItemIds)
    itemIdMap.set(item.id, id)
    itemIdMap.set(makeLooseId(item.id), id)
    const maxStack = Number.isInteger(item.max_stack) && item.max_stack > 0
      ? item.max_stack
      : 1

    return {
      ...item,
      id,
      name: item.name?.trim() ?? "",
      category_id: makeLooseId(item.category_id),
      descr: item.descr ?? "",
      prompt: item.prompt ?? "",
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => tag.trim()).filter(Boolean) : [],
      rarity: item.rarity?.trim() || "common",
      stackable: item.stackable ?? true,
      max_stack: maxStack,
      usable: item.usable ?? false
    }
  })

  for (const [index, event] of draft.events.entries()) {
    const eventId = makeUniqueId(event.id, `event-${index + 1}`, usedEventIdsByCollection[event.collectionType])
    eventIdMap.set(draftEventKey(event), eventId)
    eventIdMap.set(`${event.collectionType}:${makeLooseId(event.id)}`, eventId)
  }

  const events = draft.events.map((event) => {
    const eventId = eventIdMap.get(draftEventKey(event)) ?? makeLooseId(event.id)
    const normalizedLocation = event.location.trim()
      ? locationIdMap.get(event.location) ?? makeLooseId(event.location)
      : ""

    return {
      ...event,
      id: eventId,
      location: normalizedLocation,
      object_keys: Array.from(
        new Set(event.object_keys.map((roleKey) => normalizeRoleReference(roleKey, roleIdMap)))
      ),
      presentation: normalizeDraftPresentation(event.presentation, roleIdMap),
      invoke_params: event.invoke_params ?? [],
      loop: event.collectionType === "schedule" ? event.loop : undefined,
      next: event.collectionType === "chain"
        ? event.next
            .map((nextId) => eventIdMap.get(`chain:${nextId}`) ?? makeLooseId(nextId))
            .filter(Boolean)
        : []
    }
  })

  const variables = draft.variables.map((variable, index) => {
    const group = makeVariableName(variable.group, "story")
    const baseName = makeVariableName(variable.name, `var_${index + 1}`)
    let name = baseName
    let suffix = 2

    while (usedVariableKeys.has(`${group}.${name}`)) {
      name = `${baseName}_${suffix}`
      suffix += 1
    }

    usedVariableKeys.add(`${group}.${name}`)

    return {
      ...variable,
      group,
      name,
      description: variable.description ?? "",
      value_type: variable.value_type,
      value: variable.value_type === "calc" ? undefined : variable.value ?? null,
      calc_rule: variable.value_type === "calc" ? variable.calc_rule : ""
    }
  })

  return {
    ...draft,
    locations,
    roles,
    items,
    events,
    variables,
    phone: normalizeDraftPhone(draft.phone, roleIdMap, eventIdMap),
    phoneConversations: normalizeDraftPhoneConversations(draft.phoneConversations, roleIdMap, eventIdMap),
    doing: normalizeDraftDoing(draft.doing, roleIdMap, locationIdMap),
    shop: normalizeDraftShop(draft.shop, itemIdMap)
  }
}

function parseDraftForApply(draft: unknown) {
  try {
    return normalizeDraft(draftApplySchema.parse(draft))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new FileStoreError(`Creation draft is invalid: ${detail}`, 400, "ai.agent-draft-invalid")
  }
}

function toSelectionSet(values: string[]) {
  return new Set(values.map((value) => value.trim()).filter(Boolean))
}

function draftEventKey(event: StoryCreationDraftEvent) {
  return `${event.collectionType}:${event.id}`
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id)

  if (existingIndex < 0) {
    return [...items, nextItem]
  }

  return items.map((item, index) => (index === existingIndex ? nextItem : item))
}

function upsertByKey<T>(items: T[], nextItem: T, getKey: (item: T) => string) {
  const nextKey = getKey(nextItem)
  const existingIndex = items.findIndex((item) => getKey(item) === nextKey)

  if (existingIndex < 0) {
    return [...items, nextItem]
  }

  return items.map((item, index) => (index === existingIndex ? nextItem : item))
}

function toEventLocationAssignment(
  draftLocation: StoryCreationDraft["locations"][number],
  existing?: StoryEventLocationAssignment
): StoryEventLocationAssignment {
  return {
    id: draftLocation.id,
    descr: draftLocation.descr,
    prompt: draftLocation.prompt,
    img_raw: existing?.img_raw ?? "",
    img_compress_1: existing?.img_compress_1 ?? "",
    img_compress_2: existing?.img_compress_2 ?? ""
  }
}

function toNormalRole(
  draftRole: StoryCreationDraftRole,
  existing?: StoryNormalRoleDefinition
): StoryNormalRoleDefinition {
  return {
    contact_enabled: existing?.contact_enabled ?? false,
    contact_initial_favor: existing?.contact_initial_favor ?? 20,
    contact_track: existing?.contact_track ?? "none",
    id: draftRole.id,
    name: draftRole.name,
    zhiye: draftRole.zhiye,
    descr: draftRole.descr,
    prompt: draftRole.prompt,
    img_raw: existing?.img_raw ?? "",
    img_compress_1: existing?.img_compress_1 ?? "",
    img_compress_2: existing?.img_compress_2 ?? "",
    xingge_id: existing?.xingge_id ?? "",
    xingge_note: existing?.xingge_note ?? draftRole.xingge ?? ""
  }
}

function toImportantRole(
  draftRole: StoryCreationDraftRole,
  existing?: StoryImportantRoleDefinition
): StoryImportantRoleDefinition {
  return {
    contact_enabled: existing?.contact_enabled ?? false,
    contact_initial_favor: existing?.contact_initial_favor ?? 20,
    contact_track: existing?.contact_track ?? "none",
    id: draftRole.id,
    name: draftRole.name,
    zhiye: draftRole.zhiye,
    descr: draftRole.descr,
    descr_male: existing?.descr_male ?? "",
    descr_female: existing?.descr_female ?? "",
    prompt: draftRole.prompt,
    prompt_male: existing?.prompt_male ?? "",
    prompt_female: existing?.prompt_female ?? "",
    img_raw: existing?.img_raw ?? "",
    img_compress_1: existing?.img_compress_1 ?? "",
    img_compress_2: existing?.img_compress_2 ?? "",
    xingge: draftRole.xingge ?? existing?.xingge ?? "",
    xingge_id: existing?.xingge_id ?? "",
    xingge_note: existing?.xingge_note ?? "",
    qufen_xingbie: existing?.qufen_xingbie ?? false,
    img_male_raw: existing?.img_male_raw ?? "",
    img_male_compress_1: existing?.img_male_compress_1 ?? "",
    img_male_compress_2: existing?.img_male_compress_2 ?? "",
    img_female_raw: existing?.img_female_raw ?? "",
    img_female_compress_1: existing?.img_female_compress_1 ?? "",
    img_female_compress_2: existing?.img_female_compress_2 ?? ""
  }
}

function toStoryItem(
  draftItem: StoryCreationDraftItem,
  existing?: StoryItemDefinition
): StoryItemDefinition {
  return {
    id: draftItem.id,
    name: draftItem.name,
    category_id: draftItem.category_id,
    descr: draftItem.descr,
    prompt: draftItem.prompt,
    tags: draftItem.tags,
    rarity: draftItem.rarity,
    stackable: draftItem.stackable,
    max_stack: draftItem.max_stack,
    usable: draftItem.usable,
    img_raw: existing?.img_raw ?? "",
    img_compress_1: existing?.img_compress_1 ?? "",
    img_compress_2: existing?.img_compress_2 ?? ""
  }
}

function collectAvailableRoleKeys(roles: StoryRolesFile) {
  return new Set([
    "player",
    ...roles.normal.roles.map((role) => `normal:${role.id}`),
    ...roles.important.roles.map((role) => `important:${role.id}`)
  ])
}

function filterPhoneScopeForApply(
  scope: StoryPhoneTalkLibraryEntry["scope"],
  options: {
    availableRoleKeys: Set<string>
    availablePersonalityIds: Set<string>
    warnings: string[]
    label: string
  }
): StoryPhoneTalkLibraryEntry["scope"] {
  const roleKeys = scope.role_keys.filter((roleKey) => {
    if (options.availableRoleKeys.has(roleKey)) {
      return true
    }

    options.warnings.push(`${options.label} 引用了不存在或未应用的联系人角色 ${roleKey}，已从适用范围移除。`)
    return false
  })
  const personalityIds = scope.personality_ids.filter((personalityId) => {
    if (options.availablePersonalityIds.has(personalityId)) {
      return true
    }

    options.warnings.push(`${options.label} 引用了不存在或未应用的性格 ${personalityId}，已从适用范围移除。`)
    return false
  })

  return {
    ...scope,
    role_keys: roleKeys,
    personality_ids: personalityIds
  }
}

function filterPhoneInvokeForApply<T extends { invoke?: StoryPhoneTalkLibraryEntry["invoke"] }>(
  entry: T,
  options: {
    availableEventIdsByType: Record<"chain" | "pool" | "schedule", Set<string>>
    warnings: string[]
    label: string
  }
): T {
  if (!entry.invoke) {
    return entry
  }

  if (options.availableEventIdsByType[entry.invoke.target_type].has(entry.invoke.event_id)) {
    return entry
  }

  options.warnings.push(
    `${options.label} 调用了不存在或未应用的${entry.invoke.target_type}事件 ${entry.invoke.event_id}，已移除该调用。`
  )

  const { invoke: _invoke, ...rest } = entry
  return rest as T
}

function filterPhoneActionCostItems(
  entry: StoryPhoneActionLibraryEntry,
  availableItemIds: Set<string>,
  warnings: string[]
) {
  return {
    ...entry,
    cost_items: entry.cost_items.filter((item) => {
      if (availableItemIds.has(item.item_id)) {
        return true
      }

      warnings.push(`联系人动作 ${entry.id} 消耗了不存在或未应用的物品 ${item.item_id}，已移除该消耗。`)
      return false
    })
  }
}

function mergePhoneContactProfile(
  draftProfile: StoryPhoneContactProfile,
  existing?: StoryPhoneContactProfile
): StoryPhoneContactProfile {
  return {
    ...draftProfile,
    reply_by_tag: {
      ...(existing?.reply_by_tag ?? {}),
      ...draftProfile.reply_by_tag
    },
    proactive_messages: [
      ...(existing?.proactive_messages ?? []).filter((rule) =>
        !draftProfile.proactive_messages.some((draftRule) => draftRule.id === rule.id)
      ),
      ...draftProfile.proactive_messages
    ]
  }
}

function filterPhoneConversationInvokeForApply(
  conversation: StoryPhoneConversationDefinition,
  options: {
    availableEventIdsByType: Record<"chain" | "pool" | "schedule", Set<string>>
    warnings: string[]
  }
): StoryPhoneConversationDefinition {
  return {
    ...conversation,
    nodes: conversation.nodes.map((node) => {
      if (!node.invoke) {
        return node
      }

      if (options.availableEventIdsByType[node.invoke.target_type].has(node.invoke.event_id)) {
        return node
      }

      options.warnings.push(
        `剧情手机对话 ${conversation.id} 的节点 ${node.id} 调用了不存在或未应用的${node.invoke.target_type}事件 ${node.invoke.event_id}，已移除该调用。`
      )
      const { invoke: _invoke, ...rest } = node
      return rest
    })
  }
}

function filterDoingPresentationForApply(
  doing: StoryDoingDefinition,
  availableRoleKeys: Set<string>,
  warnings: string[]
): StoryDoingDefinition["presentation"] {
  if (doing.presentation.type !== "dialogue") {
    return doing.presentation
  }

  const objectKeys = new Set(doing.object_keys)
  return {
    type: "dialogue",
    dialogues: doing.presentation.dialogues.map((dialogue) => {
      if (dialogue.speaker_type === "player") {
        return {
          ...dialogue,
          speaker_key: "player"
        }
      }

      if (objectKeys.has(dialogue.speaker_key) && availableRoleKeys.has(dialogue.speaker_key)) {
        return dialogue
      }

      warnings.push(`行动 ${doing.id} 的对白说话人 ${dialogue.speaker_key} 不可用，已改为 player。`)
      return {
        ...dialogue,
        speaker_type: "player" as const,
        speaker_key: "player"
      }
    })
  }
}

function normalizeDoingForApply(
  doing: StoryDoingDefinition,
  options: {
    availableLocationIds: Set<string>
    availableRoleKeys: Set<string>
    availableMenuIds: Set<string>
    warnings: string[]
  }
): StoryDoingDefinition | null {
  if (!options.availableMenuIds.has(doing.menu_id)) {
    options.warnings.push(`行动 ${doing.id} 引用了不存在或未应用的菜单 ${doing.menu_id}，未写入 doing.json5。`)
    return null
  }

  const location = doing.location.trim()
  const nextLocation = location && options.availableLocationIds.has(location) ? location : ""
  if (location && !nextLocation) {
    options.warnings.push(`行动 ${doing.id} 引用了不存在或未应用的地点 ${location}，已清空地点。`)
  }

  const objectKeys = doing.object_keys.filter((objectKey) => {
    if (objectKey === "player" || options.availableRoleKeys.has(objectKey)) {
      return true
    }

    options.warnings.push(`行动 ${doing.id} 引用了不存在或未应用的角色 ${objectKey}，已从对象列表移除。`)
    return false
  })
  const nextDoing = {
    ...doing,
    location: nextLocation,
    object_keys: objectKeys
  }

  return {
    ...nextDoing,
    presentation: filterDoingPresentationForApply(nextDoing, options.availableRoleKeys, options.warnings)
  }
}

function normalizeDoingMenuForApply(
  menu: StoryDoingMenu,
  availableMenuIds: Set<string>,
  warnings: string[]
): StoryDoingMenu {
  const parentId = menu.parent_id.trim()

  if (!parentId || parentId === menu.id) {
    return {
      ...menu,
      parent_id: ""
    }
  }

  if (availableMenuIds.has(parentId)) {
    return {
      ...menu,
      parent_id: parentId
    }
  }

  warnings.push(`行动菜单 ${menu.id} 引用了不存在或未应用的父级菜单 ${parentId}，已作为根菜单写入。`)
  return {
    ...menu,
    parent_id: ""
  }
}

function normalizeShopProductForApply(
  product: StoryShopProduct,
  options: {
    availableItemIds: Set<string>
    availableShopCategoryIds: Set<string>
    warnings: string[]
  }
): StoryShopProduct | null {
  if (!options.availableShopCategoryIds.has(product.category_id)) {
    options.warnings.push(`商城商品 ${product.id} 引用了不存在或未应用的商城分类 ${product.category_id}，未写入 shop.json5。`)
    return null
  }

  if (!options.availableItemIds.has(product.item_id)) {
    options.warnings.push(`商城商品 ${product.id} 引用了不存在或未应用的物品 ${product.item_id}，未写入 shop.json5。`)
    return null
  }

  return product
}

function draftVariableKey(variable: StoryCreationDraftVariable) {
  return `${variable.group}.${variable.name}`
}

function cloneStoryValsFile(vals: StoryValsFile): StoryValsFile {
  return {
    variables: vals.variables.map((group) => ({
      ...group,
      vals: group.vals.map((entry) => ({
        ...entry
      }))
    }))
  }
}

function toStoryValEntry(
  variable: StoryCreationDraftVariable,
  warnings: string[]
): StoryValEntryDefinition {
  if (variable.value_type === "calc") {
    const calcRule = variable.calc_rule.trim()

    if (!calcRule) {
      warnings.push(`变量 ${draftVariableKey(variable)} 缺少计算规则，已按普通变量写入空值。`)
      return {
        name: variable.name,
        description: variable.description,
        value_type: "value",
        value: null,
        calc_rule: ""
      }
    }

    return {
      name: variable.name,
      description: variable.description,
      value_type: "calc",
      calc_rule: calcRule
    }
  }

  return {
    name: variable.name,
    description: variable.description,
    value_type: "value",
    value: variable.value ?? null,
    calc_rule: ""
  }
}

function applyDraftVariable(
  vals: StoryValsFile,
  variable: StoryCreationDraftVariable,
  warnings: string[]
) {
  const key = draftVariableKey(variable)

  if (variable.group === "system") {
    warnings.push(`变量 ${key} 属于 system 组，未自动写入 vals.json5。`)
    return false
  }

  const existingGroup = vals.variables.find((group) => group.name === variable.group)

  if (existingGroup?.vals.some((entry) => entry.name === variable.name)) {
    warnings.push(`变量 ${key} 已存在，未覆盖原值。`)
    return false
  }

  if (existingGroup) {
    existingGroup.vals = [
      ...existingGroup.vals,
      toStoryValEntry(variable, warnings)
    ]
    return true
  }

  vals.variables = [
    ...vals.variables,
    {
      name: variable.group,
      description: "",
      vals: [toStoryValEntry(variable, warnings)]
    }
  ]
  return true
}

function makeIdentifier(rawName: string, fallback: string) {
  const normalizedName = rawName
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
  const withFallback = normalizedName || fallback

  return /^[A-Za-z_]/.test(withFallback) ? withFallback : `param_${withFallback}`
}

function normalizeInvokeParams(
  event: StoryCreationDraftEvent,
  warnings: string[]
) {
  const usedNames = new Set<string>()

  return (event.invoke_params ?? []).flatMap((param, index) => {
    const originalName = param.name.trim()
    if (!originalName) {
      return []
    }

    const baseName = makeIdentifier(originalName, `arg_${index + 1}`)
    let name = baseName
    let suffix = 2

    while (usedNames.has(name)) {
      name = `${baseName}_${suffix}`
      suffix += 1
    }

    usedNames.add(name)

    if (name !== originalName) {
      warnings.push(`事件 ${event.id} 的调用参数 ${originalName} 已规范为 ${name}。`)
    }

    return [{
      name,
      descr: param.descr
    }]
  })
}

function normalizeTriggerMode(
  event: StoryCreationDraftEvent,
  invokeParams: Array<{ name: string; descr?: string }>,
  warnings: string[]
): StoryEventTriggerMode {
  if (event.trigger_mode === "condition" && !event.trigger_expr.trim()) {
    warnings.push(`事件 ${event.id} 缺少条件表达式，已按默认触发应用。`)
    return "default"
  }

  return event.trigger_mode
}

function normalizeObjectKey(rawKey: string) {
  const trimmedKey = rawKey.trim()

  if (!trimmedKey || trimmedKey === "player") {
    return trimmedKey ? "player" : ""
  }

  const [namespace, rawId] = trimmedKey.split(":")
  if ((namespace === "normal" || namespace === "important") && rawId) {
    const normalizedId = makeLooseId(rawId)
    return normalizedId ? `${namespace}:${normalizedId}` : ""
  }

  return trimmedKey
}

function normalizeEventPeople(
  event: StoryCreationDraftEvent,
  availableRoleKeys: Set<string>,
  warnings: string[]
) {
  const objectKeys = new Set(
    event.object_keys.map(normalizeObjectKey).filter(Boolean)
  )

  for (const dialogue of getDraftPresentationDialogues(event.presentation)) {
    if (dialogue.speaker_type === "object") {
      const speakerKey = normalizeObjectKey(dialogue.speaker_key)
      if (speakerKey) {
        objectKeys.add(speakerKey)
      }
    }
  }

  const filteredObjectKeys = Array.from(objectKeys).filter((objectKey) => {
    if (objectKey === "player" || availableRoleKeys.has(objectKey)) {
      return true
    }

    warnings.push(`事件 ${event.id} 引用了未应用或不存在的角色 ${objectKey}，已从对象列表移除。`)
    return false
  })
  const objectKeySet = new Set(filteredObjectKeys)

  if (event.presentation.type !== "dialogue") {
    return {
      objectKeys: filteredObjectKeys,
      presentation: event.presentation
    }
  }

  const dialogues = event.presentation.dialogues.map((dialogue) => {
    if (dialogue.speaker_type === "player") {
      return {
        ...dialogue,
        speaker_key: "player" as const
      }
    }

    const speakerKey = normalizeObjectKey(dialogue.speaker_key)
    if (speakerKey && objectKeySet.has(speakerKey)) {
      return {
        ...dialogue,
        speaker_key: speakerKey
      }
    }

    warnings.push(`事件 ${event.id} 的对白说话人 ${dialogue.speaker_key} 不可用，已改为 player。`)
    return {
      ...dialogue,
      speaker_type: "player" as const,
      speaker_key: "player"
    }
  })

  return {
    objectKeys: filteredObjectKeys,
    presentation: {
      type: "dialogue" as const,
      dialogues
    }
  }
}

function normalizeLoopRule(
  event: StoryCreationDraftEvent,
  warnings: string[]
): StoryLoopRule {
  const loop = event.loop

  if (!loop) {
    warnings.push(`定时事件 ${event.id} 缺少 loop 规则，已使用 daily。`)
    return {
      mode: "daily",
      at: "00:00",
      priority: 100,
      after: [],
      before: []
    }
  }

  const orderFields = {
    at: normalizeScheduleAt(loop.at),
    priority: normalizeSchedulePriority(loop.priority),
    after: normalizeScheduleDependencyIds(loop.after).filter((id) => id !== event.id),
    before: normalizeScheduleDependencyIds(loop.before).filter((id) => id !== event.id)
  }

  if (loop.mode === "weekly") {
    return {
      mode: "weekly",
      ...orderFields,
      weekday: loop.weekday ?? 1
    }
  }

  if (loop.mode === "monthly") {
    return {
      mode: "monthly",
      ...orderFields,
      month_day: loop.month_day ?? 1
    }
  }

  if (loop.mode === "interval_days") {
    return {
      mode: "interval_days",
      ...orderFields,
      interval_days: loop.interval_days ?? 1
    }
  }

  return {
    mode: "daily",
    ...orderFields
  }
}

function toStoryEvent(
  event: StoryCreationDraftEvent,
  options: {
    availableChainIds: Set<string>
    availableLocationIds: Set<string>
    availableRoleKeys: Set<string>
    warnings: string[]
  }
): {
  collectionType: StoryEventCollectionType
  event: StoryEventFile | StoryOnceEventFile | StoryLoopEventFile
} {
  const invokeParams = normalizeInvokeParams(event, options.warnings)
  const triggerMode = normalizeTriggerMode(event, invokeParams, options.warnings)
  const people = normalizeEventPeople(event, options.availableRoleKeys, options.warnings)
  const location = event.location.trim()

  let normalizedLocation = location
  if (location && !options.availableLocationIds.has(location)) {
    options.warnings.push(`事件 ${event.id} 引用了未应用或不存在的地点 ${location}，已清空地点。`)
    normalizedLocation = ""
  }

  const baseEvent = {
    id: event.id,
    title: event.title,
    trigger_mode: triggerMode,
    trigger_expr: triggerMode === "condition" ? event.trigger_expr : "",
    invoke_params: triggerMode === "invoke" ? invokeParams : [],
    init_script: event.init_script,
    object_keys: people.objectKeys,
    presentation: people.presentation,
    location: normalizedLocation,
    end_script: event.end_script
  }

  if (event.collectionType === "chain") {
    const next = event.next.filter((nextId) => {
      if (options.availableChainIds.has(nextId)) {
        return true
      }

      options.warnings.push(`链式事件 ${event.id} 的后续 ${nextId} 未应用或不存在，已移除该连接。`)
      return false
    })

    return {
      collectionType: "chain",
      event: {
        node_type: "event",
        ...baseEvent,
        next
      }
    }
  }

  if (event.collectionType === "schedule") {
    return {
      collectionType: "schedule",
      event: {
        ...baseEvent,
        bgm: event.bgm ?? "",
        loop: normalizeLoopRule(event, options.warnings)
      }
    }
  }

  return {
    collectionType: "pool",
    event: {
      ...baseEvent,
      bgm: event.bgm ?? ""
    }
  }
}

export async function applyStoryCreationDraft(
  store: StoryFileStore,
  storyId: string,
  request: ApplyStoryCreationDraftRequest
): Promise<ApplyStoryCreationDraftResponse> {
  const draft = parseDraftForApply(request.draft)
  const selectedLocationIds = toSelectionSet(request.selection.locationIds)
  const selectedRoleKeys = toSelectionSet(request.selection.roleKeys ?? [])
  const selectedLegacyRoleIds = toSelectionSet(request.selection.roleIds ?? [])
  const selectedItemIds = toSelectionSet(request.selection.itemIds ?? [])
  const selectedPhonePersonalityIds = toSelectionSet(request.selection.phonePersonalityIds ?? [])
  const selectedPhoneTalkIds = toSelectionSet(request.selection.phoneTalkIds ?? [])
  const selectedPhoneActionIds = toSelectionSet(request.selection.phoneActionIds ?? [])
  const selectedPhoneReplyIds = toSelectionSet(request.selection.phoneReplyIds ?? [])
  const selectedPhoneContactProfileKeys = toSelectionSet(request.selection.phoneContactProfileKeys ?? [])
  const selectedPhoneConversationIds = toSelectionSet(request.selection.phoneConversationIds ?? [])
  const selectedDoingMenuIds = toSelectionSet(request.selection.doingMenuIds ?? [])
  const selectedDoingIds = toSelectionSet(request.selection.doingIds ?? [])
  const selectedShopCategoryIds = toSelectionSet(request.selection.shopCategoryIds ?? [])
  const selectedShopProductIds = toSelectionSet(request.selection.shopProductIds ?? [])
  const selectedEventKeys = toSelectionSet(request.selection.eventKeys)
  const selectedVariableKeys = toSelectionSet([
    ...(request.selection.variableKeys ?? []),
    ...(request.selection.variables ?? [])
  ])
  const story = await store.readStoryDocument(storyId)
  const warnings: string[] = [...draft.warnings]
  let appliedLocations = 0
  let appliedRoles = 0
  let appliedItems = 0
  let appliedVariables = 0
  let appliedPhonePersonalities = 0
  let appliedPhoneTalks = 0
  let appliedPhoneActions = 0
  let appliedPhoneReplies = 0
  let appliedPhoneContactProfiles = 0
  let appliedPhoneConversations = 0
  let appliedDoingMenus = 0
  let appliedDoings = 0
  let appliedShopCategories = 0
  let appliedShopProducts = 0

  const nextEventLocations: StoryEventLocationFile = {
    ...story.eventLocations,
    assignments: story.eventLocations.assignments
  }

  for (const location of draft.locations) {
    if (!selectedLocationIds.has(location.id)) {
      continue
    }

    const existingLocation = nextEventLocations.assignments.find((item) => item.id === location.id)
    nextEventLocations.assignments = upsertById(
      nextEventLocations.assignments,
      toEventLocationAssignment(location, existingLocation)
    )
    appliedLocations += 1
  }

  const nextRoles: StoryRolesFile = {
    normal: {
      ...story.roles.normal,
      roles: story.roles.normal.roles
    },
    important: {
      ...story.roles.important,
      roles: story.roles.important.roles
    }
  }

  for (const role of draft.roles) {
    if (!selectedRoleKeys.has(draftRoleKey(role)) && !selectedLegacyRoleIds.has(role.id)) {
      continue
    }

    if (role.important) {
      const existingRole = nextRoles.important.roles.find((item) => item.id === role.id)
      nextRoles.important.roles = upsertById(
        nextRoles.important.roles,
        toImportantRole(role, existingRole)
      )
    } else {
      const existingRole = nextRoles.normal.roles.find((item) => item.id === role.id)
      nextRoles.normal.roles = upsertById(
        nextRoles.normal.roles,
        toNormalRole(role, existingRole)
      )
    }

    appliedRoles += 1
  }

  const nextItems: StoryItemsFile = {
    ...story.items,
    categories: story.items.categories,
    items: story.items.items
  }
  const itemCategoryIds = new Set(nextItems.categories.map((category) => category.id))

  for (const item of draft.items) {
    if (!selectedItemIds.has(item.id)) {
      continue
    }

    if (!itemCategoryIds.has(item.category_id)) {
      warnings.push(`物品 ${item.id} 引用了不存在的分类 ${item.category_id}，未写入 items.json5。`)
      continue
    }

    const existingItem = nextItems.items.find((existing) => existing.id === item.id)
    nextItems.items = upsertById(
      nextItems.items,
      toStoryItem(item, existingItem)
    )
    appliedItems += 1
  }

  const selectedEvents = draft.events.filter((event) => selectedEventKeys.has(draftEventKey(event)))
  const availableChainIds = new Set([
    ...story.chainEvents.map((event) => event.id),
    ...selectedEvents
      .filter((event) => event.collectionType === "chain")
      .map((event) => event.id)
  ])
  const availableEventIdsByType = {
    chain: availableChainIds,
    pool: new Set([
      ...story.poolEvents.map((event) => event.id),
      ...selectedEvents
        .filter((event) => event.collectionType === "pool")
        .map((event) => event.id)
    ]),
    schedule: new Set([
      ...story.scheduleEvents.map((event) => event.id),
      ...selectedEvents
        .filter((event) => event.collectionType === "schedule")
        .map((event) => event.id)
    ])
  } satisfies Record<"chain" | "pool" | "schedule", Set<string>>
  const availableLocationIds = new Set(nextEventLocations.assignments.map((location) => location.id))
  const availableRoleKeys = collectAvailableRoleKeys(nextRoles)
  const availableItemIds = new Set(nextItems.items.map((item) => item.id))
  const eventsToWrite = selectedEvents.map((event) =>
    toStoryEvent(event, {
      availableChainIds,
      availableLocationIds,
      availableRoleKeys,
      warnings
    })
  )

  const nextPhone: StoryPhoneFile = {
    ...story.phone,
    personality_library: story.phone.personality_library,
    talk_library: story.phone.talk_library,
    action_library: story.phone.action_library,
    reply_library: story.phone.reply_library,
    player_quick_messages: story.phone.player_quick_messages,
    contact_profiles: story.phone.contact_profiles
  }
  const availablePhonePersonalityIds = new Set(nextPhone.personality_library.map((personality) => personality.id))

  for (const personality of draft.phone?.personality_library ?? []) {
    if (!selectedPhonePersonalityIds.has(personality.id)) {
      continue
    }

    nextPhone.personality_library = upsertById(nextPhone.personality_library, personality)
    availablePhonePersonalityIds.add(personality.id)
    appliedPhonePersonalities += 1
  }

  for (const entry of draft.phone?.talk_library ?? []) {
    if (!selectedPhoneTalkIds.has(entry.id)) {
      continue
    }

    const nextEntry = filterPhoneInvokeForApply(
      {
        ...entry,
        scope: filterPhoneScopeForApply(entry.scope, {
          availablePersonalityIds: availablePhonePersonalityIds,
          availableRoleKeys,
          label: `联系人闲聊 ${entry.id}`,
          warnings
        })
      },
      {
        availableEventIdsByType,
        label: `联系人闲聊 ${entry.id}`,
        warnings
      }
    )

    nextPhone.talk_library = upsertById(nextPhone.talk_library, nextEntry)
    appliedPhoneTalks += 1
  }

  for (const entry of draft.phone?.action_library ?? []) {
    if (!selectedPhoneActionIds.has(entry.id)) {
      continue
    }

    const nextEntry = filterPhoneInvokeForApply(
      filterPhoneActionCostItems(
        {
          ...entry,
          scope: filterPhoneScopeForApply(entry.scope, {
            availablePersonalityIds: availablePhonePersonalityIds,
            availableRoleKeys,
            label: `联系人动作 ${entry.id}`,
            warnings
          })
        },
        availableItemIds,
        warnings
      ),
      {
        availableEventIdsByType,
        label: `联系人动作 ${entry.id}`,
        warnings
      }
    )

    nextPhone.action_library = upsertById(nextPhone.action_library, nextEntry)
    appliedPhoneActions += 1
  }

  for (const entry of draft.phone?.reply_library ?? []) {
    if (!selectedPhoneReplyIds.has(entry.id)) {
      continue
    }

    const nextEntry = {
      ...entry,
      scope: filterPhoneScopeForApply(entry.scope, {
        availablePersonalityIds: availablePhonePersonalityIds,
        availableRoleKeys,
        label: `联系人回复 ${entry.id}`,
        warnings
      })
    }

    nextPhone.reply_library = upsertById(nextPhone.reply_library, nextEntry)
    appliedPhoneReplies += 1
  }

  for (const profile of draft.phone?.contact_profiles ?? []) {
    if (!selectedPhoneContactProfileKeys.has(profile.role_key)) {
      continue
    }

    if (!availableRoleKeys.has(profile.role_key) || profile.role_key === "player") {
      warnings.push(`联系人配置 ${profile.role_key} 引用了不存在或未应用的 NPC 角色，未写入 phone.json5。`)
      continue
    }

    const existingProfile = nextPhone.contact_profiles.find((item) => item.role_key === profile.role_key)
    nextPhone.contact_profiles = upsertByKey(
      nextPhone.contact_profiles,
      mergePhoneContactProfile(profile, existingProfile),
      (item) => item.role_key
    )
    appliedPhoneContactProfiles += 1
  }

  const nextPhoneConversations: StoryPhoneConversationsFile = {
    conversations: story.phoneConversations.conversations
  }

  for (const conversation of draft.phoneConversations?.conversations ?? []) {
    if (!selectedPhoneConversationIds.has(conversation.id)) {
      continue
    }

    if (!availableRoleKeys.has(conversation.role_key) || conversation.role_key === "player") {
      warnings.push(`剧情手机对话 ${conversation.id} 引用了不存在或未应用的 NPC 角色 ${conversation.role_key}，未写入 phone_conversations.json5。`)
      continue
    }

    const nextConversation = filterPhoneConversationInvokeForApply(conversation, {
      availableEventIdsByType,
      warnings
    })

    nextPhoneConversations.conversations = upsertById(
      nextPhoneConversations.conversations,
      nextConversation
    )
    appliedPhoneConversations += 1
  }

  const nextDoing: StoryDoingFile = {
    menus: story.doing.menus,
    doings: story.doing.doings
  }
  const availableDoingMenuIdsForMenus = new Set([
    ...story.doing.menus.map((menu) => menu.id),
    ...(draft.doing?.menus ?? [])
      .filter((menu) => selectedDoingMenuIds.has(menu.id))
      .map((menu) => menu.id)
  ])

  for (const menu of draft.doing?.menus ?? []) {
    if (!selectedDoingMenuIds.has(menu.id)) {
      continue
    }

    nextDoing.menus = upsertById(
      nextDoing.menus,
      normalizeDoingMenuForApply(menu, availableDoingMenuIdsForMenus, warnings)
    )
    appliedDoingMenus += 1
  }

  const availableDoingMenuIds = new Set(nextDoing.menus.map((menu) => menu.id))
  for (const doing of draft.doing?.doings ?? []) {
    if (!selectedDoingIds.has(doing.id)) {
      continue
    }

    const nextDoingDefinition = normalizeDoingForApply(doing, {
      availableLocationIds,
      availableMenuIds: availableDoingMenuIds,
      availableRoleKeys,
      warnings
    })

    if (!nextDoingDefinition) {
      continue
    }

    nextDoing.doings = upsertById(nextDoing.doings, nextDoingDefinition)
    appliedDoings += 1
  }

  const nextShop = {
    ...story.shop,
    categories: story.shop.categories,
    products: story.shop.products
  }

  for (const category of draft.shop?.categories ?? []) {
    if (!selectedShopCategoryIds.has(category.id)) {
      continue
    }

    nextShop.categories = upsertById(nextShop.categories, category)
    appliedShopCategories += 1
  }

  const availableShopCategoryIds = new Set(nextShop.categories.map((category) => category.id))
  for (const product of draft.shop?.products ?? []) {
    if (!selectedShopProductIds.has(product.id)) {
      continue
    }

    const nextProduct = normalizeShopProductForApply(product, {
      availableItemIds,
      availableShopCategoryIds,
      warnings
    })

    if (!nextProduct) {
      continue
    }

    nextShop.products = upsertById(nextShop.products, nextProduct)
    appliedShopProducts += 1
  }

  if (appliedLocations > 0) {
    await store.writeEventLocations(storyId, nextEventLocations)
  }

  if (appliedRoles > 0) {
    await store.writeRoles(storyId, nextRoles)
  }

  if (appliedItems > 0) {
    await store.writeItems(storyId, nextItems)
  }

  for (const item of eventsToWrite) {
    await store.writeEvent(storyId, item.event.id, item.event, item.collectionType)
  }

  if (
    appliedPhonePersonalities > 0
    || appliedPhoneTalks > 0
    || appliedPhoneActions > 0
    || appliedPhoneReplies > 0
    || appliedPhoneContactProfiles > 0
  ) {
    await store.writePhone(storyId, nextPhone)
  }

  if (appliedPhoneConversations > 0) {
    await store.writePhoneConversations(storyId, nextPhoneConversations)
  }

  if (appliedDoingMenus > 0 || appliedDoings > 0) {
    await store.writeDoing(storyId, nextDoing)
  }

  if (appliedShopCategories > 0 || appliedShopProducts > 0) {
    await store.writeShop(storyId, nextShop)
  }

  if (selectedVariableKeys.size > 0) {
    const nextVals = cloneStoryValsFile(story.vals)

    for (const variable of draft.variables) {
      if (!selectedVariableKeys.has(draftVariableKey(variable))) {
        continue
      }

      if (applyDraftVariable(nextVals, variable, warnings)) {
        appliedVariables += 1
      }
    }

    if (appliedVariables > 0) {
      await store.writeVals(storyId, nextVals)
    }
  }

  const nextStory = await store.readStoryDocument(storyId)

  return {
    story: nextStory,
    result: validateStoryDocument(nextStory),
    applied: {
      events: eventsToWrite.length,
      locations: appliedLocations,
      roles: appliedRoles,
      items: appliedItems,
      variables: appliedVariables,
      phonePersonalities: appliedPhonePersonalities,
      phoneTalks: appliedPhoneTalks,
      phoneActions: appliedPhoneActions,
      phoneReplies: appliedPhoneReplies,
      phoneContactProfiles: appliedPhoneContactProfiles,
      phoneConversations: appliedPhoneConversations,
      doingMenus: appliedDoingMenus,
      doings: appliedDoings,
      shopCategories: appliedShopCategories,
      shopProducts: appliedShopProducts
    },
    warnings
  }
}

export async function generateStoryEventDialogues(
  settings: AppSettingsFile,
  story: StoryDocument,
  request: GenerateStoryDialogueRequest,
  signal?: AbortSignal
): Promise<GenerateStoryDialogueResponse> {
  const instruction = request.instruction.trim()

  if (!instruction) {
    throw new FileStoreError(
      "Dialogue instruction is required.",
      400,
      "ai.dialogue-instruction-required"
    )
  }

  const collectionType = normalizeDialogueGenerationCollectionType(request.collectionType)
  const event = request.event

  if (event.presentation.type !== "dialogue") {
    throw new FileStoreError(
      "Only dialogue presentation events can generate dialogues.",
      400,
      "ai.dialogue-presentation-required"
    )
  }

  const agent = requireAgentSettings(settings)
  const dialogueModel = createChatModel(agent, "eventWriterModel")
  const prompt = [
    `你是 Story Manager 的对白润色 Agent。`,
    "项目目标：把网络小说变成玩家可以代入主角、可以选择、可以演进的开放游戏。",
    "你负责为单个事件补充对白，不要改写事件结构，不要生成地点、角色、变量、物品或脚本。",
    "输出必须是结构化对白列表，用于直接覆盖当前事件的对白内容。",
    "只处理对白事件；silent 和 message 不在本次任务范围内。",
    "对白要服务游戏推进，而不是长篇小说独白。",
    "要结合故事背景、当前篇章、事件触发方式、对象角色、地点和现有脚本语义来写。",
    "必须保留玩家代入感。涉及主角说话时，speaker_type 用 player，speaker_key 固定为 player。",
    "事件对象说话时，speaker_type 用 object，speaker_key 必须是 player 以外的现有 object key。",
    "对白应该自然、短促、可点击推进。避免一条对白过长。",
    "如当前事件对象里没有合适的说话人，不要凭空新增角色，只在 player 和现有对象里分配。",
    "可以复用 `${group.value}` 这样的占位符，但只在确有必要时使用，且不要编造不存在的变量。",
    "涉及玩家性别差异的称呼、自称和代词时，优先使用 `${term.xxx}` 称谓库占位符，例如 `${term.player.respect}`、`${term.player.self_proud}`；不要硬编码先生/女士/少爷/小姐。",
    "默认覆盖当前对白，因此输出需要是完整版本，而不是增量 patch。",
    "如果用户想要大致对白风格，你要把它落成可直接运行的对白序列。",
    "",
    "【创作设定】",
    formatStoryBible(story),
    "",
    "【现有变量、称谓与资产上下文】",
    formatExistingVariables(story, instruction, null),
    "",
    formatExistingAssets(story, instruction, null),
    "",
    formatExistingPhoneAndDoing(story),
    "",
    "【事件上下文】",
    summarizeEventForDialogueGeneration(story, collectionType, event),
    "",
    "【用户对白指令】",
    instruction
  ].join("\n")

  const output = await invokeStructured(
    "eventWriter",
    dialogueModel,
    generatedDialogueSchema,
    prompt,
    signal
  )

  const allowedObjectKeys = new Set(event.object_keys.map((key) => key.trim()).filter(Boolean))
  const dialogues = output.dialogues.map((dialogue) => {
    if (dialogue.speaker_type === "player") {
      return {
        speaker_type: "player" as const,
        speaker_key: "player",
        content: dialogue.content.trim()
      }
    }

    const normalizedKey = normalizeDialogueSpeakerKey(story.roles, dialogue)

    if (!normalizedKey || normalizedKey === "player" || !allowedObjectKeys.has(normalizedKey)) {
      return {
        speaker_type: "player" as const,
        speaker_key: "player",
        content: dialogue.content.trim()
      }
    }

    return {
      speaker_type: "object" as const,
      speaker_key: normalizedKey,
      content: dialogue.content.trim()
    }
  }).filter((dialogue) => dialogue.content.length > 0)

  if (dialogues.length === 0) {
    throw new FileStoreError(
      "Dialogue agent returned an empty dialogue list.",
      502,
      "ai.dialogue-empty"
    )
  }

  const warnings = [...output.warnings]
  if (event.object_keys.length === 0) {
    warnings.push("当前事件没有配置对象角色，AI 只能围绕主角输出对白。")
  }

  return {
    summary: output.summary.trim(),
    dialogues,
    warnings
  }
}

export async function runStoryCreationAgents(
  settings: AppSettingsFile,
  story: StoryDocument,
  instruction: string,
  baseDraft?: StoryCreationDraft,
  signal?: AbortSignal
): Promise<RunStoryCreationAgentResponse> {
  const normalizedInstruction = instruction.trim()

  if (!normalizedInstruction) {
    throw new FileStoreError("Creation instruction is required.", 400, "ai.agent-instruction-required")
  }

  const normalizedBaseDraft = baseDraft ? parseDraftForApply(baseDraft) : null
  const agent = requireAgentSettings(settings)
  const chiefEditorModel = createChatModel(agent, "chiefEditorModel")
  const plotPlannerModel = createChatModel(agent, "plotPlannerModel")
  const assetDesignerModel = createChatModel(agent, "assetDesignerModel")
  const eventWriterModel = createChatModel(agent, "eventWriterModel")
  const scriptDoctorModel = createChatModel(agent, "scriptDoctorModel")
  const consistencyCheckerModel = createChatModel(agent, "consistencyCheckerModel")

  const chiefEditor = async (state: CreationStateValue) => {
    const output = await invokeStructured(
      "chiefEditor",
      chiefEditorModel,
      chiefEditorOutputSchema,
      [
        buildBasePrompt("总主编", state),
        state.baseDraft
          ? "你的任务：把用户反馈转成可执行修订简报，明确当前草稿需要保留、增强、删除或重写的部分。"
          : "你的任务：把用户指令转成可执行创作简报，明确本次要解决的可玩体验、爽点、玩家选择空间和风险。",
        "如果用户要求修改或统计数值，必须区分只读 calc 汇总和可写 value 分项；不要把普通 value 变量写回误判为引擎不支持。",
        "请避免只给文学大纲，必须面向后续结构化事件生成。"
      ].join("\n\n"),
      signal
    )

    return {
      creativeBrief: [
        output.creativeBrief,
        "",
        "目标:",
        ...output.goals.map((goal) => `- ${goal}`),
        "",
        "风险:",
        ...output.risks.map((risk) => `- ${risk}`)
      ].join("\n"),
      logs: [createLog("chiefEditor", output.log)]
    }
  }

  const plotPlanner = async (state: CreationStateValue) => {
    const output = await invokeStructured(
      "plotPlanner",
      plotPlannerModel,
      plotPlannerOutputSchema,
      [
        buildBasePrompt("剧情规划", state),
        `总主编简报:\n${state.creativeBrief}`,
        state.baseDraft
          ? "你的任务：根据反馈修订剧情规划。要说明如何调整现有事件、变量、地点和角色，避免无必要地重建整批草稿。"
          : "你的任务：规划一个可以进入游戏事件数据的短篇章。必须写出玩家可选分歧，而不是单向剧情段落。",
        "涉及规则数值时，把读 calc、写 value 的落地路径写清楚；例如总人口是 calc 时，应写年轻/儿童/老人等 value 分项。"
      ].join("\n\n"),
      signal
    )

    return {
      plotPlan: buildPlotPlanText(output),
      logs: [createLog("plotPlanner", output.log)]
    }
  }

  const assetDesigner = async (state: CreationStateValue) => {
    const output = await invokeStructured(
      "assetDesigner",
      assetDesignerModel,
      assetDesignerOutputSchema,
      [
        buildBasePrompt("资产设计", state),
        `总主编简报:\n${state.creativeBrief}`,
        `剧情规划:\n${state.plotPlan}`,
        state.baseDraft
          ? "你的任务：检查当前草稿的地点、角色和物品是否足够支撑反馈要求。优先保留已有 id；只在确有必要时新增或调整资产草稿。物品必须引用已有分类。"
          : "你的任务：为本次生成内容提出必要的地点、角色和物品草稿。优先复用已有资产；确需新增时给出可落地 id、说明和英文美术提示词。物品必须引用已有分类。"
      ].join("\n\n"),
      signal
    )

    return {
      assetPlan: buildAssetPlanText(output),
      logs: [createLog("assetDesigner", output.log)]
    }
  }

  const eventWriter = async (state: CreationStateValue) => {
      const output = await invokeStructured(
        "eventWriter",
        eventWriterModel,
        eventWriterOutputSchema,
        [
          buildBasePrompt("事件写作", state),
          buildStoryScriptPromptSection(),
          `总主编简报:\n${state.creativeBrief}`,
          `剧情规划:\n${state.plotPlan}`,
          `资产规划:\n${state.assetPlan}`,
          state.baseDraft
            ? "你的任务：基于当前待优化草稿输出完整修订版。除非反馈要求重做，否则保留已有 id、变量 key、角色 key、事件 next、集合类型和已有非空脚本；脚本如需调整，优先改写成符合 StoryScript.md 的版本，不得静默清空。"
            : "你的任务：生成可预览的结构化剧情草稿，默认 3 到 8 个事件。",
          "chain 事件可以通过 next 组成小剧情线；pool 事件必须是可被 AI 剧情导演挑选的平面事件；schedule 事件必须适合时间循环。",
          "生成 schedule 事件时必须显式配置 loop.at、loop.priority、loop.after、loop.before；同一时间点需要业务顺序时优先用 after 表达硬依赖，再用 priority 做排序。",
        "如果事件需要持久化改变数值，优先在 init_script 或 end_script 写普通 value 变量；可以读取 calc 变量参与计算，但不能给 calc 变量赋值。",
        "如果用户要求改变一个 calc 汇总，例如人口总量，应写入它依赖的普通 value 分项；如现有分项不足，在 variables 中新增普通 value 变量并在脚本中引用。",
        "写 init_script/end_script 时，非空脚本必须包含中文注释。注释至少覆盖：规则目的、关键变量含义、核心公式含义、写回目标。不要只输出一串无解释的 Math 公式。",
        "如剧情涉及玩家获得、消耗或检查物品，在 init_script/end_script/操作脚本中使用 bag_add、bag_remove、bag_count、bag_has；不要在事件 JSON 中新增奖励或消耗字段。",
        "如果本次内容涉及普通手机联系人关系、短句、联系人动作、NPC 回复、主动消息或联系人特配，必须写入 draft.phone 对应数组；不要只在 notes 中描述。",
        "如果本次内容涉及强连续剧情手机对话，例如 NPC 发消息、玩家固定回复、NPC 接着回复、结束后延迟调用后续事件，必须写入 draft.phoneConversations.conversations；不要用普通 proactive_messages 或普通闲聊短句模拟强连续剧情。",
        "如果本次内容涉及玩家主动可选入口，例如去县长办公室、KTV、会所、购物送礼、约会地点等，必须写入 draft.doing.menus 和 draft.doing.doings；doing 事件内容复用平面事件结构，但没有 trigger_mode、trigger_expr、invoke_params。",
        "如果本次内容涉及商城上架、购买、送礼商品、购物入口或商品展示条件，必须写入 draft.shop.categories 和 draft.shop.products；商城商品只能引用已有或本次新增物品，不能在 shop 里直接创建物品资产。",
        "draft.phone、draft.phoneConversations、draft.doing 和 draft.shop 是结构化输出的一部分；没有新增内容时也要保留空数组。不要直接写入文件。输出的 draft 必须包含本次相关地点、角色、物品、事件、变量建议、手机联系人资产、剧情手机对话、行动资产、商城资产和风险说明。"
      ].join("\n\n"),
      signal
    )

    return {
      draft: normalizeDraft(normalizeStructuredDraft(output.draft)),
      logs: [createLog("eventWriter", output.log)]
    }
  }

    const repairDraftScripts = async (
      state: CreationStateValue,
      draft: StoryCreationDraft,
      reason: string
    ): Promise<{ draft: StoryCreationDraft; logLines: string[] }> => {
      let currentDraft = normalizeDraft(draft)
      const logLines: string[] = []
      const initialPreserved = preserveBaseDraftScripts(state.baseDraft, currentDraft, state.instruction)
      currentDraft = initialPreserved.draft
      logLines.push(...initialPreserved.messages)

      for (let attempt = 1; attempt <= SCRIPT_VALIDATION_REPAIR_ATTEMPTS; attempt += 1) {
        const validationIssues = collectDraftStoryScriptValidationIssues(story, currentDraft)

      if (validationIssues.length === 0) {
        if (attempt > 1) {
          logLines.push("确定性 StoryScript 校验已通过。")
        }

        return {
          draft: currentDraft,
          logLines
        }
      }

      const formattedIssues = formatDraftStoryScriptValidationIssues(validationIssues)
      logLines.push(`第 ${attempt} 轮确定性校验发现 ${validationIssues.length} 个问题:\n${formattedIssues}`)

        const output = await invokeStructured(
          "scriptDoctor",
          scriptDoctorModel,
          scriptDoctorOutputSchema,
          [
            buildBasePrompt("脚本审校", state),
            buildStoryScriptPromptSection(),
            `触发原因: ${reason}`,
            `确定性 StoryScript 校验错误:\n${formattedIssues}`,
            `待修复草稿:\n${formatDraftForAgent(currentDraft, 18000)}`,
            "你的任务：只修复脚本、触发条件和文本占位符相关问题，输出完整 draft。",
            "必须按照每条确定性校验错误修改；不要用删除事件、删除变量、清空所有脚本来逃避问题。",
            "如果当前待优化草稿里同一事件已有非空 init_script 或 end_script，而用户没有明确要求删除，你必须保留或修正它，不能把它清空。",
            "如果脚本写入 calc、system.* 或 call.*，改成写普通 value 变量；如果引用不存在的物品 id，优先改为现有物品或本次 items 草稿里的合法 id。",
            "invoke_once 必须按 StoryScript 保留语句修复，例如 `invoke_once chain event_id delay_days=1`；不要修成 JS 函数调用，不要使用括号、逗号、对象字面量或冒号参数。",
            "trigger_mode=invoke 允许 invoke_params 为空；如果目标事件不需要调用参数，保留 invoke 触发和空数组，不要降级为 default。",
            "如果 phone 主动消息 trigger_expr、phoneConversations trigger_expr/visible_expr/script/end_script、doing visible_expr、doing init_script/end_script、shop visible_expr/available_expr 不符合 StoryScript.md，也要一并修复。",
            "修复脚本时必须保留 draft.phone、draft.phoneConversations、draft.doing 和 draft.shop 的结构化资产；除非用户明确要求删除，不要把手机短句、剧情手机对话、联系人动作、行动菜单、行动事件、商城分类或商城商品清空。",
            "非空过程脚本必须保留中文注释，解释变量来源、计算规则和写回目标。"
          ].join("\n\n"),
          signal
        )

        currentDraft = normalizeDraft(normalizeStructuredDraft(output.draft))
        const preserved = preserveBaseDraftScripts(state.baseDraft, currentDraft, state.instruction)
        currentDraft = preserved.draft
        logLines.push(
          [
            `第 ${attempt} 轮修复说明: ${output.log}`,
            ...output.issues.map((issue) => `修复提示: ${issue}`),
            ...preserved.messages
          ].join("\n")
        )
      }

    const remainingIssues = collectDraftStoryScriptValidationIssues(story, currentDraft)

    if (remainingIssues.length > 0) {
      throw new FileStoreError(
        `Script doctor could not fix StoryScript validation issues:\n${formatDraftStoryScriptValidationIssues(remainingIssues)}`,
        502,
        "ai.agent-script-validation-failed"
      )
    }

    return {
      draft: currentDraft,
      logLines
    }
  }

  const scriptDoctor = async (state: CreationStateValue) => {
    if (!state.draft) {
      throw new FileStoreError("Event writer did not return a draft.", 502, "ai.agent-empty-draft")
    }

      const output = await invokeStructured(
        "scriptDoctor",
        scriptDoctorModel,
        scriptDoctorOutputSchema,
        [
          buildBasePrompt("脚本审校", state),
          buildStoryScriptPromptSection(),
          `待审校草稿:\n${formatDraftForAgent(state.draft, 16000)}`,
          "你的任务：检查 init_script、end_script、trigger_expr、dialogue 占位符是否保守可用。",
          "脚本权限审校重点：普通全局 value 变量可写；calc、system.*、call.* 不可写。发现写 calc 汇总时，改为写其 calc_rule 依赖的普通 value 分项。",
          "脚本可读性审校重点：非空过程脚本必须保留或补充中文注释，说明规则意图、变量来源、计算依据和写回结果；不要删除有用注释。",
          "不要因为脚本涉及持久化变量写入就清空脚本；只有无法确定具体 value 写入目标时才允许对全新脚本留空并说明需要新增变量。",
          "如果当前待优化草稿里同一事件已有非空 init_script 或 end_script，而用户没有明确要求删除，你必须保留或修正它，不能清空。",
          "phone 主动消息 trigger_expr、phoneConversations trigger_expr/visible_expr/script/end_script、doing visible_expr、doing init_script/end_script、shop visible_expr/available_expr 也属于脚本审校范围。",
          "脚本是否支持，必须以 StoryScript.md 和确定性静态校验为准；不要自行声称“规范未说明”来回避修复。",
          "invoke_once 是 StoryScript 保留语句，合法格式是 `invoke_once chain event_id delay_days=1 param=${group.name}`；禁止写成 `invoke_once(\"chain\", \"event_id\", { delay_days: 1 })`。",
          "trigger_mode=invoke 的事件可以没有 invoke_params；无参数调用事件仍然必须保持 invoke，不能因为参数为空改成 default。",
          "输出完整 draft 时必须保留 phone、phoneConversations、doing 和 shop 字段。没有相关内容时填空数组；有相关内容时不要把结构化资产降级成 notes。"
        ].join("\n\n"),
        signal
      )

    const repaired = await repairDraftScripts(
      state,
      normalizeDraft(normalizeStructuredDraft(output.draft)),
      "脚本审校 Agent 输出后校验"
    )

    return {
      draft: repaired.draft,
      logs: [
        createLog(
          "scriptDoctor",
          [
            output.log,
            ...output.issues.map((issue) => `问题: ${issue}`),
            ...repaired.logLines
          ].join("\n")
        )
      ]
    }
  }

  const consistencyChecker = async (state: CreationStateValue) => {
    if (!state.draft) {
      throw new FileStoreError("Script doctor did not return a draft.", 502, "ai.agent-empty-draft")
    }

    const output = await invokeStructured(
      "consistencyChecker",
      consistencyCheckerModel,
      consistencyCheckerOutputSchema,
      [
        buildBasePrompt("一致性检查", state),
        `待检查草稿:\n${formatDraftForAgent(state.draft, 16000)}`,
        "你的任务：检查角色引用、地点引用、物品分类、事件 next、触发方式、手机联系人资产、剧情手机对话、行动菜单/行动事件、商城分类/商品和玩家自由度是否一致。",
        "手机联系人检查重点：contact_profiles.role_key 必须是现有或本次生成 NPC 角色；短句/动作/回复的 scope 不要引用不存在的性格或角色；invoke 目标必须是现有或本次生成事件。",
        "剧情手机对话检查重点：phoneConversations.conversations[].role_key 必须是现有或本次生成 NPC 角色；entry_node_id 和 next_node_id 必须引用本对话节点；结束节点 invoke 目标必须是现有或本次生成事件；强连续剧情不要降级到普通 proactive_messages。",
        "行动检查重点：doing.doings[].menu_id 必须引用现有或本次生成菜单；visible_expr 用 StoryScript 条件表达式；行动没有 trigger_mode、trigger_expr、invoke_params。",
        "商城检查重点：shop.products[].category_id 必须引用现有或本次生成商城分类；item_id 必须引用现有物品或本次生成物品；available_expr/visible_expr 用 StoryScript 条件表达式。",
        "如果剧情或手机消息承诺玩家可以主动去某处做某事，应确认草稿里有对应 doing 入口，或在 warnings 中说明为什么本次不生成。",
        "如果剧情、行动或手机联系人承诺玩家能购买/送礼某件商品，应确认草稿里有对应 shop 商品，或在 warnings 中说明为什么只复用现有商品。",
        "保留草稿预览性质，不要声称已经写入数据文件。"
      ].join("\n\n"),
      signal
    )

    const draft = normalizeDraft(normalizeStructuredDraft(output.draft))
    const draftWithWarnings = {
      ...draft,
      warnings: [...draft.warnings, ...output.warnings]
    }
    const repaired = await repairDraftScripts(
      state,
      draftWithWarnings,
      "一致性检查 Agent 输出后校验"
    )
    const logs = [createLog("consistencyChecker", output.log)]

    if (repaired.logLines.length > 0) {
      logs.push(createLog("scriptDoctor", repaired.logLines.join("\n")))
    }

    return {
      draft: repaired.draft,
      logs
    }
  }

  const graph = new StateGraph(CreationState)
    .addNode("chiefEditor", chiefEditor)
    .addNode("plotPlanner", plotPlanner)
    .addNode("assetDesigner", assetDesigner)
    .addNode("eventWriter", eventWriter)
    .addNode("scriptDoctor", scriptDoctor)
    .addNode("consistencyChecker", consistencyChecker)
    .addEdge(START, "chiefEditor")
    .addEdge("chiefEditor", "plotPlanner")
    .addEdge("plotPlanner", "assetDesigner")
    .addEdge("assetDesigner", "eventWriter")
    .addEdge("eventWriter", "scriptDoctor")
    .addEdge("scriptDoctor", "consistencyChecker")
    .addEdge("consistencyChecker", END)
    .compile()

  const result = await graph.invoke({
    assetPlan: "",
    baseDraft: normalizedBaseDraft,
    creativeBrief: "",
    draft: null,
    instruction: normalizedInstruction,
    logs: [],
    plotPlan: "",
    storyContext: buildStoryContext(story, normalizedInstruction, normalizedBaseDraft),
    storyTitle: story.story.title
  }, signal ? { signal } : undefined)

  if (!result.draft) {
    throw new FileStoreError("Agent workflow returned an empty draft.", 502, "ai.agent-empty-draft")
  }

  return {
    draft: normalizeDraft(result.draft),
    logs: result.logs
  }
}
