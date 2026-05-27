import type {
  AppSettingsFile,
  CompiledStory,
  StoryDocument,
  StoryEventFile,
  StoryEventLocationFile,
  StorySceneBackgroundVariant,
  StorySceneFile,
  StoryValsFile,
  StorySummary,
  ValidationResult
} from "@story-mgr/core"

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
  event: StoryEventFile
}

export interface SaveEventRequest {
  event: StoryEventFile
}

export interface StoryValsResponse {
  vals: StoryValsFile
}

export interface SaveValsRequest {
  vals: StoryValsFile
}

export interface StoryScenesResponse {
  scenes: StorySceneFile
}

export interface SaveScenesRequest {
  scenes: StorySceneFile
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
  imageSize: string
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
