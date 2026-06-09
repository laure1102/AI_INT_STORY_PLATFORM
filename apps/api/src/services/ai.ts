import type { AppSettingsFile } from "@story-mgr/core"
import { FileStoreError } from "@story-mgr/file-store"
import { Agent, fetch as undiciFetch } from "undici"

interface LocationPromptInput {
  descr: string
  locationName: string
  storyTitle?: string
}

interface ItemPromptInput {
  categoryName: string
  descr: string
  itemName: string
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
    revised_prompt?: string
    url?: string
  }>
}

interface MidjourneySubmitResponse {
  code?: number
  description?: string
  properties?: Record<string, unknown>
  result?: number | string
}

interface MidjourneyTaskResponse {
  action?: string
  description?: string
  failReason?: string
  finishTime?: number
  id?: string
  imageUrl?: string
  progress?: string
  prompt?: string
  promptEn?: string
  properties?: Record<string, unknown>
  startTime?: number
  state?: string
  status?: string
  submitTime?: number
}

interface MidjourneyPromptLimits {
  globalPromptMaxChars: number
  promptMaxChars: number
  totalMaxChars: number
}

const AI_HEADERS_TIMEOUT_MS = 5 * 60 * 1000
const AI_BODY_TIMEOUT_MS = 10 * 60 * 1000
const AI_TOTAL_TIMEOUT_MS = 10 * 60 * 1000
const MIDJOURNEY_TASK_TIMEOUT_MS = 20 * 60 * 1000
const MIDJOURNEY_POLL_INTERVAL_MS = 5 * 1000
const MIDJOURNEY_DEFAULT_PROMPT_LIMITS: MidjourneyPromptLimits = {
  globalPromptMaxChars: 520,
  promptMaxChars: 1400,
  totalMaxChars: 1700
}
const MIDJOURNEY_RETRY_PROMPT_LIMITS: MidjourneyPromptLimits = {
  globalPromptMaxChars: 320,
  promptMaxChars: 1200,
  totalMaxChars: 1400
}

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

function normalizeMidjourneyBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim()

  if (!trimmed) {
    return ""
  }

  const url = new URL(trimmed)
  const pathname = url.pathname.replace(/\/+$/, "")
  const rootPathname = pathname.replace(/\/v1$/, "")
  url.pathname = rootPathname || "/"

  return url.toString().replace(/\/+$/, "")
}

function buildMidjourneyUrl(baseUrl: string, endpoint: string) {
  const normalized = normalizeMidjourneyBaseUrl(baseUrl)
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

async function getJson<TResponse>(
  url: string,
  apiKey: string,
  errorCode: string,
  errorMessage: string
) {
  let response

  try {
    response = await undiciFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
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

async function downloadBinary(url: string, errorCode: string, errorMessage: string) {
  let response

  try {
    response = await undiciFetch(url, {
      method: "GET",
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

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png"
  const arrayBuffer = await response.arrayBuffer()

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType
  } satisfies GeneratedImageResult
}

function isMidjourneyImagineModel(model: string) {
  return model.trim().toLowerCase() === "mj_imagine"
}

function isDoubaoSeedreamModel(model: string) {
  return model.trim().toLowerCase() === "doubao-seedream-4-0-250828"
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a)
  let right = Math.abs(b)

  while (right !== 0) {
    const temp = left % right
    left = right
    right = temp
  }

  return left || 1
}

function buildAspectRatio(width: number, height: number) {
  const normalizedWidth = Math.max(1, Math.round(width))
  const normalizedHeight = Math.max(1, Math.round(height))
  const divisor = greatestCommonDivisor(normalizedWidth, normalizedHeight)

  return `${normalizedWidth / divisor}:${normalizedHeight / divisor}`
}

function normalizeMidjourneyPromptText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim()
}

function stripAspectRatioFlag(text: string) {
  return text.replace(/\s*--ar\s+\d+\s*:\s*\d+/gi, " ").replace(/\s+/g, " ").trim()
}

function truncateMidjourneyText(text: string, maxChars: number) {
  const normalizedText = text.trim()

  if (normalizedText.length <= maxChars) {
    return normalizedText
  }

  const clipped = normalizedText.slice(0, Math.max(1, maxChars)).trim()
  const sentenceBoundary = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? "),
    clipped.lastIndexOf("; ")
  )
  const clauseBoundary = Math.max(clipped.lastIndexOf(", "), clipped.lastIndexOf(" "))
  const preferredBoundary = Math.max(sentenceBoundary, clauseBoundary)

  if (preferredBoundary > maxChars * 0.6) {
    return clipped.slice(0, preferredBoundary).trim().replace(/[,:;.!?\-]+$/g, "")
  }

  return clipped.replace(/[,:;.!?\-]+$/g, "")
}

function applyMidjourneyPromptLimits(
  prompt: string,
  globalPrompt: string,
  limits: MidjourneyPromptLimits
) {
  let normalizedPrompt = truncateMidjourneyText(
    stripAspectRatioFlag(normalizeMidjourneyPromptText(prompt)),
    limits.promptMaxChars
  )
  let normalizedGlobalPrompt = truncateMidjourneyText(
    stripAspectRatioFlag(normalizeMidjourneyPromptText(globalPrompt)),
    limits.globalPromptMaxChars
  )

  let mergedPrompt = [normalizedGlobalPrompt, normalizedPrompt].filter(Boolean).join(" ")

  if (mergedPrompt.length <= limits.totalMaxChars) {
    return mergedPrompt.trim()
  }

  const overflow = mergedPrompt.length - limits.totalMaxChars

  if (normalizedGlobalPrompt) {
    normalizedGlobalPrompt = truncateMidjourneyText(
      normalizedGlobalPrompt,
      Math.max(0, normalizedGlobalPrompt.length - overflow)
    )
    mergedPrompt = [normalizedGlobalPrompt, normalizedPrompt].filter(Boolean).join(" ")
  }

  if (mergedPrompt.length <= limits.totalMaxChars) {
    return mergedPrompt.trim()
  }

  normalizedPrompt = truncateMidjourneyText(
    normalizedPrompt,
    Math.max(1, normalizedPrompt.length - (mergedPrompt.length - limits.totalMaxChars))
  )

  return [normalizedGlobalPrompt, normalizedPrompt].filter(Boolean).join(" ").trim()
}

function buildMidjourneyPrompt(
  prompt: string,
  globalPrompt: string,
  width: number,
  height: number,
  limits: MidjourneyPromptLimits = MIDJOURNEY_DEFAULT_PROMPT_LIMITS
) {
  const mergedPrompt = applyMidjourneyPromptLimits(prompt, globalPrompt, limits)
  const normalizedPrompt = mergedPrompt.replace(/\s+/g, " ").trim()

  if (!normalizedPrompt) {
    return ""
  }

  if (/--ar\s+\d+\s*:\s*\d+/i.test(normalizeMidjourneyPromptText(`${globalPrompt} ${prompt}`))) {
    return normalizedPrompt
  }

  return `${normalizedPrompt} --ar ${buildAspectRatio(width, height)}`.trim()
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isMidjourneyUpstreamRetryFailure(error: unknown) {
  if (!(error instanceof FileStoreError)) {
    return false
  }

  return /all_retries_failed|upstream_error/i.test(error.message)
}

async function waitForMidjourneyTask(
  baseUrl: string,
  apiKey: string,
  taskId: string
): Promise<MidjourneyTaskResponse> {
  const deadline = Date.now() + MIDJOURNEY_TASK_TIMEOUT_MS

  while (Date.now() <= deadline) {
    const task = await getJson<MidjourneyTaskResponse>(
      buildMidjourneyUrl(baseUrl, `/mj/task/${encodeURIComponent(taskId)}/fetch`),
      apiKey,
      "ai.midjourney-task-fetch-failed",
      "Failed to fetch Midjourney task"
    )

    const status = task.status?.trim().toUpperCase() || ""

    if (status === "SUCCESS") {
      return task
    }

    if (["FAIL", "FAILED", "FAILURE", "CANCEL", "CANCELLED", "ERROR"].includes(status)) {
      const reason = task.failReason?.trim() || task.description?.trim() || `status ${status}`
      throw new FileStoreError(
        `Midjourney task failed: ${reason}`,
        502,
        "ai.midjourney-task-failed"
      )
    }

    await sleep(MIDJOURNEY_POLL_INTERVAL_MS)
  }

  throw new FileStoreError(
    `Midjourney task timed out after ${Math.round(MIDJOURNEY_TASK_TIMEOUT_MS / 60000)} minutes.`,
    502,
    "ai.midjourney-task-timeout"
  )
}

async function generateMidjourneyImage(
  settings: AppSettingsFile,
  prompt: string,
  globalPrompt: string,
  width: number,
  height: number
): Promise<GeneratedImageResult> {
  const ai = requireImageProvider(settings)
  const primaryPrompt = buildMidjourneyPrompt(prompt, globalPrompt, width, height)

  if (!primaryPrompt) {
    throw new FileStoreError("Location prompt is required.", 400, "location.prompt-required")
  }

  async function submitMidjourneyPrompt(finalPrompt: string) {
    return postJson<MidjourneySubmitResponse>(
      buildMidjourneyUrl(ai.baseUrl, "/mj/submit/imagine"),
      ai.apiKey,
      {
        botType: "MID_JOURNEY",
        prompt: finalPrompt,
        state: "story-mgr"
      },
      "ai.midjourney-submit-failed",
      "Failed to submit Midjourney imagine task"
    )
  }

  let submitResult: MidjourneySubmitResponse

  try {
    submitResult = await submitMidjourneyPrompt(primaryPrompt)
  } catch (error) {
    if (!isMidjourneyUpstreamRetryFailure(error)) {
      throw error
    }

    const retryPrompt = buildMidjourneyPrompt(
      prompt,
      globalPrompt,
      width,
      height,
      MIDJOURNEY_RETRY_PROMPT_LIMITS
    )

    if (!retryPrompt || retryPrompt === primaryPrompt) {
      throw error
    }

    submitResult = await submitMidjourneyPrompt(retryPrompt)
  }

  if (typeof submitResult.code === "number" && ![1, 22].includes(submitResult.code)) {
    throw new FileStoreError(
      `Failed to submit Midjourney imagine task: ${submitResult.description?.trim() || `code ${submitResult.code}`}`,
      502,
      "ai.midjourney-submit-failed"
    )
  }

  const taskId = String(submitResult.result ?? "").trim()

  if (!taskId) {
    throw new FileStoreError(
      "Midjourney did not return a task id.",
      502,
      "ai.midjourney-missing-task-id"
    )
  }

  const task = await waitForMidjourneyTask(ai.baseUrl, ai.apiKey, taskId)
  const imageUrl = task.imageUrl?.trim()

  if (!imageUrl) {
    throw new FileStoreError(
      "Midjourney task completed but did not return an image URL.",
      502,
      "ai.midjourney-empty-image-url"
    )
  }

  return downloadBinary(
    imageUrl,
    "ai.midjourney-download-failed",
    "Failed to download Midjourney image"
  )
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

export async function generateItemPrompt(
  settings: AppSettingsFile,
  input: ItemPromptInput
) {
  const ai = requireTextProvider(settings)

  if (!input.descr.trim()) {
    throw new FileStoreError("Item description is required.", 400, "item.descr-required")
  }

  const systemPrompt = [
    "You are a game item asset prompt designer.",
    "Return only the final English image prompt.",
    "The prompt should describe a single recognizable game item asset or icon.",
    "Focus on shape, material, color, detail, lighting, and clean presentation.",
    "Keep the item centered, isolated, readable at small size, and without characters or hands.",
    "Do not add explanation or markdown."
  ].join("\n")

  const userPrompt = [
    `Story title: ${input.storyTitle?.trim() || "Not provided"}`,
    `Item name: ${input.itemName.trim()}`,
    `Item category: ${input.categoryName.trim() || "Not provided"}`,
    `Item description: ${input.descr.trim()}`
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
    "ai.item-text-generation-failed",
    "Failed to generate item prompt"
  )

  const prompt = extractTextContent(payload.choices?.[0]?.message?.content)

  if (!prompt) {
    throw new FileStoreError("AI returned an empty item prompt.", 502, "ai.empty-item-prompt")
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

  if (isMidjourneyImagineModel(ai.model)) {
    return generateMidjourneyImage(settings, prompt, globalPrompt, width, height)
  }

  const finalPrompt = [globalPrompt.trim(), prompt.trim()].filter(Boolean).join("\n")
  const size = `${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`
  const isDoubaoSeedream = isDoubaoSeedreamModel(ai.model)

  const payload = await postJson<OpenAiImageGenerationResponse>(
    buildCompatibleUrl(ai.baseUrl, "/images/generations"),
    ai.apiKey,
    isDoubaoSeedream
      ? {
          model: ai.model,
          prompt: finalPrompt,
          response_format: "url",
          sequential_image_generation: "disabled",
          size,
          stream: false,
          watermark: true
        }
      : {
          model: ai.model,
          prompt: finalPrompt,
          size,
          response_format: "b64_json"
        },
    "ai.image-generation-failed",
    "Failed to generate image"
  )

  const base64 = payload.data?.[0]?.b64_json
  const imageUrl = payload.data?.[0]?.url?.trim()

  if (!base64) {
    if (imageUrl) {
      return downloadBinary(
        imageUrl,
        "ai.image-download-failed",
        "Failed to download generated image"
      )
    }

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

export async function generateItemImage(
  settings: AppSettingsFile,
  prompt: string,
  globalPrompt: string,
  width: number,
  height: number
): Promise<GeneratedImageResult> {
  if (!prompt.trim()) {
    throw new FileStoreError("Item prompt is required.", 400, "item.prompt-required")
  }

  return generateLocationImage(
    settings,
    `${prompt.trim()}\nsingle game item asset, centered object, isolated, no people, no hands`,
    globalPrompt,
    width,
    height
  )
}
