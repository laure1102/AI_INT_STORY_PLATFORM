import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createStoryFileStore, FileStoreError } from "./index"

let testDirectory: string | undefined

async function createTestStore() {
  testDirectory = await mkdtemp(path.join(tmpdir(), "story-mgr-file-store-"))
  const store = createStoryFileStore(testDirectory)
  await store.createStory({ id: "test_story", title: "Test Story" })
  return store
}

afterEach(async () => {
  if (testDirectory) {
    await rm(testDirectory, { recursive: true, force: true })
    testDirectory = undefined
  }
})

describe("StoryFileStore revisions and transactions", () => {
  it("serializes mutations and rejects a stale revision", async () => {
    const store = await createTestStore()
    const original = await store.readStoryDocument("test_story")

    const results = await Promise.allSettled([
      store.withStoryMutation("test_story", 0, () =>
        store.writeStoryMeta("test_story", { ...original.story, title: "First" })
      ),
      store.withStoryMutation("test_story", 0, () =>
        store.writeStoryMeta("test_story", { ...original.story, title: "Second" })
      )
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find((result) => result.status === "rejected")
    expect(rejected).toBeDefined()
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: "revision.conflict",
      statusCode: 409
    })
    expect(await store.readStoryRevision("test_story")).toBe(1)
  })

  it("commits a complete story document with its revision", async () => {
    const store = await createTestStore()
    const original = await store.readStoryDocument("test_story")
    const candidate = structuredClone(original)
    candidate.story.title = "Committed"
    candidate.story.description = "Atomic update"

    const committed = await store.commitStoryDocument("test_story", candidate, 0)

    expect(committed.revision).toBe(1)
    expect((await store.readStoryDocument("test_story")).story.title).toBe("Committed")
    expect(await store.readStoryRevision("test_story")).toBe(1)

    const transactionRoot = path.join(
      testDirectory!,
      ".story-manager",
      "transactions",
      "test_story"
    )
    const remaining = await readdir(transactionRoot).catch(() => [])
    expect(remaining).toEqual([])
  })

  it("rolls back an unfinished transaction before reading", async () => {
    const store = await createTestStore()
    const storyFile = path.join(testDirectory!, "stories", "test_story", "story.json5")
    const originalContent = await readFile(storyFile, "utf8")
    const transactionDir = path.join(
      testDirectory!,
      ".story-manager",
      "transactions",
      "test_story",
      "interrupted"
    )
    await mkdir(path.join(transactionDir, "backups"), { recursive: true })
    await writeFile(path.join(transactionDir, "backups", "0.json5"), originalContent, "utf8")
    await writeFile(
      storyFile,
      '{ id: "test_story", title: "Partially committed" }\n',
      "utf8"
    )
    await writeFile(
      path.join(transactionDir, "manifest.json5"),
      JSON.stringify({
        id: "interrupted",
        storyId: "test_story",
        status: "committing",
        entries: [
          {
            targetRelativePath: path.join("stories", "test_story", "story.json5"),
            stagedFileName: path.join("staged", "0.json5"),
            backupFileName: path.join("backups", "0.json5"),
            existed: true
          }
        ]
      }),
      "utf8"
    )

    const recovered = await store.readStoryDocument("test_story")

    expect(recovered.story.title).toBe("Test Story")
    await expect(readdir(transactionDir)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects story ids that could traverse outside the data directory", async () => {
    const store = await createTestStore()

    await expect(store.readStoryDocument("../outside")).rejects.toBeInstanceOf(FileStoreError)
    await expect(store.readStoryDocument("../outside")).rejects.toMatchObject({
      code: "story.invalid-id"
    })
  })
})
