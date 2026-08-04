/**
 * 故事图片路径、扩展名和元数据的安全边界。
 *
 * 所有来自 URL、表单或故事文件的资产路径都必须先经过这里；函数只允许 `assets/` 下的相对路径，
 * 并在 resolve 后再次验证目录前缀，阻止 `../`、绝对路径和盘符路径穿越。
 */
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { FileStoreError } from "./errors"
import { createStoryPaths } from "./persistence"
import type { StoryAssetMetadata } from "./types"

const imageMimeTypes = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
} as const

const mimeTypeExtensions = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
} as const

/**
 * 规范故事内的相对资产路径。
 * @param assetPath 原始路径，可含 Windows 反斜杠。 @returns `/` 分隔且以 `assets/` 开头的路径。
 * @throws 空值、绝对路径、盘符、`..` 或 assets 外路径抛 400。
 */
export function normalizeStoryAssetPath(assetPath: string) {
  const trimmedPath = assetPath.replace(/\\/g, "/").trim()
  if (!trimmedPath) throw new FileStoreError("Asset path is required.", 400, "asset.path-required")
  if (path.posix.isAbsolute(trimmedPath) || /^[a-z]:/i.test(trimmedPath)) {
    throw new FileStoreError("Asset path must be relative.", 400, "asset.invalid-path")
  }
  const normalizedPath = path.posix.normalize(trimmedPath.replace(/^\.\//, ""))
  if (
    normalizedPath === "."
    || normalizedPath === ".."
    || normalizedPath.startsWith("../")
    || !normalizedPath.startsWith("assets/")
  ) {
    throw new FileStoreError("Asset path must stay inside the story assets directory.", 400, "asset.invalid-path")
  }
  return normalizedPath
}

/**
 * 将故事相对资产路径解析成磁盘绝对路径，并做第二次越界检查。
 * @param dataDir 数据根目录。 @param storyId 故事 id。 @param assetPath 相对资产路径。
 * @returns `{ normalizedPath, resolvedPath }`。
 * @throws 路径不合法或 resolve 后逃出故事目录时抛 400。
 */
export function resolveStoryAssetPath(dataDir: string, storyId: string, assetPath: string) {
  const storyDir = createStoryPaths(dataDir, storyId).storyDir
  const normalizedPath = normalizeStoryAssetPath(assetPath)
  const resolvedPath = path.resolve(storyDir, normalizedPath)
  const resolvedStoryDir = path.resolve(storyDir)
  if (resolvedPath !== resolvedStoryDir && !resolvedPath.startsWith(`${resolvedStoryDir}${path.sep}`)) {
    throw new FileStoreError("Resolved asset path escapes the story directory.", 400, "asset.invalid-path")
  }
  return { normalizedPath, resolvedPath }
}

/** @param assetPath 资产路径。 @returns 已知图片 MIME；未知扩展名返回 application/octet-stream。 */
export function getAssetMimeType(assetPath: string) {
  const extension = path.extname(assetPath).toLowerCase() as keyof typeof imageMimeTypes
  return imageMimeTypes[extension] ?? "application/octet-stream"
}

/**
 * 把任意文件名片段限制为安全 ASCII 名称。
 * @param fileName 原文件名。 @returns 小写、非法字符替换成短横线并去掉边缘短横线的文字。
 */
export function sanitizeFileNameSegment(fileName: string) {
  return fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "")
}

/** @param fileName 原文件名。 @returns 去扩展名的安全 stem；空结果回退为 `asset`。 */
export function sanitizeAssetStem(fileName: string) {
  return sanitizeFileNameSegment(fileName).replace(/\.[^.]+$/g, "") || "asset"
}

/**
 * 校验上传文件名中的图片扩展名。
 * @param fileName 客户端文件名。 @returns 小写 `.png/.jpg/.jpeg/.webp`。
 * @throws 不支持的扩展名抛 400。
 */
export function resolveUploadExtension(fileName: string) {
  const extension = path.extname(fileName).toLowerCase() as keyof typeof imageMimeTypes
  if (!imageMimeTypes[extension]) {
    throw new FileStoreError("Only png, jpg, jpeg, and webp images are supported.", 400, "asset.unsupported-image")
  }
  return extension
}

/** @param mimeType 可选响应 MIME。 @returns 对应安全扩展名；未知或缺失时回退 `.png`。 */
export function resolveExtensionFromMimeType(mimeType: string | undefined) {
  if (!mimeType) return ".png"
  return mimeTypeExtensions[mimeType.trim().toLowerCase() as keyof typeof mimeTypeExtensions] ?? ".png"
}

/**
 * 用 Sharp 真正解码上传内容，而不是只相信文件名/MIME。
 * @param fileContent 上传的原始 Buffer。 @returns Promise<void>；能读出格式即通过。
 * @throws 解码失败或缺少 format 时抛 400 `asset.invalid-image`。
 */
export async function ensureReadableImage(fileContent: Buffer) {
  try {
    const metadata = await sharp(fileContent).metadata()
    if (!metadata.format) throw new Error("Missing image format metadata.")
  } catch {
    throw new FileStoreError("The uploaded file is not a valid image.", 400, "asset.invalid-image")
  }
}

/**
 * 读取一个现有故事资产的文件与图片元数据。
 *
 * @param dataDir 数据根目录。 @param storyId 故事 id。 @param assetPath 安全相对路径。
 * @returns 文件名、MIME、字节数和可选宽高。
 * @throws 文件不存在抛 404；路径非法抛 400。
 *
 * 图片尺寸读取失败不会让整个资产不可用，只把 width/height 留空；stat 失败则无法证明文件存在，必须报错。
 */
export async function createStoryAssetMetadata(
  dataDir: string,
  storyId: string,
  assetPath: string
): Promise<StoryAssetMetadata> {
  const { normalizedPath, resolvedPath } = resolveStoryAssetPath(dataDir, storyId, assetPath)
  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    fileStat = await stat(resolvedPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FileStoreError(`Asset not found: ${normalizedPath}`, 404, "asset.not-found")
    }
    throw error
  }

  let width: number | undefined
  let height: number | undefined
  try {
    const metadata = await sharp(await readFile(resolvedPath)).metadata()
    width = metadata.width
    height = metadata.height
  } catch {
    width = undefined
    height = undefined
  }

  return {
    assetPath: normalizedPath,
    fileName: path.basename(normalizedPath),
    mimeType: getAssetMimeType(normalizedPath),
    sizeBytes: fileStat.size,
    width,
    height
  }
}
