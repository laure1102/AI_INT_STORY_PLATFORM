export interface StoryMetaFile {
  id: string
  title: string
  description?: string
  startEventId?: string
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
  name: string
  zhiye: string
  descr: string
  prompt: string
  img_raw: string
  img_compress_1: string
  img_compress_2: string
}

export interface StoryImportantRoleDefinition {
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
  name: string
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
  id: string
  title: string
  kind: string
  body?: string
  next: string[]
  meta?: Record<string, unknown>
}

export interface StoryEventTrigger {
  all?: Record<string, unknown>[]
  any?: Record<string, unknown>[]
  none?: Record<string, unknown>[]
}

export type StoryEventCollectionType = "graph" | "bigOnce" | "loop"

export type StoryGraphEventsFile = StoryEventFile[]

export interface StoryBigOnceEventFile extends Omit<StoryEventFile, "next"> {
  next: string[]
  trigger?: StoryEventTrigger
}

export type StoryBigOnceEventsFile = StoryBigOnceEventFile[]

export interface StoryLoopEventFile extends Omit<StoryEventFile, "next"> {
  next: string[]
  trigger?: StoryEventTrigger
  cooldown?: Record<string, unknown>
}

export type StoryLoopEventsFile = StoryLoopEventFile[]

export interface StoryDocument {
  story: StoryMetaFile
  vals: StoryValsFile
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
  id: string
  title: string
  kind: string
  body?: string
  next: string[]
}

export interface CompiledStory {
  storyId: string
  title: string
  generatedAt: string
  entryEventId?: string
  vals: StoryValsFile
  scenes: StorySceneFile
  roles: StoryRolesFile
  eventLocations: StoryEventLocationFile
  graphEvents: Record<string, CompiledEvent>
  bigOnceEvents: StoryBigOnceEventsFile
  loopEvents: StoryLoopEventsFile
}
