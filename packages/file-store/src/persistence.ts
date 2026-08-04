/**
 * File Store 的底层 JSON5 I/O、路径表和多文件事务实现。
 *
 * 一个 `StoryDocument` 实际分散在十多个 JSON5 文件中，普通的逐文件写入可能在中途失败，留下
 * “角色已更新、事件未更新”的半成品。本模块先为每个目标准备 staged 新文件和 backup 旧文件，
 * 再记录 manifest，最后才逐个替换目标；进程异常退出后，下次访问故事会读取 manifest 并回滚。
 *
 * 输入来源：Store/Reader 传入的数据目录、storyId 和已通过业务校验的内存对象。
 * 输出去向：`data/stories/` 正文文件与 `.story-manager/transactions/` 临时事务状态。
 * 不负责：HTTP 错误格式、业务引用校验、revision 冲突和按故事排队。
 */
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import JSON5 from "json5"
import type {
  StoryBibleFile,
  StoryDocument,
  StoryInitialBagsFile,
  StoryItemsFile
} from "@story-mgr/core"
import { FileStoreError, isFileStoreError } from "./errors"

/**
 * 递归按对象 key 排序，让相同数据稳定写出相同文本。
 *
 * 数组顺序通常具有业务含义，因此只递归处理数组元素，绝不排序数组本身。稳定输出可以减少 git
 * diff 噪声，也让事务 staged 文件和正式文件更容易人工比较。
 */
export function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortObjectKeys(nested)])
    )
  }

  return value
}

/**
 * 读取并解析一个 JSON5 文件。
 *
 * 泛型只帮助调用方描述期望类型，不会执行运行时校验；需要 Schema 校验的故事文件由 readers 层
 * 在读取后完成。ENOENT 被转换成统一的 404 FileStoreError，其余解析和 I/O 错误原样上抛。
 */
export async function readJson5File<T>(filePath: string): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8")
    return JSON5.parse(raw) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FileStoreError(`File not found: ${filePath}`, 404, "file-store.not-found")
    }

    throw error
  }
}

/**
 * 以“临时文件 → rename 替换”的方式写一个 JSON5 文件。
 *
 * 直接覆盖目标文件可能在进程中断时留下半截文本。这里先完整写入同目录临时文件，再原子重命名；
 * 某些 Windows 文件系统不允许 rename 覆盖目标，因此失败时删除旧目标后重试。多文件一致性仍由
 * `commitStoryFileTransaction` 的备份和 manifest 保证。
 */
export async function writeJson5File(filePath: string, value: unknown) {
  const orderedValue = sortObjectKeys(value)
  const content = `${JSON5.stringify(orderedValue, null, 2)}\n`
  const directory = path.dirname(filePath)
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${Date.now().toString(36)}.tmp`
  )

  await mkdir(directory, { recursive: true })
  await writeFile(tempPath, content, "utf8")

  try {
    await rename(tempPath, filePath)
  } catch {
    await rm(filePath, { force: true })
    await rename(tempPath, filePath)
  }
}

/** 列出目录中的 JSON5 文件名；目录尚不存在时按空列表处理。 */
export async function listJson5FileNames(directory: string) {
  try {
    const items = await readdir(directory, { withFileTypes: true })

    return items
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json5"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }
}

/** 列出 stories 根目录下的故事目录，并稳定按名称排序。 */
export async function listStoryIds(storiesRoot: string) {
  try {
    const items = await readdir(storiesRoot, { withFileTypes: true })

    return items
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }
}

/** 获取文件最后修改时间的 ISO 文本；文件不存在或不可读时返回 undefined。 */
export async function getIsoMtime(filePath: string) {
  try {
    const fileStat = await stat(filePath)
    return fileStat.mtime.toISOString()
  } catch {
    return undefined
  }
}

/**
 * 验证 storyId 并集中生成一个故事的全部正文/资产路径。
 *
 * storyId 只允许小写字母、数字、下划线和连字符，从入口上阻断 `../` 路径穿越。所有模块都应使用
 * 此路径表，不能在各自代码里手拼故事路径；旧事件文件只作为读取兼容路径保留。
 */
export function createStoryPaths(dataDir: string, storyId: string) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(storyId)) {
    throw new FileStoreError("Story id is invalid.", 400, "story.invalid-id")
  }

  const storyDir = path.join(dataDir, "stories", storyId)

  return {
    storyDir,
    metaFile: path.join(storyDir, "story.json5"),
    storyBibleFile: path.join(storyDir, "story_bible.json5"),
    valsFile: path.join(storyDir, "vals.json5"),
    playerOverrideValsFile: path.join(storyDir, "player_override_vals.json5"),
    systemValsFile: path.join(storyDir, "system_vals.json5"),
    sceneFile: path.join(storyDir, "scene.json5"),
    rolesLegacyFile: path.join(storyDir, "roles.json5"),
    normalRolesFile: path.join(storyDir, "nomal_roles.json5"),
    importantRolesFile: path.join(storyDir, "import_roles.json5"),
    eventLocationFile: path.join(storyDir, "event_location.json5"),
    itemsFile: path.join(storyDir, "items.json5"),
    shopFile: path.join(storyDir, "shop.json5"),
    initialBagsFile: path.join(storyDir, "initial_bags.json5"),
    phoneFile: path.join(storyDir, "phone.json5"),
    phoneConversationsFile: path.join(storyDir, "phone_conversations.json5"),
    referFile: path.join(storyDir, "refer.json5"),
    doingFile: path.join(storyDir, "doing.json5"),
    assetsDir: path.join(storyDir, "assets"),
    backgroundDir: path.join(storyDir, "assets", "background"),
    backgroundRawDir: path.join(storyDir, "assets", "background", "raw"),
    roleAssetsDir: path.join(storyDir, "assets", "roles"),
    roleRawDir: path.join(storyDir, "assets", "roles", "raw"),
    eventLocationAssetsDir: path.join(storyDir, "assets", "event_location"),
    eventLocationRawDir: path.join(storyDir, "assets", "event_location", "raw"),
    itemAssetsDir: path.join(storyDir, "assets", "items"),
    itemRawDir: path.join(storyDir, "assets", "items", "raw"),
    eventsDir: path.join(storyDir, "events"),
    chainEventsFile: path.join(storyDir, "events", "chains.json5"),
    poolEventsFile: path.join(storyDir, "events", "pool_events.json5"),
    scheduleEventsFile: path.join(storyDir, "events", "schedule_events.json5"),
    graphEventsFile: path.join(storyDir, "events", "events.json5"),
    onceEventsFile: path.join(storyDir, "events", "once_events.json5"),
    loopEventsFile: path.join(storyDir, "events", "loop_events.json5")
  }
}

/** 返回不属于某个具体故事的应用级配置路径。 */
export function createAppPaths(dataDir: string) {
  return {
    settingsFile: path.join(dataDir, "setting.json5")
  }
}

/**
 * 返回修订号和事务日志的内部路径。
 *
 * 这些状态放在被忽略的 `.story-manager/`，与可发布故事正文分开。客户端和 Compiler 不应把
 * revision 或临时事务文件打进游戏 bundle。
 */
export function createStoryStatePaths(dataDir: string, storyId: string) {
  const stateRoot = path.join(dataDir, ".story-manager")

  return {
    revisionFile: path.join(stateRoot, "revisions", `${storyId}.json5`),
    transactionsDir: path.join(stateRoot, "transactions", storyId)
  }
}

/** 创建缺少 `story_bible.json5` 时使用的完整空结构。 */
export function createDefaultStoryBible(): StoryBibleFile {
  return {
    background: "",
    golden_finger: "",
    protagonist: "",
    world_rules: "",
    outline: "",
    current_arc: "",
    gameplay_design: "",
    style_guide: "",
    constraints: ""
  }
}

/** 创建缺少 `items.json5` 时使用的空物品库，并提供编辑器需要的默认图片参数。 */
export function createDefaultStoryItems(): StoryItemsFile {
  return {
    ai: {
      width: 1024,
      height: 1024,
      global_prompt: "",
      compress_quality_1: 60,
      compress_quality_2: 80
    },
    categories: [],
    items: []
  }
}

/** 创建缺少 `initial_bags.json5` 时使用的空玩家背包模板。 */
export function createDefaultInitialBags(): StoryInitialBagsFile {
  return {
    player: {
      entries: []
    }
  }
}

/** manifest 中一个目标文件对应的 staged、backup 与原始存在状态。 */
export interface StoryTransactionEntry {
  targetRelativePath: string
  stagedFileName: string
  backupFileName: string
  existed: boolean
}

/**
 * 可落盘的事务清单。
 * `prepared` 表示新文件和备份已齐；`committing` 表示目标可能只替换了一部分；`committed` 表示全部
 * 替换完成。恢复时前两种状态必须回滚，committed 只需清理残留目录。
 */
export interface StoryTransactionManifest {
  id: string
  storyId: string
  status: "prepared" | "committing" | "committed"
  entries: StoryTransactionEntry[]
}

/** 一个待写目标的绝对路径和内存值。 */
export interface StoryFileUpdate {
  filePath: string
  value: unknown
}

/**
 * 把聚合 `StoryDocument` 展开为所有规范文件的更新列表。
 *
 * 列表是事务的单一文件映射来源，保证新写出格式只使用 chain/pool/schedule 等当前规范文件名；
 * legacy 文件不会重新写回磁盘。
 */
export function createStoryDocumentUpdates(
  paths: ReturnType<typeof createStoryPaths>,
  document: StoryDocument
): StoryFileUpdate[] {
  return [
    { filePath: paths.metaFile, value: document.story },
    { filePath: paths.storyBibleFile, value: document.storyBible },
    { filePath: paths.valsFile, value: document.vals },
    { filePath: paths.playerOverrideValsFile, value: document.playerOverrideVals },
    { filePath: paths.systemValsFile, value: document.systemVals },
    { filePath: paths.sceneFile, value: document.scenes },
    { filePath: paths.normalRolesFile, value: document.roles.normal },
    { filePath: paths.importantRolesFile, value: document.roles.important },
    { filePath: paths.eventLocationFile, value: document.eventLocations },
    { filePath: paths.itemsFile, value: document.items },
    { filePath: paths.shopFile, value: document.shop },
    { filePath: paths.initialBagsFile, value: document.initialBags },
    { filePath: paths.phoneFile, value: document.phone },
    { filePath: paths.phoneConversationsFile, value: document.phoneConversations },
    { filePath: paths.referFile, value: document.refer },
    { filePath: paths.doingFile, value: document.doing },
    { filePath: paths.chainEventsFile, value: document.chainEvents },
    { filePath: paths.poolEventsFile, value: document.poolEvents },
    { filePath: paths.scheduleEventsFile, value: document.scheduleEvents }
  ]
}

/** 判断路径是否存在；只有 ENOENT 被视为 false，权限等真实错误继续抛出。 */
export async function fileExists(filePath: string) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }

    throw error
  }
}

/**
 * 将 manifest 中的相对路径解析为 dataDir 内的绝对路径。
 *
 * 即使 manifest 本身被损坏或篡改，也不能允许事务恢复删除/覆盖数据目录之外的文件。解析结果等于
 * 根目录或越出根目录时立即拒绝。
 */
export function resolveTransactionTarget(dataDir: string, relativePath: string) {
  const dataRoot = path.resolve(dataDir)
  const resolvedPath = path.resolve(dataRoot, relativePath)

  if (resolvedPath === dataRoot || !resolvedPath.startsWith(`${dataRoot}${path.sep}`)) {
    throw new FileStoreError(
      "Transaction target resolves outside the data directory.",
      500,
      "transaction.invalid-target"
    )
  }

  return resolvedPath
}

/**
 * 用源文件安全替换目标文件。
 *
 * 先复制到目标同目录临时文件，再 rename，避免跨磁盘 rename 和半文件写入；Windows 覆盖失败时
 * 使用与单文件写入相同的删除后重命名兼容路径。
 */
export async function replaceFileFromSource(sourcePath: string, targetPath: string, transactionId: string) {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${transactionId}.tmp`
  )

  await mkdir(path.dirname(targetPath), { recursive: true })
  await copyFile(sourcePath, tempPath)

  try {
    await rename(tempPath, targetPath)
  } catch {
    await rm(targetPath, { force: true })
    await rename(tempPath, targetPath)
  }
}

/**
 * 按 manifest 把所有目标恢复到事务开始前。
 *
 * 原来存在的文件从 backup 恢复，原来不存在的文件则删除。回滚按整份清单执行，不根据“目前看起来
 * 是否已替换”猜测，因而既适用于当前进程捕获到的失败，也适用于重启后的未知中断点。
 */
export async function rollbackStoryTransaction(
  dataDir: string,
  transactionDir: string,
  manifest: StoryTransactionManifest
) {
  for (const entry of manifest.entries) {
    const targetPath = resolveTransactionTarget(dataDir, entry.targetRelativePath)
    const backupPath = path.join(transactionDir, entry.backupFileName)

    if (entry.existed) {
      await replaceFileFromSource(backupPath, targetPath, `${manifest.id}.rollback`)
    } else {
      await rm(targetPath, { force: true })
    }
  }
}

/**
 * 扫描并处理某个故事遗留的事务目录。
 *
 * 没有 manifest 的目录视为准备阶段残留，可直接清理；storyId 不匹配说明内部状态异常，拒绝继续。
 * 未 committed 的事务统一回滚，已 committed 的事务只删除临时目录。调用方必须在持有故事锁时
 * 执行恢复，避免恢复与新提交交错。
 */
export async function recoverStoryTransactions(dataDir: string, storyId: string) {
  const { transactionsDir } = createStoryStatePaths(dataDir, storyId)
  let transactionNames: string[]

  try {
    transactionNames = (await readdir(transactionsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return
    }

    throw error
  }

  for (const transactionName of transactionNames) {
    const transactionDir = path.join(transactionsDir, transactionName)
    const manifestPath = path.join(transactionDir, "manifest.json5")
    let manifest: StoryTransactionManifest

    try {
      manifest = await readJson5File<StoryTransactionManifest>(manifestPath)
    } catch (error) {
      if (isFileStoreError(error) && error.code === "file-store.not-found") {
        await rm(transactionDir, { recursive: true, force: true })
        continue
      }

      throw error
    }

    if (manifest.storyId !== storyId) {
      throw new FileStoreError(
        `Transaction ${manifest.id} belongs to a different story.`,
        500,
        "transaction.story-mismatch"
      )
    }

    if (manifest.status !== "committed") {
      console.warn(`[file-store] rolling back unfinished transaction ${manifest.id}`)
      await rollbackStoryTransaction(dataDir, transactionDir, manifest)
    }

    await rm(transactionDir, { recursive: true, force: true })
  }
}

/**
 * 将多个故事文件作为一个可回滚事务提交。
 *
 * 分为五步：
 * 1. 为每个更新写 staged 新文件，并为已有目标复制 backup。
 * 2. 写 `prepared` manifest，表示回滚资料已经齐全。
 * 3. 改为 `committing`，再逐个安全替换正式目标。
 * 4. 全部成功后写 `committed`；任何替换失败都立即按 backup 整体回滚。
 * 5. 最终清理事务目录。若进程在清理前退出，下次恢复会根据 manifest 得到同样结果。
 */
export async function commitStoryFileTransaction(
  dataDir: string,
  storyId: string,
  updates: StoryFileUpdate[]
) {
  const transactionId = randomUUID()
  const { transactionsDir } = createStoryStatePaths(dataDir, storyId)
  const transactionDir = path.join(transactionsDir, transactionId)
  const stagedDir = path.join(transactionDir, "staged")
  const backupDir = path.join(transactionDir, "backups")
  const manifestPath = path.join(transactionDir, "manifest.json5")
  const entries: StoryTransactionEntry[] = []

  await mkdir(stagedDir, { recursive: true })
  await mkdir(backupDir, { recursive: true })

  for (const [index, update] of updates.entries()) {
    const targetPath = resolveTransactionTarget(dataDir, path.relative(dataDir, update.filePath))
    const stagedFileName = path.join("staged", `${index}.json5`)
    const backupFileName = path.join("backups", `${index}.json5`)
    const stagedPath = path.join(transactionDir, stagedFileName)
    const backupPath = path.join(transactionDir, backupFileName)
    const existed = await fileExists(targetPath)

    await writeJson5File(stagedPath, update.value)
    if (existed) {
      await copyFile(targetPath, backupPath)
    }

    entries.push({
      targetRelativePath: path.relative(dataDir, targetPath),
      stagedFileName,
      backupFileName,
      existed
    })
  }

  const manifest: StoryTransactionManifest = {
    id: transactionId,
    storyId,
    status: "prepared",
    entries
  }
  await writeJson5File(manifestPath, manifest)
  manifest.status = "committing"
  await writeJson5File(manifestPath, manifest)

  try {
    for (const entry of entries) {
      await replaceFileFromSource(
        path.join(transactionDir, entry.stagedFileName),
        resolveTransactionTarget(dataDir, entry.targetRelativePath),
        transactionId
      )
    }

    manifest.status = "committed"
    await writeJson5File(manifestPath, manifest)
  } catch (error) {
    await rollbackStoryTransaction(dataDir, transactionDir, manifest)
    throw error
  } finally {
    await rm(transactionDir, { recursive: true, force: true })
  }
}
