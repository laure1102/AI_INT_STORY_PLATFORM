/**
 * 变量读写、默认状态和存档字段规范化。
 *
 * 本文件由原 session.ts 按顶层声明依赖拆出；它只负责本领域，不提供新的外部入口。
 */
import {
  DEFAULT_CLOCK_STEP_MINUTES,
  MINUTES_PER_DAY,
  datePartsToUtcDayNumber,
  formatStoryDate,
  parseStoryDate,
  snapMinuteToStep,
  utcDayNumberToDateParts,
  type RuntimeClockState,
  type RuntimeDateParts
} from "../clock"
import {
  createRuntimeRngState,
  nextRuntimeRandom,
  normalizeRuntimeRngState,
  type RuntimeRngState
} from "../rng"
import { sortScheduledEvents } from "../scheduler"
import {
  evaluateStoryBooleanExpression,
  executeStoryScript,
  renderStoryTextTemplate
} from "../vals"
import {
  createRuleBasedRuntimeDirector,
  createRuntimeDirectorDecisionLog,
  flattenDirectorValues,
  type RuntimeDirectorCandidate,
  type RuntimeDirectorCandidateSourceType,
  type RuntimeDirectorDecisionLog,
  type RuntimeDirectorFeatureSnapshot,
  type RuntimeDirectorHistoryEntry,
  type RuntimeStoryDirector
} from "../director"
import type {
  StoryScriptExecutionContext,
  StoryScriptInvocation,
  StoryScriptInvokeDelay
} from "../vals"
import type {
  StoryInvokeTargetType,
  StoryPlayerOverrideValsFile,
  StoryValDefinition,
  StoryValEntryDefinition,
  StoryValsFile
} from "../types"
import type { RuntimeBagEntry, RuntimeBagState, RuntimeBagsState, RuntimeDoingRecord, RuntimeDoingState, RuntimeEventTriggerMode, RuntimeContactTrackId, RuntimeContactMessageState, RuntimeContactState, RuntimeHistoryEntry, RuntimeSchedulerState, RuntimeShopGiftRecord, RuntimeShopPurchaseRecord, RuntimeShopState, RuntimeStoryDoingFile, RuntimeStoryContactConversationRuntimeState, RuntimeStoryContactConversationsFile, RuntimeStoryContactFile, RuntimeStoryReferFile, RuntimeStorySessionSnapshot, RuntimeStoryShopFile } from "./contracts-core"
import type { RuntimeState } from "./contracts-view"
import { DEFAULT_CONTACT_RELATIONSHIP_TRACKS } from "./contracts-view"
import { normalizeClockState, normalizeOptionalText, normalizeSchedulerState } from "./state-scheduler"

/** @param value JSON 风格的状态值。 @returns 递归复制后的值，数组和对象不会与原状态共享引用。 */
export function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)])
    ) as T
  }

  return value
}

/** @param vals 变量文件。 @returns 连分组、变量行和值一起复制的新变量文件。 */
export function cloneValsFile(vals: StoryValsFile): StoryValsFile {
  return {
    variables: vals.variables.map((group) => ({
      name: group.name,
      description: group.description,
      vals: group.vals.map((row) => ({
        name: row.name,
        description: row.description,
        value_type: row.value_type,
        value: cloneValue(row.value),
        calc_rule: row.calc_rule
      }))
    }))
  }
}

/** @param value 数字。 @returns 至少两位的文本，例如 3 变成 `03`。 */
export function padTwoDigits(value: number) {
  return String(value).padStart(2, "0")
}

/** @param value 未知输入。 @param fallback 非有限数字时的默认值。 @returns 截去小数后的整数。 */
export function clampInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback
}

/** @param value 未知输入。 @param fallback 非有限数字时的默认值。 @returns 可用的有限数字。 */
export function clampNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

/** @param snapshot 当前会话快照。 @returns 普通变量与系统变量合并后的独立变量文件，供脚本统一读写。 */
export function createCombinedValsFile(snapshot: RuntimeStorySessionSnapshot): StoryValsFile {
  return {
    variables: [
      ...cloneValsFile(snapshot.vals).variables,
      ...cloneValsFile(snapshot.system_vals).variables
    ]
  }
}

/**
 * 把脚本修改后的合并变量拆回普通变量和系统变量。
 * @param snapshot 要更新的会话快照。 @param nextValsFile 脚本执行后的合并变量。 @returns 无返回值；原地更新快照。
 * 依据原快照已有的分组名归类，避免脚本把系统组意外写进普通变量文件。
 */
export function applyCombinedValsFile(
  snapshot: RuntimeStorySessionSnapshot,
  nextValsFile: StoryValsFile
) {
  const globalGroupNames = new Set(snapshot.vals.variables.map((group) => group.name.trim()))
  const systemGroupNames = new Set(snapshot.system_vals.variables.map((group) => group.name.trim()))

  snapshot.vals = {
    variables: nextValsFile.variables
      .filter((group) => globalGroupNames.has(group.name.trim()))
      .map((group) => cloneValue(group))
  }

  snapshot.system_vals = {
    variables: nextValsFile.variables
      .filter((group) => systemGroupNames.has(group.name.trim()))
      .map((group) => cloneValue(group))
  }
}

/** @param value 未知输入。 @returns 去除首尾空白的字符串；非字符串返回空串。 */
export function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

/** @param mode 未知触发模式。 @returns 合法的 condition/invoke，否则回退为 default。 */
export function normalizeRuntimeEventTriggerMode(mode: unknown): RuntimeEventTriggerMode {
  if (mode === "condition" || mode === "invoke") {
    return mode
  }

  return "default"
}

/** @param event 运行时事件。 @returns 是否允许导演自动扫描；仅 invoke 事件必须由脚本显式调用。 */
export function isRuntimeEventScannable(event: { trigger_mode?: RuntimeEventTriggerMode }) {
  return normalizeRuntimeEventTriggerMode(event.trigger_mode) !== "invoke"
}

/** @param value 任意变量值。 @returns 适合日志展示的文本；对象优先序列化为 JSON。 */
export function formatValueSummary(value: unknown) {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 按 `组名.变量名` 查找变量定义。
 * @param valsFile 变量文件。 @param token 完整变量路径。 @returns 同时包含分组和变量行的结果，找不到时为 null。
 */
export function findValEntry(
  valsFile: StoryValsFile,
  token: string
): { group: StoryValDefinition; row: StoryValEntryDefinition } | null {
  const [groupName, rowName, ...rest] = token.split(".")

  if (!groupName || !rowName || rest.length > 0) {
    return null
  }

  const group = valsFile.variables.find((item) => item.name.trim() === groupName.trim())
  if (!group) {
    return null
  }

  const row = group.vals.find((item) => item.name.trim() === rowName.trim())
  if (!row) {
    return null
  }

  return { group, row }
}

/**
 * 把玩家开局自定义值写入变量文件。
 * @param valsFile 要修改的变量文件。 @param customValues 以 `组.变量` 为键的覆盖字典。 @returns 无返回值；原地修改 valsFile。
 * 未知变量和 calc 计算变量会被忽略，防止绕过变量定义写入不可编辑值。
 */
export function applyCustomValuesToValsFile(valsFile: StoryValsFile, customValues: Record<string, unknown>) {
  for (const [token, value] of Object.entries(customValues)) {
    const match = findValEntry(valsFile, token)

    if (!match || match.row.value_type === "calc") {
      continue
    }

    match.row.value = cloneValue(value)
  }
}

/** @param snapshotVals 变量文件。 @param token `组.变量` 路径。 @returns 当前值；找不到时为 undefined。 */
export function readValEntryValue(snapshotVals: StoryValsFile, token: string) {
  return findValEntry(snapshotVals, token)?.row.value
}

/** @param snapshotVals 系统变量。 @param token 变量路径。 @param fallback 非数字时默认值。 @returns 有限数字。 */
export function readSystemNumber(snapshotVals: StoryValsFile, token: string, fallback = 0) {
  const value = readValEntryValue(snapshotVals, token)
  return clampNumber(value, fallback)
}

/** @param snapshotVals 系统变量。 @param token 变量路径。 @param fallback 非布尔值时默认值。 @returns 布尔值。 */
export function readSystemBoolean(snapshotVals: StoryValsFile, token: string, fallback = false) {
  const value = readValEntryValue(snapshotVals, token)
  return typeof value === "boolean" ? value : fallback
}

/** @param snapshotVals 系统变量。 @param token 变量路径。 @param fallback 非字符串时默认值。 @returns 字符串值。 */
export function readSystemString(snapshotVals: StoryValsFile, token: string, fallback = "") {
  const value = readValEntryValue(snapshotVals, token)
  return typeof value === "string" ? value : fallback
}

/** @param snapshotVals 系统变量。 @param token 变量路径。 @param value 新值。 @returns 无返回值；找不到或为 calc 时不写入。 */
export function writeSystemValue(snapshotVals: StoryValsFile, token: string, value: unknown) {
  const match = findValEntry(snapshotVals, token)
  if (!match || match.row.value_type === "calc") {
    return
  }

  match.row.value = cloneValue(value)
}

/** @param snapshot 会话快照。 @param token 变量路径。 @returns 优先从普通变量读取，再从系统变量读取的值。 */
export function readSnapshotValue(snapshot: RuntimeStorySessionSnapshot, token: string) {
  const runtimeValue = readValEntryValue(snapshot.vals, token)
  if (runtimeValue !== undefined) {
    return runtimeValue
  }

  return readValEntryValue(snapshot.system_vals, token)
}

/**
 * 向快照中已有的普通或系统变量写值。
 * @param snapshot 会话快照。 @param token 变量路径。 @param value 新值。 @returns 无返回值；未知或 calc 变量保持不变。
 */
export function writeSnapshotValue(
  snapshot: RuntimeStorySessionSnapshot,
  token: string,
  value: unknown
) {
  const runtimeMatch = findValEntry(snapshot.vals, token)
  if (runtimeMatch && runtimeMatch.row.value_type !== "calc") {
    runtimeMatch.row.value = cloneValue(value)
    return true
  }

  const systemMatch = findValEntry(snapshot.system_vals, token)
  if (systemMatch && systemMatch.row.value_type !== "calc") {
    systemMatch.row.value = cloneValue(value)
    return true
  }

  return false
}

/** @param hour 24 小时制小时。 @returns 12 点前为“上午”，其余为“下午”。 */
export function resolveShiduan(hour: number) {
  return hour >= 12 ? "下午" : "上午"
}

/** @param dayNumberUtc UTC 整天编号。 @returns 周一为 1、周日为 7 的星期数。 */
export function resolveWeekday(dayNumberUtc: number) {
  const weekday = ((dayNumberUtc + 3) % 7 + 7) % 7
  return weekday + 1
}

/** @param _date 当前故事日期，预留给未来节气算法。 @returns 当前尚未实现节气表，因此返回空串。 */
export function resolveJieqi(_date: RuntimeDateParts) {
  return ""
}

/** @param date 当前故事日期。 @returns 内置公历节日名称，普通日期返回空串。 */
export function resolveJieri(date: RuntimeDateParts) {
  const key = `${padTwoDigits(date.month)}-${padTwoDigits(date.day)}`
  const festivalMap: Record<string, string> = {
    "01-01": "元旦",
    "02-14": "情人节",
    "03-08": "妇女节",
    "05-01": "劳动节",
    "06-01": "儿童节",
    "10-01": "国庆节",
    "12-25": "圣诞节"
  }

  return festivalMap[key] ?? ""
}

/** @returns 没有排队、活动或历史记录的全新调度器状态。 */
export function createDefaultSchedulerState(): RuntimeSchedulerState {
  return {
    scheduled: [],
    ready_queue: [],
    active: null,
    consumed_once_ids: [],
    consumed_graph_root_ids: [],
    loop_states: [],
    audit_logs: [],
    director_logs: [],
    manual_pause: false,
    event_pause: false,
    next_seq: 1
  }
}

/** @returns 至少包含空玩家背包的全新背包状态。 */
export function createDefaultBagsState(): RuntimeBagsState {
  return {
    player: {
      entries: []
    }
  }
}

/** @returns 使用通用媒介、带内置关系轨道且没有行为库的默认联系人配置。 */
export function createDefaultContactConfig(): RuntimeStoryContactFile {
  return {
    default_channel_id: "generic",
    channels: [{ id: "generic", name: "通用往来", preset: "generic", labels: {} }],
    relationship_tracks: cloneValue(DEFAULT_CONTACT_RELATIONSHIP_TRACKS),
    personality_library: [],
    talk_library: [],
    action_library: [],
    reply_library: [],
    player_quick_messages: [],
    contact_profiles: [],
    fallback_replies: {}
  }
}

/** @returns 没有联系人和往来线程的全新联系人运行状态。 */
export function createDefaultContactState(): RuntimeContactState {
  return {
    contacts: [],
    threads: []
  }
}

/** @returns 默认没有正在进行的结构化联系人会话，因此返回 null。 */
export function createDefaultContactConversationState(): RuntimeStoryContactConversationRuntimeState | null {
  return null
}

/** @returns 空的已完成联系人会话历史数组。 */
export function createDefaultContactConversationHistoryState(): RuntimeStoryContactConversationRuntimeState[] {
  return []
}

/** @returns 不含会话定义的默认配置文件。 */
export function createDefaultContactConversationsConfig(): RuntimeStoryContactConversationsFile {
  return {
    conversations: []
  }
}

/**
 * 清洗一个正在进行或已完成的联系人剧情存档。
 * @param state 可能来自旧存档的不完整状态。 @returns 字段已补齐的状态；没有状态时返回 null。
 */
export function normalizeContactConversationState(
  state: RuntimeStoryContactConversationRuntimeState | null | undefined
): RuntimeStoryContactConversationRuntimeState | null {
  if (!state) {
    return null
  }

  const conversationId = normalizeText(state.conversation_id)
  const roleKey = normalizeContactRoleKey(state.role_key)
  const nodeId = normalizeText(state.node_id)
  if (!conversationId || !roleKey || !nodeId) {
    return null
  }

  return {
    conversation_id: conversationId,
    role_key: roleKey,
    node_id: nodeId,
    option_id: normalizeOptionalText(state.option_id) ?? null,
    last_reminder_game_minute: state.last_reminder_game_minute === null || state.last_reminder_game_minute === undefined
      ? null
      : Math.max(0, clampInteger(state.last_reminder_game_minute, 0)),
    finished: Boolean(state.finished)
  }
}

/** @param states 旧存档中的会话历史。 @returns 去除空项并逐条规范化后的新数组。 */
export function normalizeContactConversationHistoryState(
  states: RuntimeStoryContactConversationRuntimeState[] | undefined
): RuntimeStoryContactConversationRuntimeState[] {
  const normalizedStates = Array.isArray(states) ? states : []
  return normalizedStates
    .map((state) => normalizeContactConversationState(state))
    .filter((state): state is RuntimeStoryContactConversationRuntimeState => Boolean(state))
}

/**
 * 让内存快捷字段与可保存快照中的活动联系人剧情保持一致。
 * @param runtimeState 会话内部状态。 @returns 同步后的活动会话或 null；会同时更新两处字段。
 */
export function syncActiveContactConversationState(runtimeState: RuntimeState) {
  runtimeState.snapshot.contact_conversation = normalizeContactConversationState(
    runtimeState.snapshot.contact_conversation ?? runtimeState.activeContactConversation
  )
  runtimeState.activeContactConversation = runtimeState.snapshot.contact_conversation ?? null
  return runtimeState.activeContactConversation
}

/** @returns 使用 `player.gender` 及常见中英文性别别名的默认称谓配置。 */
export function createDefaultReferConfig(): RuntimeStoryReferFile {
  return {
    gender_value_key: "player.gender",
    gender_aliases: {
      male: ["男", "male", "m"],
      female: ["女", "female", "f"]
    },
    terms: []
  }
}

/** @returns 没有菜单和行动定义的默认 Doing 配置。 */
export function createDefaultDoingConfig(): RuntimeStoryDoingFile {
  return {
    menus: [],
    doings: []
  }
}

/** @returns 没有解锁、锁定或使用记录的全新行动状态。 */
export function createDefaultDoingState(): RuntimeDoingState {
  return {
    unlocked_ids: [],
    locked_ids: [],
    records: []
  }
}

/** @returns 使用 `player.money` 作为货币、但没有商品的默认商店配置。 */
export function createDefaultShopConfig(): RuntimeStoryShopFile {
  return {
    currency_value_key: "player.money",
    categories: [],
    products: []
  }
}

/** @returns 没有购买和赠送记录的全新商店状态。 */
export function createDefaultShopState(): RuntimeShopState {
  return {
    purchases: [],
    gifts: []
  }
}

/** @param ownerId 背包所有者输入。 @returns 去空白 id；非字符串返回空串。 */
export function normalizeOwnerId(ownerId: unknown) {
  return typeof ownerId === "string" ? ownerId.trim() : ""
}

/** @param itemId 物品 id 输入。 @returns 去空白 id；非字符串返回空串。 */
export function normalizeItemId(itemId: unknown) {
  return typeof itemId === "string" ? itemId.trim() : ""
}

/** @param roleKey 联系人角色键。 @returns 去空白键；非字符串返回空串。 */
export function normalizeContactRoleKey(roleKey: unknown) {
  return typeof roleKey === "string" ? roleKey.trim() : ""
}

/** @param doingId 行动 id 输入。 @returns 去空白 id；非字符串返回空串。 */
export function normalizeDoingId(doingId: unknown) {
  return typeof doingId === "string" ? doingId.trim() : ""
}

/** @param productId 商品 id 输入。 @returns 去空白 id；非字符串返回空串。 */
export function normalizeShopProductId(productId: unknown) {
  return typeof productId === "string" ? productId.trim() : ""
}

/** @param value 关系轨道输入。 @returns 四种合法轨道之一，未知值回退为 none。 */
export function normalizeContactTrackId(value: unknown): RuntimeContactTrackId {
  return value === "romance" || value === "official" || value === "social" || value === "none"
    ? value
    : "none"
}

/** @param value 好感度输入。 @param fallback 非数字默认值。 @returns 0 到 100 的整数好感度。 */
export function clampContactFavor(value: unknown, fallback = 0) {
  return Math.max(0, Math.min(100, clampInteger(value, fallback)))
}

/** @param quantity 数量输入。 @param fallback 非数字默认值。 @returns 不小于 0 的整数数量。 */
export function normalizeBagQuantity(quantity: unknown, fallback = 1) {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
    return fallback
  }

  return Math.max(0, Math.trunc(quantity))
}

/**
 * 清洗单个背包并合并重复物品。
 * @param bag 可能不完整的存档背包。 @returns 只含有效正数量物品的新背包。
 * 重复 item_id 会累加数量，首次条目的绑定、取得时间和 meta 被保留。
 */
export function normalizeBagState(bag: RuntimeBagState | undefined): RuntimeBagState {
  const entries = Array.isArray(bag?.entries) ? bag.entries : []
  const normalizedEntries = new Map<string, RuntimeBagEntry>()

  for (const entry of entries) {
    const itemId = normalizeItemId(entry.item_id)
    const quantity = normalizeBagQuantity(entry.quantity, 0)

    if (!itemId || quantity <= 0) {
      continue
    }

    const existing = normalizedEntries.get(itemId)
    if (existing) {
      existing.quantity += quantity
      continue
    }

    normalizedEntries.set(itemId, {
      item_id: itemId,
      quantity,
      bound: Boolean(entry.bound),
      obtained_at_day: Math.max(0, clampInteger(entry.obtained_at_day, 0)),
      obtained_at_minute: Math.max(0, clampInteger(entry.obtained_at_minute, 0)),
      meta: entry.meta && typeof entry.meta === "object"
        ? cloneValue(entry.meta)
        : {}
    })
  }

  return {
    entries: Array.from(normalizedEntries.values())
  }
}

/** @param snapshot 会话快照。 @returns 无返回值；清洗所有所有者背包并确保 player 背包存在。 */
export function normalizeBagsState(snapshot: RuntimeStorySessionSnapshot) {
  const rawBags = snapshot.bags ?? createDefaultBagsState()
  const nextBags: RuntimeBagsState = createDefaultBagsState()

  for (const [ownerId, bag] of Object.entries(rawBags)) {
    const normalizedOwnerId = normalizeOwnerId(ownerId)
    if (!normalizedOwnerId) {
      continue
    }

    nextBags[normalizedOwnerId] = normalizeBagState(bag)
  }

  if (!nextBags.player) {
    nextBags.player = {
      entries: []
    }
  }

  snapshot.bags = nextBags
}

/**
 * 清洗联系人消息存档。
 * @param messages 可能来自旧存档的消息数组。 @returns 字段规范、标签去重且 id/content 非空的消息数组。
 */
export function normalizeContactMessages(messages: RuntimeContactMessageState[] | undefined): RuntimeContactMessageState[] {
  const nextMessages = Array.isArray(messages) ? messages : []

  return nextMessages
    .map((message) => {
      const sender: RuntimeContactMessageState["sender"] = message.sender === "contact" || message.sender === "system"
        ? message.sender
        : "player"
      const optionKind: RuntimeContactMessageState["option_kind"] = message.option_kind === "action"
        ? "action"
        : message.option_kind === "talk"
          ? "talk"
          : undefined

      return {
        id: normalizeText(message.id),
        sender,
        content: normalizeText(message.content),
        game_minute: Math.max(0, clampInteger(message.game_minute, 0)),
        read: Boolean(message.read),
        ...(normalizeOptionalText(message.option_id) ? { option_id: normalizeOptionalText(message.option_id) } : {}),
        ...(optionKind ? { option_kind: optionKind } : {}),
        ...(normalizeOptionalText(message.quick_message_id) ? { quick_message_id: normalizeOptionalText(message.quick_message_id) } : {}),
        ...(normalizeOptionalText(message.source_rule_id) ? { source_rule_id: normalizeOptionalText(message.source_rule_id) } : {}),
        ...(normalizeOptionalText(message.contact_conversation_id) ? { contact_conversation_id: normalizeOptionalText(message.contact_conversation_id) } : {}),
        ...(normalizeOptionalText(message.contact_conversation_node_id) ? { contact_conversation_node_id: normalizeOptionalText(message.contact_conversation_node_id) } : {}),
        ...(message.contact_conversation_reminder !== undefined
          ? { contact_conversation_reminder: Boolean(message.contact_conversation_reminder) }
          : {}),
        ...(Array.isArray(message.tags)
          ? { tags: Array.from(new Set(message.tags.map((tag) => normalizeText(tag)).filter(Boolean))) }
          : {})
      }
    })
    .filter((message) => message.id && message.content)
}

/** @param history 可能来自存档或外部调用的历史。 @returns 只保留显式合法分类并规范字段的完整时间线。 */
export function normalizeHistoryState(history: RuntimeHistoryEntry[] | undefined): RuntimeHistoryEntry[] {
  const validCategories = new Set<RuntimeHistoryEntry["category"]>(["operation", "story", "system"])
  const validTypes = new Set<RuntimeHistoryEntry["type"]>(["event", "action", "dialogue", "system"])

  return (Array.isArray(history) ? history : [])
    .map((entry) => {
      if (!entry || !validCategories.has(entry.category) || !validTypes.has(entry.type)) {
        return null
      }

      const id = normalizeText(entry.id)
      if (!id) {
        return null
      }

      const gameMinute = Math.max(0, clampInteger(entry.game_minute, 0))
      const timestamp = normalizeText(entry.timestamp) || new Date(gameMinute * 60000).toISOString()
      return {
        category: entry.category,
        type: entry.type,
        id,
        game_minute: gameMinute,
        ...(normalizeText(entry.title) ? { title: normalizeText(entry.title) } : {}),
        ...(normalizeText(entry.content) ? { content: normalizeText(entry.content) } : {}),
        timestamp
      }
    })
    .filter((entry): entry is RuntimeHistoryEntry => Boolean(entry))
}

/** @param snapshot 会话快照。 @returns 无返回值；规范联系人、好感度、线程和消息并写回 snapshot.contact。 */
export function normalizeContactState(snapshot: RuntimeStorySessionSnapshot) {
  const rawContact = snapshot.contact ?? createDefaultContactState()
  const contacts = Array.isArray(rawContact.contacts) ? rawContact.contacts : []
  const threads = Array.isArray(rawContact.threads) ? rawContact.threads : []

  snapshot.contact = {
    contacts: contacts
      .map((contact) => ({
        role_key: normalizeContactRoleKey(contact.role_key),
        favor: clampContactFavor(contact.favor, 0),
        unlocked_at_day: Math.max(1, clampInteger(contact.unlocked_at_day, 1))
      }))
      .filter((contact) => contact.role_key),
    threads: threads
      .map((thread) => ({
        role_key: normalizeContactRoleKey(thread.role_key),
        messages: normalizeContactMessages(thread.messages)
      }))
      .filter((thread) => thread.role_key)
  }
}

/**
 * 一次性规范从新建流程或存档恢复得到的全部可变领域状态。
 * @param snapshot 会话快照。 @returns 无返回值；依次修复背包、联系人、剧情会话、行动、商店、时钟和调度器。
 */
export function normalizeStorySnapshotState(snapshot: RuntimeStorySessionSnapshot) {
  snapshot.history = normalizeHistoryState(snapshot.history)
  normalizeBagsState(snapshot)
  normalizeContactState(snapshot)
  snapshot.contact_conversation = normalizeContactConversationState(snapshot.contact_conversation)
  snapshot.contact_conversations = normalizeContactConversationHistoryState(snapshot.contact_conversations)
  normalizeDoingState(snapshot)
  normalizeShopState(snapshot)
  normalizeClockState(snapshot)
  normalizeSchedulerState(snapshot)
}

/**
 * 清洗行动解锁状态和冷却记录。
 * @param snapshot 会话快照。 @returns 无返回值；id 去重、负数归零、重复记录以最后一条为准。
 */
export function normalizeDoingState(snapshot: RuntimeStorySessionSnapshot) {
  const rawDoing = snapshot.doing ?? createDefaultDoingState()
  const unlockedIds = Array.isArray(rawDoing.unlocked_ids)
    ? Array.from(new Set(rawDoing.unlocked_ids.map((item) => normalizeDoingId(item)).filter(Boolean)))
    : []
  const lockedIds = Array.isArray(rawDoing.locked_ids)
    ? Array.from(new Set(rawDoing.locked_ids.map((item) => normalizeDoingId(item)).filter(Boolean)))
    : []
  const records = new Map<string, RuntimeDoingRecord>()
  const rawRecords = Array.isArray(rawDoing.records) ? rawDoing.records : []

  for (const record of rawRecords) {
    const id = normalizeDoingId(record.id)
    if (!id) {
      continue
    }

    const usedCount = Math.max(0, clampInteger(record.used_count, 0))
    const lastUsedGameMinute = record.last_used_game_minute === null || record.last_used_game_minute === undefined
      ? null
      : Math.max(0, clampInteger(record.last_used_game_minute, 0))
    const cooldownUntilGameMinute = record.cooldown_until_game_minute === null || record.cooldown_until_game_minute === undefined
      ? null
      : Math.max(0, clampInteger(record.cooldown_until_game_minute, 0))

    records.set(id, {
      id,
      used_count: usedCount,
      last_used_game_minute: lastUsedGameMinute,
      cooldown_until_game_minute: cooldownUntilGameMinute
    })
  }

  snapshot.doing = {
    unlocked_ids: unlockedIds,
    locked_ids: lockedIds,
    records: Array.from(records.values())
  }
}

/**
 * 清洗购买与赠礼历史。
 * @param snapshot 会话快照。 @returns 无返回值；非法记录被丢弃，计数和时间限制为非负值。
 * 购买以 product_id 去重，赠礼以 product_id 与 role_key 组合键去重。
 */
export function normalizeShopState(snapshot: RuntimeStorySessionSnapshot) {
  const rawShop = snapshot.shop ?? createDefaultShopState()
  const purchases = new Map<string, RuntimeShopPurchaseRecord>()
  const rawPurchases = Array.isArray(rawShop.purchases) ? rawShop.purchases : []

  for (const record of rawPurchases) {
    const productId = normalizeShopProductId(record.product_id)
    if (!productId) {
      continue
    }

    purchases.set(productId, {
      product_id: productId,
      purchased_count: Math.max(0, clampInteger(record.purchased_count, 0)),
      last_purchased_game_minute: record.last_purchased_game_minute === null || record.last_purchased_game_minute === undefined
        ? null
        : Math.max(0, clampInteger(record.last_purchased_game_minute, 0)),
      cooldown_until_game_minute: record.cooldown_until_game_minute === null || record.cooldown_until_game_minute === undefined
        ? null
        : Math.max(0, clampInteger(record.cooldown_until_game_minute, 0))
    })
  }

  const gifts = new Map<string, RuntimeShopGiftRecord>()
  const rawGifts = Array.isArray(rawShop.gifts) ? rawShop.gifts : []

  for (const record of rawGifts) {
    const productId = normalizeShopProductId(record.product_id)
    const roleKey = normalizeContactRoleKey(record.role_key)
    if (!productId || !roleKey) {
      continue
    }

    gifts.set(`${productId}\n${roleKey}`, {
      product_id: productId,
      role_key: roleKey,
      gifted_count: Math.max(0, clampInteger(record.gifted_count, 0)),
      last_gifted_game_minute: record.last_gifted_game_minute === null || record.last_gifted_game_minute === undefined
        ? null
        : Math.max(0, clampInteger(record.last_gifted_game_minute, 0)),
      cooldown_until_game_minute: record.cooldown_until_game_minute === null || record.cooldown_until_game_minute === undefined
        ? null
        : Math.max(0, clampInteger(record.cooldown_until_game_minute, 0))
    })
  }

  snapshot.shop = {
    purchases: Array.from(purchases.values()),
    gifts: Array.from(gifts.values())
  }
}
