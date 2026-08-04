/**
 * 地点、物品和角色的 AI 提示词生成与图片生成路由。
 *
 * 提示词端点只返回文本，不修改故事；图片端点先调用外部模型取得二进制图片，再在 revision 锁内写入
 * 对应资产目录。生成失败或版本冲突都不会把不完整图片路径写进故事数据。
 */
import Router from "@koa/router"
import type { StoryFileStore } from "@story-mgr/file-store"
import type {
  GenerateItemImageResponse,
  GenerateItemPromptResponse,
  GenerateLocationImageResponse,
  GenerateLocationPromptResponse,
  GenerateRoleImageResponse,
  GenerateRolePromptResponse
} from "@story-mgr/shared"
import { parseRequestBody, requestSchemas } from "../request"
import {
  generateItemImage,
  generateItemPrompt,
  generateLocationImage,
  generateLocationPrompt,
  generateRoleImage,
  generateRolePrompt
} from "../services/ai"
import { requireParam } from "./story-route-helpers"

/**
 * 创建 AI 资产处理函数。
 *
 * @param store File Store 门面，用于读取当前故事/设置并保存生成图片。
 * @returns 六个命名处理函数：三类提示词和三类图片。
 */
function createStoryAiAssetRouteHandlers(store: StoryFileStore) {
  /**
   * 根据地点名称和描述生成英文美术提示词。
   *
   * @param context path 提供 storyId；body 提供地点描述、名称和可选故事标题。
   * @returns Promise；响应为 `{ prompt }`，不修改任何文件。
   * @throws body 非法、故事不存在或 AI 配置/调用失败时抛统一错误。
   *
   * 设置与故事互不依赖，使用 Promise.all 并行读取；body 未给标题时使用故事当前标题。
   */
  async function generateLocationPromptRoute(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.generateLocationPrompt)
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
  }

  /**
   * 根据物品名称、分类和描述生成英文美术提示词。
   *
   * @param context path 提供 storyId；body 提供物品信息和可选故事标题。
   * @returns Promise；响应为 `{ prompt }`，不产生图片也不保存物品。
   * @throws 请求体、故事、设置或模型调用错误。
   */
  async function generateItemPromptRoute(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.generateItemPrompt)
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
  }

  /**
   * 根据角色设定生成英文人物美术提示词。
   *
   * @param context body 提供角色名、描述、重要角色标记、性别差分和性格。
   * @returns Promise；响应为 `{ prompt }`，不修改角色文件。
   * @throws 输入或 AI 服务错误。
   */
  async function generateRolePromptRoute(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.generateRolePrompt)
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
  }

  /**
   * 调用图片模型生成地点原图，并保存到地点资产目录。
   *
   * @param context body 提供 prompt、全局提示词、尺寸、目标名和 expectedRevision。
   * @returns Promise；响应包含保存后的资产元数据和新 revision。
   * @throws AI 生成失败、图片不可读、路径非法或 revision 冲突时抛错。
   *
   * 模型调用可能较慢，所以先在锁外生成；真正写盘时再检查 revision。冲突时图片不会覆盖正式资产。
   */
  async function generateLocationImageRoute(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.generateLocationImage)
    const settings = await store.readAppSettings()
    const image = await generateLocationImage(
      settings,
      body.prompt,
      body.globalPrompt,
      body.width,
      body.height
    )
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeLocationImageSource(storyId, body.targetName, image.buffer, image.mimeType)
    )

    context.body = {
      asset: result.value,
      revision: result.revision
    } satisfies GenerateLocationImageResponse
  }

  /**
   * 调用图片模型生成物品原图，并保存到物品资产目录。
   *
   * @param context body 提供图片提示词、尺寸、目标名和 expectedRevision。
   * @returns Promise；响应包含物品资产元数据与新 revision。
   * @throws 模型、图片解码、文件写入或并发冲突错误。
   */
  async function generateItemImageRoute(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.generateItemImage)
    const settings = await store.readAppSettings()
    const image = await generateItemImage(
      settings,
      body.prompt,
      body.globalPrompt,
      body.width,
      body.height
    )
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeItemImageSource(storyId, body.targetName, image.buffer, image.mimeType)
    )

    context.body = {
      asset: result.value,
      revision: result.revision
    } satisfies GenerateItemImageResponse
  }

  /**
   * 调用图片模型生成角色原图，并按可选性别保存到角色资产目录。
   *
   * @param context body 提供角色提示词、尺寸、性别、目标名和 expectedRevision。
   * @returns Promise；响应包含角色资产元数据和新 revision。
   * @throws 模型、图片、路径或 revision 错误。
   */
  async function generateRoleImageRoute(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.generateRoleImage)
    const settings = await store.readAppSettings()
    const image = await generateRoleImage(
      settings,
      body.prompt,
      body.globalPrompt,
      body.width,
      body.height,
      body.gender
    )
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeRoleImageSource(storyId, body.targetName, image.buffer, image.mimeType)
    )

    context.body = {
      asset: result.value,
      revision: result.revision
    } satisfies GenerateRoleImageResponse
  }

  return {
    generateItemImageRoute,
    generateItemPromptRoute,
    generateLocationImageRoute,
    generateLocationPromptRoute,
    generateRoleImageRoute,
    generateRolePromptRoute
  }
}

/**
 * 注册 AI 资产提示词和图片端点。
 *
 * @param router Stories 总 Router。
 * @param store File Store 门面。
 * @returns 无返回值；向 router 添加六个 POST 端点。
 */
export function registerStoryAiAssetRoutes(router: Router, store: StoryFileStore) {
  const handlers = createStoryAiAssetRouteHandlers(store)

  router.post("/stories/:storyId/event-locations/prompt", handlers.generateLocationPromptRoute)
  router.post("/stories/:storyId/items/prompt", handlers.generateItemPromptRoute)
  router.post("/stories/:storyId/roles/prompt", handlers.generateRolePromptRoute)
  router.post("/stories/:storyId/event-locations/image", handlers.generateLocationImageRoute)
  router.post("/stories/:storyId/items/image", handlers.generateItemImageRoute)
  router.post("/stories/:storyId/roles/image", handlers.generateRoleImageRoute)
}
