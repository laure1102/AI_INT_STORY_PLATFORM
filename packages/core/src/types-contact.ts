/** 联系人领域的持久化、剧情与编辑请求类型。 */
import type { StoryCanonicalEventCollectionType, StoryContactTrackId } from "./types"

export interface StoryContactLibraryScope {
  role_keys: string[]
  contact_tracks: StoryContactTrackId[]
  personality_ids: string[]
  min_favor: number
  max_favor: number
}

export type StoryContactInvokeDelayUnit = "hours" | "days" | "months" | "years"

export interface StoryContactInvokeDelay {
  unit: StoryContactInvokeDelayUnit
  value: number
}

export interface StoryContactEventInvocation {
  target_type: StoryCanonicalEventCollectionType
  event_id: string
  delay?: StoryContactInvokeDelay
}

export interface StoryContactRelationshipStage {
  id: string
  name: string
  descr: string
  min_favor: number
  max_favor: number
  allow_contact: boolean
  lock_message: string
  unlock_action_tags: string[]
}

export interface StoryContactRelationshipTrack {
  id: StoryContactTrackId
  name: string
  descr: string
  stages: StoryContactRelationshipStage[]
}

export interface StoryContactPersonalityDefinition {
  id: string
  name: string
  descr: string
  style_tags: string[]
}

export interface StoryContactQuickMessage {
  id: string
  text: string
  tags: string[]
  base_favor_delta: number
  cooldown_hours: number
  visibility: "always" | "suggested-only"
  available_role_keys: string[]
}

export interface StoryContactProactiveMessageRule {
  id: string
  enabled: boolean
  trigger_expr: string
  cooldown_hours: number
  favor_delta: number
  messages: string[]
  reply_quick_message_ids: string[]
}

export type StoryContactChannelPreset = "generic" | "phone" | "letter" | "transmission"

export interface StoryContactChannelLabels {
  message?: string
  conversation?: string
  talk?: string
  action?: string
  gift?: string
  send?: string
  reply?: string
}

export interface StoryContactChannel {
  id: string
  name: string
  preset: StoryContactChannelPreset
  labels: StoryContactChannelLabels
}

export interface StoryContactProfile {
  role_key: string
  channel_id: string
  enabled: boolean
  auto_add: boolean
  initial_favor: number
  preferred_tags: string[]
  reply_by_tag: Record<string, string[]>
  proactive_messages: StoryContactProactiveMessageRule[]
}

export interface StoryContactTalkLibraryEntry {
  id: string
  text: string
  tags: string[]
  scope: StoryContactLibraryScope
  base_favor_delta: number
  cooldown_hours: number
  invoke?: StoryContactEventInvocation
}

export interface StoryContactActionCostItem {
  item_id: string
  quantity: number
}

export interface StoryContactActionLibraryEntry {
  id: string
  label: string
  text: string
  tags: string[]
  scope: StoryContactLibraryScope
  base_favor_delta: number
  cooldown_hours: number
  cost_money: number
  cost_items: StoryContactActionCostItem[]
  invoke?: StoryContactEventInvocation
}

export interface StoryContactReplyLibraryEntry {
  id: string
  tags: string[]
  scope: StoryContactLibraryScope
  replies: string[]
}

export interface StoryContactFile {
  default_channel_id: string
  channels: StoryContactChannel[]
  relationship_tracks: StoryContactRelationshipTrack[]
  personality_library: StoryContactPersonalityDefinition[]
  talk_library: StoryContactTalkLibraryEntry[]
  action_library: StoryContactActionLibraryEntry[]
  reply_library: StoryContactReplyLibraryEntry[]
  player_quick_messages: StoryContactQuickMessage[]
  contact_profiles: StoryContactProfile[]
  fallback_replies: Record<string, string[]>
}

export interface StoryContactConversationMessage {
  content: string
}

export interface StoryContactConversationReminder {
  enabled: boolean
  interval_minutes: number
}

export interface StoryContactConversationOption {
  id: string
  text: string
  visible_expr: string
  script: string
  next_node_id: string
}

export interface StoryContactConversationNode {
  id: string
  contact_messages: StoryContactConversationMessage[]
  player_options: StoryContactConversationOption[]
  reminder: StoryContactConversationReminder
  end: boolean
  end_script: string
  invoke?: StoryContactEventInvocation
}

export interface StoryContactConversationDefinition {
  id: string
  title: string
  role_key: string
  enabled: boolean
  once: boolean
  lock_normal_chat: boolean
  trigger_expr: string
  entry_node_id: string
  nodes: StoryContactConversationNode[]
}

export interface StoryContactConversationsFile {
  conversations: StoryContactConversationDefinition[]
}

export interface StoryContactConversationState {
  conversation_id: string
  role_key: string
  node_id: string
  option_id?: string | null
  finished: boolean
}

export interface StoryContactConversationOptionInput {
  id: string
  text: string
  visible_expr: string
  script: string
  next_node_id: string
}

export interface StoryContactConversationMessageInput {
  content: string
}

export interface StoryContactConversationReminderInput {
  enabled: boolean
  interval_minutes: number
}

export interface StoryContactConversationNodeInput {
  id: string
  contact_messages: StoryContactConversationMessageInput[]
  player_options: StoryContactConversationOptionInput[]
  reminder: StoryContactConversationReminderInput
  end: boolean
  end_script: string
  invoke?: StoryContactEventInvocation
}

export interface StoryContactConversationInput {
  id: string
  title: string
  role_key: string
  enabled: boolean
  once: boolean
  lock_normal_chat: boolean
  trigger_expr: string
  entry_node_id: string
  nodes: StoryContactConversationNodeInput[]
}

export interface StoryContactConversationsResponse {
  contactConversations: StoryContactConversationsFile
}

export interface SaveStoryContactConversationsRequest {
  contactConversations: StoryContactConversationsFile
}
