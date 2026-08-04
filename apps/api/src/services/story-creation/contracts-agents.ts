/**
 * 定义创作 Agent 的运行时数据边界和 LangGraph 共享状态。
 *
 * 模型返回的是网络中的未知 JSON，而 TypeScript 类型只在编译阶段存在，无法保护运行中的服务。
 * 因此每个 Agent 输出都必须先经过这里的 Zod Schema，字段缺失、类型错误或越界数值会在进入
 * 规范化与应用流程前被拒绝。Schema 通过后得到的仍然只是“候选草稿”，不是可直接持久化的
 * `StoryDocument`；后续还要经过引用过滤、StoryScript 校验和整篇故事验证。
 *
 * 输入来源：结构化模型输出、旧草稿兼容数据和 LangGraph 节点局部更新。
 * 输出去向：工作流节点、草稿规范化模块、前端预览和显式应用流程。
 * 不负责：调用模型、修复草稿、选择应用内容、写入任何 JSON5 文件。
 */
import { Annotation } from "@langchain/langgraph"
import type {
  StoryCreationAgentLog,
  StoryCreationDraft
} from "@story-mgr/shared"
import { z } from "zod"
import { draftDialogueSchema, draftLocationSchema, draftSchema, draftVariableSchema, draftVariableValueSchema, legacyDraftVariableSchema, phoneContactTrackSchema } from "./contracts-draft"

/**
 * 应用阶段接受的草稿边界。
 *
 * 与模型生成 Schema 不同，这里兼容旧版变量结构，保证历史任务和旧前端保存的草稿仍能重新应用。
 * 解析成功后还会交给 `normalizeDraft` 收敛成当前统一结构。
 */
export const draftApplySchema = draftSchema.extend({
  variables: z.array(z.union([draftVariableSchema, legacyDraftVariableSchema]))
})

// 以下基础 Schema 是多个领域共享的“小积木”。字段上的 describe 不只是开发文档，
// 也会提供给支持 structured output 的模型，帮助模型按约定填出完整 JSON。
export const structuredDraftInvokeParamSchema = z.object({
  name: z.string().min(1).describe("调用参数名，必须是标识符。"),
  descr: z.string().nullable().describe("参数说明；没有说明时填 null。")
})

export const structuredDraftLoopRuleSchema = z.object({
  mode: z.enum(["daily", "weekly", "monthly", "interval_days"]).describe("定时规则类型。"),
  interval_days: z.number().int().min(1).nullable().describe("interval_days 模式的间隔天数；其他模式填 null。"),
  weekday: z.number().int().min(1).max(7).nullable().describe("weekly 模式的星期几，1 到 7；其他模式填 null。"),
  month_day: z.number().int().min(1).max(31).nullable().describe("monthly 模式的日期，1 到 31；其他模式填 null。"),
  at: z.string().nullable().describe("触发时间，HH:mm；默认或不确定时填 00:00。"),
  priority: z.number().int().nullable().describe("同一触发时间内的优先级；结算类建议 10-49，发放/奖励类建议 50-99，展示/日报类建议 100+；默认填 100。"),
  after: z.array(z.string()).describe("必须排在这些 schedule 事件之后执行的事件 id；没有时填空数组。"),
  before: z.array(z.string()).describe("必须排在这些 schedule 事件之前执行的事件 id；没有时填空数组。")
})

export const structuredDraftVariableSchema = z.object({
  group: z.string().min(1).describe("变量组名，例如 player、county、arc。"),
  name: z.string().min(1).describe("变量名，例如 reputation、mood。"),
  description: z.string().describe("变量用途说明。"),
  value_type: z.enum(["value", "calc"]).describe("value 表示普通值，calc 表示计算值。"),
  value: draftVariableValueSchema.describe("value 类型变量的初始值；calc 类型填 null。"),
  calc_rule: z.string().describe("calc 类型变量的计算规则；value 类型留空。")
})

export const structuredDraftRoleSchema = z.object({
  id: z.string().min(1).describe("ASCII 风格角色 id，例如 debt_collector。"),
  name: z.string().describe("角色显示名。"),
  zhiye: z.string().describe("职业或身份。"),
  descr: z.string().describe("角色设定说明。"),
  prompt: z.string().describe("英文角色美术提示词草稿。"),
  xingge: z.string().nullable().describe("重要角色的性格说明；没有时填 null。"),
  important: z.boolean().describe("true 写入重要角色池，false 写入普通角色池。")
})

export const structuredDraftItemSchema = z.object({
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

export const structuredDraftPresentationSchema = z.object({
  type: z.enum(["silent", "message", "dialogue"]).describe("事件表现类型：silent 静默执行、message 消息提示、dialogue 对白。"),
  message: z.object({
    content: z.string().describe("消息提示文本；非 message 类型填空字符串。"),
    duration_seconds: z.number().min(0).describe("提示显示秒数；非 message 类型填 0。")
  }).nullable().describe("message 类型必填对象；其他类型填 null。"),
  dialogues: z.array(draftDialogueSchema).describe("dialogue 类型的对白列表；其他类型填空数组。")
})

// 手机系统包含关系范围、动作消耗和事件调用等交叉引用。此处只约束形状和基础数值范围；
// role_key、item_id、event_id 是否真实存在，要到应用阶段结合当前故事和用户选择一起判断。
export const structuredPhoneLibraryScopeSchema = z.object({
  role_keys: z.array(z.string()).describe("适用角色 key，例如 important:zhuli；不限角色时填空数组。"),
  contact_tracks: z.array(phoneContactTrackSchema).describe("适用关系轨道；不限轨道时填空数组。"),
  personality_ids: z.array(z.string()).describe("适用性格 id；不限性格时填空数组。"),
  min_favor: z.number().int().min(0).max(100).describe("最低好感度。"),
  max_favor: z.number().int().min(0).max(100).describe("最高好感度。")
})

export const structuredPhoneInvokeDelaySchema = z.object({
  unit: z.enum(["hours", "days", "months", "years"]).describe("游戏内延迟单位。"),
  value: z.number().int().min(1).describe("游戏内延迟数值。")
})

export const structuredPhoneInvocationSchema = z.object({
  target_type: z.enum(["chain", "pool", "schedule"]).describe("调用事件集合。"),
  event_id: z.string().describe("调用目标事件 id。"),
  delay: structuredPhoneInvokeDelaySchema.nullable().describe("延迟调用；不延迟时填 null。")
})

export const structuredPhonePersonalitySchema = z.object({
  id: z.string().min(1).describe("性格 id。"),
  name: z.string().describe("性格名称。"),
  descr: z.string().describe("性格说明。"),
  style_tags: z.array(z.string()).describe("说话风格标签。")
})

export const structuredPhoneTalkSchema = z.object({
  id: z.string().min(1).describe("闲聊短句 id。"),
  text: z.string().describe("玩家可选的闲聊短句文本。"),
  tags: z.array(z.string()).describe("短句标签。"),
  scope: structuredPhoneLibraryScopeSchema.describe("适用范围。"),
  base_favor_delta: z.number().int().min(-100).max(100).describe("基础好感变化。"),
  cooldown_hours: z.number().int().min(0).describe("冷却小时数。"),
  invoke: structuredPhoneInvocationSchema.nullable().describe("发送后调用事件；不调用事件时填 null。")
})

export const structuredPhoneActionCostItemSchema = z.object({
  item_id: z.string().min(1).describe("消耗物品 id。"),
  quantity: z.number().int().min(1).describe("消耗数量。")
})

export const structuredPhoneReplyByTagEntrySchema = z.object({
  tag: z.string().min(1).describe("回复标签 key。"),
  replies: z.array(z.string()).describe("该标签下的回复短句。")
})

export const structuredPhoneActionSchema = z.object({
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

export const structuredPhoneReplySchema = z.object({
  id: z.string().min(1).describe("回复库 id。"),
  tags: z.array(z.string()).describe("匹配标签。"),
  scope: structuredPhoneLibraryScopeSchema.describe("适用范围。"),
  replies: z.array(z.string()).describe("NPC 可回复文本。")
})

export const structuredPhoneProactiveMessageSchema = z.object({
  id: z.string().min(1).describe("主动消息规则 id。"),
  enabled: z.boolean().describe("是否启用。"),
  trigger_expr: z.string().min(1).describe("触发条件 StoryScript 表达式。"),
  cooldown_hours: z.number().int().min(1).describe("冷却小时数。"),
  favor_delta: z.number().int().min(-100).max(100).describe("发送后好感变化。"),
  messages: z.array(z.string()).describe("NPC 主动发送的消息；至少一条。"),
  reply_quick_message_ids: z.array(z.string()).describe("推荐玩家回复短句 id；没有时填空数组。")
})

export const structuredPhoneContactProfileSchema = z.object({
  role_key: z.string().min(1).describe("联系人角色 key，例如 important:zhuli。"),
  enabled: z.boolean().describe("是否启用联系人配置。"),
  auto_add: z.boolean().describe("是否交互后自动加入联系人。"),
  initial_favor: z.number().int().min(0).max(100).describe("初始好感度。"),
  preferred_tags: z.array(z.string()).describe("该联系人偏好的短句/动作标签。"),
  reply_by_tag: z.array(structuredPhoneReplyByTagEntrySchema).describe("按标签定制 NPC 回复；没有时填空数组。"),
  proactive_messages: z.array(structuredPhoneProactiveMessageSchema).describe("主动消息规则；没有填空数组。")
})

export const structuredPhoneDraftSchema = z.object({
  personality_library: z.array(structuredPhonePersonalitySchema).describe("建议新增或覆盖的性格定义；没有填空数组。"),
  talk_library: z.array(structuredPhoneTalkSchema).describe("建议新增或覆盖的闲聊短句；没有填空数组。"),
  action_library: z.array(structuredPhoneActionSchema).describe("建议新增或覆盖的联系人动作；没有填空数组。"),
  reply_library: z.array(structuredPhoneReplySchema).describe("建议新增或覆盖的 NPC 回复；没有填空数组。"),
  contact_profiles: z.array(structuredPhoneContactProfileSchema).describe("建议新增或覆盖的联系人特配；没有填空数组。")
})

export const structuredPhoneConversationMessageSchema = z.object({
  content: z.string().describe("NPC 发给玩家的消息文本，可使用 ${group.value} 或 ${term.xxx} 占位。")
})

export const structuredPhoneConversationOptionSchema = z.object({
  id: z.string().min(1).describe("玩家回复选项 id，同一个剧情手机对话内唯一。"),
  text: z.string().describe("玩家回复文本，可使用 ${group.value} 或 ${term.xxx} 占位。"),
  visible_expr: z.string().describe("该回复选项显示条件 StoryScript；默认显示填空字符串。"),
  script: z.string().describe("选择该回复后执行的 StoryScript；没有填空字符串。非空脚本必须写中文注释。"),
  next_node_id: z.string().describe("回复后进入的下一节点 id；结束节点或无下一步时填空字符串。")
})

export const structuredPhoneConversationReminderSchema = z.object({
  enabled: z.boolean().describe("玩家未回复时是否重复发送该节点最后一条 NPC 消息。"),
  interval_minutes: z.number().int().min(1).describe("重复提醒间隔，单位为游戏内分钟，例如 10、30、60。")
})

export const structuredPhoneConversationNodeSchema = z.object({
  id: z.string().min(1).describe("剧情手机对话节点 id。"),
  contact_messages: z.array(structuredPhoneConversationMessageSchema).describe("进入该节点时 NPC 连续发出的消息；没有时填空数组。"),
  player_options: z.array(structuredPhoneConversationOptionSchema).describe("该节点可选的玩家回复；结束节点填空数组。"),
  reminder: structuredPhoneConversationReminderSchema.describe("未回复重复提醒设置；不需要提醒时填 {enabled:false, interval_minutes:60}。"),
  end: z.boolean().describe("是否为结束节点。"),
  end_script: z.string().describe("进入结束节点后执行的 StoryScript；没有填空字符串。非空脚本必须写中文注释。"),
  invoke: structuredPhoneInvocationSchema.nullable().describe("结束节点可静默调用后续事件；不调用事件时填 null。")
})

export const structuredPhoneConversationDefinitionSchema = z.object({
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

export const structuredPhoneConversationsDraftSchema = z.object({
  conversations: z.array(structuredPhoneConversationDefinitionSchema).describe("建议新增或覆盖的连续剧情手机对话；没有填空数组。")
})

// Doing 与 Shop Schema 描述玩家主动入口和商城货架。商城商品只引用物品，不在这里创建物品；
// 因此最终能否应用某商品，还取决于对应 item 是否已存在或被用户在同批草稿中选中。
export const structuredDoingMenuSchema = z.object({
  id: z.string().min(1).describe("行动菜单 id。"),
  title: z.string().min(1).describe("行动菜单显示名。"),
  parent_id: z.string().describe("父菜单 id；根菜单填空字符串。"),
  sort_order: z.number().int().describe("排序值，越小越靠前。"),
  visible_expr: z.string().describe("显示条件 StoryScript；默认显示填空字符串。"),
  descr: z.string().describe("菜单说明。")
})

export const structuredDoingDefinitionSchema = z.object({
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

export const structuredDoingDraftSchema = z.object({
  menus: z.array(structuredDoingMenuSchema).describe("建议新增或覆盖的行动菜单；没有填空数组。"),
  doings: z.array(structuredDoingDefinitionSchema).describe("建议新增或覆盖的行动事件；没有填空数组。")
})

export const structuredShopCategorySchema = z.object({
  id: z.string().min(1).describe("商城分类 id。"),
  name: z.string().min(1).describe("商城分类显示名。"),
  sort_order: z.number().int().describe("排序值，越小越靠前。"),
  visible_expr: z.string().describe("分类显示条件 StoryScript；默认显示填空字符串。"),
  descr: z.string().describe("分类说明。")
})

export const structuredShopProductSchema = z.object({
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

export const structuredShopDraftSchema = z.object({
  categories: z.array(structuredShopCategorySchema).describe("建议新增或覆盖的商城分类；没有填空数组。"),
  products: z.array(structuredShopProductSchema).describe("建议新增或覆盖的商城商品；没有填空数组。")
})

export const structuredDraftEventSchema = z.object({
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

export const structuredDraftLocationSchema = draftLocationSchema

/**
 * 六个 Agent 共同传递的完整结构化草稿格式。
 *
 * 它刻意把所有领域都设为必填字段（没有内容时使用空数组/空对象），这样下游节点不必反复判断
 * “模型是忘了输出，还是确实没有建议”。通过此 Schema 只说明 JSON 形状正确，不说明跨文件引用、
 * StoryScript 或 schedule 依赖一定有效。
 */
export const structuredDraftSchema = z.object({
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

export type StructuredCreationDraft = z.infer<typeof structuredDraftSchema>

export type StructuredCreationDraftLoopRule = z.infer<typeof structuredDraftLoopRuleSchema>

export type StructuredCreationDraftPresentation = z.infer<typeof structuredDraftPresentationSchema>

export type StructuredCreationPhoneDraft = z.infer<typeof structuredPhoneDraftSchema>

export type StructuredCreationPhoneConversationsDraft = z.infer<typeof structuredPhoneConversationsDraftSchema>

export type StructuredCreationDoingDraft = z.infer<typeof structuredDoingDraftSchema>

export type StructuredCreationShopDraft = z.infer<typeof structuredShopDraftSchema>

/** 单事件对白生成接口的结构化输出边界，不参与六 Agent 的整篇草稿状态。 */
export const generatedDialogueSchema = z.object({
  summary: z.string().describe("对白生成简述。"),
  dialogues: z.array(draftDialogueSchema).describe("对白列表。"),
  warnings: z.array(z.string()).describe("风险、待确认点和需要人工调整的内容。")
})

export type GeneratedDialogueOutput = z.infer<typeof generatedDialogueSchema>

// 每个节点只返回自己负责的局部结果。工作流组合层把这些结果合并进 CreationState，
// 因而节点之间不需要相互调用，也不允许某个节点越权直接保存故事。
export const chiefEditorOutputSchema = z.object({
  log: z.string(),
  creativeBrief: z.string(),
  goals: z.array(z.string()),
  risks: z.array(z.string())
})

export const plotPlannerOutputSchema = z.object({
  log: z.string(),
  arc: z.string(),
  beats: z.array(z.string()),
  choices: z.array(z.string()),
  pacingNotes: z.array(z.string())
})

export const assetDesignerOutputSchema = z.object({
  log: z.string(),
  locations: z.array(structuredDraftLocationSchema),
  roles: z.array(structuredDraftRoleSchema),
  items: z.array(structuredDraftItemSchema),
  notes: z.array(z.string())
})

export const eventWriterOutputSchema = z.object({
  log: z.string(),
  draft: structuredDraftSchema
})

export const scriptDoctorOutputSchema = z.object({
  log: z.string(),
  draft: structuredDraftSchema,
  issues: z.array(z.string())
})

export const consistencyCheckerOutputSchema = z.object({
  log: z.string(),
  draft: structuredDraftSchema,
  warnings: z.array(z.string())
})

/**
 * LangGraph 在六个 Agent 节点之间传递的共享状态定义。
 *
 * 字段写入关系：入口写入故事标题、指令、上下文和可选基础草稿；总编节点写 creativeBrief；
 * 剧情规划节点写 plotPlan；资产节点写 assetPlan；事件编剧及后续修复/审校节点持续替换 draft。
 * `logs` 是例外：它使用 reducer 追加节点日志，而不是用后一个节点的数组覆盖前一个节点。
 *
 * 状态可以被 LangGraph checkpointer 保存和恢复，但它仍是任务运行状态，不是故事存档。
 */
export const CreationState = Annotation.Root({
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

/** `CreationState` 对应的 TypeScript 值类型，供节点函数和观察器共享。 */
export type CreationStateValue = typeof CreationState.State
