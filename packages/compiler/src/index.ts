import type { CompiledStory, StoryDocument } from "@story-mgr/core"
import { validateStoryDocument } from "@story-mgr/core"

export function compileStory(document: StoryDocument): {
  compiled: CompiledStory
  result: ReturnType<typeof validateStoryDocument>
} {
  const graphEvents = Object.fromEntries(
    document.graphEvents.map((event) => [
      event.id,
      {
        id: event.id,
        title: event.title,
        kind: event.kind,
        body: event.body,
        next: event.next
      }
    ])
  )

  return {
    compiled: {
      storyId: document.story.id,
      title: document.story.title,
      generatedAt: new Date().toISOString(),
      entryEventId: document.story.startEventId,
      vals: document.vals,
      scenes: document.scenes,
      roles: document.roles,
      eventLocations: document.eventLocations,
      graphEvents,
      bigOnceEvents: document.bigOnceEvents,
      loopEvents: document.loopEvents
    },
    result: validateStoryDocument(document)
  }
}
