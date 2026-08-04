/**
 * 故事事件的读取、保存、删除、校验和导出请求。
 * 本模块不决定当前打开哪类事件，只忠实转发调用方给出的 collectionType。
 */
import type { StoryAnyEventFile, StoryEventCollectionType } from "@story-mgr/core"
import type {
  ExportResponse,
  SaveEventRequest,
  StoryDeleteEventResponse,
  StoryEventResponse,
  ValidationResponse
} from "@story-mgr/shared"
import type { StoryApiContext } from "./context"

/** 创建事件领域 API。 */
export function createStoryEventApi(context: StoryApiContext) {
  const { apiBase, runStoryMutation } = context

  /** 读取或计算 `Event`。 @param storyId 调用方传入的 `storyId`。 @param eventId 调用方传入的 `eventId`。 @param collectionType 调用方传入的 `collectionType`。 @returns 计算、查找或构建后的结果。 */
  async function getEvent(
    storyId: string,
    eventId: string,
    collectionType: StoryEventCollectionType = "chain"
  ): Promise<StoryAnyEventFile> {
    const response = await $fetch<StoryEventResponse>(
      `${apiBase}/stories/${storyId}/events/${eventId}`,
      { query: { collectionType } }
    )
    return response.event
  }

  /** 保存 `Event` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param event 调用方传入的 `event`。 @param collectionType 调用方传入的 `collectionType`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveEvent(
    storyId: string,
    event: StoryAnyEventFile,
    collectionType: StoryEventCollectionType = "chain"
  ): Promise<StoryAnyEventFile> {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryEventResponse>(`${apiBase}/stories/${storyId}/events/${event.id}`, {
        method: "PUT",
        body: { collectionType, event, expectedRevision } satisfies SaveEventRequest
      })
    )
    return response.event
  }

  /** 删除指定的 `Event` 数据。 @param storyId 调用方传入的 `storyId`。 @param eventId 调用方传入的 `eventId`。 @param collectionType 调用方传入的 `collectionType`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function deleteEvent(
    storyId: string,
    eventId: string,
    collectionType: StoryEventCollectionType = "chain"
  ): Promise<void> {
    await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryDeleteEventResponse>(`${apiBase}/stories/${storyId}/events/${eventId}`, {
        method: "DELETE",
        query: { collectionType, expectedRevision }
      })
    )
  }

  /** 校验 `Story` 并整理错误信息。 @param storyId 调用方传入的 `storyId`。 @returns 计算、查找或构建后的结果。 */
  async function validateStory(storyId: string) {
    const response = await $fetch<ValidationResponse>(`${apiBase}/stories/${storyId}/validate`, {
      method: "POST"
    })
    return response.result
  }

  /** 执行 `exportStory` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @returns 计算、查找或构建后的结果。 */
  async function exportStory(storyId: string) {
    return $fetch<ExportResponse>(`${apiBase}/stories/${storyId}/export`, { method: "POST" })
  }

  return { deleteEvent, exportStory, getEvent, saveEvent, validateStory }
}
