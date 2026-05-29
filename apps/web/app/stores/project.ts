import type { StoryEventCollectionType } from "@story-mgr/core"

export const useProjectStore = defineStore("project", () => {
  const selectedEventIds = reactive<Record<string, Partial<Record<StoryEventCollectionType, string>>>>({})

  function selectEvent(
    storyId: string,
    collectionType: StoryEventCollectionType,
    eventId: string
  ) {
    selectedEventIds[storyId] ??= {}
    selectedEventIds[storyId][collectionType] = eventId
  }

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
