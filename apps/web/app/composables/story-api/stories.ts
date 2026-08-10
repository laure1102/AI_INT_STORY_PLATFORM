/**
 * 故事文档及其配置文件的 HTTP 请求。
 *
 * 输入是编辑器中的完整领域对象，输出是服务端确认后的对象。
 * 所有保存都通过共享上下文附带 `expectedRevision`，本模块不管理弹窗状态。
 */
import type {
  StoryBibleFile,
  StoryDocument,
  StoryDoingFile,
  StoryEventLocationFile,
  StoryItemsFile,
  StoryMetaFile,
  StoryContactConversationsFile,
  StoryContactFile,
  StoryPlayerOverrideValsFile,
  StoryReferFile,
  StoryRolesFile,
  StorySceneFile,
  StoryShopFile,
  StoryValsFile
} from "@story-mgr/core"
import type {
  CreateStoryRequest,
  CreateStoryResponse,
  SaveEventLocationsRequest,
  SavePlayerOverrideValsRequest,
  SaveRolesRequest,
  SaveScenesRequest,
  SaveStoryBibleRequest,
  SaveStoryDoingRequest,
  SaveStoryItemsRequest,
  SaveStoryMetaRequest,
  SaveStoryContactConversationsRequest,
  SaveStoryContactRequest,
  SaveStoryReferRequest,
  SaveStoryShopRequest,
  SaveSystemValsRequest,
  SaveValsRequest,
  StoryBibleResponse,
  StoryDocumentResponse,
  StoryDoingResponse,
  StoryEventLocationsResponse,
  StoryItemsResponse,
  StoryListResponse,
  StoryMetaResponse,
  StoryContactConversationsResponse,
  StoryContactResponse,
  StoryPlayerOverrideValsResponse,
  StoryReferResponse,
  StoryRolesResponse,
  StoryScenesResponse,
  StoryShopResponse,
  StorySystemValsResponse,
  StoryValsResponse
} from "@story-mgr/shared"
import type { StoryApiContext } from "./context"

/** 创建故事文档读写 API。 */
export function createStoryDocumentApi(context: StoryApiContext) {
  const { apiBase, runStoryMutation, setStoryRevision } = context

  /** 执行 `listStories` 对应的局部业务逻辑。 @returns 计算、查找或构建后的结果。 */
  async function listStories() {
    const response = await $fetch<StoryListResponse>(`${apiBase}/stories`)
    return response.stories
  }

  /** 创建一份新的 `Story` 数据。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function createStory(payload: CreateStoryRequest): Promise<CreateStoryResponse> {
    const response = await $fetch<CreateStoryResponse>(`${apiBase}/stories`, {
      method: "POST",
      body: payload
    })
    setStoryRevision(response.story.story.id, response.revision)
    return response
  }

  /** 读取或计算 `Story`。 @param storyId 调用方传入的 `storyId`。 @returns 计算、查找或构建后的结果。 */
  async function getStory(storyId: string): Promise<StoryDocument> {
    const response = await $fetch<StoryDocumentResponse>(`${apiBase}/stories/${storyId}`)
    setStoryRevision(storyId, response.revision)
    return response.story
  }

  /** 保存 `StoryMeta` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param story 调用方传入的 `story`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveStoryMeta(storyId: string, story: StoryMetaFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryMetaResponse>(`${apiBase}/stories/${storyId}/story`, {
        method: "PUT",
        body: { story, expectedRevision } satisfies SaveStoryMetaRequest
      })
    )
    return response.story
  }

  /** 保存 `StoryBible` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param storyBible 调用方传入的 `storyBible`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveStoryBible(storyId: string, storyBible: StoryBibleFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryBibleResponse>(`${apiBase}/stories/${storyId}/story-bible`, {
        method: "PUT",
        body: { storyBible, expectedRevision } satisfies SaveStoryBibleRequest
      })
    )
    return response.storyBible
  }

  /** 保存 `Vals` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param vals 调用方传入的 `vals`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveVals(storyId: string, vals: StoryValsFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryValsResponse>(`${apiBase}/stories/${storyId}/vals`, {
        method: "PUT",
        body: { vals, expectedRevision } satisfies SaveValsRequest
      })
    )
    return response.vals
  }

  /** 保存 `SystemVals` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param systemVals 调用方传入的 `systemVals`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveSystemVals(storyId: string, systemVals: StoryValsFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StorySystemValsResponse>(`${apiBase}/stories/${storyId}/system-vals`, {
        method: "PUT",
        body: { systemVals, expectedRevision } satisfies SaveSystemValsRequest
      })
    )
    return response.systemVals
  }

  /** 保存 `PlayerOverrideVals` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param playerOverrideVals 调用方传入的 `playerOverrideVals`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function savePlayerOverrideVals(
    storyId: string,
    playerOverrideVals: StoryPlayerOverrideValsFile
  ) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryPlayerOverrideValsResponse>(`${apiBase}/stories/${storyId}/player-override-vals`, {
        method: "PUT",
        body: { playerOverrideVals, expectedRevision } satisfies SavePlayerOverrideValsRequest
      })
    )
    return response.playerOverrideVals
  }

  /** 保存 `Scenes` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param scenes 调用方传入的 `scenes`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveScenes(storyId: string, scenes: StorySceneFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryScenesResponse>(`${apiBase}/stories/${storyId}/scenes`, {
        method: "PUT",
        body: { scenes, expectedRevision } satisfies SaveScenesRequest
      })
    )
    return response.scenes
  }

  /** 保存 `Roles` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param roles 调用方传入的 `roles`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveRoles(storyId: string, roles: StoryRolesFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryRolesResponse>(`${apiBase}/stories/${storyId}/roles`, {
        method: "PUT",
        body: { roles, expectedRevision } satisfies SaveRolesRequest
      })
    )
    return response.roles
  }

  /** 保存 `EventLocations` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param eventLocations 调用方传入的 `eventLocations`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveEventLocations(storyId: string, eventLocations: StoryEventLocationFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryEventLocationsResponse>(`${apiBase}/stories/${storyId}/event-locations`, {
        method: "PUT",
        body: { eventLocations, expectedRevision } satisfies SaveEventLocationsRequest
      })
    )
    return response.eventLocations
  }

  /** 保存 `Items` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param items 调用方传入的 `items`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveItems(storyId: string, items: StoryItemsFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryItemsResponse>(`${apiBase}/stories/${storyId}/items`, {
        method: "PUT",
        body: { items, expectedRevision } satisfies SaveStoryItemsRequest
      })
    )
    return response.items
  }

  /** 保存 `Shop` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param shop 调用方传入的 `shop`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveShop(storyId: string, shop: StoryShopFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryShopResponse>(`${apiBase}/stories/${storyId}/shop`, {
        method: "PUT",
        body: { shop, expectedRevision } satisfies SaveStoryShopRequest
      })
    )
    return response.shop
  }

  /** 保存 `Contact` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param contact 调用方传入的 `contact`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveContact(storyId: string, contact: StoryContactFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryContactResponse>(`${apiBase}/stories/${storyId}/contact`, {
        method: "PUT",
        body: { contact, expectedRevision } satisfies SaveStoryContactRequest
      })
    )
    return response.contact
  }

  /** 保存 `ContactConversations` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param contactConversations 调用方传入的 `contactConversations`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveContactConversations(
    storyId: string,
    contactConversations: StoryContactConversationsFile
  ) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryContactConversationsResponse>(`${apiBase}/stories/${storyId}/contact-conversations`, {
        method: "PUT",
        body: { contactConversations, expectedRevision } satisfies SaveStoryContactConversationsRequest
      })
    )
    return response.contactConversations
  }

  /** 保存 `Refer` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param refer 调用方传入的 `refer`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveRefer(storyId: string, refer: StoryReferFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryReferResponse>(`${apiBase}/stories/${storyId}/refer`, {
        method: "PUT",
        body: { refer, expectedRevision } satisfies SaveStoryReferRequest
      })
    )
    return response.refer
  }

  /** 保存 `Doing` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param doing 调用方传入的 `doing`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveDoing(storyId: string, doing: StoryDoingFile) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryDoingResponse>(`${apiBase}/stories/${storyId}/doing`, {
        method: "PUT",
        body: { doing, expectedRevision } satisfies SaveStoryDoingRequest
      })
    )
    return response.doing
  }

  return {
    createStory,
    getStory,
    listStories,
    saveDoing,
    saveEventLocations,
    saveItems,
    saveContact,
    saveContactConversations,
    savePlayerOverrideVals,
    saveRefer,
    saveRoles,
    saveScenes,
    saveShop,
    saveStoryBible,
    saveStoryMeta,
    saveSystemVals,
    saveVals
  }
}
