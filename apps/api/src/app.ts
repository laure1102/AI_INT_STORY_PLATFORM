/**
 * Story Manager API 的 Koa 应用装配入口。
 *
 * 本文件把请求编号、日志、错误处理、Bearer 鉴权、CORS、JSON 解析和 Stories Router 按顺序串起来。
 * 每个中间件只处理一个横切职责；实际的故事读写仍由路由和 File Store 完成。
 */
import cors from "@koa/cors"
import { randomUUID, timingSafeEqual } from "node:crypto"
import Koa from "koa"
import bodyParser from "koa-bodyparser"
import { ZodError } from "zod"
import { createStoryFileStore, FileStoreError } from "@story-mgr/file-store"
import type { ApiErrorResponse } from "@story-mgr/shared"
import type { ApiConfig } from "./config"
import { createStoriesRouter } from "./routes/stories"
import type { runStoryCreationAgents } from "./services/story-creation"
import { StoryCreationJobService } from "./services/story-creation-jobs"
import { EvolutionService, type EvolutionServiceOptions } from "./services/evolution"

export type StoryManagerApp = Koa & {
  closeServices(): Promise<void>
}

/** 创建应用时允许测试或上层程序替换的依赖。生产环境通常不需要传入。 */
export interface StoryManagerAppDependencies {
  /** 测试用工作流执行器；省略时使用真实的六 Agent 工作流。 */
  creationJobRunner?: typeof runStoryCreationAgents
  evolution?: Pick<EvolutionServiceOptions, "workflowRunner" | "embeddingProvider">
}

/**
 * 给每个请求分配可追踪的 requestId。
 *
 * @param context 当前 HTTP 请求/响应上下文。可从 `X-Request-Id` 读取调用方提供的编号。
 * @param next Koa 提供的“继续执行后续中间件”函数。
 * @returns Promise；后续请求链结束后完成，没有业务返回值。
 *
 * 合理长度的外部编号会被保留，便于前后端日志对照；空值或超过 128 字符的值会替换成随机 UUID，
 * 防止异常长 Header 污染日志。编号同时放入 `context.state` 和响应 Header，错误处理和客户端都能看到。
 */
async function assignRequestId(context: Koa.Context, next: Koa.Next): Promise<void> {
  const incomingRequestId = context.get("X-Request-Id").trim()
  const requestId = incomingRequestId && incomingRequestId.length <= 128
    ? incomingRequestId
    : randomUUID()

  context.state.requestId = requestId
  context.set("X-Request-Id", requestId)
  await next()
}

/**
 * 记录一次请求的路径、状态码和总耗时。
 *
 * @param context 当前 Koa 上下文，提供 method、path 和最终 status。
 * @param next 后续中间件执行函数。
 * @returns Promise；日志写完后完成。
 *
 * `finally` 保证后续代码即使抛错也会记录耗时。由于错误边界位于它后面，正常情况下日志中的状态码
 * 已经是最终映射后的 400、404、409、500 等状态。
 */
async function logRequest(context: Koa.Context, next: Koa.Next): Promise<void> {
  const startedAt = Date.now()

  try {
    await next()
  } finally {
    const elapsedMs = Date.now() - startedAt
    console.info(
      `[api] ${context.method} ${context.path} -> ${context.status} (${elapsedMs}ms)`
    )
  }
}

/**
 * 把应用内部抛出的不同错误统一转换成安全的 API 错误结构。
 *
 * @param context 当前 Koa 上下文；函数会设置 status 和 `{ error: ... }` 响应体。
 * @param next 后续鉴权、解析和路由中间件。
 * @returns Promise；错误已写入响应时正常结束，不再向外抛出。
 *
 * 映射顺序很重要：Zod 输入错误为 400；multer 文件过大为 413；File Store 保留自己的业务状态码；
 * body parser 的坏 JSON 为 400；未知异常只对外显示通用 500。真实异常只写服务端日志，避免把路径、
 * SQL 或上游密钥等内部信息泄露给浏览器。没有路由处理的空 404 也在这里补成统一结构。
 */
async function handleApiErrors(context: Koa.Context, next: Koa.Next): Promise<void> {
  try {
    await next()

    if (context.status === 404 && !context.body) {
      context.status = 404
      context.body = {
        error: {
          message: "Route not found.",
          code: "route.not-found",
          requestId: context.state.requestId
        }
      } satisfies ApiErrorResponse
    }
  } catch (error) {
    const requestId = context.state.requestId as string
    console.error(`[api] request ${requestId} failed`, error)

    if (error instanceof ZodError) {
      context.status = 400
      context.body = {
        error: {
          message: "Request body validation failed.",
          code: "request.invalid-body",
          requestId,
          details: error.issues.map((issue) => ({
            code: issue.code,
            message: issue.message,
            path: issue.path
          }))
        }
      } satisfies ApiErrorResponse
      return
    }

    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "LIMIT_FILE_SIZE"
    ) {
      context.status = 413
      context.body = {
        error: {
          message: "Uploaded image exceeds the 25 MiB limit.",
          code: "asset.file-too-large",
          requestId
        }
      } satisfies ApiErrorResponse
      return
    }

    if (error instanceof FileStoreError) {
      context.status = error.statusCode
      context.body = {
        error: {
          message: error.message,
          code: error.code,
          requestId
        }
      } satisfies ApiErrorResponse
      return
    }

    if (error instanceof Error || error) {
      const status = typeof error === "object"
        && error !== null
        && "status" in error
        && error.status === 400
        ? 400
        : 500
      context.status = status
      context.body = {
        error: {
          message: status === 400 ? "Malformed request body." : "Internal server error.",
          code: status === 400 ? "request.malformed-body" : "internal.error",
          requestId
        }
      } satisfies ApiErrorResponse
    }
  }
}

/**
 * 创建 Bearer Token 鉴权中间件。
 *
 * @param accessToken 服务启动配置中期望的明文令牌，只保存在闭包内。
 * @returns Koa 中间件；有效令牌继续执行，无效令牌直接返回统一的 401 响应。
 *
 * `/api/health` 特意免鉴权，便于本机进程探活。比较令牌前先比较 Buffer 长度，因为
 * `timingSafeEqual` 要求两边长度一致；长度相同后使用常量时间比较，减少普通字符串比较的时序泄漏。
 */
function createAccessTokenMiddleware(accessToken: string): Koa.Middleware {
  const expectedToken = Buffer.from(accessToken)

  /**
   * 检查单个请求的 Authorization Header。
   *
   * @param context 当前请求上下文。
   * @param next 鉴权成功后要继续执行的中间件链。
   * @returns Promise；鉴权失败时写入 401，成功时等待后续链完成。
   */
  return async function verifyAccessToken(context, next) {
    if (context.path === "/api/health") {
      await next()
      return
    }

    const authorization = context.get("Authorization")
    const suppliedToken = authorization.startsWith("Bearer ")
      ? Buffer.from(authorization.slice("Bearer ".length))
      : Buffer.alloc(0)
    const authorized = suppliedToken.length === expectedToken.length
      && timingSafeEqual(suppliedToken, expectedToken)

    if (!authorized) {
      context.status = 401
      context.body = {
        error: {
          message: "A valid bearer token is required.",
          code: "auth.unauthorized",
          requestId: context.state.requestId
        }
      } satisfies ApiErrorResponse
      return
    }

    await next()
  }
}

/**
 * 创建 CORS 来源选择函数。
 *
 * @param corsOrigins 配置明确允许访问 API 的网页 Origin 列表。
 * @returns 交给 `@koa/cors` 的函数：允许时回显请求 Origin，不允许时返回空字符串。
 *
 * 没有 Origin 的请求通常来自同源页面、curl 或服务端调用，库仍需要一个字符串，因此返回第一个
 * 配置项。带 Origin 的浏览器请求必须精确命中 Set，不能用模糊后缀匹配。
 */
function createCorsOriginResolver(
  corsOrigins: string[]
): (context: Koa.Context) => string {
  const allowedOrigins = new Set(corsOrigins)

  /**
   * 为当前请求计算 `Access-Control-Allow-Origin` 的值。
   *
   * @param context 当前请求上下文，从 Header 读取 Origin。
   * @returns 允许的来源字符串；不在白名单时返回空字符串，浏览器会阻止跨域读取。
   */
  return function resolveCorsOrigin(context: Koa.Context): string {
    const origin = context.get("Origin")
    if (!origin) {
      return corsOrigins[0] ?? ""
    }

    return allowedOrigins.has(origin) ? origin : ""
  }
}

/**
 * 创建并装配完整的 Story Manager Koa 应用。
 *
 * @param config 已通过 `createApiConfig` 生成的监听、目录、CORS 和鉴权配置。
 * @param dependencies 可选测试依赖；生产调用通常省略。
 * @returns 带 `closeServices()` 的 Koa 应用。调用方可以监听端口，并在退出时关闭任务数据库。
 * @throws 创建数据目录或 SQLite 服务失败时抛错，应用不会以半初始化状态启动。
 *
 * 中间件顺序即请求顺序：requestId → 计时日志 → 错误边界 → 可选鉴权 → CORS → JSON 解析 → 路由。
 * 顺序不能随意交换，例如错误边界必须位于 bodyParser 之前，才能把损坏 JSON 转成结构化 400。
 */
export function createApp(
  config: ApiConfig,
  dependencies: StoryManagerAppDependencies = {}
): StoryManagerApp {
  const app = new Koa() as StoryManagerApp
  const store = createStoryFileStore(config.dataDir)
  const creationJobs = new StoryCreationJobService(
    store,
    config.stateDir,
    dependencies.creationJobRunner
  )
  const storiesRouter = createStoriesRouter(store, config, creationJobs, dependencies.evolution)
  const evolution = (storiesRouter as typeof storiesRouter & { evolutionService?: EvolutionService }).evolutionService

  // 服务重启后，SQLite 中 queued/running 的任务会从 LangGraph checkpoint 继续执行。
  creationJobs.resumePendingJobs()

  /**
   * 关闭应用自己持有的后台服务。
   *
   * @returns 所有运行任务完成清理并关闭 SQLite 连接后 resolve。
   */
  async function closeServices(): Promise<void> {
    await creationJobs.close()
    await evolution?.close()
  }

  app.closeServices = closeServices
  app.use(assignRequestId)
  app.use(logRequest)
  app.use(handleApiErrors)

  if (config.accessToken) {
    app.use(createAccessTokenMiddleware(config.accessToken))
  }

  app.use(cors({ origin: createCorsOriginResolver(config.corsOrigins) }))
  app.use(bodyParser())
  app.use(storiesRouter.routes())
  app.use(storiesRouter.allowedMethods())

  return app
}
