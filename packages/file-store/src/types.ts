/**
 * File Store 对外暴露的类型契约。
 *
 * 接口描述调用方能做什么，不包含文件路径、事务临时目录等实现细节。
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

export interface StoryFileStore {
  readAppSettings(): Promise<AppSettingsFile>
  listStorySummaries(): Promise<StorySummary[]>
  createStory(request: CreateStoryInput): Promise<StoryDocument>
  readStoryDocument(storyId: string): Promise<StoryDocument>
  readStoryRevision(storyId: string): Promise<number>
  withStoryMutation<T>(
    storyId: string,
    expectedRevision: number,
    operation: () => Promise<T>
  ): Promise<StoryMutationResult<T>>
  commitStoryDocument(
    storyId: string,
    document: StoryDocument,
    expectedRevision: number
  ): Promise<StoryMutationResult<StoryDocument>>
  readStoryBible(storyId: string): Promise<StoryBibleFile>
  readPhoneConversations(storyId: string): Promise<StoryPhoneConversationsFile>
  writeStoryMeta(storyId: string, story: StoryMetaFile): Promise<StoryMetaFile>
  readEvent(
    storyId: string,
    eventId: string,
    collectionType?: StoryEventCollectionType
  ): Promise<StoryAnyEventFile>
  writeAppSettings(settings: AppSettingsFile): Promise<AppSettingsFile>
  writeEvent(
    storyId: string,
    eventId: string,
    event: StoryAnyEventFile,
    collectionType?: StoryEventCollectionType
  ): Promise<StoryAnyEventFile>
  deleteEvent(
    storyId: string,
    eventId: string,
    collectionType?: StoryEventCollectionType
  ): Promise<void>
  writeStoryBible(storyId: string, storyBible: StoryBibleFile): Promise<StoryBibleFile>
  writeRoles(storyId: string, roles: StoryRolesFile): Promise<StoryRolesFile>
  writeEventLocations(
    storyId: string,
    eventLocations: StoryEventLocationFile
  ): Promise<StoryEventLocationFile>
  writeItems(storyId: string, items: StoryItemsFile): Promise<StoryItemsFile>
  writeShop(storyId: string, shop: StoryShopFile): Promise<StoryShopFile>
  writeInitialBags(storyId: string, initialBags: StoryInitialBagsFile): Promise<StoryInitialBagsFile>
  writePhone(storyId: string, phone: StoryPhoneFile): Promise<StoryPhoneFile>
  writePhoneConversations(storyId: string, phoneConversations: StoryPhoneConversationsFile): Promise<StoryPhoneConversationsFile>
  writeRefer(storyId: string, refer: StoryReferFile): Promise<StoryReferFile>
  writeDoing(storyId: string, doing: StoryDoingFile): Promise<StoryDoingFile>
  writeVals(storyId: string, vals: StoryValsFile): Promise<StoryValsFile>
  writePlayerOverrideVals(
    storyId: string,
    playerOverrideVals: StoryPlayerOverrideValsFile
  ): Promise<StoryPlayerOverrideValsFile>
  writeSystemVals(storyId: string, systemVals: StoryValsFile): Promise<StoryValsFile>
  writeScenes(storyId: string, scenes: StorySceneFile): Promise<StorySceneFile>
  writeSceneBackgroundSource(
    storyId: string,
    fileName: string,
    fileContent: Buffer
  ): Promise<StoryAssetMetadata>
  compressSceneBackground(
    storyId: string,
    payload: CompressSceneBackgroundPayload
  ): Promise<StoryAssetMetadata>
  writeLocationImageSource(
    storyId: string,
    targetName: string,
    fileContent: Buffer,
    mimeType?: string
  ): Promise<StoryAssetMetadata>
  compressLocationImage(
    storyId: string,
    payload: CompressLocationImagePayload
  ): Promise<StoryAssetMetadata>
  writeItemImageSource(
    storyId: string,
    targetName: string,
    fileContent: Buffer,
    mimeType?: string
  ): Promise<StoryAssetMetadata>
  compressItemImage(
    storyId: string,
    payload: CompressItemImagePayload
  ): Promise<StoryAssetMetadata>
  writeRoleImageSource(
    storyId: string,
    targetName: string,
    fileContent: Buffer,
    mimeType?: string
  ): Promise<StoryAssetMetadata>
  compressRoleImage(
    storyId: string,
    payload: CompressRoleImagePayload
  ): Promise<StoryAssetMetadata>
  readStoryAssetMeta(storyId: string, assetPath: string): Promise<StoryAssetMetadata>
  resolveStoryAssetPath(storyId: string, assetPath: string): string
}

export interface StoryMutationResult<T> {
  value: T
  revision: number
}

export interface CreateStoryInput {
  id: string
  title: string
  description?: string
  tags?: string[]
}

export interface StoryAssetMetadata {
  assetPath: string
  fileName: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
}

export interface CompressSceneBackgroundPayload {
  sourcePath: string
  level: number
  variant: StorySceneBackgroundVariant
  quality: number
}

export interface CompressLocationImagePayload {
  sourcePath: string
  targetName: string
  quality: number
  slot: 1 | 2
}

export interface CompressItemImagePayload {
  sourcePath: string
  targetName: string
  quality: number
  slot: 1 | 2
}

export interface CompressRoleImagePayload {
  sourcePath: string
  targetName: string
  quality: number
  slot: 1 | 2
}

