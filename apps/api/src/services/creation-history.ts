/**
 * 编辑器 AI 创作历史的本地文件服务。
 *
 * 路由把 dataDir、storyId 和用户确认过的 session 传进来，本模块负责路径安全、读取、排序和
 * 原子替换 `creation_history.json5`。它不运行 AI，也不决定哪些草稿内容要应用到正式故事。
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { FileStoreError } from "@story-mgr/file-store"
import type {
  StoryCreationHistoryFile,
  StoryCreationHistorySession
} from "@story-mgr/shared"

/**
 * 安全地计算某个故事的磁盘目录。
 *
 * @param dataDir 数据根目录，例如仓库中的 `data`。
 * @param storyId URL 中的故事 id，理论上可能包含恶意的 `../`。
 * @returns 规范化后的绝对故事目录。
 * @throws `FileStoreError(400)` 当解析结果逃出 `dataDir/stories` 时抛出。
 *
 * 算法先分别解析根目录和目标目录，再检查目标是否等于根目录或以“根目录 + 路径分隔符”开头。
 * 不能只用字符串 `includes`，否则 `stories-evil` 之类的相似目录可能绕过检查。
 */
function resolveStoryDirectory(dataDir: string, storyId: string): string {
  const storiesRoot = path.resolve(dataDir, "stories")
  const storyDir = path.resolve(storiesRoot, storyId)

  if (storyDir !== storiesRoot && !storyDir.startsWith(`${storiesRoot}${path.sep}`)) {
    throw new FileStoreError("Invalid story id.", 400, "creation-history.invalid-story-id")
  }

  return storyDir
}

/**
 * 得到创作历史文件的完整路径。
 *
 * @param dataDir 数据根目录。
 * @param storyId 故事 id。
 * @returns `<dataDir>/stories/<storyId>/creation_history.json5` 的安全绝对路径。
 * @throws storyId 造成路径越界时沿用 `resolveStoryDirectory` 的 400 错误。
 */
function resolveHistoryFile(dataDir: string, storyId: string): string {
  return path.join(resolveStoryDirectory(dataDir, storyId), "creation_history.json5")
}

/**
 * 把旧文件、空文件或缺字段对象整理成当前历史结构。
 *
 * @param value JSON 解析后的不完整历史对象，也可能为空。
 * @returns 始终含有 `sessions` 数组的 `StoryCreationHistoryFile`。
 *
 * 这里仅补容器默认值，不验证 session 业务内容；HTTP 写入时已经由请求 Schema 完成严格校验。
 */
function normalizeHistory(
  value: Partial<StoryCreationHistoryFile> | null | undefined
): StoryCreationHistoryFile {
  return {
    sessions: Array.isArray(value?.sessions) ? value.sessions : []
  }
}

/**
 * 先写临时文件，再替换正式 JSON5 文件。
 *
 * @param filePath 最终文件路径。
 * @param value 要序列化的数据。
 * @returns Promise；替换完成后 resolve，不返回业务数据。
 * @throws 建目录、写文件或重命名失败时透传文件系统错误。
 *
 * 直接覆盖正式文件时，进程若在写到一半崩溃，可能留下半截 JSON。这里先完整写入同目录临时文件，
 * 再用 rename 快速替换；Windows 不允许 rename 覆盖已有文件时，删除旧文件后再重试一次。
 */
async function writeJson5File(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath)
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${Date.now().toString(36)}.tmp`
  )

  await mkdir(directory, { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")

  try {
    await rename(tempPath, filePath)
  } catch {
    await rm(filePath, { force: true })
    await rename(tempPath, filePath)
  }
}

/**
 * 读取一个故事的全部 AI 创作历史。
 *
 * @param dataDir 数据根目录。
 * @param storyId 要读取的故事 id。
 * @returns 历史文件存在时返回解析内容；首次使用、文件不存在时返回 `{ sessions: [] }`。
 * @throws 路径越界、无读取权限或 JSON 损坏时抛错。只有 ENOENT 会被当成正常的空历史。
 */
export async function readStoryCreationHistory(
  dataDir: string,
  storyId: string
): Promise<StoryCreationHistoryFile> {
  const filePath = resolveHistoryFile(dataDir, storyId)

  try {
    const raw = await readFile(filePath, "utf8")
    return normalizeHistory(JSON.parse(raw) as Partial<StoryCreationHistoryFile>)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        sessions: []
      }
    }

    throw error
  }
}

/**
 * 新增一条创作会话，或按相同 session id 替换旧会话。
 *
 * @param dataDir 数据根目录。
 * @param storyId 会话所属故事。
 * @param session 前端已通过 Zod 校验的完整会话。
 * @returns `{ history, session }`：写盘后的完整历史和本次保存的会话。
 * @throws session id 为空时抛 400；路径或文件写入失败时透传相应错误。
 *
 * 关键步骤：先过滤掉相同 id，再放入新会话，最后按 `updatedAt` 倒序排列。这样更新已有会话不会
 * 产生重复项，最近编辑的会话也会稳定出现在界面最前面。
 */
export async function upsertStoryCreationHistorySession(
  dataDir: string,
  storyId: string,
  session: StoryCreationHistorySession
): Promise<{ history: StoryCreationHistoryFile; session: StoryCreationHistorySession }> {
  if (!session.id.trim()) {
    throw new FileStoreError("Creation history session id is required.", 400, "creation-history.session-id-required")
  }

  const filePath = resolveHistoryFile(dataDir, storyId)
  const history = await readStoryCreationHistory(dataDir, storyId)
  const sessions = history.sessions.filter((item) => item.id !== session.id)
  const nextHistory: StoryCreationHistoryFile = {
    sessions: [session, ...sessions].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  }

  await writeJson5File(filePath, nextHistory)

  return {
    history: nextHistory,
    session
  }
}

/**
 * 从故事历史中删除指定会话。
 *
 * @param dataDir 数据根目录。
 * @param storyId 会话所属故事。
 * @param sessionId URL 中待删除的会话 id；函数会先去掉首尾空格。
 * @returns `{ deletedId, history }`：实际删除的 id 和写盘后的剩余历史。
 * @throws id 为空时抛 400；历史中找不到该 id 时抛 404；写盘失败时透传文件系统错误。
 */
export async function deleteStoryCreationHistorySession(
  dataDir: string,
  storyId: string,
  sessionId: string
): Promise<{ deletedId: string; history: StoryCreationHistoryFile }> {
  const normalizedSessionId = sessionId.trim()

  if (!normalizedSessionId) {
    throw new FileStoreError("Creation history session id is required.", 400, "creation-history.session-id-required")
  }

  const filePath = resolveHistoryFile(dataDir, storyId)
  const history = await readStoryCreationHistory(dataDir, storyId)
  const nextSessions = history.sessions.filter((item) => item.id !== normalizedSessionId)

  if (nextSessions.length === history.sessions.length) {
    throw new FileStoreError("Creation history session was not found.", 404, "creation-history.session-not-found")
  }

  const nextHistory: StoryCreationHistoryFile = {
    sessions: nextSessions
  }

  await writeJson5File(filePath, nextHistory)

  return {
    deletedId: normalizedSessionId,
    history: nextHistory
  }
}
