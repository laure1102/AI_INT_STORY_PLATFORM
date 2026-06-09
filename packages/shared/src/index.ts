import type {
  AppSettingsFile,
  StoryAnyEventFile,
  StoryBibleFile,
  CompiledStory,
  StoryDocument,
  StoryEventCollectionType,
  StoryEventFile,
  StoryEventLocationFile,
  StoryItemsFile,
  StoryPlayerOverrideValsFile,
  StoryRolesFile,
  StorySceneBackgroundVariant,
  StorySceneFile,
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

export interface StoryListResponse {
  stories: StorySummary[]
}

export interface StoryDocumentResponse {
  story: StoryDocument
}

export interface StoryBibleResponse {
  storyBible: StoryBibleFile
}

export interface SaveStoryBibleRequest {
  storyBible: StoryBibleFile
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

export interface StoryCreationDraftEvent {
  collectionType: "chain" | "pool" | "schedule"
  id: string
  title: string
  trigger_mode: "default" | "condition" | "invoke"
  trigger_expr: string
  invoke_params?: StoryCreationDraftInvokeParam[]
  object_keys: string[]
  location: string
  dialogues: StoryCreationDraftDialogue[]
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

export interface ApplyStoryCreationDraftSelection {
  eventKeys: string[]
  locationIds: string[]
  roleKeys?: string[]
  itemIds?: string[]
  /** @deprecated 请改用 roleKeys，格式为 normal:<id> 或 important:<id> */
  roleIds?: string[]
  variableKeys?: string[]
  /** @deprecated 请改用 variableKeys，格式为 group.name */
  variables?: string[]
}

export interface ApplyStoryCreationDraftRequest {
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
  }
  warnings: string[]
}

export interface StoryEventResponse {
  event: StoryAnyEventFile
}

export interface StoryDeleteEventResponse {
  ok: true
}

export interface SaveEventRequest {
  collectionType: StoryEventCollectionType
  event: StoryAnyEventFile
}

export interface StoryValsResponse {
  vals: StoryValsFile
}

export interface SaveValsRequest {
  vals: StoryValsFile
}

export interface StorySystemValsResponse {
  systemVals: StoryValsFile
}

export interface SaveSystemValsRequest {
  systemVals: StoryValsFile
}

export interface StoryPlayerOverrideValsResponse {
  playerOverrideVals: StoryPlayerOverrideValsFile
}

export interface SavePlayerOverrideValsRequest {
  playerOverrideVals: StoryPlayerOverrideValsFile
}

export interface StoryScenesResponse {
  scenes: StorySceneFile
}

export interface SaveScenesRequest {
  scenes: StorySceneFile
}

export interface StoryRolesResponse {
  roles: StoryRolesFile
}

export interface SaveRolesRequest {
  roles: StoryRolesFile
}

export interface StoryEventLocationsResponse {
  eventLocations: StoryEventLocationFile
}

export interface SaveEventLocationsRequest {
  eventLocations: StoryEventLocationFile
}

export interface StoryItemsResponse {
  items: StoryItemsFile
}

export interface SaveStoryItemsRequest {
  items: StoryItemsFile
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
}

export interface CompressSceneBackgroundRequest {
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

export interface GenerateRoleImageRequest {
  gender: "common" | "male" | "female"
  globalPrompt: string
  width: number
  height: number
  prompt: string
  targetName: string
}

export interface GenerateRoleImageResponse {
  asset: StoryAssetMetadata
}

export interface CompressRoleImageRequest {
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

export interface GenerateLocationImageRequest {
  globalPrompt: string
  width: number
  height: number
  prompt: string
  targetName: string
}

export interface GenerateLocationImageResponse {
  asset: StoryAssetMetadata
}

export interface CompressLocationImageRequest {
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

export interface GenerateItemImageRequest {
  globalPrompt: string
  width: number
  height: number
  prompt: string
  targetName: string
}

export interface GenerateItemImageResponse {
  asset: StoryAssetMetadata
}

export interface CompressItemImageRequest {
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
    code?: string
  }
}

export type StoryProfileCustomFile = RuntimeProfileCustomFile
export type StorySaveStateFile = RuntimeStorySaveState
export type StorySessionSnapshot = RuntimeStorySessionSnapshot
