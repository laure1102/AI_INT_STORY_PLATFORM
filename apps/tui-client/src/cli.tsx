import { fileURLToPath } from "node:url"
import React, { useEffect, useMemo, useState } from "react"
import { Alert, ConfirmInput, Spinner, StatusMessage, TextInput } from "@inkjs/ui"
import { Box, render, Text, useApp, useInput } from "ink"
import type { StorySceneFile } from "@story-mgr/core"
import type { RuntimeStorySessionAction, RuntimeStoryViewModel } from "@story-mgr/runtime"
import { formatStoryValInput, getStoryValCalcDisplay } from "@story-mgr/runtime"
import {
  createTuiClientApp,
  type CreateTuiClientAppOptions,
  type TuiClientApp,
  type TuiClientAppState,
  type TuiPlayerOverridePrompt,
  type TuiProfileSummary,
  type TuiSaveSlotSummary
} from "./index"

interface MenuOption {
  label: string
  value: string
}

interface MenuSelectProps {
  options: MenuOption[]
  visibleOptionCount?: number
  activeIndex?: number
  onActiveIndexChange?: (nextIndex: number) => void
  disabled?: boolean
  onSubmit: (value: string) => void
}

interface PlayerSetupDraft {
  customValues: Record<string, string>
}

interface TuiPlayerOverridePromptGroup {
  groupNo: number
  prompts: TuiPlayerOverridePrompt[]
}

interface CreatePlayerFieldState {
  promptGroups: TuiPlayerOverridePromptGroup[]
  draft: PlayerSetupDraft
}

type ScreenState =
  | { kind: "boot" }
  | { kind: "profile-menu" }
  | { kind: "create-player"; groupIndex: number; promptIndex: number; fieldState: CreatePlayerFieldState }
  | { kind: "save-menu" }
  | { kind: "settings-menu" }
  | { kind: "save-input"; defaultSlotId: string }
  | { kind: "game" }
  | { kind: "confirm-quit" }

interface AsyncTaskState {
  label: string
  error: string | null
}

interface GameUiState {
  overlay: "notifications" | "globalVals" | "scheduler" | null
  overlayOffset: number
  interactionActiveIndex: number
  interactionInputDraft: string
}

type ThemeColor = "blue" | "cyan" | "green" | "magenta" | "yellow" | "gray" | "red" | "white"

// CLI 只解析少量启动参数，其余交互都交给 Ink 界面处理。
function parseArgs(argv: string[]): CreateTuiClientAppOptions {
  const options: CreateTuiClientAppOptions = {
    storyId: "demo"
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

    if (current === "--new") {
      options.autoStartNewGame = true
    }
  }

  return options
}

function createEmptyDraft(): PlayerSetupDraft {
  return {
    customValues: {}
  }
}

function buildPromptGroups(
  prompts: TuiPlayerOverridePrompt[]
): TuiPlayerOverridePromptGroup[] {
  const groups = new Map<number, TuiPlayerOverridePromptGroup>()

  for (const prompt of prompts) {
    const normalizedGroupNo = Number.isInteger(prompt.groupNo) && prompt.groupNo >= 1
      ? prompt.groupNo
      : 1
    const matchedGroup = groups.get(normalizedGroupNo)

    if (matchedGroup) {
      matchedGroup.prompts.push(prompt)
      continue
    }

    groups.set(normalizedGroupNo, {
      groupNo: normalizedGroupNo,
      prompts: [prompt]
    })
  }

  return Array.from(groups.values())
}

function getPromptGroupAt(
  promptGroups: TuiPlayerOverridePromptGroup[],
  groupIndex: number
) {
  return promptGroups[groupIndex] ?? null
}

function getPromptAt(
  promptGroups: TuiPlayerOverridePromptGroup[],
  groupIndex: number,
  promptIndex: number
) {
  const currentGroup = getPromptGroupAt(promptGroups, groupIndex)
  return currentGroup?.prompts[promptIndex] ?? null
}

function getPromptValue(draft: PlayerSetupDraft, prompt: TuiPlayerOverridePrompt | null) {
  if (!prompt) {
    return ""
  }

  return draft.customValues[prompt.varKey] ?? ""
}

function buildCreatePlayerSummaryLines(fieldState: CreatePlayerFieldState) {
  return fieldState.promptGroups.flatMap((group) => group.prompts).map((prompt) => ({
    key: prompt.varKey,
    label: prompt.label,
    value: fieldState.draft.customValues[prompt.varKey]?.trim() ?? ""
  }))
}

function buildProfileNameFromDraft(fieldState: CreatePlayerFieldState) {
  const surname = fieldState.draft.customValues["player.name_xing"]?.trim() ?? ""
  const givenName = fieldState.draft.customValues["player.name_ming"]?.trim() ?? ""
  return `${surname}${givenName}`.trim()
}

function validatePromptValue(prompt: TuiPlayerOverridePrompt, value: string) {
  if (!prompt.required) {
    return null
  }

  if (!value.trim()) {
    return `${prompt.label} 不能为空`
  }

  return null
}

function profileToOption(profile: TuiProfileSummary): MenuOption {
  const description = profile.locationLabel
    ? ` · ${profile.locationLabel}`
    : ` · ${profile.customValueCount} 个自定义变量`

  return {
    value: profile.profileId,
    label: `${profile.profileName} (${profile.profileId})${description}`
  }
}

function saveSlotToOption(saveSlot: TuiSaveSlotSummary): MenuOption {
  const eventLabel = saveSlot.activeEventId ?? "无"

  return {
    value: saveSlot.slotId,
    label: `${saveSlot.slotId} · ${saveSlot.savedAt} · 当前事件 ${eventLabel}`
  }
}

function createInteractionOptions(
  view: RuntimeStoryViewModel
): MenuOption[] {
  return view.interaction?.kind === "select"
    ? view.interaction.options.map((option) => ({
        value: `action:${option.id}`,
        label: option.description ? `${option.label} · ${option.description}` : option.label
      }))
    : []
}

function buildSettingsOptions(view: RuntimeStoryViewModel): MenuOption[] {
  return [
    {
      value: "settings:save",
      label: "保存进度"
    },
    {
      value: "settings:debug",
      label: view.screen === "debug" ? "返回游戏" : "查看调试信息"
    },
    {
      value: "settings:quit",
      label: "退出客户端"
    }
  ]
}

// Ink 依赖可交互终端；在非 TTY 环境里提前给出清晰提示，避免抛出底层 raw mode 错误。
function assertInteractiveTerminal() {
  const stdin = process.stdin
  const stdout = process.stdout
  const supportsRawMode = Boolean(stdin.isTTY && typeof stdin.setRawMode === "function")

  if (stdin.isTTY && stdout.isTTY && supportsRawMode) {
    return
  }

  throw new Error(
    [
      "tui-client 需要在可交互终端中运行。",
      "当前进程不支持 TTY raw mode，Ink 无法接管键盘输入。",
      "请直接在系统终端里运行 `pnpm tui -- --story demo`，不要放在非交互式输出环境里执行。"
    ].join("\n")
  )
}

function findPlayerName(state: TuiClientAppState) {
  const playerSetup = state.profile?.player_setup
  const fullName = playerSetup
    ? `${playerSetup.player_surname ?? ""}${playerSetup.player_given_name ?? ""}`
    : ""

  return fullName || playerSetup?.player_name || state.profile?.profile_name || "未命名角色"
}

function findLocationLabel(state: TuiClientAppState) {
  const playerSetup = state.profile?.player_setup
  if (!playerSetup) {
    return "未设置"
  }

  return [
    playerSetup.province_name,
    playerSetup.city_name,
    playerSetup.county_name
  ].filter(Boolean).join("/")
}

function findSystemValue(state: TuiClientAppState, token: string) {
  const [groupName, rowName] = token.split(".")
  if (!groupName || !rowName) {
    return undefined
  }

  const snapshot = state.session?.getSnapshot()
  if (!snapshot) {
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

function findGameTimeLabel(state: TuiClientAppState) {
  const nowDate = findSystemValue(state, "system.now_date")
  const nowHour = findSystemValue(state, "system.now_hour")
  const nowMinute = findSystemValue(state, "system.now_minute")
  const nowShiduan = findSystemValue(state, "system.now_shiduan")
  const timePause = findSystemValue(state, "system.time_pause")
  const timeSpeed = findSystemValue(state, "system.time_speed")

  if (typeof nowDate !== "string" || typeof nowHour !== "number" || typeof nowMinute !== "number") {
    return "未初始化"
  }

  const clockText = `${nowDate} ${String(nowHour).padStart(2, "0")}:${String(nowMinute).padStart(2, "0")}`
  const shiduanText = typeof nowShiduan === "string" && nowShiduan ? ` ${nowShiduan}` : ""
  const pauseText = timePause === true ? "暂停" : "运行中"
  const speedText = typeof timeSpeed === "number" ? ` x${timeSpeed}` : ""

  return `${clockText}${shiduanText} · ${pauseText}${speedText}`
}

function findGameDayLabel(state: TuiClientAppState) {
  const nowDay = findSystemValue(state, "system.now_day")
  return typeof nowDay === "number" && Number.isFinite(nowDay) ? `第 ${nowDay} 天` : "未初始化"
}

function findGameDayNumber(state: TuiClientAppState) {
  const nowDay = findSystemValue(state, "system.now_day")
  return typeof nowDay === "number" && Number.isFinite(nowDay) ? nowDay : null
}

function findCompactClockLabel(state: TuiClientAppState) {
  const nowHour = findSystemValue(state, "system.now_hour")
  const nowMinute = findSystemValue(state, "system.now_minute")

  if (typeof nowHour !== "number" || typeof nowMinute !== "number") {
    return "--:--"
  }

  return `${String(nowHour).padStart(2, "0")}:${String(nowMinute).padStart(2, "0")}`
}

function findHeaderTimeLabel(state: TuiClientAppState) {
  const dayNumber = findGameDayNumber(state)
  const clockLabel = findCompactClockLabel(state)
  const shiduan = findSystemValue(state, "system.now_shiduan")
  const paused = findTimePause(state)
  const pausedLabel = paused ? " 暂停" : ""
  const shiduanLabel = typeof shiduan === "string" && shiduan.trim() ? ` ${shiduan.trim()}` : ""

  if (dayNumber === null) {
    return `未初始化 ${clockLabel}${pausedLabel}`
  }

  return `第${dayNumber}天 ${clockLabel}${shiduanLabel}${pausedLabel}`
}

function findCountyLabel(state: TuiClientAppState) {
  const countyName = findSystemValue(state, "county.name_full")
  const countyLevel = findSystemValue(state, "county.level")

  if (typeof countyName === "string" && countyName.trim()) {
    const levelText = countyLevel === null || countyLevel === undefined || countyLevel === ""
      ? ""
      : `(${String(countyLevel).trim()})`
    return `${countyName.trim()}县${levelText}`
  }

  return "未设县名"
}

function formatHumanizedAmount(amount: unknown) {
  // 先清洗字符串，再交给 BigInt 做精确格式化，避免金钱显示丢精度。
  const cleanAmount = String(amount).replace(/\s+/g, "")
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

  const ONE_YI = 100000000n
  const ONE_WAN = 10000n
  const ONE_QIAN = 1000n

  const yi = num / ONE_YI
  let remainder = num % ONE_YI

  const wan = remainder / ONE_WAN
  remainder %= ONE_WAN

  const qian = remainder / ONE_QIAN

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

function findPlayerMoneyLabel(state: TuiClientAppState) {
  const money = findSystemValue(state, "player.money")
  if (typeof money === "number" && Number.isFinite(money)) {
    return formatHumanizedAmount(money)
  }

  if (typeof money === "string" && money.trim()) {
    return formatHumanizedAmount(money.trim())
  }

  return "0"
}

function findLatestNotification(notifications: string[]) {
  return notifications.length > 0
    ? notifications[notifications.length - 1] ?? ""
    : ""
}

function findCurrentSceneImagePath(state: TuiClientAppState) {
  const bundle = state.bundle
  if (!bundle) {
    return ""
  }

  const rawLevel = findSystemValue(state, "county.level")
  const currentHour = findSystemValue(state, "system.now_hour")
  const sceneLevel = typeof rawLevel === "number"
    ? rawLevel
    : typeof rawLevel === "string" && rawLevel.trim()
      ? Number(rawLevel)
      : NaN
  const hour = typeof currentHour === "number"
    ? currentHour
    : typeof currentHour === "string" && currentHour.trim()
      ? Number(currentHour)
      : NaN

  if (!Number.isFinite(sceneLevel)) {
    return ""
  }

  const scenes = (bundle.scenes as StorySceneFile | null)?.scenes ?? []
  const matchedScene = scenes.find((scene) => scene.level === Math.trunc(sceneLevel))
  if (!matchedScene) {
    return ""
  }

  const isDayScene = Number.isFinite(hour) && hour >= 7 && hour <= 17
  const assetPath = isDayScene ? matchedScene.day_img : matchedScene.night_img
  return typeof assetPath === "string" ? assetPath.trim() : ""
}

function findCurrentLocationId(state: TuiClientAppState) {
  const locationId = state.view?.currentLocationId
  return typeof locationId === "string" ? locationId.trim() : ""
}

function formatGameMinuteLabel(gameMinute: number | null | undefined) {
  if (typeof gameMinute !== "number" || !Number.isFinite(gameMinute) || gameMinute < 0) {
    return "未定"
  }

  const safeMinute = Math.trunc(gameMinute)
  const dayNumber = Math.floor(safeMinute / (24 * 60)) + 1
  const minuteOfDay = safeMinute % (24 * 60)
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return `第${dayNumber}天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function buildGlobalValueLines(state: TuiClientAppState) {
  const snapshot = state.session?.getSnapshot()
  if (!snapshot) {
    return []
  }

  return snapshot.vals.variables.flatMap((group) => {
    const groupName = group.name.trim()

    return group.vals.map((row) => {
      const rowName = row.name.trim()
      const token = groupName ? `${groupName}.${rowName}` : rowName
      const displayValue = row.value_type === "calc"
        ? getStoryValCalcDisplay(snapshot.vals, group, row).text
        : formatStoryValInput(row.value)

      return `${token}: ${displayValue}`
    })
  })
}

function buildSchedulerDebugLines(state: TuiClientAppState) {
  const snapshot = state.session?.getSnapshot()
  if (!snapshot) {
    return []
  }

  const lines: string[] = []
  const scheduler = snapshot.scheduler

  lines.push("--- 当前运行 ---")
  lines.push(
    scheduler.active
      ? `${scheduler.active.source_type}/${scheduler.active.source_id} -> ${scheduler.active.entry_event_id}`
      : "无"
  )
  lines.push(
    scheduler.active
      ? `触发时间: ${formatGameMinuteLabel(scheduler.active.due_game_minute)} [${scheduler.active.status}]`
      : "触发时间: 无"
  )

  lines.push("--- 调度摘要 ---")
  lines.push(`暂停: manual=${scheduler.manual_pause ? "Y" : "N"} event=${scheduler.event_pause ? "Y" : "N"}`)
  lines.push(`就绪队列: ${scheduler.ready_queue.length}`)
  lines.push(`未来调度: ${scheduler.scheduled.length}`)
  lines.push(`已消费根事件: ${scheduler.consumed_graph_root_ids.length}`)
  lines.push(`已消费一次性事件: ${scheduler.consumed_once_ids.length}`)
  lines.push(`循环状态: ${scheduler.loop_states.length}`)
  lines.push(`导演日志: ${scheduler.director_logs.length}`)

  if (scheduler.ready_queue.length > 0) {
    lines.push("--- 就绪队列 ---")
    for (const item of scheduler.ready_queue) {
      lines.push(
        `${item.source_type}/${item.source_id} -> ${item.entry_event_id} · ${formatGameMinuteLabel(item.due_game_minute)} [${item.status}]`
      )
    }
  }

  if (scheduler.scheduled.length > 0) {
    lines.push("--- 未来调度 ---")
    for (const item of scheduler.scheduled) {
      lines.push(
        `${item.source_type}/${item.source_id} -> ${item.entry_event_id} · ${formatGameMinuteLabel(item.due_game_minute)} [${item.status}]`
      )
    }
  }

  if (scheduler.loop_states.length > 0) {
    lines.push("--- 循环状态 ---")
    for (const item of scheduler.loop_states) {
      lines.push(
        `${item.event_id}: next=${formatGameMinuteLabel(item.next_due_game_minute)} last=${formatGameMinuteLabel(item.last_triggered_game_minute)} count=${item.trigger_count}`
      )
    }
  }

  if (scheduler.director_logs.length > 0) {
    lines.push("--- AI剧情导演 ---")
    for (const item of scheduler.director_logs.slice(-5).reverse()) {
      const selectedSource = item.selected_source_type ? `${item.selected_source_type}/` : ""
      lines.push(
        `${formatGameMinuteLabel(item.game_minute)}: selected=${item.selected_event_id ? `${selectedSource}${item.selected_event_id}` : "无"} candidates=${item.candidate_count}`
      )
    }
  }

  return lines
}

function formatSchedulerGameMinuteLabel(
  gameMinute: number | null | undefined,
  baseDay: number
) {
  if (typeof gameMinute !== "number" || !Number.isFinite(gameMinute) || gameMinute < 0) {
    return "未定"
  }

  const safeMinute = Math.trunc(gameMinute)
  const normalizedBaseDay = Number.isFinite(baseDay) ? Math.max(1, Math.trunc(baseDay)) : 1
  const dayNumber = Math.floor(safeMinute / (24 * 60)) + normalizedBaseDay
  const minuteOfDay = safeMinute % (24 * 60)
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return `第${dayNumber}天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
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

function buildSchedulerMonitorLines(state: TuiClientAppState) {
  const snapshot = state.session?.getSnapshot()
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
  const auditLogs = scheduler.audit_logs.slice().reverse()
  const directorLogs = scheduler.director_logs.slice().reverse()

  lines.push("[当前执行]")
  if (scheduler.active) {
    lines.push(
      `${formatSchedulerSourceLabel(
        scheduler.active.source_type,
        scheduler.active.source_id,
        scheduler.active.entry_event_id
      )} · ${scheduler.active.status}`
    )
    lines.push(`到期 ${formatSchedulerGameMinuteLabel(scheduler.active.due_game_minute, baseDay)}`)
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
        `${formatSchedulerSourceLabel(item.source_type, item.source_id, item.entry_event_id)} · ${formatSchedulerGameMinuteLabel(item.due_game_minute, baseDay)}`
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
        `${formatSchedulerSourceLabel(item.source_type, item.source_id, item.entry_event_id)} · ${formatSchedulerGameMinuteLabel(item.due_game_minute, baseDay)}`
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
        `${item.event_id} · next ${formatSchedulerGameMinuteLabel(item.next_due_game_minute, baseDay)} · last ${formatSchedulerGameMinuteLabel(item.last_triggered_game_minute, baseDay)} · x${item.trigger_count}`
      )
    }
  }

  lines.push("")
  lines.push("[AI剧情导演]")
  if (directorLogs.length === 0) {
    lines.push("暂无导演决策日志")
  } else {
    for (const item of directorLogs) {
      const selectedSource = item.selected_source_type ? `${item.selected_source_type}/` : ""
      const selectedLabel = item.selected_event_id
        ? `${selectedSource}${item.selected_event_id}${item.selected_event_title ? ` / ${item.selected_event_title}` : ""}`
        : "无"
      const topCandidate = item.candidates[0]
      const topLabel = topCandidate
        ? `${topCandidate.sourceType}/${topCandidate.eventId}:${topCandidate.score}`
        : "无"
      lines.push(
        `${formatSchedulerGameMinuteLabel(item.game_minute, baseDay)} · 选择 ${selectedLabel} · 候选 ${item.candidate_count} · 最高 ${topLabel}`
      )
    }
  }

  lines.push("")
  lines.push("[最近审计]")
  if (auditLogs.length === 0) {
    lines.push("暂无调度审计日志")
  } else {
    for (const item of auditLogs) {
      const sourceLabel = item.source_type && item.source_id
        ? ` · ${formatSchedulerSourceLabel(item.source_type, item.source_id, item.entry_event_id ?? "")}`
        : ""
      lines.push(
        `${formatSchedulerGameMinuteLabel(item.game_minute, baseDay)} · ${formatSchedulerAuditKindLabel(item.kind)}${sourceLabel} · ${item.message}`
      )
    }
  }

  return lines
}

function findTimePause(state: TuiClientAppState) {
  return findSystemValue(state, "system.time_pause") === true
}

function findTimeSpeed(state: TuiClientAppState) {
  const value = findSystemValue(state, "system.time_speed")
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function formatStageLabel(stage: TuiClientAppState["stage"]) {
  switch (stage) {
    case "boot":
      return "启动"
    case "sync-story-bundle":
      return "同步剧情"
    case "select-or-create-profile":
      return "角色入口"
    case "load-profile-custom":
      return "读取角色"
    case "select-save-or-new-game":
      return "选择存档"
    case "create-session":
      return "创建会话"
    case "enter-game":
      return "进入游戏"
    default:
      return stage
  }
}

async function handleDispatchAction(
  app: TuiClientApp,
  action: RuntimeStorySessionAction,
  setState: (nextState: TuiClientAppState) => void
) {
  app.dispatch(action)
  setState(app.getState())
}

function MenuSelect({
  options,
  visibleOptionCount = 8,
  activeIndex: controlledActiveIndex,
  onActiveIndexChange,
  disabled = false,
  onSubmit
}: MenuSelectProps) {
  const [internalActiveIndex, setInternalActiveIndex] = useState(0)
  const activeIndex = controlledActiveIndex ?? internalActiveIndex

  function updateActiveIndex(nextIndex: number) {
    if (onActiveIndexChange) {
      onActiveIndexChange(nextIndex)
      return
    }

    setInternalActiveIndex(nextIndex)
  }

  useEffect(() => {
    const nextIndex = (() => {
      if (options.length === 0) {
        return 0
      }

      return Math.min(activeIndex, options.length - 1)
    })()

    updateActiveIndex(nextIndex)
    // 这里故意只在选项变化时校正索引，避免正常操作时重复写状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length])

  useInput((input, key) => {
    if (disabled || options.length === 0) {
      return
    }

    const lowerInput = input.toLowerCase()

    if (key.upArrow || lowerInput === "w" || lowerInput === "k") {
      updateActiveIndex(activeIndex > 0 ? activeIndex - 1 : options.length - 1)
      return
    }

    if (key.downArrow || lowerInput === "s" || lowerInput === "j") {
      updateActiveIndex(activeIndex < options.length - 1 ? activeIndex + 1 : 0)
      return
    }

    if (key.return) {
      const activeOption = options[activeIndex]
      if (activeOption) {
        onSubmit(activeOption.value)
      }
      return
    }

    if (/^[1-9]$/.test(input)) {
      const nextIndex = Number.parseInt(input, 10) - 1
      const quickOption = options[nextIndex]
      if (quickOption) {
        onSubmit(quickOption.value)
      }
    }
  })

  if (options.length === 0) {
    return <Text color="yellow">当前没有可选项。</Text>
  }

  const clampedVisibleCount = Math.max(1, visibleOptionCount)
  const windowStart = Math.min(
    Math.max(0, activeIndex - Math.floor(clampedVisibleCount / 2)),
    Math.max(0, options.length - clampedVisibleCount)
  )
  const visibleOptions = options.slice(windowStart, windowStart + clampedVisibleCount)

  return (
    <Box flexDirection="column" gap={0}>
      {visibleOptions.map((option, visibleIndex) => {
        const actualIndex = windowStart + visibleIndex
        const isActive = actualIndex === activeIndex
        const shortcutLabel = actualIndex < 9 ? `${actualIndex + 1}. ` : "   "

        return (
          <Box
            key={option.value}
            borderStyle="round"
            borderColor={isActive ? "green" : "gray"}
            paddingX={1}
            marginBottom={0}
          >
            <Text color={isActive ? "green" : undefined}>
              {isActive ? "[*] " : "[ ] "}
              {shortcutLabel}
              {option.label}
            </Text>
          </Box>
        )
      })}
      <Text color="gray">上/下、W/S、J/K 移动；Enter 确认；1-9 快捷选择。</Text>
    </Box>
  )
}

function SectionCard({
  title,
  accentColor = "white",
  badge,
  children
}: {
  title: string
  accentColor?: ThemeColor
  badge?: string
  children: React.ReactNode
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accentColor} paddingX={1} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={accentColor} bold>{title}</Text>
        {badge ? <Text color="gray">{badge}</Text> : null}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Box>
  )
}

function StatusChip({
  label,
  value,
  color = "gray"
}: {
  label: string
  value: string | number
  color?: ThemeColor
}) {
  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} marginRight={1} marginBottom={1}>
      <Text color={color}>
        {label}: {value}
      </Text>
    </Box>
  )
}

function PhoneStatusBar({ state }: { state: TuiClientAppState }) {
  const syncLabel = state.bundle ? "SYNC" : "LOCAL"

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">
        StoryOS Mobile | {findGameDayLabel(state)} | {findCompactClockLabel(state)} | {syncLabel}
      </Text>
    </Box>
  )
}

function PhoneShell({
  state,
  title,
  subtitle,
  accentColor = "cyan",
  footerText,
  children
}: {
  state: TuiClientAppState
  title: string
  subtitle?: string
  accentColor?: ThemeColor
  footerText?: string
  children: React.ReactNode
}) {
  return (
    <Box flexDirection="column" width={72}>
      <Box flexDirection="column" borderStyle="round" borderColor={accentColor} paddingX={1} paddingY={1}>
        <Box justifyContent="center">
          <Text color="gray">[ Story Phone ]</Text>
        </Box>
        <PhoneStatusBar state={state} />
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={accentColor}>{title}</Text>
          {subtitle ? <Text color="gray">{subtitle}</Text> : null}
        </Box>
        <Box flexDirection="column" marginTop={1} gap={1}>
          {children}
        </Box>
        {footerText ? (
          <Box marginTop={1}>
            <Text color="gray">{footerText}</Text>
          </Box>
        ) : null}
        <Box justifyContent="center" marginTop={1}>
          <Text color="gray">[ home ]</Text>
        </Box>
      </Box>
    </Box>
  )
}

function SummaryPanel({ state }: { state: TuiClientAppState }) {
  return (
    <SectionCard title="状态总览" accentColor="blue" badge={formatStageLabel(state.stage)}>
      <Box flexDirection="row" flexWrap="wrap">
        <StatusChip label="故事" value={state.storyId} color="cyan" />
        <StatusChip label="角色数" value={state.profiles.length} color="green" />
        <StatusChip label="存档" value={state.saveSlots.length} color="yellow" />
        <StatusChip label="Bundle" value={state.bundle ? "已同步" : "未同步"} color="magenta" />
      </Box>
      <Text>当前角色：{state.profile?.profile_name ?? "未选择"}</Text>
      <Text>当前事件：{state.view?.activeEventTitle ?? state.view?.activeEventId ?? "无"}</Text>
      <Text>游戏时间：{findGameTimeLabel(state)}</Text>
    </SectionCard>
  )
}

function NotificationPanel({ notifications }: { notifications: string[] }) {
  const recentNotifications = notifications.slice(-4)

  if (recentNotifications.length === 0) {
    return null
  }

  return (
    <SectionCard title="消息流" accentColor="gray" badge={`${recentNotifications.length} 条`}>
      {recentNotifications.map((message, index) => (
        <Text key={`${message}-${index}`}>- {message}</Text>
      ))}
    </SectionCard>
  )
}

function CompactNotificationPanel({ notifications }: { notifications: string[] }) {
  const recentNotifications = notifications.slice(-6)

  if (recentNotifications.length === 0) {
    return null
  }

  return (
    <SectionCard title="消息流" accentColor="gray" badge={`${recentNotifications.length} 条`}>
      {recentNotifications.map((message, index) => (
        <Text key={`${message}-${index}`}>- {message}</Text>
      ))}
    </SectionCard>
  )
}

function GlobalValsPanel({ state }: { state: TuiClientAppState }) {
  const lines = buildGlobalValueLines(state)

  if (lines.length === 0) {
    return null
  }

  return (
    <SectionCard title="全局变量" accentColor="yellow" badge={`${lines.length} 项`}>
      {lines.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
    </SectionCard>
  )
}

function OverlayPager({
  title,
  badge,
  lines,
  offset
}: {
  title: string
  badge?: string
  lines: string[]
  offset: number
}) {
  const pageSize = 10
  const maxOffset = Math.max(0, lines.length - pageSize)
  const safeOffset = Math.max(0, Math.min(offset, maxOffset))
  const visibleLines = lines.slice(safeOffset, safeOffset + pageSize)
  const pageLabel = lines.length === 0
    ? "0/0"
    : `${Math.floor(safeOffset / pageSize) + 1}/${Math.max(1, Math.ceil(lines.length / pageSize))}`

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="yellow" bold>{title}</Text>
        <Text color="gray">{badge ? `${badge} · ${pageLabel}` : pageLabel}</Text>
      </Box>
      {visibleLines.length === 0 ? (
        <Text color="gray">当前没有可显示内容。</Text>
      ) : (
        visibleLines.map((line, index) => (
          <Text key={`${safeOffset}-${index}-${line}`}>{line}</Text>
        ))
      )}
      <Text color="gray">↑/↓ 或 J/K 翻行；再次按对应快捷键关闭。</Text>
    </Box>
  )
}

function TimeControlPanel({
  state,
  onSelect
}: {
  state: TuiClientAppState
  onSelect: (value: string) => void
}) {
  const paused = findTimePause(state)
  const speed = findTimeSpeed(state)
  const options = useMemo<MenuOption[]>(() => {
    return [
      {
        value: paused ? "meta:time-resume" : "meta:time-pause",
        label: paused ? "继续时间" : "暂停时间"
      },
      { value: "meta:time-speed:0.5", label: "倍率 x0.5" },
      { value: "meta:time-speed:1", label: "倍率 x1" },
      { value: "meta:time-speed:2", label: "倍率 x2" },
      { value: "meta:time-speed:4", label: "倍率 x4" },
      { value: "meta:time-speed:8", label: "倍率 x8" }
    ]
  }, [paused])

  return (
    <SectionCard
      title="时间调试"
      accentColor="yellow"
      badge={paused ? "暂停中" : "运行中"}
    >
      <Box flexDirection="row" flexWrap="wrap">
        <StatusChip label="天数" value={findGameDayLabel(state)} color="yellow" />
        <StatusChip label="倍率" value={`x${speed}`} color="cyan" />
      </Box>
      <MenuSelect
        options={options}
        visibleOptionCount={5}
        onSubmit={onSelect}
      />
    </SectionCard>
  )
}

function BootScreen({ state, task }: { state: TuiClientAppState; task: AsyncTaskState | null }) {
  return (
    <PhoneShell
      state={state}
      title="Story Manager"
      subtitle="正在把剧情编辑器运行成一部掌上故事机"
      accentColor="green"
      footerText="Ctrl+C 退出"
    >
      <SummaryPanel state={state} />
      <SectionCard title="启动面板" accentColor="green" badge={task ? "进行中" : "待命"}>
        {task ? <Spinner label={task.label} /> : <Text>等待下一步操作。</Text>}
      </SectionCard>
      <NotificationPanel notifications={state.notifications} />
    </PhoneShell>
  )
}

function ProfileMenuScreen({
  state,
  onSelect
}: {
  state: TuiClientAppState
  onSelect: (value: string) => void
}) {
  const options = useMemo<MenuOption[]>(() => {
    return [
      ...state.profiles.map((profile) => profileToOption(profile)),
      {
        value: "__create__",
        label: "创建新角色"
      }
    ]
  }, [state.profiles])

  return (
    <PhoneShell
      state={state}
      title="角色入口"
      subtitle="先挑一个身份，再进入你的故事世界"
      accentColor="green"
      footerText="像手机游戏选角色一样，用方向键移动、回车确认"
    >
      <SummaryPanel state={state} />
      <SectionCard title="角色列表" accentColor="green" badge={`${options.length} 项`}>
        <MenuSelect
          options={options}
          visibleOptionCount={6}
          onSubmit={onSelect}
        />
      </SectionCard>
      <NotificationPanel notifications={state.notifications} />
    </PhoneShell>
  )
}

function CreatePlayerScreen({
  state,
  fieldState,
  groupIndex,
  promptIndex,
  validationError,
  onDraftChange,
  onSubmit,
  onCancel
}: {
  state: TuiClientAppState
  fieldState: CreatePlayerFieldState
  groupIndex: number
  promptIndex: number
  validationError: string | null
  onDraftChange: (nextDraft: PlayerSetupDraft) => void
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const currentGroup = getPromptGroupAt(fieldState.promptGroups, groupIndex)
  const currentPrompt = getPromptAt(fieldState.promptGroups, groupIndex, promptIndex)
  const totalGroupCount = fieldState.promptGroups.length
  const totalPromptCount = fieldState.promptGroups.reduce((count, group) => count + group.prompts.length, 0)
  const completedPromptCount = fieldState.promptGroups
    .slice(0, groupIndex)
    .reduce((count, group) => count + group.prompts.length, 0) + promptIndex
  const isLastGroup = groupIndex === totalGroupCount - 1
  const isLastPromptInGroup = currentGroup ? promptIndex === currentGroup.prompts.length - 1 : false
  const isLastStep = isLastGroup && isLastPromptInGroup
  const currentValue = getPromptValue(fieldState.draft, currentPrompt)
  const summaryLines = buildCreatePlayerSummaryLines(fieldState)
  const profileName = buildProfileNameFromDraft(fieldState)

  useInput((_input, key) => {
    if (key.escape) {
      onCancel()
    }
  })

  if (!currentPrompt) {
    return (
      <PhoneShell
        state={state}
        title="创建角色"
        subtitle="当前没有可填写的玩家字段"
        accentColor="green"
        footerText="Esc 返回上一层"
      >
        <Alert variant="warning">当前没有可填写的玩家覆盖字段。</Alert>
        <Text color="gray">请先回到编辑器配置玩家覆盖变量，或者取消当前流程。</Text>
      </PhoneShell>
    )
  }

  return (
    <PhoneShell
      state={state}
      title="创建角色"
      subtitle="像填写手机游戏开局资料卡一样，逐步录入信息"
      accentColor="blue"
      footerText={isLastStep ? "回车完成创建；Esc 返回上一层" : "回车进入下一个字段；Esc 返回上一层"}
    >
      <SectionCard
        title="录入进度"
        accentColor="blue"
        badge={`${completedPromptCount + 1}/${totalPromptCount}`}
      >
        <Box flexDirection="row" flexWrap="wrap">
          <StatusChip label="分组" value={`${groupIndex + 1}/${totalGroupCount}`} color="cyan" />
          <StatusChip label="组号" value={currentGroup?.groupNo ?? 1} color="magenta" />
          <StatusChip label="字段" value={`${promptIndex + 1}/${currentGroup?.prompts.length ?? 1}`} color="yellow" />
        </Box>
      </SectionCard>
      <SectionCard title="当前字段" accentColor="green" badge={currentPrompt.label}>
        <Text>{currentPrompt.label}</Text>
        {currentPrompt.tips ? <Text color="gray">{currentPrompt.tips}</Text> : null}
        {currentGroup && currentGroup.prompts.length > 1 ? (
          <Box flexDirection="column" marginBottom={1}>
            {currentGroup.prompts.map((prompt, index) => {
              const value = fieldState.draft.customValues[prompt.varKey]?.trim() ?? ""
              const isActive = index === promptIndex

              return (
                <Text key={prompt.varKey} color={isActive ? "green" : "gray"}>
                  {isActive ? "> " : "  "}
                  {prompt.label}: {value || "待输入"}
                </Text>
              )
            })}
          </Box>
        ) : null}
        <TextInput
          key={currentPrompt.varKey}
          defaultValue={currentValue}
          placeholder={currentPrompt.tips || currentPrompt.label}
          onChange={(value) => {
            onDraftChange({
              customValues: {
                ...fieldState.draft.customValues,
                [currentPrompt.varKey]: value
              }
            })
          }}
          onSubmit={onSubmit}
        />
      </SectionCard>
      <SectionCard title="角色预览" accentColor="gray" badge={profileName || "未命名"}>
        {summaryLines.map((line) => (
          <Text key={line.key}>{line.label}: {line.value || "待输入"}</Text>
        ))}
        {profileName ? <Text>角色名: {profileName}</Text> : null}
      </SectionCard>
      {validationError ? <Alert variant="error">{validationError}</Alert> : null}
    </PhoneShell>
  )
}

function SaveMenuScreen({
  state,
  onSelect
}: {
  state: TuiClientAppState
  onSelect: (value: string) => void
}) {
  const options = useMemo<MenuOption[]>(() => {
    return [
      {
        value: "__new__",
        label: "开始新游戏"
      },
      ...state.saveSlots.map((saveSlot) => saveSlotToOption(saveSlot))
    ]
  }, [state.saveSlots])

  return (
    <PhoneShell
      state={state}
      title="进入故事"
      subtitle={`${findPlayerName(state)} · ${findLocationLabel(state)}`}
      accentColor="magenta"
      footerText="先选旧存档，或直接开始新游戏"
    >
      <SummaryPanel state={state} />
      <SectionCard title="存档选择" accentColor="magenta" badge={findPlayerName(state)}>
        <Text>所在地：{findLocationLabel(state)}</Text>
        <MenuSelect
          options={options}
          visibleOptionCount={6}
          onSubmit={onSelect}
        />
      </SectionCard>
      <NotificationPanel notifications={state.notifications} />
    </PhoneShell>
  )
}

function SaveInputScreen({
  state,
  defaultSlotId,
  error,
  onSubmit,
  onCancel
}: {
  state: TuiClientAppState
  defaultSlotId: string
  error: string | null
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel()
    }
  })

  return (
    <PhoneShell
      state={state}
      title="保存进度"
      subtitle="给这次故事进程起一个存档名"
      accentColor="yellow"
      footerText="回车保存；Esc 返回游戏"
    >
      <SectionCard title="存档输入" accentColor="yellow" badge={defaultSlotId}>
        <TextInput
          key={defaultSlotId}
          defaultValue={defaultSlotId}
          placeholder="请输入存档 ID"
          onSubmit={onSubmit}
        />
      </SectionCard>
      {error ? <Alert variant="error">{error}</Alert> : null}
    </PhoneShell>
  )
}

function SettingsMenuScreen({
  state,
  onSelect
}: {
  state: TuiClientAppState
  onSelect: (value: string) => void
}) {
  const options = useMemo<MenuOption[]>(() => {
    return [
      { value: "settings:save", label: "保存进度" },
      { value: "settings:debug", label: "查看调试信息" },
      { value: "settings:quit", label: "退出客户端" }
    ]
  }, [state.view])

  return (
    <PhoneShell
      state={state}
      title="设置"
      subtitle="保存 / 调试 / 退出"
      accentColor="magenta"
      footerText="t 进入/返回设置"
    >
      <SectionCard title="设置菜单" accentColor="magenta" badge="系统入口">
        <MenuSelect
          options={options}
          visibleOptionCount={5}
          onSubmit={onSelect}
        />
      </SectionCard>
    </PhoneShell>
  )
}

function GameScreen({
  state,
  uiState,
  onSelectOption,
  onSubmitText,
  onConfirmContinue,
  onSelectDebugTime
}: {
  state: TuiClientAppState
  uiState: GameUiState
  onSelectOption: (value: string) => void
  onSubmitText: (value: string) => void
  onConfirmContinue: () => void
  onSelectDebugTime: (value: string) => void
}) {
  const view = state.view

  if (!view) {
    return (
      <PhoneShell
        state={state}
        title="游戏界面"
        subtitle="当前还没有运行时视图"
        accentColor="red"
        footerText="等待运行时初始化"
      >
        <Alert variant="warning">当前还没有运行时视图。</Alert>
      </PhoneShell>
    )
  }

  const interactionOptions = createInteractionOptions(view)
  const mergedNotifications = [...state.notifications, ...view.notifications]
  const sceneImagePath = findCurrentSceneImagePath(state)
  const currentLocationId = findCurrentLocationId(state)
  const footerHint = "h 主界面  t 设置  空格 暂停/继续  l 消息流  i 全局变量  e 调度器"
  const overlayLines = uiState.overlay === "notifications"
    ? mergedNotifications.slice().reverse()
    : uiState.overlay === "globalVals"
      ? buildGlobalValueLines(state)
      : uiState.overlay === "scheduler"
        ? buildSchedulerMonitorLines(state)
      : []
  const overlayTitle = uiState.overlay === "notifications"
    ? "消息流"
    : uiState.overlay === "globalVals"
      ? "全局变量"
      : "调度器"
  const overlayBadge = uiState.overlay === "notifications"
    ? `${mergedNotifications.length} 条`
    : uiState.overlay === "scheduler"
      ? "调试"
      : `${overlayLines.length} 项`

  return (
    <Box flexDirection="column" width={78}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" width={74}>
          <Text color="cyan">{findHeaderTimeLabel(state)}</Text>
          <Text color="cyan">{findCountyLabel(state)}</Text>
        </Box>
      </Box>

      <Box borderStyle="round" borderColor={view.screen === "debug" ? "yellow" : "blue"} paddingX={1} paddingY={1} flexDirection="column">
        <Text bold color={view.screen === "debug" ? "yellow" : "green"}>
          {view.activeEventTitle ?? view.activeEventId ?? "该干点什么好呢？"}
        </Text>
        {uiState.overlay ? (
          <Box flexDirection="column" marginTop={1}>
            <OverlayPager
              title={overlayTitle}
              badge={overlayBadge}
              lines={overlayLines}
              offset={uiState.overlayOffset}
            />
          </Box>
        ) : null}
        {!uiState.overlay && view.currentDialogue ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan">
              {view.currentDialogue.speakerLabel}
              {" "}
              <Text color="gray">
                {view.currentDialogue.index}/{view.currentDialogue.total}
              </Text>
            </Text>
            <Text>「{view.currentDialogue.content}」</Text>
          </Box>
        ) : null}
        {!uiState.overlay && view.availableBranches.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {view.availableBranches.map((branch) => (
              <Text key={branch.id}>
                - {branch.title}{branch.nextEventId ? ` -> ${branch.nextEventId}` : ""}
              </Text>
            ))}
          </Box>
        ) : null}
        {!uiState.overlay && view.branchContextSummary.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {view.branchContextSummary.map((entry) => (
              <Text key={entry.key}>{entry.key}: {entry.value || "(空)"}</Text>
            ))}
          </Box>
        ) : null}
        {!uiState.overlay && view.interaction?.kind === "select" ? (
          <Box flexDirection="column" marginTop={1}>
            <MenuSelect
              options={interactionOptions}
              visibleOptionCount={6}
              activeIndex={uiState.interactionActiveIndex}
              onActiveIndexChange={(nextIndex) => onSelectDebugTime(`meta:interaction-index:${nextIndex}`)}
              onSubmit={onSelectOption}
            />
          </Box>
        ) : null}
        {!uiState.overlay && view.interaction?.kind === "text-input" ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="magenta">{view.interaction.prompt}</Text>
            <TextInput
              defaultValue={uiState.interactionInputDraft || (view.interaction.initialValue ?? "")}
              placeholder={view.interaction.placeholder ?? "请输入内容"}
              onChange={(value) => onSelectDebugTime(`meta:interaction-input:${encodeURIComponent(value)}`)}
              onSubmit={onSubmitText}
            />
          </Box>
        ) : null}
        {!uiState.overlay && view.interaction?.kind === "confirm" ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="magenta">{view.interaction.prompt}</Text>
            <ConfirmInput
              onConfirm={onConfirmContinue}
              onCancel={() => undefined}
            />
          </Box>
        ) : null}
      </Box>

      <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" width={74}>
          <Text color="green">
            {findPlayerName(state)}  金钱: {findPlayerMoneyLabel(state)}
          </Text>
          <Text color="green">下一天</Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between" width={74}>
          <Text color="gray">{`场景: ${sceneImagePath}`}</Text>
          <Text color="gray">{`地点: ${currentLocationId}`}</Text>
        </Box>
        <Text color="gray">{`最新消息：${findLatestNotification(mergedNotifications) || "无"}`}</Text>
      </Box>

      <Box>
        <Text color="gray">{`${footerHint}  n 下一天`}</Text>
      </Box>
    </Box>
  )
}

function ConfirmQuitScreen({
  state,
  onConfirm,
  onCancel
}: {
  state: TuiClientAppState
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <PhoneShell
      state={state}
      title="确认退出"
      subtitle="像手机应用关闭前那样再确认一次"
      accentColor="red"
      footerText="Y 确认退出；N 返回游戏"
    >
      <SectionCard title="退出提示" accentColor="red" badge="危险操作">
        <Text>是否退出当前客户端？未保存进度将会丢失。</Text>
      </SectionCard>
      <SectionCard title="确认操作" accentColor="yellow">
        <ConfirmInput
          defaultChoice="cancel"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </SectionCard>
    </PhoneShell>
  )
}

function App({ options }: { options: CreateTuiClientAppOptions }) {
  const { exit } = useApp()
  const [app] = useState(() => createTuiClientApp(options))
  const [state, setState] = useState<TuiClientAppState>(app.getState())
  const [screen, setScreen] = useState<ScreenState>({ kind: "boot" })
  const [gameUiState, setGameUiState] = useState<GameUiState>({
    overlay: null,
    overlayOffset: 0,
    interactionActiveIndex: 0,
    interactionInputDraft: ""
  })
  const [task, setTask] = useState<AsyncTaskState | null>({
    label: "正在启动并同步故事数据...",
    error: null
  })
  const [validationError, setValidationError] = useState<string | null>(null)

  // 启动时统一走 bootstrap，后续界面只负责驱动控制层。
  useEffect(() => {
    let isDisposed = false

    const bootstrap = async () => {
      try {
        await app.bootstrap()
        if (isDisposed) {
          return
        }

        const nextState = app.getState()
        setState(nextState)
        setTask(null)

        if (nextState.session) {
          setScreen({ kind: "game" })
          return
        }

        if (nextState.profile) {
          setScreen({ kind: "save-menu" })
          return
        }

        setScreen({ kind: "profile-menu" })
      } catch (error) {
        if (isDisposed) {
          return
        }

        setTask({
          label: "启动失败",
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    void bootstrap()

    return () => {
      isDisposed = true
    }
  }, [app])

  useEffect(() => {
    if (!state.session || task) {
      return
    }

    const interval = setInterval(() => {
      try {
        app.tick(1000)
        setState(app.getState())
      } catch {
        // 会话尚未就绪或已释放时，下一轮 effect 会自行停止。
      }
    }, 1000)

    return () => {
      clearInterval(interval)
    }
  }, [app, state.session, task])

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === "c") {
      exit()
      return
    }

    if (!state.session || screen.kind !== "game") {
      return
    }

    const lowerInput = input.toLowerCase()
    if (lowerInput === "h") {
      setValidationError(null)
      setScreen({ kind: "profile-menu" })
      return
    }

    if (lowerInput === "t") {
      setScreen({ kind: "settings-menu" })
      return
    }

    if (gameUiState.overlay) {
      if (lowerInput === "l" && gameUiState.overlay === "notifications") {
        setGameUiState((currentState) => ({
          ...currentState,
          overlay: null,
          overlayOffset: 0
        }))
        return
      }

      if (lowerInput === "i" && gameUiState.overlay === "globalVals") {
        setGameUiState((currentState) => ({
          ...currentState,
          overlay: null,
          overlayOffset: 0
        }))
        return
      }

      if (lowerInput === "e" && gameUiState.overlay === "scheduler") {
        setGameUiState((currentState) => ({
          ...currentState,
          overlay: null,
          overlayOffset: 0
        }))
        return
      }

      if (key.upArrow || lowerInput === "k") {
        setGameUiState((currentState) => ({
          ...currentState,
          overlayOffset: Math.max(0, currentState.overlayOffset - 1)
        }))
        return
      }

      if (key.downArrow || lowerInput === "j") {
        setGameUiState((currentState) => ({
          ...currentState,
          overlayOffset: currentState.overlayOffset + 1
        }))
        return
      }
    }

    if (input === " ") {
      app.setTimePause(!findTimePause(state))
      setState(app.getState())
      return
    }

    if (lowerInput === "l") {
      setGameUiState((currentState) => ({
        ...currentState,
        overlay: currentState.overlay === "notifications" ? null : "notifications",
        overlayOffset: 0
      }))
      return
    }

    if (lowerInput === "i") {
      setGameUiState((currentState) => ({
        ...currentState,
        overlay: currentState.overlay === "globalVals" ? null : "globalVals",
        overlayOffset: 0
      }))
      return
    }

    if (lowerInput === "e") {
      setGameUiState((currentState) => ({
        ...currentState,
        overlay: currentState.overlay === "scheduler" ? null : "scheduler",
        overlayOffset: 0
      }))
      return
    }

    if (lowerInput === "n") {
      advanceToNextDay()
      return
    }
  })

  async function runTask(label: string, handler: () => Promise<void>) {
    setTask({ label, error: null })

    try {
      await handler()
      setTask(null)
    } catch (error) {
      setTask({
        label,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function selectProfile(profileId: string) {
    if (profileId === "__create__") {
      await runTask("正在准备创建角色...", async () => {
        const prompts = await app.listPlayerOverridePrompts()
        const nextState = app.getState()
        setState(nextState)
        setValidationError(null)
        setScreen({
          kind: "create-player",
          groupIndex: 0,
          promptIndex: 0,
          fieldState: {
            promptGroups: buildPromptGroups(prompts),
            draft: createEmptyDraft()
          }
        })
      })
      return
    }

    await runTask("正在读取角色...", async () => {
      await app.selectProfile(profileId)
      const nextState = app.getState()
      setState(nextState)
      setScreen({ kind: "save-menu" })
    })
  }

  async function handleCreatePlayerSubmit(value: string) {
    if (screen.kind !== "create-player") {
      return
    }

    const currentPrompt = getPromptAt(
      screen.fieldState.promptGroups,
      screen.groupIndex,
      screen.promptIndex
    )
    if (!currentPrompt) {
      setValidationError("当前没有可提交的字段。")
      return
    }

    const nextDraft: PlayerSetupDraft = {
      customValues: {
        ...screen.fieldState.draft.customValues,
        [currentPrompt.varKey]: value
      }
    }
    const validationMessage = validatePromptValue(currentPrompt, value)

    if (validationMessage) {
      setValidationError(validationMessage)
      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex,
        promptIndex: screen.promptIndex,
        fieldState: {
          ...screen.fieldState,
          draft: nextDraft
        }
      })
      return
    }

    setValidationError(null)

    const currentGroup = getPromptGroupAt(screen.fieldState.promptGroups, screen.groupIndex)
    const hasNextPromptInGroup = Boolean(
      currentGroup && screen.promptIndex < currentGroup.prompts.length - 1
    )
    const hasNextGroup = screen.groupIndex < screen.fieldState.promptGroups.length - 1

    if (hasNextPromptInGroup) {
      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex,
        promptIndex: screen.promptIndex + 1,
        fieldState: {
          ...screen.fieldState,
          draft: nextDraft
        }
      })
      return
    }

    if (hasNextGroup) {
      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex + 1,
        promptIndex: 0,
        fieldState: {
          ...screen.fieldState,
          draft: nextDraft
        }
      })
      return
    }

    await runTask("正在创建角色...", async () => {
      await app.createProfile({
        profileName: buildProfileNameFromDraft({
          ...screen.fieldState,
          draft: nextDraft
        }),
        customValues: nextDraft.customValues
      })
      const nextState = app.getState()
      setState(nextState)
      setScreen({ kind: "save-menu" })
    })
  }

  function updateCreatePlayerDraft(nextDraft: PlayerSetupDraft) {
    if (screen.kind !== "create-player") {
      return
    }

    setScreen({
      kind: "create-player",
      groupIndex: screen.groupIndex,
      promptIndex: screen.promptIndex,
      fieldState: {
        ...screen.fieldState,
        draft: nextDraft
      }
    })
  }

  function cancelCreatePlayer() {
    if (screen.kind !== "create-player") {
      return
    }

    if (screen.promptIndex > 0) {
      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex,
        promptIndex: screen.promptIndex - 1,
        fieldState: screen.fieldState
      })
      return
    }

    if (screen.groupIndex > 0) {
      const previousGroup = getPromptGroupAt(screen.fieldState.promptGroups, screen.groupIndex - 1)

      setScreen({
        kind: "create-player",
        groupIndex: screen.groupIndex - 1,
        promptIndex: Math.max(0, (previousGroup?.prompts.length ?? 1) - 1),
        fieldState: screen.fieldState
      })
      return
    }

    setValidationError(null)
    setScreen({ kind: "profile-menu" })
  }

  async function selectSaveOption(value: string) {
    await runTask("正在创建运行时会话...", async () => {
      if (value === "__new__") {
        await app.startNewGame()
      } else {
        await app.loadSave(value)
      }

      const nextState = app.getState()
      setState(nextState)
      setScreen({ kind: "game" })
    })
  }

  async function handleGameSelect(value: string) {
    const optionId = value.replace(/^action:/, "")
    await handleDispatchAction(app, {
      type: optionId === "continue" ? "continue" : "select-option",
      ...(optionId === "continue" ? {} : { optionId })
    } as RuntimeStorySessionAction, setState)
  }

  async function handleSettingsSelect(value: string) {
    if (value === "settings:save") {
      setValidationError(null)
      setScreen({
        kind: "save-input",
        defaultSlotId: `slot-${state.saveSlots.length + 1}`
      })
      return
    }

    if (value === "settings:debug") {
      await handleDispatchAction(app, {
        type: state.view?.screen === "debug" ? "close-debug" : "open-debug"
      }, setState)
      setScreen({ kind: "game" })
      return
    }

    if (value === "settings:quit") {
      setScreen({ kind: "confirm-quit" })
    }
  }

  async function handleTimeDebugSelect(value: string) {
    if (!state.session) {
      if (value.startsWith("meta:interaction-index:")) {
        const indexText = value.slice("meta:interaction-index:".length)
        const nextIndex = Number.parseInt(indexText, 10)
        if (Number.isFinite(nextIndex)) {
          setGameUiState((currentState) => ({
            ...currentState,
            interactionActiveIndex: Math.max(0, nextIndex)
          }))
        }
      }

      if (value.startsWith("meta:interaction-input:")) {
        const encoded = value.slice("meta:interaction-input:".length)
        setGameUiState((currentState) => ({
          ...currentState,
          interactionInputDraft: decodeURIComponent(encoded)
        }))
      }

      return
    }

    if (value.startsWith("meta:interaction-index:")) {
      const indexText = value.slice("meta:interaction-index:".length)
      const nextIndex = Number.parseInt(indexText, 10)
      if (Number.isFinite(nextIndex)) {
        setGameUiState((currentState) => ({
          ...currentState,
          interactionActiveIndex: Math.max(0, nextIndex)
        }))
      }
      return
    }

    if (value.startsWith("meta:interaction-input:")) {
      const encoded = value.slice("meta:interaction-input:".length)
      setGameUiState((currentState) => ({
        ...currentState,
        interactionInputDraft: decodeURIComponent(encoded)
      }))
      return
    }

    if (value === "meta:time-pause") {
      app.setTimePause(true)
      setState(app.getState())
      return
    }

    if (value === "meta:time-resume") {
      app.setTimePause(false)
      setState(app.getState())
      return
    }

    if (value.startsWith("meta:time-speed:")) {
      const speedText = value.slice("meta:time-speed:".length)
      const speed = Number.parseFloat(speedText)
      if (Number.isFinite(speed)) {
        app.setTimeSpeed(speed)
        setState(app.getState())
      }
    }
  }

  function advanceToNextDay() {
    if (!state.session) {
      return
    }

    const nowHour = findSystemValue(state, "system.now_hour")
    const nowMinute = findSystemValue(state, "system.now_minute")
    const hourValue = typeof nowHour === "number" && Number.isFinite(nowHour) ? nowHour : 0
    const minuteValue = typeof nowMinute === "number" && Number.isFinite(nowMinute) ? nowMinute : 0
    const minutesUntilNextDay = Math.max(1, (24 * 60) - (hourValue * 60 + minuteValue))
    const restorePaused = findTimePause(state)
    const currentSpeed = findTimeSpeed(state)
    const restoreSpeed = currentSpeed > 0 ? currentSpeed : 1

    app.setTimePause(false)
    app.setTimeSpeed(1)
    app.tick(minutesUntilNextDay * 60000)
    app.setTimeSpeed(restoreSpeed)
    app.setTimePause(restorePaused)
    setState(app.getState())
  }

  async function submitTextInput(value: string) {
    const interaction = state.view?.interaction
    if (!interaction || interaction.kind !== "text-input") {
      return
    }

    await handleDispatchAction(app, {
      type: "submit-text",
      field: interaction.field,
      value
    }, setState)
    setGameUiState((currentState) => ({
      ...currentState,
      interactionInputDraft: ""
    }))
  }

  async function confirmInteraction() {
    await handleDispatchAction(app, { type: "continue" }, setState)
  }

  async function submitSaveSlot(slotId: string) {
    const normalizedSlotId = slotId.trim() || `slot-${state.saveSlots.length + 1}`

    await runTask("正在保存进度...", async () => {
      await app.saveToSlot(normalizedSlotId)
      const nextState = app.getState()
      setState(nextState)
      setScreen({ kind: "game" })
    })
  }

  const currentView = (() => {
    if (task?.error) {
      return (
        <PhoneShell
          state={state}
          title="启动失败"
          subtitle="需要先处理错误后才能继续"
          accentColor="red"
          footerText="按 Ctrl+C 退出，或修正问题后重新启动"
        >
          <BootScreen state={state} task={task} />
          <Alert variant="error">{task.error}</Alert>
        </PhoneShell>
      )
    }

    if (task) {
      return <BootScreen state={state} task={task} />
    }

    if (screen.kind === "profile-menu") {
      return <ProfileMenuScreen state={state} onSelect={(value) => void selectProfile(value)} />
    }

    if (screen.kind === "boot") {
      return <BootScreen state={state} task={null} />
    }

    if (screen.kind === "create-player") {
      return (
        <CreatePlayerScreen
          state={state}
          fieldState={screen.fieldState}
          groupIndex={screen.groupIndex}
          promptIndex={screen.promptIndex}
          validationError={validationError}
          onDraftChange={updateCreatePlayerDraft}
          onSubmit={(value) => void handleCreatePlayerSubmit(value)}
          onCancel={cancelCreatePlayer}
        />
      )
    }

    if (screen.kind === "save-menu") {
      return <SaveMenuScreen state={state} onSelect={(value) => void selectSaveOption(value)} />
    }

    if (screen.kind === "settings-menu") {
      return <SettingsMenuScreen state={state} onSelect={(value) => void handleSettingsSelect(value)} />
    }

    if (screen.kind === "save-input") {
      return (
        <SaveInputScreen
          state={state}
          defaultSlotId={screen.defaultSlotId}
          error={validationError}
          onSubmit={(value) => void submitSaveSlot(value)}
          onCancel={() => setScreen({ kind: "game" })}
        />
      )
    }

    if (screen.kind === "confirm-quit") {
      return (
        <ConfirmQuitScreen
          state={state}
          onConfirm={() => exit()}
          onCancel={() => setScreen({ kind: "game" })}
        />
      )
    }

    return (
      <GameScreen
        state={state}
        uiState={gameUiState}
        onSelectOption={(value) => void handleGameSelect(value)}
        onSubmitText={(value) => void submitTextInput(value)}
        onConfirmContinue={() => void confirmInteraction()}
        onSelectDebugTime={(value) => void handleTimeDebugSelect(value)}
      />
    )
  })()

  return (
    <Box flexDirection="column" alignItems="center" paddingX={1} paddingY={1}>
      {currentView}
    </Box>
  )
}

// 入口只负责渲染 Ink 根组件，并等待界面主动退出。
export async function runTuiClient(argv = process.argv.slice(2)) {
  assertInteractiveTerminal()

  const options = parseArgs(argv)
  const instance = render(<App options={options} />, {
    exitOnCtrlC: true,
    patchConsole: true
  })

  await instance.waitUntilExit()
}

async function main() {
  try {
    await runTuiClient()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main()
}
