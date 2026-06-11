import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { FileStoreError } from "@story-mgr/file-store"
import type {
  StoryCreationHistoryFile,
  StoryCreationHistorySession
} from "@story-mgr/shared"

function resolveStoryDirectory(dataDir: string, storyId: string) {
  const storiesRoot = path.resolve(dataDir, "stories")
  const storyDir = path.resolve(storiesRoot, storyId)

  if (storyDir !== storiesRoot && !storyDir.startsWith(`${storiesRoot}${path.sep}`)) {
    throw new FileStoreError("Invalid story id.", 400, "creation-history.invalid-story-id")
  }

  return storyDir
}

function resolveHistoryFile(dataDir: string, storyId: string) {
  return path.join(resolveStoryDirectory(dataDir, storyId), "creation_history.json5")
}

function normalizeHistory(value: Partial<StoryCreationHistoryFile> | null | undefined): StoryCreationHistoryFile {
  return {
    sessions: Array.isArray(value?.sessions) ? value.sessions : []
  }
}

async function writeJson5File(filePath: string, value: unknown) {
  const directory = path.dirname(filePath)
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${Date.now().toString(36)}.tmp`
  )

  await mkdir(directory, { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")

  try {
    await rename(tempPath, filePath)
  } catch {
    await rm(filePath, { force: true })
    await rename(tempPath, filePath)
  }
}

export async function readStoryCreationHistory(
  dataDir: string,
  storyId: string
): Promise<StoryCreationHistoryFile> {
  const filePath = resolveHistoryFile(dataDir, storyId)

  try {
    const raw = await readFile(filePath, "utf8")
    return normalizeHistory(JSON.parse(raw) as Partial<StoryCreationHistoryFile>)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        sessions: []
      }
    }

    throw error
  }
}

export async function upsertStoryCreationHistorySession(
  dataDir: string,
  storyId: string,
  session: StoryCreationHistorySession
) {
  if (!session.id.trim()) {
    throw new FileStoreError("Creation history session id is required.", 400, "creation-history.session-id-required")
  }

  const filePath = resolveHistoryFile(dataDir, storyId)
  const history = await readStoryCreationHistory(dataDir, storyId)
  const sessions = history.sessions.filter((item) => item.id !== session.id)
  const nextHistory: StoryCreationHistoryFile = {
    sessions: [session, ...sessions].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  }

  await writeJson5File(filePath, nextHistory)

  return {
    history: nextHistory,
    session
  }
}
