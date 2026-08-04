/**
 * StoryFileStore 的组合门面。
 *
 * 门面负责按 storyId 串行化修改、修订号检查和领域写入；底层 I/O 与资产操作由专门模块提供。
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
import type {
  CreateStoryInput,
  StoryFileStore,
  StoryMutationResult
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
import { createStoryAssetOperations } from "./asset-operations"
import { createStoryMutationCoordinator } from "./mutation"
import { createStoryWriterOperations } from "./store-writers"

/**
 * 创建绑定数据目录的 StoryFileStore 门面。
 *
 * @param dataDir 包含 `stories/`、设置和 `.story-manager/` 状态的根目录。
 * @returns 实现 StoryFileStore 契约的对象；方法共享同一互斥协调器和资产服务。
 *
 * 组合层本身不启动服务器。它把读取、事务、revision、领域写入与图片操作集中成稳定 API，使调用方
 * 不需要知道 JSON5 文件名；同一 storyId 的锁只创建一份，不能在每个方法内重复创建协调器。
 */
export function createStoryFileStore(dataDir: string): StoryFileStore {
  const assetOperations = createStoryAssetOperations(dataDir)
  const writerOperations = createStoryWriterOperations(dataDir)
  const {
    readStoryRevision,
    readStoryRevisionUnlocked,
    runStoryExclusive,
    withStoryMutation
  } = createStoryMutationCoordinator(dataDir)

  /** @returns 读取并经 Schema 解析的应用设置；缺文件时由 reader 返回默认设置。 */
  async function readAppSettings(): Promise<AppSettingsFile> {
    return readAppSettingsFile(dataDir)
  }

  /** @param storyId 故事 id。 @returns 对应故事圣经；缺文件使用兼容默认值。 */
  async function readStoryBible(storyId: string): Promise<StoryBibleFile> {
    return readStoryBibleFile(dataDir, storyId)
  }

  /**
   * 读取故事的手机会话配置。
   *
   * @param storyId 要读取的故事 id。
   * @returns 经过 Schema 校验的联系人会话、群聊和消息数据；缺少文件时返回兼容默认值。
   * @throws 文件存在但 JSON5 语法错误或内容不符合 Schema 时抛出解析错误。
   *
   * 这里保留一层门面函数，是为了让调用方只依赖 StoryFileStore，而不必知道
   * `phone_conversations.json5` 的实际位置和旧文件兼容规则。
   */
  async function readPhoneConversations(storyId: string): Promise<StoryPhoneConversationsFile> {
    return readStoryPhoneConversations(dataDir, storyId)
  }

  /**
   * 列出首页所需的轻量故事摘要。
   * @returns 每个有效故事的 id、标题、描述、chain 节点数和 story.json5 修改时间。
   *
   * 故事目录先统一列出，各故事元信息/事件再并行读取；不会为了摘要加载手机、图片等完整文档。
   */
  async function listStorySummaries(): Promise<StorySummary[]> {
    const storyIds = await listStoryIds(path.join(dataDir, "stories"))

    const stories = await Promise.all(
      storyIds.map(async (storyId) => {
        const meta = await readStoryMeta(dataDir, storyId)
        const graphEvents = await readStoryGraphEvents(dataDir, storyId)
        const updatedAt = await getIsoMtime(createStoryPaths(dataDir, storyId).metaFile)

        return {
          id: meta.id,
          title: meta.title,
          description: meta.description,
          eventCount: graphEvents.length,
          updatedAt
        }
      })
    )

    return stories
  }

  /**
   * 创建一套完整、可立即打开的新故事文件。
   *
   * @param input 用户提交的 id、标题、描述和标签。
   * @returns 经 StoryDocument Schema 解析的初始文档。
   * @throws id/标题非法、目录已存在或事务写入失败时抛错。
   *
   * 所有默认领域数据先在内存组装并整体解析，再由一次多文件事务写入，revision 同事务初始化为 0；
   * 因此中途失败不会留下“只有一半文件”的可见故事。
   */
  async function createStory(input: CreateStoryInput): Promise<StoryDocument> {
    const story = createStoryMetaFromInput(input)
    const paths = createStoryPaths(dataDir, story.id)

    await assertStoryCanBeCreated(dataDir, story.id)

    const storyBible = storyBibleSchema.parse(createDefaultStoryBible())
    const vals = storyValsSchema.parse({ variables: [] })
    const playerOverrideVals = storyPlayerOverrideValsSchema.parse({ entries: [] })
    const systemVals = storyValsSchema.parse({ variables: [] })
    const scenes = storySceneSchema.parse(createDefaultStoryScenes())
    const normalRoles = storyNormalRolesDataFileSchema.parse(createDefaultStoryRoleData())
    const importantRoles = storyImportantRolesDataFileSchema.parse(createDefaultStoryRoleData())
    const eventLocations = storyEventLocationSchema.parse(createDefaultStoryEventLocations())
    const items = storyItemsSchema.parse(createDefaultStoryItems())
    const shop = storyShopSchema.parse(createDefaultStoryShop())
    const initialBags = storyInitialBagsSchema.parse(createDefaultInitialBags())
    const phone = storyPhoneSchema.parse(createDefaultStoryPhone())
    const phoneConversations = storyPhoneConversationsSchema.parse(createDefaultStoryPhoneConversations())
    const refer = storyReferSchema.parse(createDefaultStoryRefer())
    const doing = storyDoingSchema.parse(createDefaultStoryDoing())
    const chainEvents = storyChainEventsSchema.parse([])
    const poolEvents = storyPoolEventsSchema.parse([])
    const scheduleEvents = storyScheduleEventsSchema.parse([])

    await Promise.all([
      mkdir(paths.eventsDir, { recursive: true }),
      mkdir(paths.assetsDir, { recursive: true })
    ])

    const document = storyDocumentSchema.parse({
      story,
      storyBible,
      vals,
      playerOverrideVals,
      systemVals,
      scenes,
      roles: { normal: normalRoles, important: importantRoles },
      eventLocations,
      items,
      shop,
      initialBags,
      phone,
      phoneConversations,
      refer,
      doing,
      chainEvents,
      poolEvents,
      scheduleEvents
    })

    await commitStoryFileTransaction(dataDir, story.id, [
      ...createStoryDocumentUpdates(paths, document),
      { filePath: createStoryStatePaths(dataDir, story.id).revisionFile, value: { revision: 0 } }
    ])

    return document
  }

  /**
   * 在调用方已持有 story 锁时并行读取完整文档。
   *
   * @param storyId 故事 id。
   * @returns 合并后的规范 StoryDocument。
   * @throws 任一文件损坏或最终聚合 Schema 不通过时抛错。
   *
   * 这个函数故意不恢复事务、不加锁，避免嵌套锁死；只能由已经处理并发边界的方法调用。
   */
  async function readStoryDocumentUnlocked(storyId: string): Promise<StoryDocument> {
    const [
      story,
      storyBible,
      vals,
      playerOverrideVals,
      systemVals,
      scenes,
      roles,
      eventLocations,
      items,
      shop,
      initialBags,
      phone,
      phoneConversations,
      refer,
      doing,
      chainEvents,
      poolEvents,
      scheduleEvents
    ] =
      await Promise.all([
      readStoryMeta(dataDir, storyId),
      readStoryBibleFile(dataDir, storyId),
      readStoryVals(dataDir, storyId),
      readStoryPlayerOverrideVals(dataDir, storyId),
      readStorySystemVals(dataDir, storyId),
      readStoryScenes(dataDir, storyId),
      readStoryRoles(dataDir, storyId),
      readStoryEventLocations(dataDir, storyId),
      readStoryItems(dataDir, storyId),
      readStoryShop(dataDir, storyId),
      readStoryInitialBags(dataDir, storyId),
      readStoryPhone(dataDir, storyId),
      readStoryPhoneConversations(dataDir, storyId),
      readStoryRefer(dataDir, storyId),
      readStoryDoing(dataDir, storyId),
      readStoryGraphEvents(dataDir, storyId),
      readStoryOnceEvents(dataDir, storyId),
      readStoryLoopEvents(dataDir, storyId)
      ])

    return storyDocumentSchema.parse({
      story,
      storyBible,
      vals,
      playerOverrideVals,
      systemVals,
      scenes,
      roles,
      eventLocations,
      items,
      shop,
      initialBags,
      phone,
      phoneConversations,
      refer,
      doing,
      chainEvents,
      poolEvents,
      scheduleEvents
    })
  }

  /**
   * 安全读取完整故事。
   * @param storyId 故事 id。 @returns 恢复未完成事务后的稳定 StoryDocument。
   *
   * 读取也进入互斥队列，是为了不在事务替换多个文件的中间状态看到混合版本。
   */
  async function readStoryDocument(storyId: string): Promise<StoryDocument> {
    return runStoryExclusive(storyId, async () => {
      await recoverStoryTransactions(dataDir, storyId)
      return readStoryDocumentUnlocked(storyId)
    })
  }

  /**
   * 以一次事务替换完整 StoryDocument，并执行乐观并发检查。
   *
   * @param storyId 目标故事 id。 @param document 候选完整文档。 @param expectedRevision 客户端读取版本。
   * @returns 提交后的文档与递增 revision。
   * @throws revision 不一致抛 409，path/payload id 不同抛 400，Schema/事务错误原样抛出。
   *
   * 锁内顺序固定为恢复旧事务 → 比较 revision → 校验整个候选 → 一次提交所有文件和新 revision。
   */
  async function commitStoryDocument(
    storyId: string,
    document: StoryDocument,
    expectedRevision: number
  ): Promise<StoryMutationResult<StoryDocument>> {
    return runStoryExclusive(storyId, async () => {
      await ensureStoryExists(dataDir, storyId)
      await recoverStoryTransactions(dataDir, storyId)
      const currentRevision = await readStoryRevisionUnlocked(storyId)

      if (expectedRevision !== currentRevision) {
        throw new FileStoreError(
          `Story revision conflict: expected ${expectedRevision}, current ${currentRevision}.`,
          409,
          "revision.conflict"
        )
      }

      const parsedDocument = storyDocumentSchema.parse(document)
      if (parsedDocument.story.id !== storyId) {
        throw new FileStoreError(
          "Story id in path and document must match.",
          400,
          "story.id-mismatch"
        )
      }

      const revision = currentRevision + 1
      const paths = createStoryPaths(dataDir, storyId)
      await commitStoryFileTransaction(dataDir, storyId, [
        ...createStoryDocumentUpdates(paths, parsedDocument),
        { filePath: createStoryStatePaths(dataDir, storyId).revisionFile, value: { revision } }
      ])
      await Promise.all([
        rm(paths.rolesLegacyFile, { force: true }),
        rm(path.join(paths.storyDir, "roles_setting.json5"), { force: true })
      ])

      return { value: parsedDocument, revision }
    })
  }

  /**
   * 从指定事件集合读取单个事件。
   * @param storyId 故事 id。 @param eventId 事件 id。
   * @param collectionType chain/pool/schedule 或兼容旧名称。 @returns 命中的事件。
   * @throws 找不到目标时抛 404。
   */
  async function readEvent(
    storyId: string,
    eventId: string,
    collectionType: StoryEventCollectionType = "chain"
  ): Promise<StoryAnyEventFile> {
    const normalizedCollectionType = normalizeEventCollectionType(collectionType)
    const events =
      normalizedCollectionType === "pool"
        ? await readStoryOnceEvents(dataDir, storyId)
        : normalizedCollectionType === "schedule"
          ? await readStoryLoopEvents(dataDir, storyId)
          : await readStoryGraphEvents(dataDir, storyId)
    const event = events.find((currentEvent) => currentEvent.id === eventId)

    if (!event) {
      throw new FileStoreError(`Event not found: ${eventId}`, 404, "event.not-found")
    }

    if (normalizedCollectionType === "pool") {
      return storyOnceEventSchema.parse(event)
    }

    if (normalizedCollectionType === "schedule") {
      return storyLoopEventSchema.parse(event)
    }

    return "exec_script" in event ? storyActionSchema.parse(event) : storyEventSchema.parse(event)
  }

  /**
   * 新增或替换一个事件，并写回所属集合文件。
   *
   * @param storyId 故事 id。 @param eventId URL 中目标 id。 @param event 事件 payload。
   * @param collectionType 目标集合。 @returns Schema 解析后的实际事件。
   * @throws URL/payload id 不同、节点类型不适合集合或 Schema 失败时抛错。
   *
   * 先读取整个数组，按 id 替换或追加，再写一次文件；单文件写入使用 JSON5 临时文件原子替换。
   */
  async function writeEvent(
    storyId: string,
    eventId: string,
    event: StoryAnyEventFile,
    collectionType: StoryEventCollectionType = "chain"
  ): Promise<StoryAnyEventFile> {
    if (event.id !== eventId) {
      throw new FileStoreError("Event id in path and payload must match.", 400, "event.id-mismatch")
    }

    const paths = createStoryPaths(dataDir, storyId)
    const normalizedCollectionType = normalizeEventCollectionType(collectionType)

    if (normalizedCollectionType === "pool") {
      const parsedEvent = storyOnceEventSchema.parse(event)
      const onceEvents = await readStoryOnceEvents(dataDir, storyId)
      const hasExistingEvent = onceEvents.some((currentEvent) => currentEvent.id === eventId)
      const nextOnceEvents = hasExistingEvent
        ? onceEvents.map((currentEvent) =>
            currentEvent.id === eventId ? parsedEvent : currentEvent
          )
        : [...onceEvents, parsedEvent]

      await writeJson5File(
        paths.poolEventsFile,
        nextOnceEvents satisfies StoryOnceEventsFile
      )

      return parsedEvent
    }

    if (normalizedCollectionType === "schedule") {
      const parsedEvent = storyLoopEventSchema.parse(event)
      const loopEvents = await readStoryLoopEvents(dataDir, storyId)
      const hasExistingEvent = loopEvents.some((currentEvent) => currentEvent.id === eventId)
      const nextLoopEvents = hasExistingEvent
        ? loopEvents.map((currentEvent) =>
            currentEvent.id === eventId ? parsedEvent : currentEvent
          )
        : [...loopEvents, parsedEvent]

      await writeJson5File(
        paths.scheduleEventsFile,
        nextLoopEvents satisfies StoryLoopEventsFile
      )

      return parsedEvent
    }

    const parsedEvent = "exec_script" in event
      ? storyActionSchema.parse(event)
      : storyEventSchema.parse(event)
    const graphEvents = await readStoryGraphEvents(dataDir, storyId)
    const hasExistingEvent = graphEvents.some((currentEvent) => currentEvent.id === eventId)
    const nextGraphEvents = hasExistingEvent
      ? graphEvents.map((currentEvent) =>
          currentEvent.id === eventId ? parsedEvent : currentEvent
        )
      : [...graphEvents, parsedEvent]

    await writeJson5File(paths.chainEventsFile, nextGraphEvents satisfies StoryGraphEventsFile)

    return parsedEvent
  }

  /**
   * 删除事件，并清理 chain 图中指向该 id 的 next 边。
   *
   * @param storyId 故事 id。 @param eventId 删除目标。 @param collectionType 所属集合。
   * @returns Promise<void>；目标不存在时保持幂等写回过滤结果。
   *
   * pool/schedule 只过滤自身数组；chain 还遍历剩余节点移除悬空 next，避免删除后立即产生引用错误。
   */
  async function deleteEvent(
    storyId: string,
    eventId: string,
    collectionType: StoryEventCollectionType = "chain"
  ): Promise<void> {
    const paths = createStoryPaths(dataDir, storyId)
    const normalizedCollectionType = normalizeEventCollectionType(collectionType)

    if (normalizedCollectionType === "pool") {
      const onceEvents = await readStoryOnceEvents(dataDir, storyId)
      const nextOnceEvents = onceEvents.filter((currentEvent) => currentEvent.id !== eventId)

      if (nextOnceEvents.length === onceEvents.length) {
        throw new FileStoreError(`Event not found: ${eventId}`, 404, "event.not-found")
      }

      await writeJson5File(
        paths.poolEventsFile,
        nextOnceEvents satisfies StoryOnceEventsFile
      )

      return
    }

    if (normalizedCollectionType === "schedule") {
      const loopEvents = await readStoryLoopEvents(dataDir, storyId)
      const nextLoopEvents = loopEvents.filter((currentEvent) => currentEvent.id !== eventId)

      if (nextLoopEvents.length === loopEvents.length) {
        throw new FileStoreError(`Event not found: ${eventId}`, 404, "event.not-found")
      }

      await writeJson5File(paths.scheduleEventsFile, nextLoopEvents satisfies StoryLoopEventsFile)

      return
    }

    const graphEvents = await readStoryGraphEvents(dataDir, storyId)
    const hasTargetEvent = graphEvents.some((currentEvent) => currentEvent.id === eventId)

    if (!hasTargetEvent) {
      throw new FileStoreError(`Event not found: ${eventId}`, 404, "event.not-found")
    }

    const nextGraphEvents = graphEvents
      .filter((currentEvent) => currentEvent.id !== eventId)
      .map((currentEvent) =>
        currentEvent.next.includes(eventId)
          ? {
              ...currentEvent,
              next: currentEvent.next.filter((nextEventId) => nextEventId !== eventId)
            }
          : currentEvent
      )

    await writeJson5File(paths.chainEventsFile, nextGraphEvents satisfies StoryGraphEventsFile)
  }

  return {
    readAppSettings,
    listStorySummaries,
    createStory,
    readStoryDocument,
    readStoryRevision,
    withStoryMutation,
    commitStoryDocument,
    readStoryBible,
    readPhoneConversations,
    readEvent,
    writeEvent,
    deleteEvent,
    ...writerOperations,
    ...assetOperations
  }
}
