export interface StoryMetaFile {
  id: string
  title: string
  description?: string
  startEventId?: string
  tags?: string[]
}

export interface StoryValDefinition {
  id: string
  type?: string
  initialValue?: unknown
  description?: string
  meta?: Record<string, unknown>
}

export interface StoryValsFile {
  variables: StoryValDefinition[]
}

export interface StorySceneDefinition {
  id: string
  title: string
  image?: string
  description?: string
  meta?: Record<string, unknown>
}

export interface StorySceneFile {
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

export interface StoryEventLocationAssignment {
  eventId: string
  sceneId?: string
  location: string
  description?: string
  meta?: Record<string, unknown>
}

export interface StoryEventLocationFile {
  assignments: StoryEventLocationAssignment[]
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
