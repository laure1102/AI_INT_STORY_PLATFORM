import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import JSON5 from "json5"
import sharp from "sharp"
import {
  appSettingsSchema,
  storyBibleSchema,
  storyChainEventsSchema,
  storyDoingSchema,
  storyActionSchema,
  storyOnceEventSchema,
  storyPoolEventsSchema,
  storyEventLocationSchema,
  storyEventSchema,
  storyImportantRolesDataFileSchema,
  storyInitialBagsSchema,
  storyItemsSchema,
  storyLoopEventSchema,
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

export class FileStoreError extends Error {
  statusCode: number
  code: string

  constructor(message: string, statusCode = 400, code = "file-store.error") {
    super(message)
    this.name = "FileStoreError"
    this.statusCode = statusCode
    this.code = code
  }
}

export function isFileStoreError(error: unknown): error is FileStoreError {
  return error instanceof FileStoreError
}

export interface StoryFileStore {
  readAppSettings(): Promise<AppSettingsFile>
  listStorySummaries(): Promise<StorySummary[]>
  createStory(request: CreateStoryInput): Promise<StoryDocument>
  readStoryDocument(storyId: string): Promise<StoryDocument>
  readStoryBible(storyId: string): Promise<StoryBibleFile>
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

function sortObjectKeys(value: unknown): unknown {
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

async function readJson5File<T>(filePath: string): Promise<T> {
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

async function writeJson5File(filePath: string, value: unknown) {
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

async function listJson5FileNames(directory: string) {
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

async function listStoryIds(storiesRoot: string) {
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

async function getIsoMtime(filePath: string) {
  try {
    const fileStat = await stat(filePath)
    return fileStat.mtime.toISOString()
  } catch {
    return undefined
  }
}

function createStoryPaths(dataDir: string, storyId: string) {
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

function createAppPaths(dataDir: string) {
  return {
    settingsFile: path.join(dataDir, "setting.json5")
  }
}

function createDefaultStoryBible(): StoryBibleFile {
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

function createDefaultStoryItems(): StoryItemsFile {
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

function createDefaultInitialBags(): StoryInitialBagsFile {
  return {
    player: {
      entries: []
    }
  }
}

function createDefaultStoryShop(): StoryShopFile {
  return {
    currency_value_key: "player.money",
    categories: [],
    products: []
  }
}

function createDefaultStoryPhone(): StoryPhoneFile {
  return {
    relationship_tracks: [],
    personality_library: [],
    talk_library: [],
    action_library: [],
    reply_library: [],
    player_quick_messages: [],
    contact_profiles: [],
    fallback_replies: {}
  }
}

function createDefaultStoryRefer(): StoryReferFile {
  return {
    gender_value_key: "player.gender",
    gender_aliases: {
      male: ["男", "male", "m"],
      female: ["女", "female", "f"]
    },
    terms: [
      {
        id: "player.respect",
        label: "NPC尊称玩家",
        male: "先生",
        female: "女士",
        fallback: "贵客"
      },
      {
        id: "player.casual",
        label: "熟人称呼玩家",
        male: "哥",
        female: "姐",
        fallback: "朋友"
      },
      {
        id: "player.self",
        label: "玩家普通自称",
        male: "我",
        female: "我",
        fallback: "我"
      },
      {
        id: "player.self_proud",
        label: "玩家自信自称",
        male: "本少",
        female: "本小姐",
        fallback: "我"
      },
      {
        id: "player.ta",
        label: "玩家第三人称",
        male: "他",
        female: "她",
        fallback: "TA"
      },
      {
        id: "player.him_her",
        label: "玩家宾格/指代",
        male: "他",
        female: "她",
        fallback: "TA"
      },
      {
        id: "player.young_title",
        label: "年轻身份称呼",
        male: "少爷",
        female: "小姐",
        fallback: "贵客"
      }
    ]
  }
}

function createDefaultStoryDoing(): StoryDoingFile {
  return {
    menus: [],
    doings: []
  }
}

function createDefaultStoryScenes(): StorySceneFile {
  return {
    ai: {
      compress_quality: 60
    },
    scenes: []
  }
}

function createDefaultStoryRoleData(): StoryNormalRolesDataFile {
  return {
    ai: {
      width: 1536,
      height: 1024,
      global_prompt: "",
      compress_quality_1: 60,
      compress_quality_2: 80
    },
    roles: []
  }
}

function createDefaultStoryEventLocations(): StoryEventLocationFile {
  return {
    ai: {
      width: 1536,
      height: 1024,
      global_prompt: "",
      compress_quality_1: 60,
      compress_quality_2: 80
    },
    assignments: []
  }
}

function createDefaultAppSettings(): AppSettingsFile {
  return {
    ai: {
      image: {
        apiKey: "",
        baseUrl: "",
        model: ""
      },
      text: {
        apiKey: "",
        baseUrl: "",
        model: ""
      },
      agent: {
        apiKey: "",
        baseUrl: "",
        chiefEditorModel: "",
        plotPlannerModel: "",
        assetDesignerModel: "",
        eventWriterModel: "",
        scriptDoctorModel: "",
        consistencyCheckerModel: "",
        temperature: 0.7
      }
    }
  }
}

function normalizeNewStoryId(rawId: string) {
  const storyId = rawId.trim().toLowerCase()

  if (!storyId) {
    throw new FileStoreError("Story id is required.", 400, "story.id-required")
  }

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

function normalizeNewStoryTags(tags: string[] | undefined) {
  return Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)))
}

function createStoryMetaFromInput(input: CreateStoryInput): StoryMetaFile {
  const id = normalizeNewStoryId(input.id)
  const title = input.title.trim()

  if (!title) {
    throw new FileStoreError("Story title is required.", 400, "story.title-required")
  }

  const description = input.description?.trim() ?? ""
  const tags = normalizeNewStoryTags(input.tags)

  return storyMetaSchema.parse({
    id,
    title,
    ...(description ? { description } : {}),
    ...(tags.length ? { tags } : {})
  })
}

async function assertStoryCanBeCreated(dataDir: string, storyId: string) {
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return
    }

    throw error
  }
}

const imageMimeTypes = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
} as const

const mimeTypeExtensions = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
} as const

function normalizeStoryAssetPath(assetPath: string) {
  const trimmedPath = assetPath.replace(/\\/g, "/").trim()

  if (!trimmedPath) {
    throw new FileStoreError("Asset path is required.", 400, "asset.path-required")
  }

  if (path.posix.isAbsolute(trimmedPath) || /^[a-z]:/i.test(trimmedPath)) {
    throw new FileStoreError("Asset path must be relative.", 400, "asset.invalid-path")
  }

  const normalizedPath = path.posix.normalize(trimmedPath.replace(/^\.\//, ""))

  if (
    normalizedPath === "." ||
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    !normalizedPath.startsWith("assets/")
  ) {
    throw new FileStoreError(
      "Asset path must stay inside the story assets directory.",
      400,
      "asset.invalid-path"
    )
  }

  return normalizedPath
}

function resolveStoryAssetPath(dataDir: string, storyId: string, assetPath: string) {
  const storyDir = createStoryPaths(dataDir, storyId).storyDir
  const normalizedPath = normalizeStoryAssetPath(assetPath)
  const resolvedPath = path.resolve(storyDir, normalizedPath)
  const resolvedStoryDir = path.resolve(storyDir)

  if (
    resolvedPath !== resolvedStoryDir &&
    !resolvedPath.startsWith(`${resolvedStoryDir}${path.sep}`)
  ) {
    throw new FileStoreError(
      "Resolved asset path escapes the story directory.",
      400,
      "asset.invalid-path"
    )
  }

  return {
    normalizedPath,
    resolvedPath
  }
}

function getAssetMimeType(assetPath: string) {
  const extension = path.extname(assetPath).toLowerCase() as keyof typeof imageMimeTypes
  return imageMimeTypes[extension] ?? "application/octet-stream"
}

function sanitizeFileNameSegment(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function sanitizeAssetStem(fileName: string) {
  return sanitizeFileNameSegment(fileName).replace(/\.[^.]+$/g, "") || "asset"
}

function resolveUploadExtension(fileName: string) {
  const extension = path.extname(fileName).toLowerCase() as keyof typeof imageMimeTypes

  if (!imageMimeTypes[extension]) {
    throw new FileStoreError(
      "Only png, jpg, jpeg, and webp images are supported.",
      400,
      "asset.unsupported-image"
    )
  }

  return extension
}

function resolveExtensionFromMimeType(mimeType: string | undefined) {
  if (!mimeType) {
    return ".png"
  }

  return mimeTypeExtensions[mimeType.trim().toLowerCase() as keyof typeof mimeTypeExtensions] ?? ".png"
}

async function ensureReadableImage(fileContent: Buffer) {
  try {
    const metadata = await sharp(fileContent).metadata()

    if (!metadata.format) {
      throw new Error("Missing image format metadata.")
    }
  } catch {
    throw new FileStoreError("The uploaded file is not a valid image.", 400, "asset.invalid-image")
  }
}

async function createStoryAssetMetadata(
  dataDir: string,
  storyId: string,
  assetPath: string
): Promise<StoryAssetMetadata> {
  const { normalizedPath, resolvedPath } = resolveStoryAssetPath(dataDir, storyId, assetPath)
  let fileStat: Awaited<ReturnType<typeof stat>>

  try {
    fileStat = await stat(resolvedPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FileStoreError(`Asset not found: ${normalizedPath}`, 404, "asset.not-found")
    }

    throw error
  }

  let width: number | undefined
  let height: number | undefined

  try {
    const fileContent = await readFile(resolvedPath)
    const metadata = await sharp(fileContent).metadata()
    width = metadata.width
    height = metadata.height
  } catch {
    width = undefined
    height = undefined
  }

  return {
    assetPath: normalizedPath,
    fileName: path.basename(normalizedPath),
    mimeType: getAssetMimeType(normalizedPath),
    sizeBytes: fileStat.size,
    width,
    height
  }
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const nestedFileLists = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name)

        if (entry.isDirectory()) {
          return listFilesRecursively(entryPath)
        }

        return entry.isFile() ? [entryPath] : []
      })
    )

    return nestedFileLists.flat()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function removeFileWithRetry(filePath: string, retries = 8) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await rm(filePath, { force: true })
      return
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code
      const isRetryable = errorCode === "EBUSY" || errorCode === "EPERM"

      if (!isRetryable) {
        throw error
      }

      if (attempt === retries - 1) {
        return
      }

      await delay(180 * (attempt + 1))
    }
  }
}

function collectReferencedSceneAssetPaths(scenes: StorySceneFile) {
  const references = new Set<string>()

  for (const scene of scenes.scenes) {
    for (const assetPath of [scene.day_img, scene.night_img]) {
      const normalizedSourcePath = normalizeTextAssetPath(assetPath)

      if (normalizedSourcePath) {
        references.add(normalizedSourcePath)
      }
    }
  }

  return references
}

function normalizeTextAssetPath(assetPath: string) {
  const trimmedPath = assetPath.trim()

  if (!trimmedPath) {
    return null
  }

  try {
    const normalizedPath = normalizeStoryAssetPath(trimmedPath)
    return normalizedPath.startsWith("assets/background/") ? normalizedPath : null
  } catch {
    return null
  }
}

function collectReferencedLocationAssetPaths(eventLocations: StoryEventLocationFile) {
  const references = new Set<string>()

  for (const assignment of eventLocations.assignments) {
    for (const assetPath of [
      assignment.img_raw,
      assignment.img_compress_1,
      assignment.img_compress_2
    ]) {
      const normalizedAssetPath = normalizeTextAssetPathForPrefix(
        assetPath,
        "assets/event_location/"
      )

      if (normalizedAssetPath) {
        references.add(normalizedAssetPath)
      }
    }
  }

  return references
}

function collectReferencedItemAssetPaths(items: StoryItemsFile) {
  const references = new Set<string>()

  for (const item of items.items) {
    for (const assetPath of [item.img_raw, item.img_compress_1, item.img_compress_2]) {
      const normalizedAssetPath = normalizeTextAssetPathForPrefix(assetPath, "assets/items/")

      if (normalizedAssetPath) {
        references.add(normalizedAssetPath)
      }
    }
  }

  return references
}

function collectReferencedRoleAssetPaths(roles: StoryRolesFile) {
  const references = new Set<string>()

  for (const role of roles.normal.roles) {
    for (const assetPath of [role.img_raw, role.img_compress_1, role.img_compress_2]) {
      const normalizedAssetPath = normalizeTextAssetPathForPrefix(assetPath, "assets/roles/")

      if (normalizedAssetPath) {
        references.add(normalizedAssetPath)
      }
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
      const normalizedAssetPath = normalizeTextAssetPathForPrefix(assetPath, "assets/roles/")

      if (normalizedAssetPath) {
        references.add(normalizedAssetPath)
      }
    }
  }

  return references
}

function normalizeTextAssetPathForPrefix(assetPath: string, expectedPrefix: string) {
  const trimmedPath = assetPath.trim()

  if (!trimmedPath) {
    return null
  }

  try {
    const normalizedPath = normalizeStoryAssetPath(trimmedPath)
    return normalizedPath.startsWith(expectedPrefix) ? normalizedPath : null
  } catch {
    return null
  }
}

async function pruneUnusedSceneBackgroundAssets(
  dataDir: string,
  storyId: string,
  scenes: StorySceneFile
) {
  const paths = createStoryPaths(dataDir, storyId)
  const referencedAssets = collectReferencedSceneAssetPaths(scenes)
  const existingFiles = await listFilesRecursively(paths.backgroundDir)

  await Promise.all(
    existingFiles.map(async (filePath) => {
      const relativePath = path.relative(paths.storyDir, filePath).replace(/\\/g, "/")

      if (!referencedAssets.has(relativePath)) {
        await removeFileWithRetry(filePath)
      }
    })
  )
}

async function pruneUnusedLocationAssets(
  dataDir: string,
  storyId: string,
  eventLocations: StoryEventLocationFile
) {
  const paths = createStoryPaths(dataDir, storyId)
  const referencedAssets = collectReferencedLocationAssetPaths(eventLocations)
  const existingFiles = await listFilesRecursively(paths.eventLocationAssetsDir)

  await Promise.all(
    existingFiles.map(async (filePath) => {
      const relativePath = path.relative(paths.storyDir, filePath).replace(/\\/g, "/")

      if (!referencedAssets.has(relativePath)) {
        await removeFileWithRetry(filePath)
      }
    })
  )
}

async function pruneUnusedItemAssets(
  dataDir: string,
  storyId: string,
  items: StoryItemsFile
) {
  const paths = createStoryPaths(dataDir, storyId)
  const referencedAssets = collectReferencedItemAssetPaths(items)
  const existingFiles = await listFilesRecursively(paths.itemAssetsDir)

  await Promise.all(
    existingFiles.map(async (filePath) => {
      const relativePath = path.relative(paths.storyDir, filePath).replace(/\\/g, "/")

      if (!referencedAssets.has(relativePath)) {
        await removeFileWithRetry(filePath)
      }
    })
  )
}

async function pruneUnusedRoleAssets(
  dataDir: string,
  storyId: string,
  roles: StoryRolesFile
) {
  const paths = createStoryPaths(dataDir, storyId)
  const referencedAssets = collectReferencedRoleAssetPaths(roles)
  const existingFiles = await listFilesRecursively(paths.roleAssetsDir)

  await Promise.all(
    existingFiles.map(async (filePath) => {
      const relativePath = path.relative(paths.storyDir, filePath).replace(/\\/g, "/")

      if (!referencedAssets.has(relativePath)) {
        await removeFileWithRetry(filePath)
      }
    })
  )
}

async function readOptionalJson5File<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJson5File<T>(filePath)
  } catch (error) {
    if (isFileStoreError(error) && error.code === "file-store.not-found") {
      return fallback
    }

    throw error
  }
}

async function readOptionalJson5FileFromPaths<T>(filePaths: string[], fallback: T): Promise<T> {
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

async function readStoryMeta(dataDir: string, storyId: string): Promise<StoryMetaFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const meta = await readJson5File<StoryMetaFile>(paths.metaFile)
  return storyMetaSchema.parse(meta)
}

async function readAppSettingsFile(dataDir: string): Promise<AppSettingsFile> {
  const paths = createAppPaths(dataDir)
  const settings = await readOptionalJson5File<AppSettingsFile>(
    paths.settingsFile,
    createDefaultAppSettings()
  )
  return appSettingsSchema.parse(settings)
}

async function readStoryBibleFile(dataDir: string, storyId: string): Promise<StoryBibleFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const storyBible = await readOptionalJson5File<StoryBibleFile>(
    paths.storyBibleFile,
    createDefaultStoryBible()
  )
  return storyBibleSchema.parse(storyBible)
}

async function readStoryVals(dataDir: string, storyId: string): Promise<StoryValsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const vals = await readOptionalJson5File<StoryValsFile>(paths.valsFile, {
    variables: []
  })
  return storyValsSchema.parse(vals)
}

async function readStoryPlayerOverrideVals(
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

async function readStorySystemVals(dataDir: string, storyId: string): Promise<StoryValsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const systemVals = await readOptionalJson5File<StoryValsFile>(paths.systemValsFile, {
    variables: []
  })
  return storyValsSchema.parse(systemVals)
}

async function readStoryScenes(dataDir: string, storyId: string): Promise<StorySceneFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const scenes = await readOptionalJson5File<StorySceneFile>(paths.sceneFile, {
    ai: {
      compress_quality: 60
    },
    scenes: []
  })
  return storySceneSchema.parse(scenes)
}

async function readStoryRoles(dataDir: string, storyId: string): Promise<StoryRolesFile> {
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

async function readStoryEventLocations(
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

async function readStoryItems(
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

async function readStoryShop(
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

async function readStoryInitialBags(
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

async function readStoryPhone(
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

async function readStoryRefer(
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

async function readStoryDoing(
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

async function readStoryGraphEvents(
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

async function readStoryOnceEvents(
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

async function readStoryLoopEvents(
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

async function ensureStoryExists(dataDir: string, storyId: string) {
  await readStoryMeta(dataDir, storyId)
}

function normalizeEventCollectionType(
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

export function createStoryFileStore(dataDir: string): StoryFileStore {
  async function readAppSettings(): Promise<AppSettingsFile> {
    return readAppSettingsFile(dataDir)
  }

  async function readStoryBible(storyId: string): Promise<StoryBibleFile> {
    return readStoryBibleFile(dataDir, storyId)
  }

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
    const refer = storyReferSchema.parse(createDefaultStoryRefer())
    const doing = storyDoingSchema.parse(createDefaultStoryDoing())
    const chainEvents = storyChainEventsSchema.parse([])
    const poolEvents = storyPoolEventsSchema.parse([])
    const scheduleEvents = storyScheduleEventsSchema.parse([])

    await Promise.all([
      mkdir(paths.eventsDir, { recursive: true }),
      mkdir(paths.assetsDir, { recursive: true })
    ])

    await Promise.all([
      writeJson5File(paths.metaFile, story),
      writeJson5File(paths.storyBibleFile, storyBible),
      writeJson5File(paths.valsFile, vals),
      writeJson5File(paths.playerOverrideValsFile, playerOverrideVals),
      writeJson5File(paths.systemValsFile, systemVals),
      writeJson5File(paths.sceneFile, scenes),
      writeJson5File(paths.normalRolesFile, normalRoles),
      writeJson5File(paths.importantRolesFile, importantRoles),
      writeJson5File(paths.eventLocationFile, eventLocations),
      writeJson5File(paths.itemsFile, items),
      writeJson5File(paths.shopFile, shop),
      writeJson5File(paths.initialBagsFile, initialBags),
      writeJson5File(paths.phoneFile, phone),
      writeJson5File(paths.referFile, refer),
      writeJson5File(paths.doingFile, doing),
      writeJson5File(paths.chainEventsFile, chainEvents),
      writeJson5File(paths.poolEventsFile, poolEvents),
      writeJson5File(paths.scheduleEventsFile, scheduleEvents)
    ])

    return readStoryDocument(story.id)
  }

  async function readStoryDocument(storyId: string): Promise<StoryDocument> {
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
      readStoryRefer(dataDir, storyId),
      readStoryDoing(dataDir, storyId),
      readStoryGraphEvents(dataDir, storyId),
      readStoryOnceEvents(dataDir, storyId),
      readStoryLoopEvents(dataDir, storyId)
      ])

    return {
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
      refer,
      doing,
      chainEvents,
      poolEvents,
      scheduleEvents,
      graphEvents: chainEvents,
      onceEvents: poolEvents,
      loopEvents: scheduleEvents
    }
  }

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

  async function writeAppSettings(settings: AppSettingsFile): Promise<AppSettingsFile> {
    const parsedSettings = appSettingsSchema.parse(settings)
    const paths = createAppPaths(dataDir)

    await writeJson5File(paths.settingsFile, parsedSettings satisfies AppSettingsFile)

    return parsedSettings
  }

  async function writeStoryBible(
    storyId: string,
    storyBible: StoryBibleFile
  ): Promise<StoryBibleFile> {
    await ensureStoryExists(dataDir, storyId)

    const parsedStoryBible = storyBibleSchema.parse(storyBible)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.storyBibleFile, parsedStoryBible satisfies StoryBibleFile)

    return parsedStoryBible
  }

  async function writeVals(storyId: string, vals: StoryValsFile): Promise<StoryValsFile> {
    const parsedVals = storyValsSchema.parse(vals)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.valsFile, parsedVals satisfies StoryValsFile)

    return parsedVals
  }

  async function writePlayerOverrideVals(
    storyId: string,
    playerOverrideVals: StoryPlayerOverrideValsFile
  ): Promise<StoryPlayerOverrideValsFile> {
    const parsedPlayerOverrideVals = storyPlayerOverrideValsSchema.parse(playerOverrideVals)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(
      paths.playerOverrideValsFile,
      parsedPlayerOverrideVals satisfies StoryPlayerOverrideValsFile
    )

    return parsedPlayerOverrideVals
  }

  async function writeSystemVals(storyId: string, systemVals: StoryValsFile): Promise<StoryValsFile> {
    const parsedSystemVals = storyValsSchema.parse(systemVals)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.systemValsFile, parsedSystemVals satisfies StoryValsFile)

    return parsedSystemVals
  }

  async function writeRoles(storyId: string, roles: StoryRolesFile): Promise<StoryRolesFile> {
    const parsedRoles = storyRolesSchema.parse(roles)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(
      paths.normalRolesFile,
      parsedRoles.normal satisfies StoryNormalRolesDataFile
    )
    await writeJson5File(
      paths.importantRolesFile,
      parsedRoles.important satisfies StoryImportantRolesDataFile
    )
    await rm(paths.rolesLegacyFile, { force: true })
    await rm(path.join(paths.storyDir, "roles_setting.json5"), { force: true })
    await pruneUnusedRoleAssets(dataDir, storyId, parsedRoles)

    return parsedRoles
  }

  async function writeEventLocations(
    storyId: string,
    eventLocations: StoryEventLocationFile
  ): Promise<StoryEventLocationFile> {
    const parsedEventLocations = storyEventLocationSchema.parse(eventLocations)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(
      paths.eventLocationFile,
      parsedEventLocations satisfies StoryEventLocationFile
    )
    await pruneUnusedLocationAssets(dataDir, storyId, parsedEventLocations)

    return parsedEventLocations
  }

  async function writeItems(storyId: string, items: StoryItemsFile): Promise<StoryItemsFile> {
    const parsedItems = storyItemsSchema.parse(items)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.itemsFile, parsedItems satisfies StoryItemsFile)
    await pruneUnusedItemAssets(dataDir, storyId, parsedItems)

    return parsedItems
  }

  async function writeShop(storyId: string, shop: StoryShopFile): Promise<StoryShopFile> {
    const parsedShop = storyShopSchema.parse(shop)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.shopFile, parsedShop satisfies StoryShopFile)

    return parsedShop
  }

  async function writeInitialBags(
    storyId: string,
    initialBags: StoryInitialBagsFile
  ): Promise<StoryInitialBagsFile> {
    const parsedInitialBags = storyInitialBagsSchema.parse(initialBags)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.initialBagsFile, parsedInitialBags satisfies StoryInitialBagsFile)

    return parsedInitialBags
  }

  async function writePhone(
    storyId: string,
    phone: StoryPhoneFile
  ): Promise<StoryPhoneFile> {
    const parsedPhone = storyPhoneSchema.parse(phone)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.phoneFile, parsedPhone satisfies StoryPhoneFile)

    return parsedPhone
  }

  async function writeRefer(
    storyId: string,
    refer: StoryReferFile
  ): Promise<StoryReferFile> {
    const parsedRefer = storyReferSchema.parse(refer)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.referFile, parsedRefer satisfies StoryReferFile)

    return parsedRefer
  }

  async function writeDoing(
    storyId: string,
    doing: StoryDoingFile
  ): Promise<StoryDoingFile> {
    const parsedDoing = storyDoingSchema.parse(doing)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.doingFile, parsedDoing satisfies StoryDoingFile)

    return parsedDoing
  }

  async function writeScenes(storyId: string, scenes: StorySceneFile): Promise<StorySceneFile> {
    const parsedScenes = storySceneSchema.parse(scenes)
    const paths = createStoryPaths(dataDir, storyId)

    await writeJson5File(paths.sceneFile, parsedScenes satisfies StorySceneFile)
    await pruneUnusedSceneBackgroundAssets(dataDir, storyId, parsedScenes)

    return parsedScenes
  }

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

  function resolveAssetPathForStory(storyId: string, assetPath: string) {
    return resolveStoryAssetPath(dataDir, storyId, assetPath).resolvedPath
  }

  async function readStoryAssetMeta(storyId: string, assetPath: string): Promise<StoryAssetMetadata> {
    await ensureStoryExists(dataDir, storyId)
    return createStoryAssetMetadata(dataDir, storyId, assetPath)
  }

  return {
    readAppSettings,
    listStorySummaries,
    createStory,
    readStoryDocument,
    readStoryBible,
    readEvent,
    writeAppSettings,
    writeStoryBible,
    writeEvent,
    deleteEvent,
    writeRoles,
    writeEventLocations,
    writeItems,
    writeShop,
    writeInitialBags,
    writePhone,
    writeRefer,
    writeDoing,
    writeVals,
    writePlayerOverrideVals,
    writeSystemVals,
    writeScenes,
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
