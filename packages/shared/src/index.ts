import type {
  CompiledStory,
  StoryDocument,
  StoryEventFile,
  StorySummary,
  StoryViewFile,
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

export interface StoryViewResponse {
  view: StoryViewFile
}

export interface SaveEventRequest {
  event: StoryEventFile
}

export interface SaveViewRequest {
  view: StoryViewFile
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
