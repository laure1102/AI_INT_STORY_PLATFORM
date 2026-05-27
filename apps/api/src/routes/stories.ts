import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import multer from "@koa/multer"
import Router from "@koa/router"
import { compileStory } from "@story-mgr/compiler"
import { validateStoryDocument } from "@story-mgr/core"
import { FileStoreError, type StoryFileStore } from "@story-mgr/file-store"
import type {
  AppSettingsResponse,
  CompressLocationImageRequest,
  CompressRoleImageRequest,
  CompressSceneBackgroundRequest,
  GenerateLocationImageRequest,
  GenerateLocationImageResponse,
  GenerateLocationPromptRequest,
  GenerateLocationPromptResponse,
  GenerateRoleImageRequest,
  GenerateRoleImageResponse,
  GenerateRolePromptRequest,
  GenerateRolePromptResponse,
  SaveAppSettingsRequest,
  SaveEventRequest,
  SaveEventLocationsRequest,
  SaveRolesRequest,
  SaveScenesRequest,
  StoryRolesResponse,
  SaveValsRequest,
  StoryAssetResponse
} from "@story-mgr/shared"
import type { ApiConfig } from "../config"
import {
  generateLocationImage,
  generateLocationPrompt,
  generateRoleImage,
  generateRolePrompt
} from "../services/ai"

const upload = multer({
  storage: multer.memoryStorage()
})

function requireParam(value: string | undefined, name: string) {
  if (!value) {
    throw new FileStoreError(`Missing route parameter "${name}".`, 400, "route.missing-param")
  }

  return value
}

function requireQueryString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FileStoreError(`Missing query parameter "${name}".`, 400, "route.missing-query")
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

  router.get("/settings", async (context) => {
    context.body = {
      settings: await store.readAppSettings()
    } satisfies AppSettingsResponse
  })

  router.put("/settings", async (context) => {
    const body = context.request.body as SaveAppSettingsRequest

    context.body = {
      settings: await store.writeAppSettings(body.settings)
    } satisfies AppSettingsResponse
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

  router.put("/stories/:storyId/vals", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveValsRequest

    context.body = {
      vals: await store.writeVals(storyId, body.vals)
    }
  })

  router.put("/stories/:storyId/scenes", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveScenesRequest

    context.body = {
      scenes: await store.writeScenes(storyId, body.scenes)
    }
  })

  router.put("/stories/:storyId/roles", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveRolesRequest

    context.body = {
      roles: await store.writeRoles(storyId, body.roles)
    } satisfies StoryRolesResponse
  })

  router.put("/stories/:storyId/event-locations", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveEventLocationsRequest

    context.body = {
      eventLocations: await store.writeEventLocations(storyId, body.eventLocations)
    }
  })

  router.post("/stories/:storyId/event-locations/prompt", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as GenerateLocationPromptRequest
    const [settings, story] = await Promise.all([
      store.readAppSettings(),
      store.readStoryDocument(storyId)
    ])

    context.body = {
      prompt: await generateLocationPrompt(settings, {
        descr: body.descr,
        locationName: body.locationName,
        storyTitle: body.storyTitle ?? story.story.title
      })
    } satisfies GenerateLocationPromptResponse
  })

  router.post("/stories/:storyId/roles/prompt", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as GenerateRolePromptRequest
    const [settings, story] = await Promise.all([
      store.readAppSettings(),
      store.readStoryDocument(storyId)
    ])

    context.body = {
      prompt: await generateRolePrompt(settings, {
        descr: body.descr,
        import: body.import,
        qufenXingbie: body.qufenXingbie,
        roleName: body.roleName,
        storyTitle: body.storyTitle ?? story.story.title,
        xingge: body.xingge
      })
    } satisfies GenerateRolePromptResponse
  })

  router.post("/stories/:storyId/event-locations/image", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as GenerateLocationImageRequest
    const settings = await store.readAppSettings()
    const image = await generateLocationImage(
      settings,
      body.prompt,
      body.globalPrompt,
      body.imageSize
    )

    context.body = {
      asset: await store.writeLocationImageSource(storyId, body.targetName, image.buffer)
    } satisfies GenerateLocationImageResponse
  })

  router.post("/stories/:storyId/roles/image", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as GenerateRoleImageRequest
    const settings = await store.readAppSettings()
    const image = await generateRoleImage(
      settings,
      body.prompt,
      body.globalPrompt,
      body.imageSize,
      body.gender
    )

    context.body = {
      asset: await store.writeRoleImageSource(storyId, body.targetName, image.buffer)
    } satisfies GenerateRoleImageResponse
  })

  router.post("/stories/:storyId/event-locations/compress", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as CompressLocationImageRequest

    context.body = {
      asset: await store.compressLocationImage(storyId, {
        sourcePath: body.sourcePath,
        targetName: body.targetName,
        quality: body.quality
      })
    } satisfies StoryAssetResponse
  })

  router.post("/stories/:storyId/roles/compress", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as CompressRoleImageRequest

    context.body = {
      asset: await store.compressRoleImage(storyId, {
        sourcePath: body.sourcePath,
        targetName: body.targetName,
        quality: body.quality
      })
    } satisfies StoryAssetResponse
  })

  router.post("/stories/:storyId/assets/upload", upload.single("file"), async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const request = context.request as typeof context.request & {
      file?: {
        originalname?: string
        buffer?: Buffer
      }
    }
    const uploadedFile = request.file

    if (!uploadedFile?.buffer || !uploadedFile.originalname) {
      throw new FileStoreError("Please choose an image file to upload.", 400, "asset.file-required")
    }

    context.body = {
      asset: await store.writeSceneBackgroundSource(
        storyId,
        uploadedFile.originalname,
        uploadedFile.buffer
      )
    } satisfies StoryAssetResponse
  })

  router.post("/stories/:storyId/assets/compress", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as CompressSceneBackgroundRequest

    context.body = {
      asset: await store.compressSceneBackground(storyId, body)
    } satisfies StoryAssetResponse
  })

  router.get("/stories/:storyId/assets/meta", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const assetPath = requireQueryString(context.query.path, "path")

    context.body = {
      asset: await store.readStoryAssetMeta(storyId, assetPath)
    } satisfies StoryAssetResponse
  })

  router.get("/stories/:storyId/assets/file", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const assetPath = requireQueryString(context.query.path, "path")
    const asset = await store.readStoryAssetMeta(storyId, assetPath)
    const resolvedPath = store.resolveStoryAssetPath(storyId, assetPath)

    context.set("Cache-Control", "no-store")
    context.type = asset.mimeType
    context.length = asset.sizeBytes
    context.body = await readFile(resolvedPath)
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
