import type { StoryDocument, StoryEventFile, StoryViewFile } from "@story-mgr/core"
import type {
  ExportResponse,
  SaveEventRequest,
  SaveViewRequest,
  StoryDocumentResponse,
  StoryEventResponse,
  StoryListResponse,
  StoryViewResponse,
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

  async function getView(storyId: string, viewId: string): Promise<StoryViewFile> {
    const response = await $fetch<StoryViewResponse>(
      `${apiBase}/stories/${storyId}/views/${viewId}`
    )
    return response.view
  }

  async function saveView(storyId: string, view: StoryViewFile): Promise<StoryViewFile> {
    const response = await $fetch<StoryViewResponse>(
      `${apiBase}/stories/${storyId}/views/${view.id}`,
      {
        method: "PUT",
        body: {
          view
        } satisfies SaveViewRequest
      }
    )

    return response.view
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
    getView,
    listStories,
    saveEvent,
    saveView,
    validateStory
  }
}
