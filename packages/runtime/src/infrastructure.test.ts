import { describe, expect, it } from "vitest"
import { createRuntimeRngState, nextRuntimeRandom } from "./rng"
import { sortScheduledEvents, type RuntimeSchedulableEvent } from "./scheduler"

function scheduled(
  id: string,
  options: Partial<RuntimeSchedulableEvent> = {}
): RuntimeSchedulableEvent {
  return {
    instance_id: id,
    source_id: id,
    entry_event_id: id,
    due_game_minute: 60,
    priority: 100,
    after: [],
    before: [],
    seq: 1,
    ...options
  }
}

describe("runtime infrastructure", () => {
  it("replays the same random sequence from persisted state", () => {
    const first = createRuntimeRngState({ storyId: "story", contentHash: "hash" })
    const firstValue = nextRuntimeRandom(first)
    const persisted = { ...first }
    const secondValue = nextRuntimeRandom(first)

    const restoredValue = nextRuntimeRandom(persisted)
    expect(firstValue).toBeGreaterThanOrEqual(0)
    expect(restoredValue).toBe(secondValue)
  })

  it("topologically sorts same-minute events before priority and sequence", () => {
    const events = [
      scheduled("publish", { after: ["calculate"], priority: 1, seq: 1 }),
      scheduled("calculate", { priority: 100, seq: 2 }),
      scheduled("unrelated", { priority: 50, seq: 3 }),
      scheduled("later", { due_game_minute: 120, priority: 0, seq: 4 })
    ]

    sortScheduledEvents(events)
    expect(events.map((event) => event.instance_id)).toEqual([
      "unrelated",
      "calculate",
      "publish",
      "later"
    ])
  })
})
