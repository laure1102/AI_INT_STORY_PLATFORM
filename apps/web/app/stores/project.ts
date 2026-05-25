export const useProjectStore = defineStore("project", () => {
  const selectedEventIds = reactive<Record<string, string>>({})

  function selectEvent(storyId: string, eventId: string) {
    selectedEventIds[storyId] = eventId
  }

  function clearEvent(storyId: string) {
    delete selectedEventIds[storyId]
  }

  function getSelectedEventId(storyId: string) {
    return selectedEventIds[storyId] ?? null
  }

  return {
    clearEvent,
    getSelectedEventId,
    selectEvent,
    selectedEventIds
  }
})
