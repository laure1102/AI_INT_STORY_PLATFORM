import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { compileStory } from "@story-mgr/compiler"
import { createStoryFileStore } from "@story-mgr/file-store"
import type { StoryTelemetryEvent } from "@story-mgr/evolution"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createHtmlClientApp } from "./client-app"

let testDirectory: string | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true })
  testDirectory = undefined
})

describe("HtmlClientApp evolution telemetry", () => {
  it("reports structured event, milestone and doing behavior without raw player text", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "story-html-app-"))
    const dataDir = path.join(testDirectory, "data")
    const runtimeDir = path.join(testDirectory, "runtime")
    const store = createStoryFileStore(dataDir)
    await store.createStory({ id: "story", title: "Telemetry Story" })
    await store.writeVals("story", { variables: [{ name: "player", vals: [{ name: "money", value_type: "value", value: 0, calc_rule: "" }] }] })
    await store.writeEvent("story", "opening", {
      node_type: "event",
      id: "opening",
      title: "Opening",
      trigger_mode: "default",
      trigger_expr: "",
      invoke_params: [],
      init_script: "",
      end_script: "",
      object_keys: [],
      presentation: { type: "dialogue", dialogues: [{ speaker_type: "player", speaker_key: "player", content: "private dialogue" }] },
      location: "",
      next: [],
      meta: { milestone_id: "opening-finished" }
    }, "chain")
    await store.writeDoing("story", {
      menus: [{ id: "daily", title: "Daily", parent_id: "", sort_order: 1, visible_expr: "", descr: "" }],
      doings: [{
        id: "walk",
        title: "Walk",
        menu_id: "daily",
        descr: "",
        visible_expr: "",
        cooldown_hours: 0,
        once: false,
        init_script: "",
        object_keys: [],
        presentation: { type: "silent" },
        location: "",
        bgm: "",
        end_script: ""
      }]
    })
    const baseContentHash = compileStory(await store.readStoryDocument("story")).compiled.contentHash
    const submitted: StoryTelemetryEvent[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/evolution/manifest")) {
        return new Response(JSON.stringify({
          storyId: "story",
          baseContentHash,
          packageIds: [],
          effectiveContentHash: baseContentHash,
          semanticModel: { modelId: "Xenova/bge-small-zh-v1.5", dimension: 512, normalized: true },
          worldRevision: 0,
          generatedAt: "2026-01-01T00:00:00.000Z"
        }), { status: 200 })
      }
      if (url.includes("/evolution/telemetry")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { events?: StoryTelemetryEvent[] }
        submitted.push(...(body.events ?? []))
        return new Response(JSON.stringify({ accepted: body.events?.length ?? 0, received: body.events?.length ?? 0 }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }))

    const app = createHtmlClientApp({
      storyId: "story",
      dataDir,
      runtimeDir,
      playerId: "player-1",
      shardId: "shard-1",
      evolutionPollIntervalMs: 0,
      now: new Date("2026-01-01T00:00:00.000Z")
    })
    await app.syncStoryBundle()
    await app.createProfile({ profileId: "player-1", profileName: "Player" })
    await app.startNewGame()
    app.dispatch({ type: "continue" })
    app.dispatch({ type: "start-doing", doingId: "walk" })

    for (let attempt = 0; attempt < 100 && submitted.length < 3; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(submitted.map((event) => event.type)).toEqual(expect.arrayContaining(["event.completed", "milestone.reached", "doing.used"]))
    expect(submitted.find((event) => event.type === "event.completed")?.payload).toEqual({ eventId: "opening" })
    expect(submitted.find((event) => event.type === "milestone.reached")?.payload).toEqual({ milestoneId: "opening-finished" })
    expect(JSON.stringify(submitted)).not.toContain("private dialogue")
    app.dispose()
  })
})
