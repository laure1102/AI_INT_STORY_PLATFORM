/**
 * AI Provider 的配置检查与通用 HTTP 传输层。
 *
 * 上层传入应用设置、URL 和 payload，本模块负责规范化 OpenAI 兼容地址、添加鉴权、设置超时、
 * 下载 JSON/二进制并把上游失败转换成 FileStoreError。它不理解故事内容，也不轮询 Midjourney。
 */
import type { AppSettingsFile } from "@story-mgr/core"
import { FileStoreError } from "@story-mgr/file-store"
import { Agent, fetch as undiciFetch } from "undici"
import {
  AI_BODY_TIMEOUT_MS,
  AI_HEADERS_TIMEOUT_MS,
  AI_TOTAL_TIMEOUT_MS,
  type GeneratedImageResult
} from "./ai-provider-contracts"

/** 复用连接并统一超时的 undici Agent；所有 AI HTTP 请求共享此实例。 */
export const aiHttpAgent = new Agent({
  bodyTimeout: AI_BODY_TIMEOUT_MS,
  connectTimeout: 60 * 1000,
  headersTimeout: AI_HEADERS_TIMEOUT_MS
})

/**
 * 取得应用设置中的 AI 总配置。
 *
 * @param settings File Store 读取并通过 Core Schema 的应用设置。
 * @returns `settings.ai`，供后续按 text/image 选择供应商。
 */
export function requireAiConfig(settings: AppSettingsFile): AppSettingsFile["ai"] {
  return settings.ai
}

/**
 * 把 OpenAI 兼容地址整理成恰好以 `/v1` 结尾的基地址。
 *
 * @param baseUrl 用户配置的地址，可有尾部斜杠或已含 `/v1`。
 * @returns 空输入返回空字符串；否则返回无尾斜杠的绝对 URL。
 * @throws URL 语法无效时由 `new URL` 抛错。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ""

  const url = new URL(trimmed)
  const pathname = url.pathname.replace(/\/+$/, "")
  url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`
  return url.toString().replace(/\/+$/, "")
}

/**
 * 拼出 OpenAI 兼容接口的完整 URL。
 *
 * @param baseUrl 用户配置的供应商基地址。
 * @param endpoint 以 `/` 开头的端点，例如 `/chat/completions`。
 * @returns 规范化基地址和 endpoint 的连接结果；空基地址返回空字符串。
 */
export function buildCompatibleUrl(baseUrl: string, endpoint: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  return normalized ? `${normalized.replace(/\/+$/, "")}${endpoint}` : ""
}

/**
 * 把 Midjourney 代理地址整理到服务根路径，而不是 OpenAI 的 `/v1` 路径。
 *
 * @param baseUrl 用户配置的图片供应商地址。
 * @returns 去掉尾部 `/v1` 和斜杠的根地址；空输入返回空字符串。
 * @throws URL 语法无效时抛错。
 */
export function normalizeMidjourneyBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ""

  const url = new URL(trimmed)
  const pathname = url.pathname.replace(/\/+$/, "")
  url.pathname = pathname.replace(/\/v1$/, "") || "/"
  return url.toString().replace(/\/+$/, "")
}

/**
 * 拼出 Midjourney 代理的完整端点 URL。
 *
 * @param baseUrl 用户配置地址。
 * @param endpoint `/mj/...` 形式的代理端点。
 * @returns 完整 URL；基地址为空时返回空字符串。
 */
export function buildMidjourneyUrl(baseUrl: string, endpoint: string): string {
  const normalized = normalizeMidjourneyBaseUrl(baseUrl)
  return normalized ? `${normalized.replace(/\/+$/, "")}${endpoint}` : ""
}

/**
 * 从 OpenAI 风格 message.content 中提取纯文本。
 *
 * @param content 字符串、分段 content 数组或 undefined。
 * @returns 合并并 trim 后的文字；无法识别时返回空字符串。
 */
export function extractTextContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === "string") return content.trim()
  if (!Array.isArray(content)) return ""
  return content.map((part) => part?.text ?? "").join("").trim()
}

/**
 * 向 AI 供应商发送带 Bearer Token 的 JSON POST。
 *
 * @param url 完整上游 URL。
 * @param apiKey 供应商密钥。
 * @param payload 会被 JSON.stringify 的请求对象。
 * @param errorCode 失败时返回给 API 的稳定机器码。
 * @param errorMessage 失败消息前缀，用于服务端诊断。
 * @returns 解析成调用方指定类型的 JSON。
 * @throws 网络/超时/非 2xx 都转换为 502 FileStoreError。
 */
export async function postJson<TResponse>(
  url: string,
  apiKey: string,
  payload: Record<string, unknown>,
  errorCode: string,
  errorMessage: string
): Promise<TResponse> {
  let response
  try {
    response = await undiciFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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

/**
 * 从 AI 供应商读取带鉴权的 JSON。
 *
 * @param url 完整上游 URL。
 * @param apiKey 供应商密钥。
 * @param errorCode 失败时使用的稳定错误码。
 * @param errorMessage 诊断消息前缀。
 * @returns 解析后的 JSON。
 * @throws 网络、超时和非 2xx 响应统一转成 502。
 */
export async function getJson<TResponse>(
  url: string,
  apiKey: string,
  errorCode: string,
  errorMessage: string
): Promise<TResponse> {
  let response
  try {
    response = await undiciFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
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

/**
 * 下载上游生成图片的原始二进制。
 *
 * @param url 图片 URL，通常来自豆包或 Midjourney 完成结果。
 * @param errorCode 下载失败时的稳定错误码。
 * @param errorMessage 服务端诊断前缀。
 * @returns Node Buffer 和响应 Content-Type；缺少类型时回退为 image/png。
 * @throws 网络、超时或非 2xx 响应转成 502。
 */
export async function downloadBinary(
  url: string,
  errorCode: string,
  errorMessage: string
): Promise<GeneratedImageResult> {
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
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType }
}

/** @param model 图片模型名。@returns 仅 `mj_imagine`（忽略大小写和空格）返回 true。 */
export function isMidjourneyImagineModel(model: string): boolean {
  return model.trim().toLowerCase() === "mj_imagine"
}

/** @param model 图片模型名。@returns 当前受支持的豆包 Seedream 标识是否匹配。 */
export function isDoubaoSeedreamModel(model: string): boolean {
  return model.trim().toLowerCase() === "doubao-seedream-4-0-250828"
}

/**
 * 读取并检查文本模型配置。
 *
 * @param settings 应用设置。
 * @returns 完整的 text provider 配置。
 * @throws baseUrl、apiKey 或 model 任一为空时抛 400，提示具体缺失字段。
 */
export function requireTextProvider(settings: AppSettingsFile): AppSettingsFile["ai"]["text"] {
  const ai = requireAiConfig(settings).text
  if (!ai.baseUrl.trim()) throw new FileStoreError("Text model baseUrl is required.", 400, "ai.text-base-url-required")
  if (!ai.apiKey.trim()) throw new FileStoreError("Text model apiKey is required.", 400, "ai.text-api-key-required")
  if (!ai.model.trim()) throw new FileStoreError("Text model name is required.", 400, "ai.text-model-required")
  return ai
}

/**
 * 读取并检查图片模型配置。
 *
 * @param settings 应用设置。
 * @returns 完整的 image provider 配置。
 * @throws baseUrl、apiKey 或 model 任一为空时抛 400。
 */
export function requireImageProvider(settings: AppSettingsFile): AppSettingsFile["ai"]["image"] {
  const ai = requireAiConfig(settings).image
  if (!ai.baseUrl.trim()) throw new FileStoreError("Image model baseUrl is required.", 400, "ai.image-base-url-required")
  if (!ai.apiKey.trim()) throw new FileStoreError("Image model apiKey is required.", 400, "ai.image-api-key-required")
  if (!ai.model.trim()) throw new FileStoreError("Image model name is required.", 400, "ai.image-model-required")
  return ai
}
