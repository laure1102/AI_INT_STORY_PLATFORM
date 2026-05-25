import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import Router from "@koa/router"
import { compileStory } from "@story-mgr/compiler"
import { validateStoryDocument } from "@story-mgr/core"
import type { StoryFileStore } from "@story-mgr/file-store"
import type { SaveEventRequest, SaveViewRequest } from "@story-mgr/shared"
import type { ApiConfig } from "../config"

function requireParam(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`Missing route parameter "${name}".`)
  }

  return value
}

export function createStoriesRouter(store: StoryFileStore, config: ApiConfig) {
  const router = new Router({ prefix: "/api" })

  router.get("/health", (context) => {
    context.body = { ok: true }
  })

  router.get("/stories", async (context) => {
    context.body = {
      stories: await store.listStorySummaries()
    }
  })

  router.get("/stories/:storyId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    context.body = {
      story: await store.readStoryDocument(storyId)
    }
  })

  router.get("/stories/:storyId/events/:eventId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const eventId = requireParam(context.params.eventId, "eventId")
    context.body = {
      event: await store.readEvent(storyId, eventId)
    }
  })

  router.put("/stories/:storyId/events/:eventId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const eventId = requireParam(context.params.eventId, "eventId")
    const body = context.request.body as SaveEventRequest

    context.body = {
      event: await store.writeEvent(storyId, eventId, body.event)
    }
  })

  router.get("/stories/:storyId/views/:viewId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const viewId = requireParam(context.params.viewId, "viewId")
    context.body = {
      view: await store.readView(storyId, viewId)
    }
  })

  router.put("/stories/:storyId/views/:viewId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const viewId = requireParam(context.params.viewId, "viewId")
    const body = context.request.body as SaveViewRequest

    context.body = {
      view: await store.writeView(storyId, viewId, body.view)
    }
  })

  router.post("/stories/:storyId/validate", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const story = await store.readStoryDocument(storyId)

    context.body = {
      result: validateStoryDocument(story)
    }
  })

  router.post("/stories/:storyId/export", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const story = await store.readStoryDocument(storyId)
    const { compiled, result } = compileStory(story)
    const outputPath = path.join(config.buildDir, "stories", `${storyId}.json`)

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(compiled, null, 2)}\n`, "utf8")

    context.body = {
      compiled,
      result,
      outputPath
    }
  })

  return router
}
