import type {
  AppSettingsFile,
  StoryAnyEventFile,
  StoryBibleFile,
  StoryDoingFile,
  StoryEventCollectionType,
  StoryDocument,
  StoryEventLocationFile,
  StoryItemsFile,
  StoryPhoneFile,
  StoryPlayerOverrideValsFile,
  StoryReferFile,
  StoryRolesFile,
  StorySceneFile,
  StoryShopFile,
  StoryValsFile
} from "@story-mgr/core"
import type {
  ApplyStoryCreationDraftRequest,
  ApplyStoryCreationDraftResponse,
  AppSettingsResponse,
  CompressItemImageRequest,
  CompressLocationImageRequest,
  CompressRoleImageRequest,
  CompressSceneBackgroundRequest,
  CreateStoryRequest,
  CreateStoryResponse,
  ExportResponse,
  GenerateItemImageRequest,
  GenerateItemImageResponse,
  GenerateItemPromptRequest,
  GenerateItemPromptResponse,
  GenerateStoryDialogueRequest,
  GenerateStoryDialogueResponse,
  GenerateLocationImageRequest,
  GenerateLocationImageResponse,
  GenerateLocationPromptRequest,
  GenerateLocationPromptResponse,
  GenerateRoleImageRequest,
  GenerateRoleImageResponse,
  GenerateRolePromptRequest,
  GenerateRolePromptResponse,
  RunStoryCreationAgentRequest,
  RunStoryCreationAgentResponse,
  SaveAppSettingsRequest,
  SaveStoryCreationHistorySessionRequest,
  SaveStoryCreationHistorySessionResponse,
  SaveStoryDoingRequest,
  SaveEventRequest,
  SaveEventLocationsRequest,
  SaveStoryItemsRequest,
  SaveStoryPhoneRequest,
  SaveStoryReferRequest,
  SaveStoryShopRequest,
  SavePlayerOverrideValsRequest,
  SaveRolesRequest,
  SaveScenesRequest,
  SaveStoryBibleRequest,
  SaveSystemValsRequest,
  SaveValsRequest,
  StoryAssetMetadata,
  StoryDocumentResponse,
  StoryCreationHistoryFile,
  StoryCreationHistoryResponse,
  StoryCreationHistorySession,
  StoryDeleteEventResponse,
  StoryDoingResponse,
  StoryEventResponse,
  StoryEventLocationsResponse,
  StoryItemsResponse,
  StoryPhoneResponse,
  StoryPlayerOverrideValsResponse,
  StoryReferResponse,
  StoryRolesResponse,
  StoryListResponse,
  StoryShopResponse,
  StoryAssetResponse,
  StoryBibleResponse,
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

  async function createStory(payload: CreateStoryRequest): Promise<CreateStoryResponse> {
    return $fetch<CreateStoryResponse>(`${apiBase}/stories`, {
      method: "POST",
      body: payload
    })
  }

  async function getStory(storyId: string): Promise<StoryDocument> {
    const response = await $fetch<StoryDocumentResponse>(`${apiBase}/stories/${storyId}`)
    return response.story
  }

  async function saveStoryBible(
    storyId: string,
    storyBible: StoryBibleFile
  ): Promise<StoryBibleFile> {
    const response = await $fetch<StoryBibleResponse>(
      `${apiBase}/stories/${storyId}/story-bible`,
      {
        method: "PUT",
        body: {
          storyBible
        } satisfies SaveStoryBibleRequest
      }
    )

    return response.storyBible
  }

  async function runStoryCreationAgent(
    storyId: string,
    instruction: string,
    baseDraft?: RunStoryCreationAgentRequest["baseDraft"],
    signal?: AbortSignal
  ): Promise<RunStoryCreationAgentResponse> {
    const body = {
      instruction,
      ...(baseDraft ? { baseDraft } : {})
    } satisfies RunStoryCreationAgentRequest

    return $fetch<RunStoryCreationAgentResponse>(
      `${apiBase}/stories/${storyId}/creation-agent/run`,
      {
        method: "POST",
        body,
        signal
      }
    )
  }

  async function applyStoryCreationDraft(
    storyId: string,
    payload: ApplyStoryCreationDraftRequest
  ): Promise<ApplyStoryCreationDraftResponse> {
    return $fetch<ApplyStoryCreationDraftResponse>(
      `${apiBase}/stories/${storyId}/creation-agent/apply`,
      {
        method: "POST",
        body: payload
      }
    )
  }

  async function generateStoryDialogue(
    storyId: string,
    payload: GenerateStoryDialogueRequest,
    signal?: AbortSignal
  ): Promise<GenerateStoryDialogueResponse> {
    return $fetch<GenerateStoryDialogueResponse>(
      `${apiBase}/stories/${storyId}/dialogue-agent/generate`,
      {
        method: "POST",
        body: payload,
        signal
      }
    )
  }

  async function getStoryCreationHistory(storyId: string): Promise<StoryCreationHistoryFile> {
    const response = await $fetch<StoryCreationHistoryResponse>(
      `${apiBase}/stories/${storyId}/creation-history`
    )

    return response.history
  }

  async function saveStoryCreationHistorySession(
    storyId: string,
    session: StoryCreationHistorySession
  ): Promise<SaveStoryCreationHistorySessionResponse> {
    return $fetch<SaveStoryCreationHistorySessionResponse>(
      `${apiBase}/stories/${storyId}/creation-history/${session.id}`,
      {
        method: "PUT",
        body: {
          session
        } satisfies SaveStoryCreationHistorySessionRequest
      }
    )
  }

  async function getAppSettings(): Promise<AppSettingsFile> {
    const response = await $fetch<AppSettingsResponse>(`${apiBase}/settings`)
    return response.settings
  }

  async function getEvent(
    storyId: string,
    eventId: string,
    collectionType: StoryEventCollectionType = "chain"
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
    collectionType: StoryEventCollectionType = "chain"
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
    collectionType: StoryEventCollectionType = "chain"
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

  async function savePlayerOverrideVals(
    storyId: string,
    playerOverrideVals: StoryPlayerOverrideValsFile
  ): Promise<StoryPlayerOverrideValsFile> {
    const response = await $fetch<StoryPlayerOverrideValsResponse>(
      `${apiBase}/stories/${storyId}/player-override-vals`,
      {
        method: "PUT",
        body: {
          playerOverrideVals
        } satisfies SavePlayerOverrideValsRequest
      }
    )

    return response.playerOverrideVals
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

  async function saveItems(storyId: string, items: StoryItemsFile): Promise<StoryItemsFile> {
    const response = await $fetch<StoryItemsResponse>(`${apiBase}/stories/${storyId}/items`, {
      method: "PUT",
      body: {
        items
      } satisfies SaveStoryItemsRequest
    })

    return response.items
  }

  async function saveShop(storyId: string, shop: StoryShopFile): Promise<StoryShopFile> {
    const response = await $fetch<StoryShopResponse>(`${apiBase}/stories/${storyId}/shop`, {
      method: "PUT",
      body: {
        shop
      } satisfies SaveStoryShopRequest
    })

    return response.shop
  }

  async function savePhone(storyId: string, phone: StoryPhoneFile): Promise<StoryPhoneFile> {
    const response = await $fetch<StoryPhoneResponse>(`${apiBase}/stories/${storyId}/phone`, {
      method: "PUT",
      body: {
        phone
      } satisfies SaveStoryPhoneRequest
    })

    return response.phone
  }

  async function saveRefer(storyId: string, refer: StoryReferFile): Promise<StoryReferFile> {
    const response = await $fetch<StoryReferResponse>(`${apiBase}/stories/${storyId}/refer`, {
      method: "PUT",
      body: {
        refer
      } satisfies SaveStoryReferRequest
    })

    return response.refer
  }

  async function saveDoing(storyId: string, doing: StoryDoingFile): Promise<StoryDoingFile> {
    const response = await $fetch<StoryDoingResponse>(`${apiBase}/stories/${storyId}/doing`, {
      method: "PUT",
      body: {
        doing
      } satisfies SaveStoryDoingRequest
    })

    return response.doing
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

  async function generateItemPrompt(
    storyId: string,
    payload: GenerateItemPromptRequest
  ): Promise<string> {
    const response = await $fetch<GenerateItemPromptResponse>(
      `${apiBase}/stories/${storyId}/items/prompt`,
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

  async function generateItemImage(
    storyId: string,
    payload: GenerateItemImageRequest
  ): Promise<StoryAssetMetadata> {
    const response = await $fetch<GenerateItemImageResponse>(
      `${apiBase}/stories/${storyId}/items/image`,
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

  async function compressItemImage(
    storyId: string,
    payload: CompressItemImageRequest
  ): Promise<StoryAssetMetadata> {
    const response = await $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/items/compress`, {
      method: "POST",
      body: payload
    })

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
    applyStoryCreationDraft,
    createStory,
    compressItemImage,
    compressLocationImage,
    compressRoleImage,
    compressSceneAsset,
    exportStory,
    generateStoryDialogue,
    generateItemImage,
    generateItemPrompt,
    generateLocationImage,
    generateLocationPrompt,
    generateRoleImage,
    generateRolePrompt,
    getAppSettings,
    getEvent,
    getStoryCreationHistory,
    getStoryAssetMeta,
    getStoryAssetUrl,
    getStory,
    listStories,
    runStoryCreationAgent,
    deleteEvent,
    saveAppSettings,
    saveDoing,
    saveEvent,
    saveEventLocations,
    saveStoryCreationHistorySession,
    saveItems,
    saveShop,
    savePhone,
    saveRefer,
    savePlayerOverrideVals,
    saveRoles,
    saveScenes,
    saveStoryBible,
    saveSystemVals,
    saveVals,
    uploadStoryAsset,
    validateStory
  }
}
