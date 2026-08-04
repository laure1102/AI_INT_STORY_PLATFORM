/**
 * 新故事元信息和目录边界校验。
 *
 * 本模块只处理创建故事时用户输入的 id、标题和标签；不写默认文件，也不处理一般资产路径。
 */
import { stat } from "node:fs/promises"
import path from "node:path"
import { storyMetaSchema, type StoryMetaFile } from "@story-mgr/core"
import { FileStoreError } from "./errors"
import { createStoryPaths } from "./persistence"
import type { CreateStoryInput } from "./types"

/**
 * 规范并校验新故事 id。
 * @param rawId 表单传入的原始 id。 @returns 小写、去空格的安全目录名。
 * @throws 空值或包含白名单外字符时抛 400 FileStoreError。
 */
export function normalizeNewStoryId(rawId: string) {
  const storyId = rawId.trim().toLowerCase()
  if (!storyId) throw new FileStoreError("Story id is required.", 400, "story.id-required")
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(storyId)) {
    throw new FileStoreError(
      "Story id must use lowercase letters, numbers, underscores, or hyphens, and start with a letter or number.",
      400,
      "story.invalid-id"
    )
  }
  if (storyId === "." || storyId === "..") {
    throw new FileStoreError("Story id is invalid.", 400, "story.invalid-id")
  }
  return storyId
}

/**
 * 整理故事标签。
 * @param tags 可选标签数组。 @returns 去空格、删除空值和重复项且保持首次顺序的新数组。
 */
export function normalizeNewStoryTags(tags: string[] | undefined) {
  return Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)))
}

/**
 * 将创建故事请求转换成持久化 story.json5 元信息。
 * @param input API 创建请求。 @returns 经 Core Schema 解析的 StoryMetaFile。
 * @throws id/title 不合法或 Schema 不通过时抛错。
 */
export function createStoryMetaFromInput(input: CreateStoryInput): StoryMetaFile {
  const id = normalizeNewStoryId(input.id)
  const title = input.title.trim()
  if (!title) throw new FileStoreError("Story title is required.", 400, "story.title-required")
  const description = input.description?.trim() ?? ""
  const tags = normalizeNewStoryTags(input.tags)
  return storyMetaSchema.parse({
    id,
    title,
    ...(description ? { description } : {}),
    ...(tags.length ? { tags } : {})
  })
}

/**
 * 在创建目录前确认目标位于 stories 根目录内且尚不存在。
 *
 * @param dataDir 仓库数据根目录。 @param storyId 已规范化的故事 id。
 * @returns Promise<void>；目录不存在即通过。
 * @throws 路径越界返回 400，目录已存在返回 409，其他文件系统错误原样抛出。
 */
export async function assertStoryCanBeCreated(dataDir: string, storyId: string) {
  const paths = createStoryPaths(dataDir, storyId)
  const storiesRoot = path.resolve(dataDir, "stories")
  const storyDir = path.resolve(paths.storyDir)
  if (storyDir === storiesRoot || !storyDir.startsWith(`${storiesRoot}${path.sep}`)) {
    throw new FileStoreError("Story id resolves outside stories directory.", 400, "story.invalid-id")
  }
  try {
    await stat(storyDir)
    throw new FileStoreError(`Story already exists: ${storyId}`, 409, "story.already-exists")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
}
