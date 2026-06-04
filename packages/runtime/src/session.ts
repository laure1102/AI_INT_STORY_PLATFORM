import {
  evaluateStoryBooleanExpression,
  executeStoryScript,
  renderStoryTextTemplate
} from "./vals"
import type { StoryScriptExecutionContext } from "./vals"
import type {
  StoryPlayerOverrideValsFile,
  StoryValDefinition,
  StoryValEntryDefinition,
  StoryValsFile
} from "./types"

interface RuntimeStoryDialogueDefinition {
  speaker_type: "player" | "object"
  speaker_key: string
  content: string
}

interface RuntimeLocationAssignment {
  name: string
  descr: string
}

interface RuntimeNormalRoleDefinition {
  name: string
  descr: string
}

interface RuntimeImportantRoleDefinition {
  name: string
  descr: string
}

interface CompiledEvent {
  node_type?: "event"
  id: string
  title: string
  trigger_expr: string
  init_script: string
  end_script: string
  object_keys: string[]
  dialogues: RuntimeStoryDialogueDefinition[]
  location: string
  next: string[]
  meta?: Record<string, unknown>
}

interface CompiledAction {
  node_type?: "action"
  id: string
  title: string
  vars: Array<{
    name: string
    descr?: string
    initial_value: string
  }>
  exec_script: string
  next: string[]
  meta?: Record<string, unknown>
}

export interface RuntimeProfileCustomFile {
  profile_id: string
  story_id: string
  profile_name: string
  created_at: string
  custom_values: Record<string, unknown>
  player_setup?: RuntimePlayerProfileSetup
}

export interface RuntimePlayerProfileSetup {
  player_surname: string
  player_given_name: string
  player_name?: string
  county_name: string
  county_short_name: string
  city_name: string
  province_name: string
}

export interface RuntimeStorySaveState {
  slot_id: string
  story_id: string
  profile_id: string
  bundle_version: string
  saved_at: string
  session_state: RuntimeStorySessionSnapshot
}

export interface RuntimeTriggeredBigOnceState {
  event_id: string
  triggered_at: string
}

export interface RuntimeLoopEventState {
  event_id: string
  last_triggered_at?: string
  last_triggered_day?: number
  trigger_count: number
}

export interface RuntimeHistoryEntry {
  type: "event" | "action" | "dialogue" | "system"
  id: string
  title?: string
  content?: string
  timestamp: string
}

export interface RuntimeStorySessionSnapshot {
  current_event_id: string | null
  vals: StoryValsFile
  system_vals: StoryValsFile
  triggered_big_once_events: RuntimeTriggeredBigOnceState[]
  loop_event_states: RuntimeLoopEventState[]
  history: RuntimeHistoryEntry[]
}

export interface RuntimeStoryBundle {
  storyId: string
  title: string
  generatedAt: string
  entryEventId?: string
  vals: StoryValsFile
  playerOverrideVals: StoryPlayerOverrideValsFile
  systemVals: StoryValsFile
  scenes: unknown
  roles: unknown
  eventLocations: unknown
  graphEvents: Record<string, unknown>
  bigOnceEvents: unknown[]
  loopEvents: unknown[]
}

export type RuntimeInteraction =
  | {
      kind: "select"
      prompt: string
      options: Array<{
        id: string
        label: string
        description?: string
      }>
    }
  | {
      kind: "text-input"
      prompt: string
      field: string
      initialValue?: string
      placeholder?: string
    }
  | {
      kind: "confirm"
      prompt: string
      confirmLabel?: string
      cancelLabel?: string
    }
  | null

export interface RuntimeRenderedDialogue {
  index: number
  total: number
  speakerLabel: string
  speakerKey: string
  content: string
}

export interface RuntimeBranchOptionView {
  id: string
  title: string
  nextEventId: string | null
  vars: Array<{
    name: string
    descr?: string
    initialValue: string
  }>
}

export interface RuntimeStoryViewModel {
  screen: "boot" | "profile" | "save-select" | "game" | "debug"
  storyTitle: string
  activeEventId: string | null
  activeEventTitle: string | null
  interaction: RuntimeInteraction
  notifications: string[]
  currentLocationName: string | null
  currentSceneLevel: number | null
  currentDialogue: RuntimeRenderedDialogue | null
  availableBranches: RuntimeBranchOptionView[]
  branchContextSummary: Array<{
    key: string
    value: string
  }>
  debugSummary: {
    globalGroupCount: number
    systemGroupCount: number
    historyCount: number
    triggeredBigOnceCount: number
  }
}

export type RuntimeStorySessionAction =
  | { type: "continue" }
  | { type: "select-option"; optionId: string }
  | { type: "submit-text"; field: string; value: string }
  | { type: "open-debug" }
  | { type: "close-debug" }

export interface CreateStorySessionOptions {
  bundle: RuntimeStoryBundle
  customOverrides?: RuntimeProfileCustomFile | null
  saveState?: RuntimeStorySaveState | null
  now?: Date
}

export interface RuntimeStorySession {
  dispatch(action: RuntimeStorySessionAction): void
  getViewModel(): RuntimeStoryViewModel
  getSnapshot(): RuntimeStorySessionSnapshot
}

interface RuntimeActionState {
  nodeId: string
  branchValues: Record<string, unknown>
}

interface RuntimeState {
  snapshot: RuntimeStorySessionSnapshot
  currentEventEntered: boolean
  currentDialogueIndex: number
  pendingActions: RuntimeActionState[]
  lastAction: RuntimeActionState | null
}

interface RuntimeDialogueNodeState {
  node: CompiledEvent
  currentDialogue: RuntimeRenderedDialogue | null
  availableActions: RuntimeActionState[]
  autoNextEventId: string | null
  locationName: string | null
}

type RuntimeGraphNode = CompiledEvent | CompiledAction

const DEFAULT_MAX_CALC_NESTING_DEPTH = 5

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

function cloneValsFile(vals: StoryValsFile): StoryValsFile {
  return {
    variables: vals.variables.map((group) => ({
      name: group.name,
      description: group.description,
      vals: group.vals.map((row) => ({
        name: row.name,
        description: row.description,
        value_type: row.value_type,
        value: cloneValue(row.value),
        calc_rule: row.calc_rule
      }))
    }))
  }
}

function createCombinedValsFile(snapshot: RuntimeStorySessionSnapshot): StoryValsFile {
  return {
    variables: [
      ...cloneValsFile(snapshot.vals).variables,
      ...cloneValsFile(snapshot.system_vals).variables
    ]
  }
}

function applyCombinedValsFile(
  snapshot: RuntimeStorySessionSnapshot,
  nextValsFile: StoryValsFile
) {
  const globalGroupNames = new Set(snapshot.vals.variables.map((group) => group.name.trim()))
  const systemGroupNames = new Set(snapshot.system_vals.variables.map((group) => group.name.trim()))

  snapshot.vals = {
    variables: nextValsFile.variables
      .filter((group) => globalGroupNames.has(group.name.trim()))
      .map((group) => cloneValue(group))
  }

  snapshot.system_vals = {
    variables: nextValsFile.variables
      .filter((group) => systemGroupNames.has(group.name.trim()))
      .map((group) => cloneValue(group))
  }
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function formatValueSummary(value: unknown) {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function findValEntry(
  valsFile: StoryValsFile,
  token: string
): { group: StoryValDefinition; row: StoryValEntryDefinition } | null {
  const [groupName, rowName, ...rest] = token.split(".")

  if (!groupName || !rowName || rest.length > 0) {
    return null
  }

  const group = valsFile.variables.find((item) => item.name.trim() === groupName.trim())
  if (!group) {
    return null
  }

  const row = group.vals.find((item) => item.name.trim() === rowName.trim())
  if (!row) {
    return null
  }

  return { group, row }
}

function applyCustomValuesToValsFile(valsFile: StoryValsFile, customValues: Record<string, unknown>) {
  for (const [token, value] of Object.entries(customValues)) {
    const match = findValEntry(valsFile, token)

    if (!match || match.row.value_type === "calc") {
      continue
    }

    match.row.value = cloneValue(value)
  }
}

function createBaseSnapshot(bundle: RuntimeStoryBundle): RuntimeStorySessionSnapshot {
  return {
    current_event_id: bundle.entryEventId ?? null,
    vals: cloneValsFile(bundle.vals),
    system_vals: cloneValsFile(bundle.systemVals),
    triggered_big_once_events: [],
    loop_event_states: [],
    history: []
  }
}

function isCompiledEvent(node: RuntimeGraphNode | null | undefined): node is CompiledEvent {
  return Boolean(node && !("exec_script" in node))
}

function isCompiledAction(node: RuntimeGraphNode | null | undefined): node is CompiledAction {
  return Boolean(node && "exec_script" in node)
}

function getBundleGraphNode(bundle: RuntimeStoryBundle, nodeId: string | null) {
  if (!nodeId) {
    return null
  }

  return (bundle.graphEvents[nodeId] as RuntimeGraphNode | undefined) ?? null
}

function getBundleRoles(bundle: RuntimeStoryBundle) {
  const roles = bundle.roles as {
    normal?: { roles?: RuntimeNormalRoleDefinition[] }
    important?: { roles?: RuntimeImportantRoleDefinition[] }
  } | null

  return {
    normal: roles?.normal?.roles ?? [],
    important: roles?.important?.roles ?? []
  }
}

function getBundleLocations(bundle: RuntimeStoryBundle) {
  const locations = bundle.eventLocations as {
    assignments?: RuntimeLocationAssignment[]
  } | null

  return locations?.assignments ?? []
}

function findRoleLabel(bundle: RuntimeStoryBundle, roleKey: string) {
  if (roleKey === "player") {
    return "主角"
  }

  const [scope, roleName] = roleKey.split(":")
  if (!scope || !roleName) {
    return roleKey
  }

  const roles = getBundleRoles(bundle)
  const role = scope === "important"
    ? roles.important.find((item) => item.name === roleName)
    : roles.normal.find((item) => item.name === roleName)

  if (!role) {
    return roleKey
  }

  return role.descr.trim() || role.name
}

function findLocationLabel(bundle: RuntimeStoryBundle, locationName: string) {
  const trimmedLocationName = normalizeText(locationName)
  if (!trimmedLocationName) {
    return null
  }

  const location = getBundleLocations(bundle).find((item) => item.name.trim() === trimmedLocationName)
  if (!location) {
    return trimmedLocationName
  }

  const descr = location.descr.trim()
  return descr ? `${location.name} - ${descr}` : location.name
}

function buildRuntimeContextValues(
  snapshot: RuntimeStorySessionSnapshot,
  branchValues: Record<string, unknown>
) {
  const combinedValues: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(branchValues)) {
    combinedValues[`branch.${key}`] = cloneValue(value)
  }

  return {
    values: combinedValues
  } satisfies StoryScriptExecutionContext
}

function buildRuntimeScriptContext(
  snapshot: RuntimeStorySessionSnapshot,
  branchValues: Record<string, unknown>
) {
  const combinedValues: Record<string, unknown> = {}
  const assignableValues: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(branchValues)) {
    combinedValues[`branch.${key}`] = cloneValue(value)
    assignableValues[`branch.${key}`] = cloneValue(value)
  }

  return {
    values: combinedValues,
    assignableValues
  } satisfies StoryScriptExecutionContext
}

function initializeActionValues(action: CompiledAction) {
  const branchValues: Record<string, unknown> = {}

  for (const actionVar of action.vars ?? []) {
    const name = normalizeText(actionVar.name)
    if (!name) {
      continue
    }

    branchValues[name] = actionVar.initial_value
  }

  return branchValues
}

function appendHistory(
  snapshot: RuntimeStorySessionSnapshot,
  entry: Omit<RuntimeHistoryEntry, "timestamp">
) {
  snapshot.history.push({
    ...entry,
    timestamp: new Date().toISOString()
  })
}

function executeEventScript(
  runtimeState: RuntimeState,
  script: string,
  branchValues: Record<string, unknown>
) {
  const trimmedScript = normalizeText(script)
  if (!trimmedScript) {
    return branchValues
  }

  const executionContext = buildRuntimeScriptContext(runtimeState.snapshot, branchValues)
  const combinedValsFile = createCombinedValsFile(runtimeState.snapshot)
  const result = executeStoryScript(
    combinedValsFile,
    trimmedScript,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    executionContext
  )

  applyCombinedValsFile(runtimeState.snapshot, result.vals)

  const nextBranchValues: Record<string, unknown> = {}
  for (const [token, value] of Object.entries(result.externalValues)) {
    if (!token.startsWith("branch.")) {
      continue
    }

    nextBranchValues[token.slice("branch.".length)] = cloneValue(value)
  }

  return nextBranchValues
}

function renderDialogueContent(
  snapshot: RuntimeStorySessionSnapshot,
  content: string,
  branchValues: Record<string, unknown>
) {
  const combinedValsFile = createCombinedValsFile(snapshot)
  return renderStoryTextTemplate(
    combinedValsFile,
    content,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    buildRuntimeContextValues(snapshot, branchValues)
  )
}

function buildDialogueView(
  bundle: RuntimeStoryBundle,
  snapshot: RuntimeStorySessionSnapshot,
  dialogue: RuntimeStoryDialogueDefinition,
  index: number,
  total: number,
  branchValues: Record<string, unknown>
): RuntimeRenderedDialogue {
  const speakerLabel = dialogue.speaker_type === "player"
    ? "主角"
    : findRoleLabel(bundle, dialogue.speaker_key)

  return {
    index: index + 1,
    total,
    speakerLabel,
    speakerKey: dialogue.speaker_key,
    content: renderDialogueContent(snapshot, dialogue.content, branchValues)
  }
}

function resolveEventActions(
  bundle: RuntimeStoryBundle,
  event: CompiledEvent
) {
  const eventNext = Array.isArray(event.next) ? event.next : []
  const actions: RuntimeActionState[] = []
  let autoNextEventId: string | null = null

  for (const nextNodeId of eventNext) {
    const nextNode = getBundleGraphNode(bundle, nextNodeId)
    if (isCompiledAction(nextNode)) {
      actions.push({
        nodeId: nextNode.id,
        branchValues: initializeActionValues(nextNode)
      })
      continue
    }

    if (isCompiledEvent(nextNode) && !autoNextEventId) {
      autoNextEventId = nextNode.id
    }
  }

  return {
    actions,
    autoNextEventId
  }
}

function canEnterEvent(
  snapshot: RuntimeStorySessionSnapshot,
  event: CompiledEvent,
  branchValues: Record<string, unknown>
) {
  const combinedValsFile = createCombinedValsFile(snapshot)
  const triggerResult = evaluateStoryBooleanExpression(
    combinedValsFile,
    event.trigger_expr,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    buildRuntimeContextValues(snapshot, branchValues)
  )

  return triggerResult.result
}

function moveToEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  targetEventId: string | null,
  branchValues: Record<string, unknown>
) {
  if (!targetEventId) {
    runtimeState.snapshot.current_event_id = null
    runtimeState.currentEventEntered = false
    runtimeState.currentDialogueIndex = 0
    runtimeState.pendingActions = []
    runtimeState.lastAction = null
    return
  }

  const targetNode = getBundleGraphNode(bundle, targetEventId)
  if (!isCompiledEvent(targetNode)) {
    throw new Error(`Target node "${targetEventId}" is not an event node.`)
  }

  if (!canEnterEvent(runtimeState.snapshot, targetNode, branchValues)) {
    appendHistory(runtimeState.snapshot, {
      type: "system",
      id: "skip-event",
      title: targetNode.id,
      content: `skip ${targetNode.id}`
    })
    runtimeState.snapshot.current_event_id = null
    runtimeState.currentEventEntered = false
    runtimeState.currentDialogueIndex = 0
    runtimeState.pendingActions = []
    runtimeState.lastAction = null
    return
  }

  runtimeState.snapshot.current_event_id = targetNode.id
  runtimeState.currentEventEntered = false
  runtimeState.currentDialogueIndex = 0
  runtimeState.pendingActions = []
  runtimeState.lastAction = branchValues && Object.keys(branchValues).length > 0
    ? {
        nodeId: targetNode.id,
        branchValues: cloneValue(branchValues)
      }
    : null
}

function enterCurrentEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  const currentNode = getBundleGraphNode(bundle, runtimeState.snapshot.current_event_id)
  if (!isCompiledEvent(currentNode) || runtimeState.currentEventEntered) {
    return
  }

  const branchValues = runtimeState.lastAction?.branchValues ?? {}

  if (!canEnterEvent(runtimeState.snapshot, currentNode, branchValues)) {
    notifications.push(`事件 "${currentNode.title}" 未满足触发条件，已跳过。`)
    moveToEvent(bundle, runtimeState, null, {})
    return
  }

  const nextBranchValues = executeEventScript(
    runtimeState,
    currentNode.init_script,
    branchValues
  )

  appendHistory(runtimeState.snapshot, {
    type: "event",
    id: currentNode.id,
    title: currentNode.title
  })

  runtimeState.currentEventEntered = true
  runtimeState.currentDialogueIndex = 0
  runtimeState.lastAction = {
    nodeId: currentNode.id,
    branchValues: nextBranchValues
  }

  const actionResolution = resolveEventActions(bundle, currentNode)
  runtimeState.pendingActions = actionResolution.actions
}

function finishCurrentEvent(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  notifications: string[]
) {
  const currentNode = getBundleGraphNode(bundle, runtimeState.snapshot.current_event_id)
  if (!isCompiledEvent(currentNode)) {
    return
  }

  const branchValues = runtimeState.lastAction?.branchValues ?? {}
  const nextBranchValues = executeEventScript(
    runtimeState,
    currentNode.end_script,
    branchValues
  )
  const actionResolution = resolveEventActions(bundle, currentNode)

  if (actionResolution.actions.length > 0) {
    runtimeState.pendingActions = actionResolution.actions
    runtimeState.lastAction = {
      nodeId: currentNode.id,
      branchValues: nextBranchValues
    }
    return
  }

  if (actionResolution.autoNextEventId) {
    moveToEvent(bundle, runtimeState, actionResolution.autoNextEventId, nextBranchValues)
    enterCurrentEvent(bundle, runtimeState, notifications)
    return
  }

  runtimeState.snapshot.current_event_id = null
  runtimeState.currentEventEntered = false
  runtimeState.currentDialogueIndex = 0
  runtimeState.pendingActions = []
  runtimeState.lastAction = null
  notifications.push(`事件 "${currentNode.title}" 已结束。`)
}

function executeAction(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  optionId: string,
  notifications: string[]
) {
  const targetActionState = runtimeState.pendingActions.find((item) => item.nodeId === optionId)
  if (!targetActionState) {
    notifications.push(`未找到操作分支：${optionId}`)
    return
  }

  const actionNode = getBundleGraphNode(bundle, targetActionState.nodeId)
  if (!isCompiledAction(actionNode)) {
    notifications.push(`节点 "${optionId}" 不是操作节点。`)
    return
  }

  const executionContext = buildRuntimeScriptContext(
    runtimeState.snapshot,
    targetActionState.branchValues
  )
  const combinedValsFile = createCombinedValsFile(runtimeState.snapshot)
  const scriptResult = executeStoryScript(
    combinedValsFile,
    actionNode.exec_script,
    DEFAULT_MAX_CALC_NESTING_DEPTH,
    executionContext
  )

  applyCombinedValsFile(runtimeState.snapshot, scriptResult.vals)

  const nextBranchValues: Record<string, unknown> = {}
  for (const [token, value] of Object.entries(scriptResult.externalValues)) {
    if (!token.startsWith("branch.")) {
      continue
    }

    nextBranchValues[token.slice("branch.".length)] = cloneValue(value)
  }

  appendHistory(runtimeState.snapshot, {
    type: "action",
    id: actionNode.id,
    title: actionNode.title
  })

  runtimeState.pendingActions = []
  runtimeState.lastAction = {
    nodeId: actionNode.id,
    branchValues: nextBranchValues
  }

  const nextEventId = actionNode.next[0] ?? null
  moveToEvent(bundle, runtimeState, nextEventId, nextBranchValues)
  enterCurrentEvent(bundle, runtimeState, notifications)
}

function getCurrentEventState(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState
): RuntimeDialogueNodeState | null {
  const currentNode = getBundleGraphNode(bundle, runtimeState.snapshot.current_event_id)
  if (!isCompiledEvent(currentNode) || !runtimeState.currentEventEntered) {
    return null
  }

  const branchValues = runtimeState.lastAction?.branchValues ?? {}
  const dialogues = currentNode.dialogues ?? []
  const currentDialogue = dialogues.length > 0 && runtimeState.currentDialogueIndex < dialogues.length
    ? buildDialogueView(
        bundle,
        runtimeState.snapshot,
        dialogues[runtimeState.currentDialogueIndex]!,
        runtimeState.currentDialogueIndex,
        dialogues.length,
        branchValues
      )
    : null

  const actionResolution = resolveEventActions(bundle, currentNode)
  const availableActions = runtimeState.pendingActions.length > 0
    ? runtimeState.pendingActions
    : actionResolution.actions

  return {
    node: currentNode,
    currentDialogue,
    availableActions,
    autoNextEventId: actionResolution.autoNextEventId,
    locationName: findLocationLabel(bundle, currentNode.location)
  }
}

function buildViewModel(
  bundle: RuntimeStoryBundle,
  runtimeState: RuntimeState,
  screen: RuntimeStoryViewModel["screen"],
  notifications: string[]
): RuntimeStoryViewModel {
  const currentEventState = getCurrentEventState(bundle, runtimeState)
  const currentNode = getBundleGraphNode(bundle, runtimeState.snapshot.current_event_id)
  const currentEvent = isCompiledEvent(currentNode) ? currentNode : null
  const currentDialogue = currentEventState?.currentDialogue ?? null

  let interaction: RuntimeInteraction = null

  if (screen !== "debug") {
    if (currentDialogue) {
      interaction = {
        kind: "select",
        prompt: "请选择下一步。",
        options: [
          {
            id: "continue",
            label: currentDialogue.index < currentDialogue.total ? "继续对白" : "结束当前事件"
          }
        ]
      }
    } else if (currentEventState && currentEventState.availableActions.length > 0) {
      interaction = {
        kind: "select",
        prompt: "请选择一个操作分支。",
        options: currentEventState.availableActions.map((actionState) => {
          const actionNode = getBundleGraphNode(bundle, actionState.nodeId)
          const title = isCompiledAction(actionNode) ? actionNode.title : actionState.nodeId
          return {
            id: actionState.nodeId,
            label: title
          }
        })
      }
    } else if (currentEventState || runtimeState.snapshot.current_event_id === null) {
      interaction = {
        kind: "select",
        prompt: runtimeState.snapshot.current_event_id === null ? "当前没有可继续的事件。" : "请选择下一步。",
        options: runtimeState.snapshot.current_event_id === null
          ? []
          : [{
              id: "continue",
              label: "继续"
            }]
      }
    }
  }

  const branchContextSummary = Object.entries(runtimeState.lastAction?.branchValues ?? {}).map(
    ([key, value]) => ({
      key,
      value: formatValueSummary(value)
    })
  )

  const availableBranches = (currentEventState?.availableActions ?? []).flatMap((actionState) => {
    const actionNode = getBundleGraphNode(bundle, actionState.nodeId)
    if (!isCompiledAction(actionNode)) {
      return []
    }

    return [{
      id: actionNode.id,
      title: actionNode.title,
      nextEventId: actionNode.next[0] ?? null,
      vars: actionNode.vars.map((item) => ({
        name: item.name,
        descr: item.descr,
        initialValue: item.initial_value
      }))
    }]
  })

  return {
    screen,
    storyTitle: bundle.title,
    activeEventId: runtimeState.snapshot.current_event_id,
    activeEventTitle: currentEvent?.title ?? null,
    interaction,
    notifications,
    currentLocationName: currentEventState?.locationName ?? null,
    currentSceneLevel: null,
    currentDialogue,
    availableBranches,
    branchContextSummary,
    debugSummary: {
      globalGroupCount: runtimeState.snapshot.vals.variables.length,
      systemGroupCount: runtimeState.snapshot.system_vals.variables.length,
      historyCount: runtimeState.snapshot.history.length,
      triggeredBigOnceCount: runtimeState.snapshot.triggered_big_once_events.length
    }
  }
}

export function createStorySession(options: CreateStorySessionOptions): RuntimeStorySession {
  const now = options.now ?? new Date()
  const baseSnapshot = options.saveState
    ? cloneValue(options.saveState.session_state)
    : createBaseSnapshot(options.bundle)
  const notifications: string[] = []
  let screen: RuntimeStoryViewModel["screen"] = "game"
  const runtimeState: RuntimeState = {
    snapshot: baseSnapshot,
    currentEventEntered: false,
    currentDialogueIndex: 0,
    pendingActions: [],
    lastAction: null
  }

  if (!options.saveState && options.customOverrides) {
    applyCustomValuesToValsFile(runtimeState.snapshot.vals, options.customOverrides.custom_values)
    applyCustomValuesToValsFile(runtimeState.snapshot.system_vals, options.customOverrides.custom_values)
    notifications.push(`已加载角色自定义变量：${options.customOverrides.profile_name}`)
  }

  if (options.saveState) {
    notifications.push(`已加载存档：${options.saveState.slot_id}`)
  } else {
    notifications.push(`已创建运行时会话：${now.toISOString()}`)
  }

  enterCurrentEvent(options.bundle, runtimeState, notifications)

  return {
    dispatch(action) {
      if (action.type === "open-debug") {
        screen = "debug"
        return
      }

      if (action.type === "close-debug") {
        screen = "game"
        return
      }

      if (action.type === "select-option" && action.optionId === "debug") {
        screen = "debug"
        return
      }

      if (action.type === "submit-text") {
        notifications.push(`已提交输入字段：${action.field}`)
        appendHistory(runtimeState.snapshot, {
          type: "system",
          id: "submit-text",
          title: action.field,
          content: action.value
        })
        return
      }

      if (action.type === "continue") {
        const currentEventState = getCurrentEventState(options.bundle, runtimeState)

        if (!currentEventState) {
          notifications.push("当前没有可继续的事件。")
          return
        }

        if (currentEventState.currentDialogue) {
          appendHistory(runtimeState.snapshot, {
            type: "dialogue",
            id: `${currentEventState.node.id}:${runtimeState.currentDialogueIndex}`,
            title: currentEventState.currentDialogue.speakerLabel,
            content: currentEventState.currentDialogue.content
          })
          runtimeState.currentDialogueIndex += 1

          if (runtimeState.currentDialogueIndex >= currentEventState.currentDialogue.total) {
            finishCurrentEvent(options.bundle, runtimeState, notifications)
          }
          return
        }

        if (currentEventState.availableActions.length > 0) {
          notifications.push("当前事件需要先选择一个操作分支。")
          return
        }

        finishCurrentEvent(options.bundle, runtimeState, notifications)
        return
      }

      if (action.type === "select-option") {
        if (action.optionId === "continue") {
          this.dispatch({ type: "continue" })
          return
        }

        executeAction(options.bundle, runtimeState, action.optionId, notifications)
      }
    },
    getViewModel() {
      return buildViewModel(options.bundle, runtimeState, screen, [...notifications])
    },
    getSnapshot() {
      return cloneValue(runtimeState.snapshot)
    }
  }
}
