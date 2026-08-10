/**
 * StoryFileStore 的领域文件写入方法。
 *
 * 每个方法遵循同一顺序：Core Schema 解析不可信对象 → 定位固定文件 → 写 JSON5 → 必要时清理孤立
 * 图片 → 返回实际写入值。revision 和 storyId 互斥不在这里处理，由 Store/API 外层统一包裹。
 */
import { rm } from "node:fs/promises"
import path from "node:path"
import {
  appSettingsSchema,
  storyBibleSchema,
  storyDoingSchema,
  storyEventLocationSchema,
  storyInitialBagsSchema,
  storyItemsSchema,
  storyMetaSchema,
  storyContactConversationsSchema,
  storyContactSchema,
  storyPlayerOverrideValsSchema,
  storyReferSchema,
  storyRolesSchema,
  storySceneSchema,
  storyShopSchema,
  storyValsSchema,
  type AppSettingsFile,
  type StoryBibleFile,
  type StoryDoingFile,
  type StoryEventLocationFile,
  type StoryImportantRolesDataFile,
  type StoryInitialBagsFile,
  type StoryItemsFile,
  type StoryMetaFile,
  type StoryNormalRolesDataFile,
  type StoryContactConversationsFile,
  type StoryContactFile,
  type StoryPlayerOverrideValsFile,
  type StoryReferFile,
  type StoryRolesFile,
  type StorySceneFile,
  type StoryShopFile,
  type StoryValsFile
} from "@story-mgr/core"
import { FileStoreError } from "./errors"
import {
  pruneUnusedItemAssets,
  pruneUnusedLocationAssets,
  pruneUnusedRoleAssets,
  pruneUnusedSceneBackgroundAssets
} from "./asset-pruning"
import { createAppPaths, createStoryPaths, writeJson5File } from "./persistence"
import { ensureStoryExists } from "./readers"

/**
 * 创建绑定 dataDir 的领域写入方法集合。
 * @param dataDir 故事数据根目录。 @returns 可直接组合进 StoryFileStore 的十五个 async 方法。
 */
export function createStoryWriterOperations(dataDir: string) {
  /** @param settings 应用设置。 @returns Schema 解析并写入后的设置。 */
  async function writeAppSettings(settings: AppSettingsFile): Promise<AppSettingsFile> {
    const parsedSettings = appSettingsSchema.parse(settings)
    await writeJson5File(createAppPaths(dataDir).settingsFile, parsedSettings satisfies AppSettingsFile)
    return parsedSettings
  }

  /**
   * 保存 story.json5 元信息。
   * @param storyId URL/目录故事 id。 @param story payload。
   * @returns 写入后的元信息。 @throws path 与 payload id 不一致时抛 400。
   */
  async function writeStoryMeta(storyId: string, story: StoryMetaFile): Promise<StoryMetaFile> {
    await ensureStoryExists(dataDir, storyId)
    if (story.id !== storyId) {
      throw new FileStoreError("Story id in path and payload must match.", 400, "story.id-mismatch")
    }
    const parsedStory = storyMetaSchema.parse(story)
    await writeJson5File(createStoryPaths(dataDir, storyId).metaFile, parsedStory satisfies StoryMetaFile)
    return parsedStory
  }

  /** @param storyId 故事 id。 @param storyBible AI 创作背景。 @returns Schema 解析并写入后的故事圣经。 */
  async function writeStoryBible(storyId: string, storyBible: StoryBibleFile): Promise<StoryBibleFile> {
    await ensureStoryExists(dataDir, storyId)
    const parsed = storyBibleSchema.parse(storyBible)
    await writeJson5File(createStoryPaths(dataDir, storyId).storyBibleFile, parsed satisfies StoryBibleFile)
    return parsed
  }

  /** @param storyId 故事 id。 @param vals 普通变量文件。 @returns 写入后的变量。 */
  async function writeVals(storyId: string, vals: StoryValsFile): Promise<StoryValsFile> {
    const parsed = storyValsSchema.parse(vals)
    await writeJson5File(createStoryPaths(dataDir, storyId).valsFile, parsed satisfies StoryValsFile)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 玩家覆盖字段配置。 @returns 写入后的配置。 */
  async function writePlayerOverrideVals(
    storyId: string,
    value: StoryPlayerOverrideValsFile
  ): Promise<StoryPlayerOverrideValsFile> {
    const parsed = storyPlayerOverrideValsSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).playerOverrideValsFile, parsed satisfies StoryPlayerOverrideValsFile)
    return parsed
  }

  /** @param storyId 故事 id。 @param systemVals 系统变量文件。 @returns 写入后的系统变量。 */
  async function writeSystemVals(storyId: string, systemVals: StoryValsFile): Promise<StoryValsFile> {
    const parsed = storyValsSchema.parse(systemVals)
    await writeJson5File(createStoryPaths(dataDir, storyId).systemValsFile, parsed satisfies StoryValsFile)
    return parsed
  }

  /**
   * 保存普通/重要角色两个文件并清理旧格式和孤立角色图片。
   * @param storyId 故事 id。 @param roles 两个角色库。 @returns 写入后的角色对象。
   */
  async function writeRoles(storyId: string, roles: StoryRolesFile): Promise<StoryRolesFile> {
    const parsed = storyRolesSchema.parse(roles)
    const paths = createStoryPaths(dataDir, storyId)
    await writeJson5File(paths.normalRolesFile, parsed.normal satisfies StoryNormalRolesDataFile)
    await writeJson5File(paths.importantRolesFile, parsed.important satisfies StoryImportantRolesDataFile)
    await rm(paths.rolesLegacyFile, { force: true })
    await rm(path.join(paths.storyDir, "roles_setting.json5"), { force: true })
    await pruneUnusedRoleAssets(dataDir, storyId, parsed)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 地点配置。 @returns 写入值；随后清理未引用地点图片。 */
  async function writeEventLocations(storyId: string, value: StoryEventLocationFile): Promise<StoryEventLocationFile> {
    const parsed = storyEventLocationSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).eventLocationFile, parsed satisfies StoryEventLocationFile)
    await pruneUnusedLocationAssets(dataDir, storyId, parsed)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 物品库。 @returns 写入值；随后清理未引用物品图片。 */
  async function writeItems(storyId: string, value: StoryItemsFile): Promise<StoryItemsFile> {
    const parsed = storyItemsSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).itemsFile, parsed satisfies StoryItemsFile)
    await pruneUnusedItemAssets(dataDir, storyId, parsed)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 商城配置。 @returns Schema 解析并写入后的商城。 */
  async function writeShop(storyId: string, value: StoryShopFile): Promise<StoryShopFile> {
    const parsed = storyShopSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).shopFile, parsed satisfies StoryShopFile)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 新存档初始背包。 @returns 写入后的初始背包。 */
  async function writeInitialBags(storyId: string, value: StoryInitialBagsFile): Promise<StoryInitialBagsFile> {
    const parsed = storyInitialBagsSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).initialBagsFile, parsed satisfies StoryInitialBagsFile)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 联系人配置。 @returns 写入后的配置。 */
  async function writeContact(storyId: string, value: StoryContactFile): Promise<StoryContactFile> {
    const parsed = storyContactSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).contactFile, parsed satisfies StoryContactFile)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 连续联系人剧情。 @returns 写入后的会话文件。 */
  async function writeContactConversations(
    storyId: string,
    value: StoryContactConversationsFile
  ): Promise<StoryContactConversationsFile> {
    const parsed = storyContactConversationsSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).contactConversationsFile, parsed satisfies StoryContactConversationsFile)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 性别称谓库。 @returns 写入后的称谓库。 */
  async function writeRefer(storyId: string, value: StoryReferFile): Promise<StoryReferFile> {
    const parsed = storyReferSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).referFile, parsed satisfies StoryReferFile)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 玩家行动配置。 @returns 写入后的 Doing 配置。 */
  async function writeDoing(storyId: string, value: StoryDoingFile): Promise<StoryDoingFile> {
    const parsed = storyDoingSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).doingFile, parsed satisfies StoryDoingFile)
    return parsed
  }

  /** @param storyId 故事 id。 @param value 场景配置。 @returns 写入值；随后清理未引用背景图。 */
  async function writeScenes(storyId: string, value: StorySceneFile): Promise<StorySceneFile> {
    const parsed = storySceneSchema.parse(value)
    await writeJson5File(createStoryPaths(dataDir, storyId).sceneFile, parsed satisfies StorySceneFile)
    await pruneUnusedSceneBackgroundAssets(dataDir, storyId, parsed)
    return parsed
  }

  return {
    writeAppSettings,
    writeDoing,
    writeEventLocations,
    writeInitialBags,
    writeItems,
    writeContact,
    writeContactConversations,
    writePlayerOverrideVals,
    writeRefer,
    writeRoles,
    writeScenes,
    writeShop,
    writeStoryBible,
    writeStoryMeta,
    writeSystemVals,
    writeVals
  }
}
