import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import JSON5 from "json5"
import {
  storyBigOnceEventsSchema,
  storyEventLocationSchema,
  storyEventSchema,
  storyGraphEventsSchema,
  storyLoopEventsSchema,
  storyMetaSchema,
  storyRolesSchema,
  storySceneSchema,
  storyValsSchema,
  storyViewSchema,
  type StoryBigOnceEventFile,
  type StoryBigOnceEventsFile,
  type StoryDocument,
  type StoryEventLocationFile,
  type StoryEventFile,
  type StoryGraphEventsFile,
  type StoryLoopEventFile,
  type StoryLoopEventsFile,
  type StoryMetaFile,
  type StoryRolesFile,
  type StorySceneFile,
  type StorySummary,
  type StoryValsFile,
  type StoryViewFile
} from "@story-mgr/core"

export class FileStoreError extends Error {
  statusCode: number
  code: string

  constructor(message: string, statusCode = 400, code = "file-store.error") {
    super(message)
    this.name = "FileStoreError"
    this.statusCode = statusCode
    this.code = code
  }
}

export function isFileStoreError(error: unknown): error is FileStoreError {
  return error instanceof FileStoreError
}

export interface StoryFileStore {
  listStorySummaries(): Promise<StorySummary[]>
  readStoryDocument(storyId: string): Promise<StoryDocument>
  readEvent(storyId: string, eventId: string): Promise<StoryEventFile>
  writeEvent(storyId: string, eventId: string, event: StoryEventFile): Promise<StoryEventFile>
  readView(storyId: string, viewId: string): Promise<StoryViewFile>
  writeView(storyId: string, viewId: string, view: StoryViewFile): Promise<StoryViewFile>
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortObjectKeys(nested)])
    )
  }

  return value
}

async function readJson5File<T>(filePath: string): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8")
    return JSON5.parse(raw) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FileStoreError(`File not found: ${filePath}`, 404, "file-store.not-found")
    }

    throw error
  }
}

async function writeJson5File(filePath: string, value: unknown) {
  const orderedValue = sortObjectKeys(value)
  const content = `${JSON5.stringify(orderedValue, null, 2)}\n`
  const directory = path.dirname(filePath)
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${Date.now().toString(36)}.tmp`
  )

  await mkdir(directory, { recursive: true })
  await writeFile(tempPath, content, "utf8")

  try {
    await rename(tempPath, filePath)
  } catch {
    await rm(filePath, { force: true })
    await rename(tempPath, filePath)
  }
}

async function listJson5FileNames(directory: string) {
  try {
    const items = await readdir(directory, { withFileTypes: true })

    return items
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json5"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }
}

async function listStoryIds(storiesRoot: string) {
  try {
    const items = await readdir(storiesRoot, { withFileTypes: true })

    return items
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }
}

async function getIsoMtime(filePath: string) {
  try {
    const fileStat = await stat(filePath)
    return fileStat.mtime.toISOString()
  } catch {
    return undefined
  }
}

function createStoryPaths(dataDir: string, storyId: string) {
  const storyDir = path.join(dataDir, "stories", storyId)

  return {
    storyDir,
    metaFile: path.join(storyDir, "story.json5"),
    valsFile: path.join(storyDir, "vals.json5"),
    sceneFile: path.join(storyDir, "scene.json5"),
    rolesFile: path.join(storyDir, "roles.json5"),
    eventLocationFile: path.join(storyDir, "event_location.json5"),
    eventsDir: path.join(storyDir, "events"),
    graphEventsFile: path.join(storyDir, "events", "events.json5"),
    bigOnceEventsFile: path.join(storyDir, "events", "big_once_events.json5"),
    loopEventsFile: path.join(storyDir, "events", "loop_events.json5"),
    viewsDir: path.join(storyDir, "views")
  }
}

async function readOptionalJson5File<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJson5File<T>(filePath)
  } catch (error) {
    if (isFileStoreError(error) && error.code === "file-store.not-found") {
      return fallback
    }

    throw error
  }
}

async function readStoryMeta(dataDir: string, storyId: string): Promise<StoryMetaFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const meta = await readJson5File<StoryMetaFile>(paths.metaFile)
  return storyMetaSchema.parse(meta)
}

async function readStoryVals(dataDir: string, storyId: string): Promise<StoryValsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const vals = await readOptionalJson5File<StoryValsFile>(paths.valsFile, {
    variables: []
  })
  return storyValsSchema.parse(vals)
}

async function readStoryScenes(dataDir: string, storyId: string): Promise<StorySceneFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const scenes = await readOptionalJson5File<StorySceneFile>(paths.sceneFile, {
    scenes: []
  })
  return storySceneSchema.parse(scenes)
}

async function readStoryRoles(dataDir: string, storyId: string): Promise<StoryRolesFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const roles = await readOptionalJson5File<StoryRolesFile>(paths.rolesFile, {
    roles: []
  })
  return storyRolesSchema.parse(roles)
}

async function readStoryEventLocations(
  dataDir: string,
  storyId: string
): Promise<StoryEventLocationFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const eventLocations = await readOptionalJson5File<StoryEventLocationFile>(
    paths.eventLocationFile,
    { assignments: [] }
  )
  return storyEventLocationSchema.parse(eventLocations)
}

async function readStoryGraphEvents(
  dataDir: string,
  storyId: string
): Promise<StoryGraphEventsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const graphEvents = await readOptionalJson5File<StoryGraphEventsFile | { events: StoryEventFile[] }>(
    paths.graphEventsFile,
    []
  )
  const normalizedGraphEvents = Array.isArray(graphEvents) ? graphEvents : graphEvents.events
  return storyGraphEventsSchema.parse(normalizedGraphEvents)
}

async function readStoryBigOnceEvents(
  dataDir: string,
  storyId: string
): Promise<StoryBigOnceEventsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const bigOnceEvents = await readOptionalJson5File<
    StoryBigOnceEventsFile | { events: StoryBigOnceEventFile[] }
  >(
    paths.bigOnceEventsFile,
    []
  )
  const normalizedBigOnceEvents = Array.isArray(bigOnceEvents)
    ? bigOnceEvents
    : bigOnceEvents.events
  return storyBigOnceEventsSchema.parse(normalizedBigOnceEvents)
}

async function readStoryLoopEvents(
  dataDir: string,
  storyId: string
): Promise<StoryLoopEventsFile> {
  const paths = createStoryPaths(dataDir, storyId)
  const loopEvents = await readOptionalJson5File<StoryLoopEventsFile | { events: StoryLoopEventFile[] }>(
    paths.loopEventsFile,
    []
  )
  const normalizedLoopEvents = Array.isArray(loopEvents) ? loopEvents : loopEvents.events
  return storyLoopEventsSchema.parse(normalizedLoopEvents)
}

async function readStoryViews(dataDir: string, storyId: string): Promise<StoryViewFile[]> {
  const paths = createStoryPaths(dataDir, storyId)
  const fileNames = await listJson5FileNames(paths.viewsDir)
  const views = await Promise.all(
    fileNames.map(async (fileName) => {
      const view = await readJson5File<StoryViewFile>(path.join(paths.viewsDir, fileName))
      return storyViewSchema.parse(view)
    })
  )

  return views
}

export function createStoryFileStore(dataDir: string): StoryFileStore {
  async function listStorySummaries(): Promise<StorySummary[]> {
    const storyIds = await listStoryIds(path.join(dataDir, "stories"))

    const stories = await Promise.all(
      storyIds.map(async (storyId) => {
        const meta = await readStoryMeta(dataDir, storyId)
        const graphEvents = await readStoryGraphEvents(dataDir, storyId)
        const updatedAt = await getIsoMtime(createStoryPaths(dataDir, storyId).metaFile)

        return {
          id: meta.id,
          title: meta.title,
          description: meta.description,
          eventCount: graphEvents.length,
          updatedAt
        }
      })
    )

    return stories
  }

  async function readStoryDocument(storyId: string): Promise<StoryDocument> {
    const [story, vals, scenes, roles, eventLocations, graphEvents, bigOnceEvents, loopEvents, views] =
      await Promise.all([
      readStoryMeta(dataDir, storyId),
      readStoryVals(dataDir, storyId),
      readStoryScenes(dataDir, storyId),
      readStoryRoles(dataDir, storyId),
      readStoryEventLocations(dataDir, storyId),
      readStoryGraphEvents(dataDir, storyId),
      readStoryBigOnceEvents(dataDir, storyId),
      readStoryLoopEvents(dataDir, storyId),
      readStoryViews(dataDir, storyId)
      ])

    return {
      story,
      vals,
      scenes,
      roles,
      eventLocations,
      graphEvents,
      bigOnceEvents,
      loopEvents,
      views
    }
  }

  async function readEvent(storyId: string, eventId: string): Promise<StoryEventFile> {
    const graphEvents = await readStoryGraphEvents(dataDir, storyId)
    const event = graphEvents.find((currentEvent) => currentEvent.id === eventId)

    if (!event) {
      throw new FileStoreError(`Event not found: ${eventId}`, 404, "event.not-found")
    }

    return storyEventSchema.parse(event)
  }

  async function writeEvent(
    storyId: string,
    eventId: string,
    event: StoryEventFile
  ): Promise<StoryEventFile> {
    if (event.id !== eventId) {
      throw new FileStoreError("Event id in path and payload must match.", 400, "event.id-mismatch")
    }

    const parsedEvent = storyEventSchema.parse(event)
    const paths = createStoryPaths(dataDir, storyId)
    const graphEvents = await readStoryGraphEvents(dataDir, storyId)
    const hasExistingEvent = graphEvents.some((currentEvent) => currentEvent.id === eventId)
    const nextGraphEvents = hasExistingEvent
      ? graphEvents.map((currentEvent) =>
          currentEvent.id === eventId ? parsedEvent : currentEvent
        )
      : [...graphEvents, parsedEvent]

    await writeJson5File(paths.graphEventsFile, nextGraphEvents satisfies StoryGraphEventsFile)

    return parsedEvent
  }

  async function readView(storyId: string, viewId: string): Promise<StoryViewFile> {
    const filePath = path.join(createStoryPaths(dataDir, storyId).viewsDir, `${viewId}.json5`)
    const view = await readJson5File<StoryViewFile>(filePath)
    return storyViewSchema.parse(view)
  }

  async function writeView(
    storyId: string,
    viewId: string,
    view: StoryViewFile
  ): Promise<StoryViewFile> {
    if (view.id !== viewId) {
      throw new FileStoreError("View id in path and payload must match.", 400, "view.id-mismatch")
    }

    const parsedView = storyViewSchema.parse(view)
    const filePath = path.join(createStoryPaths(dataDir, storyId).viewsDir, `${viewId}.json5`)
    await writeJson5File(filePath, parsedView)
    return parsedView
  }

  return {
    listStorySummaries,
    readStoryDocument,
    readEvent,
    writeEvent,
    readView,
    writeView
  }
}
