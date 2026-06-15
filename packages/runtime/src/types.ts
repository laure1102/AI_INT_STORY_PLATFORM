export type StoryValValueType = "value" | "calc"
export type StoryCanonicalEventCollectionType = "chain" | "pool" | "schedule"
export type StoryLegacyEventCollectionType = "graph" | "once" | "loop"
export type StoryInvokeTargetType = StoryCanonicalEventCollectionType | StoryLegacyEventCollectionType

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
