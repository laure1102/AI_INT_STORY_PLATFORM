/**
 * AI Provider 使用的公共数据类型和超时常量。
 *
 * 这些契约同时被通用 HTTP 层、Midjourney 层和领域 AI 服务读取，不包含任何网络或文件副作用。
 */

/** 地点提示词生成所需的编辑器输入。 */
export interface LocationPromptInput {
  descr: string
  locationName: string
  storyTitle?: string
}

/** 物品提示词生成所需的编辑器输入。 */
export interface ItemPromptInput {
  categoryName: string
  descr: string
  itemName: string
  storyTitle?: string
}

/** 角色提示词生成所需的编辑器输入。 */
export interface RolePromptInput {
  descr: string
  gender: "common" | "male" | "female"
  important: boolean
  qufenXingbie: boolean
  roleName: string
  storyTitle?: string
  xingge?: string
}

/** 图片供应商最终交给 File Store 的二进制结果。 */
export interface GeneratedImageResult {
  buffer: Buffer
  mimeType: string
}

/** 项目实际读取的 OpenAI 兼容聊天响应最小结构。 */
export interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}

/** 项目实际读取的 OpenAI 兼容图片响应最小结构。 */
export interface OpenAiImageGenerationResponse {
  data?: Array<{
    b64_json?: string
    revised_prompt?: string
    url?: string
  }>
}

/** Midjourney 提交 imagine 任务后的最小响应结构。 */
export interface MidjourneySubmitResponse {
  code?: number
  description?: string
  properties?: Record<string, unknown>
  result?: number | string
}

/** Midjourney 轮询任务状态时会读取的字段。 */
export interface MidjourneyTaskResponse {
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

/** Midjourney 对全局提示词、主体提示词和合并文本的字符上限。 */
export interface MidjourneyPromptLimits {
  globalPromptMaxChars: number
  promptMaxChars: number
  totalMaxChars: number
}

/** 等待上游返回响应头的最长时间。 */
export const AI_HEADERS_TIMEOUT_MS = 5 * 60 * 1000
/** 下载完整上游响应体的最长时间。 */
export const AI_BODY_TIMEOUT_MS = 10 * 60 * 1000
/** 单次 fetch 总超时。 */
export const AI_TOTAL_TIMEOUT_MS = 10 * 60 * 1000
/** Midjourney 异步任务从提交到完成的最长时间。 */
export const MIDJOURNEY_TASK_TIMEOUT_MS = 20 * 60 * 1000
/** Midjourney 状态轮询间隔。 */
export const MIDJOURNEY_POLL_INTERVAL_MS = 5 * 1000

/** 第一次提交 Midjourney 时使用的提示词长度限制。 */
export const MIDJOURNEY_DEFAULT_PROMPT_LIMITS: MidjourneyPromptLimits = {
  globalPromptMaxChars: 520,
  promptMaxChars: 1400,
  totalMaxChars: 1700
}

/** 上游提示词过长并重试时使用的更严格限制。 */
export const MIDJOURNEY_RETRY_PROMPT_LIMITS: MidjourneyPromptLimits = {
  globalPromptMaxChars: 320,
  promptMaxChars: 1200,
  totalMaxChars: 1400
}
