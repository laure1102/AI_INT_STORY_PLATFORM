import type {
  StoryAnyEventFile,
  StoryActionFile,
  StoryChainNodeFile,
  StoryDocument,
  StoryEventFile,
  StoryEventPresentation,
  StoryPoolEventFile,
  StoryScheduleEventFile,
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
import type { StoryScriptExecutionContext } from "@story-mgr/runtime"
import type { StoryValsFile } from "./types"

type EventValidationGroupKey = "chainEvents" | "poolEvents" | "scheduleEvents"

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
  presentation: StoryEventPresentation
  location: string
}

function buildCombinedStoryScriptVals(document: StoryDocument): StoryValsFile {
  return {
    variables: [
      ...document.vals.variables,
      ...document.systemVals.variables
    ]
  }
}

function buildValidationBagReadableFunctions(document: StoryDocument) {
  const itemIds = new Set(document.items.items.map((item) => item.id.trim()).filter(Boolean))
  const assertItemId = (itemId: unknown) => {
    if (typeof itemId !== "string") {
      return
    }

    const normalizedItemId = itemId.trim()
    if (!normalizedItemId) {
      throw new Error("bag item id is required.")
    }

    if (!itemIds.has(normalizedItemId)) {
      throw new Error(`bag item "${normalizedItemId}" does not exist in item library.`)
    }
  }

  return {
    bag_count(_ownerId: unknown, itemId: unknown) {
      assertItemId(itemId)
      return 0
    },
    bag_has(_ownerId: unknown, itemId: unknown) {
      assertItemId(itemId)
      return false
    }
  }
}

function buildValidationBagScriptFunctions(document: StoryDocument) {
  const readableFunctions = buildValidationBagReadableFunctions(document)

  return {
    bag_add(_ownerId: unknown, itemId: unknown, quantity?: unknown) {
      readableFunctions.bag_count(_ownerId, itemId)
      return typeof quantity === "number" && Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 1
    },
    ...readableFunctions,
    bag_remove(_ownerId: unknown, itemId: unknown) {
      readableFunctions.bag_count(_ownerId, itemId)
      return false
    }
  }
}

function buildValidationScriptContext(
  document: StoryDocument,
  context?: StoryScriptExecutionContext
): StoryScriptExecutionContext {
  return {
    values: {
      ...(context?.values ?? {})
    },
    assignableValues: {
      ...(context?.assignableValues ?? {})
    },
    functions: {
      ...buildValidationBagScriptFunctions(document),
      ...(context?.functions ?? {})
    }
  }
}

function buildValidationReadableContext(document: StoryDocument): StoryScriptExecutionContext {
  return {
    functions: buildValidationBagReadableFunctions(document)
  }
}

function buildInvokeScriptContext(
  document: StoryDocument,
  event: StoryEventValidationShape
) {
  const values = Object.fromEntries(
    (event.invoke_params ?? [])
      .map((param) => param.name.trim())
      .filter(Boolean)
      .map((name) => [`call.${name}`, null] as const)
  )

  return buildValidationScriptContext(document, {
    values,
    assignableValues: {}
  })
}

function buildChainActionScriptContext(
  document: StoryDocument,
  action: StoryActionFile
) {
  const values = Object.fromEntries(
    (action.vars ?? [])
      .map((actionVar) => actionVar.name.trim())
      .filter(Boolean)
      .map((name) => [`branch.${name}`, null] as const)
  )
  const assignableValues = { ...values }

  return buildValidationScriptContext(document, {
    values,
    assignableValues
  })
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

function isChainActionNode(event: StoryChainNodeFile): event is StoryActionFile {
  return "exec_script" in event
}

function isChainEventNode(event: StoryChainNodeFile): event is StoryEventFile {
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

function getPresentationDialogues(presentation: StoryEventPresentation) {
  return presentation.type === "dialogue" ? presentation.dialogues : []
}

function validatePresentationTemplates(
  issues: ValidationIssue[],
  eventGroupKey: EventValidationGroupKey,
  eventIndex: number,
  eventId: string,
  presentation: StoryEventPresentation
) {
  if (presentation.type === "message") {
    for (const issue of validateStoryTextTemplate(presentation.message.content)) {
      pushIssue(
        issues,
        "error",
        `${eventGroupKey}.message-template-invalid`,
        `${eventId} message template is invalid at line ${issue.lineNumber}: ${issue.message}`,
        [eventGroupKey, String(eventIndex), "presentation", "message", "content"]
      )
    }
    return
  }

  const dialogues = getPresentationDialogues(presentation)
  for (const [dialogueIndex, dialogue] of dialogues.entries()) {
    for (const issue of validateStoryTextTemplate(dialogue.content)) {
      pushIssue(
        issues,
        "error",
        `${eventGroupKey}.dialogue-template-invalid`,
        `${eventId} dialogue template is invalid at line ${issue.lineNumber}: ${issue.message}`,
        [eventGroupKey, String(eventIndex), "presentation", "dialogues", String(dialogueIndex), "content"]
      )
    }
  }
}

function getEventValidationMeta(eventGroupKey: EventValidationGroupKey) {
  if (eventGroupKey === "chainEvents") {
    return { codePrefix: "chain", label: "Chain event" }
  }

  if (eventGroupKey === "scheduleEvents") {
    return { codePrefix: "schedule", label: "Schedule event" }
  }

  return { codePrefix: "pool", label: "Pool event" }
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
  const scriptContext = triggerMode === "invoke"
    ? buildInvokeScriptContext(document, event)
    : buildValidationScriptContext(document)
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
        evaluateStoryBooleanExpression(
          scriptVals,
          event.trigger_expr,
          undefined,
          buildValidationReadableContext(document)
        )
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
      scriptContext
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

  const dialogues = getPresentationDialogues(event.presentation)
  for (const [dialogueIndex, dialogue] of dialogues.entries()) {
    if (dialogue.speaker_type === "player") {
      if (dialogue.speaker_key !== "player") {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.invalid-player-speaker`,
          `${label} "${event.id}" player dialogue must use speaker_key "player".`,
          [eventGroupKey, String(eventIndex), "presentation", "dialogues", String(dialogueIndex), "speaker_key"]
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
        [eventGroupKey, String(eventIndex), "presentation", "dialogues", String(dialogueIndex), "speaker_key"]
      )
    }
  }

  validatePresentationTemplates(
    issues,
    eventGroupKey,
    eventIndex,
    `${label} "${event.id}"`,
    event.presentation
  )
}

function validatePoolEvent(
  event: StoryPoolEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "poolEvents", document, issues)
}

function validateScheduleEvent(
  event: StoryScheduleEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "scheduleEvents", document, issues)

  const schedulePath = ["scheduleEvents", String(eventIndex), "loop"] as const

  if (event.loop.mode === "weekly" && !event.loop.weekday) {
    pushIssue(
      issues,
      "error",
      "schedule.weekday-missing",
      `Schedule event "${event.id}" requires weekday when mode is weekly.`,
      [...schedulePath, "weekday"]
    )
  }

  if (event.loop.mode === "monthly" && !event.loop.month_day) {
    pushIssue(
      issues,
      "error",
      "schedule.month-day-missing",
      `Schedule event "${event.id}" requires month_day when mode is monthly.`,
      [...schedulePath, "month_day"]
    )
  }

  if (event.loop.mode === "interval_days" && !event.loop.interval_days) {
    pushIssue(
      issues,
      "error",
      "schedule.interval-missing",
      `Schedule event "${event.id}" requires interval_days when mode is interval_days.`,
      [...schedulePath, "interval_days"]
    )
  }
}

function validateChainEvent(
  event: StoryEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "chainEvents", document, issues)
}

function validateChainAction(
  action: StoryActionFile,
  actionIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[],
  chainEvents: StoryEventFile[],
  chainActions: StoryActionFile[]
) {
  const incomingChainEvents = chainEvents.filter((event) => event.next.includes(action.id))
  const incomingChainActions = chainActions.filter((event) => event.next.includes(action.id))
  const chainEventIds = new Set(chainEvents.map((event) => event.id))
  const chainActionIds = new Set(chainActions.map((event) => event.id))

  if (incomingChainEvents.length > 1) {
      pushIssue(
        issues,
        "error",
        "chain-action.multiple-parents",
        `Chain action "${action.id}" can only have one parent event.`,
        ["chainEvents", String(actionIndex), "id"]
      )
  }

  if (incomingChainActions.length > 0) {
      pushIssue(
        issues,
        "error",
        "chain-action.invalid-parent",
        `Chain action "${action.id}" cannot be linked from another action.`,
        ["chainEvents", String(actionIndex), "id"]
      )
  }

  if (action.next.length > 1) {
      pushIssue(
        issues,
        "error",
        "chain-action.multiple-next",
        `Chain action "${action.id}" can only point to one next event.`,
        ["chainEvents", String(actionIndex), "next"]
      )
  }

  for (const [nextIndex, nextId] of action.next.entries()) {
    if (chainActionIds.has(nextId)) {
        pushIssue(
          issues,
          "error",
          "chain-action.invalid-next-target",
          `Chain action "${action.id}" cannot point to another action "${nextId}".`,
          ["chainEvents", String(actionIndex), "next", String(nextIndex)]
        )
    }

    if (!chainEventIds.has(nextId) && !chainActionIds.has(nextId)) {
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
        "chain-action.duplicate-var",
        `Chain action "${action.id}" has duplicate variable "${actionVar.name}".`,
        ["chainEvents", String(actionIndex), "vars", String(varIndex), "name"]
      )
    }
  }

  for (const issue of validateStoryScript(
    buildCombinedStoryScriptVals(document),
    action.exec_script,
    undefined,
    buildChainActionScriptContext(document, action)
  )) {
    pushIssue(
      issues,
      "error",
      "chain-action.exec-script-invalid",
      `Chain action "${action.id}" exec_script is invalid at line ${issue.lineNumber}: ${issue.message}`,
      ["chainEvents", String(actionIndex), "exec_script"]
    )
  }
}

export function validateStoryDocument(document: StoryDocument): ValidationResult {
  const issues: ValidationIssue[] = []
  const chainNodes = document.chainEvents
  const chainEvents = chainNodes.filter(isChainEventNode)
  const chainActions = chainNodes.filter(isChainActionNode)
  const poolEvents = document.poolEvents
  const scheduleEvents = document.scheduleEvents
  const chainNodeMap = new Map(chainNodes.map((event) => [event.id, event]))

  if (chainEvents.length === 0) {
    pushIssue(
      issues,
      "warning",
      "story.no-events",
      "The story does not contain any events yet.",
      ["chainEvents"]
    )
  }

  const eventGroups = [
    { key: "chainEvents", events: chainNodes },
    { key: "poolEvents", events: poolEvents },
    { key: "scheduleEvents", events: scheduleEvents }
  ] as const satisfies Array<{
    key: EventValidationGroupKey
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
          if (!chainNodeMap.has(nextId)) {
            pushIssue(
              issues,
              "error",
              "event.missing-link",
              `Chain node "${event.id}" points to missing chain node "${nextId}".`,
              [group.key, String(eventIndex), "next", String(nextIndex)]
            )
          }
        }
      }

      if (group.key === "poolEvents") {
        validatePoolEvent(event as StoryPoolEventFile, eventIndex, document, issues)
      }

      if (group.key === "scheduleEvents") {
        validateScheduleEvent(event as StoryScheduleEventFile, eventIndex, document, issues)
      }

      if (group.key === "chainEvents" && isChainEventNode(event as StoryChainNodeFile)) {
        validateChainEvent(event as StoryEventFile, eventIndex, document, issues)
      }

      if (group.key === "chainEvents" && isChainActionNode(event as StoryChainNodeFile)) {
        validateChainAction(
          event as StoryActionFile,
          eventIndex,
          document,
          issues,
          chainEvents,
          chainActions
        )
      }
    }
  }

  const itemIds = new Set(document.items.items.map((item) => item.id.trim()).filter(Boolean))
  for (const [ownerId, bag] of Object.entries(document.initialBags)) {
    for (const [entryIndex, entry] of bag.entries.entries()) {
      const normalizedItemId = entry.item_id.trim()
      if (!itemIds.has(normalizedItemId)) {
        pushIssue(
          issues,
          "error",
          "initial-bag.missing-item",
          `Initial bag "${ownerId}" references missing item "${normalizedItemId}".`,
          ["initialBags", ownerId, "entries", String(entryIndex), "item_id"]
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
