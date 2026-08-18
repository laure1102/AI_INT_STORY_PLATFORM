/**
 * HTML 客户端公共契约：描述启动阶段、路径、档案、存档和应用门面。
 * 这里只声明数据形状，不读写磁盘，也不创建 Runtime Session。
 */
import type {
  RuntimePlayerProfileSetup,
  RuntimeProfileCustomFile,
  RuntimeStoryBundle,
  RuntimeStorySaveState,
  RuntimeStorySession,
  RuntimeStorySessionAction,
  RuntimeStoryViewModel
} from "@story-mgr/runtime"
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
  evolutionDir: string
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
  evolutionApiUrl?: string
  playerId?: string
  shardId?: string
  evolutionPollIntervalMs?: number
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
  dispatch(action: RuntimeStorySessionAction): boolean | void
  tick(deltaMs: number): void
  setTimePause(paused: boolean): void
  setTimeSpeed(speed: number): void
  dispose(): void
}
