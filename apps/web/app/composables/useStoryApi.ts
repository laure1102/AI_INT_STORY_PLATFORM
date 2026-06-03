import type {
  AppSettingsFile,
  StoryAnyEventFile,
  StoryEventCollectionType,
  StoryDocument,
  StoryEventLocationFile,
  StoryRolesFile,
  StorySceneFile,
  StoryValsFile
} from "@story-mgr/core"
import type {
  AppSettingsResponse,
  CompressLocationImageRequest,
  CompressRoleImageRequest,
  CompressSceneBackgroundRequest,
  ExportResponse,
  GenerateLocationImageRequest,
  GenerateLocationImageResponse,
  GenerateLocationPromptRequest,
  GenerateLocationPromptResponse,
  GenerateRoleImageRequest,
  GenerateRoleImageResponse,
  GenerateRolePromptRequest,
  GenerateRolePromptResponse,
  SaveAppSettingsRequest,
  SaveEventRequest,
  SaveEventLocationsRequest,
  SaveRolesRequest,
  SaveScenesRequest,
  SaveSystemValsRequest,
  SaveValsRequest,
  StoryAssetMetadata,
  StoryDocumentResponse,
  StoryDeleteEventResponse,
  StoryEventResponse,
  StoryEventLocationsResponse,
  StoryRolesResponse,
  StoryListResponse,
  StoryAssetResponse,
  StoryScenesResponse,
  StorySystemValsResponse,
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

  async function getAppSettings(): Promise<AppSettingsFile> {
    const response = await $fetch<AppSettingsResponse>(`${apiBase}/settings`)
    return response.settings
  }

  async function getEvent(
    storyId: string,
    eventId: string,
    collectionType: StoryEventCollectionType = "graph"
  ): Promise<StoryAnyEventFile> {
    const response = await $fetch<StoryEventResponse>(
      `${apiBase}/stories/${storyId}/events/${eventId}`,
      {
        query: {
          collectionType
        }
      }
    )
    return response.event
  }

  async function saveEvent(
    storyId: string,
    event: StoryAnyEventFile,
    collectionType: StoryEventCollectionType = "graph"
  ): Promise<StoryAnyEventFile> {
    const response = await $fetch<StoryEventResponse>(
      `${apiBase}/stories/${storyId}/events/${event.id}`,
      {
        method: "PUT",
        body: {
          collectionType,
          event
        } satisfies SaveEventRequest
      }
    )

    return response.event
  }

  async function deleteEvent(
    storyId: string,
    eventId: string,
    collectionType: StoryEventCollectionType = "graph"
  ): Promise<void> {
    await $fetch<StoryDeleteEventResponse>(`${apiBase}/stories/${storyId}/events/${eventId}`, {
      method: "DELETE",
      query: {
        collectionType
      }
    })
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

  async function saveSystemVals(
    storyId: string,
    systemVals: StoryValsFile
  ): Promise<StoryValsFile> {
    const response = await $fetch<StorySystemValsResponse>(
      `${apiBase}/stories/${storyId}/system-vals`,
      {
        method: "PUT",
        body: {
          systemVals
        } satisfies SaveSystemValsRequest
      }
    )

    return response.systemVals
  }

  async function saveScenes(storyId: string, scenes: StorySceneFile): Promise<StorySceneFile> {
    const response = await $fetch<StoryScenesResponse>(`${apiBase}/stories/${storyId}/scenes`, {
      method: "PUT",
      body: {
        scenes
      } satisfies SaveScenesRequest
    })

    return response.scenes
  }

  async function saveRoles(storyId: string, roles: StoryRolesFile): Promise<StoryRolesFile> {
    const response = await $fetch<StoryRolesResponse>(`${apiBase}/stories/${storyId}/roles`, {
      method: "PUT",
      body: {
        roles
      } satisfies SaveRolesRequest
    })

    return response.roles
  }

  async function saveEventLocations(
    storyId: string,
    eventLocations: StoryEventLocationFile
  ): Promise<StoryEventLocationFile> {
    const response = await $fetch<StoryEventLocationsResponse>(
      `${apiBase}/stories/${storyId}/event-locations`,
      {
        method: "PUT",
        body: {
          eventLocations
        } satisfies SaveEventLocationsRequest
      }
    )

    return response.eventLocations
  }

  async function saveAppSettings(settings: AppSettingsFile): Promise<AppSettingsFile> {
    const response = await $fetch<AppSettingsResponse>(`${apiBase}/settings`, {
      method: "PUT",
      body: {
        settings
      } satisfies SaveAppSettingsRequest
    })

    return response.settings
  }

  async function uploadStoryAsset(storyId: string, file: File): Promise<StoryAssetMetadata> {
    const formData = new FormData()
    formData.append("file", file)

    const response = await $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/assets/upload`, {
      method: "POST",
      body: formData
    })

    return response.asset
  }

  async function compressSceneAsset(
    storyId: string,
    payload: CompressSceneBackgroundRequest
  ): Promise<StoryAssetMetadata> {
    const response = await $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/assets/compress`, {
      method: "POST",
      body: payload
    })

    return response.asset
  }

  async function getStoryAssetMeta(
    storyId: string,
    assetPath: string
  ): Promise<StoryAssetMetadata> {
    const response = await $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/assets/meta`, {
      query: {
        path: assetPath
      }
    })

    return response.asset
  }

  async function generateLocationPrompt(
    storyId: string,
    payload: GenerateLocationPromptRequest
  ): Promise<string> {
    const response = await $fetch<GenerateLocationPromptResponse>(
      `${apiBase}/stories/${storyId}/event-locations/prompt`,
      {
        method: "POST",
        body: payload
      }
    )

    return response.prompt
  }

  async function generateRolePrompt(
    storyId: string,
    payload: GenerateRolePromptRequest
  ): Promise<string> {
    const response = await $fetch<GenerateRolePromptResponse>(
      `${apiBase}/stories/${storyId}/roles/prompt`,
      {
        method: "POST",
        body: payload
      }
    )

    return response.prompt
  }

  async function generateLocationImage(
    storyId: string,
    payload: GenerateLocationImageRequest
  ): Promise<StoryAssetMetadata> {
    const response = await $fetch<GenerateLocationImageResponse>(
      `${apiBase}/stories/${storyId}/event-locations/image`,
      {
        method: "POST",
        body: payload
      }
    )

    return response.asset
  }

  async function generateRoleImage(
    storyId: string,
    payload: GenerateRoleImageRequest
  ): Promise<StoryAssetMetadata> {
    const response = await $fetch<GenerateRoleImageResponse>(
      `${apiBase}/stories/${storyId}/roles/image`,
      {
        method: "POST",
        body: payload
      }
    )

    return response.asset
  }

  async function compressLocationImage(
    storyId: string,
    payload: CompressLocationImageRequest
  ): Promise<StoryAssetMetadata> {
    const response = await $fetch<StoryAssetResponse>(
      `${apiBase}/stories/${storyId}/event-locations/compress`,
      {
        method: "POST",
        body: payload
      }
    )

    return response.asset
  }

  async function compressRoleImage(
    storyId: string,
    payload: CompressRoleImageRequest
  ): Promise<StoryAssetMetadata> {
    const response = await $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/roles/compress`, {
      method: "POST",
      body: payload
    })

    return response.asset
  }

  function getStoryAssetUrl(storyId: string, assetPath: string) {
    const searchParams = new URLSearchParams({
      path: assetPath
    })

    return `${apiBase}/stories/${storyId}/assets/file?${searchParams.toString()}`
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
    compressLocationImage,
    compressRoleImage,
    compressSceneAsset,
    exportStory,
    generateLocationImage,
    generateLocationPrompt,
    generateRoleImage,
    generateRolePrompt,
    getAppSettings,
    getEvent,
    getStoryAssetMeta,
    getStoryAssetUrl,
    getStory,
    listStories,
    deleteEvent,
    saveAppSettings,
    saveEvent,
    saveEventLocations,
    saveRoles,
    saveScenes,
    saveSystemVals,
    saveVals,
    uploadStoryAsset,
    validateStory
  }
}
