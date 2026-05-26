import type {
  CompiledStory,
  StoryDocument,
  StoryEventFile,
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
