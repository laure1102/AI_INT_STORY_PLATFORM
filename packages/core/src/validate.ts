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

function buildInvokeScriptContext(event: StoryOnceEventFile) {
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

function buildEventMap(events: StoryEventFile[]) {
  return new Map(events.map((event) => [event.id, event]))
}

function buildAllEventMap(
  graphEvents: StoryGraphNodeFile[],
  onceEvents: StoryOnceEventFile[],
  loopEvents: StoryLoopEventFile[]
) {
  return new Map([...graphEvents, ...onceEvents, ...loopEvents].map((event) => [event.id, event]))
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

function validateOnceEvent(
  event: StoryOnceEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  const locationNames = collectLocationNames(document)
  const allowedSpeakerKeys = new Set(["player", ...event.object_keys])
  const invokeScriptContext = buildInvokeScriptContext(event)
  const scriptVals = buildCombinedStoryScriptVals(document)

  if ((event.trigger_mode ?? "condition") === "condition") {
    try {
      evaluateStoryBooleanExpression(scriptVals, event.trigger_expr)
    } catch (error) {
      pushIssue(
        issues,
        "error",
        "once.trigger-expr-invalid",
        `Once event "${event.id}" trigger_expr is invalid: ${error instanceof Error ? error.message : "Validation failed."}`,
        ["onceEvents", String(eventIndex), "trigger_expr"]
      )
    }
  }

  for (const [paramIndex, param] of (event.invoke_params ?? []).entries()) {
    const trimmedName = param.name.trim()

    if (!trimmedName) {
      continue
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedName)) {
      pushIssue(
        issues,
        "error",
        "once.invoke-param-invalid",
        `Once event "${event.id}" invoke param "${param.name}" must be a valid identifier.`,
        ["onceEvents", String(eventIndex), "invoke_params", String(paramIndex), "name"]
      )
    }
  }

  for (const scriptField of [
    { key: "init_script", value: event.init_script, code: "once.init-script-invalid" },
    { key: "end_script", value: event.end_script, code: "once.end-script-invalid" }
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
        `Once event "${event.id}" ${scriptField.key} is invalid at line ${issue.lineNumber}: ${issue.message}`,
        ["onceEvents", String(eventIndex), scriptField.key]
      )
    }
  }

  for (const [objectIndex, objectKey] of event.object_keys.entries()) {
    if (!findStoryRoleReference(document.roles, objectKey)) {
      pushIssue(
        issues,
        "error",
        "once.missing-object",
        `Once event "${event.id}" references missing object "${objectKey}".`,
        ["onceEvents", String(eventIndex), "object_keys", String(objectIndex)]
      )
    }
  }

  if (event.location && !locationNames.has(event.location)) {
    pushIssue(
      issues,
      "error",
      "once.missing-location",
      `Once event "${event.id}" references missing location "${event.location}".`,
      ["onceEvents", String(eventIndex), "location"]
    )
  }

  for (const [dialogueIndex, dialogue] of event.dialogues.entries()) {
    if (dialogue.speaker_type === "player") {
      if (dialogue.speaker_key !== "player") {
        pushIssue(
          issues,
          "error",
          "once.invalid-player-speaker",
          `Once event "${event.id}" player dialogue must use speaker_key "player".`,
          ["onceEvents", String(eventIndex), "dialogues", String(dialogueIndex), "speaker_key"]
        )
      }
      continue
    }

    if (!allowedSpeakerKeys.has(dialogue.speaker_key)) {
      pushIssue(
        issues,
        "error",
        "once.invalid-object-speaker",
        `Once event "${event.id}" dialogue speaker "${dialogue.speaker_key}" is not in the current event objects.`,
        ["onceEvents", String(eventIndex), "dialogues", String(dialogueIndex), "speaker_key"]
      )
    }
  }

  validateDialogueTemplates(
    issues,
    "onceEvents",
    eventIndex,
    `Once event "${event.id}"`,
    event.dialogues
  )
}

function validateLoopEvent(
  event: StoryLoopEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validateOnceEvent(event, eventIndex, document, issues)

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
  const locationNames = collectLocationNames(document)
  const allowedSpeakerKeys = new Set(["player", ...event.object_keys])
  const scriptVals = buildCombinedStoryScriptVals(document)

  try {
    evaluateStoryBooleanExpression(scriptVals, event.trigger_expr)
  } catch (error) {
    pushIssue(
      issues,
      "error",
      "graph.trigger-expr-invalid",
      `Graph event "${event.id}" trigger_expr is invalid: ${error instanceof Error ? error.message : "Validation failed."}`,
      ["graphEvents", String(eventIndex), "trigger_expr"]
    )
  }

  for (const scriptField of [
    { key: "init_script", value: event.init_script, code: "graph.init-script-invalid" },
    { key: "end_script", value: event.end_script, code: "graph.end-script-invalid" }
  ] as const) {
    for (const issue of validateStoryScript(scriptVals, scriptField.value)) {
      pushIssue(
        issues,
        "error",
        scriptField.code,
        `Graph event "${event.id}" ${scriptField.key} is invalid at line ${issue.lineNumber}: ${issue.message}`,
        ["graphEvents", String(eventIndex), scriptField.key]
      )
    }
  }

  for (const [objectIndex, objectKey] of event.object_keys.entries()) {
    if (!findStoryRoleReference(document.roles, objectKey)) {
      pushIssue(
        issues,
        "error",
        "graph.missing-object",
        `Graph event "${event.id}" references missing object "${objectKey}".`,
        ["graphEvents", String(eventIndex), "object_keys", String(objectIndex)]
      )
    }
  }

  if (event.location && !locationNames.has(event.location)) {
    pushIssue(
      issues,
      "error",
      "graph.missing-location",
      `Graph event "${event.id}" references missing location "${event.location}".`,
      ["graphEvents", String(eventIndex), "location"]
    )
  }

  for (const [dialogueIndex, dialogue] of event.dialogues.entries()) {
    if (dialogue.speaker_type === "player") {
      if (dialogue.speaker_key !== "player") {
        pushIssue(
          issues,
          "error",
          "graph.invalid-player-speaker",
          `Graph event "${event.id}" player dialogue must use speaker_key "player".`,
          ["graphEvents", String(eventIndex), "dialogues", String(dialogueIndex), "speaker_key"]
        )
      }
      continue
    }

    if (!allowedSpeakerKeys.has(dialogue.speaker_key)) {
      pushIssue(
        issues,
        "error",
        "graph.invalid-object-speaker",
        `Graph event "${event.id}" dialogue speaker "${dialogue.speaker_key}" is not in the current event objects.`,
        ["graphEvents", String(eventIndex), "dialogues", String(dialogueIndex), "speaker_key"]
      )
    }
  }

  validateDialogueTemplates(
    issues,
    "graphEvents",
    eventIndex,
    `Graph event "${event.id}"`,
    event.dialogues
  )
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
  const eventMap = buildAllEventMap(graphNodes, onceEvents, loopEvents)
  const seenIds = new Set<string>()

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
    for (const [eventIndex, event] of group.events.entries()) {
      if (seenIds.has(event.id)) {
        pushIssue(
          issues,
          "error",
          "event.duplicate-id",
          `Duplicate event id "${event.id}" detected.`,
          [group.key, event.id]
        )
        continue
      }

      seenIds.add(event.id)

      if ("next" in event) {
        for (const nextId of event.next) {
          if (!eventMap.has(nextId)) {
            pushIssue(
              issues,
              "error",
              "event.missing-link",
              `Event "${event.id}" points to missing event "${nextId}".`,
              [group.key, event.id, "next"]
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
