/**
 * 模型创建和 structured-output 回退。
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
import type { AgentModelKey, RequiredAgentSettings } from "./contracts-draft"
import { ROLE_MODEL_KEYS, emptyDraftDoing, emptyDraftContact, emptyDraftContactConversations, emptyDraftShop } from "./contracts-draft"

/**
 * 规范化 Agent 的 OpenAI 兼容基地址。
 * @param baseUrl 用户设置的 URL。
 * @returns 去掉尾斜杠并确保以 `/v1` 结尾的地址；空输入返回空字符串。
 * @throws URL 语法不合法时转换成可返回给前端的 400。
 */
export function normalizeBaseUrl(baseUrl: string) {
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

/**
 * 读取并验证六 Agent 共用配置。
 * @param settings File Store 读取的应用设置。
 * @returns 清理后的 baseUrl、API 密钥，并把 temperature 限制在 0 到 2。
 * @throws baseUrl 或 API 密钥缺失/非法时抛 400；角色模型名由使用时再检查。
 */
export function requireAgentSettings(settings: AppSettingsFile): RequiredAgentSettings {
  const agent = settings.ai.agent
  const apiKey = process.env.STORY_AI_AGENT_API_KEY?.trim() || (agent.apiKey ?? "").trim()
  const configuredBaseUrl = process.env.STORY_AI_AGENT_BASE_URL?.trim() || (agent.baseUrl ?? "")

  if (!configuredBaseUrl.trim()) {
    throw new FileStoreError("Agent model baseUrl is required.", 400, "ai.agent-base-url-required")
  }

  if (!apiKey) {
    throw new FileStoreError("Agent API key is required (configure it in editor settings or STORY_AI_AGENT_API_KEY).", 400, "ai.agent-api-key-required")
  }

  return {
    ...agent,
    apiKey,
    baseUrl: normalizeBaseUrl(configuredBaseUrl),
    temperature: Math.max(0, Math.min(2, agent.temperature))
  }
}

/**
 * 为一个 Agent 角色选择实际模型名。
 * @param agent 已校验的 Agent 配置。
 * @param modelKey 当前角色对应的配置字段。
 * @returns 优先返回该角色专用模型；为空时回退到第一个已配置角色模型。
 * @throws 所有角色模型都为空时抛 400。
 */
export function resolveRoleModel(agent: RequiredAgentSettings, modelKey: AgentModelKey) {
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

/**
 * 创建一个配置统一的 LangChain ChatOpenAI 实例。
 * @param agent 已校验配置。
 * @param modelKey 当前 Agent 的模型字段。
 * @returns 带 baseURL、重试、温度和十分钟超时的模型客户端。
 */
export function createChatModel(agent: RequiredAgentSettings, modelKey: AgentModelKey) {
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

/**
 * 限制放进提示词或错误消息的文本长度。
 * @param text 原文本。
 * @param maxChars 最大字符数。
 * @returns 未超限时原文；超限时返回截断内容和 `...` 标记。
 */
export function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text
  }

  return `${text.slice(0, maxChars).trimEnd()}\n...`
}

/**
 * 把任意值格式化为有长度上限的缩进 JSON。
 * @param value 要展示的数据。
 * @param maxChars 最大字符数。
 * @returns 便于 Agent 阅读的 JSON 文本，过长时由 `truncateText` 截断。
 */
export function formatJson(value: unknown, maxChars: number) {
  return truncateText(JSON.stringify(value, null, 2), maxChars)
}

/** @param error 任意捕获值。@returns Error.message；非 Error 使用 String 转换。 */
export function getErrorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 判断失败是否只是模型输出格式无法解析。
 * @param error structured-output 调用抛出的错误。
 * @returns 可以通过重试 JSON 格式修复时返回 true；鉴权、限流和 Schema 配置错误返回 false。
 */
export function isStructuredOutputParsingError(error: unknown) {
  const detail = getErrorDetail(error)

  if (/Invalid schema|response_format|Zod field|required is required|MODEL_RATE_LIMIT|429|401|403/i.test(detail)) {
    return false
  }

  return /OUTPUT_PARSING_FAILURE|OutputParserException|Failed to parse|Could not parse|parse/i.test(detail)
}

/**
 * 从不同模型 SDK 的 content 形态中递归提取文本。
 * @param value 字符串、数字、布尔、数组，或包含 content/text/value/data 的对象。
 * @returns 合并后的文本；null、undefined 和未知对象返回空字符串。
 */
export function normalizeStructuredOutputText(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeStructuredOutputText(item)).join("")
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>

    if ("content" in record) {
      return normalizeStructuredOutputText(record.content)
    }

    if (typeof record.text === "string") {
      return record.text
    }

    if (typeof record.value === "string") {
      return record.value
    }

    if (typeof record.data === "string") {
      return record.data
    }
  }

  return ""
}

/**
 * 去掉包裹整个模型响应的 Markdown JSON 代码围栏。
 * @param text 模型原始文本。
 * @returns 围栏内文本；不是完整围栏时只做 trim，避免误删正文。
 */
export function stripStructuredOutputCodeFence(text: string) {
  const trimmed = text.trim()
  const fencedMatch = trimmed.match(/^```(?:json|json5|jsonc)?\s*([\s\S]*?)\s*```$/i)
  if (!fencedMatch) {
    return trimmed
  }

  const [, inner] = fencedMatch
  if (inner === undefined) {
    return trimmed
  }

  return inner.trim()
}

/**
 * 从某个 `{` 或 `[` 开始提取括号完整配对的一段 JSON 候选文本。
 * @param text 模型输出。
 * @param startIndex 候选起始下标。
 * @returns 找到完整对象/数组时返回子串，起点非法、括号错配或未闭合时返回 null。
 *
 * 扫描器用栈跟踪 `{[`，同时识别字符串和反斜杠转义，所以 JSON 字符串内部的括号不会误结束候选。
 */
export function tryExtractBalancedJsonCandidate(text: string, startIndex: number) {
  const source = stripStructuredOutputCodeFence(text)
  const startChar = source[startIndex]
  if (startChar !== "{" && startChar !== "[") {
    return null
  }

  const stack = [startChar]
  let inString = false
  let escaped = false

  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }

      if (char === "\\") {
        escaped = true
        continue
      }

      if (char === "\"") {
        inString = false
      }

      continue
    }

    if (char === "\"") {
      inString = true
      continue
    }

    if (char === "{" || char === "[") {
      stack.push(char)
      continue
    }

    if (char === "}" || char === "]") {
      const expectedOpen = char === "}" ? "{" : "["
      const lastOpen = stack[stack.length - 1]
      if (lastOpen !== expectedOpen) {
        return null
      }

      stack.pop()
      if (stack.length === 0) {
        return source.slice(startIndex, index + 1)
      }
    }
  }

  return null
}

/**
 * 从可能夹杂解释文字的模型输出中寻找并校验结构化 JSON。
 * @param schema 目标 Zod Schema。
 * @param value 模型 SDK 返回的任意 content 形态。
 * @returns 第一个既能 JSON.parse 又通过 Schema 的对象。
 * @throws 没有完整 JSON 或所有候选均不符合 Schema 时抛带截断详情的 Error。
 */
export function parseStructuredOutputText<T extends Record<string, unknown>>(schema: z.ZodType<T>, value: unknown) {
  const text = normalizeStructuredOutputText(value).trim()

  if (!text) {
    throw new Error("Structured output was empty.")
  }

  const source = stripStructuredOutputCodeFence(text)
  let lastErrorDetail = ""

  for (let startIndex = 0; startIndex < source.length; startIndex += 1) {
    if (source[startIndex] !== "{" && source[startIndex] !== "[") {
      continue
    }

    const candidate = tryExtractBalancedJsonCandidate(source, startIndex)
    if (!candidate) {
      continue
    }

    let parsedValue: unknown
    try {
      parsedValue = JSON.parse(candidate)
    } catch (error) {
      lastErrorDetail = `JSON.parse failed: ${getErrorDetail(error)}`
      continue
    }

    const parsed = schema.safeParse(parsedValue)
    if (parsed.success) {
      return parsed.data
    }

    lastErrorDetail = parsed.error.message
  }

  throw new Error(
    lastErrorDetail
      ? `Structured output did not contain a schema-valid JSON value: ${truncateText(lastErrorDetail, 360)}`
      : `Structured output did not contain a complete JSON value: ${truncateText(text, 360)}`
  )
}

/**
 * structured-output API 失败后，退回普通模型调用并自行解析 JSON。
 * @param role 当前 Agent 角色。
 * @param llm 模型实例。
 * @param schema 目标输出 Schema。
 * @param prompt 强调只返回 JSON 的完整提示词。
 * @param signal 可选取消信号。
 * @param observer 可选任务观察器。
 * @returns 通过 `parseStructuredOutputText` 校验的对象。
 */
export async function invokeStructuredOutputFallback<T extends Record<string, unknown>>(
  role: StoryCreationAgentRole,
  llm: ChatOpenAI,
  schema: z.ZodType<T>,
  prompt: string,
  signal?: AbortSignal,
  observer?: StoryCreationWorkflowObserver
) {
  const rawResponse = await llm.invoke(prompt, createStoryCreationModelConfig(role, signal, observer))
  const result = parseStructuredOutputText(schema, rawResponse.content)
  return result
}

/**
 * 把内部 contact 草稿转换成 Agent Schema 更容易输出的结构。
 * @param contact 当前 contact 草稿，可缺省。
 * @returns 带默认值的 contact；reply_by_tag 对象映射转换成 `{tag,replies}[]`。
 */
export function toAgentVisibleContactDraft(contact: StoryCreationDraftContact | undefined) {
  const nextContact = contact ?? emptyDraftContact

  return {
    ...nextContact,
    contact_profiles: nextContact.contact_profiles.map((profile) => ({
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

/**
 * 把内部完整草稿转换成下一节点可见的稳定结构。
 * @param draft 上一节点草稿。
 * @returns 补齐可选领域、角色 xingge null 和 Agent 友好 contact 格式的新对象。
 */
export function toAgentVisibleDraft(draft: StoryCreationDraft) {
  return {
    ...draft,
    roles: draft.roles.map((role) => ({
      ...role,
      xingge: role.xingge ?? null
    })),
    contact: toAgentVisibleContactDraft(draft.contact),
    contactConversations: draft.contactConversations ?? emptyDraftContactConversations,
    doing: draft.doing ?? emptyDraftDoing,
    shop: draft.shop ?? emptyDraftShop
  }
}
