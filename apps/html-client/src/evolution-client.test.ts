import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { hashEvolutionPackage, type StoryEvolutionManifest, type StoryEvolutionPackage, type StoryTelemetryEvent } from "@story-mgr/evolution"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HtmlEvolutionClient } from "./evolution-client"

let testDirectory: string | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true })
  testDirectory = undefined
})

function makePackage(): StoryEvolutionPackage {
  const unsigned = {
    schema_version: 1 as const,
    package_id: "global-1",
    story_id: "story",
    scope: { type: "global" as const, id: "global" },
    sequence: 1,
    base_content_hash: "a".repeat(64),
    parent_package_ids: [],
    created_at: "2026-01-01T00:00:00.000Z",
    patch: { world_state_patch: { phase: 1 } },
    semantic_model: { model_id: "Xenova/bge-small-zh-v1.5" as const, dimension: 512 as const, normalized: true as const },
    semantic_entries: [],
    world_state_patch: { phase: 1 }
  }
  return { ...unsigned, package_hash: hashEvolutionPackage(unsigned) }
}

function makeManifest(): StoryEvolutionManifest {
  return {
    storyId: "story",
    baseContentHash: "a".repeat(64),
    packageIds: ["global-1"],
    effectiveContentHash: "b".repeat(64),
    semanticModel: { modelId: "Xenova/bge-small-zh-v1.5", dimension: 512, normalized: true },
    worldRevision: 1,
    generatedAt: "2026-01-01T00:00:00.000Z"
  }
}

function telemetry(): StoryTelemetryEvent {
  return {
    eventId: "telemetry-1",
    storyId: "story",
    playerId: "player",
    shardId: "shard",
    sessionId: "session",
    sequence: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    type: "event.completed",
    payload: { eventId: "opening" }
  }
}

describe("HtmlEvolutionClient", () => {
  it("keeps failed telemetry offline and removes it only after a successful retry", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "story-html-evolution-"))
    const client = new HtmlEvolutionClient({ storyId: "story", evolutionDir: testDirectory })
    await client.initialize()
    client.record(telemetry())
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")))

    await expect(client.flushTelemetry()).rejects.toThrow("offline")
    const file = path.join(testDirectory, "telemetry", "telemetry-1.json")
    expect(existsSync(file)).toBe(true)

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: 1, received: 1 }), { status: 200, headers: { "content-type": "application/json" } })))
    await expect(client.flushTelemetry()).resolves.toEqual({ accepted: 1, received: 1 })
    expect(existsSync(file)).toBe(false)
    client.dispose()
  })

  it("caches a validated manifest and package for later offline startup", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "story-html-evolution-"))
    const manifest = makeManifest()
    const pkg = makePackage()
    const onlineFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pkg), { status: 200 }))
    vi.stubGlobal("fetch", onlineFetch)
    const online = new HtmlEvolutionClient({ storyId: "story", evolutionDir: testDirectory })

    expect((await online.fetchManifest()).packageIds).toEqual(["global-1"])
    expect((await online.fetchPackage("global-1", "a".repeat(64))).package_id).toBe("global-1")
    online.dispose()

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    const offline = new HtmlEvolutionClient({ storyId: "story", evolutionDir: testDirectory })
    expect((await offline.fetchManifest()).effectiveContentHash).toBe("b".repeat(64))
    expect((await offline.fetchPackage("global-1", "a".repeat(64))).package_hash).toBe(pkg.package_hash)
    offline.dispose()
  })

  it("rejects a downloaded package with an invalid hash", async () => {
    const invalid = { ...makePackage(), package_hash: "0".repeat(64) }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid), { status: 200 })))
    const client = new HtmlEvolutionClient({ storyId: "story" })
    await expect(client.fetchPackage("global-1", "a".repeat(64))).rejects.toThrow("内容包 hash 无效")
    client.dispose()
  })

  it("rejects unsafe package ids before resolving a cache path", async () => {
    const client = new HtmlEvolutionClient({ storyId: "story", evolutionDir: "ignored" })
    await expect(client.fetchPackage("../outside", "a".repeat(64))).rejects.toThrow("id 无效")
    client.dispose()
  })
})
