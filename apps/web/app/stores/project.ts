import type { StoryEventCollectionType } from "@story-mgr/core"

export const useProjectStore = defineStore("project", () => {
  const selectedEventIds = reactive<Record<string, Partial<Record<StoryEventCollectionType, string>>>>({})

  /** 执行 `selectEvent` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param collectionType 调用方传入的 `collectionType`。 @param eventId 调用方传入的 `eventId`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
  function selectEvent(
    storyId: string,
    collectionType: StoryEventCollectionType,
    eventId: string
  ) {
    selectedEventIds[storyId] ??= {}
    selectedEventIds[storyId][collectionType] = eventId
  }

  /** 重置或清理 `clearEvent` 对应的临时状态。 @param storyId 调用方传入的 `storyId`。 @param collectionType 调用方传入的 `collectionType`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function clearEvent(storyId: string, collectionType?: StoryEventCollectionType) {
    if (!selectedEventIds[storyId]) {
      return
    }

    if (!collectionType) {
      delete selectedEventIds[storyId]
      return
    }

    delete selectedEventIds[storyId][collectionType]

    if (!Object.keys(selectedEventIds[storyId]).length) {
      delete selectedEventIds[storyId]
    }
  }

  /** 读取或计算 `SelectedEventId`。 @param storyId 调用方传入的 `storyId`。 @param collectionType 调用方传入的 `collectionType`。 @returns 计算、查找或构建后的结果。 */
  function getSelectedEventId(
    storyId: string,
    collectionType: StoryEventCollectionType
  ) {
    return selectedEventIds[storyId]?.[collectionType] ?? null
  }

  return {
    clearEvent,
    getSelectedEventId,
    selectEvent,
    selectedEventIds
  }
})
