import type { StoryDocument, StoryEventFile, StoryValsFile } from "@story-mgr/core"
import type {
  ExportResponse,
  SaveEventRequest,
  SaveValsRequest,
  StoryDocumentResponse,
  StoryEventResponse,
  StoryListResponse,
  StoryValsResponse,
  ValidationResponse
} from "@story-mgr/shared"

export function useStoryApi() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase

  async function listStories() {
    const response = await $fetch<StoryListResponse>(`${apiBase}/stories`)
    return response.stories
  }

  async function getStory(storyId: string): Promise<StoryDocument> {
    const response = await $fetch<StoryDocumentResponse>(`${apiBase}/stories/${storyId}`)
    return response.story
  }

  async function getEvent(storyId: string, eventId: string): Promise<StoryEventFile> {
    const response = await $fetch<StoryEventResponse>(
      `${apiBase}/stories/${storyId}/events/${eventId}`
    )
    return response.event
  }

  async function saveEvent(storyId: string, event: StoryEventFile): Promise<StoryEventFile> {
    const response = await $fetch<StoryEventResponse>(
      `${apiBase}/stories/${storyId}/events/${event.id}`,
      {
        method: "PUT",
        body: {
          event
        } satisfies SaveEventRequest
      }
    )

    return response.event
  }

  async function saveVals(storyId: string, vals: StoryValsFile): Promise<StoryValsFile> {
    const response = await $fetch<StoryValsResponse>(`${apiBase}/stories/${storyId}/vals`, {
      method: "PUT",
      body: {
        vals
      } satisfies SaveValsRequest
    })

    return response.vals
  }

  async function validateStory(storyId: string) {
    const response = await $fetch<ValidationResponse>(`${apiBase}/stories/${storyId}/validate`, {
      method: "POST"
    })

    return response.result
  }

  async function exportStory(storyId: string) {
    return $fetch<ExportResponse>(`${apiBase}/stories/${storyId}/export`, {
      method: "POST"
    })
  }

  return {
    exportStory,
    getEvent,
    getStory,
    listStories,
    saveEvent,
    saveVals,
    validateStory
  }
}
