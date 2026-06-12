import { reactive } from "vue"
import type {
  StoryPhoneActionLibraryEntry,
  StoryPhoneContactTrackId,
  StoryPhoneFile,
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

interface PhoneDraftState {
  actions: PhoneActionDraft[]
  personalities: PhonePersonalityDraft[]
  replies: PhoneReplyDraft[]
  talks: PhoneTalkDraft[]
  tracks: PhoneTrackDraft[]
}

interface PhoneLegacySections {
  contact_profiles: StoryPhoneFile["contact_profiles"]
  fallback_replies: StoryPhoneFile["fallback_replies"]
  player_quick_messages: StoryPhoneFile["player_quick_messages"]
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

let draftKeySeed = 0

function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

function createEmptyDraftState(): PhoneDraftState {
  return {
    actions: [],
    personalities: [],
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
    replies: entry.repliesText
      .split(/\n+/g)
      .map((line) => line.trim())
      .filter(Boolean),
    scope: buildScopePayload(entry.scope),
    tags: Array.from(new Set(splitCsvText(entry.tagsText)))
  }
}

export function useStoryPhoneDraft(source: StoryPhoneFile) {
  const draft = reactive(createEmptyDraftState())
  let legacySections: PhoneLegacySections = {
    contact_profiles: [],
    fallback_replies: {},
    player_quick_messages: []
  }

  function syncFromPhone(phone: StoryPhoneFile) {
    legacySections = {
      contact_profiles: clonePlain(phone.contact_profiles ?? []),
      fallback_replies: clonePlain(phone.fallback_replies ?? {}),
      player_quick_messages: clonePlain(phone.player_quick_messages ?? [])
    }

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
  }

  function buildPhoneFile(): StoryPhoneFile {
    return {
      action_library: draft.actions.map((entry) => buildActionPayload(entry)),
      contact_profiles: clonePlain(legacySections.contact_profiles),
      fallback_replies: clonePlain(legacySections.fallback_replies),
      personality_library: draft.personalities.map((personality) => ({
        descr: personality.descr.trim(),
        id: personality.id.trim(),
        name: personality.name.trim(),
        style_tags: Array.from(new Set(splitCsvText(personality.styleTagsText)))
      })),
      player_quick_messages: clonePlain(legacySections.player_quick_messages),
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

  syncFromPhone(source)

  return {
    addAction,
    addPersonality,
    addReply,
    addTalk,
    addTrack,
    addTrackStage,
    buildPhoneFile,
    draft,
    removeAction,
    removePersonality,
    removeReply,
    removeTalk,
    removeTrack,
    removeTrackStage,
    syncFromPhone
  }
}
