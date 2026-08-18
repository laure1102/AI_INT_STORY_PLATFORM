import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  createHtmlClientApp,
  type CreateHtmlClientAppOptions,
  type HtmlClientApp,
  type HtmlClientAppState
} from "./client-app"
import {
  buildClientState,
  findSystemValue,
  formatGameMinuteLabel
} from "./server-view"
import {
  buildRuntimeContacts,
  buildRuntimeContactThreadView,
  formatStoryValInput,
  getStoryValCalcDisplay,
  type RuntimeStorySessionAction,
  type RuntimeStorySessionSnapshot
} from "../../../packages/runtime/src/index"

interface HtmlClientOptions extends CreateHtmlClientAppOptions {
  port: number
  host: string
}

interface JsonRequest extends IncomingMessage {
  body?: unknown
}

class HttpError extends Error {
  statusCode: number

  /** @param statusCode 要返回的 HTTP 状态码。 @param message 面向本地客户端的错误说明。 @returns 带状态码的 Error。 */
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.statusCode = statusCode
  }
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const publicDir = path.resolve(__dirname, "..", "public")

/** @param startDirectory 搜索起点。 @returns 最近包含 pnpm-workspace.yaml 的父目录，找不到时返回起点。 */
function findWorkspaceRoot(startDirectory: string) {
  let currentDirectory = path.resolve(startDirectory)

  while (true) {
    if (existsSync(path.join(currentDirectory, "pnpm-workspace.yaml"))) {
      return currentDirectory
    }

    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return path.resolve(startDirectory)
    }

    currentDirectory = parentDirectory
  }
}

/**
 * 解析 HTML 客户端命令行参数。
 * @param argv 不含 node 和脚本路径的参数数组。 @returns 补齐故事、目录、host、port 和自动启动选项的配置。
 * @throws 端口非法或参数缺值时抛错，避免服务器以意外配置启动。
 */
function parseArgs(argv: string[]): HtmlClientOptions {
  const workspaceRoot = findWorkspaceRoot(process.cwd())
  const configuredPollInterval = Number(process.env.STORY_EVOLUTION_POLL_INTERVAL_MS ?? 30000)
  const options: HtmlClientOptions = {
    storyId: "demo",
    runtimeDir: path.join(workspaceRoot, ".html-client"),
    port: 5174,
    host: "127.0.0.1",
    evolutionPollIntervalMs: Number.isFinite(configuredPollInterval) && configuredPollInterval > 0 ? configuredPollInterval : 30000,
    evolutionApiUrl: process.env.STORY_EVOLUTION_API_URL?.trim() || undefined
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]

    if (current === "--story" && next) {
      options.storyId = next
      index += 1
      continue
    }

    if (current === "--data-dir" && next) {
      options.dataDir = next
      index += 1
      continue
    }

    if (current === "--runtime-dir" && next) {
      options.runtimeDir = next
      index += 1
      continue
    }

    if (current === "--profile" && next) {
      options.profileId = next
      index += 1
      continue
    }

    if (current === "--slot" && next) {
      options.slotId = next
      index += 1
      continue
    }

    if (current === "--player-id" && next) {
      options.playerId = next
      index += 1
      continue
    }

    if (current === "--shard-id" && next) {
      options.shardId = next
      index += 1
      continue
    }

    if (current === "--evolution-api-url" && next) {
      options.evolutionApiUrl = next
      index += 1
      continue
    }

    if (current === "--evolution-poll-ms" && next) {
      const interval = Number.parseInt(next, 10)
      if (Number.isFinite(interval) && interval > 0) options.evolutionPollIntervalMs = interval
      index += 1
      continue
    }

    if (current === "--port" && next) {
      const port = Number.parseInt(next, 10)
      if (Number.isFinite(port) && port > 0) {
        options.port = port
      }
      index += 1
      continue
    }

    if (current === "--host" && next) {
      options.host = next
      index += 1
      continue
    }

    if (current === "--new") {
      options.autoStartNewGame = true
    }
  }

  return options
}

/** @param options 服务器默认配置。 @param storyId 当前 URL 指定故事。 @returns 只替换 storyId 的新应用配置。 */
function cloneOptionsForStory(options: HtmlClientOptions, storyId: string): HtmlClientOptions {
  return {
    ...options,
    storyId
  }
}

/** @param value URL 编码的故事段。 @returns 解码后的安全故事 id。 @throws 含路径字符或非法字符时抛 404。 */
function normalizeStoryIdSegment(value: string) {
  const decoded = decodeURIComponent(value).trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(decoded)) {
    throw new HttpError(404, "故事不存在。")
  }
  return decoded
}

/**
 * 将外部 `/<storyId>/...` URL 拆成故事 id 与故事内路径。
 * @param pathname 请求 pathname。 @param defaultStoryId 根路径重定向使用的故事。 @returns storyId、innerPathname 和是否根路径。
 */
function getStoryRoute(pathname: string, defaultStoryId: string) {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) {
    return {
      storyId: defaultStoryId,
      innerPathname: "/",
      isRoot: true
    }
  }

  const storyId = normalizeStoryIdSegment(segments[0]!)
  const rest = segments.slice(1)
  return {
    storyId,
    innerPathname: rest.length > 0 ? `/${rest.join("/")}` : "/",
    isRoot: false
  }
}

/** @param value 未知 JSON 值。 @returns 是否为非数组对象，并帮助 TypeScript 收窄类型。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

/**
 * 读取并解析一个 JSON 请求体。
 * @param request Node HTTP 请求流。 @returns 空请求为 `{}`，否则为 JSON 解析值。
 * @throws JSON 语法错误时抛错；本地客户端请求体较小，此处按完整缓冲区读取。
 */
async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim()
  if (!rawBody) {
    return null
  }

  try {
    return JSON.parse(rawBody) as unknown
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON。")
  }
}

/** @param response Node HTTP 响应。 @param statusCode 状态码。 @param value JSON 值。 @returns 无返回值；设置 no-store 并结束响应。 */
function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  })
  response.end(JSON.stringify(value))
}

/** @param response Node HTTP 响应。 @param error 捕获到的错误。 @returns 无返回值；HttpError 保留状态，其它异常返回 500 JSON。 */
function sendError(response: ServerResponse, error: unknown): void {
  const statusCode = error instanceof HttpError ? error.statusCode : 500
  const message = error instanceof Error ? error.message : String(error)
  sendJson(response, statusCode, {
    ok: false,
    error: message
  })
}

/** @param request 已附加 body 的请求。 @returns body 为对象时原样返回，否则返回空对象。 */
function getJsonBody(request: JsonRequest) {
  return isRecord(request.body) ? request.body : {}
}

/** @param body JSON 对象。 @param key 字段名。 @returns 去空白字符串；类型不符时为空串。 */
function getStringBodyValue(body: Record<string, unknown>, key: string) {
  const value = body[key]
  return typeof value === "string" ? value.trim() : ""
}

/** @param app 故事应用门面。 @returns 无返回值。 @throws 尚无运行时会话时抛 409，阻止游戏动作 API。 */
function requireSession(app: HtmlClientApp): void {
  if (!app.getState().session) {
    throw new HttpError(409, "当前还没有运行时会话。")
  }
}

/**
 * 分派一个故事命名空间内的本地 JSON API。
 * @param app 当前故事应用。 @param request 请求及已解析 body。 @param response HTTP 响应。
 * @param pathname 去掉 storyId 后的 API 路径。 @param url 完整 URL。 @returns 处理完成的 Promise。
 * 各分支先校验会话和字符串字段，再调用门面；未知路径最终返回 404，不在这里提供静态文件。
 */
async function handleApi(app: HtmlClientApp, request: JsonRequest, response: ServerResponse, pathname: string, url: URL) {
  if (request.method === "GET" && pathname === "/api/state") {
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/bootstrap") {
    await app.bootstrap()
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/sync-story-bundle") {
    await app.syncStoryBundle()
    await app.listProfiles()
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "GET" && pathname === "/api/player-prompts") {
    await app.syncStoryBundle()
    const prompts = await app.listPlayerOverridePrompts()
    sendJson(response, 200, {
      ok: true,
      prompts
    })
    return
  }

  if (request.method === "POST" && pathname === "/api/profiles/create") {
    const body = getJsonBody(request)
    const profileName = getStringBodyValue(body, "profileName")
    const rawCustomValues = body.customValues
    const customValues: Record<string, unknown> = isRecord(rawCustomValues) ? rawCustomValues : {}

    await app.createProfile({
      profileName,
      customValues
    })
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/profiles/select") {
    const body = getJsonBody(request)
    const profileId = getStringBodyValue(body, "profileId")
    if (!profileId) {
      throw new HttpError(400, "缺少 profileId。")
    }

    await app.selectProfile(profileId)
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/saves/list") {
    await app.listSaveSlots()
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/session/new") {
    await app.startNewGame()
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/session/load") {
    const body = getJsonBody(request)
    const slotId = getStringBodyValue(body, "slotId")
    if (!slotId) {
      throw new HttpError(400, "缺少 slotId。")
    }

    await app.loadSave(slotId)
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/session/save") {
    const body = getJsonBody(request)
    const slotId = getStringBodyValue(body, "slotId") || `slot-${app.getState().saveSlots.length + 1}`
    await app.saveToSlot(slotId)
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/session/action") {
    requireSession(app)
    const body = getJsonBody(request)
    const action = body.action
    if (!isRecord(action) || typeof action.type !== "string") {
      throw new HttpError(400, "缺少有效 action。")
    }

    const actionSucceeded = app.dispatch(action as RuntimeStorySessionAction)
    sendJson(response, 200, {
      ...buildClientState(app),
      actionSucceeded: actionSucceeded !== false
    })
    return
  }

  if (request.method === "POST" && pathname === "/api/session/tick") {
    requireSession(app)
    const body = getJsonBody(request)
    const deltaMs = typeof body.deltaMs === "number" && Number.isFinite(body.deltaMs)
      ? Math.max(0, Math.trunc(body.deltaMs))
      : 1000
    app.tick(deltaMs)
    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/session/time") {
    requireSession(app)
    const body = getJsonBody(request)

    if (typeof body.paused === "boolean") {
      app.setTimePause(body.paused)
    }

    if (typeof body.speed === "number" && Number.isFinite(body.speed)) {
      app.setTimeSpeed(Math.max(0, body.speed))
    }

    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "POST" && pathname === "/api/session/advance-day") {
    requireSession(app)
    const snapshot = app.getState().session?.getSnapshot() ?? null
    const nowHour = findSystemValue(snapshot, "system.now_hour")
    const nowMinute = findSystemValue(snapshot, "system.now_minute")
    const hourValue = typeof nowHour === "number" && Number.isFinite(nowHour) ? nowHour : 0
    const minuteValue = typeof nowMinute === "number" && Number.isFinite(nowMinute) ? nowMinute : 0
    const minutesUntilNextDay = Math.max(1, (24 * 60) - (hourValue * 60 + minuteValue))
    const paused = findSystemValue(snapshot, "system.time_pause") === true
    const rawSpeed = findSystemValue(snapshot, "system.time_speed")
    const speed = typeof rawSpeed === "number" && Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1

    app.setTimePause(false)
    app.setTimeSpeed(1)
    app.tick(minutesUntilNextDay * 60000)
    app.setTimeSpeed(speed)
    app.setTimePause(paused)

    sendJson(response, 200, buildClientState(app))
    return
  }

  if (request.method === "GET" && pathname === "/api/contact/thread") {
    const state = app.getState()
    const roleKey = url.searchParams.get("roleKey")?.trim() ?? ""
    const snapshot = state.session?.getSnapshot() ?? null

    if (!roleKey) {
      throw new HttpError(400, "缺少 roleKey。")
    }

    const thread = state.bundle && snapshot
      ? buildContactThreadClientView(buildRuntimeContactThreadView(state.bundle, snapshot, roleKey))
      : null

    sendJson(response, 200, {
      ok: true,
      thread
    })
    return
  }

  throw new HttpError(404, "接口不存在。")
}

/** @param thread Runtime 联系人线程视图或 null。 @returns 适合浏览器 JSON 的线程，并补消息时间标签；null 原样返回。 */
function buildContactThreadClientView(thread: ReturnType<typeof buildRuntimeContactThreadView>) {
  if (!thread) {
    return null
  }

  return {
    ...thread,
    messages: thread.messages.map((message) => ({
      ...message,
      gameMinuteLabel: formatGameMinuteLabel(message.gameMinute)
    }))
  }
}

/** @param filePath 静态文件路径。 @returns 根据扩展名确定的 Content-Type，未知类型使用二进制流。 */
function getContentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8"
    case ".css":
      return "text/css; charset=utf-8"
    case ".js":
      return "text/javascript; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".svg":
      return "image/svg+xml"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    default:
      return "application/octet-stream"
  }
}

/** @param response Node HTTP 响应。 @returns 读取并发送 public/index.html 的 Promise，禁用缓存。 */
async function sendIndexHtml(response: ServerResponse) {
  const indexPath = path.join(publicDir, "index.html")
  const indexHtml = await readFile(indexPath, "utf8")
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  })
  response.end(indexHtml)
}

/**
 * 安全发送浏览器静态资源。
 * @param request HTTP 请求。 @param response HTTP 响应。 @param innerPathname 故事内资源路径。 @param storyId 当前故事 id。
 * @returns 发送完成的 Promise。 @throws 路径越出 publicDir 时抛 403，不存在时回退 SPA index。
 * 解析后再次比较绝对路径前缀，避免 URL 编码或 `..` 绕过目录边界。
 */
async function serveStatic(request: IncomingMessage, response: ServerResponse, innerPathname: string, storyId: string) {
  const safePathname = innerPathname === "/" ? "/index.html" : innerPathname
  const decodedPath = decodeURIComponent(safePathname)
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "")
  const filePath = path.join(publicDir, normalizedPath)
  const resolvedFilePath = path.resolve(filePath)

  if (!resolvedFilePath.startsWith(publicDir)) {
    throw new HttpError(403, "禁止访问该路径。")
  }

  try {
    if (safePathname === "/index.html") {
      await sendIndexHtml(response)
      return
    }

    const statsRaw = await readFile(resolvedFilePath)
    response.writeHead(200, {
      "content-type": getContentType(resolvedFilePath),
      "cache-control": "no-store"
    })
    response.end(statsRaw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await sendIndexHtml(response)
      return
    }

    throw error
  }

  void request
  void storyId
}

/**
 * 启动多故事 HTML 客户端 HTTP 服务器。
 * @returns 服务器开始监听后的 Promise；每个 storyId 懒创建并缓存独立 HtmlClientApp。
 */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const apps = new Map<string, HtmlClientApp>()
  /** @param storyId URL 中的故事 id。 @returns 已缓存或新创建的故事应用门面。 */
  const getApp = (storyId: string) => {
    const cached = apps.get(storyId)
    if (cached) {
      return cached
    }

    const nextApp = createHtmlClientApp(cloneOptionsForStory(options, storyId))
    apps.set(storyId, nextApp)
    return nextApp
  }

  const server = createServer(async (request: JsonRequest, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
      const pathname = url.pathname
      const route = getStoryRoute(pathname, options.storyId)

      if (route.isRoot) {
        response.writeHead(302, {
          location: `/${encodeURIComponent(options.storyId)}/`
        })
        response.end()
        return
      }

      if (route.innerPathname === "/" && !pathname.endsWith("/")) {
        response.writeHead(302, {
          location: `${pathname}/${url.search}`
        })
        response.end()
        return
      }

      if (route.innerPathname.startsWith("/api/")) {
        if (request.method !== "GET") {
          request.body = await readRequestBody(request)
        }
        await handleApi(getApp(route.storyId), request, response, route.innerPathname, url)
        return
      }

      await serveStatic(request, response, route.innerPathname, route.storyId)
    } catch (error) {
      sendError(response, error)
    }
  })

  let appsDisposed = false
  /** 释放所有故事应用持有的轮询器和 Worker。 */
  const disposeApps = () => {
    if (appsDisposed) return
    appsDisposed = true
    for (const app of apps.values()) app.dispose()
    apps.clear()
  }
  /** 处理进程信号并触发 HTTP server 的正常关闭。 */
  const closeServer = () => server.close()
  process.once("SIGINT", closeServer)
  process.once("SIGTERM", closeServer)
  server.once("close", () => {
    process.off("SIGINT", closeServer)
    process.off("SIGTERM", closeServer)
    disposeApps()
  })

  server.listen(options.port, options.host, () => {
    const displayHost = options.host === "0.0.0.0" ? "localhost" : options.host
    console.log(`[html-client] ${options.storyId} listening on http://${displayHost}:${options.port}/${options.storyId}`)
    console.log(`[html-client] runtime dir: ${options.runtimeDir}`)
  })
}

void main()
