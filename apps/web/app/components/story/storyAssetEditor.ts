/**
 * 角色、地点和物品图片编辑器共用的纯工具。
 *
 * 输入来自表单文本、HTTP 错误和素材元数据；输出只用于校验与界面提示。
 * 本模块不调用图片接口，也不修改任何 Vue 状态。
 */
import type { StoryAssetMetadata } from "@story-mgr/shared"

export interface StoryAssetEditorState {
  error: string | null
  loading: boolean
  meta: StoryAssetMetadata | null
}

export interface StoryPromptEditorState {
  error: string | null
  loading: boolean
}

export interface StoryImagePreviewState {
  path: string
  title: string
  url: string
}

/** 将 `AssetText` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function normalizeAssetText(value: unknown) {
  return typeof value === "string" ? value : ""
}

/** 清理 `AssetNameInput` 输入中的非法字符或范围。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function sanitizeAssetNameInput(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

/** 解析 `PositiveIntegerInput` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function parsePositiveIntegerInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

/** 解析 `CompressQualityInput` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function parseCompressQualityInput(value: unknown) {
  const parsed = parsePositiveIntegerInput(value)
  return parsed !== null && parsed <= 100 ? parsed : null
}

/** 把 `AssetMetadata` 转换成界面可读文本。 @param meta 调用方传入的 `meta`。 @returns 计算、查找或构建后的结果。 */
export function formatAssetMetadata(meta: StoryAssetMetadata | null) {
  if (!meta) return ""
  const dimensions = typeof meta.width === "number" && typeof meta.height === "number"
    ? `${meta.width} x ${meta.height}`
    : "尺寸未知"
  return `${dimensions} / ${formatBytes(meta.sizeBytes)}`
}

/** 把 `Bytes` 转换成界面可读文本。 @param sizeBytes 调用方传入的 `sizeBytes`。 @returns 计算、查找或构建后的结果。 */
function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
}

/** 把 `StoryApiError` 转换成界面可读文本。 @param error 调用方传入的 `error`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
export function formatStoryApiError(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const responseError = error as {
      data?: { error?: { message?: string } }
      message?: string
      statusMessage?: string
    }
    const apiMessage = responseError.data?.error?.message?.trim()
    if (apiMessage) return apiMessage
    if (responseError.message?.trim()) return responseError.message
    if (responseError.statusMessage?.trim()) return responseError.statusMessage
  }
  return error instanceof Error ? error.message : fallback
}
