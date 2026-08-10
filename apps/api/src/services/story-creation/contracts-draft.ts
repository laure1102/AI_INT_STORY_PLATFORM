/**
 * 创作草稿及其领域 Schema。
 *
 * 本模块从原创作服务按顶层依赖拆出；不会单独写故事文件。
 */
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
  type StoryContactActionLibraryEntry,
  type StoryContactProfile,
  type StoryContactConversationDefinition,
  type StoryContactConversationsFile,
  type StoryContactFile,
  type StoryContactPersonalityDefinition,
  type StoryContactReplyLibraryEntry,
  type StoryContactTalkLibraryEntry,
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
  StoryCreationDraftContact,
  StoryCreationDraftContactConversations,
  StoryCreationDraftPresentation,
  StoryCreationDraftRole,
  StoryCreationDraftShop,
  StoryCreationDraftVariable
} from "@story-mgr/shared"
import { z } from "zod"
import {
  createStoryCreationModelConfig,
  type StoryCreationWorkflowObserver,
  type StoryCreationWorkflowOptions
} from "../story-creation-workflow"


export type {
  StoryCreationWorkflowObserver,
  StoryCreationWorkflowOptions
} from "../story-creation-workflow"

export type AgentModelKey =
  | "chiefEditorModel"
  | "plotPlannerModel"
  | "assetDesignerModel"
  | "eventWriterModel"
  | "scriptDoctorModel"
  | "consistencyCheckerModel"

export interface RequiredAgentSettings extends AppAiAgentSettings {
  baseUrl: string
  apiKey: string
}

export const ROLE_MODEL_KEYS: AgentModelKey[] = [
  "chiefEditorModel",
  "plotPlannerModel",
  "assetDesignerModel",
  "eventWriterModel",
  "scriptDoctorModel",
  "consistencyCheckerModel"
]

export const ROLE_TITLES: Record<StoryCreationAgentRole, string> = {
  chiefEditor: "总主编",
  plotPlanner: "剧情规划",
  assetDesigner: "资产设计",
  eventWriter: "事件写作",
  scriptDoctor: "脚本审校",
  consistencyChecker: "一致性检查"
}

export const ROLE_ERROR_CODES: Record<StoryCreationAgentRole, string> = {
  chiefEditor: "ai.agent-chief-editor-failed",
  plotPlanner: "ai.agent-plot-planner-failed",
  assetDesigner: "ai.agent-asset-designer-failed",
  eventWriter: "ai.agent-event-writer-failed",
  scriptDoctor: "ai.agent-script-doctor-failed",
  consistencyChecker: "ai.agent-consistency-checker-failed"
}

export const RELEVANT_ITEM_DETAIL_LIMIT = 40

export const RELEVANT_VARIABLE_DETAIL_LIMIT = 40

export const MAX_ITEM_SEARCH_TERMS = 180

export const MAX_VARIABLE_SEARCH_TERMS = 180

export const SCRIPT_VALIDATION_REPAIR_ATTEMPTS = 2

export const STRUCTURED_OUTPUT_PARSE_RETRY_ATTEMPTS = 2

export const STORYSCRIPT_PROMPT_SECTION_MAX_CHARS = 14000

export const STORYSCRIPT_DOC_PATH = resolve(process.cwd(), "StoryScript.md")

export const SCRIPT_REMOVAL_INTENT_PATTERNS = [
  /(清空|删除|移除|去掉|禁用|取消|不要|留空).{0,10}(初始化脚本|结束脚本|条件脚本|trigger_expr|init_script|end_script|脚本)/i,
  /(初始化脚本|结束脚本|条件脚本|trigger_expr|init_script|end_script|脚本).{0,10}(清空|删除|移除|去掉|禁用|取消|不要|留空)/i,
  /\b(remove|delete|clear|disable)\b.{0,12}\b(script|init_script|end_script|trigger_expr)\b/i,
  /\b(script|init_script|end_script|trigger_expr)\b.{0,12}\b(remove|delete|clear|disable)\b/i
] as const

export const STRUCTURED_OUTPUT_PARSE_RETRY_PROMPT = [
  "【结构化输出格式修正】",
  "上一次回复没有通过结构化解析。请只重新输出符合当前 response schema 的结果。",
  "不要输出 Markdown、解释文字、代码块或额外字段。",
  "只输出一个完整的 JSON 对象；如果上一次多输出了说明文字或第二个 JSON 片段，这一轮全部删掉。",
  "所有数组字段没有内容时填空数组；所有字符串字段没有内容时填空字符串；nullable 字段没有内容时填 null。",
  "contact.contact_profiles[].reply_by_tag 在 Agent 结构化输出里必须是数组，格式为 [{\"tag\":\"pressure\",\"replies\":[\"...\"]}]；不要输出对象映射。"
].join("\n")

export let cachedStoryScriptPromptSection: string | null | undefined

/**
 * 从仓库根目录的 `StoryScript.md` 读取适合放进 Agent 提示词的规范片段。
 *
 * @returns 找到文件时返回“脚本类别”到“编译约束”之间的截断文本；文件不存在返回 null。
 *
 * 首次读取后把字符串或 null 缓存在模块变量中，后续六个 Agent 节点不会重复同步读盘。undefined 表示
 * “尚未读取”，null 表示“已经确认没有文件”，两者不能混为一谈。
 */
export function loadStoryScriptPromptSection() {
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

/**
 * 构造可直接拼入 Agent prompt 的 StoryScript 规范区块。
 *
 * @returns 有规范时返回带标题的摘要；缺少文档时返回明确警告，要求模型服从静态校验而非猜语法。
 */
export function buildStoryScriptPromptSection() {
  const promptSection = loadStoryScriptPromptSection()

  if (!promptSection) {
    return "【StoryScript.md】当前进程未读取到规范文件；语法与权限判断必须以运行时静态校验为准，不要自行脑补缺失语法。"
  }

  return [
    "【StoryScript.md 摘要（唯一规范来源）】",
    promptSection
  ].join("\n")
}

/**
 * 判断用户是否明确要求删除已有脚本。
 *
 * @param instruction 用户自然语言指令，支持中英文常见“删除/清空/disable script”等表达。
 * @returns 任一意图正则命中时返回 true，否则返回 false。
 *
 * 工作流默认保护已有脚本，只有本函数确认用户确有删除意图时，才允许新草稿把非空脚本改为空。
 */
export function instructionAllowsScriptRemoval(instruction: string) {
  return SCRIPT_REMOVAL_INTENT_PATTERNS.some((pattern) => pattern.test(instruction))
}

export const draftDialogueSchema = z.object({
  speaker_type: z.enum(["player", "object"]).describe("player 表示玩家主角，object 表示事件对象。"),
  speaker_key: z.string().describe("player 或 normal:<roleId> / important:<roleId>。"),
  content: z.string().describe("对白文本，可使用 ${group.value} 占位。")
})

export const draftPresentationSchema = z.discriminatedUnion("type", [
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

export const draftInvokeParamSchema = z.object({
  name: z.string().min(1).describe("调用参数名，必须是标识符。"),
  descr: z.string().optional().describe("参数说明。")
})

export const draftLoopRuleSchema = z.object({
  mode: z.enum(["daily", "weekly", "monthly", "interval_days"]).describe("定时规则类型。"),
  interval_days: z.number().int().min(1).optional().describe("interval_days 模式的间隔天数。"),
  weekday: z.number().int().min(1).max(7).optional().describe("weekly 模式的星期几，1 到 7。"),
  month_day: z.number().int().min(1).max(31).optional().describe("monthly 模式的日期，1 到 31。"),
  at: z.string().optional().describe("触发时间，HH:mm，例如 00:00。"),
  priority: z.number().int().optional().describe("同一触发时间内的优先级，数字越小越先执行；默认 100。"),
  after: z.array(z.string()).optional().describe("必须排在这些 schedule 事件之后执行的事件 id。"),
  before: z.array(z.string()).optional().describe("必须排在这些 schedule 事件之前执行的事件 id。")
})

export const draftVariableValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const draftVariableSchema = z.object({
  group: z.string().min(1).describe("变量组名，例如 player、county、arc。"),
  name: z.string().min(1).describe("变量名，例如 reputation、mood。"),
  description: z.string().describe("变量用途说明。"),
  value_type: z.enum(["value", "calc"]).describe("value 表示普通值，calc 表示计算值。"),
  value: draftVariableValueSchema.optional().describe("value 类型变量的初始值。"),
  calc_rule: z.string().describe("calc 类型变量的计算规则；value 类型留空。")
})

export const legacyDraftVariableSchema = z.string().min(1).transform((variableKey): StoryCreationDraftVariable => {
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

export const draftLocationSchema = z.object({
  id: z.string().min(1).describe("ASCII 风格地点 id，例如 county_gate。"),
  descr: z.string().describe("地点说明，面向编辑器和生成图片提示词。"),
  prompt: z.string().describe("英文环境美术提示词草稿。")
})

export const draftRoleSchema = z.object({
  id: z.string().min(1).describe("ASCII 风格角色 id，例如 debt_collector。"),
  name: z.string().describe("角色显示名。"),
  zhiye: z.string().describe("职业或身份。"),
  descr: z.string().describe("角色设定说明。"),
  prompt: z.string().describe("英文角色美术提示词草稿。"),
  xingge: z.string().optional().describe("重要角色的性格说明。"),
  important: z.boolean().describe("true 写入重要角色池，false 写入普通角色池。")
})

export const draftItemSchema = z.object({
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

export const contactTrackSchema = z.enum(["none", "romance", "official", "social"])

export const draftContactChannelLabelsSchema = z.object({
  message: z.string().optional(),
  conversation: z.string().optional(),
  talk: z.string().optional(),
  action: z.string().optional(),
  gift: z.string().optional(),
  send: z.string().optional(),
  reply: z.string().optional()
}).default({})

export const draftContactChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  preset: z.enum(["generic", "phone", "letter", "transmission"]).default("generic"),
  labels: draftContactChannelLabelsSchema
})

export const draftContactLibraryScopeSchema = z.object({
  role_keys: z.array(z.string()).default([]),
  contact_tracks: z.array(contactTrackSchema).default([]),
  personality_ids: z.array(z.string()).default([]),
  min_favor: z.number().int().min(0).max(100).default(0),
  max_favor: z.number().int().min(0).max(100).default(100)
})

export const draftContactInvokeDelaySchema = z.object({
  unit: z.enum(["hours", "days", "months", "years"]),
  value: z.number().int().min(1)
})

export const draftContactInvocationSchema = z.object({
  target_type: z.enum(["chain", "pool", "schedule"]).default("chain"),
  event_id: z.string().min(1),
  delay: draftContactInvokeDelaySchema.optional()
})

export const draftContactPersonalitySchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  descr: z.string().default(""),
  style_tags: z.array(z.string()).default([])
})

export const draftContactTalkSchema = z.object({
  id: z.string().min(1),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
  scope: draftContactLibraryScopeSchema.default({
    role_keys: [],
    contact_tracks: [],
    personality_ids: [],
    min_favor: 0,
    max_favor: 100
  }),
  base_favor_delta: z.number().int().min(-100).max(100).default(0),
  cooldown_hours: z.number().int().min(0).default(0),
  invoke: draftContactInvocationSchema.optional()
})

export const draftContactActionCostItemSchema = z.object({
  item_id: z.string().min(1),
  quantity: z.number().int().min(1).default(1)
})

export const draftContactActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().default(""),
  text: z.string().default(""),
  tags: z.array(z.string()).default([]),
  scope: draftContactLibraryScopeSchema.default({
    role_keys: [],
    contact_tracks: [],
    personality_ids: [],
    min_favor: 0,
    max_favor: 100
  }),
  base_favor_delta: z.number().int().min(-100).max(100).default(0),
  cooldown_hours: z.number().int().min(0).default(0),
  cost_money: z.number().min(0).default(0),
  cost_items: z.array(draftContactActionCostItemSchema).default([]),
  invoke: draftContactInvocationSchema.optional()
})

export const draftContactReplySchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string()).default([]),
  scope: draftContactLibraryScopeSchema.default({
    role_keys: [],
    contact_tracks: [],
    personality_ids: [],
    min_favor: 0,
    max_favor: 100
  }),
  replies: z.array(z.string()).default([])
})

export const draftContactProactiveMessageSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger_expr: z.string().min(1),
  cooldown_hours: z.number().int().min(1).default(24),
  favor_delta: z.number().int().min(-100).max(100).default(0),
  messages: z.array(z.string()).min(1),
  reply_quick_message_ids: z.array(z.string()).default([])
})

export const draftContactProfileSchema = z.object({
  role_key: z.string().min(1),
  channel_id: z.string().default(""),
  enabled: z.boolean().default(true),
  auto_add: z.boolean().default(true),
  initial_favor: z.number().int().min(0).max(100).default(20),
  preferred_tags: z.array(z.string()).default([]),
  reply_by_tag: z.record(z.array(z.string()).default([])).default({}),
  proactive_messages: z.array(draftContactProactiveMessageSchema).default([])
})

export const emptyDraftContact = {
  channels: [],
  personality_library: [],
  talk_library: [],
  action_library: [],
  reply_library: [],
  contact_profiles: []
}

export const draftContactSchema = z.object({
  channels: z.array(draftContactChannelSchema).default([]),
  personality_library: z.array(draftContactPersonalitySchema).default([]),
  talk_library: z.array(draftContactTalkSchema).default([]),
  action_library: z.array(draftContactActionSchema).default([]),
  reply_library: z.array(draftContactReplySchema).default([]),
  contact_profiles: z.array(draftContactProfileSchema).default([])
}).default(emptyDraftContact)

export const draftContactConversationMessageSchema = z.object({
  content: z.string().default("")
})

export const draftContactConversationOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().default(""),
  visible_expr: z.string().default(""),
  script: z.string().default(""),
  next_node_id: z.string().default("")
})

export const draftContactConversationReminderSchema = z.object({
  enabled: z.boolean().default(false),
  interval_minutes: z.number().int().min(1).default(60)
}).default({
  enabled: false,
  interval_minutes: 60
})

export const draftContactConversationNodeSchema = z.object({
  id: z.string().min(1),
  contact_messages: z.array(draftContactConversationMessageSchema).default([]),
  player_options: z.array(draftContactConversationOptionSchema).default([]),
  reminder: draftContactConversationReminderSchema,
  end: z.boolean().default(false),
  end_script: z.string().default(""),
  invoke: draftContactInvocationSchema.optional()
})

export const draftContactConversationDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  role_key: z.string().min(1),
  enabled: z.boolean().default(true),
  once: z.boolean().default(true),
  lock_normal_chat: z.boolean().default(true),
  trigger_expr: z.string().default(""),
  entry_node_id: z.string().min(1),
  nodes: z.array(draftContactConversationNodeSchema).default([])
})

export const emptyDraftContactConversations = {
  conversations: []
}

export const draftContactConversationsSchema = z.object({
  conversations: z.array(draftContactConversationDefinitionSchema).default([])
}).default(emptyDraftContactConversations)

export const draftEventSchema = z.object({
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

export const draftDoingMenuSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  parent_id: z.string().default(""),
  sort_order: z.number().int().default(100),
  visible_expr: z.string().default(""),
  descr: z.string().default("")
})

export const draftDoingDefinitionSchema = z.object({
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

export const emptyDraftDoing = {
  menus: [],
  doings: []
}

export const draftDoingSchema = z.object({
  menus: z.array(draftDoingMenuSchema).default([]),
  doings: z.array(draftDoingDefinitionSchema).default([])
}).default(emptyDraftDoing)

export const draftShopCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sort_order: z.number().int().default(100),
  visible_expr: z.string().default(""),
  descr: z.string().default("")
})

export const draftShopProductSchema = z.object({
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

export const emptyDraftShop = {
  categories: [],
  products: []
}

export const draftShopSchema = z.object({
  categories: z.array(draftShopCategorySchema).default([]),
  products: z.array(draftShopProductSchema).default([])
}).default(emptyDraftShop)

export const draftSchema = z.object({
  title: z.string().min(1).describe("这批生成内容的标题。"),
  summary: z.string().describe("这批内容如何服务可玩网文体验。"),
  arc: z.string().describe("所属篇章或小剧情线。"),
  locations: z.array(draftLocationSchema).describe("建议新增或复用的地点。"),
  roles: z.array(draftRoleSchema).describe("建议新增或复用的角色。"),
  items: z.array(draftItemSchema).default([]).describe("建议新增或复用的物品。"),
  events: z.array(draftEventSchema).describe("建议新增的剧情事件草稿。"),
  variables: z.array(draftVariableSchema).describe("建议新增变量草稿，只写入 vals.json5，不写 system_vals.json5。"),
  contact: draftContactSchema,
  contactConversations: draftContactConversationsSchema,
  doing: draftDoingSchema,
  shop: draftShopSchema,
  notes: z.array(z.string()).describe("给编辑器作者的落地说明。"),
  warnings: z.array(z.string()).describe("风险、待人工确认点和不确定项。")
})

export { draftSchema as storyCreationDraftSchema }
