import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import multer from "@koa/multer"
import Router from "@koa/router"
import { compileStory } from "@story-mgr/compiler"
import { validateStoryDocument, type StoryEventCollectionType } from "@story-mgr/core"
import { FileStoreError, type StoryFileStore } from "@story-mgr/file-store"
import type {
  ApplyStoryCreationDraftRequest,
  ApplyStoryCreationDraftResponse,
  AppSettingsResponse,
  CompressItemImageRequest,
  CompressLocationImageRequest,
  CompressRoleImageRequest,
  CompressSceneBackgroundRequest,
  CreateStoryRequest,
  CreateStoryResponse,
  GenerateItemImageRequest,
  GenerateItemImageResponse,
  GenerateItemPromptRequest,
  GenerateItemPromptResponse,
  GenerateStoryDialogueRequest,
  GenerateStoryDialogueResponse,
  GenerateLocationImageRequest,
  GenerateLocationImageResponse,
  GenerateLocationPromptRequest,
  GenerateLocationPromptResponse,
  GenerateRoleImageRequest,
  GenerateRoleImageResponse,
  GenerateRolePromptRequest,
  GenerateRolePromptResponse,
  RunStoryCreationAgentRequest,
  RunStoryCreationAgentResponse,
  SaveAppSettingsRequest,
  DeleteStoryCreationHistorySessionResponse,
  SaveStoryCreationHistorySessionRequest,
  SaveStoryCreationHistorySessionResponse,
  SaveEventRequest,
  SaveEventLocationsRequest,
  SaveStoryDoingRequest,
  SaveStoryItemsRequest,
  SaveStoryPhoneRequest,
  SaveStoryReferRequest,
  SaveStoryShopRequest,
  SavePlayerOverrideValsRequest,
  SaveRolesRequest,
  SaveScenesRequest,
  SaveStoryBibleRequest,
  SaveSystemValsRequest,
  StoryDeleteEventResponse,
  StoryBibleResponse,
  StoryCreationHistoryResponse,
  StoryDoingResponse,
  StoryPlayerOverrideValsResponse,
  StoryRolesResponse,
  StoryItemsResponse,
  StoryPhoneResponse,
  StoryReferResponse,
  StoryShopResponse,
  SaveValsRequest,
  StorySystemValsResponse,
  StoryAssetResponse
} from "@story-mgr/shared"
import type { ApiConfig } from "../config"
import {
  generateItemImage,
  generateItemPrompt,
  generateLocationImage,
  generateLocationPrompt,
  generateRoleImage,
  generateRolePrompt
} from "../services/ai"
import {
  deleteStoryCreationHistorySession,
  readStoryCreationHistory,
  upsertStoryCreationHistorySession
} from "../services/creation-history"
import {
  applyStoryCreationDraft,
  generateStoryEventDialogues,
  runStoryCreationAgents
} from "../services/story-creation"

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

function normalizeEventCollectionType(value: unknown): StoryEventCollectionType {
  if (value === "pool" || value === "schedule" || value === "chain") {
    return value
  }

  if (value === "once") {
    return "pool"
  }

  if (value === "loop") {
    return "schedule"
  }

  return "chain"
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

  router.post("/stories", async (context) => {
    const body = context.request.body as CreateStoryRequest
    const story = await store.createStory(body)
    const summaries = await store.listStorySummaries()
    const summary = summaries.find((item) => item.id === story.story.id) ?? {
      id: story.story.id,
      title: story.story.title,
      description: story.story.description,
      eventCount: story.chainEvents.length,
      updatedAt: undefined
    }

    context.status = 201
    context.body = {
      story,
      summary
    } satisfies CreateStoryResponse
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

  router.get("/stories/:storyId/story-bible", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    context.body = {
      storyBible: await store.readStoryBible(storyId)
    } satisfies StoryBibleResponse
  })

  router.put("/stories/:storyId/story-bible", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveStoryBibleRequest

    context.body = {
      storyBible: await store.writeStoryBible(storyId, body.storyBible)
    } satisfies StoryBibleResponse
  })

  router.post("/stories/:storyId/creation-agent/run", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as RunStoryCreationAgentRequest
    const [settings, story] = await Promise.all([
      store.readAppSettings(),
      store.readStoryDocument(storyId)
    ])

    const controller = new AbortController()
    context.req.on("aborted", () => controller.abort())
    context.req.on("close", () => controller.abort())

    context.body = await runStoryCreationAgents(
      settings,
      story,
      body.instruction,
      body.baseDraft,
      controller.signal
    ) satisfies RunStoryCreationAgentResponse
  })

  router.post("/stories/:storyId/creation-agent/apply", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as ApplyStoryCreationDraftRequest

    context.body = await applyStoryCreationDraft(
      store,
      storyId,
      body
    ) satisfies ApplyStoryCreationDraftResponse
  })

  router.post("/stories/:storyId/dialogue-agent/generate", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as GenerateStoryDialogueRequest
    const [settings, story] = await Promise.all([
      store.readAppSettings(),
      store.readStoryDocument(storyId)
    ])

    const controller = new AbortController()
    context.req.on("aborted", () => controller.abort())
    context.req.on("close", () => controller.abort())

    context.body = await generateStoryEventDialogues(
      settings,
      story,
      body,
      controller.signal
    ) satisfies GenerateStoryDialogueResponse
  })

  router.get("/stories/:storyId/creation-history", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")

    context.body = {
      history: await readStoryCreationHistory(config.dataDir, storyId)
    } satisfies StoryCreationHistoryResponse
  })

  router.put("/stories/:storyId/creation-history/:sessionId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const sessionId = requireParam(context.params.sessionId, "sessionId")
    const body = context.request.body as SaveStoryCreationHistorySessionRequest

    if (body.session.id !== sessionId) {
      throw new FileStoreError(
        "Creation history session id in path and payload must match.",
        400,
        "creation-history.session-id-mismatch"
      )
    }

    const result = await upsertStoryCreationHistorySession(config.dataDir, storyId, body.session)

    context.body = result satisfies SaveStoryCreationHistorySessionResponse
  })

  router.delete("/stories/:storyId/creation-history/:sessionId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const sessionId = requireParam(context.params.sessionId, "sessionId")

    context.body = await deleteStoryCreationHistorySession(
      config.dataDir,
      storyId,
      sessionId
    ) satisfies DeleteStoryCreationHistorySessionResponse
  })

  router.get("/stories/:storyId/events/:eventId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const eventId = requireParam(context.params.eventId, "eventId")
    const collectionType = normalizeEventCollectionType(context.query.collectionType)
    context.body = {
      event: await store.readEvent(storyId, eventId, collectionType)
    }
  })

  router.put("/stories/:storyId/events/:eventId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const eventId = requireParam(context.params.eventId, "eventId")
    const body = context.request.body as SaveEventRequest

    context.body = {
      event: await store.writeEvent(
        storyId,
        eventId,
        body.event,
        normalizeEventCollectionType(body.collectionType)
      )
    }
  })

  router.delete("/stories/:storyId/events/:eventId", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const eventId = requireParam(context.params.eventId, "eventId")
    const collectionType = normalizeEventCollectionType(context.query.collectionType)

    await store.deleteEvent(storyId, eventId, collectionType)

    context.body = {
      ok: true
    } satisfies StoryDeleteEventResponse
  })

  router.put("/stories/:storyId/vals", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveValsRequest

    context.body = {
      vals: await store.writeVals(storyId, body.vals)
    }
  })

  router.put("/stories/:storyId/system-vals", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveSystemValsRequest

    context.body = {
      systemVals: await store.writeSystemVals(storyId, body.systemVals)
    } satisfies StorySystemValsResponse
  })

  router.put("/stories/:storyId/player-override-vals", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SavePlayerOverrideValsRequest

    context.body = {
      playerOverrideVals: await store.writePlayerOverrideVals(storyId, body.playerOverrideVals)
    } satisfies StoryPlayerOverrideValsResponse
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

  router.put("/stories/:storyId/items", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveStoryItemsRequest

    context.body = {
      items: await store.writeItems(storyId, body.items)
    } satisfies StoryItemsResponse
  })

  router.put("/stories/:storyId/shop", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveStoryShopRequest

    context.body = {
      shop: await store.writeShop(storyId, body.shop)
    } satisfies StoryShopResponse
  })

  router.put("/stories/:storyId/phone", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveStoryPhoneRequest

    context.body = {
      phone: await store.writePhone(storyId, body.phone)
    } satisfies StoryPhoneResponse
  })

  router.put("/stories/:storyId/refer", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveStoryReferRequest

    context.body = {
      refer: await store.writeRefer(storyId, body.refer)
    } satisfies StoryReferResponse
  })

  router.put("/stories/:storyId/doing", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as SaveStoryDoingRequest

    context.body = {
      doing: await store.writeDoing(storyId, body.doing)
    } satisfies StoryDoingResponse
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

  router.post("/stories/:storyId/items/prompt", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as GenerateItemPromptRequest
    const [settings, story] = await Promise.all([
      store.readAppSettings(),
      store.readStoryDocument(storyId)
    ])

    context.body = {
      prompt: await generateItemPrompt(settings, {
        categoryName: body.categoryName,
        descr: body.descr,
        itemName: body.itemName,
        storyTitle: body.storyTitle ?? story.story.title
      })
    } satisfies GenerateItemPromptResponse
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
        gender: body.gender,
        important: body.important,
        qufenXingbie: body.qufenXingbie,
        roleName: body.roleName,
        storyTitle: body.storyTitle ?? story.story.title,
        xingge: body.xingge ?? ""
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
      body.width,
      body.height
    )

    context.body = {
      asset: await store.writeLocationImageSource(
        storyId,
        body.targetName,
        image.buffer,
        image.mimeType
      )
    } satisfies GenerateLocationImageResponse
  })

  router.post("/stories/:storyId/items/image", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as GenerateItemImageRequest
    const settings = await store.readAppSettings()
    const image = await generateItemImage(
      settings,
      body.prompt,
      body.globalPrompt,
      body.width,
      body.height
    )

    context.body = {
      asset: await store.writeItemImageSource(
        storyId,
        body.targetName,
        image.buffer,
        image.mimeType
      )
    } satisfies GenerateItemImageResponse
  })

  router.post("/stories/:storyId/roles/image", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as GenerateRoleImageRequest
    const settings = await store.readAppSettings()
    const image = await generateRoleImage(
      settings,
      body.prompt,
      body.globalPrompt,
      body.width,
      body.height,
      body.gender
    )

    context.body = {
      asset: await store.writeRoleImageSource(
        storyId,
        body.targetName,
        image.buffer,
        image.mimeType
      )
    } satisfies GenerateRoleImageResponse
  })

  router.post("/stories/:storyId/event-locations/compress", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as CompressLocationImageRequest

    context.body = {
      asset: await store.compressLocationImage(storyId, {
        sourcePath: body.sourcePath,
        slot: body.slot,
        targetName: body.targetName,
        quality: body.quality
      })
    } satisfies StoryAssetResponse
  })

  router.post("/stories/:storyId/items/compress", async (context) => {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = context.request.body as CompressItemImageRequest

    context.body = {
      asset: await store.compressItemImage(storyId, {
        sourcePath: body.sourcePath,
        slot: body.slot,
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
        slot: body.slot,
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
