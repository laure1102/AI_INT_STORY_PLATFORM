import type { CompiledStory, StoryDocument } from "@story-mgr/core"
import { validateStoryDocument } from "@story-mgr/core"

export function compileStory(document: StoryDocument): {
  compiled: CompiledStory
  result: ReturnType<typeof validateStoryDocument>
} {
  const chainEventsSource = document.chainEvents ?? document.graphEvents
  const poolEventsSource = document.poolEvents ?? document.onceEvents
  const scheduleEventsSource = document.scheduleEvents ?? document.loopEvents
  const chainEvents = Object.fromEntries(
    chainEventsSource.map((event) => [
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
            trigger_mode: event.trigger_mode,
            trigger_expr: event.trigger_expr,
            invoke_params: event.invoke_params,
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
      vals: document.vals,
      playerOverrideVals: document.playerOverrideVals,
      systemVals: document.systemVals,
      scenes: document.scenes,
      roles: document.roles,
      eventLocations: document.eventLocations,
      items: document.items,
      chainEvents,
      poolEvents: poolEventsSource,
      scheduleEvents: scheduleEventsSource,
      graphEvents: chainEvents,
      onceEvents: poolEventsSource,
      loopEvents: scheduleEventsSource
    },
    result: validateStoryDocument(document)
  }
}
