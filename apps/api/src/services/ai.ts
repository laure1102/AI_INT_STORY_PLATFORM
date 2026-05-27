import type { AppSettingsFile } from "@story-mgr/core"
import { FileStoreError } from "@story-mgr/file-store"
import { Agent, fetch as undiciFetch } from "undici"

interface LocationPromptInput {
  descr: string
  locationName: string
  storyTitle?: string
}

interface RolePromptInput {
  descr: string
  import: boolean
  qufenXingbie: boolean
  roleName: string
  storyTitle?: string
  xingge: string
}

interface GeneratedImageResult {
  buffer: Buffer
  mimeType: string
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}

interface OpenAiImageGenerationResponse {
  data?: Array<{
    b64_json?: string
  }>
}

const AI_HEADERS_TIMEOUT_MS = 5 * 60 * 1000
const AI_BODY_TIMEOUT_MS = 10 * 60 * 1000
const AI_TOTAL_TIMEOUT_MS = 10 * 60 * 1000

const aiHttpAgent = new Agent({
  bodyTimeout: AI_BODY_TIMEOUT_MS,
  connectTimeout: 60 * 1000,
  headersTimeout: AI_HEADERS_TIMEOUT_MS
})

function requireAiConfig(settings: AppSettingsFile) {
  return settings.ai
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim()

  if (!trimmed) {
    return ""
  }

  const url = new URL(trimmed)
  const pathname = url.pathname.replace(/\/+$/, "")
  url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`

  return url.toString().replace(/\/+$/, "")
}

function buildCompatibleUrl(baseUrl: string, endpoint: string) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return ""
  return `${normalized.replace(/\/+$/, "")}${endpoint}`
}

function extractTextContent(content: string | Array<{ type?: string; text?: string }> | undefined) {
  if (typeof content === "string") {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((part) => (part?.type === "text" ? part.text ?? "" : part.text ?? ""))
    .join("")
    .trim()
}

async function postJson<TResponse>(
  url: string,
  apiKey: string,
  payload: Record<string, unknown>,
  errorCode: string,
  errorMessage: string
) {
  let response

  try {
    response = await undiciFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      dispatcher: aiHttpAgent,
      signal: AbortSignal.timeout(AI_TOTAL_TIMEOUT_MS)
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new FileStoreError(`${errorMessage}: ${detail}`, 502, errorCode)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new FileStoreError(
      `${errorMessage}: ${response.status} ${errorText || response.statusText}`,
      502,
      errorCode
    )
  }

  return (await response.json()) as TResponse
}

export async function generateLocationPrompt(
  settings: AppSettingsFile,
  input: LocationPromptInput
) {
  const ai = requireAiConfig(settings).text

  if (!ai.baseUrl.trim()) {
    throw new FileStoreError("文生 baseUrl 未设置。", 400, "ai.text-base-url-required")
  }

  if (!ai.apiKey.trim()) {
    throw new FileStoreError("文生 apiKey 未设置。", 400, "ai.text-api-key-required")
  }

  if (!ai.model.trim()) {
    throw new FileStoreError("文生模型未设置。", 400, "ai.text-model-required")
  }

  if (!input.descr.trim()) {
    throw new FileStoreError("地点描述不能为空。", 400, "location.descr-required")
  }

  const systemPrompt = [
    "你是游戏美术提示词设计助手。",
    "你的任务是根据地点名称、地点描述和全局提示词，输出一段适合 AI 生图的最终 prompt。",
    "输出要求：",
    "1. 只输出最终 prompt，不要解释。",
    "2. 优先输出适合主流文生图模型理解的英文 prompt。",
    "3. 如果用户给了中文全局提示词，也要吸收其含义并转成自然的英文美术描述。",
    "4. 需要包含环境、材质、光照、镜头感、氛围等要素。",
    "5. 保持适合游戏背景场景，不要出现人物特写。"
  ].join("\n")

  const userPrompt = [
    `故事标题: ${input.storyTitle?.trim() || "未提供"}`,
    `地点名称: ${input.locationName.trim()}`,
    `地点描述: ${input.descr.trim()}`
  ].join("\n")

  const payload = await postJson<OpenAiChatCompletionResponse>(
    buildCompatibleUrl(ai.baseUrl, "/chat/completions"),
    ai.apiKey,
    {
      model: ai.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    },
    "ai.text-generation-failed",
    "AI 生成提示词失败"
  )

  const prompt = extractTextContent(payload.choices?.[0]?.message?.content)

  if (!prompt) {
    throw new FileStoreError("AI 没有返回可用的提示词。", 502, "ai.empty-prompt")
  }

  return prompt
}

export async function generateRolePrompt(
  settings: AppSettingsFile,
  input: RolePromptInput
) {
  const ai = requireAiConfig(settings).text

  if (!ai.baseUrl.trim()) {
    throw new FileStoreError("文生 baseUrl 未设置。", 400, "ai.text-base-url-required")
  }

  if (!ai.apiKey.trim()) {
    throw new FileStoreError("文生 apiKey 未设置。", 400, "ai.text-api-key-required")
  }

  if (!ai.model.trim()) {
    throw new FileStoreError("文生模型未设置。", 400, "ai.text-model-required")
  }

  if (!input.descr.trim()) {
    throw new FileStoreError("角色描述不能为空。", 400, "role.descr-required")
  }

  const systemPrompt = [
    "你是游戏角色美术提示词设计助手。",
    "你的任务是根据角色名称、角色描述、角色性格和生成要求，输出一段适合 AI 生图的英文最终 prompt。",
    "输出要求：",
    "1. 只输出最终 prompt，不要解释。",
    "2. prompt 要适合角色立绘或角色设定图。",
    "3. 需要明确服装、年龄感、气质、面部特征、姿态倾向、材质与光影风格。",
    "4. 如果角色需要区分性别，不要在这里直接写死 male 或 female，保留成中性角色设定，后续生图时再追加性别指令。",
    "5. 如果是重要角色，请强化辨识度、记忆点和主角感。"
  ].join("\n")

  const userPrompt = [
    `故事标题: ${input.storyTitle?.trim() || "未提供"}`,
    `角色名称: ${input.roleName.trim()}`,
    `角色描述: ${input.descr.trim()}`,
    `角色性格: ${input.xingge.trim() || "未提供"}`,
    `是否重要角色: ${input.import ? "是" : "否"}`,
    `是否区分性别: ${input.qufenXingbie ? "是" : "否"}`
  ].join("\n")

  const payload = await postJson<OpenAiChatCompletionResponse>(
    buildCompatibleUrl(ai.baseUrl, "/chat/completions"),
    ai.apiKey,
    {
      model: ai.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    },
    "ai.role-text-generation-failed",
    "AI 生成角色提示词失败"
  )

  const prompt = extractTextContent(payload.choices?.[0]?.message?.content)

  if (!prompt) {
    throw new FileStoreError("AI 没有返回可用的角色提示词。", 502, "ai.empty-role-prompt")
  }

  return prompt
}

export async function generateLocationImage(
  settings: AppSettingsFile,
  prompt: string,
  globalPrompt: string,
  imageSize: string
): Promise<GeneratedImageResult> {
  const ai = requireAiConfig(settings).image

  if (!ai.baseUrl.trim()) {
    throw new FileStoreError("图生 baseUrl 未设置。", 400, "ai.image-base-url-required")
  }

  if (!ai.apiKey.trim()) {
    throw new FileStoreError("图生 apiKey 未设置。", 400, "ai.image-api-key-required")
  }

  if (!ai.model.trim()) {
    throw new FileStoreError("图生模型未设置。", 400, "ai.image-model-required")
  }

  if (!prompt.trim()) {
    throw new FileStoreError("提示词不能为空。", 400, "location.prompt-required")
  }

  const finalPrompt = [globalPrompt.trim(), prompt.trim()].filter(Boolean).join("\n")

  const payload = await postJson<OpenAiImageGenerationResponse>(
    buildCompatibleUrl(ai.baseUrl, "/images/generations"),
    ai.apiKey,
    {
      model: ai.model,
      prompt: finalPrompt,
      size: imageSize,
      response_format: "b64_json"
    },
    "ai.image-generation-failed",
    "AI 生图失败"
  )

  const base64 = payload.data?.[0]?.b64_json

  if (!base64) {
    throw new FileStoreError("AI 生图返回为空。", 502, "ai.empty-image")
  }

  return {
    buffer: Buffer.from(base64, "base64"),
    mimeType: "image/png"
  }
}

export async function generateRoleImage(
  settings: AppSettingsFile,
  prompt: string,
  globalPrompt: string,
  imageSize: string,
  gender: "common" | "male" | "female"
): Promise<GeneratedImageResult> {
  const genderPromptSuffix =
    gender === "male"
      ? "male character design, masculine traits, adult male presentation"
      : gender === "female"
        ? "female character design, feminine traits, adult female presentation"
        : "full character design"

  return generateLocationImage(
    settings,
    `${prompt.trim()}\n${genderPromptSuffix}`,
    globalPrompt,
    imageSize
  )
}
