import type { AppSettingsFile } from "@story-mgr/core"
import { FileStoreError } from "@story-mgr/file-store"

interface LocationPromptInput {
  descr: string
  locationName: string
  storyTitle?: string
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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })

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
