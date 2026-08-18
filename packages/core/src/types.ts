import type { StoryContactConversationsFile, StoryContactFile } from "./types-contact"

export * from "./types-contact"

export interface StoryGameSettings {
  start_time: string
}

export interface StoryMetaFile {
  id: string
  title: string
  description?: string
  tags?: string[]
  game_settings: StoryGameSettings
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

export type StoryPlayerOverrideInputType = "text" | "select"

export interface StoryPlayerOverrideInputOption {
  label: string
  value: string
}

export interface StoryPlayerOverrideValEntry {
  var_key: string
  need_player_override: boolean
  tips: string
  group_no: number
  input_type: StoryPlayerOverrideInputType
  input_options: StoryPlayerOverrideInputOption[]
}

export interface StoryPlayerOverrideValsFile {
  entries: StoryPlayerOverrideValEntry[]
}

export interface StoryReferGenderAliases {
  male: string[]
  female: string[]
}

export interface StoryReferTerm {
  id: string
  label: string
  male: string
  female: string
  fallback: string
}

export interface StoryReferFile {
  gender_value_key: string
  gender_aliases: StoryReferGenderAliases
  terms: StoryReferTerm[]
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

export type StoryContactTrackId = "none" | "romance" | "official" | "social"

export interface StoryRoleContactMetadata {
  contact_enabled: boolean
  contact_track: StoryContactTrackId
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

export interface StoryShopCategory {
  id: string
  name: string
  sort_order: number
  visible_expr: string
  descr: string
}

export interface StoryShopProduct {
  id: string
  category_id: string
  item_id: string
  price: number
  quantity: number
  sort_order: number
  enabled: boolean
  available_expr: string
  unavailable_reason: string
  allow_gift: boolean
  gift_favor_delta: number
  purchase_cooldown_hours: number
  gift_cooldown_hours: number
}

export interface StoryShopFile {
  currency_value_key: string
  categories: StoryShopCategory[]
  products: StoryShopProduct[]
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

export interface StoryDoingMenu {
  id: string
  title: string
  parent_id: string
  sort_order: number
  visible_expr: string
  descr: string
}

export interface StoryDoingDefinition {
  id: string
  title: string
  menu_id: string
  descr: string
  visible_expr: string
  cooldown_hours: number
  once: boolean
  init_script: string
  object_keys: string[]
  presentation: StoryEventPresentation
  location: string
  bgm: string
  end_script: string
  meta?: Record<string, unknown>
}

export interface StoryDoingFile {
  menus: StoryDoingMenu[]
  doings: StoryDoingDefinition[]
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
  baseUrl: string
  model: string
}

export interface AppAiAgentSettings {
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

export interface StoryRoleNameInputDefinition {
  role_key: string
  prompt?: string
}

export interface StoryOnceDialogueDefinition {
  speaker_type: StoryOnceSpeakerType
  speaker_key: string
  content: string
  role_name_input?: StoryRoleNameInputDefinition
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
  refer: StoryReferFile
  scenes: StorySceneFile
  roles: StoryRolesFile
  eventLocations: StoryEventLocationFile
  items: StoryItemsFile
  shop: StoryShopFile
  initialBags: StoryInitialBagsFile
  contact: StoryContactFile
  contactConversations: StoryContactConversationsFile
  doing: StoryDoingFile
  chainEvents: StoryChainEventsFile
  poolEvents: StoryPoolEventsFile
  scheduleEvents: StoryScheduleEventsFile
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
  schemaVersion: 2
  contentHash: string
  storyId: string
  title: string
  generatedAt: string
  gameSettings: StoryGameSettings
  vals: StoryValsFile
  playerOverrideVals: StoryPlayerOverrideValsFile
  systemVals: StoryValsFile
  refer: StoryReferFile
  scenes: StorySceneFile
  roles: StoryRolesFile
  eventLocations: StoryEventLocationFile
  items: StoryItemsFile
  shop: StoryShopFile
  initialBags: StoryInitialBagsFile
  contact: StoryContactFile
  contactConversations: StoryContactConversationsFile
  doing: StoryDoingFile
  chainEvents: Record<string, CompiledEvent | CompiledAction>
  poolEvents: StoryPoolEventsFile
  scheduleEvents: StoryScheduleEventsFile
}
