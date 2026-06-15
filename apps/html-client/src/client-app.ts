import { existsSync } from "node:fs"
import type { Dirent } from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { compileStory } from "@story-mgr/compiler"
import { createStoryFileStore } from "@story-mgr/file-store"
import JSON5 from "json5"
import {
  createStorySession,
  type RuntimePlayerProfileSetup,
  type RuntimeProfileCustomFile,
  type RuntimeStoryBundle,
  type RuntimeStorySaveState,
  type RuntimeStorySession,
  type RuntimeStorySessionAction,
  type RuntimeStoryViewModel
} from "@story-mgr/runtime"
import type { StoryPlayerOverrideValEntry } from "@story-mgr/core"
import type {
  StoryPlayerOverrideInputOption,
  StoryPlayerOverrideInputType
} from "@story-mgr/core"

export type HtmlClientStage =
  | "boot"
  | "sync-story-bundle"
  | "select-or-create-profile"
  | "load-profile-custom"
  | "select-save-or-new-game"
  | "create-session"
  | "enter-game"

export interface HtmlClientPaths {
  dataDir: string
  runtimeDir: string
  storyDir: string
  bundleFile: string
  profilesDir: string
}

export interface HtmlProfileSummary {
  profileId: string
  profileName: string
  createdAt: string
  filePath: string
  customValueCount: number
  playerSetup: RuntimePlayerProfileSetup | null
  locationLabel: string | null
}

export interface HtmlSaveSlotSummary {
  slotId: string
  savedAt: string
  filePath: string
  activeEventId: string | null
}

export interface HtmlClientAppState {
  stage: HtmlClientStage
  storyId: string
  paths: HtmlClientPaths
  bundle: RuntimeStoryBundle | null
  profiles: HtmlProfileSummary[]
  profile: RuntimeProfileCustomFile | null
  saveSlots: HtmlSaveSlotSummary[]
  session: RuntimeStorySession | null
  view: RuntimeStoryViewModel | null
  notifications: string[]
}

export interface CreateHtmlProfileInput {
  profileId?: string
  profileName: string
  playerSetup?: RuntimePlayerProfileSetup
  customValues?: Record<string, unknown>
}

export interface HtmlPlayerOverridePrompt {
  varKey: string
  label: string
  tips: string
  required: boolean
  groupNo: number
  inputType: StoryPlayerOverrideInputType
  options: StoryPlayerOverrideInputOption[]
}

export interface CreateHtmlClientAppOptions {
  storyId: string
  dataDir?: string
  runtimeDir?: string
  now?: Date
  profileId?: string
  slotId?: string
  autoStartNewGame?: boolean
}

export interface HtmlClientApp {
  getState(): HtmlClientAppState
  bootstrap(): Promise<HtmlClientAppState>
  syncStoryBundle(): Promise<RuntimeStoryBundle>
  listProfiles(): Promise<HtmlProfileSummary[]>
  listPlayerOverridePrompts(): Promise<HtmlPlayerOverridePrompt[]>
  createProfile(input: CreateHtmlProfileInput): Promise<RuntimeProfileCustomFile>
  selectProfile(profileId: string): Promise<RuntimeProfileCustomFile>
  listSaveSlots(): Promise<HtmlSaveSlotSummary[]>
  startNewGame(): Promise<RuntimeStorySession>
  loadSave(slotId: string): Promise<RuntimeStorySession>
  saveToSlot(slotId: string): Promise<RuntimeStorySaveState>
  dispatch(action: RuntimeStorySessionAction): void
  tick(deltaMs: number): void
  setTimePause(paused: boolean): void
  setTimeSpeed(speed: number): void
}

class HtmlClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HtmlClientError"
  }
}

const PLAYER_NAME_TOKENS = [
  "player.name",
  "system.player_name",
  "system.role_name",
  "system.player_display_name"
] as const

const PLAYER_SURNAME_TOKENS = [
  "player.name_xing",
  "system.player_surname"
] as const

const PLAYER_GIVEN_NAME_TOKENS = [
  "player.name_ming",
  "system.player_given_name"
] as const

const COUNTY_NAME_TOKENS = [
  "county.name_full",
  "system.county_name",
  "system.county_full_name"
] as const

const COUNTY_SHORT_NAME_TOKENS = [
  "county.name_short",
  "system.county_short_name"
] as const

const CITY_NAME_TOKENS = [
  "county.parent_city",
  "system.city_name",
  "system.parent_city"
] as const

const PROVINCE_NAME_TOKENS = [
  "county.province",
  "system.province_name"
] as const

// 从当前目录向上寻找工作区根目录，避免在子包里启动时找错 data 目录。
function findWorkspaceRoot(startDirectory: string) {
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

// 统一解析 HTML 客户端的本地运行目录结构。
function resolveHtmlPaths(storyId: string, dataDir?: string, runtimeDir?: string): HtmlClientPaths {
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

function resolveProfilePaths(paths: HtmlClientPaths, profileId: string) {
  const profileDir = path.join(paths.profilesDir, profileId)

  return {
    profileDir,
    customFile: path.join(profileDir, "custom.json5"),
    savesDir: path.join(profileDir, "saves")
  }
}

function resolveSaveFile(paths: HtmlClientPaths, profileId: string, slotId: string) {
  return path.join(resolveProfilePaths(paths, profileId).savesDir, `${slotId}.json5`)
}

function createNowFactory(fixedNow?: Date) {
  return () => (fixedNow ? new Date(fixedNow) : new Date())
}

// 本地标识只保留安全字符，方便直接映射为目录名与文件名。
function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function createProfileId(input: CreateHtmlProfileInput) {
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

function deriveCountyShortName(countyName: string) {
  const trimmedCountyName = countyName.trim()
  return Array.from(trimmedCountyName)[0] ?? ""
}

function clonePlayerSetup(playerSetup: RuntimePlayerProfileSetup): RuntimePlayerProfileSetup {
  return {
    player_surname: playerSetup.player_surname ?? "",
    player_given_name: playerSetup.player_given_name ?? "",
    player_name: playerSetup.player_name ?? "",
    county_name: playerSetup.county_name,
    county_short_name: playerSetup.county_short_name,
    city_name: playerSetup.city_name,
    province_name: playerSetup.province_name
  }
}

function getRecordStringValue(source: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return ""
}

function getCustomStringValue(source: Record<string, unknown>, key: string) {
  const value = source[key]
  return typeof value === "string" ? value.trim() : ""
}

function findPlayerOverrideEntry(
  bundle: RuntimeStoryBundle,
  token: string
): StoryPlayerOverrideValEntry | null {
  return bundle.playerOverrideVals.entries.find(
    (entry: StoryPlayerOverrideValEntry) => entry.var_key.trim() === token.trim()
  ) ?? null
}

function findBundleVarLabel(bundle: RuntimeStoryBundle, token: string) {
  const [groupName, rowName] = token.split(".")

  if (!groupName || !rowName) {
    return token
  }

  const matchedGroup = bundle.vals.variables.find((group) => group.name.trim() === groupName.trim())
  const matchedRow = matchedGroup?.vals.find((row) => row.name.trim() === rowName.trim())
  const rowDescription = matchedRow?.description?.trim() ?? ""

  return rowDescription ? `${token} - ${rowDescription}` : token
}

function buildLocationLabel(playerSetup: RuntimePlayerProfileSetup | null) {
  if (!playerSetup) {
    return null
  }

  const locationParts = [
    playerSetup.province_name.trim(),
    playerSetup.city_name.trim(),
    playerSetup.county_name.trim()
  ].filter(Boolean)

  return locationParts.length > 0 ? locationParts.join("/") : null
}

function buildPlayerDisplayName(playerSetup: Pick<RuntimePlayerProfileSetup, "player_surname" | "player_given_name" | "player_name">) {
  const playerSurname = typeof playerSetup.player_surname === "string"
    ? playerSetup.player_surname.trim()
    : ""
  const playerGivenName = typeof playerSetup.player_given_name === "string"
    ? playerSetup.player_given_name.trim()
    : ""
  const playerName = typeof playerSetup.player_name === "string"
    ? playerSetup.player_name.trim()
    : ""
  const fullName = `${playerSurname}${playerGivenName}`

  return fullName || playerName
}

function normalizePlayerSetup(profile: RuntimeProfileCustomFile) {
  if (profile.player_setup) {
    const normalizedPlayerSetup = clonePlayerSetup(profile.player_setup)
    const playerName = buildPlayerDisplayName(normalizedPlayerSetup)

    return {
      ...normalizedPlayerSetup,
      player_name: playerName
    }
  }

  const explicitPlayerName = getRecordStringValue(profile.custom_values, PLAYER_NAME_TOKENS)
  const explicitPlayerSurname = getRecordStringValue(profile.custom_values, PLAYER_SURNAME_TOKENS)
  const explicitPlayerGivenName = getRecordStringValue(profile.custom_values, PLAYER_GIVEN_NAME_TOKENS)
  const countyName = getRecordStringValue(profile.custom_values, COUNTY_NAME_TOKENS)
  const countyShortName =
    getRecordStringValue(profile.custom_values, COUNTY_SHORT_NAME_TOKENS)
    || deriveCountyShortName(countyName)
  const cityName = getRecordStringValue(profile.custom_values, CITY_NAME_TOKENS)
  const provinceName = getRecordStringValue(profile.custom_values, PROVINCE_NAME_TOKENS)
  const hasStructuredValue = Boolean(
    explicitPlayerName || countyName || countyShortName || cityName || provinceName
  )

  if (!hasStructuredValue) {
    return null
  }

  const playerName = `${explicitPlayerSurname}${explicitPlayerGivenName}` || explicitPlayerName || profile.profile_name

  return {
    player_surname: explicitPlayerSurname,
    player_given_name: explicitPlayerGivenName,
    player_name: playerName,
    county_name: countyName,
    county_short_name: countyShortName,
    city_name: cityName,
    province_name: provinceName
  } satisfies RuntimePlayerProfileSetup
}

function buildPlayerSetupFromCustomValues(customValues: Record<string, unknown>) {
  const explicitPlayerName = getRecordStringValue(customValues, PLAYER_NAME_TOKENS)
  const explicitPlayerSurname = getRecordStringValue(customValues, PLAYER_SURNAME_TOKENS)
  const explicitPlayerGivenName = getRecordStringValue(customValues, PLAYER_GIVEN_NAME_TOKENS)
  const countyName = getRecordStringValue(customValues, COUNTY_NAME_TOKENS)
  const countyShortName =
    getRecordStringValue(customValues, COUNTY_SHORT_NAME_TOKENS)
    || deriveCountyShortName(countyName)
  const cityName = getRecordStringValue(customValues, CITY_NAME_TOKENS)
  const provinceName = getRecordStringValue(customValues, PROVINCE_NAME_TOKENS)
  const hasStructuredValue = Boolean(
    explicitPlayerName || countyName || countyShortName || cityName || provinceName
  )

  if (!hasStructuredValue) {
    return null
  }

  const playerName = `${explicitPlayerSurname}${explicitPlayerGivenName}` || explicitPlayerName

  return {
    player_surname: explicitPlayerSurname,
    player_given_name: explicitPlayerGivenName,
    player_name: playerName,
    county_name: countyName,
    county_short_name: countyShortName,
    city_name: cityName,
    province_name: provinceName
  } satisfies RuntimePlayerProfileSetup
}

async function ensureDirectory(directory: string) {
  await mkdir(directory, { recursive: true })
}

async function readJson5File<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8")
  return JSON5.parse(raw) as T
}

async function readOptionalJson5File<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson5File<T>(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }

    throw error
  }
}

async function writeJson5File(filePath: string, value: unknown) {
  await ensureDirectory(path.dirname(filePath))
  await writeFile(filePath, `${JSON5.stringify(value, null, 2)}\n`, "utf8")
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureDirectory(path.dirname(filePath))
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8")
  return JSON.parse(raw) as T
}

async function readDirectoryNames(directory: string) {
  try {
    const entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" })
    return entries
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

function collectBundleVariableTokens(bundle: RuntimeStoryBundle) {
  const tokens = new Set<string>()

  for (const valsFile of [bundle.vals, bundle.systemVals]) {
    for (const group of valsFile.variables) {
      const groupName = group.name.trim()

      for (const row of group.vals) {
        const rowName = row.name.trim()
        if (groupName && rowName) {
          tokens.add(`${groupName}.${rowName}`)
        }
      }
    }
  }

  return tokens
}

function buildProfileNameFromCustomValues(
  bundle: RuntimeStoryBundle,
  customValues: Record<string, unknown>
) {
  const playerSetup = buildPlayerSetupFromCustomValues(customValues)
  if (playerSetup) {
    const displayName = buildPlayerDisplayName(playerSetup)
    if (displayName) {
      return displayName
    }
  }

  for (const entry of bundle.playerOverrideVals.entries) {
    const value = getCustomStringValue(customValues, entry.var_key)
    if (value) {
      return value
    }
  }

  return ""
}

function normalizePlayerOverrideInputType(value: unknown): StoryPlayerOverrideInputType {
  return value === "select" ? "select" : "text"
}

function normalizePlayerOverrideInputOptions(
  value: unknown
): StoryPlayerOverrideInputOption[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((option) => {
      if (!option || typeof option !== "object") {
        return null
      }

      const record = option as Record<string, unknown>
      const optionValue = typeof record.value === "string" ? record.value.trim() : ""
      const optionLabel = typeof record.label === "string" ? record.label.trim() : ""

      if (!optionValue) {
        return null
      }

      return {
        label: optionLabel || optionValue,
        value: optionValue
      }
    })
    .filter((option): option is StoryPlayerOverrideInputOption => option !== null)
}

export function buildHtmlPlayerOverridePrompts(bundle: RuntimeStoryBundle): HtmlPlayerOverridePrompt[] {
  return bundle.playerOverrideVals.entries
    .filter((entry: StoryPlayerOverrideValEntry) => entry.need_player_override)
    .map((entry: StoryPlayerOverrideValEntry) => {
      const normalizedVarKey = entry.var_key.trim()
      const matchedEntry = findPlayerOverrideEntry(bundle, normalizedVarKey)
      const inputType = normalizePlayerOverrideInputType(matchedEntry?.input_type ?? entry.input_type)
      return {
        varKey: normalizedVarKey,
        label: findBundleVarLabel(bundle, normalizedVarKey),
        tips: (matchedEntry?.tips ?? entry.tips).trim(),
        required: normalizedVarKey !== "county.name_short",
        groupNo: Number.isInteger(entry.group_no) && entry.group_no >= 1 ? entry.group_no : 1,
        inputType,
        options: inputType === "select"
          ? normalizePlayerOverrideInputOptions(matchedEntry?.input_options ?? entry.input_options)
          : []
      }
    })
}

function applyCustomTokenValues(
  customValues: Record<string, unknown>,
  tokens: Set<string>,
  candidates: readonly string[],
  value: string
) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return
  }

  for (const candidate of candidates) {
    if (tokens.has(candidate)) {
      customValues[candidate] = trimmedValue
    }
  }
}

// 建角向导的字段会先映射成标准 custom_values，再由运行时叠加到 bundle 上。
function buildPlayerCustomValues(
  bundle: RuntimeStoryBundle,
  playerSetup: RuntimePlayerProfileSetup
) {
  const customValues: Record<string, unknown> = {}
  const tokens = collectBundleVariableTokens(bundle)
  const playerDisplayName = buildPlayerDisplayName(playerSetup)

  applyCustomTokenValues(customValues, tokens, PLAYER_NAME_TOKENS, playerDisplayName)
  applyCustomTokenValues(customValues, tokens, PLAYER_SURNAME_TOKENS, playerSetup.player_surname)
  applyCustomTokenValues(customValues, tokens, PLAYER_GIVEN_NAME_TOKENS, playerSetup.player_given_name)
  applyCustomTokenValues(customValues, tokens, COUNTY_NAME_TOKENS, playerSetup.county_name)
  applyCustomTokenValues(customValues, tokens, COUNTY_SHORT_NAME_TOKENS, playerSetup.county_short_name)
  applyCustomTokenValues(customValues, tokens, CITY_NAME_TOKENS, playerSetup.city_name)
  applyCustomTokenValues(customValues, tokens, PROVINCE_NAME_TOKENS, playerSetup.province_name)

  return customValues
}

function assertBundle(bundle: RuntimeStoryBundle | null): RuntimeStoryBundle {
  if (!bundle) {
    throw new HtmlClientError("The story bundle has not been synced yet.")
  }

  return bundle
}

function assertProfile(profile: RuntimeProfileCustomFile | null): RuntimeProfileCustomFile {
  if (!profile) {
    throw new HtmlClientError("No profile is selected.")
  }

  return profile
}

function assertSession(session: RuntimeStorySession | null): RuntimeStorySession {
  if (!session) {
    throw new HtmlClientError("No runtime session is active.")
  }

  return session
}

function cloneState(state: HtmlClientAppState): HtmlClientAppState {
  return {
    ...state,
    profiles: [...state.profiles],
    saveSlots: [...state.saveSlots],
    notifications: [...state.notifications]
  }
}

export function createHtmlClientApp(options: CreateHtmlClientAppOptions): HtmlClientApp {
  const paths = resolveHtmlPaths(options.storyId, options.dataDir, options.runtimeDir)
  const getNow = createNowFactory(options.now)
  const state: HtmlClientAppState = {
    stage: "boot",
    storyId: options.storyId,
    paths,
    bundle: null,
    profiles: [],
    profile: null,
    saveSlots: [],
    session: null,
    view: null,
    notifications: []
  }

  function transition(stage: HtmlClientStage) {
    state.stage = stage
  }

  function pushNotification(message: string) {
    state.notifications.push(message)
  }

  // bundle 只在首次需要时读取，后续都复用内存中的结果。
  async function ensureBundleLoaded() {
    if (state.bundle) {
      return state.bundle
    }

    const bundle = await readJsonFile<RuntimeStoryBundle>(paths.bundleFile)
    state.bundle = bundle
    return bundle
  }

  async function loadProfilesFromDisk() {
    await ensureDirectory(paths.profilesDir)
    const profileIds = await readDirectoryNames(paths.profilesDir)
    const profiles = await Promise.all(
      profileIds.map(async (profileId) => {
        const profilePaths = resolveProfilePaths(paths, profileId)
        const profile = await readOptionalJson5File<RuntimeProfileCustomFile>(profilePaths.customFile)

        if (!profile) {
          return null
        }

        const playerSetup = normalizePlayerSetup(profile)

        return {
          profileId: profile.profile_id,
          profileName: profile.profile_name,
          createdAt: profile.created_at,
          filePath: profilePaths.customFile,
          customValueCount: Object.keys(profile.custom_values).length,
          playerSetup,
          locationLabel: buildLocationLabel(playerSetup)
        } satisfies HtmlProfileSummary
      })
    )

    state.profiles = profiles.filter((profile): profile is NonNullable<typeof profile> => profile !== null)
    return state.profiles
  }

  // 存档列表按时间倒序，方便继续游戏时优先看到最近一次保存。
  async function loadSaveSlotsFromDisk(profileId: string) {
    const profilePaths = resolveProfilePaths(paths, profileId)
    await ensureDirectory(profilePaths.savesDir)

    let entries: Array<Dirent<string>> = []

    try {
      entries = await readdir(profilePaths.savesDir, {
        withFileTypes: true,
        encoding: "utf8"
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        entries = []
      } else {
        throw error
      }
    }

    const saveSlots = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json5"))
        .map(async (entry) => {
          const filePath = path.join(profilePaths.savesDir, entry.name)
          const saveState = await readJson5File<RuntimeStorySaveState>(filePath)

          return {
            slotId: saveState.slot_id,
            savedAt: saveState.saved_at,
            filePath,
            activeEventId: saveState.session_state.current_event_id
          } satisfies HtmlSaveSlotSummary
        })
    )

    saveSlots.sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    state.saveSlots = saveSlots
    return saveSlots
  }

  // 会话统一从这里创建，确保 bundle、custom、save 三层覆盖顺序固定。
  async function createSessionFromSelection(saveState?: RuntimeStorySaveState | null) {
    const bundle = await ensureBundleLoaded()
    const profile = assertProfile(state.profile)

    transition("create-session")
    state.session = createStorySession({
      bundle,
      customOverrides: profile,
      saveState: saveState ?? null,
      now: getNow()
    })
    state.view = state.session.getViewModel()
    transition("enter-game")

    pushNotification(
      saveState
        ? `已从存档 "${saveState.slot_id}" 恢复运行时会话。`
        : `已为角色 "${profile.profile_name}" 启动运行时会话。`
    )

    return state.session
  }

  return {
    getState() {
      return cloneState(state)
    },
    async bootstrap() {
      transition("sync-story-bundle")
      await this.syncStoryBundle()

      transition("select-or-create-profile")
      await this.listProfiles()

      if (options.profileId) {
        await this.selectProfile(options.profileId)

        if (options.slotId) {
          await this.loadSave(options.slotId)
        } else if (options.autoStartNewGame) {
          await this.startNewGame()
        }
      }

      return this.getState()
    },
    async syncStoryBundle() {
      // HTML 客户端不直接消费原始编辑器文件，而是先编译成运行时 bundle。
      const store = createStoryFileStore(paths.dataDir)
      const document = await store.readStoryDocument(options.storyId)
      const { compiled, result } = compileStory(document)
      const bundle: RuntimeStoryBundle = compiled

      await writeJsonFile(paths.bundleFile, bundle)
      state.bundle = bundle

      pushNotification(`故事 bundle 已同步到 ${paths.bundleFile}。`)

      if (!result.ok) {
        pushNotification(`Bundle 编译完成，但有 ${result.issues.length} 个校验问题。`)
      }

      return bundle
    },
    async listProfiles() {
      const profiles = await loadProfilesFromDisk()
      pushNotification(`Found ${profiles.length} local profiles.`)
      return profiles
    },
    async listPlayerOverridePrompts() {
      const bundle = await ensureBundleLoaded()
      return buildHtmlPlayerOverridePrompts(bundle)
    },
    async createProfile(input) {
      const profileId = createProfileId(input)
      const profilePaths = resolveProfilePaths(paths, profileId)
      const existingProfile = await readOptionalJson5File<RuntimeProfileCustomFile>(profilePaths.customFile)

      if (existingProfile) {
        throw new HtmlClientError(`Profile "${profileId}" already exists.`)
      }

      const bundle = await ensureBundleLoaded()
      const normalizedInputCustomValues = {
        ...(input.customValues ?? {})
      }
      const inferredPlayerSetup = input.playerSetup ?? buildPlayerSetupFromCustomValues(normalizedInputCustomValues)
      const profileName =
        input.profileName.trim()
        || buildProfileNameFromCustomValues(bundle, normalizedInputCustomValues)
        || buildPlayerDisplayName(inferredPlayerSetup ?? {
          player_surname: "",
          player_given_name: "",
          player_name: "",
          county_name: "",
          county_short_name: "",
          city_name: "",
          province_name: ""
        })
        || profileId

      const playerSetup = inferredPlayerSetup
        ? {
            ...clonePlayerSetup(inferredPlayerSetup),
            player_name: buildPlayerDisplayName(inferredPlayerSetup)
          }
        : undefined
      const customValues = {
        ...(playerSetup ? buildPlayerCustomValues(bundle, playerSetup) : {}),
        ...normalizedInputCustomValues
      }

      const nextProfile: RuntimeProfileCustomFile = {
        profile_id: profileId,
        story_id: options.storyId,
        profile_name: profileName,
        created_at: getNow().toISOString(),
        custom_values: customValues,
        ...(playerSetup ? { player_setup: playerSetup } : {})
      }

      await writeJson5File(profilePaths.customFile, nextProfile)
      await loadProfilesFromDisk()
      state.profile = nextProfile
      transition("select-save-or-new-game")

      pushNotification(`Created profile: ${nextProfile.profile_name}`)

      await loadSaveSlotsFromDisk(nextProfile.profile_id)

      return nextProfile
    },
    async selectProfile(profileId) {
      transition("load-profile-custom")
      const profilePaths = resolveProfilePaths(paths, profileId)
      const profile = await readOptionalJson5File<RuntimeProfileCustomFile>(profilePaths.customFile)

      if (!profile) {
        throw new HtmlClientError(`Profile "${profileId}" was not found.`)
      }

      state.profile = profile
      await loadSaveSlotsFromDisk(profile.profile_id)
      transition("select-save-or-new-game")

      pushNotification(`已载入角色档：${profile.profile_name}`)

      return profile
    },
    async listSaveSlots() {
      const profile = assertProfile(state.profile)
      const saveSlots = await loadSaveSlotsFromDisk(profile.profile_id)
      pushNotification(`角色 "${profile.profile_name}" 共有 ${saveSlots.length} 个存档。`)
      return saveSlots
    },
    async startNewGame() {
      return createSessionFromSelection()
    },
    async loadSave(slotId) {
      const profile = assertProfile(state.profile)
      const saveFile = resolveSaveFile(paths, profile.profile_id, slotId)
      const saveState = await readOptionalJson5File<RuntimeStorySaveState>(saveFile)

      if (!saveState) {
        throw new HtmlClientError(`Save slot "${slotId}" was not found.`)
      }

      return createSessionFromSelection(saveState)
    },
    async saveToSlot(slotId) {
      const profile = assertProfile(state.profile)
      const session = assertSession(state.session)
      const bundle = await ensureBundleLoaded()
      // 存档记录 bundle 版本，后面做兼容或迁移时可以据此判断。
      const normalizedSlotId = sanitizeSegment(slotId) || "slot-1"
      const saveState: RuntimeStorySaveState = {
        slot_id: normalizedSlotId,
        story_id: options.storyId,
        profile_id: profile.profile_id,
        bundle_version: bundle.generatedAt,
        saved_at: getNow().toISOString(),
        session_state: session.getSnapshot()
      }

      await writeJson5File(
        resolveSaveFile(paths, profile.profile_id, normalizedSlotId),
        saveState
      )
      await loadSaveSlotsFromDisk(profile.profile_id)

      pushNotification(`已保存运行时会话到存档：${normalizedSlotId}`)

      return saveState
    },
    dispatch(action) {
      const session = assertSession(state.session)
      session.dispatch(action)
      // 每次动作派发后立即刷新视图模型，保持 UI 壳层尽量薄。
      state.view = session.getViewModel()
    },
    tick(deltaMs) {
      const session = assertSession(state.session)
      session.tick(deltaMs)
      state.view = session.getViewModel()
    },
    setTimePause(paused) {
      const session = assertSession(state.session)
      session.setTimePause(paused)
      state.view = session.getViewModel()
    },
    setTimeSpeed(speed) {
      const session = assertSession(state.session)
      session.setTimeSpeed(speed)
      state.view = session.getViewModel()
    }
  }
}

