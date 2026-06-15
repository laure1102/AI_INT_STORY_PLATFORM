import { createReadStream, existsSync } from "node:fs"
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
  buildRuntimePhoneContacts,
  buildRuntimePhoneThreadView,
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

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.statusCode = statusCode
  }
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const publicDir = path.resolve(__dirname, "..", "public")

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

function parseArgs(argv: string[]): HtmlClientOptions {
  const workspaceRoot = findWorkspaceRoot(process.cwd())
  const options: HtmlClientOptions = {
    storyId: "demo",
    runtimeDir: path.join(workspaceRoot, ".html-client"),
    port: 5174,
    host: "127.0.0.1"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

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

function sendJson(response: ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  })
  response.end(JSON.stringify(value))
}

function sendError(response: ServerResponse, error: unknown) {
  const statusCode = error instanceof HttpError ? error.statusCode : 500
  const message = error instanceof Error ? error.message : String(error)
  sendJson(response, statusCode, {
    ok: false,
    error: message
  })
}

function findSystemValue(snapshot: RuntimeStorySessionSnapshot | null, token: string) {
  if (!snapshot) {
    return undefined
  }

  const [groupName, rowName] = token.split(".")
  if (!groupName || !rowName) {
    return undefined
  }

  const matchedGroups = [
    ...snapshot.system_vals.variables,
    ...snapshot.vals.variables
  ]
  const group = matchedGroups.find((item) => item.name.trim() === groupName.trim())
  const row = group?.vals.find((item) => item.name.trim() === rowName.trim())
  return row?.value
}

function formatHumanizedAmount(amount: unknown) {
  const cleanAmount = String(amount ?? "").replace(/\s+/g, "")
  if (!cleanAmount || Number.isNaN(Number(cleanAmount))) {
    return "0"
  }

  let num = BigInt(cleanAmount)
  if (num === 0n) {
    return "0"
  }

  if (num < 10000n) {
    return `${num}`
  }

  num = (num / 1000n) * 1000n

  const oneYi = 100000000n
  const oneWan = 10000n
  const oneQian = 1000n
  const yi = num / oneYi
  let remainder = num % oneYi
  const wan = remainder / oneWan
  remainder %= oneWan
  const qian = remainder / oneQian
  let result = ""

  if (yi > 0n) {
    result += `${yi}亿`
  }
  if (wan > 0n) {
    result += `${wan}万`
  }
  if (qian > 0n) {
    result += `${qian}千`
  }

  return result
}

function formatGameMinuteLabel(gameMinute: number | null | undefined, baseDay = 1) {
  if (typeof gameMinute !== "number" || !Number.isFinite(gameMinute) || gameMinute < 0) {
    return "未定"
  }

  const safeMinute = Math.trunc(gameMinute)
  const normalizedBaseDay = Number.isFinite(baseDay) ? Math.max(1, Math.trunc(baseDay)) : 1
  const dayNumber = Math.floor(safeMinute / (24 * 60)) + normalizedBaseDay
  const minuteOfDay = ((safeMinute % (24 * 60)) + (24 * 60)) % (24 * 60)
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return `第${dayNumber}天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function formatClockMinuteLabel(gameMinute: number | null | undefined) {
  if (typeof gameMinute !== "number" || !Number.isFinite(gameMinute) || gameMinute < 0) {
    return "--:--"
  }

  const safeMinute = Math.trunc(gameMinute)
  const minuteOfDay = ((safeMinute % (24 * 60)) + (24 * 60)) % (24 * 60)
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function buildValueLines(snapshot: RuntimeStorySessionSnapshot | null, source: "global" | "system") {
  if (!snapshot) {
    return []
  }

  const valsFile = source === "global" ? snapshot.vals : snapshot.system_vals
  return valsFile.variables.flatMap((group) => {
    const groupName = group.name.trim()

    return group.vals.map((row) => {
      const rowName = row.name.trim()
      const token = groupName ? `${groupName}.${rowName}` : rowName
      const displayValue = row.value_type === "calc"
        ? getStoryValCalcDisplay(valsFile, group, row).text
        : formatStoryValInput(row.value)

      return `${token}: ${displayValue}`
    })
  })
}

function formatSchedulerSourceLabel(sourceType: string, sourceId: string, entryEventId: string) {
  if (entryEventId && entryEventId !== sourceId) {
    return `${sourceType}/${sourceId} -> ${entryEventId}`
  }

  return `${sourceType}/${sourceId}`
}

function formatSchedulerAuditKindLabel(kind: string) {
  switch (kind) {
    case "schedule-future":
      return "未来排期"
    case "queue-ready":
      return "进入就绪"
    case "promote-due":
      return "到时晋升"
    case "start-event":
      return "开始执行"
    case "skip-event":
      return "跳过事件"
    case "complete-event":
      return "执行完成"
    case "loop-reschedule":
      return "循环重排"
    default:
      return kind
  }
}

function buildSchedulerLines(snapshot: RuntimeStorySessionSnapshot | null) {
  if (!snapshot) {
    return []
  }

  const lines: string[] = []
  const scheduler = snapshot.scheduler
  const baseDay = snapshot.clock.base_day
  const pauseFlags = [
    scheduler.manual_pause ? "手动暂停" : "",
    scheduler.event_pause ? "事件暂停" : ""
  ].filter(Boolean)

  lines.push("[当前执行]")
  if (scheduler.active) {
    lines.push(
      `${formatSchedulerSourceLabel(
        scheduler.active.source_type,
        scheduler.active.source_id,
        scheduler.active.entry_event_id
      )} · ${scheduler.active.status}`
    )
    lines.push(`到期 ${formatGameMinuteLabel(scheduler.active.due_game_minute, baseDay)}`)
  } else {
    lines.push("当前没有正在执行的调度事件")
  }

  lines.push("")
  lines.push("[队列概览]")
  lines.push(
    `就绪 ${scheduler.ready_queue.length} · 未来 ${scheduler.scheduled.length} · 循环 ${scheduler.loop_states.length} · 审计 ${scheduler.audit_logs.length} · 导演 ${scheduler.director_logs.length}`
  )
  lines.push(`暂停状态 ${pauseFlags.length > 0 ? pauseFlags.join(" + ") : "无"}`)
  lines.push(`已消费 根事件 ${scheduler.consumed_graph_root_ids.length} · 一次性事件 ${scheduler.consumed_once_ids.length}`)

  lines.push("")
  lines.push("[就绪队列]")
  if (scheduler.ready_queue.length === 0) {
    lines.push("空")
  } else {
    for (const item of scheduler.ready_queue) {
      lines.push(
        `${formatSchedulerSourceLabel(item.source_type, item.source_id, item.entry_event_id)} · ${formatGameMinuteLabel(item.due_game_minute, baseDay)}`
      )
    }
  }

  lines.push("")
  lines.push("[未来调度]")
  if (scheduler.scheduled.length === 0) {
    lines.push("空")
  } else {
    for (const item of scheduler.scheduled) {
      lines.push(
        `${formatSchedulerSourceLabel(item.source_type, item.source_id, item.entry_event_id)} · ${formatGameMinuteLabel(item.due_game_minute, baseDay)}`
      )
    }
  }

  lines.push("")
  lines.push("[循环状态]")
  if (scheduler.loop_states.length === 0) {
    lines.push("空")
  } else {
    for (const item of scheduler.loop_states) {
      lines.push(
        `${item.event_id} · next ${formatGameMinuteLabel(item.next_due_game_minute, baseDay)} · last ${formatGameMinuteLabel(item.last_triggered_game_minute, baseDay)} · x${item.trigger_count}`
      )
    }
  }

  lines.push("")
  lines.push("[AI剧情导演]")
  const directorLogs = scheduler.director_logs.slice().reverse()
  if (directorLogs.length === 0) {
    lines.push("暂无导演决策日志")
  } else {
    for (const item of directorLogs.slice(0, 8)) {
      const selectedSource = item.selected_source_type ? `${item.selected_source_type}/` : ""
      const selectedLabel = item.selected_event_id
        ? `${selectedSource}${item.selected_event_id}${item.selected_event_title ? ` / ${item.selected_event_title}` : ""}`
        : "无"
      const topCandidate = item.candidates[0]
      const topLabel = topCandidate
        ? `${topCandidate.sourceType}/${topCandidate.eventId}:${topCandidate.score}`
        : "无"
      lines.push(
        `${formatGameMinuteLabel(item.game_minute, baseDay)} · 选择 ${selectedLabel} · 候选 ${item.candidate_count} · 最高 ${topLabel}`
      )
    }
  }

  lines.push("")
  lines.push("[最近审计]")
  const auditLogs = scheduler.audit_logs.slice().reverse()
  if (auditLogs.length === 0) {
    lines.push("暂无调度审计日志")
  } else {
    for (const item of auditLogs.slice(0, 10)) {
      const sourceLabel = item.source_type && item.source_id
        ? ` · ${formatSchedulerSourceLabel(item.source_type, item.source_id, item.entry_event_id ?? "")}`
        : ""
      lines.push(
        `${formatGameMinuteLabel(item.game_minute, baseDay)} · ${formatSchedulerAuditKindLabel(item.kind)}${sourceLabel} · ${item.message}`
      )
    }
  }

  return lines
}

function buildBagLines(state: HtmlClientAppState) {
  const view = state.view
  if (!view) {
    return []
  }

  const lines: string[] = []
  const maxInlineEntries = 12

  if (view.bagSummary.length === 0) {
    return ["暂无背包 owner"]
  }

  for (const bag of view.bagSummary) {
    lines.push(`${bag.ownerId}: ${bag.itemCount} 类 / ${bag.totalQuantity} 件`)

    if (bag.entries.length === 0) {
      lines.push("  空")
      continue
    }

    for (const entry of bag.entries.slice(0, maxInlineEntries)) {
      const itemLabel = entry.itemName === entry.itemId
        ? entry.itemId
        : `${entry.itemName} (${entry.itemId})`
      const boundLabel = entry.bound ? " · bound" : ""
      lines.push(
        `  - ${itemLabel} x${entry.quantity} · 第${entry.obtainedAtDay}天 ${formatClockMinuteLabel(entry.obtainedAtMinute)}${boundLabel}`
      )
    }

    const hiddenCount = bag.entries.length - maxInlineEntries
    if (hiddenCount > 0) {
      lines.push(`  ... 另有 ${hiddenCount} 类物品`)
    }
  }

  return lines
}

function findPlayerName(state: HtmlClientAppState) {
  const playerSetup = state.profile?.player_setup
  const fullName = playerSetup
    ? `${playerSetup.player_surname ?? ""}${playerSetup.player_given_name ?? ""}`
    : ""

  return fullName || playerSetup?.player_name || state.profile?.profile_name || "未命名角色"
}

function findLocationLabel(state: HtmlClientAppState) {
  const playerSetup = state.profile?.player_setup
  if (!playerSetup) {
    return "未设置"
  }

  return [
    playerSetup.province_name,
    playerSetup.city_name,
    playerSetup.county_name
  ].filter(Boolean).join("/") || "未设置"
}

function buildSummary(state: HtmlClientAppState, snapshot: RuntimeStorySessionSnapshot | null) {
  const nowDay = findSystemValue(snapshot, "system.now_day")
  const nowHour = findSystemValue(snapshot, "system.now_hour")
  const nowMinute = findSystemValue(snapshot, "system.now_minute")
  const nowShiduan = findSystemValue(snapshot, "system.now_shiduan")
  const paused = findSystemValue(snapshot, "system.time_pause") === true
  const rawSpeed = findSystemValue(snapshot, "system.time_speed")
  const speed = typeof rawSpeed === "number" && Number.isFinite(rawSpeed) ? rawSpeed : 0
  const countyName = findSystemValue(snapshot, "county.name_full")
  const countyLevel = findSystemValue(snapshot, "county.level")
  const money = findSystemValue(snapshot, "player.money")
  const clock = typeof nowHour === "number" && typeof nowMinute === "number"
    ? `${String(nowHour).padStart(2, "0")}:${String(nowMinute).padStart(2, "0")}`
    : "--:--"
  const dayLabel = typeof nowDay === "number" && Number.isFinite(nowDay)
    ? `第${nowDay}天`
    : "未初始化"
  const shiduanLabel = typeof nowShiduan === "string" && nowShiduan.trim() ? nowShiduan.trim() : ""
  const countyLabel = typeof countyName === "string" && countyName.trim()
    ? `${countyName.trim()}县${countyLevel === null || countyLevel === undefined || countyLevel === "" ? "" : `(${String(countyLevel).trim()})`}`
    : "未设县名"

  return {
    playerName: findPlayerName(state),
    locationLabel: findLocationLabel(state),
    countyLabel,
    dayLabel,
    clock,
    shiduanLabel,
    paused,
    speed,
    moneyLabel: formatHumanizedAmount(money)
  }
}

function buildClientState(app: HtmlClientApp) {
  const state = app.getState()
  const snapshot = state.session?.getSnapshot() ?? null
  const contacts = state.bundle && snapshot ? buildRuntimePhoneContacts(state.bundle, snapshot) : []
  const runtimeNotifications = state.view?.notifications ?? []
  const notifications = [
    ...state.notifications,
    ...runtimeNotifications
  ]

  return {
    ok: true,
    stage: state.stage,
    storyId: state.storyId,
    storyTitle: state.bundle?.title ?? state.storyId,
    paths: state.paths,
    profiles: state.profiles,
    profile: state.profile
      ? {
          profile_id: state.profile.profile_id,
          profile_name: state.profile.profile_name,
          created_at: state.profile.created_at,
          player_setup: state.profile.player_setup ?? null,
          custom_value_count: Object.keys(state.profile.custom_values ?? {}).length
        }
      : null,
    saveSlots: state.saveSlots,
    hasBundle: Boolean(state.bundle),
    hasSession: Boolean(state.session),
    view: state.view,
    summary: buildSummary(state, snapshot),
    notifications,
    latestNotification: notifications.at(-1) ?? "",
    globalValueLines: buildValueLines(snapshot, "global"),
    systemValueLines: buildValueLines(snapshot, "system"),
    schedulerLines: buildSchedulerLines(snapshot),
    bagLines: buildBagLines(state),
    phoneContacts: contacts,
    phoneUnreadCount: contacts.reduce((sum, contact) => sum + contact.unreadCount, 0)
  }
}

function getJsonBody(request: JsonRequest) {
  return isRecord(request.body) ? request.body : {}
}

function getStringBodyValue(body: Record<string, unknown>, key: string) {
  const value = body[key]
  return typeof value === "string" ? value.trim() : ""
}

function requireSession(app: HtmlClientApp) {
  if (!app.getState().session) {
    throw new HttpError(409, "当前还没有运行时会话。")
  }
}

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

    app.dispatch(action as RuntimeStorySessionAction)
    sendJson(response, 200, buildClientState(app))
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

  if (request.method === "GET" && pathname === "/api/phone/thread") {
    const state = app.getState()
    const roleKey = url.searchParams.get("roleKey")?.trim() ?? ""
    const snapshot = state.session?.getSnapshot() ?? null

    if (!roleKey) {
      throw new HttpError(400, "缺少 roleKey。")
    }

    const thread = state.bundle && snapshot
      ? buildRuntimePhoneThreadView(state.bundle, snapshot, roleKey)
      : null

    sendJson(response, 200, {
      ok: true,
      thread
    })
    return
  }

  throw new HttpError(404, "接口不存在。")
}

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

async function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string) {
  const safePathname = pathname === "/" ? "/index.html" : pathname
  const decodedPath = decodeURIComponent(safePathname)
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "")
  const filePath = path.join(publicDir, normalizedPath)
  const resolvedFilePath = path.resolve(filePath)

  if (!resolvedFilePath.startsWith(publicDir)) {
    throw new HttpError(403, "禁止访问该路径。")
  }

  try {
    const statsRaw = await readFile(resolvedFilePath)
    response.writeHead(200, {
      "content-type": getContentType(resolvedFilePath),
      "cache-control": "no-store"
    })
    response.end(statsRaw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const indexPath = path.join(publicDir, "index.html")
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      })
      createReadStream(indexPath).pipe(response)
      return
    }

    throw error
  }

  void request
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const app = createHtmlClientApp(options)
  const server = createServer(async (request: JsonRequest, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
      const pathname = url.pathname

      if (pathname.startsWith("/api/")) {
        if (request.method !== "GET") {
          request.body = await readRequestBody(request)
        }
        await handleApi(app, request, response, pathname, url)
        return
      }

      await serveStatic(request, response, pathname)
    } catch (error) {
      sendError(response, error)
    }
  })

  server.listen(options.port, options.host, () => {
    const displayHost = options.host === "0.0.0.0" ? "localhost" : options.host
    console.log(`[html-client] ${options.storyId} listening on http://${displayHost}:${options.port}/`)
    console.log(`[html-client] runtime dir: ${options.runtimeDir}`)
  })
}

void main()

