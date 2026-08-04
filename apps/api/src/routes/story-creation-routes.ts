/**
 * AI 创作、单事件对白、创作历史和可恢复任务路由。
 *
 * 生成端点只产生草稿；应用端点才会事务修改故事。长任务使用 SQLite/checkpoint 保存服务端状态，
 * 前端通过普通查询或 SSE 接收进度。本模块只处理 HTTP 生命周期，不实现 Agent 工作流本身。
 */
import Router from "@koa/router"
import { FileStoreError, type StoryFileStore } from "@story-mgr/file-store"
import type {
  ApplyStoryCreationDraftResponse,
  DeleteStoryCreationHistorySessionResponse,
  GenerateStoryDialogueResponse,
  RunStoryCreationAgentResponse,
  SaveStoryCreationHistorySessionResponse,
  StoryCreationHistoryResponse,
  StoryCreationJobListResponse,
  StoryCreationJobResponse,
  StoryCreationJobStreamEvent
} from "@story-mgr/shared"
import type { ApiConfig } from "../config"
import { parseRequestBody, requestSchemas } from "../request"
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
import type { StoryCreationJobService } from "../services/story-creation-jobs"
import { requireExpectedRevision, requireParam } from "./story-route-helpers"

/**
 * 把客户端连接关闭事件转换成可传给 AI 工作流的 AbortSignal。
 *
 * @param context 当前 Koa 请求上下文。
 * @returns 当请求被浏览器中止或 TCP 连接关闭时会触发 abort 的信号。
 *
 * 长模型调用若不监听连接关闭，会在用户离开页面后继续耗费 token。两个 Node 请求事件共用同一个
 * 命名回调，任意一个发生都只会把 controller 切换到 aborted 状态。
 */
function createRequestAbortSignal(context: Router.RouterContext) {
  const controller = new AbortController()

  /** 无入参、无返回值；只把当前请求对应的 AbortController 标记为已取消。 */
  function abortRequest() {
    controller.abort()
  }

  context.req.on("aborted", abortRequest)
  context.req.on("close", abortRequest)
  return controller.signal
}

/**
 * 判断 AI job 是否已经进入不会再产生新事件的终态。
 *
 * @param status 当前 job 状态。
 * @returns completed、failed、cancelled 返回 true，其余返回 false。
 */
function isTerminalJobStatus(status: StoryCreationJobResponse["job"]["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

/**
 * 按 Server-Sent Events 格式写一条事件。
 *
 * @param context 已切换为手动响应的 Koa 上下文。
 * @param event 可 JSON 序列化的任务事件或快照。
 * @param type SSE 的 event 名称，例如 snapshot、log、status。
 * @returns 无返回值；副作用是向仍保持连接的 HTTP Response 写入一帧文本。
 */
function sendCreationJobSseEvent(
  context: Router.RouterContext,
  event: unknown,
  type: string
) {
  context.res.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`)
}

/**
 * 创建 AI 创作相关处理函数。
 *
 * @param store File Store 门面，用于读故事、revision 锁和草稿事务应用。
 * @param config API 配置，创作历史服务需要数据目录。
 * @param creationJobs 可恢复任务服务，负责 SQLite job、取消和事件订阅。
 * @returns 十一个命名处理函数。
 */
function createStoryCreationRouteHandlers(
  store: StoryFileStore,
  config: ApiConfig,
  creationJobs: StoryCreationJobService
) {
  /**
   * 兼容旧前端的同步六 Agent 端点。
   *
   * @param context body 提供 instruction 和可选 baseDraft；path 提供 storyId。
   * @returns Promise；连接保持期间直接返回最终草稿和日志。
   * @throws 输入、设置、模型或工作流错误；客户端断开会通过 AbortSignal 尽快取消。
   *
   * 响应附加 Deprecation/Sunset/Link，提示新客户端改用 creation-jobs，而不立即破坏旧客户端。
   */
  async function runLegacyCreationAgent(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.runStoryCreationAgent)
    context.set("Deprecation", "true")
    context.set("Sunset", "Mon, 02 Nov 2026 00:00:00 GMT")
    context.set("Link", `</api/stories/${storyId}/creation-jobs>; rel="successor-version"`)
    const [settings, story] = await Promise.all([
      store.readAppSettings(),
      store.readStoryDocument(storyId)
    ])

    context.body = await runStoryCreationAgents(
      settings,
      story,
      body.instruction,
      body.baseDraft,
      createRequestAbortSignal(context)
    ) satisfies RunStoryCreationAgentResponse
  }

  /**
   * 将用户明确勾选的 AI 草稿应用到故事。
   *
   * @param context body 提供 draft、selection 和 expectedRevision。
   * @returns Promise；返回事务提交后的 StoryDocument、校验结果、应用数量、warnings 和 revision。
   * @throws 草稿非法返回 400，候选故事无效返回 400，revision 冲突返回 409。
   */
  async function applyCreationDraft(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.applyStoryCreationDraft)
    context.body = await applyStoryCreationDraft(
      store,
      storyId,
      body
    ) satisfies ApplyStoryCreationDraftResponse
  }

  /**
   * 为一个现有事件单独生成对白草稿。
   *
   * @param context body 提供事件上下文和对白要求；path 提供 storyId。
   * @returns Promise；返回对白数组、摘要和 warnings，不自动保存事件。
   * @throws 请求、模型或故事读取错误；连接断开会取消模型调用。
   */
  async function generateDialogue(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.generateStoryDialogue)
    const [settings, story] = await Promise.all([
      store.readAppSettings(),
      store.readStoryDocument(storyId)
    ])

    context.body = await generateStoryEventDialogues(
      settings,
      story,
      body,
      createRequestAbortSignal(context)
    ) satisfies GenerateStoryDialogueResponse
  }

  /**
   * 读取当前故事的本地创作历史文件。
   *
   * @param context path 参数 storyId 指定故事。
   * @returns Promise；响应 `{ history }` 包含按历史服务规则整理的 sessions。
   * @throws storyId 非法或历史文件损坏时抛错。
   */
  async function getCreationHistory(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    context.body = {
      history: await readStoryCreationHistory(config.dataDir, storyId)
    } satisfies StoryCreationHistoryResponse
  }

  /**
   * 新增或更新一条创作历史 session。
   *
   * @param context path 提供 storyId/sessionId；body 提供 session 和 expectedRevision。
   * @returns Promise；返回完整 history 和新 revision。
   * @throws path 与 payload id 不一致返回 400，revision 冲突返回 409。
   *
   * 历史虽然不参与 Runtime bundle，仍会与编辑器故事同时变化，所以也使用同一 revision 防止覆盖。
   */
  async function saveCreationHistorySession(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const sessionId = requireParam(context.params.sessionId, "sessionId")
    const body = parseRequestBody(context, requestSchemas.saveCreationHistorySession)

    if (body.session.id !== sessionId) {
      throw new FileStoreError(
        "Creation history session id in path and payload must match.",
        400,
        "creation-history.session-id-mismatch"
      )
    }

    const mutation = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      upsertStoryCreationHistorySession(config.dataDir, storyId, body.session)
    )
    context.body = {
      ...mutation.value,
      revision: mutation.revision
    } satisfies SaveStoryCreationHistorySessionResponse
  }

  /**
   * 创建一个后台可恢复 AI 创作任务。
   *
   * @param context body 提供 instruction 和可选 baseDraft；path 提供 storyId。
   * @returns Promise；HTTP 202 和初始 queued job，实际工作流在后台启动。
   * @throws 故事不存在或 body 非法时不会创建任务。
   */
  async function createCreationJob(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.runStoryCreationAgent)
    await store.readStoryDocument(storyId)
    context.status = 202
    context.body = {
      job: creationJobs.createJob(storyId, body)
    } satisfies StoryCreationJobResponse
  }

  /**
   * 列出一个故事的全部 AI 创作任务。
   *
   * @param context path 参数 storyId 指定任务所属故事。
   * @returns 无 Promise 要求；响应 `{ jobs }` 来自 SQLite 当前快照。
   */
  function listCreationJobs(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    context.body = {
      jobs: creationJobs.listJobs(storyId)
    } satisfies StoryCreationJobListResponse
  }

  /**
   * 查询单个 AI 创作任务。
   *
   * @param context path 提供 storyId/jobId。
   * @returns 无 Promise 要求；响应 `{ job }`。
   * @throws job 不存在或不属于该故事时返回 404。
   */
  function getCreationJob(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const jobId = requireParam(context.params.jobId, "jobId")
    context.body = {
      job: creationJobs.getJob(storyId, jobId)
    } satisfies StoryCreationJobResponse
  }

  /**
   * 请求取消一个 AI 创作任务。
   *
   * @param context path 提供 storyId/jobId。
   * @returns 无 Promise 要求；响应为取消后的最新 job。
   * @throws job 不存在时返回 404；终态任务由服务层按幂等规则处理。
   */
  function cancelCreationJob(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const jobId = requireParam(context.params.jobId, "jobId")
    context.body = {
      job: creationJobs.cancelJob(storyId, jobId)
    } satisfies StoryCreationJobResponse
  }

  /**
   * 建立 AI job 的 SSE 日志/状态流。
   *
   * @param context path 提供 storyId/jobId；响应保持为 text/event-stream。
   * @returns 无普通 JSON 返回；先发送 snapshot，随后推送 job 事件，终态或连接关闭时结束。
   * @throws job 不存在时在切换手动响应前返回 404。
   *
   * 关键算法：先取得初始快照防止订阅前事件丢失；终态立即结束；运行态订阅 EventEmitter，并每 15 秒
   * 写 SSE 注释心跳防止代理断开。cleanup 同时取消心跳和监听器，避免内存泄漏。
   */
  function streamCreationJobEvents(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const jobId = requireParam(context.params.jobId, "jobId")
    const initialJob = creationJobs.getJob(storyId, jobId)
    context.status = 200
    context.set("Content-Type", "text/event-stream; charset=utf-8")
    context.set("Cache-Control", "no-cache, no-transform")
    context.set("Connection", "keep-alive")
    context.respond = false
    context.res.flushHeaders()

    sendCreationJobSseEvent(context, { type: "snapshot", job: initialJob }, "snapshot")
    if (isTerminalJobStatus(initialJob.status)) {
      context.res.end()
      return
    }

    /**
     * 接收任务服务事件并转成 SSE；状态进入终态时清理资源并关闭响应。
     * @param event 任务服务发出的 log/status 等结构化事件。
     * @returns 无返回值。
     */
    function handleJobEvent(event: StoryCreationJobStreamEvent) {
      sendCreationJobSseEvent(context, event, event.type)
      if (event.type === "status" && isTerminalJobStatus(event.job.status)) {
        cleanup()
        context.res.end()
      }
    }

    /** 无入参、无返回值；写 SSE 注释心跳，不会触发浏览器业务事件。 */
    function writeHeartbeat() {
      context.res.write(": keep-alive\n\n")
    }

    const unsubscribe = creationJobs.subscribe(jobId, handleJobEvent)
    const heartbeat = setInterval(writeHeartbeat, 15_000)
    heartbeat.unref()

    /** 无入参、无返回值；停止心跳并取消 job 订阅，可安全重复调用。 */
    function cleanup() {
      clearInterval(heartbeat)
      unsubscribe()
    }

    context.req.once("close", cleanup)
  }

  /**
   * 删除一条创作历史 session。
   *
   * @param context path 提供 storyId/sessionId；query.expectedRevision 提供版本。
   * @returns Promise；返回删除后的 history 和新 revision。
   * @throws revision 缺失/冲突或 session 不存在时抛错。
   */
  async function deleteCreationHistorySessionRoute(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const sessionId = requireParam(context.params.sessionId, "sessionId")
    const expectedRevision = requireExpectedRevision(context.query.expectedRevision)
    const mutation = await store.withStoryMutation(storyId, expectedRevision, () =>
      deleteStoryCreationHistorySession(config.dataDir, storyId, sessionId)
    )
    context.body = {
      ...mutation.value,
      revision: mutation.revision
    } satisfies DeleteStoryCreationHistorySessionResponse
  }

  return {
    applyCreationDraft,
    cancelCreationJob,
    createCreationJob,
    deleteCreationHistorySessionRoute,
    generateDialogue,
    getCreationHistory,
    getCreationJob,
    listCreationJobs,
    runLegacyCreationAgent,
    saveCreationHistorySession,
    streamCreationJobEvents
  }
}

/**
 * 注册 AI 创作、历史和任务端点。
 *
 * @param router Stories 总 Router。
 * @param store File Store 门面。
 * @param config API 配置。
 * @param creationJobs 后台任务服务。
 * @returns 无返回值；添加十一个端点。
 */
export function registerStoryCreationRoutes(
  router: Router,
  store: StoryFileStore,
  config: ApiConfig,
  creationJobs: StoryCreationJobService
) {
  const handlers = createStoryCreationRouteHandlers(store, config, creationJobs)

  router.post("/stories/:storyId/creation-agent/run", handlers.runLegacyCreationAgent)
  router.post("/stories/:storyId/creation-agent/apply", handlers.applyCreationDraft)
  router.post("/stories/:storyId/dialogue-agent/generate", handlers.generateDialogue)
  router.get("/stories/:storyId/creation-history", handlers.getCreationHistory)
  router.put("/stories/:storyId/creation-history/:sessionId", handlers.saveCreationHistorySession)
  router.delete(
    "/stories/:storyId/creation-history/:sessionId",
    handlers.deleteCreationHistorySessionRoute
  )
  router.post("/stories/:storyId/creation-jobs", handlers.createCreationJob)
  router.get("/stories/:storyId/creation-jobs", handlers.listCreationJobs)
  router.get("/stories/:storyId/creation-jobs/:jobId", handlers.getCreationJob)
  router.delete("/stories/:storyId/creation-jobs/:jobId", handlers.cancelCreationJob)
  router.get("/stories/:storyId/creation-jobs/:jobId/events", handlers.streamCreationJobEvents)
}
