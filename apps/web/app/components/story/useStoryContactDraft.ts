import { reactive } from "vue"
import type {
  StoryContactActionLibraryEntry,
  StoryContactChannelPreset,
  StoryContactProfile,
  StoryContactTrackId,
  StoryContactFile,
  StoryContactProactiveMessageRule,
  StoryContactQuickMessage,
  StoryContactReplyLibraryEntry,
  StoryContactRelationshipStage,
  StoryContactRelationshipTrack,
  StoryContactTalkLibraryEntry
} from "@story-mgr/core"
import { createStoryContactChannelActions } from "./useStoryContactChannels"

type InvokeTargetType = "chain" | "pool" | "schedule"
type DelayUnit = "hours" | "days" | "months" | "years"

interface ContactScopeDraft {
  contact_tracks: StoryContactTrackId[]
  maxFavorText: string
  minFavorText: string
  personalityIds: string[]
  roleKeysText: string
}

interface ContactInvokeDraft {
  delayEnabled: boolean
  delayUnit: DelayUnit
  delayValueText: string
  enabled: boolean
  eventId: string
  targetType: InvokeTargetType
}

export interface ContactTrackStageDraft {
  allowContact: boolean
  descr: string
  draftKey: string
  id: string
  lockMessage: string
  maxFavorText: string
  minFavorText: string
  name: string
  unlockActionTagsText: string
}

export interface ContactTrackDraft {
  descr: string
  draftKey: string
  id: StoryContactTrackId
  name: string
  stages: ContactTrackStageDraft[]
}

export interface ContactPersonalityDraft {
  descr: string
  draftKey: string
  id: string
  name: string
  styleTagsText: string
}

export interface ContactTalkDraft {
  baseFavorDeltaText: string
  cooldownHoursText: string
  draftKey: string
  id: string
  invoke: ContactInvokeDraft
  scope: ContactScopeDraft
  tagsText: string
  text: string
}

export interface ContactActionDraft {
  baseFavorDeltaText: string
  cooldownHoursText: string
  costItemsText: string
  costMoneyText: string
  draftKey: string
  id: string
  invoke: ContactInvokeDraft
  label: string
  scope: ContactScopeDraft
  tagsText: string
  text: string
}

export interface ContactReplyDraft {
  draftKey: string
  id: string
  repliesText: string
  scope: ContactScopeDraft
  tagsText: string
}

export interface ContactQuickMessageDraft {
  availableRoleKeysText: string
  baseFavorDeltaText: string
  cooldownHoursText: string
  draftKey: string
  id: string
  tagsText: string
  text: string
  visibility: "always" | "suggested-only"
}

export interface ContactTagRepliesDraft {
  draftKey: string
  repliesText: string
  tag: string
}

export interface ContactProactiveMessageDraft {
  cooldownHoursText: string
  draftKey: string
  enabled: boolean
  favorDeltaText: string
  id: string
  messagesText: string
  replyQuickMessageIds: string[]
  triggerExpr: string
}

export interface ContactProfileDraft {
  autoAdd: boolean
  channelId: string
  draftKey: string
  enabled: boolean
  initialFavorText: string
  preferredTagsText: string
  proactiveMessages: ContactProactiveMessageDraft[]
  replyByTag: ContactTagRepliesDraft[]
  roleKey: string
}

export interface ContactChannelDraft {
  draftKey: string
  id: string
  labels: Record<"message" | "conversation" | "talk" | "action" | "gift" | "send" | "reply", string>
  name: string
  preset: StoryContactChannelPreset
}

/** 联系人配置弹窗在保存前使用的可编辑草稿。 */
export interface ContactDraftState {
  actions: ContactActionDraft[]
  channels: ContactChannelDraft[]
  contactProfiles: ContactProfileDraft[]
  defaultChannelId: string
  fallbackReplies: ContactTagRepliesDraft[]
  personalities: ContactPersonalityDraft[]
  quickMessages: ContactQuickMessageDraft[]
  replies: ContactReplyDraft[]
  talks: ContactTalkDraft[]
  tracks: ContactTrackDraft[]
}

const AVAILABLE_CONTACT_TRACK_IDS: StoryContactTrackId[] = ["romance", "official", "social"]

/** 复制 `Plain`，避免共享可变引用。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 执行 `splitCsvText` 对应的局部业务逻辑。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function splitCsvText(value: string) {
  return value
    .split(/[,\n，、]/g)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** 执行 `splitLinesText` 对应的局部业务逻辑。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function splitLinesText(value: string) {
  return value
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 解析 `IntegerText` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
function parseIntegerText(value: unknown, fallback: number) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : fallback
  }

  if (typeof value !== "string") {
    return fallback
  }

  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 解析 `NumberText` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
function parseNumberText(value: unknown, fallback: number) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback
  }

  if (typeof value !== "string") {
    return fallback
  }

  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 执行 `clampFavor` 对应的局部业务逻辑。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function clampFavor(value: number) {
  return Math.max(0, Math.min(100, Math.trunc(value)))
}

/** 创建一份新的 `ScopeDraft` 数据。 @param scope 调用方传入的 `scope`。 @returns 计算、查找或构建后的结果。 */
function createScopeDraft(
  scope?: Partial<StoryContactTalkLibraryEntry["scope"]>
): ContactScopeDraft {
  return {
    contact_tracks: Array.isArray(scope?.contact_tracks) ? [...scope.contact_tracks] : [],
    maxFavorText: String(scope?.max_favor ?? 100),
    minFavorText: String(scope?.min_favor ?? 0),
    personalityIds: Array.isArray(scope?.personality_ids) ? [...scope.personality_ids] : [],
    roleKeysText: Array.isArray(scope?.role_keys) ? scope.role_keys.join(", ") : ""
  }
}

/** 创建一份新的 `InvokeDraft` 数据。 @param invoke 调用方传入的 `invoke`。 @returns 计算、查找或构建后的结果。 */
function createInvokeDraft(
  invoke?: Partial<NonNullable<StoryContactTalkLibraryEntry["invoke"]>>
): ContactInvokeDraft {
  return {
    delayEnabled: Boolean(invoke?.delay),
    delayUnit: invoke?.delay?.unit ?? "hours",
    delayValueText: invoke?.delay ? String(invoke.delay.value) : "1",
    enabled: Boolean(invoke),
    eventId: invoke?.event_id?.trim() ?? "",
    targetType: invoke?.target_type ?? "chain"
  }
}

/** 创建一份新的 `StageDraft` 数据。 @param stage 调用方传入的 `stage`。 @returns 计算、查找或构建后的结果。 */
function createStageDraft(stage?: Partial<StoryContactRelationshipStage>): ContactTrackStageDraft {
  return {
    allowContact: stage?.allow_contact ?? true,
    descr: stage?.descr?.trim() ?? "",
    draftKey: createDraftKey("track-stage"),
    id: stage?.id?.trim() ?? "",
    lockMessage: stage?.lock_message?.trim() ?? "",
    maxFavorText: String(stage?.max_favor ?? 100),
    minFavorText: String(stage?.min_favor ?? 0),
    name: stage?.name?.trim() ?? "",
    unlockActionTagsText: Array.isArray(stage?.unlock_action_tags)
      ? stage.unlock_action_tags.join(", ")
      : ""
  }
}

/** 创建一份新的 `TalkDraft` 数据。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function createTalkDraft(entry?: Partial<StoryContactTalkLibraryEntry>): ContactTalkDraft {
  return {
    baseFavorDeltaText: String(entry?.base_favor_delta ?? 0),
    cooldownHoursText: String(entry?.cooldown_hours ?? 0),
    draftKey: createDraftKey("talk"),
    id: entry?.id?.trim() ?? "",
    invoke: createInvokeDraft(entry?.invoke),
    scope: createScopeDraft(entry?.scope),
    tagsText: Array.isArray(entry?.tags) ? entry.tags.join(", ") : "",
    text: entry?.text?.trim() ?? ""
  }
}

/** 创建一份新的 `ActionDraft` 数据。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function createActionDraft(entry?: Partial<StoryContactActionLibraryEntry>): ContactActionDraft {
  return {
    baseFavorDeltaText: String(entry?.base_favor_delta ?? 0),
    cooldownHoursText: String(entry?.cooldown_hours ?? 0),
    costItemsText: Array.isArray(entry?.cost_items)
      ? entry.cost_items.map((item) => `${item.item_id}:${item.quantity}`).join("\n")
      : "",
    costMoneyText: String(entry?.cost_money ?? 0),
    draftKey: createDraftKey("action"),
    id: entry?.id?.trim() ?? "",
    invoke: createInvokeDraft(entry?.invoke),
    label: entry?.label?.trim() ?? "",
    scope: createScopeDraft(entry?.scope),
    tagsText: Array.isArray(entry?.tags) ? entry.tags.join(", ") : "",
    text: entry?.text?.trim() ?? ""
  }
}

/** 创建一份新的 `ReplyDraft` 数据。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function createReplyDraft(entry?: Partial<StoryContactReplyLibraryEntry>): ContactReplyDraft {
  return {
    draftKey: createDraftKey("reply"),
    id: entry?.id?.trim() ?? "",
    repliesText: Array.isArray(entry?.replies) ? entry.replies.join("\n") : "",
    scope: createScopeDraft(entry?.scope),
    tagsText: Array.isArray(entry?.tags) ? entry.tags.join(", ") : ""
  }
}

/** 创建一份新的 `QuickMessageDraft` 数据。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function createQuickMessageDraft(entry?: Partial<StoryContactQuickMessage>): ContactQuickMessageDraft {
  return {
    availableRoleKeysText: Array.isArray(entry?.available_role_keys) ? entry.available_role_keys.join(", ") : "",
    baseFavorDeltaText: String(entry?.base_favor_delta ?? 1),
    cooldownHoursText: String(entry?.cooldown_hours ?? 0),
    draftKey: createDraftKey("quick-message"),
    id: entry?.id?.trim() ?? "",
    tagsText: Array.isArray(entry?.tags) ? entry.tags.join(", ") : "",
    text: entry?.text?.trim() ?? "",
    visibility: entry?.visibility ?? "suggested-only"
  }
}

/** 创建一份新的 `TagRepliesDraft` 数据。 @param tag 调用方传入的 `tag`。 @param replies 调用方传入的 `replies`。 @returns 计算、查找或构建后的结果。 */
function createTagRepliesDraft(tag = "", replies: string[] = []): ContactTagRepliesDraft {
  return {
    draftKey: createDraftKey("tag-replies"),
    repliesText: replies.join("\n"),
    tag: tag.trim()
  }
}

/** 创建一份新的 `TagRepliesDrafts` 数据。 @param replyMap 调用方传入的 `replyMap`。 @returns 计算、查找或构建后的结果。 */
function createTagRepliesDrafts(replyMap?: Record<string, string[]>): ContactTagRepliesDraft[] {
  return Object.entries(replyMap ?? {}).map(([tag, replies]) => createTagRepliesDraft(tag, replies))
}

/** 创建一份新的 `ProactiveMessageDraft` 数据。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function createProactiveMessageDraft(
  entry?: Partial<StoryContactProactiveMessageRule>
): ContactProactiveMessageDraft {
  return {
    cooldownHoursText: String(entry?.cooldown_hours ?? 24),
    draftKey: createDraftKey("proactive-message"),
    enabled: entry?.enabled ?? true,
    favorDeltaText: String(entry?.favor_delta ?? 0),
    id: entry?.id?.trim() ?? "",
    messagesText: Array.isArray(entry?.messages) ? entry.messages.join("\n") : "",
    replyQuickMessageIds: Array.isArray(entry?.reply_quick_message_ids)
      ? [...entry.reply_quick_message_ids]
      : [],
    triggerExpr: entry?.trigger_expr?.trim() ?? ""
  }
}

/** 创建一份新的 `ContactProfileDraft` 数据。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function createContactProfileDraft(entry?: Partial<StoryContactProfile>): ContactProfileDraft {
  return {
    autoAdd: entry?.auto_add ?? true,
    channelId: entry?.channel_id?.trim() ?? "",
    draftKey: createDraftKey("contact-profile"),
    enabled: entry?.enabled ?? true,
    initialFavorText: String(entry?.initial_favor ?? 20),
    preferredTagsText: Array.isArray(entry?.preferred_tags) ? entry.preferred_tags.join(", ") : "",
    proactiveMessages: (entry?.proactive_messages ?? []).map((rule) => createProactiveMessageDraft(rule)),
    replyByTag: createTagRepliesDrafts(entry?.reply_by_tag),
    roleKey: entry?.role_key?.trim() ?? ""
  }
}

let draftKeySeed = 0

/** 创建一份新的 `DraftKey` 数据。 @param prefix 调用方传入的 `prefix`。 @returns 计算、查找或构建后的结果。 */
function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

/** 创建一份新的 `EmptyDraftState` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyDraftState(): ContactDraftState {
  return {
    actions: [],
    channels: [],
    contactProfiles: [],
    defaultChannelId: "",
    fallbackReplies: [],
    personalities: [],
    quickMessages: [],
    replies: [],
    talks: [],
    tracks: []
  }
}

/** 创建一份新的 `DefaultTrackDraft` 数据。 @param trackId 调用方传入的 `trackId`。 @returns 计算、查找或构建后的结果。 */
function createDefaultTrackDraft(trackId: StoryContactTrackId): ContactTrackDraft {
  return {
    descr: "",
    draftKey: createDraftKey("track"),
    id: trackId,
    name: "",
    stages: [createStageDraft()]
  }
}

/** 根据当前输入构建 `ScopePayload` 结果。 @param scope 调用方传入的 `scope`。 @returns 计算、查找或构建后的结果。 */
function buildScopePayload(scope: ContactScopeDraft) {
  return {
    contact_tracks: Array.from(new Set(scope.contact_tracks.filter((trackId) => trackId !== "none"))),
    max_favor: clampFavor(parseIntegerText(scope.maxFavorText, 100)),
    min_favor: clampFavor(parseIntegerText(scope.minFavorText, 0)),
    personality_ids: Array.from(
      new Set(scope.personalityIds.map((personalityId) => personalityId.trim()).filter(Boolean))
    ),
    role_keys: Array.from(new Set(splitCsvText(scope.roleKeysText)))
  }
}

/** 根据当前输入构建 `InvokePayload` 结果。 @param invoke 调用方传入的 `invoke`。 @returns 计算、查找或构建后的结果。 */
function buildInvokePayload(invoke: ContactInvokeDraft) {
  if (!invoke.enabled || !invoke.eventId.trim()) {
    return undefined
  }

  const payload: NonNullable<StoryContactTalkLibraryEntry["invoke"]> = {
    event_id: invoke.eventId.trim(),
    target_type: invoke.targetType
  }

  if (invoke.delayEnabled) {
    payload.delay = {
      unit: invoke.delayUnit,
      value: Math.max(1, parseIntegerText(invoke.delayValueText, 1))
    }
  }

  return payload
}

/** 根据当前输入构建 `TrackPayload` 结果。 @param track 调用方传入的 `track`。 @returns 计算、查找或构建后的结果。 */
function buildTrackPayload(track: ContactTrackDraft): StoryContactRelationshipTrack {
  return {
    descr: track.descr.trim(),
    id: track.id,
    name: track.name.trim(),
    stages: track.stages.map((stage) => ({
      allow_contact: stage.allowContact,
      descr: stage.descr.trim(),
      id: stage.id.trim(),
      lock_message: stage.lockMessage.trim(),
      max_favor: clampFavor(parseIntegerText(stage.maxFavorText, 100)),
      min_favor: clampFavor(parseIntegerText(stage.minFavorText, 0)),
      name: stage.name.trim(),
      unlock_action_tags: Array.from(new Set(splitCsvText(stage.unlockActionTagsText)))
    }))
  }
}

/** 根据当前输入构建 `TalkPayload` 结果。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function buildTalkPayload(entry: ContactTalkDraft): StoryContactTalkLibraryEntry {
  return {
    base_favor_delta: parseIntegerText(entry.baseFavorDeltaText, 0),
    cooldown_hours: Math.max(0, parseIntegerText(entry.cooldownHoursText, 0)),
    id: entry.id.trim(),
    invoke: buildInvokePayload(entry.invoke),
    scope: buildScopePayload(entry.scope),
    tags: Array.from(new Set(splitCsvText(entry.tagsText))),
    text: entry.text.trim()
  }
}

/** 根据当前输入构建 `ActionPayload` 结果。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function buildActionPayload(entry: ContactActionDraft): StoryContactActionLibraryEntry {
  return {
    base_favor_delta: parseIntegerText(entry.baseFavorDeltaText, 0),
    cooldown_hours: Math.max(0, parseIntegerText(entry.cooldownHoursText, 0)),
    cost_items: splitCsvText(entry.costItemsText)
      .map((row) => {
        const [itemIdPart, quantityPart] = row.split(":")
        const itemId = itemIdPart?.trim() ?? ""
        if (!itemId) {
          return null
        }

        return {
          item_id: itemId,
          quantity: Math.max(1, parseIntegerText(quantityPart ?? "1", 1))
        }
      })
      .filter((item): item is { item_id: string; quantity: number } => Boolean(item)),
    cost_money: Math.max(0, parseNumberText(entry.costMoneyText, 0)),
    id: entry.id.trim(),
    invoke: buildInvokePayload(entry.invoke),
    label: entry.label.trim(),
    scope: buildScopePayload(entry.scope),
    tags: Array.from(new Set(splitCsvText(entry.tagsText))),
    text: entry.text.trim()
  }
}

/** 根据当前输入构建 `ReplyPayload` 结果。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function buildReplyPayload(entry: ContactReplyDraft): StoryContactReplyLibraryEntry {
  return {
    id: entry.id.trim(),
    replies: splitLinesText(entry.repliesText),
    scope: buildScopePayload(entry.scope),
    tags: Array.from(new Set(splitCsvText(entry.tagsText)))
  }
}

/** 根据当前输入构建 `QuickMessagePayload` 结果。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function buildQuickMessagePayload(entry: ContactQuickMessageDraft): StoryContactQuickMessage {
  return {
    available_role_keys: Array.from(new Set(splitCsvText(entry.availableRoleKeysText))),
    base_favor_delta: clampFavor(parseIntegerText(entry.baseFavorDeltaText, 1)),
    cooldown_hours: Math.max(0, parseIntegerText(entry.cooldownHoursText, 0)),
    id: entry.id.trim(),
    tags: Array.from(new Set(splitCsvText(entry.tagsText))),
    text: entry.text.trim(),
    visibility: entry.visibility
  }
}

/** 根据当前输入构建 `RepliesRecordPayload` 结果。 @param entries 调用方传入的 `entries`。 @returns 计算、查找或构建后的结果。 */
function buildRepliesRecordPayload(entries: ContactTagRepliesDraft[]) {
  const replyMap: Record<string, string[]> = {}

  for (const entry of entries) {
    const tag = entry.tag.trim()
    const replies = splitLinesText(entry.repliesText)
    if (!tag || replies.length === 0) {
      continue
    }

    replyMap[tag] = replies
  }

  return replyMap
}

/** 根据当前输入构建 `ProactiveMessagePayload` 结果。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function buildProactiveMessagePayload(entry: ContactProactiveMessageDraft): StoryContactProactiveMessageRule {
  return {
    cooldown_hours: Math.max(1, parseIntegerText(entry.cooldownHoursText, 24)),
    enabled: entry.enabled,
    favor_delta: Math.max(-100, Math.min(100, parseIntegerText(entry.favorDeltaText, 0))),
    id: entry.id.trim(),
    messages: splitLinesText(entry.messagesText),
    reply_quick_message_ids: Array.from(new Set(entry.replyQuickMessageIds.map((id) => id.trim()).filter(Boolean))),
    trigger_expr: entry.triggerExpr.trim()
  }
}

/** 根据当前输入构建 `ContactProfilePayload` 结果。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function buildContactProfilePayload(entry: ContactProfileDraft): StoryContactProfile {
  return {
    auto_add: entry.autoAdd,
    channel_id: entry.channelId.trim(),
    enabled: entry.enabled,
    initial_favor: clampFavor(parseIntegerText(entry.initialFavorText, 20)),
    preferred_tags: Array.from(new Set(splitCsvText(entry.preferredTagsText))),
    proactive_messages: entry.proactiveMessages.map((rule) => buildProactiveMessagePayload(rule)),
    reply_by_tag: buildRepliesRecordPayload(entry.replyByTag),
    role_key: entry.roleKey.trim()
  }
}

/** 组合 `StoryContactDraft` 的响应式状态、派生值和操作方法。 @param source 调用方传入的 `source`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useStoryContactDraft(source: StoryContactFile) {
  const draft = reactive(createEmptyDraftState())
  const { addChannel, removeChannel, renameChannel } = createStoryContactChannelActions(
    draft,
    createDraftKey
  )

  /** 把外部或服务端数据同步到本地响应式状态。 @param contact 调用方传入的 `contact`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function syncFromContact(contact: StoryContactFile) {
    draft.defaultChannelId = contact.default_channel_id
    draft.channels = contact.channels.map((channel) => ({
      draftKey: createDraftKey("channel"),
      id: channel.id,
      labels: {
        message: channel.labels.message ?? "",
        conversation: channel.labels.conversation ?? "",
        talk: channel.labels.talk ?? "",
        action: channel.labels.action ?? "",
        gift: channel.labels.gift ?? "",
        send: channel.labels.send ?? "",
        reply: channel.labels.reply ?? ""
      },
      name: channel.name,
      preset: channel.preset
    }))
    draft.tracks = (contact.relationship_tracks ?? []).map((track) => ({
      descr: track.descr,
      draftKey: createDraftKey("track"),
      id: track.id,
      name: track.name,
      stages: (track.stages ?? []).map((stage) => createStageDraft(stage))
    }))

    draft.personalities = (contact.personality_library ?? []).map((personality) => ({
      descr: personality.descr,
      draftKey: createDraftKey("personality"),
      id: personality.id,
      name: personality.name,
      styleTagsText: Array.isArray(personality.style_tags) ? personality.style_tags.join(", ") : ""
    }))

    draft.talks = (contact.talk_library ?? []).map((entry) => createTalkDraft(entry))
    draft.actions = (contact.action_library ?? []).map((entry) => createActionDraft(entry))
    draft.replies = (contact.reply_library ?? []).map((entry) => createReplyDraft(entry))
    draft.quickMessages = (contact.player_quick_messages ?? []).map((entry) => createQuickMessageDraft(entry))
    draft.contactProfiles = (contact.contact_profiles ?? []).map((entry) => createContactProfileDraft(entry))
    draft.fallbackReplies = createTagRepliesDrafts(contact.fallback_replies)
  }

  /** 根据当前输入构建 `ContactFile` 结果。 @returns 计算、查找或构建后的结果。 */
  function buildContactFile(): StoryContactFile {
    return {
      action_library: draft.actions.map((entry) => buildActionPayload(entry)),
      channels: draft.channels.map((channel) => ({
        id: channel.id.trim(),
        labels: Object.fromEntries(
          Object.entries(channel.labels)
            .map(([key, value]) => [key, value.trim()] as const)
            .filter((entry): entry is [string, string] => Boolean(entry[1]))
        ),
        name: channel.name.trim(),
        preset: channel.preset
      })),
      contact_profiles: draft.contactProfiles.map((entry) => buildContactProfilePayload(entry)),
      default_channel_id: draft.defaultChannelId.trim(),
      fallback_replies: buildRepliesRecordPayload(draft.fallbackReplies),
      personality_library: draft.personalities.map((personality) => ({
        descr: personality.descr.trim(),
        id: personality.id.trim(),
        name: personality.name.trim(),
        style_tags: Array.from(new Set(splitCsvText(personality.styleTagsText)))
      })),
      player_quick_messages: draft.quickMessages.map((entry) => buildQuickMessagePayload(entry)),
      relationship_tracks: draft.tracks.map((track) => buildTrackPayload(track)),
      reply_library: draft.replies.map((entry) => buildReplyPayload(entry)),
      talk_library: draft.talks.map((entry) => buildTalkPayload(entry))
    }
  }

  /** 新增一项 `Track` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addTrack() {
    const existingIds = new Set(draft.tracks.map((track) => track.id))
    const nextTrackId = AVAILABLE_CONTACT_TRACK_IDS.find((trackId) => !existingIds.has(trackId))
    if (!nextTrackId) {
      return
    }

    draft.tracks.push(createDefaultTrackDraft(nextTrackId))
  }

  /** 移除指定的 `Track` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeTrack(index: number) {
    draft.tracks.splice(index, 1)
  }

  /** 新增一项 `TrackStage` 草稿。 @param track 调用方传入的 `track`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addTrackStage(track: ContactTrackDraft) {
    track.stages.push(createStageDraft())
  }

  /** 移除指定的 `TrackStage` 数据。 @param track 调用方传入的 `track`。 @param stageIndex 调用方传入的 `stageIndex`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeTrackStage(track: ContactTrackDraft, stageIndex: number) {
    track.stages.splice(stageIndex, 1)
  }

  /** 新增一项 `Personality` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addPersonality() {
    draft.personalities.push({
      descr: "",
      draftKey: createDraftKey("personality"),
      id: "",
      name: "",
      styleTagsText: ""
    })
  }

  /** 移除指定的 `Personality` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removePersonality(index: number) {
    draft.personalities.splice(index, 1)
  }

  /** 新增一项 `Talk` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addTalk() {
    draft.talks.push(createTalkDraft())
  }

  /** 移除指定的 `Talk` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeTalk(index: number) {
    draft.talks.splice(index, 1)
  }

  /** 新增一项 `Action` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addAction() {
    draft.actions.push(createActionDraft())
  }

  /** 移除指定的 `Action` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeAction(index: number) {
    draft.actions.splice(index, 1)
  }

  /** 新增一项 `Reply` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addReply() {
    draft.replies.push(createReplyDraft())
  }

  /** 移除指定的 `Reply` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeReply(index: number) {
    draft.replies.splice(index, 1)
  }

  /** 新增一项 `QuickMessage` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addQuickMessage() {
    draft.quickMessages.push(createQuickMessageDraft())
  }

  /** 移除指定的 `QuickMessage` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeQuickMessage(index: number) {
    draft.quickMessages.splice(index, 1)
  }

  /** 新增一项 `ContactProfile` 草稿。 @param roleKey 调用方传入的 `roleKey`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addContactProfile(roleKey = "") {
    draft.contactProfiles.push(createContactProfileDraft({ role_key: roleKey }))
  }

  /** 移除指定的 `ContactProfile` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeContactProfile(index: number) {
    draft.contactProfiles.splice(index, 1)
  }

  /** 新增一项 `ContactReply` 草稿。 @param profile 调用方传入的 `profile`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addContactReply(profile: ContactProfileDraft) {
    profile.replyByTag.push(createTagRepliesDraft())
  }

  /** 移除指定的 `ContactReply` 数据。 @param profile 调用方传入的 `profile`。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeContactReply(profile: ContactProfileDraft, index: number) {
    profile.replyByTag.splice(index, 1)
  }

  /** 新增一项 `ProactiveMessage` 草稿。 @param profile 调用方传入的 `profile`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addProactiveMessage(profile: ContactProfileDraft) {
    profile.proactiveMessages.push(createProactiveMessageDraft())
  }

  /** 移除指定的 `ProactiveMessage` 数据。 @param profile 调用方传入的 `profile`。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeProactiveMessage(profile: ContactProfileDraft, index: number) {
    profile.proactiveMessages.splice(index, 1)
  }

  /** 新增一项 `FallbackReply` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addFallbackReply() {
    draft.fallbackReplies.push(createTagRepliesDraft())
  }

  /** 移除指定的 `FallbackReply` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeFallbackReply(index: number) {
    draft.fallbackReplies.splice(index, 1)
  }

  syncFromContact(source)

  return {
    addAction,
    addChannel,
    addContactProfile,
    addContactReply,
    addFallbackReply,
    addPersonality,
    addProactiveMessage,
    addQuickMessage,
    addReply,
    addTalk,
    addTrack,
    addTrackStage,
    buildContactFile,
    draft,
    removeAction,
    removeChannel,
    removeContactProfile,
    removeContactReply,
    removeFallbackReply,
    removePersonality,
    removeProactiveMessage,
    removeQuickMessage,
    renameChannel,
    removeReply,
    removeTalk,
    removeTrack,
    removeTrackStage,
    syncFromContact
  }
}
