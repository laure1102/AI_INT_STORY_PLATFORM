<script setup lang="ts">
import type { AppSettingsFile, StoryBibleFile, StoryDocument } from "@story-mgr/core"
import type {
  ApplyStoryCreationDraftSelection,
  RunStoryCreationAgentResponse,
  StoryCreationAgentRole,
  StoryCreationDraft,
  StoryCreationDraftEvent,
  StoryCreationHistoryFile,
  StoryCreationHistorySession,
  StoryCreationDraftItem,
  StoryCreationDraftLoopRule,
  StoryCreationDraftRole,
  StoryCreationDraftVariable
} from "@story-mgr/shared"

type BibleFieldKey = keyof StoryBibleFile
type DraftImpactKind = "create" | "update" | "skip"
type StoryCreationAgentRunMode = "new" | "feedback"
type FeedbackHistoryStatus = "running" | "done" | "failed" | "cancelled"

interface BibleFieldConfig {
  key: BibleFieldKey
  label: string
  placeholder: string
}

interface DraftImpact {
  kind: DraftImpactKind
  label: string
  detail: string
}

interface FeedbackHistoryItem {
  id: number
  content: string
  mode: StoryCreationAgentRunMode
  status: FeedbackHistoryStatus
  error?: string
}

const props = defineProps<{
  agentResult: RunStoryCreationAgentResponse | null
  agentRunMode: StoryCreationAgentRunMode | null
  agentRunning: boolean
  agentError: string | null
  applying: boolean
  applyMessage: string | null
  applyWarnings: string[]
  creationHistory: StoryCreationHistoryFile
  activeHistorySessionId: string | null
  story: StoryDocument
  settings: AppSettingsFile | null
  saving: boolean
}>()

const emit = defineEmits<{
  applyDraft: [draft: StoryCreationDraft, selection: ApplyStoryCreationDraftSelection]
  abortAgent: []
  restoreHistorySession: [session: StoryCreationHistorySession]
  runAgent: [instruction: string, baseDraft?: StoryCreationDraft]
  saveStoryBible: [storyBible: StoryBibleFile]
}>()

const commandText = shallowRef("")
const feedbackText = shallowRef("")
const newCreationExpanded = shallowRef(true)
const creationHistoryExpanded = shallowRef(false)
const feedbackSeq = shallowRef(0)
const activeFeedbackId = shallowRef<number | null>(null)
const activeBibleField = shallowRef<BibleFieldKey>("background")
const selectedEventKeys = shallowRef<string[]>([])
const selectedLocationIds = shallowRef<string[]>([])
const selectedRoleKeys = shallowRef<string[]>([])
const selectedItemIds = shallowRef<string[]>([])
const selectedVariableKeys = shallowRef<string[]>([])
const feedbackHistory = ref<FeedbackHistoryItem[]>([])
const editableDraft = ref<StoryCreationDraft | null>(null)
const draftApplied = shallowRef(false)
const draft = reactive<StoryBibleFile>({
  background: "",
  golden_finger: "",
  protagonist: "",
  world_rules: "",
  outline: "",
  current_arc: "",
  gameplay_design: "",
  style_guide: "",
  constraints: ""
})

const bibleFields: BibleFieldConfig[] = [
  {
    key: "background",
    label: "故事背景",
    placeholder: "小说世界的时代、地域、势力格局、开局矛盾。"
  },
  {
    key: "golden_finger",
    label: "金手指",
    placeholder: "主角独有能力、系统规则、成长边界、代价。"
  },
  {
    key: "protagonist",
    label: "主角设定",
    placeholder: "默认主角身份、性格底色、初始处境、可被玩家覆盖的部分。"
  },
  {
    key: "world_rules",
    label: "世界规则",
    placeholder: "经济、修炼、权力、时间推进、常识和不可违背的规则。"
  },
  {
    key: "outline",
    label: "故事大纲",
    placeholder: "主线篇章、关键爽点、主要反派、阶段性目标。"
  },
  {
    key: "current_arc",
    label: "当前篇章",
    placeholder: "当前要扩写的篇章位置、冲突焦点、下一批事件目标。"
  },
  {
    key: "gameplay_design",
    label: "玩法设计",
    placeholder: "玩家选择空间、变量驱动、事件池触发策略、失败和回报结构。"
  },
  {
    key: "style_guide",
    label: "文风口味",
    placeholder: "叙事节奏、对白风格、爽感密度、禁用表达。"
  },
  {
    key: "constraints",
    label: "约束禁忌",
    placeholder: "不能生成的剧情、不能破坏的设定、必须保留的玩家自由度。"
  }
]

const pipelineSteps: Array<{ role: StoryCreationAgentRole; label: string }> = [
  { role: "chiefEditor", label: "主编" },
  { role: "plotPlanner", label: "规划" },
  { role: "assetDesigner", label: "资产" },
  { role: "eventWriter", label: "事件" },
  { role: "scriptDoctor", label: "审校" },
  { role: "consistencyChecker", label: "一致性" }
]

const activeBibleFieldConfig = computed<BibleFieldConfig>(() => {
  return bibleFields.find((field) => field.key === activeBibleField.value) ?? bibleFields[0]!
})

const agentModelSummary = computed(() => {
  const agent = props.settings?.ai.agent

  if (!agent) {
    return "未配置"
  }

  return agent.eventWriterModel || agent.plotPlannerModel || agent.chiefEditorModel || "未配置"
})

const filledBibleFieldCount = computed(() => {
  return bibleFields.filter((field) => draft[field.key].trim().length > 0).length
})

const canRunAgent = computed(() => {
  return commandText.value.trim().length > 0 && !props.agentRunning
})

const canRefineDraft = computed(() => {
  return feedbackText.value.trim().length > 0 && !!editableDraft.value && !props.agentRunning
})

const isFeedbackRunning = computed(() => {
  return props.agentRunning && props.agentRunMode === "feedback"
})

const isNewCreationRunning = computed(() => {
  return props.agentRunning && props.agentRunMode === "new"
})

const abortAgentLabel = computed(() => {
  if (props.agentRunMode === "feedback") {
    return "中止优化"
  }

  if (props.agentRunMode === "new") {
    return "中止生成"
  }

  return "中止当前任务"
})

const activeFeedbackItem = computed(() => {
  if (activeFeedbackId.value === null) {
    return null
  }

  return feedbackHistory.value.find((item) => item.id === activeFeedbackId.value) ?? null
})

const historySessions = computed(() => {
  return [...props.creationHistory.sessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )
})

const historySessionCount = computed(() => historySessions.value.length)

const showNewCreationForm = computed(() => {
  return !editableDraft.value || newCreationExpanded.value
})

const runStatus = computed(() => {
  if (isFeedbackRunning.value) {
    return "正在优化当前草稿..."
  }

  if (isNewCreationRunning.value) {
    return "多 Agent 正在生成草稿..."
  }

  if (editableDraft.value) {
    return `已生成 ${editableDraft.value.events.length} 个事件草稿、${editableDraft.value.items.length} 个物品草稿`
  }

  return "等待创作指令"
})

const agentLogs = computed(() => {
  if (props.agentRunning) {
    return []
  }

  return props.agentResult?.logs ?? []
})

const loggedRoles = computed(() => {
  return new Set(agentLogs.value.map((log) => log.role))
})

const draftPreview = computed(() => {
  return editableDraft.value
})

const eventTypeSummary = computed(() => {
  const events = draftPreview.value?.events ?? []

  return {
    chain: events.filter((event) => event.collectionType === "chain").length,
    pool: events.filter((event) => event.collectionType === "pool").length,
    schedule: events.filter((event) => event.collectionType === "schedule").length
  }
})

const selectedApplyCount = computed(() => {
  return selectedEventKeys.value.length
    + selectedLocationIds.value.length
    + selectedRoleKeys.value.length
    + selectedItemIds.value.length
    + selectedVariableKeys.value.length
})

const canApplyDraft = computed(() => {
  return !!editableDraft.value && selectedApplyCount.value > 0 && !props.applying && !draftApplied.value
})

const applyButtonLabel = computed(() => {
  if (props.applying) {
    return "应用中..."
  }

  if (draftApplied.value) {
    return "已应用"
  }

  return "应用草稿"
})

const existingLocationIds = computed(() => {
  return new Set(props.story.eventLocations.assignments.map((location) => location.id))
})

const existingRoleKeys = computed(() => {
  return new Set([
    ...props.story.roles.normal.roles.map((role) => `normal:${role.id}`),
    ...props.story.roles.important.roles.map((role) => `important:${role.id}`)
  ])
})

const existingItemIds = computed(() => {
  return new Set(props.story.items.items.map((item) => item.id))
})

const existingItemCategoryIds = computed(() => {
  return new Set(props.story.items.categories.map((category) => category.id))
})

const existingVariableKeys = computed(() => {
  return new Set(
    props.story.vals.variables.flatMap((group) =>
      group.vals.map((entry) => `${group.name}.${entry.name}`)
    )
  )
})

const existingChainIds = computed(() => {
  return new Set(props.story.chainEvents.map((event) => event.id))
})

const existingEventKeys = computed(() => {
  return new Set([
    ...props.story.chainEvents.map((event) => `chain:${event.id}`),
    ...props.story.poolEvents.map((event) => `pool:${event.id}`),
    ...props.story.scheduleEvents.map((event) => `schedule:${event.id}`)
  ])
})

const selectedDraftChainIds = computed(() => {
  const selectedKeys = new Set(selectedEventKeys.value)
  return new Set(
    draftPreview.value?.events
      .filter((event) => event.collectionType === "chain" && selectedKeys.has(getEventKey(event)))
      .map((event) => event.id) ?? []
  )
})

const availableLocationIdsForApply = computed(() => {
  return new Set([
    ...Array.from(existingLocationIds.value),
    ...selectedLocationIds.value
  ])
})

const availableRoleKeysForApply = computed(() => {
  return new Set([
    "player",
    ...Array.from(existingRoleKeys.value),
    ...selectedRoleKeys.value
  ])
})

const availableChainIdsForApply = computed(() => {
  return new Set([
    ...Array.from(existingChainIds.value),
    ...Array.from(selectedDraftChainIds.value)
  ])
})

const selectedImpactSummary = computed(() => {
  const summary = {
    create: 0,
    update: 0,
    skip: 0
  } satisfies Record<DraftImpactKind, number>
  const draft = draftPreview.value

  if (!draft) {
    return summary
  }

  const addImpact = (impact: DraftImpact) => {
    summary[impact.kind] += 1
  }

  for (const location of draft.locations) {
    if (selectedLocationIds.value.includes(location.id)) {
      addImpact(getLocationImpact(location))
    }
  }

  for (const role of draft.roles) {
    if (selectedRoleKeys.value.includes(getRoleKey(role))) {
      addImpact(getRoleImpact(role))
    }
  }

  for (const item of draft.items) {
    if (selectedItemIds.value.includes(item.id)) {
      addImpact(getItemImpact(item))
    }
  }

  for (const variable of draft.variables) {
    if (selectedVariableKeys.value.includes(getVariableKey(variable))) {
      addImpact(getVariableImpact(variable))
    }
  }

  for (const event of draft.events) {
    if (selectedEventKeys.value.includes(getEventKey(event))) {
      addImpact(getEventImpact(event))
    }
  }

  return summary
})

const applyPreviewMessage = computed(() => {
  if (draftApplied.value && props.applyMessage) {
    return props.applyMessage
  }

  const parts = [
    selectedImpactSummary.value.create > 0 ? `新增 ${selectedImpactSummary.value.create}` : "",
    selectedImpactSummary.value.update > 0 ? `覆盖 ${selectedImpactSummary.value.update}` : "",
    selectedImpactSummary.value.skip > 0 ? `跳过 ${selectedImpactSummary.value.skip}` : ""
  ].filter(Boolean)

  if (parts.length === 0) {
    return "确认后会写入所选地点、角色、物品、变量和事件。"
  }

  return `确认后将${parts.join("、")}。`
})

function syncDraft(storyBible: StoryBibleFile) {
  draft.background = storyBible.background ?? ""
  draft.golden_finger = storyBible.golden_finger ?? ""
  draft.protagonist = storyBible.protagonist ?? ""
  draft.world_rules = storyBible.world_rules ?? ""
  draft.outline = storyBible.outline ?? ""
  draft.current_arc = storyBible.current_arc ?? ""
  draft.gameplay_design = storyBible.gameplay_design ?? ""
  draft.style_guide = storyBible.style_guide ?? ""
  draft.constraints = storyBible.constraints ?? ""
}

function submitStoryBible() {
  emit("saveStoryBible", {
    background: draft.background,
    golden_finger: draft.golden_finger,
    protagonist: draft.protagonist,
    world_rules: draft.world_rules,
    outline: draft.outline,
    current_arc: draft.current_arc,
    gameplay_design: draft.gameplay_design,
    style_guide: draft.style_guide,
    constraints: draft.constraints
  })
}

function runAgent() {
  const instruction = commandText.value.trim()

  if (!instruction || props.agentRunning) {
    return
  }

  draftApplied.value = false
  clearFeedbackHistory()
  const runId = appendFeedbackHistory(instruction, "new")
  activeFeedbackId.value = runId
  emit("runAgent", instruction)
}

function refineDraft() {
  const instruction = feedbackText.value.trim()

  if (!instruction || !editableDraft.value || props.agentRunning) {
    return
  }

  const feedbackId = appendFeedbackHistory(instruction, "feedback")
  activeFeedbackId.value = feedbackId
  feedbackText.value = ""
  draftApplied.value = false
  emit("runAgent", instruction, cloneCreationDraft(editableDraft.value))
}

function abortAgent() {
  finishActiveFeedback("cancelled", "已中止")
  emit("abortAgent")
}

function appendFeedbackHistory(content: string, mode: StoryCreationAgentRunMode) {
  feedbackSeq.value += 1
  const id = feedbackSeq.value

  feedbackHistory.value = [
    {
      id,
      content,
      mode,
      status: "running"
    },
    ...feedbackHistory.value
  ]

  return id
}

function finishActiveFeedback(status: Exclude<FeedbackHistoryStatus, "running">, error?: string | null) {
  if (activeFeedbackId.value === null) {
    return
  }

  updateFeedbackHistoryItem(activeFeedbackId.value, status, error ?? undefined)
  activeFeedbackId.value = null
}

function updateFeedbackHistoryItem(
  feedbackId: number,
  status: FeedbackHistoryStatus,
  error?: string
) {
  feedbackHistory.value = feedbackHistory.value.map((item) =>
    item.id === feedbackId
      ? {
          ...item,
          status,
          error
        }
      : item
  )
}

function clearFeedbackHistory() {
  feedbackHistory.value = []
  activeFeedbackId.value = null
}

function feedbackStatusLabel(status: FeedbackHistoryStatus, mode: StoryCreationAgentRunMode) {
  if (status === "running") {
    return mode === "new" ? "创作中" : "优化中"
  }

  if (status === "failed") {
    return "失败"
  }

  if (status === "cancelled") {
    return "已中止"
  }

  return "已完成"
}

function getFeedbackStatusClass(status: FeedbackHistoryStatus) {
  return `creation-feedback-history__state--${status}`
}

function historyStatusLabel(status: StoryCreationHistorySession["status"]) {
  if (status === "applied") {
    return "已应用"
  }

  if (status === "draft") {
    return "草稿"
  }

  if (status === "running") {
    return "运行中"
  }

  if (status === "cancelled") {
    return "已中止"
  }

  return "失败"
}

function historyStatusClass(status: StoryCreationHistorySession["status"]) {
  return `creation-history__status--${status}`
}

function formatHistoryTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
}

function syncFeedbackHistoryFromSession(session: StoryCreationHistorySession) {
  feedbackSeq.value = session.turns.length
  feedbackHistory.value = session.turns
    .map((turn, index) => ({
      id: index + 1,
      content: turn.instruction,
      mode: turn.mode,
      status: turn.status === "failed"
        ? "failed" as const
        : turn.status === "running"
          ? "running" as const
          : turn.status === "cancelled"
            ? "cancelled" as const
            : "done" as const,
      error: turn.error
    }))
    .reverse()
  activeFeedbackId.value = null
}

function restoreHistorySession(session: StoryCreationHistorySession) {
  emit("restoreHistorySession", session)
  syncFeedbackHistoryFromSession(session)
  newCreationExpanded.value = false
  creationHistoryExpanded.value = false
}

function getEventKey(event: StoryCreationDraftEvent) {
  return `${event.collectionType}:${event.id}`
}

function getRoleKey(role: StoryCreationDraftRole) {
  return `${role.important ? "important" : "normal"}:${role.id}`
}

function getVariableKey(variable: StoryCreationDraftVariable) {
  return `${variable.group}.${variable.name}`
}

function cloneCreationDraft(draft: StoryCreationDraft): StoryCreationDraft {
  const cloned = JSON.parse(JSON.stringify(toRaw(draft))) as StoryCreationDraft
  cloned.items = cloned.items ?? []
  return cloned
}

function syncEditableDraft(result: RunStoryCreationAgentResponse | null) {
  editableDraft.value = result ? cloneCreationDraft(result.draft) : null
  draftApplied.value = false
}

function resetEditableDraft() {
  syncEditableDraft(props.agentResult)
  syncApplySelection(editableDraft.value)
}

function syncApplySelection(draft: StoryCreationDraft | null) {
  selectedEventKeys.value = draft?.events.map(getEventKey) ?? []
  selectedLocationIds.value = draft?.locations.map((location) => location.id) ?? []
  selectedRoleKeys.value = draft?.roles.map(getRoleKey) ?? []
  selectedItemIds.value = draft?.items.map((item) => item.id) ?? []
  selectedVariableKeys.value = draft?.variables.map(getVariableKey) ?? []
}

function toggleStringSelection(source: string[], value: string, checked: boolean) {
  draftApplied.value = false

  if (checked) {
    return source.includes(value) ? source : [...source, value]
  }

  return source.filter((item) => item !== value)
}

function setEventSelected(event: StoryCreationDraftEvent, checked: boolean) {
  selectedEventKeys.value = toggleStringSelection(selectedEventKeys.value, getEventKey(event), checked)
}

function setLocationSelected(locationId: string, checked: boolean) {
  selectedLocationIds.value = toggleStringSelection(selectedLocationIds.value, locationId, checked)
}

function setRoleSelected(role: StoryCreationDraftRole, checked: boolean) {
  selectedRoleKeys.value = toggleStringSelection(selectedRoleKeys.value, getRoleKey(role), checked)
}

function setItemSelected(itemId: string, checked: boolean) {
  selectedItemIds.value = toggleStringSelection(selectedItemIds.value, itemId, checked)
}

function setVariableSelected(variable: StoryCreationDraftVariable, checked: boolean) {
  selectedVariableKeys.value = toggleStringSelection(
    selectedVariableKeys.value,
    getVariableKey(variable),
    checked
  )
}

function getCheckboxChecked(event: Event) {
  return event.target instanceof HTMLInputElement && event.target.checked
}

function handleLocationSelectionChange(locationId: string, event: Event) {
  setLocationSelected(locationId, getCheckboxChecked(event))
}

function handleRoleSelectionChange(role: StoryCreationDraftRole, event: Event) {
  setRoleSelected(role, getCheckboxChecked(event))
}

function handleItemSelectionChange(itemId: string, event: Event) {
  setItemSelected(itemId, getCheckboxChecked(event))
}

function handleVariableSelectionChange(variable: StoryCreationDraftVariable, event: Event) {
  setVariableSelected(variable, getCheckboxChecked(event))
}

function handleEventSelectionChange(draftEvent: StoryCreationDraftEvent, event: Event) {
  setEventSelected(draftEvent, getCheckboxChecked(event))
}

function applyDraft() {
  if (!editableDraft.value || props.applying || selectedApplyCount.value === 0) {
    return
  }

  emit("applyDraft", editableDraft.value, {
    eventKeys: selectedEventKeys.value,
    locationIds: selectedLocationIds.value,
    roleKeys: selectedRoleKeys.value,
    itemIds: selectedItemIds.value,
    variableKeys: selectedVariableKeys.value
  })
}

function variableValueLabel(variable: StoryCreationDraftVariable) {
  if (variable.value_type === "calc") {
    return variable.calc_rule || "calc"
  }

  if (variable.value === null || typeof variable.value === "undefined") {
    return "空值"
  }

  return String(variable.value)
}

function setVariableValueFromInput(variable: StoryCreationDraftVariable, rawValue: string) {
  if (variable.value_type === "calc") {
    return
  }

  if (rawValue === "") {
    variable.value = null
    return
  }

  if (rawValue === "true") {
    variable.value = true
    return
  }

  if (rawValue === "false") {
    variable.value = false
    return
  }

  const numericValue = Number(rawValue)
  variable.value = Number.isFinite(numericValue) && rawValue.trim() !== "" ? numericValue : rawValue
}

function createImpact(kind: DraftImpactKind, label: string, detail: string): DraftImpact {
  return {
    kind,
    label,
    detail
  }
}

function getLocationImpact(location: { id: string }): DraftImpact {
  return existingLocationIds.value.has(location.id)
    ? createImpact("update", "覆盖", "同 id 地点已存在，应用后会更新说明和提示词，并保留已有图片。")
    : createImpact("create", "新增", "应用后会新增地点。")
}

function getRoleImpact(role: StoryCreationDraftRole): DraftImpact {
  return existingRoleKeys.value.has(getRoleKey(role))
    ? createImpact("update", "覆盖", "同 key 角色已存在，应用后会更新文字设定，并保留已有图片。")
    : createImpact("create", "新增", "应用后会新增角色。")
}

function getItemImpact(item: StoryCreationDraftItem): DraftImpact {
  if (!existingItemCategoryIds.value.has(item.category_id)) {
    return createImpact("skip", "跳过", "物品分类不存在，应用时不会写入。")
  }

  return existingItemIds.value.has(item.id)
    ? createImpact("update", "覆盖", "同 id 物品已存在，应用后会更新文字设定，并保留已有图片。")
    : createImpact("create", "新增", "应用后会写入 items.json5。")
}

function getVariableImpact(variable: StoryCreationDraftVariable): DraftImpact {
  const key = getVariableKey(variable)

  if (variable.group === "system") {
    return createImpact("skip", "跳过", "system 变量由运行时管理，不会自动写入。")
  }

  return existingVariableKeys.value.has(key)
    ? createImpact("skip", "已存在", "同名变量已存在，应用时不会覆盖原值。")
    : createImpact("create", "新增", "应用后会写入 vals.json5。")
}

function getEventImpact(event: StoryCreationDraftEvent): DraftImpact {
  return existingEventKeys.value.has(getEventKey(event))
    ? createImpact("update", "覆盖", "同集合同 id 事件已存在，应用后会替换事件内容。")
    : createImpact("create", "新增", "应用后会新增事件。")
}

function getDraftPresentationDialogues(event: StoryCreationDraftEvent) {
  return event.presentation.type === "dialogue" ? event.presentation.dialogues : []
}

function getPresentationLabel(event: StoryCreationDraftEvent) {
  if (event.presentation.type === "silent") {
    return "静默执行"
  }

  if (event.presentation.type === "message") {
    return "消息提示"
  }

  return `对白 ${event.presentation.dialogues.length} 条`
}

function getImpactClass(impact: DraftImpact) {
  return `creation-impact--${impact.kind}`
}

function getItemCategoryName(categoryId: string) {
  const category = props.story.items.categories.find((item) => item.id === categoryId)
  return category?.name || categoryId
}

function getItemTagsText(item: StoryCreationDraftItem) {
  return item.tags.join(", ")
}

function setItemTagsText(item: StoryCreationDraftItem, rawValue: string) {
  item.tags = rawValue
    .split(/[,\n，、]/g)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function setItemMaxStackFromInput(item: StoryCreationDraftItem, rawValue: string) {
  const parsed = Number(rawValue)
  item.max_stack = Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function ensureScheduleLoop(event: StoryCreationDraftEvent): StoryCreationDraftLoopRule {
  if (!event.loop) {
    event.loop = {
      mode: "daily",
      at: "00:00",
      priority: 100,
      after: [],
      before: []
    }
  }

  return event.loop
}

function getScheduleAt(event: StoryCreationDraftEvent) {
  return event.loop?.at ?? "00:00"
}

function setScheduleAt(event: StoryCreationDraftEvent, rawValue: string) {
  ensureScheduleLoop(event).at = rawValue.trim() || "00:00"
}

function getSchedulePriority(event: StoryCreationDraftEvent) {
  return event.loop?.priority ?? 100
}

function setSchedulePriority(event: StoryCreationDraftEvent, rawValue: string) {
  const parsed = Number(rawValue)
  ensureScheduleLoop(event).priority = Number.isFinite(parsed) ? Math.trunc(parsed) : 100
}

function getScheduleAfterText(event: StoryCreationDraftEvent) {
  return (event.loop?.after ?? []).join(", ")
}

function setScheduleAfterText(event: StoryCreationDraftEvent, rawValue: string) {
  ensureScheduleLoop(event).after = Array.from(
    new Set(
      rawValue
        .split(/[,\n，、]/g)
        .map((id) => id.trim())
        .filter((id) => id && id !== event.id)
    )
  )
}

function getEventApplyWarnings(event: StoryCreationDraftEvent) {
  const warnings: string[] = []
  const missingRoleKeys = new Set<string>()

  if (event.location && !availableLocationIdsForApply.value.has(event.location)) {
    warnings.push(`地点 ${event.location} 未选中且不存在，应用时会清空地点。`)
  }

  for (const objectKey of event.object_keys) {
    if (objectKey !== "player" && !availableRoleKeysForApply.value.has(objectKey)) {
      missingRoleKeys.add(objectKey)
    }
  }

  for (const dialogue of getDraftPresentationDialogues(event)) {
    if (
      dialogue.speaker_type === "object"
      && dialogue.speaker_key !== "player"
      && !availableRoleKeysForApply.value.has(dialogue.speaker_key)
    ) {
      missingRoleKeys.add(dialogue.speaker_key)
    }
  }

  if (missingRoleKeys.size > 0) {
    warnings.push(`角色 ${Array.from(missingRoleKeys).join(", ")} 未选中且不存在，应用时会降级对白说话人。`)
  }

  if (event.collectionType === "chain") {
    const missingNextIds = event.next.filter((nextId) => !availableChainIdsForApply.value.has(nextId))

    if (missingNextIds.length > 0) {
      warnings.push(`后续 ${missingNextIds.join(", ")} 未选中且不存在，应用时会移除连接。`)
    }
  }

  if (event.trigger_mode === "condition" && !event.trigger_expr.trim()) {
    warnings.push("条件触发缺少表达式，应用时会降级为默认触发。")
  }

  if (event.trigger_mode === "invoke" && (event.invoke_params?.length ?? 0) === 0) {
    warnings.push("调用触发缺少参数，应用时会降级为默认触发。")
  }

  if (event.collectionType === "schedule" && !event.loop) {
    warnings.push("定时事件缺少 loop，应用时会使用 daily。")
  }

  if (event.collectionType === "schedule" && event.loop?.at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.loop.at)) {
    warnings.push("定时事件执行时间应使用 HH:mm 格式，例如 00:00。")
  }

  return warnings
}

function collectionTypeLabel(collectionType: StoryCreationDraftEvent["collectionType"]) {
  if (collectionType === "pool") {
    return "事件池"
  }

  if (collectionType === "schedule") {
    return "定时"
  }

  return "链式"
}

function triggerModeLabel(triggerMode: StoryCreationDraftEvent["trigger_mode"]) {
  if (triggerMode === "condition") {
    return "条件"
  }

  if (triggerMode === "invoke") {
    return "调用"
  }

  return "默认"
}

watch(
  () => props.story.storyBible,
  (storyBible) => {
    syncDraft(storyBible)
  },
  { immediate: true }
)

watch(
  () => props.agentResult,
  (result) => {
    syncEditableDraft(result)
    syncApplySelection(editableDraft.value)
    newCreationExpanded.value = !result
    if (result) {
      feedbackText.value = ""
    }
  },
  { immediate: true }
)

watch(
  () => props.applyMessage,
  (message) => {
    if (message) {
      draftApplied.value = true
    }
  }
)

watch(
  () => [props.agentRunning, props.agentRunMode, props.agentError] as const,
  ([running], [previousRunning, previousMode]) => {
    if (previousRunning && previousMode && !running) {
      finishActiveFeedback(props.agentError ? "failed" : "done", props.agentError)
    }
  }
)
</script>

<template>
  <section class="creation-workspace">
    <div class="creation-workspace__main">
      <div class="creation-workspace__head">
        <div>
          <span class="eyebrow">创作</span>
          <h2 class="creation-workspace__title">AI 生成剧情</h2>
        </div>

        <div class="creation-workspace__head-actions">
          <button
            class="btn-secondary creation-history__toggle"
            type="button"
            @click="creationHistoryExpanded = !creationHistoryExpanded"
          >
            创作记录 {{ historySessionCount }}
          </button>
          <div class="creation-workspace__status">
            <span class="creation-workspace__status-label">Agent 模型</span>
            <strong>{{ agentModelSummary }}</strong>
          </div>
        </div>
      </div>

      <section class="creation-command-panel">
        <div v-if="draftPreview" class="creation-command-panel__head">
          <div>
            <span class="eyebrow">New</span>
            <strong>新剧情创作</strong>
          </div>
          <button
            class="btn-secondary"
            type="button"
            @click="newCreationExpanded = !newCreationExpanded"
          >
            {{ showNewCreationForm ? "收起" : "新建创作" }}
          </button>
        </div>

        <template v-if="showNewCreationForm">
          <label class="creation-command">
            <span class="creation-command__label">创作指令</span>
            <textarea
              v-model="commandText"
              class="creation-command__input"
              placeholder="例如：围绕县城第一天暴富后的舆论发酵，生成一组可玩的事件、地点和角色。"
            />
          </label>

          <div class="creation-actions">
            <button
              class="btn-primary"
              type="button"
              :disabled="!canRunAgent"
              @click="runAgent"
            >
              {{ isNewCreationRunning ? "运行中..." : "运行 Agent" }}
            </button>
            <button
              v-if="agentRunning"
              class="btn-secondary"
              type="button"
              @click="emit('abortAgent')"
            >
              中止当前任务
            </button>
            <span class="creation-actions__status">{{ runStatus }}</span>
          </div>
        </template>
      </section>

      <section v-if="creationHistoryExpanded" class="creation-history">
        <div class="creation-history__head">
          <strong>创作记录</strong>
          <span>{{ historySessionCount }} 次创作</span>
        </div>
        <ul v-if="historySessions.length" class="creation-history__list">
          <li
            v-for="session in historySessions"
            :key="session.id"
            class="creation-history__item"
            :class="{ 'creation-history__item--active': activeHistorySessionId === session.id }"
          >
            <button type="button" class="creation-history__button" @click="restoreHistorySession(session)">
              <span
                class="creation-history__status"
                :class="historyStatusClass(session.status)"
              >
                {{ historyStatusLabel(session.status) }}
              </span>
              <span class="creation-history__content">
                <strong>{{ session.title || "未命名创作" }}</strong>
                <span>{{ session.initialInstruction }}</span>
              </span>
              <span class="creation-history__meta">
                {{ formatHistoryTime(session.updatedAt) }} · {{ session.turns.length }} 轮
              </span>
            </button>
          </li>
        </ul>
        <p v-else class="creation-history__empty">还没有创作记录。</p>
      </section>

      <div class="creation-pipeline">
        <div
          v-for="step in pipelineSteps"
          :key="step.role"
          class="creation-pipeline__step"
          :class="{
            'creation-pipeline__step--active': agentRunning,
            'creation-pipeline__step--done': loggedRoles.has(step.role)
          }"
        >
          <span>{{ step.label }}</span>
        </div>
      </div>

      <section class="creation-results" aria-label="AI 生成草稿">
        <div v-if="draftPreview" class="creation-result">
          <section class="creation-feedback">
            <div class="creation-feedback__head">
              <div>
                <span class="eyebrow">Feedback</span>
                <strong>反馈优化</strong>
              </div>
              <div class="creation-feedback__actions">
                <button
                  class="btn-primary"
                  type="button"
                  :disabled="!canRefineDraft"
                  @click="refineDraft"
                >
                  {{ isFeedbackRunning ? "优化中..." : "反馈优化" }}
                </button>
                <button
                  v-if="agentRunning"
                  class="btn-secondary"
                  type="button"
                  @click="abortAgent"
                >
                  {{ abortAgentLabel }}
                </button>
              </div>
          </div>
            <div v-if="isFeedbackRunning" class="creation-feedback__status">
              <span class="creation-feedback__dot" aria-hidden="true" />
              <strong>优化中</strong>
              <span>{{ activeFeedbackItem?.content ?? "正在处理反馈" }}</span>
            </div>
            <textarea
              v-model="feedbackText"
              class="creation-feedback__input"
              placeholder="例如：人口统计事件需要按县城级别、教育、就业拆出变量，并且放在每日发钱之前执行。"
            />
            <ul v-if="feedbackHistory.length" class="creation-feedback-history">
              <li
                v-for="item in feedbackHistory"
                :key="item.id"
                class="creation-feedback-history__item"
              >
                <span
                  class="creation-feedback-history__state"
                  :class="getFeedbackStatusClass(item.status)"
                >
                  {{ feedbackStatusLabel(item.status, item.mode) }}
                </span>
                <p>{{ item.content }}</p>
                <small v-if="item.error">{{ item.error }}</small>
              </li>
            </ul>
          </section>

          <div class="creation-result__header">
            <div>
              <span class="eyebrow">Draft</span>
              <input
                v-model="draftPreview.title"
                class="creation-inline-input creation-inline-input--title"
                aria-label="草稿标题"
              >
            </div>
            <div class="creation-result__metrics">
              <span>链式 {{ eventTypeSummary.chain }}</span>
              <span>事件池 {{ eventTypeSummary.pool }}</span>
              <span>定时 {{ eventTypeSummary.schedule }}</span>
            </div>
          </div>

          <div class="creation-apply-bar">
            <div class="creation-apply-bar__copy">
              <strong>已选 {{ selectedApplyCount }} 项</strong>
              <span>{{ applyPreviewMessage }}</span>
            </div>
            <div class="creation-apply-bar__actions">
              <button
                class="btn-secondary"
                type="button"
                :disabled="applying || !agentResult"
                @click="resetEditableDraft"
              >
                重置草稿
              </button>
              <button
                class="btn-primary"
                :class="{ 'btn-primary--success': draftApplied }"
                type="button"
                :disabled="!canApplyDraft"
                @click="applyDraft"
              >
                {{ applyButtonLabel }}
              </button>
            </div>
          </div>

          <div v-if="draftApplied && applyMessage" class="creation-apply-success" role="status">
            <strong>应用成功</strong>
            <span>{{ applyMessage }}</span>
          </div>

          <ul v-if="applyWarnings.length" class="creation-apply-warnings">
            <li v-for="warning in applyWarnings" :key="warning">
              {{ warning }}
            </li>
          </ul>

          <label class="creation-edit-field">
            <span>摘要</span>
            <textarea v-model="draftPreview.summary" class="creation-edit-textarea" rows="2" />
          </label>
          <label class="creation-edit-field">
            <span>篇章</span>
            <input v-model="draftPreview.arc" class="creation-edit-input">
          </label>

          <div class="creation-result__grid">
            <section class="creation-result__section">
              <h4 class="creation-result__section-title">Agent 日志</h4>
              <ul class="creation-log-list">
                <li
                  v-for="log in agentLogs"
                  :key="log.role"
                  class="creation-log-list__item"
                >
                  <strong>{{ log.title }}</strong>
                  <span>{{ log.summary }}</span>
                </li>
              </ul>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">地点</h4>
              <ul v-if="draftPreview.locations.length" class="creation-chip-list">
                <li
                  v-for="location in draftPreview.locations"
                  :key="location.id"
                  class="creation-chip-list__item"
                >
                  <label class="creation-select">
                    <input
                      type="checkbox"
                      :checked="selectedLocationIds.includes(location.id)"
                      @change="handleLocationSelectionChange(location.id, $event)"
                    >
                  </label>
                  <strong>{{ location.id }}</strong>
                  <span
                    class="creation-impact"
                    :class="getImpactClass(getLocationImpact(location))"
                    :title="getLocationImpact(location).detail"
                  >
                    {{ getLocationImpact(location).label }}
                  </span>
                  <label class="creation-edit-field">
                    <span>说明</span>
                    <input v-model="location.descr" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>提示词</span>
                    <textarea v-model="location.prompt" class="creation-edit-textarea" rows="2" />
                  </label>
                </li>
              </ul>
              <p v-else class="creation-result__muted">未生成地点草稿。</p>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">角色</h4>
              <ul v-if="draftPreview.roles.length" class="creation-chip-list">
                <li
                  v-for="role in draftPreview.roles"
                  :key="getRoleKey(role)"
                  class="creation-chip-list__item"
                >
                  <label class="creation-select">
                    <input
                      type="checkbox"
                      :checked="selectedRoleKeys.includes(getRoleKey(role))"
                      @change="handleRoleSelectionChange(role, $event)"
                    >
                  </label>
                  <strong>{{ role.important ? "important" : "normal" }}:{{ role.id }}</strong>
                  <span
                    class="creation-impact"
                    :class="getImpactClass(getRoleImpact(role))"
                    :title="getRoleImpact(role).detail"
                  >
                    {{ getRoleImpact(role).label }}
                  </span>
                  <label class="creation-edit-field">
                    <span>名称</span>
                    <input v-model="role.name" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>身份</span>
                    <input v-model="role.zhiye" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>设定</span>
                    <textarea v-model="role.descr" class="creation-edit-textarea" rows="2" />
                  </label>
                  <label class="creation-edit-field">
                    <span>提示词</span>
                    <textarea v-model="role.prompt" class="creation-edit-textarea" rows="2" />
                  </label>
                </li>
              </ul>
              <p v-else class="creation-result__muted">未生成角色草稿。</p>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">物品</h4>
              <ul v-if="draftPreview.items.length" class="creation-chip-list">
                <li
                  v-for="item in draftPreview.items"
                  :key="item.id"
                  class="creation-chip-list__item"
                >
                  <label class="creation-select">
                    <input
                      type="checkbox"
                      :checked="selectedItemIds.includes(item.id)"
                      @change="handleItemSelectionChange(item.id, $event)"
                    >
                  </label>
                  <strong>{{ item.id }}</strong>
                  <span
                    class="creation-impact"
                    :class="getImpactClass(getItemImpact(item))"
                    :title="getItemImpact(item).detail"
                  >
                    {{ getItemImpact(item).label }}
                  </span>
                  <label class="creation-edit-field">
                    <span>名称</span>
                    <input v-model="item.name" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>分类</span>
                    <select v-model="item.category_id" class="creation-edit-input">
                      <option
                        v-if="item.category_id && !existingItemCategoryIds.has(item.category_id)"
                        :value="item.category_id"
                      >
                        缺失：{{ item.category_id }}
                      </option>
                      <option
                        v-for="category in story.items.categories"
                        :key="category.id"
                        :value="category.id"
                      >
                        {{ category.name || category.id }}
                      </option>
                    </select>
                  </label>
                  <div class="creation-item-flags">
                    <label class="creation-item-flags__check">
                      <input v-model="item.stackable" type="checkbox">
                      可堆叠
                    </label>
                    <label class="creation-item-flags__check">
                      <input v-model="item.usable" type="checkbox">
                      可使用
                    </label>
                  </div>
                  <label class="creation-edit-field">
                    <span>稀有度</span>
                    <input v-model="item.rarity" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>最大堆叠</span>
                    <input
                      class="creation-edit-input"
                      min="1"
                      type="number"
                      :value="item.max_stack"
                      @input="setItemMaxStackFromInput(item, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                  <label class="creation-edit-field">
                    <span>标签</span>
                    <input
                      class="creation-edit-input"
                      :value="getItemTagsText(item)"
                      @input="setItemTagsText(item, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                  <label class="creation-edit-field">
                    <span>说明</span>
                    <textarea v-model="item.descr" class="creation-edit-textarea" rows="2" />
                  </label>
                  <label class="creation-edit-field">
                    <span>提示词</span>
                    <textarea v-model="item.prompt" class="creation-edit-textarea" rows="2" />
                  </label>
                  <small class="creation-result__muted">
                    分类：{{ getItemCategoryName(item.category_id) }}
                  </small>
                </li>
              </ul>
              <p v-else class="creation-result__muted">未生成物品草稿。</p>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">变量建议</h4>
              <ul v-if="draftPreview.variables.length" class="creation-chip-list">
                <li
                  v-for="variable in draftPreview.variables"
                  :key="getVariableKey(variable)"
                  class="creation-chip-list__item"
                >
                  <label class="creation-select">
                    <input
                      type="checkbox"
                      :checked="selectedVariableKeys.includes(getVariableKey(variable))"
                      @change="handleVariableSelectionChange(variable, $event)"
                    >
                  </label>
                  <strong>{{ getVariableKey(variable) }}</strong>
                  <span
                    class="creation-impact"
                    :class="getImpactClass(getVariableImpact(variable))"
                    :title="getVariableImpact(variable).detail"
                  >
                    {{ getVariableImpact(variable).label }}
                  </span>
                  <label class="creation-edit-field">
                    <span>描述</span>
                    <input v-model="variable.description" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>{{ variable.value_type === "calc" ? "计算式" : "初始值" }}</span>
                    <input
                      v-if="variable.value_type !== 'calc'"
                      class="creation-edit-input"
                      :value="variableValueLabel(variable) === '空值' ? '' : variableValueLabel(variable)"
                      @input="setVariableValueFromInput(variable, ($event.target as HTMLInputElement).value)"
                    >
                    <input
                      v-else
                      v-model="variable.calc_rule"
                      class="creation-edit-input"
                    >
                  </label>
                </li>
              </ul>
              <p v-else class="creation-result__muted">未生成变量建议。</p>
            </section>
          </div>

          <section class="creation-result__section creation-result__section--events">
            <h4 class="creation-result__section-title">事件草稿</h4>
            <ul class="creation-event-list">
              <li
                v-for="event in draftPreview.events"
                :key="`${event.collectionType}:${event.id}`"
                class="creation-event-list__item"
              >
                <label class="creation-select creation-select--event">
                  <input
                    type="checkbox"
                    :checked="selectedEventKeys.includes(getEventKey(event))"
                    @change="handleEventSelectionChange(event, $event)"
                  >
                </label>
                <div class="creation-event-list__head">
                  <input
                    v-model="event.title"
                    class="creation-inline-input"
                    aria-label="事件标题"
                  >
                  <div class="creation-event-list__badges">
                    <span>
                      {{ collectionTypeLabel(event.collectionType) }} /
                      {{ triggerModeLabel(event.trigger_mode) }} /
                      {{ getPresentationLabel(event) }}
                    </span>
                    <span
                      class="creation-impact"
                      :class="getImpactClass(getEventImpact(event))"
                      :title="getEventImpact(event).detail"
                    >
                      {{ getEventImpact(event).label }}
                    </span>
                  </div>
                </div>
                <code>{{ event.id }}</code>
                <div class="creation-event-edit-grid">
                  <label class="creation-edit-field">
                    <span>地点</span>
                    <input v-model="event.location" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>触发</span>
                    <select v-model="event.trigger_mode" class="creation-edit-input">
                      <option value="default">默认触发</option>
                      <option value="condition">条件触发</option>
                      <option value="invoke">调用触发</option>
                    </select>
                  </label>
                  <label
                    v-if="event.trigger_mode === 'condition'"
                    class="creation-edit-field creation-event-edit-grid__wide"
                  >
                    <span>条件表达式</span>
                    <textarea v-model="event.trigger_expr" class="creation-edit-textarea" rows="2" />
                  </label>
                </div>
                <div
                  v-if="event.collectionType === 'schedule'"
                  class="creation-event-edit-grid"
                >
                  <label class="creation-edit-field">
                    <span>执行时间</span>
                    <input
                      class="creation-edit-input"
                      type="time"
                      step="60"
                      :value="getScheduleAt(event)"
                      @input="setScheduleAt(event, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                  <label class="creation-edit-field">
                    <span>优先级</span>
                    <input
                      class="creation-edit-input"
                      type="number"
                      step="1"
                      :value="getSchedulePriority(event)"
                      @input="setSchedulePriority(event, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                  <label class="creation-edit-field creation-event-edit-grid__wide">
                    <span>前置事件 after</span>
                    <input
                      class="creation-edit-input"
                      :value="getScheduleAfterText(event)"
                      @input="setScheduleAfterText(event, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                </div>
                <label
                  v-if="event.presentation.type === 'dialogue' && event.presentation.dialogues[0]"
                  class="creation-edit-field"
                >
                  <span>首句对白</span>
                  <textarea v-model="event.presentation.dialogues[0].content" class="creation-edit-textarea" rows="3" />
                </label>
                <div
                  v-else-if="event.presentation.type === 'message'"
                  class="creation-event-edit-grid"
                >
                  <label class="creation-edit-field">
                    <span>提示消息</span>
                    <textarea
                      v-model="event.presentation.message.content"
                      class="creation-edit-textarea"
                      rows="3"
                    />
                  </label>
                  <label class="creation-edit-field">
                    <span>显示秒数</span>
                    <input
                      v-model.number="event.presentation.message.duration_seconds"
                      class="creation-edit-input"
                      min="0"
                      step="0.5"
                      type="number"
                    >
                  </label>
                </div>
                <p v-else>
                  {{
                    event.presentation.type === "silent"
                      ? "静默执行：只运行脚本和后续推进。"
                      : "无对白预览"
                  }}
                </p>
                <div class="creation-event-edit-grid">
                  <label class="creation-edit-field">
                    <span>开场脚本</span>
                    <textarea v-model="event.init_script" class="creation-edit-textarea" rows="3" />
                  </label>
                  <label class="creation-edit-field">
                    <span>结束脚本</span>
                    <textarea v-model="event.end_script" class="creation-edit-textarea" rows="3" />
                  </label>
                </div>
                <div class="creation-event-list__meta">
                  <span v-if="event.location">地点 {{ event.location }}</span>
                  <span v-if="event.object_keys.length">对象 {{ event.object_keys.join(", ") }}</span>
                  <span v-if="event.next.length">后续 {{ event.next.join(", ") }}</span>
                </div>
                <ul v-if="getEventApplyWarnings(event).length" class="creation-event-warnings">
                  <li v-for="warning in getEventApplyWarnings(event)" :key="warning">
                    {{ warning }}
                  </li>
                </ul>
              </li>
            </ul>
          </section>

          <section
            v-if="draftPreview.notes.length || draftPreview.warnings.length"
            class="creation-result__section creation-result__section--notes"
          >
            <h4 class="creation-result__section-title">说明和告警</h4>
            <ul class="creation-note-list">
              <li v-for="note in draftPreview.notes" :key="`note:${note}`">
                {{ note }}
              </li>
              <li
                v-for="warning in draftPreview.warnings"
                :key="`warning:${warning}`"
                class="creation-note-list__warning"
              >
                {{ warning }}
              </li>
            </ul>
          </section>
        </div>

        <div v-else class="creation-results__empty">
          {{ agentRunning ? "正在等待多 Agent 返回结构化草稿..." : "输入创作指令后可运行后台创作 Agent。" }}
        </div>
      </section>
    </div>

    <aside class="creation-workspace__bible">
      <div class="story-bible__header">
        <div>
          <span class="eyebrow">Bible</span>
          <h2 class="story-bible__title">创作设定</h2>
        </div>

        <div class="story-bible__counter">
          {{ filledBibleFieldCount }} / {{ bibleFields.length }}
        </div>
      </div>

      <div class="story-bible__tabs" role="tablist" aria-label="创作设定">
        <button
          v-for="field in bibleFields"
          :key="field.key"
          class="story-bible__tab"
          :class="{ 'story-bible__tab--active': activeBibleField === field.key }"
          type="button"
          role="tab"
          :aria-selected="activeBibleField === field.key"
          @click="activeBibleField = field.key"
        >
          {{ field.label }}
        </button>
      </div>

      <label v-if="activeBibleFieldConfig" class="story-bible__editor">
        <span class="story-bible__label">{{ activeBibleFieldConfig.label }}</span>
        <textarea
          v-model="draft[activeBibleFieldConfig.key]"
          class="story-bible__textarea"
          :placeholder="activeBibleFieldConfig.placeholder"
        />
      </label>

      <div class="story-bible__actions">
        <button class="btn-primary" type="button" :disabled="saving" @click="submitStoryBible">
          {{ saving ? "保存中..." : "保存设定" }}
        </button>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.creation-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.75fr);
  gap: 10px;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.creation-workspace__main,
.creation-workspace__bible {
  min-width: 0;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(5, 12, 20, 0.82);
}

.creation-workspace__main {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  gap: 12px;
  padding: 16px;
  border-radius: 18px 0 0 18px;
}

.creation-workspace__bible {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 12px;
  padding: 16px;
  border-radius: 0 18px 18px 0;
}

.creation-workspace__head,
.story-bible__header,
.creation-actions,
.story-bible__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.creation-workspace__title,
.story-bible__title {
  margin: 6px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.18rem;
  line-height: 1.1;
}

.creation-workspace__status,
.story-bible__counter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  font-size: 0.8rem;
  white-space: nowrap;
}

.creation-workspace__status strong {
  color: var(--text);
  font-weight: 600;
}

.creation-workspace__status-label {
  color: var(--text-muted);
}

.creation-workspace__head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.creation-history__toggle {
  min-height: 34px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.8rem;
}

.creation-command,
.story-bible__editor {
  display: grid;
  gap: 8px;
  min-height: 0;
}

.creation-command-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.creation-command-panel__head,
.creation-feedback__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.creation-feedback__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.creation-command-panel__head strong,
.creation-feedback__head strong {
  display: block;
  margin-top: 2px;
  color: var(--text);
  font-size: 0.9rem;
}

.creation-command__label,
.story-bible__label {
  color: var(--text-muted);
  font-size: 0.84rem;
}

.creation-command__input,
.story-bible__textarea {
  width: 100%;
  min-height: 0;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  line-height: 1.6;
  resize: none;
}

.creation-command__input {
  min-height: 132px;
}

.creation-feedback {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(255, 180, 84, 0.26);
  border-radius: 10px;
  background: rgba(255, 180, 84, 0.07);
}

.creation-feedback__input {
  width: 100%;
  min-height: 86px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.14);
  color: var(--text);
  line-height: 1.55;
  resize: vertical;
}

.creation-feedback__status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid rgba(255, 180, 84, 0.32);
  border-radius: 8px;
  background: rgba(255, 180, 84, 0.1);
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.35;
}

.creation-feedback__status strong {
  color: #ffb454;
  font-size: 0.8rem;
  white-space: nowrap;
}

.creation-feedback__status span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creation-feedback__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #ffb454;
  box-shadow: 0 0 0 4px rgba(255, 180, 84, 0.12);
  flex: 0 0 auto;
}

.creation-feedback-history {
  display: grid;
  gap: 6px;
  max-height: 150px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

.creation-feedback-history__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 8px;
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.12);
}

.creation-feedback-history__item > * {
  align-self: start;
}

.creation-feedback-history__item p {
  margin: 0;
  min-width: 0;
  color: var(--text);
  font-size: 0.8rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.creation-feedback-history__item small {
  grid-column: 2;
  color: #ff8b7b;
  font-size: 0.74rem;
  line-height: 1.4;
  white-space: pre-wrap;
}

.creation-feedback-history__state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  width: fit-content;
  padding: 2px 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap;
}

.creation-feedback-history__state--running {
  border-color: rgba(255, 180, 84, 0.36);
  background: rgba(255, 180, 84, 0.1);
  color: #ffb454;
}

.creation-feedback-history__state--done {
  border-color: rgba(124, 227, 195, 0.34);
  background: rgba(124, 227, 195, 0.1);
  color: #7ce3c3;
}

.creation-feedback-history__state--failed,
.creation-feedback-history__state--cancelled {
  border-color: rgba(255, 139, 123, 0.34);
  background: rgba(255, 139, 123, 0.1);
  color: #ff8b7b;
}

.creation-command__input:focus,
.creation-feedback__input:focus,
.story-bible__textarea:focus {
  outline: 1px solid rgba(255, 180, 84, 0.65);
  border-color: rgba(255, 180, 84, 0.65);
}

.creation-actions__status {
  color: var(--text-muted);
  font-size: 0.84rem;
}

.creation-history {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
}

.creation-history__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.creation-history__head strong {
  color: var(--text);
  font-size: 0.88rem;
}

.creation-history__head span,
.creation-history__empty {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.creation-history__list {
  display: grid;
  gap: 6px;
  max-height: 188px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

.creation-history__item {
  min-width: 0;
}

.creation-history__button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.12);
  color: inherit;
  text-align: left;
}

.creation-history__button:hover,
.creation-history__item--active .creation-history__button {
  border-color: rgba(124, 227, 195, 0.35);
  background: rgba(124, 227, 195, 0.08);
}

.creation-history__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
}

.creation-history__status--applied {
  border-color: rgba(124, 227, 195, 0.34);
  background: rgba(124, 227, 195, 0.1);
  color: #7ce3c3;
}

.creation-history__status--draft,
.creation-history__status--running {
  border-color: rgba(255, 180, 84, 0.34);
  background: rgba(255, 180, 84, 0.1);
  color: #ffb454;
}

.creation-history__status--failed,
.creation-history__status--cancelled {
  border-color: rgba(255, 139, 123, 0.34);
  background: rgba(255, 139, 123, 0.1);
  color: #ff8b7b;
}

.creation-history__content {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.creation-history__content strong,
.creation-history__content span,
.creation-history__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creation-history__content strong {
  color: var(--text);
  font-size: 0.82rem;
}

.creation-history__content span,
.creation-history__meta {
  color: var(--text-muted);
  font-size: 0.76rem;
}

.creation-history__meta {
  justify-self: end;
}

.creation-history__empty {
  margin: 0;
}

.creation-pipeline {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.creation-pipeline__step {
  display: grid;
  place-items: center;
  min-height: 40px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  font-size: 0.82rem;
}

.creation-pipeline__step--active {
  border-color: rgba(255, 180, 84, 0.32);
}

.creation-pipeline__step--done {
  border-color: rgba(124, 227, 195, 0.36);
  background: rgba(124, 227, 195, 0.1);
  color: var(--text);
}

.creation-results {
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.creation-results__empty {
  display: grid;
  place-items: center;
  min-height: 100%;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  color: var(--text-muted);
  font-size: 0.9rem;
  text-align: center;
}

.creation-result {
  display: grid;
  gap: 12px;
}

.creation-result__header,
.creation-event-list__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.creation-result__title {
  margin: 5px 0 0;
  font-size: 1rem;
  line-height: 1.25;
}

.creation-inline-input,
.creation-edit-input,
.creation-edit-textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.16);
  color: var(--text);
  font: inherit;
  line-height: 1.35;
  outline: none;
}

.creation-inline-input:focus,
.creation-edit-input:focus,
.creation-edit-textarea:focus {
  border-color: rgba(124, 227, 195, 0.44);
  background: rgba(0, 0, 0, 0.22);
}

.creation-inline-input {
  padding: 6px 8px;
  font-weight: 700;
}

.creation-inline-input--title {
  margin-top: 5px;
  max-width: 520px;
  font-size: 1rem;
}

.creation-edit-field {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.creation-edit-field span {
  color: var(--text-muted);
  font-size: 0.74rem;
  line-height: 1.2;
}

.creation-edit-input {
  min-height: 30px;
  padding: 5px 8px;
  font-size: 0.8rem;
}

.creation-edit-textarea {
  resize: vertical;
  min-height: 48px;
  padding: 6px 8px;
  font-size: 0.8rem;
}

.creation-item-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.creation-item-flags__check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.14);
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.2;
}

.creation-item-flags__check input {
  width: 14px;
  height: 14px;
  accent-color: #7ce3c3;
}

.creation-result__metrics,
.creation-event-list__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--text-muted);
  font-size: 0.76rem;
}

.creation-result__metrics span,
.creation-event-list__meta span {
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.creation-apply-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid rgba(124, 227, 195, 0.22);
  border-radius: 10px;
  background: rgba(124, 227, 195, 0.08);
}

.creation-apply-bar__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.creation-apply-bar__copy strong {
  color: var(--text);
  font-size: 0.88rem;
}

.creation-apply-bar__copy span {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.creation-apply-bar__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.btn-primary--success {
  background: linear-gradient(135deg, #9cf3da 0%, #49cba3 100%);
  color: #042317;
}

.btn-primary--success:hover {
  transform: none;
}

.creation-apply-success {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid rgba(124, 227, 195, 0.42);
  border-radius: 10px;
  background: rgba(124, 227, 195, 0.14);
  color: var(--text);
  box-shadow: 0 0 0 1px rgba(124, 227, 195, 0.08) inset;
}

.creation-apply-success strong {
  flex: 0 0 auto;
  color: #7ce3c3;
  font-size: 0.86rem;
}

.creation-apply-success span {
  min-width: 0;
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.creation-apply-warnings {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(255, 180, 84, 0.32);
  border-radius: 10px;
  background: rgba(255, 180, 84, 0.08);
  color: #ffb454;
  font-size: 0.8rem;
  line-height: 1.45;
  list-style-position: inside;
}

.creation-result__summary,
.creation-result__arc {
  margin: 0;
  color: var(--text);
  line-height: 1.55;
}

.creation-result__arc {
  color: var(--text-muted);
  font-size: 0.86rem;
}

.creation-result__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.creation-result__section {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
}

.creation-result__section--events,
.creation-result__section--notes {
  padding: 12px;
}

.creation-result__section-title {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 600;
}

.creation-log-list,
.creation-chip-list,
.creation-event-list,
.creation-note-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.creation-log-list__item,
.creation-chip-list__item,
.creation-event-list__item {
  position: relative;
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 8px 8px 8px 34px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.12);
  line-height: 1.45;
}

.creation-log-list__item {
  padding-left: 8px;
}

.creation-chip-list__item--plain {
  padding-left: 8px;
}

.creation-select {
  position: absolute;
  top: 9px;
  left: 9px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
}

.creation-select input {
  width: 16px;
  height: 16px;
  accent-color: #7ce3c3;
}

.creation-select--event {
  top: 11px;
}

.creation-log-list__item strong,
.creation-chip-list__item strong,
.creation-event-list__item strong {
  color: var(--text);
  font-size: 0.86rem;
}

.creation-log-list__item span,
.creation-chip-list__item span,
.creation-event-list__item p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.82rem;
  white-space: pre-wrap;
}

.creation-impact {
  width: fit-content;
  padding: 2px 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  font-size: 0.72rem !important;
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap !important;
}

.creation-impact--create {
  border-color: rgba(124, 227, 195, 0.32);
  background: rgba(124, 227, 195, 0.1);
  color: #7ce3c3 !important;
}

.creation-impact--update {
  border-color: rgba(255, 180, 84, 0.34);
  background: rgba(255, 180, 84, 0.1);
  color: #ffb454 !important;
}

.creation-impact--skip {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted) !important;
}

.creation-event-list__item code {
  width: fit-content;
  color: rgba(124, 227, 195, 0.92);
  font-size: 0.76rem;
}

.creation-event-list__badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.creation-event-edit-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.creation-event-edit-grid__wide {
  grid-column: 1 / -1;
}

.creation-event-list__head span {
  color: var(--text-muted);
  font-size: 0.78rem;
  white-space: nowrap;
}

.creation-event-warnings {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 6px 8px 6px 22px;
  border: 1px solid rgba(255, 180, 84, 0.24);
  border-radius: 8px;
  background: rgba(255, 180, 84, 0.07);
  color: #ffb454;
  font-size: 0.76rem;
  line-height: 1.45;
}

.creation-note-list li {
  color: var(--text-muted);
  font-size: 0.84rem;
  line-height: 1.45;
}

.creation-note-list__warning {
  color: #ffb454 !important;
}

.creation-result__muted {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.story-bible__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.story-bible__tab {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  font-size: 0.8rem;
  white-space: nowrap;
}

.story-bible__tab:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.07);
}

.story-bible__tab--active {
  border-color: rgba(255, 180, 84, 0.55);
  background: rgba(255, 180, 84, 0.18);
  color: var(--text);
}

.story-bible__textarea {
  height: 100%;
}

.story-bible__actions {
  justify-content: flex-end;
}

@media (max-width: 1080px) {
  .creation-workspace {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .creation-workspace__main,
  .creation-workspace__bible {
    border-radius: 18px;
  }

  .creation-workspace__main {
    min-height: 520px;
  }

  .creation-workspace__bible {
    min-height: 520px;
  }

  .creation-results {
    min-height: 420px;
  }

  .creation-pipeline {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .creation-result__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .creation-workspace__head,
  .story-bible__header,
  .creation-actions,
  .story-bible__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .creation-pipeline {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .creation-result__header,
  .creation-event-list__head,
  .creation-apply-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .creation-apply-bar__actions,
  .creation-event-edit-grid {
    grid-template-columns: 1fr;
  }

  .creation-apply-bar__actions {
    flex-direction: column;
    justify-content: stretch;
  }
}
</style>
