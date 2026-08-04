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

/** @param value 训练数据中的任意 JSON 风格值。 @returns 与原值不共享数组和对象引用的深拷贝。 */
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

/** @param value 未知输入。 @returns 去除首尾空白的字符串；非字符串返回空串。 */
function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

/** @param value 未知输入。 @returns 是否为非数组对象，并同时为 TypeScript 收窄类型。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

/** @param value 未知输入。 @param fallback 非有限数字时的默认值。 @returns 可用的有限数字。 */
function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/** @param event 导演候选事件。 @returns 优先取 `meta.director`，否则取整个 meta 的导演参数对象。 */
function getDirectorMeta(event: RuntimeDirectorEvent) {
  const meta = isRecord(event.meta) ? event.meta : {}
  return isRecord(meta.director) ? meta.director : meta
}

/** @param event 导演候选事件。 @returns 配置的 priority，缺失或非法时为 0。 */
function readDirectorPriority(event: RuntimeDirectorEvent) {
  const directorMeta = getDirectorMeta(event)
  return readNumber(directorMeta.priority, 0)
}

/** @param event 导演候选事件。 @returns 配置的 weight，缺失或非法时为 0。 */
function readDirectorWeight(event: RuntimeDirectorEvent) {
  const directorMeta = getDirectorMeta(event)
  return readNumber(directorMeta.weight, 0)
}

/**
 * 用可解释规则为一个导演候选事件打分。
 * @param candidate 事件、来源、原顺序及进入候选集的理由。 @returns 分数和逐项理由。
 * priority 权重最高，其次考虑普通 weight、条件触发、对白数量、消息和关联对象数，便于日志解释选择原因。
 */
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

/** @returns 默认规则评分器；它为上下文中的每个候选调用同一套可解释评分规则。 */
export function createRuleBasedRuntimeDirectorScorer(): RuntimeDirectorScorer {
  return {
    /** @param context 候选事件和当前特征快照。 @returns 与候选一一对应的评分结果。 */
    score(context) {
      return context.candidates.map(createRuleBasedScore)
    }
  }
}

/**
 * 创建默认运行时导演。
 * @param scorer 可替换的评分器，默认使用内置规则。 @returns 根据分数选择剧情的导演对象。
 */
export function createRuleBasedRuntimeDirector(
  scorer: RuntimeDirectorScorer = createRuleBasedRuntimeDirectorScorer()
): RuntimeStoryDirector {
  return {
    /**
     * 从候选事件中选择最高分事件。
     * @param context 当前候选及特征。 @returns 选择结果和按分数排序的完整解释；无候选时明确返回空选择。
     * 分数相同时按候选原始 index 排序，保证相同存档、相同输入总得到相同结果。
     */
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

/**
 * 把分组变量展平为导演特征使用的 `组名.变量名 -> 值` 字典。
 * @param vals 普通变量。 @param systemVals 系统变量。 @returns 最多 200 个非 calc 变量的独立副本。
 */
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

/**
 * 将一个变量组追加到展平结果。
 * @param group 变量组。 @param entries 正在构建的键值数组。 @returns 无返回值；会原地追加 entries。
 */
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

/**
 * 把一次导演决定冻结为可持久化日志。
 * @param decision 选择结果。 @param features 当时的特征快照。 @returns 不共享可变引用的决策日志。
 */
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

/**
 * 将导演日志转换成监督训练样本。
 * @param logs 历史决策日志。 @param options 样本来源以及是否保留“未选择”记录。 @returns Schema v2 样本数组。
 * 找不到所选事件对应候选的异常日志会被跳过，避免产生标签与输入不一致的训练数据。
 */
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

/** @param sourceType 候选来源。 @param eventId 事件 id。 @returns 可区分同 id 不同来源的稳定 Map 键。 */
function createDirectorCandidateKey(
  sourceType: RuntimeDirectorCandidateSourceType,
  eventId: string
) {
  return `${sourceType}:${eventId}`
}
