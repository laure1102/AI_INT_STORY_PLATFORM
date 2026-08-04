/**
 * 健康检查、故事列表、故事创建、应用设置和故事基础文档路由。
 *
 * 这些端点负责编辑器打开故事前必须取得的最基础数据。请求体先经过 Zod，写操作再经过 revision
 * 互斥层；本模块不会处理事件、资产或 AI 创作任务。
 */
import Router from "@koa/router"
import type { StoryFileStore } from "@story-mgr/file-store"
import type {
  AppSettingsResponse,
  CreateStoryResponse,
  StoryBibleResponse,
  StoryMetaResponse
} from "@story-mgr/shared"
import { parseRequestBody, requestSchemas } from "../request"
import { requireParam } from "./story-route-helpers"

/**
 * 为基础文档路由创建一组会共享同一个 File Store 的处理函数。
 *
 * @param store File Store 门面，提供故事和应用设置的读写能力。
 * @returns 只供 `registerStoryDocumentRoutes` 注册的命名处理函数集合。
 *
 * 使用工厂而不是在 `router.get()` 中写匿名大函数，是为了让每个请求处理器都有名字、注释和单一职责。
 */
function createStoryDocumentRouteHandlers(store: StoryFileStore) {
  /**
   * 返回服务健康状态。
   *
   * @param context Koa 请求上下文；本端点不读取 path、query 或 body。
   * @returns 无直接返回值；通过 `context.body` 输出 `{ ok: true }`。
   */
  function getHealth(context: Router.RouterContext) {
    context.body = { ok: true }
  }

  /**
   * 列出所有故事摘要，供编辑器首页显示故事卡片。
   *
   * @param context Koa 请求上下文；本端点没有输入参数。
   * @returns Promise；完成后 `context.body.stories` 包含按 File Store 规则生成的摘要列表。
   */
  async function listStories(context: Router.RouterContext) {
    context.body = {
      stories: await store.listStorySummaries()
    }
  }

  /**
   * 创建一个新故事及其默认文件。
   *
   * @param context Koa 请求上下文；body 必须符合 `createStory` Schema。
   * @returns Promise；成功时返回完整故事、首页摘要和初始 revision，并设置 HTTP 201。
   * @throws 请求体错误返回 400；故事 id 冲突或文件写入错误由 File Store 转换为对应 API 错误。
   *
   * 关键步骤：先解析不可信 body，再创建故事；随后重新读取摘要，确保返回内容与列表接口一致。
   */
  async function createStory(context: Router.RouterContext) {
    const body = parseRequestBody(context, requestSchemas.createStory)
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
      summary,
      revision: await store.readStoryRevision(story.story.id)
    } satisfies CreateStoryResponse
  }

  /**
   * 读取应用级设置，例如 AI 模型和图片服务配置。
   *
   * @param context Koa 请求上下文；没有故事 id，因为设置属于整个应用。
   * @returns Promise；通过 `context.body.settings` 返回当前设置。
   */
  async function getSettings(context: Router.RouterContext) {
    context.body = {
      settings: await store.readAppSettings()
    } satisfies AppSettingsResponse
  }

  /**
   * 保存应用级设置。
   *
   * @param context Koa 请求上下文；body 必须包含通过 Schema 的 `settings`。
   * @returns Promise；返回 File Store 实际写入后的设置。
   * @throws 非法字段返回 400；文件写入失败进入统一内部错误处理。
   */
  async function saveSettings(context: Router.RouterContext) {
    const body = parseRequestBody(context, requestSchemas.saveAppSettings)

    context.body = {
      settings: await store.writeAppSettings(body.settings)
    } satisfies AppSettingsResponse
  }

  /**
   * 读取编辑器所需的完整 StoryDocument 与当前 revision。
   *
   * @param context Koa 请求上下文；path 参数 `storyId` 指定故事。
   * @returns Promise；返回 `{ story, revision }`。
   * @throws 缺少/非法 storyId 或故事不存在时由参数工具/File Store 抛错。
   *
   * 故事和 revision 互不依赖，因此使用 `Promise.all` 并行读取，减少一次页面加载等待时间。
   */
  async function getStory(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const [story, revision] = await Promise.all([
      store.readStoryDocument(storyId),
      store.readStoryRevision(storyId)
    ])
    context.body = { story, revision }
  }

  /**
   * 保存 `story.json5` 中的标题、描述和标签等基础信息。
   *
   * @param context Koa 请求上下文；path 提供 storyId，body 提供 story 与 expectedRevision。
   * @returns Promise；返回服务端写入后的 story 和递增后的 revision。
   * @throws 过期 revision 返回 409，避免旧页面覆盖较新的故事信息。
   */
  async function saveStoryMeta(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveStoryMeta)

    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeStoryMeta(storyId, body.story)
    )
    context.body = {
      story: result.value,
      revision: result.revision
    } satisfies StoryMetaResponse
  }

  /**
   * 读取只供 AI 创作使用的故事圣经。
   *
   * @param context Koa 请求上下文；path 参数 `storyId` 指定故事。
   * @returns Promise；返回 `{ storyBible }`，不包含 revision，因为这是只读请求。
   */
  async function getStoryBible(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    context.body = {
      storyBible: await store.readStoryBible(storyId)
    } satisfies StoryBibleResponse
  }

  /**
   * 保存故事圣经。
   *
   * @param context Koa 请求上下文；body 提供 storyBible 与 expectedRevision。
   * @returns Promise；返回写入后的 storyBible 和新 revision。
   * @throws Schema 错误返回 400，revision 冲突返回 409。
   */
  async function saveStoryBible(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveStoryBible)

    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeStoryBible(storyId, body.storyBible)
    )
    context.body = {
      storyBible: result.value,
      revision: result.revision
    } satisfies StoryBibleResponse
  }

  return {
    createStory,
    getHealth,
    getSettings,
    getStory,
    getStoryBible,
    listStories,
    saveSettings,
    saveStoryBible,
    saveStoryMeta
  }
}

/**
 * 把基础文档处理函数注册到 Stories Router。
 *
 * @param router 已带 `/api` prefix 的 Router。
 * @param store File Store 门面，会被所有处理函数共享。
 * @returns 无返回值；副作用是向 router 增加九个端点。
 */
export function registerStoryDocumentRoutes(router: Router, store: StoryFileStore) {
  const handlers = createStoryDocumentRouteHandlers(store)

  router.get("/health", handlers.getHealth)
  router.get("/stories", handlers.listStories)
  router.post("/stories", handlers.createStory)
  router.get("/settings", handlers.getSettings)
  router.put("/settings", handlers.saveSettings)
  router.get("/stories/:storyId", handlers.getStory)
  router.put("/stories/:storyId/story", handlers.saveStoryMeta)
  router.get("/stories/:storyId/story-bible", handlers.getStoryBible)
  router.put("/stories/:storyId/story-bible", handlers.saveStoryBible)
}
