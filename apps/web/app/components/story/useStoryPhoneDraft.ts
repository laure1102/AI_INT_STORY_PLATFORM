import { reactive } from "vue"
import type {
  StoryPhoneActionLibraryEntry,
  StoryPhoneContactProfile,
  StoryPhoneContactTrackId,
  StoryPhoneFile,
  StoryPhoneProactiveMessageRule,
  StoryPhoneQuickMessage,
  StoryPhoneReplyLibraryEntry,
  StoryPhoneRelationshipStage,
  StoryPhoneRelationshipTrack,
  StoryPhoneTalkLibraryEntry
} from "@story-mgr/core"

type InvokeTargetType = "chain" | "pool" | "schedule"
type DelayUnit = "hours" | "days" | "months" | "years"

interface PhoneScopeDraft {
  contact_tracks: StoryPhoneContactTrackId[]
  maxFavorText: string
  minFavorText: string
  personalityIds: string[]
  roleKeysText: string
}

interface PhoneInvokeDraft {
  delayEnabled: boolean
  delayUnit: DelayUnit
  delayValueText: string
  enabled: boolean
  eventId: string
  targetType: InvokeTargetType
}

export interface PhoneTrackStageDraft {
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

export interface PhoneTrackDraft {
  descr: string
  draftKey: string
  id: StoryPhoneContactTrackId
  name: string
  stages: PhoneTrackStageDraft[]
}

export interface PhonePersonalityDraft {
  descr: string
  draftKey: string
  id: string
  name: string
  styleTagsText: string
}

export interface PhoneTalkDraft {
  baseFavorDeltaText: string
  cooldownHoursText: string
  draftKey: string
  id: string
  invoke: PhoneInvokeDraft
  scope: PhoneScopeDraft
  tagsText: string
  text: string
}

export interface PhoneActionDraft {
  baseFavorDeltaText: string
  cooldownHoursText: string
  costItemsText: string
  costMoneyText: string
  draftKey: string
  id: string
  invoke: PhoneInvokeDraft
  label: string
  scope: PhoneScopeDraft
  tagsText: string
  text: string
}

export interface PhoneReplyDraft {
  draftKey: string
  id: string
  repliesText: string
  scope: PhoneScopeDraft
  tagsText: string
}

export interface PhoneQuickMessageDraft {
  availableRoleKeysText: string
  baseFavorDeltaText: string
  cooldownHoursText: string
  draftKey: string
  id: string
  tagsText: string
  text: string
  visibility: "always" | "suggested-only"
}

export interface PhoneTagRepliesDraft {
  draftKey: string
  repliesText: string
  tag: string
}

export interface PhoneProactiveMessageDraft {
  cooldownHoursText: string
  draftKey: string
  enabled: boolean
  favorDeltaText: string
  id: string
  messagesText: string
  replyQuickMessageIds: string[]
  triggerExpr: string
}

export interface PhoneContactProfileDraft {
  autoAdd: boolean
  draftKey: string
  enabled: boolean
  initialFavorText: string
  preferredTagsText: string
  proactiveMessages: PhoneProactiveMessageDraft[]
  replyByTag: PhoneTagRepliesDraft[]
  roleKey: string
}

interface PhoneDraftState {
  actions: PhoneActionDraft[]
  contactProfiles: PhoneContactProfileDraft[]
  fallbackReplies: PhoneTagRepliesDraft[]
  personalities: PhonePersonalityDraft[]
  quickMessages: PhoneQuickMessageDraft[]
  replies: PhoneReplyDraft[]
  talks: PhoneTalkDraft[]
  tracks: PhoneTrackDraft[]
}

const AVAILABLE_CONTACT_TRACK_IDS: StoryPhoneContactTrackId[] = ["romance", "official", "social"]

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function splitCsvText(value: string) {
  return value
    .split(/[,\n，、]/g)
    .map((part) => part.trim())
    .filter(Boolean)
}

function splitLinesText(value: string) {
  return value
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseIntegerText(value: string, fallback: number) {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseNumberText(value: string, fallback: number) {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampFavor(value: number) {
  return Math.max(0, Math.min(100, Math.trunc(value)))
}

function createScopeDraft(
  scope?: Partial<StoryPhoneTalkLibraryEntry["scope"]>
): PhoneScopeDraft {
  return {
    contact_tracks: Array.isArray(scope?.contact_tracks) ? [...scope.contact_tracks] : [],
    maxFavorText: String(scope?.max_favor ?? 100),
    minFavorText: String(scope?.min_favor ?? 0),
    personalityIds: Array.isArray(scope?.personality_ids) ? [...scope.personality_ids] : [],
    roleKeysText: Array.isArray(scope?.role_keys) ? scope.role_keys.join(", ") : ""
  }
}

function createInvokeDraft(
  invoke?: Partial<NonNullable<StoryPhoneTalkLibraryEntry["invoke"]>>
): PhoneInvokeDraft {
  return {
    delayEnabled: Boolean(invoke?.delay),
    delayUnit: invoke?.delay?.unit ?? "hours",
    delayValueText: invoke?.delay ? String(invoke.delay.value) : "1",
    enabled: Boolean(invoke),
    eventId: invoke?.event_id?.trim() ?? "",
    targetType: invoke?.target_type ?? "chain"
  }
}

function createStageDraft(stage?: Partial<StoryPhoneRelationshipStage>): PhoneTrackStageDraft {
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

function createTalkDraft(entry?: Partial<StoryPhoneTalkLibraryEntry>): PhoneTalkDraft {
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

function createActionDraft(entry?: Partial<StoryPhoneActionLibraryEntry>): PhoneActionDraft {
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

function createReplyDraft(entry?: Partial<StoryPhoneReplyLibraryEntry>): PhoneReplyDraft {
  return {
    draftKey: createDraftKey("reply"),
    id: entry?.id?.trim() ?? "",
    repliesText: Array.isArray(entry?.replies) ? entry.replies.join("\n") : "",
    scope: createScopeDraft(entry?.scope),
    tagsText: Array.isArray(entry?.tags) ? entry.tags.join(", ") : ""
  }
}

function createQuickMessageDraft(entry?: Partial<StoryPhoneQuickMessage>): PhoneQuickMessageDraft {
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

function createTagRepliesDraft(tag = "", replies: string[] = []): PhoneTagRepliesDraft {
  return {
    draftKey: createDraftKey("tag-replies"),
    repliesText: replies.join("\n"),
    tag: tag.trim()
  }
}

function createTagRepliesDrafts(replyMap?: Record<string, string[]>): PhoneTagRepliesDraft[] {
  return Object.entries(replyMap ?? {}).map(([tag, replies]) => createTagRepliesDraft(tag, replies))
}

function createProactiveMessageDraft(
  entry?: Partial<StoryPhoneProactiveMessageRule>
): PhoneProactiveMessageDraft {
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

function createContactProfileDraft(entry?: Partial<StoryPhoneContactProfile>): PhoneContactProfileDraft {
  return {
    autoAdd: entry?.auto_add ?? true,
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

function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

function createEmptyDraftState(): PhoneDraftState {
  return {
    actions: [],
    contactProfiles: [],
    fallbackReplies: [],
    personalities: [],
    quickMessages: [],
    replies: [],
    talks: [],
    tracks: []
  }
}

function createDefaultTrackDraft(trackId: StoryPhoneContactTrackId): PhoneTrackDraft {
  return {
    descr: "",
    draftKey: createDraftKey("track"),
    id: trackId,
    name: "",
    stages: [createStageDraft()]
  }
}

function buildScopePayload(scope: PhoneScopeDraft) {
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

function buildInvokePayload(invoke: PhoneInvokeDraft) {
  if (!invoke.enabled || !invoke.eventId.trim()) {
    return undefined
  }

  const payload: NonNullable<StoryPhoneTalkLibraryEntry["invoke"]> = {
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

function buildTrackPayload(track: PhoneTrackDraft): StoryPhoneRelationshipTrack {
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

function buildTalkPayload(entry: PhoneTalkDraft): StoryPhoneTalkLibraryEntry {
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

function buildActionPayload(entry: PhoneActionDraft): StoryPhoneActionLibraryEntry {
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

function buildReplyPayload(entry: PhoneReplyDraft): StoryPhoneReplyLibraryEntry {
  return {
    id: entry.id.trim(),
    replies: splitLinesText(entry.repliesText),
    scope: buildScopePayload(entry.scope),
    tags: Array.from(new Set(splitCsvText(entry.tagsText)))
  }
}

function buildQuickMessagePayload(entry: PhoneQuickMessageDraft): StoryPhoneQuickMessage {
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

function buildRepliesRecordPayload(entries: PhoneTagRepliesDraft[]) {
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

function buildProactiveMessagePayload(entry: PhoneProactiveMessageDraft): StoryPhoneProactiveMessageRule {
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

function buildContactProfilePayload(entry: PhoneContactProfileDraft): StoryPhoneContactProfile {
  return {
    auto_add: entry.autoAdd,
    enabled: entry.enabled,
    initial_favor: clampFavor(parseIntegerText(entry.initialFavorText, 20)),
    preferred_tags: Array.from(new Set(splitCsvText(entry.preferredTagsText))),
    proactive_messages: entry.proactiveMessages.map((rule) => buildProactiveMessagePayload(rule)),
    reply_by_tag: buildRepliesRecordPayload(entry.replyByTag),
    role_key: entry.roleKey.trim()
  }
}

export function useStoryPhoneDraft(source: StoryPhoneFile) {
  const draft = reactive(createEmptyDraftState())

  function syncFromPhone(phone: StoryPhoneFile) {
    draft.tracks = (phone.relationship_tracks ?? []).map((track) => ({
      descr: track.descr,
      draftKey: createDraftKey("track"),
      id: track.id,
      name: track.name,
      stages: (track.stages ?? []).map((stage) => createStageDraft(stage))
    }))

    draft.personalities = (phone.personality_library ?? []).map((personality) => ({
      descr: personality.descr,
      draftKey: createDraftKey("personality"),
      id: personality.id,
      name: personality.name,
      styleTagsText: Array.isArray(personality.style_tags) ? personality.style_tags.join(", ") : ""
    }))

    draft.talks = (phone.talk_library ?? []).map((entry) => createTalkDraft(entry))
    draft.actions = (phone.action_library ?? []).map((entry) => createActionDraft(entry))
    draft.replies = (phone.reply_library ?? []).map((entry) => createReplyDraft(entry))
    draft.quickMessages = (phone.player_quick_messages ?? []).map((entry) => createQuickMessageDraft(entry))
    draft.contactProfiles = (phone.contact_profiles ?? []).map((entry) => createContactProfileDraft(entry))
    draft.fallbackReplies = createTagRepliesDrafts(phone.fallback_replies)
  }

  function buildPhoneFile(): StoryPhoneFile {
    return {
      action_library: draft.actions.map((entry) => buildActionPayload(entry)),
      contact_profiles: draft.contactProfiles.map((entry) => buildContactProfilePayload(entry)),
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

  function addTrack() {
    const existingIds = new Set(draft.tracks.map((track) => track.id))
    const nextTrackId = AVAILABLE_CONTACT_TRACK_IDS.find((trackId) => !existingIds.has(trackId))
    if (!nextTrackId) {
      return
    }

    draft.tracks.push(createDefaultTrackDraft(nextTrackId))
  }

  function removeTrack(index: number) {
    draft.tracks.splice(index, 1)
  }

  function addTrackStage(track: PhoneTrackDraft) {
    track.stages.push(createStageDraft())
  }

  function removeTrackStage(track: PhoneTrackDraft, stageIndex: number) {
    track.stages.splice(stageIndex, 1)
  }

  function addPersonality() {
    draft.personalities.push({
      descr: "",
      draftKey: createDraftKey("personality"),
      id: "",
      name: "",
      styleTagsText: ""
    })
  }

  function removePersonality(index: number) {
    draft.personalities.splice(index, 1)
  }

  function addTalk() {
    draft.talks.push(createTalkDraft())
  }

  function removeTalk(index: number) {
    draft.talks.splice(index, 1)
  }

  function addAction() {
    draft.actions.push(createActionDraft())
  }

  function removeAction(index: number) {
    draft.actions.splice(index, 1)
  }

  function addReply() {
    draft.replies.push(createReplyDraft())
  }

  function removeReply(index: number) {
    draft.replies.splice(index, 1)
  }

  function addQuickMessage() {
    draft.quickMessages.push(createQuickMessageDraft())
  }

  function removeQuickMessage(index: number) {
    draft.quickMessages.splice(index, 1)
  }

  function addContactProfile(roleKey = "") {
    draft.contactProfiles.push(createContactProfileDraft({ role_key: roleKey }))
  }

  function removeContactProfile(index: number) {
    draft.contactProfiles.splice(index, 1)
  }

  function addContactReply(profile: PhoneContactProfileDraft) {
    profile.replyByTag.push(createTagRepliesDraft())
  }

  function removeContactReply(profile: PhoneContactProfileDraft, index: number) {
    profile.replyByTag.splice(index, 1)
  }

  function addProactiveMessage(profile: PhoneContactProfileDraft) {
    profile.proactiveMessages.push(createProactiveMessageDraft())
  }

  function removeProactiveMessage(profile: PhoneContactProfileDraft, index: number) {
    profile.proactiveMessages.splice(index, 1)
  }

  function addFallbackReply() {
    draft.fallbackReplies.push(createTagRepliesDraft())
  }

  function removeFallbackReply(index: number) {
    draft.fallbackReplies.splice(index, 1)
  }

  syncFromPhone(source)

  return {
    addAction,
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
    buildPhoneFile,
    draft,
    removeAction,
    removeContactProfile,
    removeContactReply,
    removeFallbackReply,
    removePersonality,
    removeProactiveMessage,
    removeQuickMessage,
    removeReply,
    removeTalk,
    removeTrack,
    removeTrackStage,
    syncFromPhone
  }
}
