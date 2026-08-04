import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { StoryFileStore } from "@story-mgr/file-store"
import type { RunStoryCreationAgentResponse } from "@story-mgr/shared"
import { afterEach, describe, expect, it } from "vitest"
import type { StoryCreationWorkflowOptions, runStoryCreationAgents } from "./story-creation"
import { StoryCreationJobService } from "./story-creation-jobs"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function emptyResult(): RunStoryCreationAgentResponse {
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

function fakeStore() {
  return {
    readAppSettings: async () => ({}),
    readStoryDocument: async () => ({})
  } as unknown as StoryFileStore
}

async function waitFor(
  service: StoryCreationJobService,
  jobId: string,
  predicate: (status: string) => boolean
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = service.getJob("story", jobId)
    if (predicate(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for creation job status.")
}

async function createStateDir() {
  const stateDir = await mkdtemp(path.join(tmpdir(), "story-mgr-jobs-"))
  cleanups.push(() => rm(stateDir, { recursive: true, force: true }))
  return stateDir
}

describe("StoryCreationJobService", () => {
  it("cancels a running task and persists its node log", async () => {
    const stateDir = await createStateDir()
    const runner = (async (...args: Parameters<typeof runStoryCreationAgents>) => {
      const signal = args[4]
      const options = args[5] as StoryCreationWorkflowOptions
      options.observer?.onNodeStart("chiefEditor", "test-model")
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })
      return emptyResult()
    }) as typeof runStoryCreationAgents
    const service = new StoryCreationJobService(fakeStore(), stateDir, runner)
    const job = service.createJob("story", { instruction: "生成测试剧情" })
    await waitFor(service, job.id, (status) => status === "running")

    const cancelled = service.cancelJob("story", job.id)
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.logs[0]).toMatchObject({ role: "chiefEditor", model: "test-model" })
    await service.close()
  })

  it("resumes persisted running tasks after service restart", async () => {
    const stateDir = await createStateDir()
    const blockingRunner = (async (...args: Parameters<typeof runStoryCreationAgents>) => {
      const signal = args[4]
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })
      return emptyResult()
    }) as typeof runStoryCreationAgents
    const first = new StoryCreationJobService(fakeStore(), stateDir, blockingRunner)
    const created = first.createJob("story", { instruction: "恢复测试" })
    await waitFor(first, created.id, (status) => status === "running")
    await first.close()

    const resumedRunner = (async (...args: Parameters<typeof runStoryCreationAgents>) => {
      const options = args[5] as StoryCreationWorkflowOptions
      options.observer?.onNodeStart("chiefEditor", "resume-model")
      options.observer?.onTokenUsage("chiefEditor", {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150
      })
      options.observer?.onNodeComplete("chiefEditor", "已恢复")
      return emptyResult()
    }) as typeof runStoryCreationAgents
    const second = new StoryCreationJobService(fakeStore(), stateDir, resumedRunner)
    second.resumePendingJobs()
    const completed = await waitFor(second, created.id, (status) => status === "completed")

    expect(completed.threadId).toBe(`story:${created.id}`)
    expect(completed.logs.at(-1)).toMatchObject({
      status: "completed",
      summary: "已恢复",
      tokenUsage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 }
    })
    await second.close()
  })
})
