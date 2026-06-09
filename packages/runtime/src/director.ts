import type { StoryValDefinition, StoryValsFile } from "./types"

export type RuntimeDirectorTriggerMode = "default" | "condition" | "invoke"
export type RuntimeDirectorCandidateSourceType = "chain_root" | "pool"

export interface RuntimeDirectorDialogue {
  speaker_type: "player" | "object"
  speaker_key: string
  content: string
}

export type RuntimeDirectorPresentation =
  | {
      type: "silent"
    }
  | {
      type: "message"
      message: {
        content: string
        duration_seconds: number
      }
    }
  | {
      type: "dialogue"
      dialogues: RuntimeDirectorDialogue[]
    }

export interface RuntimeDirectorEvent {
  id: string
  title: string
  trigger_mode?: RuntimeDirectorTriggerMode
  trigger_expr: string
  init_script: string
  object_keys: string[]
  presentation: RuntimeDirectorPresentation
  location: string
  end_script: string
  meta?: Record<string, unknown>
}

export interface RuntimeDirectorPoolEvent extends RuntimeDirectorEvent {
  bgm: string
}

export interface RuntimeDirectorHistoryEntry {
  type: "event" | "action" | "dialogue" | "system"
  id: string
  title?: string
}

export interface RuntimeDirectorFeatureSnapshot {
  storyId: string
  gameMinute: number
  day: number
  hour: number
  minute: number
  weekday: number
  values: Record<string, unknown>
  consumedPoolEventIds: string[]
  triggeredPoolEventIds: string[]
  recentHistory: RuntimeDirectorHistoryEntry[]
}

export interface RuntimeDirectorCandidate {
  sourceType: RuntimeDirectorCandidateSourceType
  event: RuntimeDirectorEvent
  index: number
  reasons: string[]
}

export interface RuntimeDirectorScoringContext {
  candidates: RuntimeDirectorCandidate[]
  features: RuntimeDirectorFeatureSnapshot
}

export interface RuntimeDirectorCandidateScore {
  sourceType: RuntimeDirectorCandidateSourceType
  eventId: string
  title: string
  score: number
  reasons: string[]
}

export interface RuntimeDirectorDecision {
  selectedSourceType: RuntimeDirectorCandidateSourceType | null
  selectedEventId: string | null
  candidateScores: RuntimeDirectorCandidateScore[]
  reason: string
}

export interface RuntimeDirectorDecisionLog {
  game_minute: number
  selected_source_type: RuntimeDirectorCandidateSourceType | null
  selected_event_id: string | null
  selected_event_title?: string
  candidate_count: number
  candidates: RuntimeDirectorCandidateScore[]
  features: RuntimeDirectorFeatureSnapshot
  reason: string
}

export type RuntimeDirectorTrainingSampleSource = "rule" | "human" | "model"

export interface RuntimeDirectorTrainingSampleInput {
  features: RuntimeDirectorFeatureSnapshot
  candidates: Array<{
    source_type: RuntimeDirectorCandidateSourceType
    event_id: string
  }>
  /** @deprecated 请改用 candidates */
  candidate_event_ids: string[]
}

export interface RuntimeDirectorTrainingSampleLabel {
  selected_source_type: RuntimeDirectorCandidateSourceType | null
  selected_event_id: string | null
  selected_candidate_index: number
}

export interface RuntimeDirectorTrainingSampleTeacher {
  reason: string
  candidate_scores: RuntimeDirectorCandidateScore[]
}

export interface RuntimeDirectorTrainingSample {
  schema_version: 2
  source: RuntimeDirectorTrainingSampleSource
  story_id: string
  game_minute: number
  input: RuntimeDirectorTrainingSampleInput
  label: RuntimeDirectorTrainingSampleLabel
  teacher: RuntimeDirectorTrainingSampleTeacher
}

export interface RuntimeDirectorTrainingSampleOptions {
  source?: RuntimeDirectorTrainingSampleSource
  includeNoSelection?: boolean
}

export interface RuntimeDirectorScorer {
  score(context: RuntimeDirectorScoringContext): RuntimeDirectorCandidateScore[]
}

export interface RuntimeStoryDirector {
  decide(context: RuntimeDirectorScoringContext): RuntimeDirectorDecision
}

const MAX_DIRECTOR_VALUE_COUNT = 200
const RUNTIME_DIRECTOR_TRAINING_SAMPLE_SCHEMA_VERSION = 2

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)])
    ) as T
  }

  return value
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function getDirectorMeta(event: RuntimeDirectorEvent) {
  const meta = isRecord(event.meta) ? event.meta : {}
  return isRecord(meta.director) ? meta.director : meta
}

function readDirectorPriority(event: RuntimeDirectorEvent) {
  const directorMeta = getDirectorMeta(event)
  return readNumber(directorMeta.priority, 0)
}

function readDirectorWeight(event: RuntimeDirectorEvent) {
  const directorMeta = getDirectorMeta(event)
  return readNumber(directorMeta.weight, 0)
}

function createRuleBasedScore(candidate: RuntimeDirectorCandidate): RuntimeDirectorCandidateScore {
  const event = candidate.event
  const reasons: string[] = [...candidate.reasons]
  let score = 0
  const priority = readDirectorPriority(event)
  const weight = readDirectorWeight(event)

  if (priority !== 0) {
    score += priority * 100
    reasons.push(`priority=${priority}`)
  }

  if (weight !== 0) {
    score += weight
    reasons.push(`weight=${weight}`)
  }

  if (event.trigger_mode === "condition") {
    score += 10
    reasons.push("condition-trigger")
  }

  if (event.presentation.type === "dialogue" && event.presentation.dialogues.length > 0) {
    score += Math.min(5, event.presentation.dialogues.length)
    reasons.push(`dialogues=${event.presentation.dialogues.length}`)
  }

  if (event.presentation.type === "message") {
    score += 0.5
    reasons.push("message-presentation")
  }

  if (event.object_keys.length > 0) {
    score += Math.min(3, event.object_keys.length) * 0.25
    reasons.push(`objects=${event.object_keys.length}`)
  }

  return {
    sourceType: candidate.sourceType,
    eventId: event.id,
    title: event.title,
    score,
    reasons
  }
}

export function createRuleBasedRuntimeDirectorScorer(): RuntimeDirectorScorer {
  return {
    score(context) {
      return context.candidates.map(createRuleBasedScore)
    }
  }
}

export function createRuleBasedRuntimeDirector(
  scorer: RuntimeDirectorScorer = createRuleBasedRuntimeDirectorScorer()
): RuntimeStoryDirector {
  return {
    decide(context) {
      const candidateScores = scorer.score(context)

      if (candidateScores.length === 0) {
        return {
          selectedSourceType: null,
          selectedEventId: null,
          candidateScores: [],
          reason: "no-candidates"
        }
      }

      const candidateIndexes = new Map(context.candidates.map((candidate) => [
        createDirectorCandidateKey(candidate.sourceType, candidate.event.id),
        candidate.index
      ]))
      const sortedScores = [...candidateScores].sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score
        }

        return (
          candidateIndexes.get(createDirectorCandidateKey(left.sourceType, left.eventId)) ?? 0
        ) - (
          candidateIndexes.get(createDirectorCandidateKey(right.sourceType, right.eventId)) ?? 0
        )
      })
      const selectedScore = sortedScores[0]

      return {
        selectedSourceType: selectedScore?.sourceType ?? null,
        selectedEventId: selectedScore?.eventId ?? null,
        candidateScores: sortedScores,
        reason: selectedScore
          ? `selected:${selectedScore.sourceType}:${selectedScore.eventId}`
          : "no-candidates"
      }
    }
  }
}

export function flattenDirectorValues(
  vals: StoryValsFile,
  systemVals: StoryValsFile
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = []

  for (const group of [...vals.variables, ...systemVals.variables]) {
    collectDirectorValueEntries(group, entries)

    if (entries.length >= MAX_DIRECTOR_VALUE_COUNT) {
      break
    }
  }

  return Object.fromEntries(entries.slice(0, MAX_DIRECTOR_VALUE_COUNT))
}

function collectDirectorValueEntries(
  group: StoryValDefinition,
  entries: Array<[string, unknown]>
) {
  const groupName = group.name.trim()
  if (!groupName) {
    return
  }

  for (const row of group.vals) {
    const rowName = row.name.trim()
    if (!rowName || row.value_type === "calc") {
      continue
    }

    entries.push([`${groupName}.${rowName}`, cloneValue(row.value)])

    if (entries.length >= MAX_DIRECTOR_VALUE_COUNT) {
      return
    }
  }
}

export function createRuntimeDirectorDecisionLog(
  decision: RuntimeDirectorDecision,
  features: RuntimeDirectorFeatureSnapshot
): RuntimeDirectorDecisionLog {
  const selectedCandidate = decision.candidateScores.find(
    (candidate) =>
      candidate.sourceType === decision.selectedSourceType
      && candidate.eventId === decision.selectedEventId
  )

  return {
    game_minute: features.gameMinute,
    selected_source_type: decision.selectedSourceType,
    selected_event_id: decision.selectedEventId,
    selected_event_title: normalizeText(selectedCandidate?.title) || undefined,
    candidate_count: decision.candidateScores.length,
    candidates: cloneValue(decision.candidateScores),
    features: cloneValue(features),
    reason: decision.reason
  }
}

export function createRuntimeDirectorTrainingSamples(
  logs: RuntimeDirectorDecisionLog[],
  options: RuntimeDirectorTrainingSampleOptions = {}
): RuntimeDirectorTrainingSample[] {
  const source = options.source ?? "rule"
  const includeNoSelection = options.includeNoSelection ?? false
  const samples: RuntimeDirectorTrainingSample[] = []

  for (const log of logs) {
    const candidates = log.candidates.flatMap((candidate) => {
      const eventId = normalizeText(candidate.eventId)
      return eventId
        ? [{
            source_type: candidate.sourceType,
            event_id: eventId
          }]
        : []
    })
    const candidateEventIds = candidates.map((candidate) => candidate.event_id)
    const selectedSourceType = log.selected_source_type
    const selectedEventId = normalizeText(log.selected_event_id) || null

    if (!selectedEventId && !includeNoSelection) {
      continue
    }

    const selectedCandidateIndex = selectedEventId
      ? candidates.findIndex((candidate) =>
          candidate.source_type === selectedSourceType
          && candidate.event_id === selectedEventId
        )
      : -1

    if (selectedEventId && selectedCandidateIndex < 0) {
      continue
    }

    samples.push({
      schema_version: RUNTIME_DIRECTOR_TRAINING_SAMPLE_SCHEMA_VERSION,
      source,
      story_id: log.features.storyId,
      game_minute: log.game_minute,
      input: {
        features: cloneValue(log.features),
        candidates: cloneValue(candidates),
        candidate_event_ids: candidateEventIds
      },
      label: {
        selected_source_type: selectedSourceType,
        selected_event_id: selectedEventId,
        selected_candidate_index: selectedCandidateIndex
      },
      teacher: {
        reason: log.reason,
        candidate_scores: cloneValue(log.candidates)
      }
    })
  }

  return samples
}

function createDirectorCandidateKey(
  sourceType: RuntimeDirectorCandidateSourceType,
  eventId: string
) {
  return `${sourceType}:${eventId}`
}
