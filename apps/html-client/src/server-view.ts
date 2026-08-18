/**
 * HTML 服务端视图模型：把 Runtime 快照转换成浏览器容易渲染的摘要。
 * 这里只做格式化，不读取请求、不写响应，也不改变游戏会话。
 */
import type { HtmlClientApp, HtmlClientAppState } from "./client-app"
import {
  buildRuntimeContacts,
  formatStoryValInput,
  getStoryValCalcDisplay,
  type RuntimeStorySessionSnapshot
} from "../../../packages/runtime/src/index"

/** @param snapshot Runtime 快照或 null。 @param token `组.变量` 路径。 @returns 对应系统变量值；快照/路径/变量不存在时为 undefined。 */
export function findSystemValue(snapshot: RuntimeStorySessionSnapshot | null, token: string) {
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

/**
 * 将大整数金额格式化为中文“万/亿”单位。
 * @param amount 数字或数字文本。 @returns 易读金额字符串；无效输入返回 `0`，使用 BigInt 避免大金额精度丢失。
 */
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

/** @param gameMinute 累计游戏分钟。 @param baseDay 故事起始天数。 @returns `第N天 HH:mm`，输入无效时为“未定”。 */
export function formatGameMinuteLabel(gameMinute: number | null | undefined, baseDay = 1) {
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

/** @param gameMinute 累计游戏分钟。 @returns 当天 `HH:mm`，无效输入返回 `--:--`。 */
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

/** @param snapshot Runtime 快照。 @param source 普通或系统变量来源。 @returns 适合终端摘要显示的 `组.变量 = 值` 文本行。 */
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

/** @param sourceType 调度来源类型。 @param sourceId 来源 id。 @param entryEventId 实际入口 id。 @returns 来源链路显示文本。 */
function formatSchedulerSourceLabel(sourceType: string, sourceId: string, entryEventId: string) {
  if (entryEventId && entryEventId !== sourceId) {
    return `${sourceType}/${sourceId} -> ${entryEventId}`
  }

  return `${sourceType}/${sourceId}`
}

/** @param kind 调度审计机器值。 @returns 对应中文名称；未知值原样返回。 */
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

/**
 * 将调度器内部状态整理成调试摘要行。
 * @param snapshot Runtime 快照。 @returns 活动、就绪、未来、循环和最近审计信息的中文文本数组。
 */
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

/** @param state HTML 客户端状态。 @returns 玩家背包与其它所有者背包的摘要行；没有会话视图时为空。 */
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

/** @param state 客户端状态。 @returns 优先姓+名、再完整姓名、档案名的玩家显示名称。 */
function findPlayerName(state: HtmlClientAppState) {
  const playerSetup = state.profile?.player_setup
  const fullName = playerSetup
    ? `${playerSetup.player_surname ?? ""}${playerSetup.player_given_name ?? ""}`
    : ""

  return fullName || playerSetup?.player_name || state.profile?.profile_name || "未命名角色"
}

/** @param state 客户端状态。 @returns 省/市/县拼接地点；没有结构化资料时为“未设置”。 */
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

/** @param state 客户端状态。 @param snapshot Runtime 快照。 @returns 顶部状态栏需要的角色、地点、时间、暂停和速度摘要。 */
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

/**
 * 把 Node 应用门面转换成 HTTP API 返回给浏览器的完整状态。
 * @param app HTML 客户端应用。 @returns 档案/存档、Runtime 视图、摘要、调试行、联系人和去重通知。
 * 每次请求都从 session 快照重新派生，浏览器不会拿到可修改的 Runtime 内部对象。
 */
export function buildClientState(app: HtmlClientApp) {
  const state = app.getState()
  const snapshot = state.session?.getSnapshot() ?? null
  const effectiveBundle = state.session?.getEffectiveBundle() ?? state.bundle
  const contacts = effectiveBundle && snapshot ? buildRuntimeContacts(effectiveBundle, snapshot) : []
  const runtimeNotifications = state.view?.notifications ?? []
  const notifications = [
    ...state.notifications,
    ...runtimeNotifications
  ]

  return {
    ok: true,
    stage: state.stage,
    storyId: state.storyId,
    storyTitle: effectiveBundle?.title ?? state.storyId,
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
    bundle: effectiveBundle ? {
      baseContentHash: effectiveBundle.baseContentHash,
      activePackageIds: effectiveBundle.activePackageIds,
      effectiveContentHash: effectiveBundle.effectiveContentHash,
      semanticEntries: state.session?.getAvailableSemanticContactIntents() ?? effectiveBundle.semanticEntries,
      worldState: effectiveBundle.worldState,
      contact: effectiveBundle.contact
    } : null,
    hasSession: Boolean(state.session),
    view: state.view,
    summary: buildSummary(state, snapshot),
    notifications,
    latestNotification: notifications.at(-1) ?? "",
    globalValueLines: buildValueLines(snapshot, "global"),
    systemValueLines: buildValueLines(snapshot, "system"),
    schedulerLines: buildSchedulerLines(snapshot),
    bagLines: buildBagLines(state),
    contacts: contacts,
    contactUnreadCount: contacts.reduce((sum, contact) => sum + contact.unreadCount, 0)
  }
}
