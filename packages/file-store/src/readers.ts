/**
 * 故事文件读取适配器。
 *
 * 读取时兼容旧事件文件名，返回值始终使用当前 StoryDocument 字段名称。
 */
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import JSON5 from "json5"
import sharp from "sharp"
import {
  appSettingsSchema,
  storyBibleSchema,
  storyChainEventsSchema,
  storyDoingSchema,
  storyDocumentSchema,
  storyActionSchema,
  storyOnceEventSchema,
  storyPoolEventsSchema,
  storyEventLocationSchema,
  storyEventSchema,
  storyImportantRolesDataFileSchema,
  storyInitialBagsSchema,
  storyItemsSchema,
  storyLoopEventSchema,
  storyPhoneConversationsSchema,
  storyPhoneSchema,
  storyReferSchema,
  storyScheduleEventsSchema,
  storyShopSchema,
  storyMetaSchema,
  storyNormalRolesDataFileSchema,
  storyPlayerOverrideValsSchema,
  storyRolesSchema,
  storySceneSchema,
  storyValsSchema,
  type AppSettingsFile,
  type StoryAnyEventFile,
  type StoryActionFile,
  type StoryBibleFile,
  type StoryChainEventsFile,
  type StoryCanonicalEventCollectionType,
  type StoryEventCollectionType,
  type StoryDocument,
  type StoryDoingFile,
  type StoryEventLocationFile,
  type StoryEventFile,
  type StoryGraphEventsFile,
  type StoryInitialBagsFile,
  type StoryItemsFile,
  type StoryLoopEventFile,
  type StoryLoopEventsFile,
  type StoryMetaFile,
  type StoryNormalRolesDataFile,
  type StoryOnceEventFile,
  type StoryOnceEventsFile,
  type StoryPoolEventsFile,
  type StoryPhoneFile,
  type StoryPhoneConversationsFile,
  type StoryPlayerOverrideValsFile,
  type StoryReferFile,
  type StoryImportantRolesDataFile,
  type StoryRolesFile,
  type StoryScheduleEventsFile,
  type StorySceneBackgroundVariant,
  type StorySceneFile,
  type StoryShopFile,
  type StorySummary,
  type StoryValsFile
} from "@story-mgr/core"
import { FileStoreError, isFileStoreError } from "./errors"
import {
  sortObjectKeys,
  readJson5File,
  writeJson5File,
  listJson5FileNames,
  listStoryIds,
  getIsoMtime,
  createStoryPaths,
  createAppPaths,
  createDefaultStoryBible,
  createDefaultStoryItems,
  createDefaultInitialBags,
  createStoryDocumentUpdates,
  fileExists,
  resolveTransactionTarget,
  replaceFileFromSource,
  rollbackStoryTransaction,
  recoverStoryTransactions,
  commitStoryFileTransaction
} from "./persistence"
import {
  createStoryStatePaths,
  createDefaultStoryShop,
  createDefaultStoryPhone,
  createDefaultStoryPhoneConversations,
  createDefaultStoryRefer,
  createDefaultStoryDoing,
  createDefaultStoryScenes,
  createDefaultStoryRoleData,
  createDefaultStoryEventLocations,
  createDefaultAppSettings,
  normalizeNewStoryId,
  normalizeNewStoryTags,
  createStoryMetaFromInput,
  assertStoryCanBeCreated,
  normalizeStoryAssetPath,
  resolveStoryAssetPath,
  getAssetMimeType,
  sanitizeFileNameSegment,
  sanitizeAssetStem,
  resolveUploadExtension,
  resolveExtensionFromMimeType,
  ensureReadableImage,
  createStoryAssetMetadata,
  listFilesRecursively,
  delay,
  removeFileWithRetry,
  collectReferencedSceneAssetPaths,
  normalizeTextAssetPath,
  collectReferencedLocationAssetPaths,
  collectReferencedItemAssetPaths,
  collectReferencedRoleAssetPaths,
  normalizeTextAssetPathForPrefix,
  pruneUnusedSceneBackgroundAssets,
  pruneUnusedLocationAssets,
  pruneUnusedItemAssets,
  pruneUnusedRoleAssets
} from "./assets"

/**
 * 读取一个允许缺失的 JSON5 文件。
 *
 * @param filePath 要读取的绝对文件路径。
 * @param fallback 文件不存在时返回的默认值。
 * @returns 文件存在时返回解析后的内容；文件不存在时返回 `fallback`。
 * @throws 文件存在但无法读取或 JSON5 语法错误时继续抛错，避免把损坏文件误当成空配置。
 */
export async function readOptionalJson5File<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJson5File<T>(filePath)
  } catch (error) {
    if (isFileStoreError(error) && error.code === "file-store.not-found") {
      return fallback
    }

    throw error
  }
}

/**
 * 按顺序尝试多个兼容文件路径，并读取第一个存在的 JSON5 文件。
 *
 * @param filePaths 候选路径，当前文件名必须排在旧版文件名之前。
 * @param fallback 所有候选文件都不存在时使用的默认值。
 * @returns 第一个存在文件的解析结果，或 `fallback`。
 * @throws 某个候选文件存在但内容损坏时立即抛错，不再尝试后面的旧文件。
 *
 * 只忽略“文件不存在”，是为了防止当前文件损坏时悄悄退回旧副本，造成用户看到过期数据。
 */
export async function readOptionalJson5FileFromPaths<T>(filePaths: string[], fallback: T): Promise<T> {
  for (const filePath of filePaths) {
    try {
      return await readJson5File<T>(filePath)
    } catch (error) {
      if (isFileStoreError(error) && error.code === "file-store.not-found") {
        continue
      }

      throw error
    }
  }

  return fallback
}

/**
 * 读取故事最基本的元信息。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 经 `storyMetaSchema` 校验的标题、描述和标签等信息。
 * @throws 文件不存在、JSON5 损坏或字段不合法时抛错；元信息是必需文件，不使用默认值。
 */
export async function readStoryMeta(dataDir: string, storyId: string): Promise<StoryMetaFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const meta = await readJson5File<StoryMetaFile>(paths.metaFile)
  return storyMetaSchema.parse(meta)
}

/**
 * 读取整个应用共用的设置。
 * @param dataDir 数据根目录。 @returns 校验后的应用设置；文件尚未创建时返回默认设置。
 */
export async function readAppSettingsFile(dataDir: string): Promise<AppSettingsFile> {
  const paths = createAppPaths(dataDir)
  const settings = await readOptionalJson5File<AppSettingsFile>(
    paths.settingsFile,
    createDefaultAppSettings()
  )
  return appSettingsSchema.parse(settings)
}

/**
 * 读取供编辑器和 AI 创作使用的故事圣经。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的世界观、主题和写作约束；缺文件时返回空白默认结构。
 */
export async function readStoryBibleFile(dataDir: string, storyId: string): Promise<StoryBibleFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const storyBible = await readOptionalJson5File<StoryBibleFile>(
    paths.storyBibleFile,
    createDefaultStoryBible()
  )
  return storyBibleSchema.parse(storyBible)
}

/**
 * 读取作者定义的普通变量。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的变量分组；缺文件时返回没有变量的结构。
 */
export async function readStoryVals(dataDir: string, storyId: string): Promise<StoryValsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const vals = await readOptionalJson5File<StoryValsFile>(paths.valsFile, {
    variables: []
  })
  return storyValsSchema.parse(vals)
}

/**
 * 读取允许玩家在开局覆盖的变量配置。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的可覆盖变量条目；缺文件时返回空条目列表。
 */
export async function readStoryPlayerOverrideVals(
  dataDir: string,
  storyId: string
): Promise<StoryPlayerOverrideValsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const playerOverrideVals = await readOptionalJson5File<StoryPlayerOverrideValsFile>(
    paths.playerOverrideValsFile,
    {
      entries: []
    }
  )
  return storyPlayerOverrideValsSchema.parse(playerOverrideVals)
}

/**
 * 读取系统变量定义。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的系统变量分组；缺文件时返回空变量列表。
 */
export async function readStorySystemVals(dataDir: string, storyId: string): Promise<StoryValsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const systemVals = await readOptionalJson5File<StoryValsFile>(paths.systemValsFile, {
    variables: []
  })
  return storyValsSchema.parse(systemVals)
}

/**
 * 读取场景等级及背景图配置。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的场景文件；缺文件时保留默认压缩质量并返回空场景列表。
 */
export async function readStoryScenes(dataDir: string, storyId: string): Promise<StorySceneFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const scenes = await readOptionalJson5File<StorySceneFile>(paths.sceneFile, {
    ai: {
      compress_quality: 60
    },
    scenes: []
  })
  return storySceneSchema.parse(scenes)
}

/**
 * 合并读取普通角色和重要角色两个数据文件。
 *
 * @param dataDir 数据根目录。
 * @param storyId 故事 id。
 * @returns `{ normal, important }` 形式的统一角色配置。
 *
 * 两个文件彼此独立，所以并行读取；先分别用各自 Schema 校验，再用聚合 Schema 检查最终结构。
 * 任一文件缺失时只为该类别提供空角色默认值，不影响另一个类别。
 */
export async function readStoryRoles(dataDir: string, storyId: string): Promise<StoryRolesFile> {
  const paths = createStoryPaths(dataDir, storyId)

  const [normalRolesFile, importantRolesFile] = await Promise.all([
    readOptionalJson5File<StoryNormalRolesDataFile>(paths.normalRolesFile, {
      ai: {
        width: 1536,
        height: 1024,
        global_prompt: "",
        compress_quality_1: 60,
        compress_quality_2: 80
      },
      roles: []
    }),
    readOptionalJson5File<StoryImportantRolesDataFile>(paths.importantRolesFile, {
      ai: {
        width: 1536,
        height: 1024,
        global_prompt: "",
        compress_quality_1: 60,
        compress_quality_2: 80
      },
      roles: []
    })
  ])

  const parsedNormalRoles = storyNormalRolesDataFileSchema.parse(normalRolesFile)
  const parsedImportantRoles = storyImportantRolesDataFileSchema.parse(importantRolesFile)

  return storyRolesSchema.parse({
    normal: parsedNormalRoles,
    important: parsedImportantRoles
  })
}

/**
 * 读取事件可引用的地点与图片槽位。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的地点分配；缺文件时返回带默认 AI 图片参数的空列表。
 */
export async function readStoryEventLocations(
  dataDir: string,
  storyId: string
): Promise<StoryEventLocationFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const eventLocations = await readOptionalJson5File<StoryEventLocationFile>(
    paths.eventLocationFile,
    {
      ai: {
        width: 1536,
        height: 1024,
        global_prompt: "",
        compress_quality_1: 60,
        compress_quality_2: 80
      },
      assignments: []
    }
  )
  return storyEventLocationSchema.parse(eventLocations)
}

/**
 * 读取物品定义和物品图片设置。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的物品文件；缺失时使用新故事的默认结构。
 */
export async function readStoryItems(
  dataDir: string,
  storyId: string
): Promise<StoryItemsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const items = await readOptionalJson5File<StoryItemsFile>(
    paths.itemsFile,
    createDefaultStoryItems()
  )
  return storyItemsSchema.parse(items)
}

/**
 * 读取商店商品与定价配置。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的商店文件；缺失时返回默认空商店。
 */
export async function readStoryShop(
  dataDir: string,
  storyId: string
): Promise<StoryShopFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const shop = await readOptionalJson5File<StoryShopFile>(
    paths.shopFile,
    createDefaultStoryShop()
  )
  return storyShopSchema.parse(shop)
}

/**
 * 读取玩家开局背包内容。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的初始背包；缺失时返回默认空背包。
 */
export async function readStoryInitialBags(
  dataDir: string,
  storyId: string
): Promise<StoryInitialBagsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const initialBags = await readOptionalJson5File<StoryInitialBagsFile>(
    paths.initialBagsFile,
    createDefaultInitialBags()
  )
  return storyInitialBagsSchema.parse(initialBags)
}

/**
 * 读取手机联系人、应用和媒体库配置。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的手机配置；缺失时返回默认空手机。
 */
export async function readStoryPhone(
  dataDir: string,
  storyId: string
): Promise<StoryPhoneFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const phone = await readOptionalJson5File<StoryPhoneFile>(
    paths.phoneFile,
    createDefaultStoryPhone()
  )
  return storyPhoneSchema.parse(phone)
}

/**
 * 读取手机私聊、群聊及历史消息。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的会话文件；缺失时返回默认空会话集合。
 */
export async function readStoryPhoneConversations(
  dataDir: string,
  storyId: string
): Promise<StoryPhoneConversationsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const phoneConversations = await readOptionalJson5File<StoryPhoneConversationsFile>(
    paths.phoneConversationsFile,
    createDefaultStoryPhoneConversations()
  )
  return storyPhoneConversationsSchema.parse(phoneConversations)
}

/**
 * 读取作品参考资料和来源链接。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的参考资料；缺失时返回默认空结构。
 */
export async function readStoryRefer(
  dataDir: string,
  storyId: string
): Promise<StoryReferFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const refer = await readOptionalJson5File<StoryReferFile>(
    paths.referFile,
    createDefaultStoryRefer()
  )
  return storyReferSchema.parse(refer)
}

/**
 * 读取玩家可执行的行动及其规则。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 校验后的行动配置；缺失时返回默认空行动列表。
 */
export async function readStoryDoing(
  dataDir: string,
  storyId: string
): Promise<StoryDoingFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const doing = await readOptionalJson5File<StoryDoingFile>(
    paths.doingFile,
    createDefaultStoryDoing()
  )
  return storyDoingSchema.parse(doing)
}

/**
 * 读取 chain 事件，并把旧版图事件规范化成当前节点结构。
 *
 * @param dataDir 数据根目录。
 * @param storyId 故事 id。
 * @returns 校验后的 chain 节点数组，包含剧情事件和动作节点。
 * @throws 当前或旧版文件存在但格式错误时抛出解析错误。
 *
 * 优先读取 `chains.json5`，不存在时兼容旧 `graph_events.json5`。旧文件可能用 `{ events: [] }`
 * 包裹数组，因此先展开；随后根据是否含 `exec_script` 补上 `node_type`，最后统一走当前 Schema。
 */
export async function readStoryGraphEvents(
  dataDir: string,
  storyId: string
): Promise<StoryGraphEventsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const graphEvents = await readOptionalJson5FileFromPaths<StoryChainEventsFile | { events: StoryAnyEventFile[] }>(
    [paths.chainEventsFile, paths.graphEventsFile],
    []
  )
  const normalizedGraphEvents = Array.isArray(graphEvents) ? graphEvents : graphEvents.events
  return storyChainEventsSchema.parse(
    normalizedGraphEvents.map((event) => {
      if ("exec_script" in event) {
        return {
          node_type: "action" as const,
          ...event
        }
      }

      return {
        node_type: "event" as const,
        ...event
      }
    })
  )
}

/**
 * 读取只触发一次的 pool 事件，并兼容旧 once 文件。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 当前标准的 pool 事件数组；新旧文件都不存在时返回空数组。
 *
 * 当前数组格式和旧 `{ events: [...] }` 包装格式会先被展开，再由 pool Schema 统一校验。
 */
export async function readStoryOnceEvents(
  dataDir: string,
  storyId: string
): Promise<StoryOnceEventsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const onceEvents = await readOptionalJson5FileFromPaths<
    StoryPoolEventsFile | { events: StoryOnceEventFile[] }
  >(
    [paths.poolEventsFile, paths.onceEventsFile],
    []
  )
  const normalizedOnceEvents = Array.isArray(onceEvents)
    ? onceEvents
    : onceEvents.events
  return storyPoolEventsSchema.parse(normalizedOnceEvents)
}

/**
 * 读取按时间调度的 schedule 事件，并兼容旧 loop 文件。
 * @param dataDir 数据根目录。 @param storyId 故事 id。
 * @returns 当前标准的 schedule 事件数组；没有配置时返回空数组。
 *
 * 这里仅完成文件名和数组外壳兼容；依赖排序与环检测属于编译器/运行时职责。
 */
export async function readStoryLoopEvents(
  dataDir: string,
  storyId: string
): Promise<StoryLoopEventsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const loopEvents = await readOptionalJson5FileFromPaths<StoryScheduleEventsFile | { events: StoryLoopEventFile[] }>(
    [paths.scheduleEventsFile, paths.loopEventsFile],
    []
  )
  const normalizedLoopEvents = Array.isArray(loopEvents) ? loopEvents : loopEvents.events
  return storyScheduleEventsSchema.parse(normalizedLoopEvents)
}

/**
 * 通过读取必需的元信息文件确认故事存在且 id 路径合法。
 * @param dataDir 数据根目录。 @param storyId 待确认的故事 id。
 * @returns 确认成功后完成的 Promise，不返回业务数据。
 * @throws 故事不存在、路径非法或元信息损坏时抛错。
 */
export async function ensureStoryExists(dataDir: string, storyId: string): Promise<void> {
  await readStoryMeta(dataDir, storyId)
}

/**
 * 把旧事件集合名称转换成内部唯一名称。
 * @param collectionType 当前名称或旧版 `once`、`loop` 名称；省略时视为 chain。
 * @returns `chain`、`pool`、`schedule` 之一。
 */
export function normalizeEventCollectionType(
  collectionType: StoryEventCollectionType | undefined
): StoryCanonicalEventCollectionType {
  if (collectionType === "once" || collectionType === "pool") {
    return "pool"
  }

  if (collectionType === "loop" || collectionType === "schedule") {
    return "schedule"
  }

  return "chain"
}
