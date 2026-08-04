import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import type { RunStoryCreationAgentResponse } from "@story-mgr/shared"
import { afterEach, describe, expect, it } from "vitest"
import { createApp, type StoryManagerAppDependencies } from "./app"
import type { ApiConfig } from "./config"
import type { StoryCreationWorkflowOptions, runStoryCreationAgents } from "./services/story-creation"

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
      phone: { personality_library: [], talk_library: [], action_library: [], reply_library: [], contact_profiles: [] },
      phoneConversations: { conversations: [] },
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
})
