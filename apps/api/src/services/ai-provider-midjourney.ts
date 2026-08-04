/**
 * Midjourney 代理协议、提示词裁剪和异步任务轮询。
 *
 * 上层提供提示词和尺寸，本模块把文本限制在代理可接受范围，提交 imagine 任务、轮询终态并下载图片。
 * 它不写故事文件，得到的 Buffer 仍需由 File Store 使用 Sharp 验证。
 */
import type { AppSettingsFile } from "@story-mgr/core"
import { FileStoreError } from "@story-mgr/file-store"
import {
  MIDJOURNEY_DEFAULT_PROMPT_LIMITS,
  MIDJOURNEY_POLL_INTERVAL_MS,
  MIDJOURNEY_RETRY_PROMPT_LIMITS,
  MIDJOURNEY_TASK_TIMEOUT_MS,
  type GeneratedImageResult,
  type MidjourneyPromptLimits,
  type MidjourneySubmitResponse,
  type MidjourneyTaskResponse
} from "./ai-provider-contracts"
import {
  buildMidjourneyUrl,
  downloadBinary,
  getJson,
  postJson,
  requireImageProvider
} from "./ai-provider-http"

/**
 * 用欧几里得算法求两个整数的最大公约数。
 *
 * @param a 第一个数。
 * @param b 第二个数。
 * @returns 正整数公约数；两个输入都为 0 时回退为 1，避免后续除零。
 */
export function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a)
  let right = Math.abs(b)
  while (right !== 0) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return left || 1
}

/**
 * 把像素尺寸约分为 Midjourney `宽:高` 比例。
 *
 * @param width 原始宽度。
 * @param height 原始高度。
 * @returns 至少按 1 处理并四舍五入后的最简比例，例如 1920x1080 返回 `16:9`。
 */
export function buildAspectRatio(width: number, height: number): string {
  const normalizedWidth = Math.max(1, Math.round(width))
  const normalizedHeight = Math.max(1, Math.round(height))
  const divisor = greatestCommonDivisor(normalizedWidth, normalizedHeight)
  return `${normalizedWidth / divisor}:${normalizedHeight / divisor}`
}

/**
 * 统一提示词中的换行、连续空白和中英文引号。
 *
 * @param text 原始提示词。
 * @returns 适合计算字符数和提交接口的单行文本。
 */
export function normalizeMidjourneyPromptText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim()
}

/**
 * 删除用户已经写入的 `--ar 宽:高`，避免最终提示词出现重复比例。
 * @param text 规范化前后的提示词均可。
 * @returns 去除所有比例参数并合并空白后的文本。
 */
export function stripAspectRatioFlag(text: string): string {
  return text.replace(/\s*--ar\s+\d+\s*:\s*\d+/gi, " ").replace(/\s+/g, " ").trim()
}

/**
 * 在字符上限内尽量按句子或词边界裁剪提示词。
 *
 * @param text 原始文本。
 * @param maxChars 最大字符数。
 * @returns 未超限时原样 trim；超限时返回不带残余标点的可读前缀。
 *
 * 只有边界位于限制的 60% 之后才采用它，避免为了完整句子丢掉大半提示词；否则在硬上限处截断。
 */
export function truncateMidjourneyText(text: string, maxChars: number): string {
  const normalizedText = text.trim()
  if (normalizedText.length <= maxChars) return normalizedText

  const clipped = normalizedText.slice(0, Math.max(1, maxChars)).trim()
  const sentenceBoundary = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? "),
    clipped.lastIndexOf("; ")
  )
  const preferredBoundary = Math.max(
    sentenceBoundary,
    clipped.lastIndexOf(", "),
    clipped.lastIndexOf(" ")
  )
  const result = preferredBoundary > maxChars * 0.6
    ? clipped.slice(0, preferredBoundary).trim()
    : clipped
  return result.replace(/[,:;.!?\-]+$/g, "")
}

/**
 * 同时限制全局提示词、主体提示词和合并后的总长度。
 *
 * @param prompt 当前资产主体描述。
 * @param globalPrompt 全局画风描述。
 * @param limits 三种字符上限。
 * @returns 去掉旧 `--ar` 且不超过总上限的合并提示词。
 *
 * 算法先分别裁剪；总长仍超限时优先缩短全局画风，最后才缩短主体内容，因为主体通常包含更关键
 * 的角色、地点或物品特征。
 */
export function applyMidjourneyPromptLimits(
  prompt: string,
  globalPrompt: string,
  limits: MidjourneyPromptLimits
): string {
  let normalizedPrompt = truncateMidjourneyText(
    stripAspectRatioFlag(normalizeMidjourneyPromptText(prompt)),
    limits.promptMaxChars
  )
  let normalizedGlobalPrompt = truncateMidjourneyText(
    stripAspectRatioFlag(normalizeMidjourneyPromptText(globalPrompt)),
    limits.globalPromptMaxChars
  )
  let mergedPrompt = [normalizedGlobalPrompt, normalizedPrompt].filter(Boolean).join(" ")
  if (mergedPrompt.length <= limits.totalMaxChars) return mergedPrompt.trim()

  const overflow = mergedPrompt.length - limits.totalMaxChars
  if (normalizedGlobalPrompt) {
    normalizedGlobalPrompt = truncateMidjourneyText(
      normalizedGlobalPrompt,
      Math.max(0, normalizedGlobalPrompt.length - overflow)
    )
    mergedPrompt = [normalizedGlobalPrompt, normalizedPrompt].filter(Boolean).join(" ")
  }
  if (mergedPrompt.length <= limits.totalMaxChars) return mergedPrompt.trim()

  normalizedPrompt = truncateMidjourneyText(
    normalizedPrompt,
    Math.max(1, normalizedPrompt.length - (mergedPrompt.length - limits.totalMaxChars))
  )
  return [normalizedGlobalPrompt, normalizedPrompt].filter(Boolean).join(" ").trim()
}

/**
 * 构造最终 Midjourney imagine 提示词。
 *
 * @param prompt 资产主体提示词。
 * @param globalPrompt 全局画风提示词。
 * @param width 目标宽度。
 * @param height 目标高度。
 * @param limits 可选长度限制，默认使用首次提交配置。
 * @returns 合并文本并附加 `--ar`；空文本返回空字符串；用户已有比例时不重复添加。
 */
export function buildMidjourneyPrompt(
  prompt: string,
  globalPrompt: string,
  width: number,
  height: number,
  limits: MidjourneyPromptLimits = MIDJOURNEY_DEFAULT_PROMPT_LIMITS
): string {
  const normalizedPrompt = applyMidjourneyPromptLimits(prompt, globalPrompt, limits)
    .replace(/\s+/g, " ")
    .trim()
  if (!normalizedPrompt) return ""
  if (/--ar\s+\d+\s*:\s*\d+/i.test(normalizeMidjourneyPromptText(`${globalPrompt} ${prompt}`))) {
    return normalizedPrompt
  }
  return `${normalizedPrompt} --ar ${buildAspectRatio(width, height)}`.trim()
}

/**
 * 创建一个指定毫秒后完成的 Promise。
 * @param milliseconds 等待时长。
 * @returns 到时 resolve 的 Promise，用于轮询间隔。
 */
export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * 判断提交错误是否属于可通过更短提示词重试的上游失败。
 * @param error 捕获到的未知错误。
 * @returns 仅特定 FileStoreError 消息返回 true。
 */
export function isMidjourneyUpstreamRetryFailure(error: unknown): boolean {
  return error instanceof FileStoreError
    && /all_retries_failed|upstream_error/i.test(error.message)
}

/**
 * 轮询 Midjourney 任务直到成功、失败或超时。
 *
 * @param baseUrl Midjourney 代理基地址。
 * @param apiKey 供应商密钥。
 * @param taskId 提交接口返回的任务 id。
 * @returns SUCCESS 状态的最终任务，其中应包含 imageUrl。
 * @throws 明确失败状态或 20 分钟超时抛 502；单次查询失败沿用 getJson 错误。
 */
export async function waitForMidjourneyTask(
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
    if (status === "SUCCESS") return task
    if (["FAIL", "FAILED", "FAILURE", "CANCEL", "CANCELLED", "ERROR"].includes(status)) {
      const reason = task.failReason?.trim() || task.description?.trim() || `status ${status}`
      throw new FileStoreError(`Midjourney task failed: ${reason}`, 502, "ai.midjourney-task-failed")
    }
    await sleep(MIDJOURNEY_POLL_INTERVAL_MS)
  }
  throw new FileStoreError(
    `Midjourney task timed out after ${Math.round(MIDJOURNEY_TASK_TIMEOUT_MS / 60000)} minutes.`,
    502,
    "ai.midjourney-task-timeout"
  )
}

/**
 * 完成一次 Midjourney 图片生成：整理提示词、提交、必要时缩短重试、轮询并下载。
 *
 * @param settings 应用图片模型设置。
 * @param prompt 资产主体提示词。
 * @param globalPrompt 全局画风提示词。
 * @param width 目标宽度。
 * @param height 目标高度。
 * @returns 下载后的图片 Buffer 和 MIME 类型。
 * @throws 空提示词抛 400；提交、任务失败、缺少 taskId/imageUrl 或下载失败抛 502。
 */
export async function generateMidjourneyImage(
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

  /**
   * 向代理提交一次已经整理好的 imagine 提示词。
   * @param finalPrompt 最终提示词，已经包含比例参数。
   * @returns 代理提交响应，result 通常是 taskId。
   * @throws 网络或非 2xx 响应抛 502。
   */
  async function submitMidjourneyPrompt(finalPrompt: string): Promise<MidjourneySubmitResponse> {
    return postJson<MidjourneySubmitResponse>(
      buildMidjourneyUrl(ai.baseUrl, "/mj/submit/imagine"),
      ai.apiKey,
      { botType: "MID_JOURNEY", prompt: finalPrompt, state: "story-mgr" },
      "ai.midjourney-submit-failed",
      "Failed to submit Midjourney imagine task"
    )
  }

  let submitResult: MidjourneySubmitResponse
  try {
    submitResult = await submitMidjourneyPrompt(primaryPrompt)
  } catch (error) {
    if (!isMidjourneyUpstreamRetryFailure(error)) throw error
    const retryPrompt = buildMidjourneyPrompt(
      prompt,
      globalPrompt,
      width,
      height,
      MIDJOURNEY_RETRY_PROMPT_LIMITS
    )
    if (!retryPrompt || retryPrompt === primaryPrompt) throw error
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
    throw new FileStoreError("Midjourney did not return a task id.", 502, "ai.midjourney-missing-task-id")
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
