/**
 * HTML 客户端路径工具：定位工作区，并为故事、档案和存档生成安全路径。
 * 输入中的用户片段会先清洗，避免被当作目录层级使用。
 */
import { existsSync } from "node:fs"
import path from "node:path"
import type { RuntimePlayerProfileSetup } from "@story-mgr/runtime"
import type { CreateHtmlProfileInput, HtmlClientPaths } from "./client-contracts"

/**
 * 从指定目录逐级向上寻找 pnpm 工作区根目录。
 * @param startDirectory 搜索起点。 @returns 找到的根目录；一直到磁盘根仍未找到时返回解析后的起点。
 */
export function findWorkspaceRoot(startDirectory: string) {
  let currentDirectory = path.resolve(startDirectory)

  while (true) {
    if (existsSync(path.join(currentDirectory, "pnpm-workspace.yaml"))) {
      return currentDirectory
    }

    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return path.resolve(startDirectory)
    }

    currentDirectory = parentDirectory
  }
}

/**
 * 统一解析 HTML 客户端的本地运行目录结构。
 * @param storyId 故事 id。 @param dataDir 可选故事数据目录。 @param runtimeDir 可选客户端私有运行目录。
 * @returns data、bundle、profiles 等绝对路径，不创建目录。
 */
export function resolveHtmlPaths(storyId: string, dataDir?: string, runtimeDir?: string): HtmlClientPaths {
  const workspaceRoot = findWorkspaceRoot(process.cwd())
  const resolvedDataDir = path.resolve(dataDir ?? path.join(workspaceRoot, "data"))
  const resolvedRuntimeDir = path.resolve(runtimeDir ?? path.join(workspaceRoot, ".html-client"))
  const storyDir = path.join(resolvedRuntimeDir, "stories", storyId)

  return {
    dataDir: resolvedDataDir,
    runtimeDir: resolvedRuntimeDir,
    storyDir,
    bundleFile: path.join(storyDir, "bundle.json"),
    profilesDir: path.join(storyDir, "profiles")
  }
}

/** @param paths 故事级路径。 @param profileId 已清洗档案 id。 @returns 档案目录、custom 文件和 saves 目录路径。 */
export function resolveProfilePaths(paths: HtmlClientPaths, profileId: string) {
  const profileDir = path.join(paths.profilesDir, profileId)

  return {
    profileDir,
    customFile: path.join(profileDir, "custom.json5"),
    savesDir: path.join(profileDir, "saves")
  }
}

/** @param paths 故事级路径。 @param profileId 档案 id。 @param slotId 已清洗槽 id。 @returns 对应 JSON5 存档绝对路径。 */
export function resolveSaveFile(paths: HtmlClientPaths, profileId: string, slotId: string) {
  return path.join(resolveProfilePaths(paths, profileId).savesDir, `${slotId}.json5`)
}

/** @param fixedNow 测试或可复现场景使用的固定时间。 @returns 每次都返回新 Date 的时间工厂，避免共享可变 Date。 */
export function createNowFactory(fixedNow?: Date) {
  return () => (fixedNow ? new Date(fixedNow) : new Date())
}

/**
 * 将用户文本清洗成可安全映射为本地目录/文件名的片段。
 * @param value 原始文本。 @returns 小写且只含字母、数字、点、下划线和短横线的片段。
 */
export function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * 为新档案确定本地 id。
 * @param input 建档输入。 @returns 优先使用显式 id，其次姓名 slug，最后使用带时间戳的兜底 id。
 */
export function createProfileId(input: CreateHtmlProfileInput) {
  const preferredId = sanitizeSegment(input.profileId ?? "")
  if (preferredId) {
    return preferredId
  }

  const sourceName = input.profileName.trim() || buildPlayerDisplayName(input.playerSetup ?? {
    player_surname: "",
    player_given_name: "",
    player_name: ""
  }) || ""
  const nameSlug = sanitizeSegment(sourceName)
  return nameSlug || `profile-${Date.now().toString(36)}`
}

/**
 * 组合玩家姓与名；旧档案只有完整姓名时仍可正常显示。
 * @param playerSetup 姓、名和兼容完整姓名字段。 @returns 优先“姓+名”，否则返回完整姓名，均为空时返回空串。
 */
export function buildPlayerDisplayName(
  playerSetup: Pick<RuntimePlayerProfileSetup, "player_surname" | "player_given_name" | "player_name">
) {
  const playerSurname = typeof playerSetup.player_surname === "string"
    ? playerSetup.player_surname.trim()
    : ""
  const playerGivenName = typeof playerSetup.player_given_name === "string"
    ? playerSetup.player_given_name.trim()
    : ""
  const playerName = typeof playerSetup.player_name === "string"
    ? playerSetup.player_name.trim()
    : ""

  return `${playerSurname}${playerGivenName}` || playerName
}
