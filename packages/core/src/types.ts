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

export interface StoryRoleDefinition {
  id: string
  name: string
  avatar?: string
  description?: string
  meta?: Record<string, unknown>
}

export interface StoryRolesFile {
  roles: StoryRoleDefinition[]
}

export interface StoryEventLocationAiConfig {
  image_size: string
  global_prompt: string
  compress_quality: number
}

export interface StoryEventLocationAssignment {
  name: string
  descr: string
  img: string
  prompt: string
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
