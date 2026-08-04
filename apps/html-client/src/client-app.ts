import { existsSync } from "node:fs"
import type { Dirent } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { compileStory } from "@story-mgr/compiler"
import { createStoryFileStore } from "@story-mgr/file-store"
import {
  createStorySession,
  type RuntimeProfileCustomFile,
  type RuntimeStoryBundle,
  type RuntimeStorySaveState,
  type RuntimeStorySession,
  type RuntimeStorySessionAction,
  type RuntimeStoryViewModel
} from "@story-mgr/runtime"

import type {
  HtmlClientStage,
  HtmlClientPaths,
  HtmlProfileSummary,
  HtmlSaveSlotSummary,
  HtmlClientAppState,
  CreateHtmlProfileInput,
  HtmlPlayerOverridePrompt,
  CreateHtmlClientAppOptions,
  HtmlClientApp
} from "./client-contracts"
export type {
  HtmlClientStage,
  HtmlClientPaths,
  HtmlProfileSummary,
  HtmlSaveSlotSummary,
  HtmlClientAppState,
  CreateHtmlProfileInput,
  HtmlPlayerOverridePrompt,
  CreateHtmlClientAppOptions,
  HtmlClientApp
} from "./client-contracts"
import {
  buildPlayerDisplayName,
  createNowFactory,
  createProfileId,
  resolveHtmlPaths,
  resolveProfilePaths,
  resolveSaveFile,
  sanitizeSegment
} from "./client-paths"
import {
  buildHtmlPlayerOverridePrompts,
  buildLocationLabel,
  buildPlayerCustomValues,
  buildPlayerSetupFromCustomValues,
  buildProfileNameFromCustomValues,
  clonePlayerSetup,
  normalizePlayerSetup
} from "./client-profile"
import {
  ensureDirectory,
  readDirectoryNames,
  readJson5File,
  readJsonFile,
  readOptionalJson5File,
  writeJson5File,
  writeJsonFile
} from "./client-storage"

export { buildHtmlPlayerOverridePrompts } from "./client-profile"

class HtmlClientError extends Error {
  /** @param message 面向调用方的客户端流程错误说明。 @returns 带固定错误名的 Error 实例。 */
  constructor(message: string) {
    super(message)
    this.name = "HtmlClientError"
  }
}

/** @param bundle 可能尚未加载的 bundle。 @returns 已确认存在的 bundle。 @throws 尚未同步故事时抛出客户端错误。 */
function assertBundle(bundle: RuntimeStoryBundle | null): RuntimeStoryBundle {
  if (!bundle) {
    throw new HtmlClientError("The story bundle has not been synced yet.")
  }

  return bundle
}

/** @param profile 当前选择档案。 @returns 已确认存在的档案。 @throws 尚未选择档案时抛错。 */
function assertProfile(profile: RuntimeProfileCustomFile | null): RuntimeProfileCustomFile {
  if (!profile) {
    throw new HtmlClientError("No profile is selected.")
  }

  return profile
}

/** @param session 当前 Runtime Session。 @returns 已确认存在的会话。 @throws 尚未开始或加载游戏时抛错。 */
function assertSession(session: RuntimeStorySession | null): RuntimeStorySession {
  if (!session) {
    throw new HtmlClientError("No runtime session is active.")
  }

  return session
}

/** @param state 应用内部状态。 @returns 顶层及列表字段复制后的状态，防止外部直接 push/pop 内部数组。 */
function cloneState(state: HtmlClientAppState): HtmlClientAppState {
  return {
    ...state,
    profiles: [...state.profiles],
    saveSlots: [...state.saveSlots],
    notifications: [...state.notifications]
  }
}

/**
 * 创建一个故事专用的 HTML 客户端应用门面。
 * @param options 故事 id、数据/运行目录、固定时间以及可选自动载入档案和存档。
 * @returns 管理 bundle、档案、存档和 Runtime Session 的异步应用对象；创建时本身不读磁盘。
 */
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

  /** @param stage 新启动阶段。 @returns 无返回值；同步更新内部状态，供浏览器显示进度。 */
  function transition(stage: HtmlClientStage): void {
    state.stage = stage
  }

  /** @param message 要展示的提示文本。 @returns 无返回值；按发生顺序追加到通知列表。 */
  function pushNotification(message: string): void {
    state.notifications.push(message)
  }

  /**
   * 确保运行时 bundle 已载入内存。
   * @returns 已缓存或从 bundle.json 读取的 bundle。 @throws 文件缺失或 JSON 损坏时抛错。
   * 首次读取后复用同一对象，避免每个档案操作重复访问磁盘。
   */
  async function ensureBundleLoaded() {
    if (state.bundle) {
      return state.bundle
    }

    const bundle = await readJsonFile<RuntimeStoryBundle>(paths.bundleFile)
    state.bundle = bundle
    return bundle
  }

  /**
   * 扫描当前故事的全部本地档案。
   * @returns 已按目录名稳定排序的档案摘要，同时替换 state.profiles。
   * 缺少 custom.json5 的残留目录会被跳过，旧档案通过 normalizePlayerSetup 兼容转换。
   */
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

  /**
   * 读取一个档案下的所有存档摘要。
   * @param profileId 档案 id。 @returns 按 saved_at 从新到旧排序的存档列表，并写入 state.saveSlots。
   */
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

  /**
   * 使用当前档案创建新会话或恢复存档。
   * @param saveState 可选存档；省略表示新游戏。 @returns 已进入游戏阶段的 Runtime Session。
   * 所有入口都走这里，确保 bundle → 档案覆盖 → 存档恢复的优先级一致。
   */
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
    /** @returns 当前应用状态的安全浅拷贝；列表字段不会与内部数组共享引用。 */
    getState() {
      return cloneState(state)
    },
    /**
     * 执行客户端启动流程。
     * @returns 同步 bundle、加载档案，并按 options 可选自动选择/载入后的应用状态。
     */
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
    /**
     * 从编辑器源文件重新编译并写入 HTML 客户端 bundle。
     * @returns 新编译的 RuntimeStoryBundle；校验问题写入通知但仍保存可诊断 bundle。
     */
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
    /** @returns 刷新后的本地档案摘要列表，并追加数量通知。 */
    async listProfiles() {
      const profiles = await loadProfilesFromDisk()
      pushNotification(`Found ${profiles.length} local profiles.`)
      return profiles
    },
    /** @returns 当前故事要求玩家填写的建角字段；会按需加载 bundle。 */
    async listPlayerOverridePrompts() {
      const bundle = await ensureBundleLoaded()
      return buildHtmlPlayerOverridePrompts(bundle)
    },
    /**
     * 创建并立即选中一个本地角色档案。
     * @param input 档案 id/名称、结构化玩家资料和自定义变量。 @returns 写盘后的档案文件。
     * @throws 同 id 档案已存在时抛错；所有值先在内存合并，最后一次写入 custom.json5。
     */
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
    /** @param profileId 要选择的档案 id。 @returns 读取到的完整档案，并刷新其存档列表。 @throws 档案不存在时抛错。 */
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
    /** @returns 当前所选档案按时间倒序的存档摘要。 @throws 尚未选择档案时抛错。 */
    async listSaveSlots() {
      const profile = assertProfile(state.profile)
      const saveSlots = await loadSaveSlotsFromDisk(profile.profile_id)
      pushNotification(`角色 "${profile.profile_name}" 共有 ${saveSlots.length} 个存档。`)
      return saveSlots
    },
    /** @returns 使用当前档案创建的全新 Runtime Session。 */
    async startNewGame() {
      return createSessionFromSelection()
    },
    /** @param slotId 存档槽 id。 @returns 从该 v1/v2 存档恢复的 Runtime Session。 @throws 槽不存在时抛错。 */
    async loadSave(slotId) {
      const profile = assertProfile(state.profile)
      const saveFile = resolveSaveFile(paths, profile.profile_id, slotId)
      const saveState = await readOptionalJson5File<RuntimeStorySaveState>(saveFile)

      if (!saveState) {
        throw new HtmlClientError(`Save slot "${slotId}" was not found.`)
      }

      return createSessionFromSelection(saveState)
    },
    /**
     * 保存当前会话到指定槽位。
     * @param slotId 用户输入槽名。 @returns 写入的 v2 存档对象。 @throws 没有档案/会话时抛错。
     * 同时保存领域快照、播放游标和 bundle contentHash，随后刷新存档列表。
     */
    async saveToSlot(slotId) {
      const profile = assertProfile(state.profile)
      const session = assertSession(state.session)
      const bundle = await ensureBundleLoaded()
      // 存档记录 bundle 版本，后面做兼容或迁移时可以据此判断。
      const normalizedSlotId = sanitizeSegment(slotId) || "slot-1"
      const saveState: RuntimeStorySaveState = {
        schema_version: 2,
        slot_id: normalizedSlotId,
        story_id: options.storyId,
        profile_id: profile.profile_id,
        bundle_content_hash: bundle.contentHash ?? bundle.generatedAt,
        saved_at: getNow().toISOString(),
        playback: session.getPlaybackState(),
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
    /** @param action Runtime 交互动作。 @returns 无返回值；派发后立即重新构建 view。 */
    dispatch(action) {
      const session = assertSession(state.session)
      session.dispatch(action)
      // 每次动作派发后立即刷新视图模型，保持 UI 壳层尽量薄。
      state.view = session.getViewModel()
    },
    /** @param deltaMs 本帧真实毫秒数。 @returns 无返回值；推进确定性运行时并刷新 view。 */
    tick(deltaMs) {
      const session = assertSession(state.session)
      session.tick(deltaMs)
      state.view = session.getViewModel()
    },
    /** @param paused 是否手动暂停游戏时钟。 @returns 无返回值；设置后刷新 view。 */
    setTimePause(paused) {
      const session = assertSession(state.session)
      session.setTimePause(paused)
      state.view = session.getViewModel()
    },
    /** @param speed 游戏时间倍率。 @returns 无返回值；交给 Runtime 规范并刷新 view。 */
    setTimeSpeed(speed) {
      const session = assertSession(state.session)
      session.setTimeSpeed(speed)
      state.view = session.getViewModel()
    }
  }
}
