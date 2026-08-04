/**
 * 保存资产配置后清理不再被引用的图片。
 *
 * 清理范围严格限制在各领域自己的目录；引用路径解析失败时视为“未引用”，但删除仍只针对扫描到的
 * 已知领域目录。Windows 文件占用会按递增等待重试，最终放弃而不让一次保存失败。
 */
import { readdir, rm } from "node:fs/promises"
import path from "node:path"
import type {
  StoryEventLocationFile,
  StoryItemsFile,
  StoryRolesFile,
  StorySceneFile
} from "@story-mgr/core"
import { normalizeStoryAssetPath } from "./asset-paths"
import { createStoryPaths } from "./persistence"

/**
 * 递归列出目录中的普通文件。
 * @param directory 扫描根目录。 @returns 所有后代文件的绝对路径；目录不存在返回空数组。
 * @throws 非 ENOENT 的读取错误原样抛出。
 */
export async function listFilesRecursively(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const nestedFileLists = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return listFilesRecursively(entryPath)
      return entry.isFile() ? [entryPath] : []
    }))
    return nestedFileLists.flat()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

/** @param ms 等待毫秒数。 @returns 指定时间后完成的 Promise。 */
export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 删除文件，并针对 Windows EBUSY/EPERM 做有限重试。
 *
 * @param filePath 明确的单个文件路径。 @param retries 最大尝试次数，默认 8。
 * @returns Promise<void>；成功、文件已不存在或最终可重试失败均正常完成。
 * @throws 非 EBUSY/EPERM 错误立即抛出。
 */
export async function removeFileWithRetry(filePath: string, retries = 8) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await rm(filePath, { force: true })
      return
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code
      const isRetryable = errorCode === "EBUSY" || errorCode === "EPERM"
      if (!isRetryable) throw error
      if (attempt === retries - 1) return
      await delay(180 * (attempt + 1))
    }
  }
}

/**
 * 收集场景 day/night 正在引用的背景路径。
 * @param scenes 场景文件。 @returns 合法 `assets/background/` 路径 Set。
 */
export function collectReferencedSceneAssetPaths(scenes: StorySceneFile) {
  const references = new Set<string>()
  for (const scene of scenes.scenes) {
    for (const assetPath of [scene.day_img, scene.night_img]) {
      const normalizedSourcePath = normalizeTextAssetPath(assetPath)
      if (normalizedSourcePath) references.add(normalizedSourcePath)
    }
  }
  return references
}

/**
 * 安全解析一个可选背景图片字段。
 * @param assetPath 故事文件中的文字。 @returns 合法背景路径，空值/非法/前缀不符返回 null。
 */
export function normalizeTextAssetPath(assetPath: string) {
  const trimmedPath = assetPath.trim()
  if (!trimmedPath) return null
  try {
    const normalizedPath = normalizeStoryAssetPath(trimmedPath)
    return normalizedPath.startsWith("assets/background/") ? normalizedPath : null
  } catch {
    return null
  }
}

/** @param eventLocations 地点配置。 @returns 所有 raw/compress 地点图片路径 Set。 */
export function collectReferencedLocationAssetPaths(eventLocations: StoryEventLocationFile) {
  const references = new Set<string>()
  for (const assignment of eventLocations.assignments) {
    for (const assetPath of [assignment.img_raw, assignment.img_compress_1, assignment.img_compress_2]) {
      const normalized = normalizeTextAssetPathForPrefix(assetPath, "assets/event_location/")
      if (normalized) references.add(normalized)
    }
  }
  return references
}

/** @param items 物品库。 @returns 所有 raw/compress 物品图片路径 Set。 */
export function collectReferencedItemAssetPaths(items: StoryItemsFile) {
  const references = new Set<string>()
  for (const item of items.items) {
    for (const assetPath of [item.img_raw, item.img_compress_1, item.img_compress_2]) {
      const normalized = normalizeTextAssetPathForPrefix(assetPath, "assets/items/")
      if (normalized) references.add(normalized)
    }
  }
  return references
}

/**
 * 收集普通/重要角色的全部性别和压缩图片路径。
 * @param roles 两类角色文件。 @returns 合法 `assets/roles/` 路径 Set。
 */
export function collectReferencedRoleAssetPaths(roles: StoryRolesFile) {
  const references = new Set<string>()
  for (const role of roles.normal.roles) {
    for (const assetPath of [role.img_raw, role.img_compress_1, role.img_compress_2]) {
      const normalized = normalizeTextAssetPathForPrefix(assetPath, "assets/roles/")
      if (normalized) references.add(normalized)
    }
  }
  for (const role of roles.important.roles) {
    for (const assetPath of [
      role.img_raw,
      role.img_compress_1,
      role.img_compress_2,
      role.img_male_raw,
      role.img_male_compress_1,
      role.img_male_compress_2,
      role.img_female_raw,
      role.img_female_compress_1,
      role.img_female_compress_2
    ]) {
      const normalized = normalizeTextAssetPathForPrefix(assetPath, "assets/roles/")
      if (normalized) references.add(normalized)
    }
  }
  return references
}

/**
 * 安全解析可选资产字段并限制领域目录前缀。
 * @param assetPath 故事文件中的文字。 @param expectedPrefix 允许的 `assets/.../` 前缀。
 * @returns 通过两层检查的路径，空值或非法路径返回 null。
 */
export function normalizeTextAssetPathForPrefix(assetPath: string, expectedPrefix: string) {
  const trimmedPath = assetPath.trim()
  if (!trimmedPath) return null
  try {
    const normalizedPath = normalizeStoryAssetPath(trimmedPath)
    return normalizedPath.startsWith(expectedPrefix) ? normalizedPath : null
  } catch {
    return null
  }
}

/**
 * 删除背景目录中未被当前场景引用的文件。
 * @param dataDir 数据根目录。 @param storyId 故事 id。 @param scenes 已保存的场景配置。
 * @returns 全部删除任务完成后的 Promise。
 */
export async function pruneUnusedSceneBackgroundAssets(dataDir: string, storyId: string, scenes: StorySceneFile) {
  const paths = createStoryPaths(dataDir, storyId)
  const referencedAssets = collectReferencedSceneAssetPaths(scenes)
  const existingFiles = await listFilesRecursively(paths.backgroundDir)
  await Promise.all(existingFiles.map(async (filePath) => {
    const relativePath = path.relative(paths.storyDir, filePath).replace(/\\/g, "/")
    if (!referencedAssets.has(relativePath)) await removeFileWithRetry(filePath)
  }))
}

/** @param dataDir 数据根目录。 @param storyId 故事 id。 @param eventLocations 已保存地点配置。 @returns 清理完成 Promise。 */
export async function pruneUnusedLocationAssets(dataDir: string, storyId: string, eventLocations: StoryEventLocationFile) {
  const paths = createStoryPaths(dataDir, storyId)
  const references = collectReferencedLocationAssetPaths(eventLocations)
  const files = await listFilesRecursively(paths.eventLocationAssetsDir)
  await Promise.all(files.map(async (filePath) => {
    const relativePath = path.relative(paths.storyDir, filePath).replace(/\\/g, "/")
    if (!references.has(relativePath)) await removeFileWithRetry(filePath)
  }))
}

/** @param dataDir 数据根目录。 @param storyId 故事 id。 @param items 已保存物品库。 @returns 清理完成 Promise。 */
export async function pruneUnusedItemAssets(dataDir: string, storyId: string, items: StoryItemsFile) {
  const paths = createStoryPaths(dataDir, storyId)
  const references = collectReferencedItemAssetPaths(items)
  const files = await listFilesRecursively(paths.itemAssetsDir)
  await Promise.all(files.map(async (filePath) => {
    const relativePath = path.relative(paths.storyDir, filePath).replace(/\\/g, "/")
    if (!references.has(relativePath)) await removeFileWithRetry(filePath)
  }))
}

/** @param dataDir 数据根目录。 @param storyId 故事 id。 @param roles 已保存角色库。 @returns 清理完成 Promise。 */
export async function pruneUnusedRoleAssets(dataDir: string, storyId: string, roles: StoryRolesFile) {
  const paths = createStoryPaths(dataDir, storyId)
  const references = collectReferencedRoleAssetPaths(roles)
  const files = await listFilesRecursively(paths.roleAssetsDir)
  await Promise.all(files.map(async (filePath) => {
    const relativePath = path.relative(paths.storyDir, filePath).replace(/\\/g, "/")
    if (!references.has(relativePath)) await removeFileWithRetry(filePath)
  }))
}
