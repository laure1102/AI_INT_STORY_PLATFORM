import type { CompiledStory, StoryDocument } from "@story-mgr/core"
import { validateStoryDocument } from "@story-mgr/core"

export function compileStory(document: StoryDocument): {
  compiled: CompiledStory
  result: ReturnType<typeof validateStoryDocument>
} {
  const graphEvents = Object.fromEntries(
    document.graphEvents.map((event) => [
      event.id,
      "exec_script" in event
        ? {
            node_type: "action" as const,
            id: event.id,
            title: event.title,
            vars: event.vars,
            exec_script: event.exec_script,
            next: event.next,
            meta: event.meta
          }
        : {
            node_type: "event" as const,
            id: event.id,
            title: event.title,
            trigger_expr: event.trigger_expr,
            init_script: event.init_script,
            end_script: event.end_script,
            object_keys: event.object_keys,
            dialogues: event.dialogues,
            location: event.location,
            next: event.next,
            meta: event.meta
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
      systemVals: document.systemVals,
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
