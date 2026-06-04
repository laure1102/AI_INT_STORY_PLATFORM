import type {
  AppSettingsFile,
  StoryAnyEventFile,
  CompiledStory,
  StoryDocument,
  StoryEventCollectionType,
  StoryEventFile,
  StoryEventLocationFile,
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
