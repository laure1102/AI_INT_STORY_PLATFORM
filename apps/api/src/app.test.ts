import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import { hashEvolutionPackage, type StoryEvolutionPackage } from "@story-mgr/evolution"
import type { RunStoryCreationAgentResponse } from "@story-mgr/shared"
import { afterEach, describe, expect, it } from "vitest"
import { createApp, type StoryManagerAppDependencies } from "./app"
import type { ApiConfig } from "./config"
import type { StoryCreationWorkflowOptions, runStoryCreationAgents } from "./services/story-creation"
import type { EvolutionWorkflowInput } from "./services/evolution-workflow"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function startApi(
  overrides: Partial<ApiConfig> = {},
  dependencies: StoryManagerAppDependencies = {}
) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "story-mgr-api-"))
  const config: ApiConfig = {
    port: 0,
    host: "127.0.0.1",
    corsOrigins: ["http://localhost:3000"],
    dataDir,
    buildDir: path.join(dataDir, "build"),
    stateDir: path.join(dataDir, ".story-manager"),
    ...overrides
  }
  const app = createApp(config, dependencies)
  const server = app.listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const address = server.address() as AddressInfo

  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    await app.closeServices()
    await rm(dataDir, { recursive: true, force: true })
  })

  return `http://127.0.0.1:${address.port}`
}

function emptyCreationResult(): RunStoryCreationAgentResponse {
  return {
    draft: {
      title: "测试草稿",
      summary: "",
      arc: "",
      locations: [],
      roles: [],
      items: [],
      events: [],
      variables: [],
      contact: { channels: [], personality_library: [], talk_library: [], action_library: [], reply_library: [], contact_profiles: [] },
      contactConversations: { conversations: [] },
      doing: { menus: [], doings: [] },
      shop: { categories: [], products: [] },
      notes: [],
      warnings: []
    },
    logs: []
  }
}

async function waitForJob(baseUrl: string, jobId: string, status: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/stories/story/creation-jobs/${jobId}`)
    const body = await response.json() as { job: { status: string } }
    if (body.job.status === status) return body.job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for job status ${status}.`)
}

async function waitForEvolutionJob(baseUrl: string, jobId: string, status: string) {
  let latest: { status: string; packageId?: string; error?: string } | undefined
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/stories/story/evolution/jobs/${jobId}`)
    const body = await response.json() as { job: { status: string; packageId?: string; error?: string } }
    latest = body.job
    if (body.job.status === status) return body.job
    if (body.job.status === "failed" || body.job.status === "cancelled") break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for evolution job status ${status}; latest=${JSON.stringify(latest)}.`)
}

function evolutionPackage(input: EvolutionWorkflowInput): StoryEvolutionPackage {
  const unsigned = {
    schema_version: 1 as const,
    package_id: `api-pkg-${input.sequence}`,
    story_id: input.storyId,
    scope: input.scope,
    sequence: input.sequence,
    base_content_hash: input.baseContentHash,
    parent_package_ids: input.parentPackageIds,
    created_at: new Date().toISOString(),
    patch: {
      vals: {
        upsert: [{ name: "player", vals: [{ name: "money", value_type: "value", value: 0, calc_rule: "" }] }],
        remove: []
      },
      world_state_patch: { revision: input.sequence }
    },
    semantic_model: { model_id: "Xenova/bge-small-zh-v1.5" as const, dimension: 512 as const, normalized: true as const },
    semantic_entries: [],
    world_state_patch: { revision: input.sequence }
  }
  return { ...unsigned, package_hash: hashEvolutionPackage(unsigned) }
}

describe("API boundaries", () => {
  it("returns structured 400 responses for invalid JSON bodies", async () => {
    const baseUrl = await startApi()
    const response = await fetch(`${baseUrl}/api/stories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title: "Missing id" })
    })
    const body = await response.json() as {
      error: { code: string; message: string; requestId: string; details?: unknown }
    }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("request.invalid-body")
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"))
    expect(body.error.details).toBeDefined()
  })

  it("only emits CORS headers for configured origins", async () => {
    const baseUrl = await startApi()
    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "http://localhost:3000" }
    })
    const denied = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://example.invalid" }
    })

    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    expect(denied.headers.get("access-control-allow-origin")).not.toBe("https://example.invalid")
  })

  it("requires a bearer token when configured", async () => {
    const baseUrl = await startApi({ accessToken: "test-token" })
    const unauthorized = await fetch(`${baseUrl}/api/stories`)
    const authorized = await fetch(`${baseUrl}/api/stories`, {
      headers: { Authorization: "Bearer test-token" }
    })

    expect(unauthorized.status).toBe(401)
    expect(authorized.status).toBe(200)
  })

  it("rejects uploads larger than 25 MiB", async () => {
    const baseUrl = await startApi()
    const form = new FormData()
    form.append("file", new Blob([Buffer.alloc(25 * 1024 * 1024 + 1)]), "large.png")

    const response = await fetch(`${baseUrl}/api/stories/missing/assets/upload`, {
      method: "POST",
      body: form
    })
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(413)
    expect(body.error.code).toBe("asset.file-too-large")
  })

  it("rejects files that Sharp cannot decode as images", async () => {
    const baseUrl = await startApi()
    await fetch(`${baseUrl}/api/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "image-story", title: "图片校验" })
    })
    const form = new FormData()
    form.append("expectedRevision", "0")
    form.append("file", new Blob([Buffer.from("not-an-image")]), "invalid.png")

    const response = await fetch(`${baseUrl}/api/stories/image-story/assets/upload`, {
      method: "POST",
      body: form
    })
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("asset.invalid-image")
  })

  it("serves contact routes and leaves legacy phone routes unavailable", async () => {
    const baseUrl = await startApi()
    const createResponse = await fetch(`${baseUrl}/api/stories/contact-story`, { method: "GET" })
    expect(createResponse.status).toBe(404)

    const createdResponse = await fetch(`${baseUrl}/api/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "contact-story", title: "联系人路由测试" })
    })
    const created = await createdResponse.json() as {
      story: { contact: Record<string, unknown> }
      revision: number
    }

    const saveContact = await fetch(`${baseUrl}/api/stories/contact-story/contact`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact: {
          ...created.story.contact,
          default_channel_id: "letter",
          channels: [{ id: "letter", name: "书信", preset: "letter", labels: {} }]
        },
        expectedRevision: created.revision
      })
    })
    const savedContact = await saveContact.json() as {
      contact: { default_channel_id: string }
      revision: number
    }
    expect(saveContact.status).toBe(200)
    expect(savedContact.contact.default_channel_id).toBe("letter")

    const getConversations = await fetch(
      `${baseUrl}/api/stories/contact-story/contact-conversations`
    )
    const conversations = await getConversations.json() as {
      contactConversations: { conversations: unknown[] }
    }
    expect(getConversations.status).toBe(200)
    expect(conversations.contactConversations.conversations).toEqual([])

    const saveConversations = await fetch(
      `${baseUrl}/api/stories/contact-story/contact-conversations`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactConversations: { conversations: [] },
          expectedRevision: savedContact.revision
        })
      }
    )
    expect(saveConversations.status).toBe(200)

    const legacyResponses = await Promise.all([
      fetch(`${baseUrl}/api/stories/contact-story/phone`),
      fetch(`${baseUrl}/api/stories/contact-story/phone-conversations`)
    ])
    expect(legacyResponses.map((response) => response.status)).toEqual([404, 404])
  })

  it("creates, streams, queries, lists and cancels creation jobs", async () => {
    const runner = (async (...args: Parameters<typeof runStoryCreationAgents>) => {
      const signal = args[4]
      const options = args[5] as StoryCreationWorkflowOptions
      options.observer?.onNodeStart("chiefEditor", "api-test-model")
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        )
      })
      return emptyCreationResult()
    }) as typeof runStoryCreationAgents
    const baseUrl = await startApi({}, { creationJobRunner: runner })
    const createStory = await fetch(`${baseUrl}/api/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "story", title: "任务 API 测试" })
    })
    expect(createStory.status).toBe(201)

    const createJob = await fetch(`${baseUrl}/api/stories/story/creation-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "生成测试剧情" })
    })
    const created = await createJob.json() as { job: { id: string; status: string } }
    expect(createJob.status).toBe(202)
    await waitForJob(baseUrl, created.job.id, "running")

    const streamController = new AbortController()
    const stream = await fetch(
      `${baseUrl}/api/stories/story/creation-jobs/${created.job.id}/events`,
      { signal: streamController.signal }
    )
    const firstChunk = await stream.body?.getReader().read()
    const snapshot = new TextDecoder().decode(firstChunk?.value)
    streamController.abort()
    expect(stream.headers.get("content-type")).toContain("text/event-stream")
    expect(snapshot).toContain("event: snapshot")
    expect(snapshot).toContain(created.job.id)

    const listResponse = await fetch(`${baseUrl}/api/stories/story/creation-jobs`)
    const listed = await listResponse.json() as { jobs: Array<{ id: string }> }
    expect(listed.jobs.some((job) => job.id === created.job.id)).toBe(true)

    const cancelResponse = await fetch(
      `${baseUrl}/api/stories/story/creation-jobs/${created.job.id}`,
      { method: "DELETE" }
    )
    const cancelled = await cancelResponse.json() as { job: { status: string } }
    expect(cancelled.job.status).toBe("cancelled")
  })

  it("publishes and distributes evolution packages through the HTTP API", async () => {
    const baseUrl = await startApi({}, { evolution: { workflowRunner: async (input) => evolutionPackage(input) } })
    const createStory = await fetch(`${baseUrl}/api/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "story", title: "演化 API 测试" })
    })
    expect(createStory.status).toBe(201)

    const createJob = await fetch(`${baseUrl}/api/stories/story/evolution/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "推进世界", scope: { type: "global", id: "global" } })
    })
    const created = await createJob.json() as { job: { id: string } }
    expect(createJob.status).toBe(202)
    const completed = await waitForEvolutionJob(baseUrl, created.job.id, "completed")
    expect(completed.packageId).toBe("api-pkg-1")

    const [jobsResponse, manifestResponse, packageResponse] = await Promise.all([
      fetch(`${baseUrl}/api/stories/story/evolution/jobs`),
      fetch(`${baseUrl}/api/stories/story/evolution/manifest`),
      fetch(`${baseUrl}/api/stories/story/evolution/packages/api-pkg-1`)
    ])
    const jobs = await jobsResponse.json() as { jobs: Array<{ id: string }> }
    const manifest = await manifestResponse.json() as { packageIds: string[]; effectiveContentHash: string }
    const pkg = await packageResponse.json() as StoryEvolutionPackage
    expect(jobs.jobs.some((job) => job.id === created.job.id)).toBe(true)
    expect(manifest.packageIds).toEqual(["api-pkg-1"])
    expect(manifest.effectiveContentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(pkg.package_hash).toMatch(/^[a-f0-9]{64}$/)

    const occurredAt = new Date().toISOString()
    const telemetryResponse = await fetch(`${baseUrl}/api/stories/story/evolution/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [{
        eventId: "milestone-1", storyId: "story", playerId: "player-1", shardId: "shard-1",
        sessionId: "session-1", sequence: 1, occurredAt, type: "milestone.reached", payload: { milestoneId: "chapter-1" }
      }] })
    })
    expect(await telemetryResponse.json()).toEqual({ accepted: 1, received: 1 })

    const evaluateResponse = await fetch(`${baseUrl}/api/stories/story/evolution/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: { type: "global", id: "global" }, instruction: "响应里程碑" })
    })
    const evaluated = await evaluateResponse.json() as { triggered: boolean; job: { id: string } }
    expect(evaluated.triggered).toBe(true)
    await waitForEvolutionJob(baseUrl, evaluated.job.id, "completed")
    expect((await (await fetch(`${baseUrl}/api/stories/story/evolution/manifest`)).json() as { packageIds: string[] }).packageIds).toEqual(["api-pkg-1", "api-pkg-2"])

    const rollback = await fetch(`${baseUrl}/api/stories/story/evolution/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: { type: "global", id: "global" }, packageId: "api-pkg-1" })
    })
    expect(rollback.status).toBe(200)
    expect((await (await fetch(`${baseUrl}/api/stories/story/evolution/manifest`)).json() as { packageIds: string[] }).packageIds).toEqual(["api-pkg-1"])
  })
})
