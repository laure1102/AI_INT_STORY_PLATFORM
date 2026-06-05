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

export interface StoryNormalRoleDefinition {
  id: string
  name: string
  zhiye: string
  descr: string
  prompt: string
  img_raw: string
  img_compress_1: string
  img_compress_2: string
}

export interface StoryImportantRoleDefinition {
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

export interface AppAiProviderSettings {
  apiKey: string
  baseUrl: string
  model: string
}

export interface AppSettingsFile {
  ai: AppAiSettings
}

export interface AppAiSettings {
  image: AppAiProviderSettings
  text: AppAiProviderSettings
}

export interface StoryEventFile {
  node_type?: "event"
  id: string
  title: string
  trigger_expr: string
  init_script: string
  end_script: string
  object_keys: string[]
  dialogues: StoryBigOnceDialogueDefinition[]
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

export type StoryEventCollectionType = "graph" | "bigOnce" | "loop"

export type StoryGraphNodeFile = StoryEventFile | StoryActionFile
export type StoryGraphEventsFile = StoryGraphNodeFile[]

export type StoryBigOnceSpeakerType = "player" | "object"

export interface StoryBigOnceDialogueDefinition {
  speaker_type: StoryBigOnceSpeakerType
  speaker_key: string
  content: string
}

export interface StoryBigOnceEventFile {
  id: string
  title: string
  trigger_expr: string
  init_script: string
  object_keys: string[]
  dialogues: StoryBigOnceDialogueDefinition[]
  location: string
  bgm: string
  end_script: string
}

export type StoryBigOnceEventsFile = StoryBigOnceEventFile[]

export type StoryLoopMode = "daily" | "weekly" | "monthly" | "interval_days"

export interface StoryLoopRule {
  mode: StoryLoopMode
  interval_days?: number
  weekday?: number
  month_day?: number
}

export interface StoryLoopEventFile extends StoryBigOnceEventFile {
  loop: StoryLoopRule
}

export type StoryLoopEventsFile = StoryLoopEventFile[]

export type StoryAnyEventFile =
  | StoryEventFile
  | StoryActionFile
  | StoryBigOnceEventFile
  | StoryLoopEventFile

export interface StoryDocument {
  story: StoryMetaFile
  vals: StoryValsFile
  playerOverrideVals: StoryPlayerOverrideValsFile
  systemVals: StoryValsFile
  scenes: StorySceneFile
  roles: StoryRolesFile
  eventLocations: StoryEventLocationFile
  graphEvents: StoryGraphEventsFile
  bigOnceEvents: StoryBigOnceEventsFile
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
  trigger_expr: string
  init_script: string
  end_script: string
  object_keys: string[]
  dialogues: StoryBigOnceDialogueDefinition[]
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
  graphEvents: Record<string, CompiledEvent | CompiledAction>
  bigOnceEvents: StoryBigOnceEventsFile
  loopEvents: StoryLoopEventsFile
}
