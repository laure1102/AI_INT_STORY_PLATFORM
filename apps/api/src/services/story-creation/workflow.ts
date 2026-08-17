/**
 * 六节点 LangGraph 创作工作流。
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
import { parseDraftForApply } from "./apply-domain"
import { formatDraftForAgent } from "./context"
import type { CreationStateValue } from "./contracts-agents"
import { CreationState, assetDesignerOutputSchema, chiefEditorOutputSchema, consistencyCheckerOutputSchema, eventWriterOutputSchema, plotPlannerOutputSchema, scriptDoctorOutputSchema } from "./contracts-agents"
import { SCRIPT_VALIDATION_REPAIR_ATTEMPTS, buildStoryScriptPromptSection } from "./contracts-draft"
import { normalizeDraft } from "./draft-normalize"
import { createChatModel, requireAgentSettings } from "./model"
import { buildAssetPlanText, buildBasePrompt, buildPlotPlanText, buildStoryContext, createLog, invokeStructured } from "./prompts"
import { collectDraftStoryScriptValidationIssues, formatDraftStoryScriptValidationIssues, preserveBaseDraftScripts } from "./script-validation"
import { normalizeStructuredDraft } from "./structured-normalize"

/**
 * 按固定顺序运行六个创作 Agent，并返回只供用户预览的候选草稿。
 *
 * @param settings 应用 Agent 模型配置。
 * @param story 当前完整故事，只作为创作和静态校验上下文读取。
 * @param instruction 用户的新建或反馈指令。
 * @param baseDraft 反馈模式下的上一轮草稿。
 * @param signal 可选取消信号。
 * @param workflowOptions 可选 checkpointer、稳定 threadId、恢复标记和任务观察器。
 * @returns 最终规范化草稿和六个节点日志；不会写入正式故事。
 * @throws 指令为空时抛 400；模型、结构化解析、脚本修复或空草稿失败时抛 499/502。
 *
 * 图顺序固定为：总主编 → 剧情规划 → 资产设计 → 事件写作 → 脚本审校 → 一致性检查。每个节点
 * 只返回局部 state update。传入 checkpointer/threadId 后 LangGraph 会保存每步状态；resume=true 时以
 * null 输入继续最近 checkpoint，而不是重新执行已完成节点。
 */
export async function runStoryCreationAgents(
  settings: AppSettingsFile,
  story: StoryDocument,
  instruction: string,
  baseDraft?: StoryCreationDraft,
  signal?: AbortSignal,
  workflowOptions?: StoryCreationWorkflowOptions
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

  /**
   * 把用户要求整理成可供后续节点执行的创作简报。
   * @param state 当前图状态。
   * @returns creativeBrief 和一条总主编日志。
   */
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
      signal,
      workflowOptions?.observer
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

  /**
   * 根据总主编简报规划篇章节拍、玩家选择和节奏。
   * @param state 含 creativeBrief 的图状态。
   * @returns plotPlan 和剧情规划日志。
   */
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
      signal,
      workflowOptions?.observer
    )

    return {
      plotPlan: buildPlotPlanText(output),
      logs: [createLog("plotPlanner", output.log)]
    }
  }

  /**
   * 规划本轮需要新增或复用的地点、角色和物品。
   * @param state 含剧情规划的图状态。
   * @returns assetPlan 和资产设计日志。
   */
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
      signal,
      workflowOptions?.observer
    )

    return {
      assetPlan: buildAssetPlanText(output),
      logs: [createLog("assetDesigner", output.log)]
    }
  }

  /**
   * 把上游规划写成完整结构化 StoryCreationDraft。
   * @param state 含创作、剧情和资产规划的图状态。
   * @returns 首份规范化 draft 和事件写作日志。
   */
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
          "写每个事件前先问自己：这个事件的 next 是否真的指向另一个本次或已有事件？如果是，一批用 next 连起来的事件才整体归为 chain；如果 next 只会是空数组，即使它由 invoke 单次调用触发、即使它讲的是一整条剧情，也要归为 pool，不能因为“像一条线”就选 chain。",
          "schedule 事件必须适合时间循环，不适合表达单次剧情分支。",
          "生成 schedule 事件时必须显式配置 loop.at、loop.priority、loop.after、loop.before；同一时间点需要业务顺序时优先用 after 表达硬依赖，再用 priority 做排序。",
        "如果事件需要持久化改变数值，优先在 init_script 或 end_script 写普通 value 变量；可以读取 calc 变量参与计算，但不能给 calc 变量赋值。",
        "如果用户要求改变一个 calc 汇总，例如人口总量，应写入它依赖的普通 value 分项；如现有分项不足，在 variables 中新增普通 value 变量并在脚本中引用。",
        "写 init_script/end_script 时，非空脚本必须包含中文注释。注释至少覆盖：规则目的、关键变量含义、核心公式含义、写回目标。不要只输出一串无解释的 Math 公式。",
        "如剧情涉及玩家获得、消耗或检查物品，在 init_script/end_script/操作脚本中使用 bag_add、bag_remove、bag_count、bag_has；不要在事件 JSON 中新增奖励或消耗字段。",
        "如果本次内容涉及联系人关系、联系媒介、短句、联系人动作、NPC 回复、主动消息或联系人特配，必须写入 draft.contact 对应数组；不要只在 notes 中描述。contact.channels 可建议媒介，但不得修改故事 default_channel_id。",
        "如果本次内容涉及强连续联系人剧情，例如 NPC 发消息、玩家固定回复、NPC 接着回复、结束后延迟调用后续事件，必须写入 draft.contactConversations.conversations；不要用普通 proactive_messages 或普通闲聊短句模拟强连续剧情。",
        "如果本次内容涉及玩家主动可选入口，例如去县长办公室、KTV、会所、购物送礼、约会地点等，必须写入 draft.doing.menus 和 draft.doing.doings；doing 事件内容复用平面事件结构，但没有 trigger_mode、trigger_expr、invoke_params。",
        "如果本次内容涉及商城上架、购买、送礼商品、购物入口或商品展示条件，必须写入 draft.shop.categories 和 draft.shop.products；商城商品只能引用已有或本次新增物品，不能在 shop 里直接创建物品资产。",
        "draft.contact、draft.contactConversations、draft.doing 和 draft.shop 是结构化输出的一部分；没有新增内容时也要保留空数组。不要直接写入文件。输出的 draft 必须包含本次相关地点、角色、物品、事件、变量建议、联系人资产、联系人剧情、行动资产、商城资产和风险说明。"
      ].join("\n\n"),
      signal,
      workflowOptions?.observer
    )

    return {
      draft: normalizeDraft(normalizeStructuredDraft(output.draft)),
      logs: [createLog("eventWriter", output.log)]
    }
  }

    /**
     * 用确定性 StoryScript 校验驱动最多若干轮脚本修复。
     * @param state 当前工作流状态，用于旧脚本保护和提示词上下文。
     * @param draft 待检查草稿。
     * @param reason 触发校验的阶段说明。
     * @returns 校验通过的草稿和每轮问题/修复日志。
     * @throws 达到修复上限仍有静态问题时抛 502，绝不把已知坏脚本交给下一阶段。
     */
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
            "如果 contact 主动消息 trigger_expr、contactConversations trigger_expr/visible_expr/script/end_script、doing visible_expr、doing init_script/end_script、shop visible_expr/available_expr 不符合 StoryScript.md，也要一并修复。",
            "修复脚本时必须保留 draft.contact、draft.contactConversations、draft.doing 和 draft.shop 的结构化资产；除非用户明确要求删除，不要把联系人短句、联系人剧情、联系人动作、行动菜单、行动事件、商城分类或商城商品清空。",
            "非空过程脚本必须保留中文注释，解释变量来源、计算规则和写回目标。"
          ].join("\n\n"),
          signal,
          workflowOptions?.observer
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

  /**
   * 让脚本审校 Agent 主动检查一次，再进入确定性修复循环。
   * @param state 必须含 eventWriter 产出的 draft。
   * @returns 修复后 draft 和汇总脚本日志。
   */
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
          "contact 主动消息 trigger_expr、contactConversations trigger_expr/visible_expr/script/end_script、doing visible_expr、doing init_script/end_script、shop visible_expr/available_expr 也属于脚本审校范围。",
          "脚本是否支持，必须以 StoryScript.md 和确定性静态校验为准；不要自行声称“规范未说明”来回避修复。",
          "invoke_once 是 StoryScript 保留语句，合法格式是 `invoke_once chain event_id delay_days=1 param=${group.name}`；禁止写成 `invoke_once(\"chain\", \"event_id\", { delay_days: 1 })`。",
          "trigger_mode=invoke 的事件可以没有 invoke_params；无参数调用事件仍然必须保持 invoke，不能因为参数为空改成 default。",
          "输出完整 draft 时必须保留 contact、contactConversations、doing 和 shop 字段。没有相关内容时填空数组；有相关内容时不要把结构化资产降级成 notes。"
        ].join("\n\n"),
        signal,
        workflowOptions?.observer
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

  /**
   * 检查全部领域引用和玩家自由度，并再次执行脚本确定性校验。
   * @param state 含脚本审校后 draft 的图状态。
   * @returns 最终 draft，以及一致性/必要脚本修复日志。
   */
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
        "你的任务：检查角色引用、地点引用、物品分类、事件 next、触发方式、联系人资产、联系人剧情、行动菜单/行动事件、商城分类/商品和玩家自由度是否一致。",
        "联系人检查重点：channels 只能使用受支持 preset 且不能修改故事默认媒介；contact_profiles.role_key 必须是现有或本次生成 NPC 角色；channel_id 留空表示继承默认媒介，非空必须引用现有或本次生成媒介；短句/动作/回复的 scope 不要引用不存在的性格或角色；invoke 目标必须是现有或本次生成事件。",
        "联系人剧情检查重点：contactConversations.conversations[].role_key 必须是现有或本次生成 NPC 角色；entry_node_id 和 next_node_id 必须引用本对话节点；结束节点 invoke 目标必须是现有或本次生成事件；强连续剧情不要降级到普通 proactive_messages。",
        "行动检查重点：doing.doings[].menu_id 必须引用现有或本次生成菜单；visible_expr 用 StoryScript 条件表达式；行动没有 trigger_mode、trigger_expr、invoke_params。",
        "商城检查重点：shop.products[].category_id 必须引用现有或本次生成商城分类；item_id 必须引用现有物品或本次生成物品；available_expr/visible_expr 用 StoryScript 条件表达式。",
        "如果剧情或联系人消息承诺玩家可以主动去某处做某事，应确认草稿里有对应 doing 入口，或在 warnings 中说明为什么本次不生成。",
        "如果剧情、行动或联系人承诺玩家能购买/送礼某件商品，应确认草稿里有对应 shop 商品，或在 warnings 中说明为什么只复用现有商品。",
        "保留草稿预览性质，不要声称已经写入数据文件。"
      ].join("\n\n"),
      signal,
      workflowOptions?.observer
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

  /**
   * 给普通 LangGraph 节点包一层任务观察通知。
   * @param role 节点角色。
   * @param model 配置的模型名，记录到任务日志。
   * @param node 真正节点函数。
   * @returns 新节点：开始时上报 onNodeStart，成功上报该角色摘要，失败上报错误后原样抛出。
   */
  function observedNode(
    role: StoryCreationAgentRole,
    model: string,
    node: (state: CreationStateValue) => Promise<Partial<CreationStateValue>>
  ) {
    return async (state: CreationStateValue) => {
      workflowOptions?.observer?.onNodeStart(role, model)
      try {
        const update = await node(state)
        const summary = update.logs
          ?.filter((log) => log.role === role)
          .map((log) => log.summary)
          .join("\n") ?? ""
        workflowOptions?.observer?.onNodeComplete(role, summary)
        return update
      } catch (error) {
        workflowOptions?.observer?.onNodeError(role, error)
        throw error
      }
    }
  }

  const graph = new StateGraph(CreationState)
    .addNode("chiefEditor", observedNode("chiefEditor", agent.chiefEditorModel, chiefEditor))
    .addNode("plotPlanner", observedNode("plotPlanner", agent.plotPlannerModel, plotPlanner))
    .addNode("assetDesigner", observedNode("assetDesigner", agent.assetDesignerModel, assetDesigner))
    .addNode("eventWriter", observedNode("eventWriter", agent.eventWriterModel, eventWriter))
    .addNode("scriptDoctor", observedNode("scriptDoctor", agent.scriptDoctorModel, scriptDoctor))
    .addNode("consistencyChecker", observedNode("consistencyChecker", agent.consistencyCheckerModel, consistencyChecker))
    .addEdge(START, "chiefEditor")
    .addEdge("chiefEditor", "plotPlanner")
    .addEdge("plotPlanner", "assetDesigner")
    .addEdge("assetDesigner", "eventWriter")
    .addEdge("eventWriter", "scriptDoctor")
    .addEdge("scriptDoctor", "consistencyChecker")
    .addEdge("consistencyChecker", END)
    .compile(workflowOptions?.checkpointer ? { checkpointer: workflowOptions.checkpointer } : undefined)

  const initialState: CreationStateValue = {
    assetPlan: "",
    baseDraft: normalizedBaseDraft,
    creativeBrief: "",
    draft: null,
    instruction: normalizedInstruction,
    logs: [],
    plotPlan: "",
    storyContext: buildStoryContext(story, normalizedInstruction, normalizedBaseDraft),
    storyTitle: story.story.title
  }
  const graphInput = workflowOptions?.resume ? null : initialState
  const result = await graph.invoke(graphInput as CreationStateValue, {
    ...(signal ? { signal } : {}),
    ...(workflowOptions?.threadId
      ? { configurable: { thread_id: workflowOptions.threadId } }
      : {})
  })

  if (!result.draft) {
    throw new FileStoreError("Agent workflow returned an empty draft.", 502, "ai.agent-empty-draft")
  }

  return {
    draft: normalizeDraft(result.draft),
    logs: result.logs
  }
}
