/**
 * 提示词上下文和对白摘要。
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
import { formatDraftForAgent, formatExistingAssets, formatExistingEvents, formatExistingContactAndDoing, formatExistingVariables, formatStoryBible } from "./context"
import type { CreationStateValue } from "./contracts-agents"
import { assetDesignerOutputSchema, plotPlannerOutputSchema } from "./contracts-agents"
import { ROLE_ERROR_CODES, ROLE_TITLES, STRUCTURED_OUTPUT_PARSE_RETRY_ATTEMPTS, STRUCTURED_OUTPUT_PARSE_RETRY_PROMPT } from "./contracts-draft"
import { formatJson, getErrorDetail, invokeStructuredOutputFallback, isStructuredOutputParsingError } from "./model"

/**
 * 汇总当前故事中与创作有关的只读上下文。
 * @param story 当前完整故事。
 * @param instruction 用户指令，用于检索相关变量和物品详情。
 * @param baseDraft 反馈模式下的旧草稿；有值时采用更紧凑上下文。
 * @returns 供六个 Agent 共用的分区文本，不修改故事。
 */
export function buildStoryContext(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  const compact = !!baseDraft

  return [
    `故事: ${story.story.title} (${story.story.id})`,
    `简介: ${story.story.description ?? ""}`,
    `标签: ${(story.story.tags ?? []).join(", ")}`,
    "",
    "【创作设定】",
    formatStoryBible(story),
    "",
    "【现有变量】",
    formatExistingVariables(story, instruction, baseDraft, compact),
    "",
    "【现有地点/角色/场景/物品】",
    formatExistingAssets(story, instruction, baseDraft, compact),
    "",
    "【现有称谓库/联系人/行动/商城资产】",
    formatExistingContactAndDoing(story, compact),
    "",
    "【现有事件简表】",
    formatExistingEvents(story, compact)
  ].join("\n")
}

/**
 * 构造每个 Agent 都必须遵守的基础规则和当前状态提示词。
 * @param roleTitle 当前角色中文名。
 * @param state LangGraph 当前状态，包含指令、故事上下文和可选旧草稿。
 * @returns 完整基础 prompt；反馈模式会附上截断的旧草稿并强调保留 id、引用和脚本。
 */
export function buildBasePrompt(roleTitle: string, state: CreationStateValue) {
  const lines = [
    `你是 Story Manager 的${roleTitle} Agent。`,
    "项目目标：把网络小说变成玩家可以代入主角、可以选择、可以演进的开放游戏。",
    "你不是单纯写小说；你的输出必须服务结构化游戏内容生产。",
    "当前运行在后台编辑器创作阶段，不能直接假设玩家已经做出未来选择。",
    "必须保留玩家选择空间，避免把所有后果写死成单线小说。",
    "事件必须贴近项目数据格式：chain 是链式剧情线，pool 是平面一次性事件池，schedule 是定时规则事件。",
    "collectionType 的判断标准是事件之间是否存在真实的 next 图连接，不是“感觉像一条剧情线”：只有当一批事件之间用 next 互相衔接、形成多步剧情图时，才把它们放进 chain；如果一个事件的 next 始终是空数组，且它只是被其他事件/联系人/行动/定时事件用 invoke_once 单次调用，那它就是 pool 事件，禁止放进 chain。",
    "pool 事件不是只能给 AI 剧情导演挑选；trigger_mode 为 invoke 的 pool 事件同样合法，专门用于“被动等待调用、自身不连接后续事件”的单次剧情，例如招聘、催债、联系人剧情分支这类由玩家操作或其他事件触发的一次性场景，都应该放 pool，不要放 chain。",
    "chain/pool/schedule 中 trigger_mode 为 invoke 的事件只供脚本调用，不参与普通调度；invoke 不等于 chain，判断集合类型仍然只看是否存在真实 next 连接。",
    "角色引用使用 player、normal:<roleId>、important:<roleId>。",
    "重要角色可以在对白中声明一次性姓名设置：只有对白明确需要玩家给重要角色取名时，才填写 role_name_input，并让 content 使用 `${role.important.<roleId>.name}` 模板；role_name_input.role_key 必须是同一句对白的说话人、必须引用事件 object_keys 中的 important 角色。",
    "role_name_input 不能用于玩家对白、普通角色或没有明确姓名设置需求的对白；姓和名由运行时分别收集并保存到当前存档，未设置时姓名模板回退角色原名。",
    "涉及玩家性别差异的称呼、自称和代词时，必须优先使用 refer.json5 称谓库占位符，例如 `${term.player.respect}`、`${term.player.self_proud}`；不要硬编码先生/女士/少爷/小姐。",
    "生成对白、消息提示、联系人短句、NPC 主动消息、contact_send_from/contact_send_to 文本时，都可以使用 `${term.xxx}`。称谓库只读，不要把 term.* 当作普通变量写入。",
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
    "联系人资产写入 contact 草稿：新增/调整联系媒介、联系人短句、动作、回复、联系人特配、主动消息规则时输出 contact，不要只在 notes 里描述。事件脚本只用于运行时行为，例如 contact_add、contact_send_from、contact_add_favor。",
    "contact.channels 可以建议新增或覆盖媒介，preset 只能是 generic、phone、letter、transmission；不得生成或修改 default_channel_id，故事默认媒介始终由作者在编辑器中决定。",
    "联系人普通“说话/闲聊”必须写入 contact.talk_library；player_quick_messages 只作为 NPC 主动消息的推荐回复库使用，不要把泛用闲聊短句当成全局快捷消息。",
    "proactive_messages[].reply_quick_message_ids 可以引用 contact.talk_library 的短句 id，也可以引用已有 player_quick_messages 的专用回复 id；主动消息涉及具体剧情时，必须推荐语境匹配的回复，不要推荐无关泛用社交短句。",
    "contact.talk_library/action_library 的 invoke 只会在玩家通过联系人 UI 选择对应短句或动作时触发；StoryScript 里的 contact_send_to/contact_send_from 只是直接写入消息，不会自动匹配短句库并触发 invoke。剧情脚本需要延迟调度事件时，直接使用 invoke_once 保留语句。",
    "行动资产写入 doing 草稿：玩家可主动选择的玩法入口必须输出 doing 菜单/行动。doing 行动不配置 trigger_mode、trigger_expr、invoke_params；显示条件写 visible_expr，触发只来自菜单选择。",
    "商城资产写入 shop 草稿：新增或调整商城分类、商品货架时输出 shop.categories/shop.products，不要只在 notes 里描述。商城不能创建物品资产，只能引用现有 item id 或本次 draft.items 里同时生成的 item id。",
    "商城商品的 category_id 必须引用现有 shop 分类或本次 shop.categories；item_id 必须引用现有物品或本次 draft.items。商品购买条件写 available_expr，分类显示条件写 visible_expr。",
    "商城相关脚本可使用 shop_can_buy、shop_purchase_cooldown_left、shop_gift_cooldown_left、shop_buy、shop_gift；商品 id 必须来自现有 shop.products 或本次 draft.shop.products。",
    "如果联系人消息或剧情会临时开放一个玩家主动入口，应同时生成 doing 草稿，并在事件脚本或联系人相关事件中使用 doing_unlock(\"doing_id\")。",
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
    const baseDraftPreviewChars = 10000

    lines.push(
      "",
      "【当前待优化草稿】",
      formatDraftForAgent(state.baseDraft, baseDraftPreviewChars),
      "",
      "当前处于反馈优化模式；上下文已做压缩，请优先保留已有 id、脚本、引用和已选结构化资产，不要因为细节被截断就把整块结构清空。",
      "当前任务是基于用户反馈修订这份草稿。输出必须是完整修订版，不是增量补丁。除非反馈要求重做，否则尽量保留已有 id、变量 key、角色 key、事件引用，以及已有非空脚本。不要因为保守或不确定就把脚本清空。"
    )
  }

  return lines.join("\n")
}

/**
 * 把旧事件集合名转换成当前内部名称。
 * @param collectionType chain/pool/schedule 或兼容名称 once/loop/graph。
 * @returns once→pool、loop→schedule，其余合法新名称原样；graph 兜底为 chain。
 */
export function normalizeDialogueGenerationCollectionType(
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

/**
 * 规范化一条对白的说话人 key。
 * @param roles 当前故事角色库。
 * @param dialogue 待处理对白。
 * @returns 玩家固定为 player；对象角色尽量解析成标准命名空间 key，找不到时保留 trim 后原值。
 */
export function normalizeDialogueSpeakerKey(
  roles: StoryRolesFile,
  dialogue: StoryOnceDialogueDefinition
) {
  if (dialogue.speaker_type === "player") {
    return "player"
  }

  return findStoryRoleReference(roles, dialogue.speaker_key)?.key ?? dialogue.speaker_key.trim()
}

/**
 * 生成最多十条现有对白的编号预览。
 * @param dialogues 当前事件对白。
 * @returns 无对白时返回说明文字；否则返回 `[说话人] 内容` 多行摘要。
 */
export function summarizeDialoguePresentation(dialogues: StoryOnceDialogueDefinition[]) {
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

/**
 * 把一个事件及其角色、地点、脚本、调度和现有对白整理成模型可读文本。
 * @param story 完整故事，用来解析引用资料。
 * @param collectionType 当前内部事件集合。
 * @param event 用户正在编辑的事件。
 * @returns 分区后的事件上下文；缺失引用会明确标记，不会虚构资料。
 */
export function summarizeEventForDialogueGeneration(
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

/**
 * 调用模型并尽最大可能取得符合 Zod Schema 的结构化结果。
 * @param role 当前 Agent 角色，用于模型回调和错误码。
 * @param llm ChatOpenAI 实例。
 * @param schema 目标输出 Schema。
 * @param prompt 初始提示词。
 * @param signal 可选取消信号。
 * @param observer 可选任务日志观察器。
 * @returns 首次或重试后通过 Schema 的结构化对象。
 * @throws 取消转为 499；上游、解析和 JSON 兜底均失败时抛脱敏前的 502 FileStoreError。
 *
 * 算法先使用原生 structured-output；仅解析错误才附加格式修正提示重试。重试仍失败时改用普通模型
 * 调用并从文本中扫描 JSON。鉴权、限流等非格式错误不会无意义重试。
 */
export async function invokeStructured<T extends Record<string, unknown>>(
  role: StoryCreationAgentRole,
  llm: ChatOpenAI,
  schema: z.ZodType<T>,
  prompt: string,
  signal?: AbortSignal,
  observer?: StoryCreationWorkflowObserver
) {
  const structuredLlm = llm.withStructuredOutput<T>(schema, {
    name: `${role}Output`
  })

  let parseFailureDetail = ""

  for (let attempt = 1; attempt <= STRUCTURED_OUTPUT_PARSE_RETRY_ATTEMPTS; attempt += 1) {
    observer?.onModelAttempt(role, attempt)
    const nextPrompt = attempt === 1
      ? prompt
      : [
          prompt,
          "",
          STRUCTURED_OUTPUT_PARSE_RETRY_PROMPT,
          parseFailureDetail ? `上一次解析错误:\n${parseFailureDetail}` : ""
        ].filter(Boolean).join("\n\n")

    try {
      return await structuredLlm.invoke(nextPrompt, createStoryCreationModelConfig(role, signal, observer))
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

      if (isStructuredOutputParsingError(error)) {
        try {
          return await invokeStructuredOutputFallback(
            role,
            llm,
            schema,
            [
              nextPrompt,
              "",
              "【原文 JSON 兜底】",
              "请只输出一个可由 JSON.parse 直接读取的 JSON 对象，不要输出任何额外解释、注释或 Markdown。"
            ].filter(Boolean).join("\n\n"),
            signal,
            observer
          )
        } catch (fallbackError) {
          const fallbackDetail = getErrorDetail(fallbackError)
          const retryDetail = parseFailureDetail
            ? `Structured output parsing failed after retry. First error: ${parseFailureDetail}\nLast error: ${detail}`
            : detail

          throw new FileStoreError(
            `${ROLE_TITLES[role]} Agent failed: ${retryDetail}\nRaw JSON fallback failed: ${fallbackDetail}`,
            502,
            ROLE_ERROR_CODES[role]
          )
        }
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

/**
 * 创建旧同步接口展示的一条 Agent 摘要日志。
 * @param role Agent 角色。
 * @param summary 节点输出摘要。
 * @returns 含固定中文 title 的日志对象。
 */
export function createLog(role: StoryCreationAgentRole, summary: string): StoryCreationAgentLog {
  return {
    role,
    title: ROLE_TITLES[role],
    summary
  }
}

/**
 * 判断未知错误是否代表取消。
 * @param error 捕获到的值。
 * @returns Error.name 为 AbortError 或消息包含 aborted 时返回 true。
 */
export function isAbortError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.name === "AbortError" || error.message.toLowerCase().includes("aborted")
}

/**
 * 把剧情规划 Agent 的结构化输出排成后续节点易读的文本。
 * @param output 已通过 plotPlanner Schema 的结果。
 * @returns 包含篇章、节拍、玩家选择和节奏说明的多行文本。
 */
export function buildPlotPlanText(output: z.infer<typeof plotPlannerOutputSchema>) {
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

/**
 * 把资产设计 Agent 输出限制长度后格式化为 JSON 文本。
 * @param output 已通过 assetDesigner Schema 的地点、角色、物品和备注。
 * @returns 最多 12000 字符的格式化 JSON，供事件写作节点继续使用。
 */
export function buildAssetPlanText(output: z.infer<typeof assetDesignerOutputSchema>) {
  return formatJson({
    locations: output.locations,
    roles: output.roles,
    items: output.items,
    notes: output.notes
  }, 12000)
}
