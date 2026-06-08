import type {
  StoryAnyEventFile,
  StoryActionFile,
  StoryDocument,
  StoryEventFile,
  StoryGraphNodeFile,
  StoryLoopEventFile,
  StoryOnceEventFile,
  ValidationIssue,
  ValidationResult
} from "./types"
import { findStoryRoleReference } from "./roles"
import {
  evaluateStoryBooleanExpression,
  validateStoryScript,
  validateStoryTextTemplate,
  validateStoryValsCalcRules
} from "@story-mgr/runtime"
import type { StoryValsFile } from "./types"

type EventValidationGroupKey = "graphEvents" | "onceEvents" | "loopEvents"

interface StoryEventValidationShape {
  id: string
  trigger_mode?: "default" | "condition" | "invoke"
  trigger_expr: string
  invoke_params?: Array<{
    name: string
    descr?: string
  }>
  init_script: string
  end_script: string
  object_keys: string[]
  dialogues: Array<{
    speaker_type: "player" | "object"
    speaker_key: string
    content: string
  }>
  location: string
}

function buildInvokeScriptContext(event: StoryEventValidationShape) {
  const values = Object.fromEntries(
    (event.invoke_params ?? [])
      .map((param) => param.name.trim())
      .filter(Boolean)
      .map((name) => [`call.${name}`, null] as const)
  )

  return {
    values,
    assignableValues: {}
  }
}

function buildCombinedStoryScriptVals(document: StoryDocument): StoryValsFile {
  return {
    variables: [
      ...document.vals.variables,
      ...document.systemVals.variables
    ]
  }
}

function buildGraphActionScriptContext(action: StoryActionFile) {
  const values = Object.fromEntries(
    (action.vars ?? [])
      .map((actionVar) => actionVar.name.trim())
      .filter(Boolean)
      .map((name) => [`branch.${name}`, null] as const)
  )
  const assignableValues = { ...values }

  return {
    values,
    assignableValues
  }
}

function pushIssue(
  issues: ValidationIssue[],
  level: ValidationIssue["level"],
  code: string,
  message: string,
  path: string[]
) {
  issues.push({ level, code, message, path })
}

function isGraphActionNode(event: StoryGraphNodeFile): event is StoryActionFile {
  return "exec_script" in event
}

function isGraphEventNode(event: StoryGraphNodeFile): event is StoryEventFile {
  return "next" in event && !("exec_script" in event)
}

function collectLocationNames(document: StoryDocument) {
  return new Set(document.eventLocations.assignments.map((assignment) => assignment.id))
}

function collectGlobalValKeys(document: StoryDocument) {
  const keys = new Set<string>()

  for (const group of document.vals.variables) {
    const groupName = group.name.trim()

    for (const row of group.vals) {
      const rowName = row.name.trim()

      if (!groupName || !rowName) {
        continue
      }

      keys.add(`${groupName}.${rowName}`)
    }
  }

  return keys
}

function validateDialogueTemplates(
  issues: ValidationIssue[],
  eventGroupKey: "graphEvents" | "onceEvents" | "loopEvents",
  eventIndex: number,
  eventId: string,
  dialogues: Array<{ content: string }>
) {
  for (const [dialogueIndex, dialogue] of dialogues.entries()) {
    for (const issue of validateStoryTextTemplate(dialogue.content)) {
      pushIssue(
        issues,
        "error",
        `${eventGroupKey}.dialogue-template-invalid`,
        `${eventId} dialogue template is invalid at line ${issue.lineNumber}: ${issue.message}`,
        [eventGroupKey, String(eventIndex), "dialogues", String(dialogueIndex), "content"]
      )
    }
  }
}

function getEventValidationMeta(eventGroupKey: EventValidationGroupKey) {
  if (eventGroupKey === "graphEvents") {
    return { codePrefix: "graph", label: "Graph event" }
  }

  if (eventGroupKey === "loopEvents") {
    return { codePrefix: "loop", label: "Loop event" }
  }

  return { codePrefix: "once", label: "Once event" }
}

function validateInvokeParamDefinitions(
  issues: ValidationIssue[],
  eventGroupKey: EventValidationGroupKey,
  eventIndex: number,
  event: StoryEventValidationShape
) {
  const { codePrefix, label } = getEventValidationMeta(eventGroupKey)

  for (const [paramIndex, param] of (event.invoke_params ?? []).entries()) {
    const trimmedName = param.name.trim()

    if (!trimmedName) {
      continue
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedName)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.invoke-param-invalid`,
        `${label} "${event.id}" invoke param "${param.name}" must be a valid identifier.`,
        [eventGroupKey, String(eventIndex), "invoke_params", String(paramIndex), "name"]
      )
    }
  }
}

function validatePlayableEvent(
  event: StoryEventValidationShape,
  eventIndex: number,
  eventGroupKey: EventValidationGroupKey,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  const locationNames = collectLocationNames(document)
  const allowedSpeakerKeys = new Set(["player", ...event.object_keys])
  const triggerMode = event.trigger_mode ?? "default"
  const invokeScriptContext = triggerMode === "invoke"
    ? buildInvokeScriptContext(event)
    : undefined
  const scriptVals = buildCombinedStoryScriptVals(document)
  const { codePrefix, label } = getEventValidationMeta(eventGroupKey)

  if (triggerMode === "condition") {
    if (!event.trigger_expr.trim()) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.trigger-expr-required`,
        `${label} "${event.id}" trigger_expr is required when trigger_mode is condition.`,
        [eventGroupKey, String(eventIndex), "trigger_expr"]
      )
    }

    if (event.trigger_expr.trim()) {
      try {
        evaluateStoryBooleanExpression(scriptVals, event.trigger_expr)
      } catch (error) {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.trigger-expr-invalid`,
          `${label} "${event.id}" trigger_expr is invalid: ${error instanceof Error ? error.message : "Validation failed."}`,
          [eventGroupKey, String(eventIndex), "trigger_expr"]
        )
      }
    }
  }

  if (
    triggerMode === "invoke"
    && !(event.invoke_params ?? []).some((param) => param.name.trim())
  ) {
    pushIssue(
      issues,
      "error",
      `${codePrefix}.invoke-param-required`,
      `${label} "${event.id}" invoke_params is required when trigger_mode is invoke.`,
      [eventGroupKey, String(eventIndex), "invoke_params"]
    )
  }

  validateInvokeParamDefinitions(issues, eventGroupKey, eventIndex, event)

  for (const scriptField of [
    { key: "init_script", value: event.init_script, code: `${codePrefix}.init-script-invalid` },
    { key: "end_script", value: event.end_script, code: `${codePrefix}.end-script-invalid` }
  ] as const) {
    for (const issue of validateStoryScript(
      scriptVals,
      scriptField.value,
      undefined,
      invokeScriptContext
    )) {
      pushIssue(
        issues,
        "error",
        scriptField.code,
        `${label} "${event.id}" ${scriptField.key} is invalid at line ${issue.lineNumber}: ${issue.message}`,
        [eventGroupKey, String(eventIndex), scriptField.key]
      )
    }
  }

  for (const [objectIndex, objectKey] of event.object_keys.entries()) {
    if (!findStoryRoleReference(document.roles, objectKey)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.missing-object`,
        `${label} "${event.id}" references missing object "${objectKey}".`,
        [eventGroupKey, String(eventIndex), "object_keys", String(objectIndex)]
      )
    }
  }

  if (event.location && !locationNames.has(event.location)) {
    pushIssue(
      issues,
      "error",
      `${codePrefix}.missing-location`,
      `${label} "${event.id}" references missing location "${event.location}".`,
      [eventGroupKey, String(eventIndex), "location"]
    )
  }

  for (const [dialogueIndex, dialogue] of event.dialogues.entries()) {
    if (dialogue.speaker_type === "player") {
      if (dialogue.speaker_key !== "player") {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.invalid-player-speaker`,
          `${label} "${event.id}" player dialogue must use speaker_key "player".`,
          [eventGroupKey, String(eventIndex), "dialogues", String(dialogueIndex), "speaker_key"]
        )
      }
      continue
    }

    if (!allowedSpeakerKeys.has(dialogue.speaker_key)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.invalid-object-speaker`,
        `${label} "${event.id}" dialogue speaker "${dialogue.speaker_key}" is not in the current event objects.`,
        [eventGroupKey, String(eventIndex), "dialogues", String(dialogueIndex), "speaker_key"]
      )
    }
  }

  validateDialogueTemplates(
    issues,
    eventGroupKey,
    eventIndex,
    `${label} "${event.id}"`,
    event.dialogues
  )
}

function validateOnceEvent(
  event: StoryOnceEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "onceEvents", document, issues)
}

function validateLoopEvent(
  event: StoryLoopEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "loopEvents", document, issues)

  const loopPath = ["loopEvents", String(eventIndex), "loop"] as const

  if (event.loop.mode === "weekly" && !event.loop.weekday) {
    pushIssue(
      issues,
      "error",
      "loop.schedule-weekday-missing",
      `Loop event "${event.id}" requires weekday when mode is weekly.`,
      [...loopPath, "weekday"]
    )
  }

  if (event.loop.mode === "monthly" && !event.loop.month_day) {
    pushIssue(
      issues,
      "error",
      "loop.schedule-month-day-missing",
      `Loop event "${event.id}" requires month_day when mode is monthly.`,
      [...loopPath, "month_day"]
    )
  }

  if (event.loop.mode === "interval_days" && !event.loop.interval_days) {
    pushIssue(
      issues,
      "error",
      "loop.schedule-interval-missing",
      `Loop event "${event.id}" requires interval_days when mode is interval_days.`,
      [...loopPath, "interval_days"]
    )
  }
}

function validateGraphEvent(
  event: StoryEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "graphEvents", document, issues)
}

function validateGraphAction(
  action: StoryActionFile,
  actionIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[],
  graphEvents: StoryEventFile[],
  graphActions: StoryActionFile[]
) {
  const incomingGraphEvents = graphEvents.filter((event) => event.next.includes(action.id))
  const incomingGraphActions = graphActions.filter((event) => event.next.includes(action.id))
  const graphEventIds = new Set(graphEvents.map((event) => event.id))
  const graphActionIds = new Set(graphActions.map((event) => event.id))

  if (incomingGraphEvents.length > 1) {
      pushIssue(
        issues,
        "error",
        "graph-action.multiple-parents",
        `Graph action "${action.id}" can only have one parent event.`,
        ["graphEvents", String(actionIndex), "id"]
      )
  }

  if (incomingGraphActions.length > 0) {
      pushIssue(
        issues,
        "error",
        "graph-action.invalid-parent",
        `Graph action "${action.id}" cannot be linked from another action.`,
        ["graphEvents", String(actionIndex), "id"]
      )
  }

  if (action.next.length > 1) {
      pushIssue(
        issues,
        "error",
        "graph-action.multiple-next",
        `Graph action "${action.id}" can only point to one next event.`,
        ["graphEvents", String(actionIndex), "next"]
      )
  }

  for (const [nextIndex, nextId] of action.next.entries()) {
    if (graphActionIds.has(nextId)) {
        pushIssue(
          issues,
          "error",
          "graph-action.invalid-next-target",
          `Graph action "${action.id}" cannot point to another action "${nextId}".`,
          ["graphEvents", String(actionIndex), "next", String(nextIndex)]
        )
    }

    if (!graphEventIds.has(nextId) && !graphActionIds.has(nextId)) {
      continue
    }
  }

  for (const [varIndex, actionVar] of action.vars.entries()) {
    if (
      action.vars.findIndex((currentVar) => currentVar.name.trim() === actionVar.name.trim()) !== varIndex
    ) {
      pushIssue(
        issues,
        "error",
        "graph-action.duplicate-var",
        `Graph action "${action.id}" has duplicate variable "${actionVar.name}".`,
        ["graphEvents", String(actionIndex), "vars", String(varIndex), "name"]
      )
    }
  }

  for (const issue of validateStoryScript(
    buildCombinedStoryScriptVals(document),
    action.exec_script,
    undefined,
    buildGraphActionScriptContext(action)
  )) {
    pushIssue(
      issues,
      "error",
      "graph-action.exec-script-invalid",
      `Graph action "${action.id}" exec_script is invalid at line ${issue.lineNumber}: ${issue.message}`,
      ["graphEvents", String(actionIndex), "exec_script"]
    )
  }
}

export function validateStoryDocument(document: StoryDocument): ValidationResult {
  const issues: ValidationIssue[] = []
  const graphNodes = document.graphEvents
  const graphEvents = graphNodes.filter(isGraphEventNode)
  const graphActions = graphNodes.filter(isGraphActionNode)
  const onceEvents = document.onceEvents
  const loopEvents = document.loopEvents
  const graphNodeMap = new Map(graphNodes.map((event) => [event.id, event]))

  if (graphEvents.length === 0) {
    pushIssue(
      issues,
      "warning",
      "story.no-events",
      "The story does not contain any events yet.",
      ["graphEvents"]
    )
  }

  const eventGroups = [
    { key: "graphEvents", events: graphNodes },
    { key: "onceEvents", events: onceEvents },
    { key: "loopEvents", events: loopEvents }
  ] as const satisfies Array<{
    key: "graphEvents" | "onceEvents" | "loopEvents"
    events: StoryAnyEventFile[]
  }>

  for (const group of eventGroups) {
    const seenGroupIds = new Set<string>()

    for (const [eventIndex, event] of group.events.entries()) {
      if (seenGroupIds.has(event.id)) {
        pushIssue(
          issues,
          "error",
          "event.duplicate-id",
          `Duplicate ${group.key} id "${event.id}" detected.`,
          [group.key, String(eventIndex), "id"]
        )
        continue
      }

      seenGroupIds.add(event.id)

      if ("next" in event) {
        for (const [nextIndex, nextId] of event.next.entries()) {
          if (!graphNodeMap.has(nextId)) {
            pushIssue(
              issues,
              "error",
              "event.missing-link",
              `Graph node "${event.id}" points to missing graph node "${nextId}".`,
              [group.key, String(eventIndex), "next", String(nextIndex)]
            )
          }
        }
      }

      if (group.key === "onceEvents") {
        validateOnceEvent(event as StoryOnceEventFile, eventIndex, document, issues)
      }

      if (group.key === "loopEvents") {
        validateLoopEvent(event as StoryLoopEventFile, eventIndex, document, issues)
      }

      if (group.key === "graphEvents" && isGraphEventNode(event as StoryGraphNodeFile)) {
        validateGraphEvent(event as StoryEventFile, eventIndex, document, issues)
      }

      if (group.key === "graphEvents" && isGraphActionNode(event as StoryGraphNodeFile)) {
        validateGraphAction(
          event as StoryActionFile,
          eventIndex,
          document,
          issues,
          graphEvents,
          graphActions
        )
      }
    }
  }

  for (const calcIssue of validateStoryValsCalcRules(document.vals)) {
    pushIssue(
      issues,
      "error",
      "vals.calc-rule-invalid",
      `Variable "${calcIssue.groupName}" / "${calcIssue.rowName}" calc_rule is invalid: ${calcIssue.message}`,
      ["vals", String(calcIssue.groupIndex), String(calcIssue.rowIndex), "calc_rule"]
    )
  }

  for (const calcIssue of validateStoryValsCalcRules(document.systemVals)) {
    pushIssue(
      issues,
      "error",
      "system-vals.calc-rule-invalid",
      `System variable "${calcIssue.groupName}" / "${calcIssue.rowName}" calc_rule is invalid: ${calcIssue.message}`,
      ["systemVals", String(calcIssue.groupIndex), String(calcIssue.rowIndex), "calc_rule"]
    )
  }

  const availableGlobalValKeys = collectGlobalValKeys(document)
  const seenPlayerOverrideKeys = new Set<string>()

  for (const [entryIndex, entry] of document.playerOverrideVals.entries.entries()) {
    const normalizedVarKey = entry.var_key.trim()

    if (!availableGlobalValKeys.has(normalizedVarKey)) {
      pushIssue(
        issues,
        "error",
        "player-override.missing-global-var",
        `Player override variable "${normalizedVarKey}" does not exist in global vals.`,
        ["playerOverrideVals", "entries", String(entryIndex), "var_key"]
      )
    }

    if (seenPlayerOverrideKeys.has(normalizedVarKey)) {
      pushIssue(
        issues,
        "warning",
        "player-override.duplicate-var",
        `Player override variable "${normalizedVarKey}" appears more than once.`,
        ["playerOverrideVals", "entries", String(entryIndex), "var_key"]
      )
    } else {
      seenPlayerOverrideKeys.add(normalizedVarKey)
    }

    if (!Number.isInteger(entry.group_no) || entry.group_no < 1) {
      pushIssue(
        issues,
        "error",
        "player-override.invalid-group-no",
        `Player override variable "${normalizedVarKey}" has invalid group_no "${entry.group_no}".`,
        ["playerOverrideVals", "entries", String(entryIndex), "group_no"]
      )
    }
  }

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues
  }
}
