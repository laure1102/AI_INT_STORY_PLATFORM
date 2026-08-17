import type {
  AppSettingsFile,
  StoryAnyEventFile,
  StoryBibleFile,
  CompiledStory,
  StoryDocument,
  StoryDoingFile,
  StoryEventCollectionType,
  StoryEventFile,
  StoryEventLocationFile,
  StoryLoopEventFile,
  StoryItemsFile,
  StoryMetaFile,
  StoryOnceDialogueDefinition,
  StoryOnceEventFile,
  StoryContactFile,
  StoryContactConversationsFile,
  StoryPlayerOverrideValsFile,
  StoryReferFile,
  StoryRolesFile,
  StorySceneBackgroundVariant,
  StorySceneFile,
  StoryShopFile,
  StoryValsFile,
  StorySummary,
  ValidationResult
} from "@story-mgr/core"
import type {
  RuntimeProfileCustomFile,
  RuntimeStorySaveState,
  RuntimeStorySessionSnapshot
} from "@story-mgr/runtime"

export interface HealthResponse {
  ok: true
}

export interface StoryRevisionRequest {
  expectedRevision: number
}

export interface StoryRevisionResponse {
  revision: number
}

export interface StoryListResponse {
  stories: StorySummary[]
}

export interface CreateStoryRequest {
  id: string
  title: string
  description?: string
  tags?: string[]
}

export interface CreateStoryResponse extends StoryRevisionResponse {
  story: StoryDocument
  summary: StorySummary
}

export interface StoryDocumentResponse extends StoryRevisionResponse {
  story: StoryDocument
}

export interface StoryMetaResponse {
  story: StoryMetaFile
  revision?: number
}

export interface SaveStoryMetaRequest extends StoryRevisionRequest {
  story: StoryMetaFile
}

export interface StoryBibleResponse {
  storyBible: StoryBibleFile
  revision?: number
}

export interface SaveStoryBibleRequest extends StoryRevisionRequest {
  storyBible: StoryBibleFile
}

export type StoryDialogueEventSnapshot =
  | StoryEventFile
  | StoryOnceEventFile
  | StoryLoopEventFile

export interface GenerateStoryDialogueRequest {
  collectionType: StoryEventCollectionType
  event: StoryDialogueEventSnapshot
  instruction: string
}

export interface GenerateStoryDialogueResponse {
  summary: string
  dialogues: StoryOnceDialogueDefinition[]
  warnings: string[]
}

export type StoryCreationAgentRole =
  | "chiefEditor"
  | "plotPlanner"
  | "assetDesigner"
  | "eventWriter"
  | "scriptDoctor"
  | "consistencyChecker"

export interface StoryCreationAgentLog {
  role: StoryCreationAgentRole
  title: string
  summary: string
}

export interface StoryCreationDraftLocation {
  id: string
  descr: string
  prompt: string
}

export interface StoryCreationDraftRole {
  id: string
  name: string
  zhiye: string
  descr: string
  prompt: string
  xingge?: string
  important: boolean
}

export interface StoryCreationDraftItem {
  id: string
  name: string
  category_id: string
  descr: string
  prompt: string
  tags: string[]
  rarity: string
  stackable: boolean
  max_stack: number
  usable: boolean
}

export interface StoryCreationDraftDialogue {
  speaker_type: "player" | "object"
  speaker_key: string
  content: string
  role_name_input?: {
    role_key: string
    prompt?: string
  }
}

export type StoryCreationDraftPresentation =
  | {
      type: "silent"
    }
  | {
      type: "message"
      message: {
        content: string
        duration_seconds: number
      }
    }
  | {
      type: "dialogue"
      dialogues: StoryCreationDraftDialogue[]
    }

export interface StoryCreationDraftInvokeParam {
  name: string
  descr?: string
}

export interface StoryCreationDraftLoopRule {
  mode: "daily" | "weekly" | "monthly" | "interval_days"
  interval_days?: number
  weekday?: number
  month_day?: number
  at?: string
  priority?: number
  after?: string[]
  before?: string[]
}

export type StoryCreationDraftVariableValue = string | number | boolean | null

export interface StoryCreationDraftVariable {
  group: string
  name: string
  description: string
  value_type: "value" | "calc"
  value?: StoryCreationDraftVariableValue
  calc_rule: string
}

export interface StoryCreationDraftContact {
  channels: StoryContactFile["channels"]
  personality_library: StoryContactFile["personality_library"]
  talk_library: StoryContactFile["talk_library"]
  action_library: StoryContactFile["action_library"]
  reply_library: StoryContactFile["reply_library"]
  contact_profiles: StoryContactFile["contact_profiles"]
}

export interface StoryCreationDraftContactConversations {
  conversations: StoryContactConversationsFile["conversations"]
}

export interface StoryCreationDraftDoing {
  menus: StoryDoingFile["menus"]
  doings: StoryDoingFile["doings"]
}

export interface StoryCreationDraftShop {
  categories: StoryShopFile["categories"]
  products: StoryShopFile["products"]
}

export interface StoryCreationDraftEvent {
  collectionType: "chain" | "pool" | "schedule"
  id: string
  title: string
  trigger_mode: "default" | "condition" | "invoke"
  trigger_expr: string
  invoke_params?: StoryCreationDraftInvokeParam[]
  object_keys: string[]
  location: string
  presentation: StoryCreationDraftPresentation
  init_script: string
  end_script: string
  next: string[]
  bgm?: string
  loop?: StoryCreationDraftLoopRule
}

export interface StoryCreationDraft {
  title: string
  summary: string
  arc: string
  locations: StoryCreationDraftLocation[]
  roles: StoryCreationDraftRole[]
  items: StoryCreationDraftItem[]
  events: StoryCreationDraftEvent[]
  variables: StoryCreationDraftVariable[]
  contact?: StoryCreationDraftContact
  contactConversations?: StoryCreationDraftContactConversations
  doing?: StoryCreationDraftDoing
  shop?: StoryCreationDraftShop
  notes: string[]
  warnings: string[]
}

export interface RunStoryCreationAgentRequest {
  instruction: string
  baseDraft?: StoryCreationDraft
}

export interface RunStoryCreationAgentResponse {
  draft: StoryCreationDraft
  logs: StoryCreationAgentLog[]
}

export type StoryCreationJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export interface StoryCreationJobTokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface StoryCreationJobNodeLog extends StoryCreationAgentLog {
  id: string
  status: "running" | "completed" | "failed" | "cancelled"
  model: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  retryCount: number
  tokenUsage: StoryCreationJobTokenUsage
  errorCode?: string
}

export interface StoryCreationJob {
  id: string
  storyId: string
  threadId: string
  status: StoryCreationJobStatus
  instruction: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  currentRole?: StoryCreationAgentRole
  logs: StoryCreationJobNodeLog[]
  result?: RunStoryCreationAgentResponse
  error?: {
    code: string
    message: string
  }
}

export type CreateStoryCreationJobRequest = RunStoryCreationAgentRequest

export interface StoryCreationJobResponse {
  job: StoryCreationJob
}

export interface StoryCreationJobListResponse {
  jobs: StoryCreationJob[]
}

export type StoryCreationJobStreamEvent =
  | { type: "snapshot"; job: StoryCreationJob }
  | { type: "log"; log: StoryCreationJobNodeLog }
  | { type: "status"; job: StoryCreationJob }

export type StoryCreationHistoryTurnMode = "new" | "feedback"
export type StoryCreationHistoryTurnStatus = "running" | "done" | "failed" | "cancelled"
export type StoryCreationHistorySessionStatus = "running" | "draft" | "applied" | "failed" | "cancelled"

export interface StoryCreationHistoryTurn {
  id: string
  mode: StoryCreationHistoryTurnMode
  instruction: string
  status: StoryCreationHistoryTurnStatus
  createdAt: string
  completedAt?: string
  error?: string
  response?: RunStoryCreationAgentResponse
}

export interface StoryCreationHistoryApplyResult {
  appliedAt: string
  message: string
  selection: ApplyStoryCreationDraftSelection
  applied: ApplyStoryCreationDraftResponse["applied"]
  warnings: string[]
  draft: StoryCreationDraft
}

export interface StoryCreationHistorySession {
  id: string
  title: string
  status: StoryCreationHistorySessionStatus
  createdAt: string
  updatedAt: string
  initialInstruction: string
  turns: StoryCreationHistoryTurn[]
  currentDraft?: StoryCreationDraft
  applied?: StoryCreationHistoryApplyResult
}

export interface StoryCreationHistoryFile {
  sessions: StoryCreationHistorySession[]
}

export interface StoryCreationHistoryResponse {
  history: StoryCreationHistoryFile
}

export interface SaveStoryCreationHistorySessionRequest extends StoryRevisionRequest {
  session: StoryCreationHistorySession
}

export interface SaveStoryCreationHistorySessionResponse {
  session: StoryCreationHistorySession
  history: StoryCreationHistoryFile
  revision: number
}

export interface DeleteStoryCreationHistorySessionResponse {
  deletedId: string
  history: StoryCreationHistoryFile
  revision: number
}

export interface ApplyStoryCreationDraftSelection {
  eventKeys: string[]
  locationIds: string[]
  roleKeys?: string[]
  itemIds?: string[]
  contactChannelIds?: string[]
  contactPersonalityIds?: string[]
  contactTalkIds?: string[]
  contactActionIds?: string[]
  contactReplyIds?: string[]
  contactProfileKeys?: string[]
  contactConversationIds?: string[]
  doingMenuIds?: string[]
  doingIds?: string[]
  shopCategoryIds?: string[]
  shopProductIds?: string[]
  /** @deprecated 请改用 roleKeys，格式为 normal:<id> 或 important:<id> */
  roleIds?: string[]
  variableKeys?: string[]
  /** @deprecated 请改用 variableKeys，格式为 group.name */
  variables?: string[]
}

export interface ApplyStoryCreationDraftRequest extends StoryRevisionRequest {
  draft: StoryCreationDraft
  selection: ApplyStoryCreationDraftSelection
}

export interface ApplyStoryCreationDraftResponse {
  story: StoryDocument
  result: ValidationResult
  applied: {
    events: number
    locations: number
    roles: number
    items: number
    variables: number
    contactChannels: number
    contactPersonalities: number
    contactTalks: number
    contactActions: number
    contactReplies: number
    contactProfiles: number
    contactConversations: number
    doingMenus: number
    doings: number
    shopCategories: number
    shopProducts: number
  }
  warnings: string[]
  revision: number
}

export interface StoryEventResponse {
  event: StoryAnyEventFile
  revision?: number
}

export interface StoryDeleteEventResponse {
  ok: true
  revision: number
}

export interface SaveEventRequest extends StoryRevisionRequest {
  collectionType: StoryEventCollectionType
  event: StoryAnyEventFile
}

export interface StoryValsResponse {
  vals: StoryValsFile
  revision?: number
}

export interface SaveValsRequest extends StoryRevisionRequest {
  vals: StoryValsFile
}

export interface StorySystemValsResponse {
  systemVals: StoryValsFile
  revision?: number
}

export interface SaveSystemValsRequest extends StoryRevisionRequest {
  systemVals: StoryValsFile
}

export interface StoryPlayerOverrideValsResponse {
  playerOverrideVals: StoryPlayerOverrideValsFile
  revision?: number
}

export interface SavePlayerOverrideValsRequest extends StoryRevisionRequest {
  playerOverrideVals: StoryPlayerOverrideValsFile
}

export interface StoryScenesResponse {
  scenes: StorySceneFile
  revision?: number
}

export interface SaveScenesRequest extends StoryRevisionRequest {
  scenes: StorySceneFile
}

export interface StoryRolesResponse {
  roles: StoryRolesFile
  revision?: number
}

export interface SaveRolesRequest extends StoryRevisionRequest {
  roles: StoryRolesFile
}

export interface StoryEventLocationsResponse {
  eventLocations: StoryEventLocationFile
  revision?: number
}

export interface SaveEventLocationsRequest extends StoryRevisionRequest {
  eventLocations: StoryEventLocationFile
}

export interface StoryItemsResponse {
  items: StoryItemsFile
  revision?: number
}

export interface SaveStoryItemsRequest extends StoryRevisionRequest {
  items: StoryItemsFile
}

export interface StoryShopResponse {
  shop: StoryShopFile
  revision?: number
}

export interface SaveStoryShopRequest extends StoryRevisionRequest {
  shop: StoryShopFile
}

export interface StoryContactResponse {
  contact: StoryContactFile
  revision?: number
}

export interface SaveStoryContactRequest extends StoryRevisionRequest {
  contact: StoryContactFile
}

export interface StoryContactConversationsResponse {
  contactConversations: StoryContactConversationsFile
  revision?: number
}

export interface SaveStoryContactConversationsRequest extends StoryRevisionRequest {
  contactConversations: StoryContactConversationsFile
}

export interface StoryReferResponse {
  refer: StoryReferFile
  revision?: number
}

export interface SaveStoryReferRequest extends StoryRevisionRequest {
  refer: StoryReferFile
}

export interface StoryDoingResponse {
  doing: StoryDoingFile
  revision?: number
}

export interface SaveStoryDoingRequest extends StoryRevisionRequest {
  doing: StoryDoingFile
}

export interface AppSettingsResponse {
  settings: AppSettingsFile
}

export interface SaveAppSettingsRequest {
  settings: AppSettingsFile
}

export interface StoryAssetMetadata {
  assetPath: string
  fileName: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
}

export interface StoryAssetResponse {
  asset: StoryAssetMetadata
  revision?: number
}

export interface CompressSceneBackgroundRequest extends StoryRevisionRequest {
  sourcePath: string
  level: number
  variant: StorySceneBackgroundVariant
  quality: number
}

export interface GenerateRolePromptRequest {
  descr: string
  gender: "common" | "male" | "female"
  important: boolean
  qufenXingbie: boolean
  roleName: string
  storyTitle?: string
  xingge?: string
}

export interface GenerateRolePromptResponse {
  prompt: string
}

export interface GenerateRoleImageRequest extends StoryRevisionRequest {
  gender: "common" | "male" | "female"
  globalPrompt: string
  width: number
  height: number
  prompt: string
  targetName: string
}

export interface GenerateRoleImageResponse {
  asset: StoryAssetMetadata
  revision: number
}

export interface CompressRoleImageRequest extends StoryRevisionRequest {
  sourcePath: string
  targetName: string
  quality: number
  slot: 1 | 2
}

export interface GenerateLocationPromptRequest {
  descr: string
  locationName: string
  storyTitle?: string
}

export interface GenerateLocationPromptResponse {
  prompt: string
}

export interface GenerateLocationImageRequest extends StoryRevisionRequest {
  globalPrompt: string
  width: number
  height: number
  prompt: string
  targetName: string
}

export interface GenerateLocationImageResponse {
  asset: StoryAssetMetadata
  revision: number
}

export interface CompressLocationImageRequest extends StoryRevisionRequest {
  sourcePath: string
  targetName: string
  quality: number
  slot: 1 | 2
}

export interface GenerateItemPromptRequest {
  categoryName: string
  descr: string
  itemName: string
  storyTitle?: string
}

export interface GenerateItemPromptResponse {
  prompt: string
}

export interface GenerateItemImageRequest extends StoryRevisionRequest {
  globalPrompt: string
  width: number
  height: number
  prompt: string
  targetName: string
}

export interface GenerateItemImageResponse {
  asset: StoryAssetMetadata
  revision: number
}

export interface CompressItemImageRequest extends StoryRevisionRequest {
  sourcePath: string
  targetName: string
  quality: number
  slot: 1 | 2
}

export interface ValidationResponse {
  result: ValidationResult
}

export interface ExportResponse {
  compiled: CompiledStory
  result: ValidationResult
  outputPath: string
}

export interface ApiErrorResponse {
  error: {
    message: string
    code: string
    requestId: string
    details?: unknown
  }
}

export type StoryProfileCustomFile = RuntimeProfileCustomFile
export type StorySaveStateFile = RuntimeStorySaveState
export type StorySessionSnapshot = RuntimeStorySessionSnapshot
