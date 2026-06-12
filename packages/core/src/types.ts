export interface StoryMetaFile {
  id: string
  title: string
  description?: string
  tags?: string[]
}

export type StoryValValueType = "value" | "calc"

export interface StoryValEntryDefinition {
  name: string
  description?: string
  value_type: StoryValValueType
  value?: unknown
  calc_rule: string
}

export interface StoryValDefinition {
  name: string
  description?: string
  vals: StoryValEntryDefinition[]
}

export interface StoryValsFile {
  variables: StoryValDefinition[]
}

export interface StoryPlayerOverrideValEntry {
  var_key: string
  need_player_override: boolean
  tips: string
  group_no: number
}

export interface StoryPlayerOverrideValsFile {
  entries: StoryPlayerOverrideValEntry[]
}

export interface StorySceneDefinition {
  level: number
  description: string
  music: string
  day_img: string
  night_img: string
}

export type StorySceneBackgroundVariant = "day" | "night"

export interface StorySceneAiConfig {
  compress_quality: number
}

export interface StorySceneFile {
  ai: StorySceneAiConfig
  scenes: StorySceneDefinition[]
}

export interface StoryRoleAiConfig {
  width: number
  height: number
  global_prompt: string
  compress_quality_1: number
  compress_quality_2: number
}

export type StoryPhoneContactTrackId = "none" | "romance" | "official" | "social"

export interface StoryRoleContactMetadata {
  contact_enabled: boolean
  contact_track: StoryPhoneContactTrackId
  contact_initial_favor: number
  xingge_id: string
  xingge_note: string
}

export interface StoryNormalRoleDefinition extends StoryRoleContactMetadata {
  id: string
  name: string
  zhiye: string
  descr: string
  prompt: string
  img_raw: string
  img_compress_1: string
  img_compress_2: string
}

export interface StoryImportantRoleDefinition extends StoryRoleContactMetadata {
  id: string
  name: string
  zhiye: string
  descr: string
  descr_male: string
  descr_female: string
  prompt: string
  prompt_male: string
  prompt_female: string
  img_raw: string
  img_compress_1: string
  img_compress_2: string
  xingge: string
  qufen_xingbie: boolean
  img_male_raw: string
  img_male_compress_1: string
  img_male_compress_2: string
  img_female_raw: string
  img_female_compress_1: string
  img_female_compress_2: string
}

export interface StoryNormalRolesDataFile {
  ai: StoryRoleAiConfig
  roles: StoryNormalRoleDefinition[]
}

export interface StoryImportantRolesDataFile {
  ai: StoryRoleAiConfig
  roles: StoryImportantRoleDefinition[]
}

export interface StoryRolesFile {
  normal: StoryNormalRolesDataFile
  important: StoryImportantRolesDataFile
}

export interface StoryEventLocationAiConfig {
  width: number
  height: number
  global_prompt: string
  compress_quality_1: number
  compress_quality_2: number
}

export interface StoryEventLocationAssignment {
  id: string
  descr: string
  prompt: string
  img_raw: string
  img_compress_1: string
  img_compress_2: string
}

export interface StoryEventLocationFile {
  ai: StoryEventLocationAiConfig
  assignments: StoryEventLocationAssignment[]
}

export interface StoryItemAiConfig {
  width: number
  height: number
  global_prompt: string
  compress_quality_1: number
  compress_quality_2: number
}

export interface StoryItemCategory {
  id: string
  name: string
  descr: string
  sort_order: number
}

export interface StoryItemDefinition {
  id: string
  name: string
  category_id: string
  descr: string
  prompt: string
  tags: string[]
  rarity: string
  stackable: boolean
  max_stack: number
  usable: boolean
  img_raw: string
  img_compress_1: string
  img_compress_2: string
}

export interface StoryItemsFile {
  ai: StoryItemAiConfig
  categories: StoryItemCategory[]
  items: StoryItemDefinition[]
}

export interface StoryInitialBagEntry {
  item_id: string
  quantity: number
  bound?: boolean
  meta?: Record<string, unknown>
}

export interface StoryInitialBagDefinition {
  entries: StoryInitialBagEntry[]
}

export interface StoryInitialBagsFile {
  player: StoryInitialBagDefinition
  [ownerId: string]: StoryInitialBagDefinition
}

export interface StoryPhoneLibraryScope {
  role_keys: string[]
  contact_tracks: StoryPhoneContactTrackId[]
  personality_ids: string[]
  min_favor: number
  max_favor: number
}

export type StoryPhoneInvokeDelayUnit = "hours" | "days" | "months" | "years"

export interface StoryPhoneInvokeDelay {
  unit: StoryPhoneInvokeDelayUnit
  value: number
}

export interface StoryPhoneEventInvocation {
  target_type: StoryCanonicalEventCollectionType
  event_id: string
  delay?: StoryPhoneInvokeDelay
}

export interface StoryPhoneRelationshipStage {
  id: string
  name: string
  descr: string
  min_favor: number
  max_favor: number
  allow_contact: boolean
  lock_message: string
  unlock_action_tags: string[]
}

export interface StoryPhoneRelationshipTrack {
  id: StoryPhoneContactTrackId
  name: string
  descr: string
  stages: StoryPhoneRelationshipStage[]
}

export interface StoryPhonePersonalityDefinition {
  id: string
  name: string
  descr: string
  style_tags: string[]
}

export interface StoryPhoneQuickMessage {
  id: string
  text: string
  tags: string[]
  base_favor_delta: number
  cooldown_hours: number
  visibility: "always" | "suggested-only"
  available_role_keys: string[]
}

export interface StoryPhoneProactiveMessageRule {
  id: string
  enabled: boolean
  trigger_expr: string
  cooldown_hours: number
  favor_delta: number
  messages: string[]
  reply_quick_message_ids: string[]
}

export interface StoryPhoneContactProfile {
  role_key: string
  enabled: boolean
  auto_add: boolean
  initial_favor: number
  preferred_tags: string[]
  reply_by_tag: Record<string, string[]>
  proactive_messages: StoryPhoneProactiveMessageRule[]
}

export interface StoryPhoneTalkLibraryEntry {
  id: string
  text: string
  tags: string[]
  scope: StoryPhoneLibraryScope
  base_favor_delta: number
  cooldown_hours: number
  invoke?: StoryPhoneEventInvocation
}

export interface StoryPhoneActionCostItem {
  item_id: string
  quantity: number
}

export interface StoryPhoneActionLibraryEntry {
  id: string
  label: string
  text: string
  tags: string[]
  scope: StoryPhoneLibraryScope
  base_favor_delta: number
  cooldown_hours: number
  cost_money: number
  cost_items: StoryPhoneActionCostItem[]
  invoke?: StoryPhoneEventInvocation
}

export interface StoryPhoneReplyLibraryEntry {
  id: string
  tags: string[]
  scope: StoryPhoneLibraryScope
  replies: string[]
}

export interface StoryPhoneFile {
  relationship_tracks: StoryPhoneRelationshipTrack[]
  personality_library: StoryPhonePersonalityDefinition[]
  talk_library: StoryPhoneTalkLibraryEntry[]
  action_library: StoryPhoneActionLibraryEntry[]
  reply_library: StoryPhoneReplyLibraryEntry[]
  player_quick_messages: StoryPhoneQuickMessage[]
  contact_profiles: StoryPhoneContactProfile[]
  fallback_replies: Record<string, string[]>
}

export interface StoryBibleFile {
  background: string
  golden_finger: string
  protagonist: string
  world_rules: string
  outline: string
  current_arc: string
  gameplay_design: string
  style_guide: string
  constraints: string
}

export interface AppAiProviderSettings {
  apiKey: string
  baseUrl: string
  model: string
}

export interface AppAiAgentSettings {
  apiKey: string
  baseUrl: string
  chiefEditorModel: string
  plotPlannerModel: string
  assetDesignerModel: string
  eventWriterModel: string
  scriptDoctorModel: string
  consistencyCheckerModel: string
  temperature: number
}

export interface AppSettingsFile {
  ai: AppAiSettings
}

export interface AppAiSettings {
  image: AppAiProviderSettings
  text: AppAiProviderSettings
  agent: AppAiAgentSettings
}

export interface StoryEventFile {
  node_type?: "event"
  id: string
  title: string
  trigger_mode?: StoryEventTriggerMode
  trigger_expr: string
  invoke_params?: StoryEventInvokeParamDefinition[]
  init_script: string
  end_script: string
  object_keys: string[]
  presentation: StoryEventPresentation
  location: string
  next: string[]
  meta?: Record<string, unknown>
}

export interface StoryActionVarDefinition {
  name: string
  descr?: string
  initial_value: string
}

export interface StoryActionFile {
  node_type?: "action"
  id: string
  title: string
  vars: StoryActionVarDefinition[]
  exec_script: string
  next: string[]
  meta?: Record<string, unknown>
}

export interface StoryEventTrigger {
  all?: Record<string, unknown>[]
  any?: Record<string, unknown>[]
  none?: Record<string, unknown>[]
}

export type StoryCanonicalEventCollectionType = "chain" | "pool" | "schedule"
export type StoryLegacyEventCollectionType = "graph" | "once" | "loop"
export type StoryEventCollectionType = StoryCanonicalEventCollectionType | StoryLegacyEventCollectionType
export type StoryInvokeTargetType = StoryEventCollectionType
export type StoryEventTriggerMode = "default" | "condition" | "invoke"

export type StoryChainNodeFile = StoryEventFile | StoryActionFile
export type StoryChainEventsFile = StoryChainNodeFile[]
/** @deprecated 请改用 StoryChainNodeFile */
export type StoryGraphNodeFile = StoryChainNodeFile
/** @deprecated 请改用 StoryChainEventsFile */
export type StoryGraphEventsFile = StoryChainEventsFile

export type StoryOnceSpeakerType = "player" | "object"

export interface StoryOnceDialogueDefinition {
  speaker_type: StoryOnceSpeakerType
  speaker_key: string
  content: string
}

export type StoryEventPresentationType = "silent" | "message" | "dialogue"

export interface StoryEventSilentPresentation {
  type: "silent"
}

export interface StoryEventMessagePresentation {
  type: "message"
  message: {
    content: string
    duration_seconds: number
  }
}

export interface StoryEventDialoguePresentation {
  type: "dialogue"
  dialogues: StoryOnceDialogueDefinition[]
}

export type StoryEventPresentation =
  | StoryEventSilentPresentation
  | StoryEventMessagePresentation
  | StoryEventDialoguePresentation

export type StoryOnceTriggerMode = StoryEventTriggerMode

export interface StoryEventInvokeParamDefinition {
  name: string
  descr?: string
}

export type StoryOnceInvokeParamDefinition = StoryEventInvokeParamDefinition

export interface StoryOnceEventFile {
  id: string
  title: string
  trigger_mode?: StoryEventTriggerMode
  trigger_expr: string
  invoke_params?: StoryEventInvokeParamDefinition[]
  init_script: string
  object_keys: string[]
  presentation: StoryEventPresentation
  location: string
  bgm: string
  end_script: string
  meta?: Record<string, unknown>
}

export type StoryPoolEventFile = StoryOnceEventFile
export type StoryPoolEventsFile = StoryPoolEventFile[]
/** @deprecated 请改用 StoryPoolEventFile */
export type StoryOnceEventFileLegacy = StoryOnceEventFile
/** @deprecated 请改用 StoryPoolEventsFile */
export type StoryOnceEventsFile = StoryPoolEventsFile

export type StoryLoopMode = "daily" | "weekly" | "monthly" | "interval_days"

export interface StoryLoopRule {
  mode: StoryLoopMode
  interval_days?: number
  weekday?: number
  month_day?: number
  at?: string
  priority?: number
  after?: string[]
  before?: string[]
}

export interface StoryLoopEventFile extends StoryOnceEventFile {
  loop: StoryLoopRule
}

export type StoryScheduleEventFile = StoryLoopEventFile
export type StoryScheduleEventsFile = StoryScheduleEventFile[]
/** @deprecated 请改用 StoryScheduleEventFile */
export type StoryLoopEventFileLegacy = StoryLoopEventFile
/** @deprecated 请改用 StoryScheduleEventsFile */
export type StoryLoopEventsFile = StoryScheduleEventsFile

export type StoryAnyEventFile =
  | StoryEventFile
  | StoryActionFile
  | StoryOnceEventFile
  | StoryLoopEventFile

export interface StoryDocument {
  story: StoryMetaFile
  storyBible: StoryBibleFile
  vals: StoryValsFile
  playerOverrideVals: StoryPlayerOverrideValsFile
  systemVals: StoryValsFile
  scenes: StorySceneFile
  roles: StoryRolesFile
  eventLocations: StoryEventLocationFile
  items: StoryItemsFile
  initialBags: StoryInitialBagsFile
  phone: StoryPhoneFile
  chainEvents: StoryChainEventsFile
  poolEvents: StoryPoolEventsFile
  scheduleEvents: StoryScheduleEventsFile
  /** @deprecated 请改用 chainEvents */
  graphEvents: StoryGraphEventsFile
  /** @deprecated 请改用 poolEvents */
  onceEvents: StoryOnceEventsFile
  /** @deprecated 请改用 scheduleEvents */
  loopEvents: StoryLoopEventsFile
}

export interface StorySummary {
  id: string
  title: string
  description?: string
  eventCount: number
  updatedAt?: string
}

export interface ValidationIssue {
  level: "error" | "warning"
  code: string
  message: string
  path: string[]
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

export interface CompiledEvent {
  node_type?: "event"
  id: string
  title: string
  trigger_mode?: StoryEventTriggerMode
  trigger_expr: string
  invoke_params?: StoryEventInvokeParamDefinition[]
  init_script: string
  end_script: string
  object_keys: string[]
  presentation: StoryEventPresentation
  location: string
  next: string[]
  meta?: Record<string, unknown>
}

export interface CompiledAction {
  node_type?: "action"
  id: string
  title: string
  vars: StoryActionVarDefinition[]
  exec_script: string
  next: string[]
  meta?: Record<string, unknown>
}

export interface CompiledStory {
  storyId: string
  title: string
  generatedAt: string
  vals: StoryValsFile
  playerOverrideVals: StoryPlayerOverrideValsFile
  systemVals: StoryValsFile
  scenes: StorySceneFile
  roles: StoryRolesFile
  eventLocations: StoryEventLocationFile
  items: StoryItemsFile
  initialBags: StoryInitialBagsFile
  phone: StoryPhoneFile
  chainEvents: Record<string, CompiledEvent | CompiledAction>
  poolEvents: StoryPoolEventsFile
  scheduleEvents: StoryScheduleEventsFile
  /** @deprecated 请改用 chainEvents */
  graphEvents: Record<string, CompiledEvent | CompiledAction>
  /** @deprecated 请改用 poolEvents */
  onceEvents: StoryOnceEventsFile
  /** @deprecated 请改用 scheduleEvents */
  loopEvents: StoryLoopEventsFile
}
