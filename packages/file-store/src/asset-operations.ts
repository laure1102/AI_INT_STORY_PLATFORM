/**
 * 图片上传、压缩和元数据读取操作。
 *
 * 工厂只捕获 dataDir；每次操作仍会校验 storyId、资产前缀和 Sharp 解码结果。
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
import { FileStoreError } from "./errors"
import type {
  CompressItemImagePayload,
  CompressLocationImagePayload,
  CompressRoleImagePayload,
  CompressSceneBackgroundPayload,
  StoryAssetMetadata
} from "./types"
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
import {
  readOptionalJson5File,
  readOptionalJson5FileFromPaths,
  readStoryMeta,
  readAppSettingsFile,
  readStoryBibleFile,
  readStoryVals,
  readStoryPlayerOverrideVals,
  readStorySystemVals,
  readStoryScenes,
  readStoryRoles,
  readStoryEventLocations,
  readStoryItems,
  readStoryShop,
  readStoryInitialBags,
  readStoryPhone,
  readStoryPhoneConversations,
  readStoryRefer,
  readStoryDoing,
  readStoryGraphEvents,
  readStoryOnceEvents,
  readStoryLoopEvents,
  ensureStoryExists,
  normalizeEventCollectionType
} from "./readers"

/**
 * 创建绑定数据目录的故事图片操作集合。
 *
 * @param dataDir 数据根目录，所有图片只能写入其中对应故事的 `assets/` 子目录。
 * @returns 上传原图、压缩图片、读取元数据和解析安全路径的方法集合。
 *
 * 工厂只保存目录配置，不打开文件。每次调用仍会先验证故事存在，并通过路径工具阻止 `../`
 * 之类的目录穿越。这样 Store 门面可以复用同一套操作，同时不暴露底层目录结构。
 */
export function createStoryAssetOperations(dataDir: string) {
  /**
   * 保存一张未经压缩的场景背景原图。
   *
   * @param storyId 目标故事 id。
   * @param fileName 上传时的原始文件名，用于保留安全的扩展名和可读文件名。
   * @param fileContent 图片二进制内容。
   * @returns 新原图的相对资产路径、MIME 类型、大小等元数据。
   * @throws 故事不存在、扩展名不支持、图片无法由 Sharp 解码或写盘失败时抛错。
   *
   * 文件名使用“时间戳 + 清理后的原名”，既减少重名覆盖，也不会信任用户提供的目录片段。
   */
  async function writeSceneBackgroundSource(
    storyId: string,
    fileName: string,
    fileContent: Buffer
  ): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
    const paths = createStoryPaths(dataDir, storyId)
    const extension = resolveUploadExtension(fileName)
    const fileStem = sanitizeFileNameSegment(path.basename(fileName, extension)) || "background"
    const uniqueName = `${Date.now().toString(36)}-${fileStem}${extension}`
    const assetPath = path.posix.join("assets", "background", "raw", uniqueName)
    const outputPath = path.join(paths.backgroundRawDir, uniqueName)
  
    await ensureReadableImage(fileContent)
    await mkdir(paths.backgroundRawDir, { recursive: true })
    await writeFile(outputPath, fileContent)
  
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }
  
  /**
   * 把场景背景原图转换为正式使用的 WebP 文件。
   *
   * @param storyId 目标故事 id。
   * @param payload 包含原图路径、场景等级、白天/夜晚变体和压缩质量。
   * @returns 正式背景图的资产元数据。
   * @throws 等级或变体非法、原图路径越界、读取/压缩/写入失败时抛错。
   *
   * 输出名固定为 `<level>_<variant>.webp`，所以再次压缩同一槽位会有意替换旧图；质量被限制在
   * 1 到 100，防止异常输入传给 Sharp。先在内存完成压缩，成功后才写目标文件。
   */
  async function compressSceneBackground(
    storyId: string,
    payload: CompressSceneBackgroundPayload
  ): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
  
    if (!Number.isInteger(payload.level) || payload.level < 1) {
      throw new FileStoreError(
        "Scene level must be an integer greater than or equal to 1.",
        400,
        "scene.invalid-level"
      )
    }
  
    if (!["day", "night"].includes(payload.variant)) {
      throw new FileStoreError("Scene background variant must be day or night.", 400, "scene.invalid-variant")
    }
  
    const paths = createStoryPaths(dataDir, storyId)
    const source = resolveStoryAssetPath(dataDir, storyId, payload.sourcePath)
    const targetName = `${payload.level}_${payload.variant}.webp`
    const assetPath = path.posix.join("assets", "background", targetName)
    const outputPath = path.join(paths.backgroundDir, targetName)
    const sourceBuffer = await readFile(source.resolvedPath)
    const quality = Math.max(1, Math.min(100, Math.round(payload.quality ?? 60)))
    const compressedBuffer = await sharp(sourceBuffer)
      .webp({
        quality,
        effort: 6
      })
      .toBuffer()
  
    await mkdir(paths.backgroundDir, { recursive: true })
    await writeFile(outputPath, compressedBuffer)
  
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }
  /**
   * 保存地点图片的原始上传文件。
   * @param storyId 目标故事 id。 @param targetName 用户填写的地点目标名。
   * @param fileContent 图片二进制内容。 @param mimeType 上传请求声明的 MIME 类型。
   * @returns 新原图的安全相对路径和文件元数据。
   * @throws 图片不可解码、MIME 类型不受支持或文件写入失败时抛错。
   *
   * 扩展名由允许列表中的 MIME 类型决定，而不是直接相信文件名；目标名也会移除路径字符。
   */
  async function writeLocationImageSource(
    storyId: string,
    targetName: string,
    fileContent: Buffer,
    mimeType?: string
  ): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
    const paths = createStoryPaths(dataDir, storyId)
    const fileStem = sanitizeAssetStem(targetName)
    const extension = resolveExtensionFromMimeType(mimeType)
    const uniqueName = `${Date.now().toString(36)}-${fileStem}${extension}`
    const assetPath = path.posix.join("assets", "event_location", "raw", uniqueName)
    const outputPath = path.join(paths.eventLocationRawDir, uniqueName)
  
    await ensureReadableImage(fileContent)
    await mkdir(paths.eventLocationRawDir, { recursive: true })
    await writeFile(outputPath, fileContent)
  
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }
  
  /**
   * 将地点原图压缩到地点的第 1 或第 2 图片槽位。
   * @param storyId 目标故事 id。 @param payload 原图路径、地点名、槽位和质量。
   * @returns `<地点名>_c1.webp` 或 `<地点名>_c2.webp` 的元数据。
   * @throws 目标名为空、原图路径非法或 Sharp 处理失败时抛错。
   *
   * 只有数值 2 会进入第二槽，其余值归一化为第一槽；质量同样限制在 1 到 100。
   */
  async function compressLocationImage(
    storyId: string,
    payload: CompressLocationImagePayload
  ): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
  
    const normalizedTargetName = sanitizeAssetStem(payload.targetName)
  
    if (!normalizedTargetName) {
      throw new FileStoreError("Location image target name is required.", 400, "location.invalid-name")
    }
  
    const paths = createStoryPaths(dataDir, storyId)
    const source = resolveStoryAssetPath(dataDir, storyId, payload.sourcePath)
    const normalizedSlot = payload.slot === 2 ? 2 : 1
    const targetName = `${normalizedTargetName}_c${normalizedSlot}.webp`
    const assetPath = path.posix.join("assets", "event_location", targetName)
    const outputPath = path.join(paths.eventLocationAssetsDir, targetName)
    const sourceBuffer = await readFile(source.resolvedPath)
    const quality = Math.max(1, Math.min(100, Math.round(payload.quality ?? 60)))
    const compressedBuffer = await sharp(sourceBuffer)
      .webp({
        quality,
        effort: 6
      })
      .toBuffer()
  
    await mkdir(paths.eventLocationAssetsDir, { recursive: true })
    await writeFile(outputPath, compressedBuffer)
  
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }
  
  /**
   * 保存物品图片的原始上传文件。
   * @param storyId 目标故事 id。 @param targetName 用于生成文件名的物品名或物品 id。
   * @param fileContent 图片二进制内容。 @param mimeType 上传图片的 MIME 类型。
   * @returns 原图的相对资产路径及大小、类型等元数据。
   * @throws 故事不存在、图片格式不支持、无法解码或写盘失败时抛错。
   */
  async function writeItemImageSource(
    storyId: string,
    targetName: string,
    fileContent: Buffer,
    mimeType?: string
  ): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
    const paths = createStoryPaths(dataDir, storyId)
    const fileStem = sanitizeAssetStem(targetName)
    const extension = resolveExtensionFromMimeType(mimeType)
    const uniqueName = `${Date.now().toString(36)}-${fileStem}${extension}`
    const assetPath = path.posix.join("assets", "items", "raw", uniqueName)
    const outputPath = path.join(paths.itemRawDir, uniqueName)
  
    await ensureReadableImage(fileContent)
    await mkdir(paths.itemRawDir, { recursive: true })
    await writeFile(outputPath, fileContent)
  
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }
  
  /**
   * 将物品原图压缩到物品的正式图片槽位。
   * @param storyId 目标故事 id。 @param payload 原图路径、物品目标名、槽位和质量。
   * @returns `<物品名>_c1.webp` 或 `<物品名>_c2.webp` 的元数据。
   * @throws 清理后目标名为空、资产路径越界、原图读取或压缩失败时抛错。
   */
  async function compressItemImage(
    storyId: string,
    payload: CompressItemImagePayload
  ): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
  
    const normalizedTargetName = sanitizeAssetStem(payload.targetName)
  
    if (!normalizedTargetName) {
      throw new FileStoreError("Item image target name is required.", 400, "item.invalid-name")
    }
  
    const paths = createStoryPaths(dataDir, storyId)
    const source = resolveStoryAssetPath(dataDir, storyId, payload.sourcePath)
    const normalizedSlot = payload.slot === 2 ? 2 : 1
    const targetName = `${normalizedTargetName}_c${normalizedSlot}.webp`
    const assetPath = path.posix.join("assets", "items", targetName)
    const outputPath = path.join(paths.itemAssetsDir, targetName)
    const sourceBuffer = await readFile(source.resolvedPath)
    const quality = Math.max(1, Math.min(100, Math.round(payload.quality ?? 60)))
    const compressedBuffer = await sharp(sourceBuffer)
      .webp({
        quality,
        effort: 6
      })
      .toBuffer()
  
    await mkdir(paths.itemAssetsDir, { recursive: true })
    await writeFile(outputPath, compressedBuffer)
  
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }
  
  /**
   * 保存角色图片的原始上传文件。
   * @param storyId 目标故事 id。 @param targetName 用于命名的角色名或角色 id。
   * @param fileContent 图片二进制内容。 @param mimeType 上传图片的 MIME 类型。
   * @returns 原图的安全资产元数据。
   * @throws 故事不存在、图片不可解码、类型不支持或写盘失败时抛错。
   */
  async function writeRoleImageSource(
    storyId: string,
    targetName: string,
    fileContent: Buffer,
    mimeType?: string
  ): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
    const paths = createStoryPaths(dataDir, storyId)
    const fileStem = sanitizeAssetStem(targetName)
    const extension = resolveExtensionFromMimeType(mimeType)
    const uniqueName = `${Date.now().toString(36)}-${fileStem}${extension}`
    const assetPath = path.posix.join("assets", "roles", "raw", uniqueName)
    const outputPath = path.join(paths.roleRawDir, uniqueName)
  
    await ensureReadableImage(fileContent)
    await mkdir(paths.roleRawDir, { recursive: true })
    await writeFile(outputPath, fileContent)
  
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }
  
  /**
   * 将角色原图压缩到角色的正式图片槽位。
   * @param storyId 目标故事 id。 @param payload 原图路径、角色目标名、槽位和质量。
   * @returns `<角色名>_c1.webp` 或 `<角色名>_c2.webp` 的元数据。
   * @throws 目标名无效、原图不属于该故事或 Sharp 处理失败时抛错。
   *
   * 输出始终为 WebP；同一角色同一槽位再次生成时覆盖旧文件，使故事配置中的稳定路径无需改变。
   */
  async function compressRoleImage(
    storyId: string,
    payload: CompressRoleImagePayload
  ): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
  
    const normalizedTargetName = sanitizeAssetStem(payload.targetName)
  
    if (!normalizedTargetName) {
      throw new FileStoreError("Role image target name is required.", 400, "role.invalid-name")
    }
  
    const paths = createStoryPaths(dataDir, storyId)
    const source = resolveStoryAssetPath(dataDir, storyId, payload.sourcePath)
    const normalizedSlot = payload.slot === 2 ? 2 : 1
    const targetName = `${normalizedTargetName}_c${normalizedSlot}.webp`
    const assetPath = path.posix.join("assets", "roles", targetName)
    const outputPath = path.join(paths.roleAssetsDir, targetName)
    const sourceBuffer = await readFile(source.resolvedPath)
    const quality = Math.max(1, Math.min(100, Math.round(payload.quality ?? 60)))
    const compressedBuffer = await sharp(sourceBuffer)
      .webp({
        quality,
        effort: 6
      })
      .toBuffer()
  
    await mkdir(paths.roleAssetsDir, { recursive: true })
    await writeFile(outputPath, compressedBuffer)
  
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }
  
  /**
   * 将故事内的相对资产路径解析成可供文件系统读取的绝对路径。
   * @param storyId 所属故事 id。 @param assetPath 例如 `assets/items/key_c1.webp` 的相对路径。
   * @returns 已确认位于该故事目录内部的绝对路径。
   * @throws 路径为空、含目录穿越或解析结果越出故事目录时抛错。
   */
  function resolveAssetPathForStory(storyId: string, assetPath: string): string {
    return resolveStoryAssetPath(dataDir, storyId, assetPath).resolvedPath
  }
  
  /**
   * 读取一个现有故事资产的元数据。
   * @param storyId 所属故事 id。 @param assetPath 故事目录内的相对资产路径。
   * @returns 文件大小、MIME 类型、修改时间和规范相对路径。
   * @throws 故事或资产不存在、路径越界、文件状态读取失败时抛错。
   */
  async function readStoryAssetMeta(storyId: string, assetPath: string): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }

  return {
    writeSceneBackgroundSource,
    compressSceneBackground,
    writeLocationImageSource,
    compressLocationImage,
    writeItemImageSource,
    compressItemImage,
    writeRoleImageSource,
    compressRoleImage,
    readStoryAssetMeta,
    resolveStoryAssetPath: resolveAssetPathForStory
  }
}
