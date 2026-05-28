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
  gender: "common" | "male" | "female"
  important: boolean
  qufenXingbie: boolean
  roleName: string
  storyTitle?: string
  xingge?: string
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

function extractTextContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
) {
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

function requireTextProvider(settings: AppSettingsFile) {
  const ai = requireAiConfig(settings).text

  if (!ai.baseUrl.trim()) {
    throw new FileStoreError("Text model baseUrl is required.", 400, "ai.text-base-url-required")
  }

  if (!ai.apiKey.trim()) {
    throw new FileStoreError("Text model apiKey is required.", 400, "ai.text-api-key-required")
  }

  if (!ai.model.trim()) {
    throw new FileStoreError("Text model name is required.", 400, "ai.text-model-required")
  }

  return ai
}

function requireImageProvider(settings: AppSettingsFile) {
  const ai = requireAiConfig(settings).image

  if (!ai.baseUrl.trim()) {
    throw new FileStoreError("Image model baseUrl is required.", 400, "ai.image-base-url-required")
  }

  if (!ai.apiKey.trim()) {
    throw new FileStoreError("Image model apiKey is required.", 400, "ai.image-api-key-required")
  }

  if (!ai.model.trim()) {
    throw new FileStoreError("Image model name is required.", 400, "ai.image-model-required")
  }

  return ai
}

export async function generateLocationPrompt(
  settings: AppSettingsFile,
  input: LocationPromptInput
) {
  const ai = requireTextProvider(settings)

  if (!input.descr.trim()) {
    throw new FileStoreError("Location description is required.", 400, "location.descr-required")
  }

  const systemPrompt = [
    "You are a game environment concept prompt designer.",
    "Return only the final English image prompt.",
    "Focus on environment, material, lighting, camera language, mood, and composition.",
    "Keep it suitable for a game background or establishing shot.",
    "Do not add explanation or markdown."
  ].join("\n")

  const userPrompt = [
    `Story title: ${input.storyTitle?.trim() || "Not provided"}`,
    `Location name: ${input.locationName.trim()}`,
    `Location description: ${input.descr.trim()}`
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
    "Failed to generate location prompt"
  )

  const prompt = extractTextContent(payload.choices?.[0]?.message?.content)

  if (!prompt) {
    throw new FileStoreError("AI returned an empty location prompt.", 502, "ai.empty-prompt")
  }

  return prompt
}

export async function generateRolePrompt(
  settings: AppSettingsFile,
  input: RolePromptInput
) {
  const ai = requireTextProvider(settings)

  if (!input.descr.trim()) {
    throw new FileStoreError("Role description is required.", 400, "role.descr-required")
  }

  const systemPrompt = [
    "You are a game character concept prompt designer.",
    "Return only the final English image prompt.",
    "The prompt should be suitable for a character design sheet or portrait generation.",
    "Describe clothing, age impression, silhouette, facial features, pose tendency, material, and lighting style.",
    "If gender is male or female, explicitly reflect that gender presentation in the prompt.",
    "If gender is common, keep the prompt gender-neutral.",
    "If the role is important, strengthen recognizability and memorable signature traits.",
    "Do not add explanation or markdown."
  ].join("\n")

  const userPrompt = [
    `Story title: ${input.storyTitle?.trim() || "Not provided"}`,
    `Role name: ${input.roleName.trim()}`,
    `Role description: ${input.descr.trim()}`,
    `Role personality: ${input.xingge?.trim() || "Not provided"}`,
    `Generation gender: ${input.gender}`,
    `Important role: ${input.important ? "yes" : "no"}`,
    `Split by gender: ${input.qufenXingbie ? "yes" : "no"}`
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
    "Failed to generate role prompt"
  )

  const prompt = extractTextContent(payload.choices?.[0]?.message?.content)

  if (!prompt) {
    throw new FileStoreError("AI returned an empty role prompt.", 502, "ai.empty-role-prompt")
  }

  return prompt
}

export async function generateLocationImage(
  settings: AppSettingsFile,
  prompt: string,
  globalPrompt: string,
  width: number,
  height: number
): Promise<GeneratedImageResult> {
  const ai = requireImageProvider(settings)

  if (!prompt.trim()) {
    throw new FileStoreError("Location prompt is required.", 400, "location.prompt-required")
  }

  const finalPrompt = [globalPrompt.trim(), prompt.trim()].filter(Boolean).join("\n")
  const size = `${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`

  const payload = await postJson<OpenAiImageGenerationResponse>(
    buildCompatibleUrl(ai.baseUrl, "/images/generations"),
    ai.apiKey,
    {
      model: ai.model,
      prompt: finalPrompt,
      size,
      response_format: "b64_json"
    },
    "ai.image-generation-failed",
    "Failed to generate image"
  )

  const base64 = payload.data?.[0]?.b64_json

  if (!base64) {
    throw new FileStoreError("AI returned an empty image.", 502, "ai.empty-image")
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
  width: number,
  height: number,
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
    width,
    height
  )
}
