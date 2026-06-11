import { Annotation, END, START, StateGraph } from "@langchain/langgraph"
import { ChatOpenAI } from "@langchain/openai"
import {
  validateStoryDocument,
  type AppAiAgentSettings,
  type AppSettingsFile,
  type StoryDocument,
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
  RunStoryCreationAgentResponse,
  StoryCreationAgentLog,
  StoryCreationAgentRole,
  StoryCreationDraft,
  StoryCreationDraftEvent,
  StoryCreationDraftItem,
  StoryCreationDraftPresentation,
  StoryCreationDraftRole,
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

const draftSchema = z.object({
  title: z.string().min(1).describe("这批生成内容的标题。"),
  summary: z.string().describe("这批内容如何服务可玩网文体验。"),
  arc: z.string().describe("所属篇章或小剧情线。"),
  locations: z.array(draftLocationSchema).describe("建议新增或复用的地点。"),
  roles: z.array(draftRoleSchema).describe("建议新增或复用的角色。"),
  items: z.array(draftItemSchema).default([]).describe("建议新增或复用的物品。"),
  events: z.array(draftEventSchema).describe("建议新增的剧情事件草稿。"),
  variables: z.array(draftVariableSchema).describe("建议新增变量草稿，只写入 vals.json5，不写 system_vals.json5。"),
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
  notes: z.array(z.string()).describe("给编辑器作者的落地说明。"),
  warnings: z.array(z.string()).describe("风险、待人工确认点和不确定项。")
})

type StructuredCreationDraft = z.infer<typeof structuredDraftSchema>
type StructuredCreationDraftLoopRule = z.infer<typeof structuredDraftLoopRuleSchema>
type StructuredCreationDraftPresentation = z.infer<typeof structuredDraftPresentationSchema>

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
    baseDraft ? formatJson(baseDraft, 8000) : ""
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
    baseDraft ? formatJson(baseDraft, 8000) : ""
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
    "地点使用地点 id。所有 id 尽量使用 ASCII 小写、数字、下划线或短横线。",
    "变量必须优先复用现有变量；判断变量是否已存在时必须先查 variableIndexAll 全量轻量索引；relevantVariableDetails 只提供本次更相关变量的详细字段，不代表完整变量库。",
    "现有变量里的 calc 变量就是现成规则资产，尤其是教育、就业、医疗、治安、基础建设等指数；不要默认不存在，也不要为了表达方便新造同义变量。",
    "StoryScript 过程脚本允许直接写回普通全局 value 变量，例如 `${player.money} += 100`、`${county.renkou_young} = Math.max(0, ${county.renkou_young} + delta)`。",
    "StoryScript 禁止写 calc、system.*、call.*：calc 是只读派生值；如果要改变 calc 汇总值，必须写它 calc_rule 依赖的普通 value 分项，或在 variables 草稿中新增普通 value 变量作为持久化字段。",
    "不要声称脚本接口缺少安全写回能力；当前引擎支持在 init_script、end_script、action.exec_script 中写普通 value 变量。",
    "生成非空 StoryScript 过程脚本时必须写清楚中文注释：说明读取了哪些变量、计算规则为什么这样设计、最终写回哪些 value 变量。复杂脚本要分段注释，避免只有公式没有解释。",
    "物品必须优先复用现有物品 id；确需新增时输出 items 草稿，category_id 必须来自现有物品分类。",
    "判断物品是否已存在时必须先查 itemIndexAll 全量轻量索引；relevantItemDetails 只提供本次更相关物品的详细字段，不代表完整物品库。",
    "物品获得、消耗和检查必须走 StoryScript 背包函数，不要编造 reward/items/consume 等未知事件字段。",
    "背包函数：bag_add(\"player\", \"item_id\", 1) 添加物品；bag_remove(\"player\", \"item_id\", 1) 扣除物品并返回 boolean；bag_count(\"player\", \"item_id\") 返回数量；bag_has(\"player\", \"item_id\", 1) 检查数量。",
    "背包函数里的 item_id 必须来自现有物品或本次 items 草稿；如果新增物品，事件脚本必须引用该新增物品 id。",
    "schedule 事件的 loop 必须包含 at、priority、after、before：at 用 HH:mm；同一时间点内 priority 数字越小越先执行；如果事件依赖另一个定时事件结果，必须把前置事件 id 写入 after。",
    "schedule priority 建议：结算/统计类 10-49，发放/奖励类 50-99，展示/日报/提示类 100+。例如每日发钱依赖每日人口结算时，发钱事件 after 应包含人口结算事件 id。",
    "StoryScript 不确定时留空，不要编造复杂脚本。",
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
      formatJson(state.baseDraft, 18000),
      "",
      "当前任务是基于用户反馈修订这份草稿。输出必须是完整修订版，不是增量补丁。除非反馈要求重做，否则尽量保留已有 id、变量 key、角色 key 和事件引用。"
    )
  }

  return lines.join("\n")
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

  try {
    return await structuredLlm.invoke(prompt, signal ? { signal } : undefined)
  } catch (error) {
    if (isAbortError(error)) {
      throw new FileStoreError(
        `${ROLE_TITLES[role]} Agent 已中止。`,
        499,
        `${ROLE_ERROR_CODES[role]}-aborted`
      )
    }

    const detail = error instanceof Error ? error.message : String(error)
    throw new FileStoreError(
      `${ROLE_TITLES[role]} Agent failed: ${detail}`,
      502,
      ROLE_ERROR_CODES[role]
    )
  }
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
    notes: draft.notes,
    warnings: draft.warnings
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

function normalizeDraft(draft: StoryCreationDraft): StoryCreationDraft {
  const locationIdMap = new Map<string, string>()
  const roleIdMap = new Map<string, string>()
  const eventIdMap = new Map<string, string>()
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
    eventIdMap.set(
      draftEventKey(event),
      makeUniqueId(event.id, `event-${index + 1}`, usedEventIdsByCollection[event.collectionType])
    )
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
    variables
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
    id: draftRole.id,
    name: draftRole.name,
    zhiye: draftRole.zhiye,
    descr: draftRole.descr,
    prompt: draftRole.prompt,
    img_raw: existing?.img_raw ?? "",
    img_compress_1: existing?.img_compress_1 ?? "",
    img_compress_2: existing?.img_compress_2 ?? ""
  }
}

function toImportantRole(
  draftRole: StoryCreationDraftRole,
  existing?: StoryImportantRoleDefinition
): StoryImportantRoleDefinition {
  return {
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

  if (event.trigger_mode === "invoke" && invokeParams.length === 0) {
    warnings.push(`事件 ${event.id} 缺少调用参数，已按默认触发应用。`)
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
  const availableLocationIds = new Set(nextEventLocations.assignments.map((location) => location.id))
  const availableRoleKeys = collectAvailableRoleKeys(nextRoles)
  const eventsToWrite = selectedEvents.map((event) =>
    toStoryEvent(event, {
      availableChainIds,
      availableLocationIds,
      availableRoleKeys,
      warnings
    })
  )

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
      variables: appliedVariables
    },
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
        `总主编简报:\n${state.creativeBrief}`,
        `剧情规划:\n${state.plotPlan}`,
        `资产规划:\n${state.assetPlan}`,
        state.baseDraft
          ? "你的任务：基于当前待优化草稿输出完整修订版。除非反馈要求重做，否则保留已有 id、变量 key、角色 key、事件 next 和集合类型，必要时补充或重写具体字段。"
          : "你的任务：生成可预览的结构化剧情草稿，默认 3 到 8 个事件。",
        "chain 事件可以通过 next 组成小剧情线；pool 事件必须是可被 AI 剧情导演挑选的平面事件；schedule 事件必须适合时间循环。",
        "生成 schedule 事件时必须显式配置 loop.at、loop.priority、loop.after、loop.before；同一时间点需要业务顺序时优先用 after 表达硬依赖，再用 priority 做排序。",
        "如果事件需要持久化改变数值，优先在 init_script 或 end_script 写普通 value 变量；可以读取 calc 变量参与计算，但不能给 calc 变量赋值。",
        "如果用户要求改变一个 calc 汇总，例如人口总量，应写入它依赖的普通 value 分项；如现有分项不足，在 variables 中新增普通 value 变量并在脚本中引用。",
        "写 init_script/end_script 时，非空脚本必须包含中文注释。注释至少覆盖：规则目的、关键变量含义、核心公式含义、写回目标。不要只输出一串无解释的 Math 公式。",
        "如剧情涉及玩家获得、消耗或检查物品，在 init_script/end_script/操作脚本中使用 bag_add、bag_remove、bag_count、bag_has；不要在事件 JSON 中新增奖励或消耗字段。",
        "不要直接写入文件。输出的 draft 必须包含本次相关地点、角色、物品、事件、变量建议和风险说明。"
      ].join("\n\n"),
      signal
    )

    return {
      draft: normalizeStructuredDraft(output.draft),
      logs: [createLog("eventWriter", output.log)]
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
        `待审校草稿:\n${formatJson(state.draft, 16000)}`,
        "你的任务：检查 init_script、end_script、trigger_expr、dialogue 占位符是否保守可用。",
        "脚本权限审校重点：普通全局 value 变量可写；calc、system.*、call.* 不可写。发现写 calc 汇总时，改为写其 calc_rule 依赖的普通 value 分项。",
        "脚本可读性审校重点：非空过程脚本必须保留或补充中文注释，说明规则意图、变量来源、计算依据和写回结果；不要删除有用注释。",
        "不要因为脚本涉及持久化变量写入就清空脚本；只有无法确定具体 value 写入目标时才清空并说明需要新增变量。",
        "如果脚本不确定，宁可清空脚本并在 issues/warnings 说明，也不要生成不可执行的复杂脚本。"
      ].join("\n\n"),
      signal
    )

    return {
      draft: normalizeStructuredDraft(output.draft),
      logs: [
        createLog(
          "scriptDoctor",
          [output.log, ...output.issues.map((issue) => `问题: ${issue}`)].join("\n")
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
        `待检查草稿:\n${formatJson(state.draft, 16000)}`,
        "你的任务：检查角色引用、地点引用、物品分类、事件 next、触发方式和玩家自由度是否一致。",
        "保留草稿预览性质，不要声称已经写入数据文件。"
      ].join("\n\n"),
      signal
    )

    const draft = normalizeStructuredDraft(output.draft)

    return {
      draft: {
        ...draft,
        warnings: [...draft.warnings, ...output.warnings]
      },
      logs: [createLog("consistencyChecker", output.log)]
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
