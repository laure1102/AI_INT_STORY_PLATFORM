import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { hashEvolutionPackage, type StoryEvolutionPackage, type StoryEvolutionScope, type StoryTelemetryEvent } from "@story-mgr/evolution"
import { createStoryFileStore, type StoryFileStore } from "@story-mgr/file-store"
import { afterEach, describe, expect, it } from "vitest"
import type { EvolutionEmbeddingProvider } from "./evolution-embedding"
import { EvolutionService, type EvolutionJob, type EvolutionServiceOptions } from "./evolution"
import type { EvolutionWorkflowInput } from "./evolution-workflow"

interface TestContext {
  directory: string
  stateDir: string
  store: StoryFileStore
  service: EvolutionService
}

const cleanups: Array<() => Promise<void>> = []

const embeddingProvider: EvolutionEmbeddingProvider = {
  modelId: "Xenova/bge-small-zh-v1.5",
  dimension: 512,
  normalized: true,
  async embedMany(texts) {
    return texts.map(() => [1, ...Array(511).fill(0)] as number[])
  }
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function makePackage(input: EvolutionWorkflowInput, overrides: Partial<StoryEvolutionPackage> = {}): StoryEvolutionPackage {
  const unsigned = {
    schema_version: 1 as const,
    package_id: overrides.package_id ?? `pkg-${input.scope.type}-${input.sequence}`,
    story_id: input.storyId,
    scope: input.scope,
    sequence: input.sequence,
    base_content_hash: input.baseContentHash,
    parent_package_ids: [...input.parentPackageIds],
    created_at: new Date().toISOString(),
    patch: { world_state_patch: { revision: input.sequence } },
    semantic_model: {
      model_id: "Xenova/bge-small-zh-v1.5" as const,
      dimension: 512 as const,
      normalized: true as const
    },
    semantic_entries: [],
    world_state_patch: { revision: input.sequence },
    ...overrides
  }
  const { package_hash: _ignored, ...unsignedPackage } = unsigned as typeof unsigned & { package_hash?: string }
  return { ...unsignedPackage, package_hash: hashEvolutionPackage(unsignedPackage) }
}

async function createContext(options: EvolutionServiceOptions = {}): Promise<TestContext> {
  const directory = await mkdtemp(path.join(tmpdir(), "story-mgr-evolution-"))
  const stateDir = path.join(directory, ".story-manager")
  const store = createStoryFileStore(directory)
  await store.createStory({ id: "story", title: "Evolution Test" })
  await store.writeVals("story", {
    variables: [{
      name: "player",
      vals: [{ name: "money", value_type: "value", value: 0, calc_rule: "" }]
    }]
  })
  const service = new EvolutionService(store, stateDir, { embeddingProvider, ...options })
  const context = { directory, stateDir, store, service }
  cleanups.push(async () => {
    await service.close()
    await rm(directory, { recursive: true, force: true })
  })
  return context
}

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  await new Promise<void>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
  })
}

async function waitForJob(service: EvolutionService, jobId: string, statuses: EvolutionJob["status"] | EvolutionJob["status"][]): Promise<EvolutionJob> {
  const expected = new Set(Array.isArray(statuses) ? statuses : [statuses])
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = service.getJob("story", jobId)
    if (job && expected.has(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for job ${jobId}: ${[...expected].join(", ")}.`)
}

function event(sequence: number, overrides: Partial<StoryTelemetryEvent> = {}): StoryTelemetryEvent {
  return {
    eventId: `event-${sequence}`,
    storyId: "story",
    playerId: "player-1",
    shardId: "shard-1",
    sessionId: "session-1",
    sequence,
    occurredAt: new Date().toISOString(),
    type: "event.completed",
    payload: { eventId: `plot-${sequence}` },
    ...overrides
  }
}

describe("EvolutionService", () => {
  it("reads the latest editor Evolution model settings when a job starts", async () => {
    let receivedModel: EvolutionWorkflowInput["model"]
    const { service, store } = await createContext({
      workflowRunner: async (input) => {
        receivedModel = input.model
        return makePackage(input)
      }
    })
    await store.writeAppSettings({
      ai: {
        text: { apiKey: "", baseUrl: "", model: "" },
        image: { apiKey: "", baseUrl: "", model: "" },
        agent: {
          apiKey: "stored-agent-key",
          baseUrl: "https://stored-agent.example/v1",
          evolutionModel: "stored-evolution-model",
          chiefEditorModel: "",
          plotPlannerModel: "",
          assetDesignerModel: "",
          eventWriterModel: "",
          scriptDoctorModel: "",
          consistencyCheckerModel: "",
          temperature: 0.7
        }
      }
    })

    const created = await service.createJob("story", "advance", { type: "global", id: "global" })
    await waitForJob(service, created.id, "completed")

    expect(receivedModel).toEqual({
      apiKey: "stored-agent-key",
      baseUrl: "https://stored-agent.example/v1",
      model: "stored-evolution-model"
    })
  })

  it("publishes completed jobs and exposes their immutable package", async () => {
    const { service } = await createContext({ workflowRunner: async (input) => makePackage(input) })
    const created = await service.createJob("story", "advance", { type: "global", id: "global" })
    const completed = await waitForJob(service, created.id, "completed")

    expect(completed.packageId).toBe("pkg-global-1")
    expect((await service.getManifestAsync("story")).packageIds).toEqual(["pkg-global-1"])
    expect((await service.readPackage("story", "pkg-global-1"))?.package_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("fails invalid packages, quarantines them and keeps the manifest unchanged", async () => {
    const { service, stateDir } = await createContext({ workflowRunner: async (input) => makePackage(input, { base_content_hash: "f".repeat(64) }) })
    const created = await service.createJob("story", "invalid", { type: "global", id: "global" })
    const failed = await waitForJob(service, created.id, "failed")

    expect(failed.error).toContain("基础内容 hash 不匹配")
    expect((await service.getManifestAsync("story")).packageIds).toEqual([])
    const db = new Database(path.join(stateDir, "evolution.sqlite"), { readonly: true })
    try {
      const row = db.prepare("SELECT reason FROM evolution_package_quarantine WHERE package_id=?").get("pkg-global-1") as { reason: string } | undefined
      expect(row?.reason).toContain("基础内容 hash 不匹配")
    } finally {
      db.close()
    }
  })

  it("propagates cancellation and releases the scope for a later job", async () => {
    let aborted = false
    const { service } = await createContext({
      workflowRunner: async (input) => {
        if (input.signal?.aborted) aborted = true
        input.signal?.addEventListener("abort", () => { aborted = true }, { once: true })
        await waitForAbort(input.signal)
        return makePackage(input)
      }
    })
    const created = await service.createJob("story", "wait", { type: "global", id: "global" })
    await waitForJob(service, created.id, "running")
    expect(service.cancelJob("story", created.id)?.status).toBe("cancelled")
    await waitForJob(service, created.id, "cancelled")
    for (let attempt = 0; attempt < 100 && !aborted; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const next = await service.createJob("story", "next", { type: "global", id: "global" }, { package: await packageForService(service, { type: "global", id: "global" }, 1) })
    expect((await waitForJob(service, next.id, "completed")).status).toBe("completed")
  })

  it("deduplicates telemetry, rejects replay and aggregates player, shard and global windows", async () => {
    const { service } = await createContext({ workflowRunner: async (input) => makePackage(input) })
    const first = event(1)
    const result = service.ingestTelemetry([
      first,
      first,
      event(1, { eventId: "replay" }),
      event(2, { eventId: "invalid", payload: { eventId: "plot", rawText: "not allowed" } })
    ])

    expect(result).toEqual({ accepted: 1, received: 4 })
    const evaluated = await Promise.all([
      service.evaluate("story", { type: "player", id: "player-1" }, "player"),
      service.evaluate("story", { type: "shard", id: "shard-1" }, "shard"),
      service.evaluate("story", { type: "global", id: "global" }, "global")
    ])
    expect(evaluated.map((item) => item.metrics["event.completed"])).toEqual([1, 1, 1])
    expect(evaluated.every((item) => item.triggered === false)).toBe(true)
  })

  it("builds global to shard to player parent chains and clears dependent heads on rollback", async () => {
    const workflowInputs: EvolutionWorkflowInput[] = []
    const { service } = await createContext({ workflowRunner: async (input) => {
      workflowInputs.push(input)
      return makePackage(input)
    } })
    const global = await service.createJob("story", "global", { type: "global", id: "global" })
    await waitForJob(service, global.id, "completed")
    const shard = await service.createJob("story", "shard", { type: "shard", id: "shard-1" })
    await waitForJob(service, shard.id, "completed")
    const player = await service.createJob("story", "player", { type: "player", id: "player-1" }, { context: { shardId: "shard-1" } })
    await waitForJob(service, player.id, "completed")

    const manifest = await service.getManifestAsync("story", "player-1", "shard-1")
    expect(manifest.packageIds).toEqual(["pkg-global-1", "pkg-shard-1", "pkg-player-1"])
    expect((await service.readPackage("story", "pkg-player-1"))?.parent_package_ids).toEqual(["pkg-global-1", "pkg-shard-1"])

    service.rollback("story", { type: "global", id: "global" }, null)
    expect((await service.getManifestAsync("story", "player-1", "shard-1")).packageIds).toEqual([])
    const afterRollback = await service.createJob("story", "after rollback", { type: "global", id: "global" })
    await waitForJob(service, afterRollback.id, "completed")
    expect(workflowInputs.at(-1)?.context?.worldState).toEqual({})
  })

  it("rejects a duplicate sequence in the same scope without replacing the active head", async () => {
    const { service } = await createContext({ workflowRunner: async (input) => makePackage(input) })
    const first = await service.createJob("story", "first", { type: "global", id: "global" })
    await waitForJob(service, first.id, "completed")
    const duplicate = await packageForService(service, { type: "global", id: "global" }, 1, "duplicate")
    const second = await service.createJob("story", "duplicate", { type: "global", id: "global" }, { package: duplicate })

    expect((await waitForJob(service, second.id, "failed")).error).toContain("sequence 已经发布")
    expect((await service.getManifestAsync("story")).packageIds).toEqual(["pkg-global-1"])
  })

  it("recovers an interrupted running job from the persistent checkpoint queue", async () => {
    const { directory, stateDir, store, service } = await createContext({
      workflowRunner: async (input) => {
        await waitForAbort(input.signal)
        return makePackage(input)
      }
    })
    const created = await service.createJob("story", "resume", { type: "global", id: "global" })
    await waitForJob(service, created.id, "running")
    await service.close()

    const resumed = new EvolutionService(store, stateDir, { embeddingProvider, workflowRunner: async (input) => makePackage(input) })
    cleanups.pop()
    cleanups.push(async () => {
      await resumed.close()
      await rm(directory, { recursive: true, force: true })
    })
    expect((await waitForJob(resumed, created.id, "completed")).packageId).toBe("pkg-global-1")
  })
})

async function packageForService(service: EvolutionService, scope: StoryEvolutionScope, sequence: number, packageId = `pkg-${scope.type}-${sequence}`): Promise<StoryEvolutionPackage> {
  const manifest = await service.getManifestAsync("story", scope.type === "player" ? scope.id : "", scope.type === "shard" ? scope.id : "")
  return makePackage({
    storyId: "story",
    instruction: "test",
    scope,
    document: {} as EvolutionWorkflowInput["document"],
    baseContentHash: manifest.baseContentHash,
    parentPackageIds: manifest.packageIds,
    parentPackages: [],
    sequence,
    context: { worldState: {}, aggregates: {} },
    checkpointer: {} as EvolutionWorkflowInput["checkpointer"],
    threadId: "test",
    resume: false,
    signal: new AbortController().signal,
    embeddingProvider
  }, { package_id: packageId })
}
