/**
 * 联系人配置、媒介、联系人元信息与初始背包。
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
import type { RuntimeBagEntry, RuntimeBagsState, RuntimeContactChannelLabels, RuntimeContactChannelPreset, RuntimeContactTrackId, RuntimeStoryContactChannel, RuntimeStoryContactConversationDefinition, RuntimeStoryContactConversationsFile, RuntimeStoryContactFile, RuntimeStoryContactLibraryScope, RuntimeStoryContactRelationshipStage, RuntimeStorySessionSnapshot } from "./contracts-core"
import type { RuntimeResolvedContactMeta, RuntimeStoryBundle } from "./contracts-view"
import { DEFAULT_CONTACT_RELATIONSHIP_TRACKS } from "./contracts-view"
import { getBundleItemIds } from "./doing-shop"
import { findRoleLabel, getBundleRoles, getContactProactiveRulesForContact, getContactThread } from "./contact-threads"
import { clampContactFavor, cloneValue, createDefaultBagsState, createDefaultContactConfig, createDefaultContactConversationsConfig, normalizeBagQuantity, normalizeItemId, normalizeOwnerId, normalizeContactTrackId, normalizeContactConversationHistoryState, normalizeContactRoleKey, normalizeText } from "./state-values"

/**
 * 读取并补齐 bundle 联系人配置中的媒介和资料库数组。
 * @param bundle 编译故事。 @returns 可安全遍历的关系、人格、话题、动作、联系人和主动消息配置。
 */
export function getBundleContactConfig(bundle: RuntimeStoryBundle): RuntimeStoryContactFile {
  const rawConfig = bundle.contact ?? createDefaultContactConfig()
  const fallbackChannel: RuntimeStoryContactChannel = {
    id: "generic",
    name: "通用往来",
    preset: "generic",
    labels: {}
  }
  const channels = Array.isArray(rawConfig.channels) && rawConfig.channels.length > 0
    ? rawConfig.channels
    : [fallbackChannel]
  const defaultChannelId = channels.some((channel) => channel.id === rawConfig.default_channel_id)
    ? rawConfig.default_channel_id
    : channels[0]!.id
  return {
    default_channel_id: defaultChannelId,
    channels,
    relationship_tracks: Array.isArray(rawConfig.relationship_tracks)
      ? rawConfig.relationship_tracks
      : cloneValue(DEFAULT_CONTACT_RELATIONSHIP_TRACKS),
    personality_library: Array.isArray(rawConfig.personality_library)
      ? rawConfig.personality_library
      : [],
    talk_library: Array.isArray(rawConfig.talk_library)
      ? rawConfig.talk_library
      : [],
    action_library: Array.isArray(rawConfig.action_library)
      ? rawConfig.action_library
      : [],
    reply_library: Array.isArray(rawConfig.reply_library)
      ? rawConfig.reply_library
      : [],
    player_quick_messages: Array.isArray(rawConfig.player_quick_messages)
      ? rawConfig.player_quick_messages
      : [],
    contact_profiles: Array.isArray(rawConfig.contact_profiles)
      ? rawConfig.contact_profiles.map((profile) => ({ ...profile, channel_id: profile.channel_id ?? "" }))
      : [],
    fallback_replies: rawConfig.fallback_replies && typeof rawConfig.fallback_replies === "object"
      ? rawConfig.fallback_replies
      : {}
  }
}

const CONTACT_CHANNEL_LABELS: Record<RuntimeContactChannelPreset, Required<RuntimeContactChannelLabels>> = {
  generic: { message: "消息", conversation: "联系人剧情", talk: "交谈", action: "互动", gift: "赠礼", send: "发送", reply: "回复" },
  phone: { message: "消息", conversation: "聊天剧情", talk: "说话", action: "动作", gift: "赠礼", send: "发送", reply: "回复" },
  letter: { message: "信件", conversation: "书信剧情", talk: "写信", action: "托付", gift: "赠礼", send: "寄出", reply: "回信" },
  transmission: { message: "传讯", conversation: "传讯剧情", talk: "传讯", action: "施术", gift: "赠礼", send: "发出", reply: "回应" }
}

/** @param bundle 编译故事。 @param roleKey 联系人角色键。 @returns 已合并预设文案的联系人媒介。 */
export function resolveContactChannel(bundle: RuntimeStoryBundle, roleKey: string) {
  const config = getBundleContactConfig(bundle)
  const profile = getBundleContactProfile(bundle, roleKey)
  const channelId = profile?.channel_id || config.default_channel_id
  const channel = config.channels.find((entry) => entry.id === channelId)
    ?? config.channels.find((entry) => entry.id === config.default_channel_id)
    ?? config.channels[0]!
  return {
    id: channel.id,
    name: channel.name,
    preset: channel.preset,
    labels: { ...CONTACT_CHANNEL_LABELS[channel.preset], ...channel.labels }
  }
}

/** @param bundle 编译故事。 @returns conversations 数组已补齐的结构化联系人剧情配置。 */
export function getBundleContactConversationsConfig(bundle: RuntimeStoryBundle): RuntimeStoryContactConversationsFile {
  const rawConfig = bundle.contactConversations ?? createDefaultContactConversationsConfig()
  return {
    conversations: Array.isArray(rawConfig.conversations) ? rawConfig.conversations : []
  }
}

/** @param bundle 编译故事。 @returns 玩家可直接发送的快捷消息定义数组。 */
export function getBundleContactQuickMessages(bundle: RuntimeStoryBundle) {
  return getBundleContactConfig(bundle).player_quick_messages ?? []
}

/** @param bundle 编译故事。 @param conversationId 会话 id。 @returns 对应结构化会话，不存在时为 null。 */
export function findBundleContactConversation(bundle: RuntimeStoryBundle, conversationId: string) {
  const normalizedConversationId = normalizeText(conversationId)
  if (!normalizedConversationId) {
    return null
  }

  return getBundleContactConversationsConfig(bundle).conversations.find(
    (conversation) => normalizeText(conversation.id) === normalizedConversationId
  ) ?? null
}

/** @param conversation 会话定义。 @param nodeId 节点 id。 @returns 对应节点，会话/id 为空或不存在时为 null。 */
export function findContactConversationNode(
  conversation: RuntimeStoryContactConversationDefinition | null | undefined,
  nodeId: string
) {
  const normalizedNodeId = normalizeText(nodeId)
  if (!conversation || !normalizedNodeId) {
    return null
  }

  return conversation.nodes.find((node) => normalizeText(node.id) === normalizedNodeId) ?? null
}

/** @param snapshot 会话快照。 @param conversationId 结构化会话 id。 @returns 历史中是否已有该会话的 completed 状态。 */
export function hasFinishedContactConversation(
  snapshot: RuntimeStorySessionSnapshot,
  conversationId: string
) {
  const normalizedConversationId = normalizeText(conversationId)
  if (!normalizedConversationId) {
    return false
  }

  snapshot.contact_conversations = normalizeContactConversationHistoryState(snapshot.contact_conversations)
  return snapshot.contact_conversations.some(
    (state) => state.conversation_id === normalizedConversationId && state.finished
  )
}

/** @param bundle 编译故事。 @param roleKey 联系人角色键。 @returns 联系人专用资料，不存在时为 null。 */
export function getBundleContactProfile(bundle: RuntimeStoryBundle, roleKey: string) {
  const normalizedRoleKey = normalizeContactRoleKey(roleKey)
  if (!normalizedRoleKey) {
    return null
  }

  return getBundleContactConfig(bundle).contact_profiles.find(
    (profile) => profile.role_key.trim() === normalizedRoleKey
  ) ?? null
}

/** @param bundle 编译故事。 @param roleKey `normal:id` 或 `important:id`。 @returns 对应角色定义，格式/目标无效时为 null。 */
export function findBundleRoleDefinition(bundle: RuntimeStoryBundle, roleKey: string) {
  const [scope, roleId] = normalizeContactRoleKey(roleKey).split(":")
  if (!scope || !roleId) {
    return null
  }

  const roles = getBundleRoles(bundle)
  return scope === "important"
    ? roles.important.find((item) => item.id === roleId) ?? null
    : scope === "normal"
      ? roles.normal.find((item) => item.id === roleId) ?? null
      : null
}

/** @param bundle 编译故事。 @param trackId 关系轨道 id。 @returns romance/official/social 轨道定义；none 或缺失时为 null。 */
export function getBundleContactRelationshipTrack(
  bundle: RuntimeStoryBundle,
  trackId: RuntimeContactTrackId
) {
  const normalizedTrackId = normalizeContactTrackId(trackId)
  if (normalizedTrackId === "none") {
    return null
  }

  const configuredTrack = getBundleContactConfig(bundle).relationship_tracks.find(
    (track) => track.id === normalizedTrackId
  )
  if (configuredTrack) {
    return configuredTrack
  }

  return DEFAULT_CONTACT_RELATIONSHIP_TRACKS.find((track) => track.id === normalizedTrackId)
    ?? DEFAULT_CONTACT_RELATIONSHIP_TRACKS.find((track) => track.id === "social")
    ?? null
}

/** @param bundle 编译故事。 @param personalityId 人格模板 id。 @returns 对应人格定义，不存在时为 null。 */
export function getBundleContactPersonality(
  bundle: RuntimeStoryBundle,
  personalityId: string
) {
  const normalizedPersonalityId = normalizeText(personalityId)
  if (!normalizedPersonalityId) {
    return null
  }

  return getBundleContactConfig(bundle).personality_library.find(
    (entry) => entry.id.trim() === normalizedPersonalityId
  ) ?? null
}

/**
 * 根据关系轨道与当前好感度选择所处阶段。
 * @param bundle 编译故事。 @param trackId 关系轨道。 @param favor 0–100 好感度。 @returns 当前阶段及规范轨道信息。
 * 没有轨道时返回默认阶段；有轨道时选择 `min_favor` 不超过当前好感且门槛最高的一项。
 */
export function resolveContactRelationshipStage(
  bundle: RuntimeStoryBundle,
  trackId: RuntimeContactTrackId,
  favor: number
) {
  const track = getBundleContactRelationshipTrack(bundle, trackId)
  if (!track) {
    return {
      id: "default",
      name: "默认",
      descr: "",
      min_favor: 0,
      max_favor: 100,
      allow_contact: true,
      lock_message: "",
      unlock_action_tags: []
    } satisfies RuntimeStoryContactRelationshipStage
  }

  const normalizedFavor = clampContactFavor(favor, 20)
  const matchedStage = track.stages.find(
    (stage) => normalizedFavor >= stage.min_favor && normalizedFavor <= stage.max_favor
  )
  if (matchedStage) {
    return matchedStage
  }

  return track.stages
    .slice()
    .sort((left, right) => left.min_favor - right.min_favor)
    .find((stage) => normalizedFavor <= stage.max_favor)
    ?? track.stages[track.stages.length - 1]
    ?? {
      id: "default",
      name: track.name,
      descr: track.descr,
      min_favor: 0,
      max_favor: 100,
      allow_contact: true,
      lock_message: "",
      unlock_action_tags: []
    }
}

/**
 * 汇总一个联系人的角色资料、媒介档案、人格和关系阶段。
 * @param bundle 编译故事。 @param roleKey 联系人角色键。 @param favor 当前好感度。 @returns 供话题/动作筛选复用的元数据。
 */
export function buildRuntimeContactMeta(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  favor: number
): RuntimeResolvedContactMeta {
  const normalizedRoleKey = normalizeContactRoleKey(roleKey)
  const roleDefinition = findBundleRoleDefinition(bundle, normalizedRoleKey)
  const profile = getBundleContactProfile(bundle, normalizedRoleKey)
  const roleEnabled = Boolean(roleDefinition?.contact_enabled)
  const roleTrack = normalizeContactTrackId(roleDefinition?.contact_track)
  const inferredEnabled = roleEnabled || roleTrack !== "none" || Boolean(profile?.enabled)
  const enabled = profile ? Boolean(profile.enabled) : inferredEnabled
  const autoAdd = profile ? Boolean(profile.auto_add) : enabled
  const initialFavor = clampContactFavor(
    profile?.initial_favor ?? roleDefinition?.contact_initial_favor ?? 20,
    20
  )
  const personalityId = normalizeText(roleDefinition?.xingge_id)
  const personalityDefinition = getBundleContactPersonality(bundle, personalityId)
  const trackId = roleTrack !== "none"
    ? roleTrack
    : enabled
      ? "social"
      : "none"
  const track = getBundleContactRelationshipTrack(bundle, trackId)
  const relationStage = resolveContactRelationshipStage(bundle, trackId, favor)
  const personalityLabel = normalizeText(personalityDefinition?.name)
    || personalityId
    || normalizeText(roleDefinition?.xingge_note)
    || ""
  const canContact = enabled && relationStage.allow_contact
  const lockMessage = canContact
    ? null
    : normalizeText(relationStage.lock_message) || (enabled ? "当前无法主动联系。" : "当前还未成为联系人。")
  const channel = resolveContactChannel(bundle, normalizedRoleKey)

  return {
    roleKey: normalizedRoleKey,
    label: findRoleLabel(bundle, normalizedRoleKey),
    enabled,
    autoAdd,
    favor: clampContactFavor(favor, initialFavor),
    initialFavor,
    trackId,
    trackLabel: normalizeText(track?.name) || "社交关系",
    stageId: normalizeText(relationStage.id) || "default",
    stageLabel: normalizeText(relationStage.name) || "默认",
    canContact,
    lockMessage,
    personalityId,
    personalityLabel,
    channelId: channel.id,
    channelName: channel.name,
    channelPreset: channel.preset,
    channelLabels: channel.labels,
    preferredTags: new Set((profile?.preferred_tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean)),
    profile,
    unlockActionTags: new Set((relationStage.unlock_action_tags ?? []).map((tag) => normalizeText(tag)).filter(Boolean))
  }
}

/**
 * 读取最近一条主动消息附带的建议话题/动作 id。
 * @param bundle 编译故事。 @param roleKey 联系人键。 @param snapshot 可选联系人状态。 @returns 去重后的建议 id 集合。
 */
export function getLatestContactSuggestedOptionIds(
  bundle: RuntimeStoryBundle,
  roleKey: string,
  snapshot?: RuntimeStorySessionSnapshot
) {
  const latestMessage = snapshot ? getContactThread(snapshot, roleKey)?.messages.at(-1) : null
  const latestSuggestedMessage = latestMessage?.sender === "contact" && latestMessage.source_rule_id
    ? latestMessage
    : null
  const suggestedRule = latestSuggestedMessage?.source_rule_id
    ? getContactProactiveRulesForContact(bundle, roleKey).find(
        (rule) => rule.id === latestSuggestedMessage.source_rule_id
      ) ?? null
    : null

  return new Set((suggestedRule?.reply_quick_message_ids ?? []).map((item) => normalizeText(item)).filter(Boolean))
}

/**
 * 判断话题或动作资料库条目的 scope 是否覆盖当前联系人。
 * @param scope 角色、类别、人格、轨道和阶段限制。 @param meta 当前联系人元数据。 @returns 所有已声明限制都匹配时为 true。
 */
export function matchesContactLibraryScope(
  scope: RuntimeStoryContactLibraryScope | undefined,
  meta: RuntimeResolvedContactMeta
) {
  if (!scope) {
    return true
  }

  const roleKeys = Array.isArray(scope.role_keys)
    ? scope.role_keys.map((item) => normalizeText(item)).filter(Boolean)
    : []
  if (roleKeys.length > 0 && !roleKeys.includes(meta.roleKey)) {
    return false
  }

  const contactTracks: Array<Exclude<RuntimeContactTrackId, "none">> = Array.isArray(scope.contact_tracks)
    ? scope.contact_tracks
      .map((item) => normalizeContactTrackId(item))
      .filter((item): item is Exclude<RuntimeContactTrackId, "none"> => item !== "none")
    : []
  if (contactTracks.length > 0 && (meta.trackId === "none" || !contactTracks.includes(meta.trackId))) {
    return false
  }

  const personalityIds = Array.isArray(scope.personality_ids)
    ? scope.personality_ids.map((item) => normalizeText(item)).filter(Boolean)
    : []
  if (personalityIds.length > 0 && (!meta.personalityId || !personalityIds.includes(meta.personalityId))) {
    return false
  }

  const minFavor = Number.isFinite(scope.min_favor) ? scope.min_favor : 0
  const maxFavor = Number.isFinite(scope.max_favor) ? scope.max_favor : 100
  return meta.favor >= minFavor && meta.favor <= maxFavor
}

/** @param scope 资料库作用域。 @param roleKey 当前角色键。 @returns 作用域越具体分数越高，角色精确匹配权重最高。 */
export function getContactScopeSpecificityScore(
  scope: RuntimeStoryContactLibraryScope | undefined,
  roleKey: string
) {
  if (!scope) {
    return 0
  }

  let score = 0
  const roleKeys = Array.isArray(scope.role_keys)
    ? scope.role_keys.map((item) => normalizeText(item)).filter(Boolean)
    : []
  if (roleKeys.length > 0) {
    score += roleKeys.includes(roleKey) ? 8 : 4
  }

  const contactTracks = Array.isArray(scope.contact_tracks)
    ? scope.contact_tracks.filter((item) => item && item !== "none")
    : []
  if (contactTracks.length > 0) {
    score += 4
  }

  const personalityIds = Array.isArray(scope.personality_ids)
    ? scope.personality_ids.map((item) => normalizeText(item)).filter(Boolean)
    : []
  if (personalityIds.length > 0) {
    score += 4
  }

  const minFavor = Number.isFinite(scope.min_favor) ? scope.min_favor : 0
  const maxFavor = Number.isFinite(scope.max_favor) ? scope.max_favor : 100
  score += Math.max(0, 10 - Math.max(1, maxFavor - minFavor + 1) / 10)
  return score
}

/** @param optionTags 选项标签。 @param targetTags 目标标签。 @returns 两组标签的交集数量，用于稳定排序相关选项。 */
export function getContactTagOverlapScore(optionTags: string[], targetTags: string[]) {
  if (optionTags.length === 0 || targetTags.length === 0) {
    return 0
  }

  const targetSet = new Set(targetTags)
  return optionTags.reduce((count, tag) => count + (targetSet.has(tag) ? 1 : 0), 0)
}

/** @param bundle 编译故事。 @returns 物品 id 到显示名的 Map，名称为空时回退为 id。 */
export function getBundleItemNameMap(bundle: RuntimeStoryBundle) {
  const result = new Map<string, string>()

  for (const item of bundle.items?.items ?? []) {
    const itemId = normalizeItemId(item.id)
    if (!itemId) {
      continue
    }

    result.set(itemId, normalizeText(item.name) || itemId)
  }

  return result
}

/**
 * 根据 bundle 的 initialBags 创建新游戏背包状态。
 * @param bundle 编译故事。 @param clock 初始时钟。 @returns 已过滤未知物品、合并重复数量并写入取得时间的背包。
 * 初始配置也要重新规范化，避免旧 bundle 中的负数、重复项或不存在物品进入运行状态。
 */
export function createInitialBagsState(bundle: RuntimeStoryBundle, clock: RuntimeClockState): RuntimeBagsState {
  const initialBags = bundle.initialBags ?? {
    player: {
      entries: []
    }
  }
  const itemIds = getBundleItemIds(bundle)
  const bags: RuntimeBagsState = createDefaultBagsState()
  const currentDay = Math.max(1, clock.base_day + Math.floor(clock.total_minutes / MINUTES_PER_DAY))
  const currentMinute = clock.total_minutes

  for (const [ownerId, bag] of Object.entries(initialBags)) {
    const normalizedOwnerId = normalizeOwnerId(ownerId)
    if (!normalizedOwnerId) {
      continue
    }

    const entries: RuntimeBagEntry[] = []
    const quantities = new Map<string, RuntimeBagEntry>()

    for (const entry of bag.entries ?? []) {
      const itemId = normalizeItemId(entry.item_id)
      const quantity = normalizeBagQuantity(entry.quantity, 1)

      if (!itemId || quantity <= 0 || !itemIds.has(itemId)) {
        continue
      }

      const existing = quantities.get(itemId)
      if (existing) {
        existing.quantity += quantity
        continue
      }

      const nextEntry: RuntimeBagEntry = {
        item_id: itemId,
        quantity,
        bound: Boolean(entry.bound),
        obtained_at_day: currentDay,
        obtained_at_minute: currentMinute,
        meta: entry.meta && typeof entry.meta === "object"
          ? cloneValue(entry.meta)
          : {}
      }
      quantities.set(itemId, nextEntry)
      entries.push(nextEntry)
    }

    bags[normalizedOwnerId] = {
      entries
    }
  }

  if (!bags.player) {
    bags.player = {
      entries: []
    }
  }

  return bags
}
