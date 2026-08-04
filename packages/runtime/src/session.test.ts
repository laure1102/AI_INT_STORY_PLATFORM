import { describe, expect, it } from "vitest"
import {
  createStorySession,
  type RuntimeScheduledEvent,
  type RuntimeStoryBundle,
  type RuntimeStorySaveState,
  type RuntimeStorySession
} from "./session"

function createBundle(options: Partial<RuntimeStoryBundle> = {}): RuntimeStoryBundle {
  return {
    schemaVersion: 2,
    contentHash: "test-content-hash",
    storyId: "runtime_test",
    title: "Runtime Test",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vals: { variables: [] },
    playerOverrideVals: { entries: [] },
    systemVals: { variables: [] },
    scenes: { scenes: [] },
    roles: { normal: { roles: [] }, important: { roles: [] } },
    eventLocations: { assignments: [] },
    chainEvents: {},
    poolEvents: [],
    scheduleEvents: [],
    ...options
  }
}

function createSave(
  session: RuntimeStorySession,
  bundle: RuntimeStoryBundle,
  slotId = "slot-1"
): RuntimeStorySaveState {
  return {
    schema_version: 2,
    slot_id: slotId,
    story_id: bundle.storyId,
    profile_id: "profile-1",
    bundle_content_hash: bundle.contentHash ?? bundle.generatedAt,
    saved_at: "2026-01-01T00:00:00.000Z",
    playback: session.getPlaybackState(),
    session_state: session.getSnapshot()
  }
}

describe("RuntimeStorySession v2 saves", () => {
  it("restores the exact dialogue cursor without replaying init", () => {
    const bundle = createBundle({
      chainEvents: {
        opening: {
          node_type: "event",
          id: "opening",
          title: "Opening",
          init_script: "",
          end_script: "",
          object_keys: ["player"],
          presentation: {
            type: "dialogue",
            dialogues: [
              { speaker_type: "player", speaker_key: "player", content: "first" },
              { speaker_type: "player", speaker_key: "player", content: "second" }
            ]
          },
          location: "",
          next: []
        }
      }
    })
    const session = createStorySession({ bundle })
    session.dispatch({ type: "continue" })
    const beforeSaveHistory = session.getSnapshot().history.length

    const restored = createStorySession({ bundle, saveState: createSave(session, bundle) })
    const view = restored.getViewModel()

    expect(view.currentDialogue?.content).toBe("second")
    expect(view.currentDialogue?.index).toBe(2)
    expect(restored.getSnapshot().history).toHaveLength(beforeSaveHistory)
  })

  it("migrates a v1 save by replaying the current event with a notice", () => {
    const bundle = createBundle({
      chainEvents: {
        opening: {
          node_type: "event",
          id: "opening",
          title: "Opening",
          init_script: "",
          end_script: "",
          object_keys: ["player"],
          presentation: {
            type: "dialogue",
            dialogues: [
              { speaker_type: "player", speaker_key: "player", content: "first" },
              { speaker_type: "player", speaker_key: "player", content: "second" }
            ]
          },
          location: "",
          next: []
        }
      }
    })
    const session = createStorySession({ bundle })
    session.dispatch({ type: "continue" })
    const v1Save = {
      slot_id: "legacy",
      story_id: bundle.storyId,
      profile_id: "profile-1",
      bundle_version: bundle.generatedAt,
      saved_at: "2026-01-01T00:00:00.000Z",
      session_state: session.getSnapshot()
    } as unknown as RuntimeStorySaveState

    const restored = createStorySession({ bundle, saveState: v1Save })
    const view = restored.getViewModel()

    expect(view.currentDialogue?.content).toBe("first")
    expect(view.notifications).toContain("旧版存档缺少播放游标，当前事件将从开头重放。")
  })

  it("persists deterministic RNG state across a save", () => {
    const bundle = createBundle({
      vals: {
        variables: [
          {
            name: "player",
            vals: [
              { name: "roll", value_type: "value", value: 0, calc_rule: "" }
            ]
          }
        ]
      },
      chainEvents: {
        first: {
          node_type: "event",
          id: "first",
          title: "First",
          init_script: "${player.roll} = Math.random();",
          end_script: "",
          object_keys: ["player"],
          presentation: { type: "message", message: { content: "first", duration_seconds: 60 } },
          location: "",
          next: ["second"]
        },
        second: {
          node_type: "event",
          id: "second",
          title: "Second",
          init_script: "${player.roll} = Math.random();",
          end_script: "",
          object_keys: ["player"],
          presentation: { type: "message", message: { content: "second", duration_seconds: 60 } },
          location: "",
          next: []
        }
      }
    })
    const uninterrupted = createStorySession({ bundle })
    const restored = createStorySession({
      bundle,
      saveState: createSave(uninterrupted, bundle)
    })

    uninterrupted.dispatch({ type: "continue" })
    restored.dispatch({ type: "continue" })

    const readRoll = (session: RuntimeStorySession) =>
      session.getSnapshot().vals.variables[0]?.vals[0]?.value
    expect(readRoll(restored)).toBe(readRoll(uninterrupted))
    expect(restored.getSnapshot().rng).toEqual(uninterrupted.getSnapshot().rng)
  })
})

describe("Runtime schedule dependency ordering", () => {
  it("topologically orders same-minute events before priority and sequence", () => {
    const scheduleEvents = [
      { id: "a", priority: 1, after: ["b"] },
      { id: "b", priority: 100, after: ["c"] },
      { id: "c", priority: 200, after: [] }
    ]
    const bundle = createBundle({
      scheduleEvents: scheduleEvents.map((event) => ({
        id: event.id,
        title: event.id.toUpperCase(),
        trigger_mode: "default",
        trigger_expr: "",
        invoke_params: [],
        init_script: "",
        end_script: "",
        object_keys: [],
        presentation: { type: "message", message: { content: event.id, duration_seconds: 60 } },
        location: "",
        bgm: "",
        loop: { mode: "daily", at: "00:00", priority: event.priority, after: event.after, before: [] }
      }))
    })
    const emptySession = createStorySession({ bundle: createBundle() })
    const snapshot = emptySession.getSnapshot()
    const scheduled: RuntimeScheduledEvent[] = scheduleEvents.map((event, index) => ({
      instance_id: `manual-${event.id}`,
      source_type: "schedule",
      source_id: event.id,
      entry_event_id: event.id,
      due_game_minute: 0,
      priority: event.priority,
      after: event.after,
      before: [],
      seq: index + 1,
      dedupe_key: `manual-${event.id}`,
      call_values: {},
      trigger_locked: true,
      status: "scheduled"
    }))
    snapshot.scheduler.scheduled = scheduled
    snapshot.scheduler.next_seq = 4
    const session = createStorySession({ bundle, saveState: {
      schema_version: 2,
      slot_id: "seed",
      story_id: "runtime_test",
      profile_id: "profile-1",
      bundle_content_hash: "test-content-hash",
      saved_at: "2026-01-01T00:00:00.000Z",
      playback: emptySession.getPlaybackState(),
      session_state: snapshot
    } })
    expect(session.getViewModel().activeEventId).toBe("c")
    session.dispatch({ type: "continue" })
    expect(session.getViewModel().activeEventId).toBe("b")
    session.dispatch({ type: "continue" })
    expect(session.getViewModel().activeEventId).toBe("a")
  })
})
