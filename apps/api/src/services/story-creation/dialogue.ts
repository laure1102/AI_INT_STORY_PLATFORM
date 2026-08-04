/**
 * 单事件 AI 对白生成。
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
import {
  createStoryCreationModelConfig,
  type StoryCreationWorkflowObserver,
  type StoryCreationWorkflowOptions
} from "../story-creation-workflow"
import { formatExistingAssets, formatExistingPhoneAndDoing, formatExistingVariables, formatStoryBible } from "./context"
import { generatedDialogueSchema } from "./contracts-agents"
import { createChatModel, requireAgentSettings } from "./model"
import { invokeStructured, normalizeDialogueGenerationCollectionType, normalizeDialogueSpeakerKey, summarizeEventForDialogueGeneration } from "./prompts"

/**
 * 为一个现有对白事件生成可直接预览的完整对白候选。
 *
 * @param settings 应用 AI Agent 配置。
 * @param story 当前完整故事，用来提供故事圣经、变量、资产、角色和手机/行动上下文。
 * @param request 事件集合、当前事件和用户对白要求。
 * @param signal 可选取消信号，浏览器关闭请求时中止模型调用。
 * @returns 对白摘要、完整 dialogues 和警告；函数不会保存事件。
 * @throws 指令为空或事件不是 dialogue 时抛 400；Agent、解析或空结果失败时抛 499/502。
 *
 * 关键流程：规范旧集合名 → 构造只允许“改对白”的上下文 → structured-output 生成 → 逐条清理说话人。
 * object 说话人必须属于事件已有 object_keys；模型若编造角色，会安全降级成 player。最后过滤空文本，
 * 避免把一个表面成功、实际无内容的结果交给编辑器。
 */
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
