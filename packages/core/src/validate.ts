import type {
  StoryAnyEventFile,
  StoryBigOnceEventFile,
  StoryDocument,
  StoryEventFile,
  StoryLoopEventFile,
  ValidationIssue,
  ValidationResult
} from "./types"
import { findStoryRoleReference } from "./roles"
import {
  evaluateStoryBooleanExpression,
  validateStoryScript,
  validateStoryValsCalcRules
} from "./vals"

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
  graphEvents: StoryEventFile[],
  bigOnceEvents: StoryBigOnceEventFile[],
  loopEvents: StoryLoopEventFile[]
) {
  return new Map(
    [...graphEvents, ...bigOnceEvents, ...loopEvents].map((event) => [event.id, event])
  )
}

function collectLocationNames(document: StoryDocument) {
  return new Set(document.eventLocations.assignments.map((assignment) => assignment.name))
}

function validateBigOnceEvent(
  event: StoryBigOnceEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  const locationNames = collectLocationNames(document)
  const allowedSpeakerKeys = new Set(["player", ...event.object_keys])

  try {
    evaluateStoryBooleanExpression(document.vals, event.trigger_expr)
  } catch (error) {
    pushIssue(
      issues,
      "error",
      "big-once.trigger-expr-invalid",
      `Big once event "${event.id}" trigger_expr is invalid: ${error instanceof Error ? error.message : "Validation failed."}`,
      ["bigOnceEvents", String(eventIndex), "trigger_expr"]
    )
  }

  for (const scriptField of [
    { key: "init_script", value: event.init_script, code: "big-once.init-script-invalid" },
    { key: "end_script", value: event.end_script, code: "big-once.end-script-invalid" }
  ] as const) {
    for (const issue of validateStoryScript(document.vals, scriptField.value)) {
      pushIssue(
        issues,
        "error",
        scriptField.code,
        `Big once event "${event.id}" ${scriptField.key} is invalid at line ${issue.lineNumber}: ${issue.message}`,
        ["bigOnceEvents", String(eventIndex), scriptField.key]
      )
    }
  }

  for (const [objectIndex, objectKey] of event.object_keys.entries()) {
    if (!findStoryRoleReference(document.roles, objectKey)) {
      pushIssue(
        issues,
        "error",
        "big-once.missing-object",
        `Big once event "${event.id}" references missing object "${objectKey}".`,
        ["bigOnceEvents", String(eventIndex), "object_keys", String(objectIndex)]
      )
    }
  }

  if (event.location && !locationNames.has(event.location)) {
    pushIssue(
      issues,
      "error",
      "big-once.missing-location",
      `Big once event "${event.id}" references missing location "${event.location}".`,
      ["bigOnceEvents", String(eventIndex), "location"]
    )
  }

  for (const [dialogueIndex, dialogue] of event.dialogues.entries()) {
    if (dialogue.speaker_type === "player") {
      if (dialogue.speaker_key !== "player") {
        pushIssue(
          issues,
          "error",
          "big-once.invalid-player-speaker",
          `Big once event "${event.id}" player dialogue must use speaker_key "player".`,
          ["bigOnceEvents", String(eventIndex), "dialogues", String(dialogueIndex), "speaker_key"]
        )
      }
      continue
    }

    if (!allowedSpeakerKeys.has(dialogue.speaker_key)) {
      pushIssue(
        issues,
        "error",
        "big-once.invalid-object-speaker",
        `Big once event "${event.id}" dialogue speaker "${dialogue.speaker_key}" is not in the current event objects.`,
        ["bigOnceEvents", String(eventIndex), "dialogues", String(dialogueIndex), "speaker_key"]
      )
    }
  }
}

function collectReachableEvents(
  startEventId: string,
  eventMap: Map<string, StoryEventFile>
) {
  const visited = new Set<string>()
  const stack = [startEventId]

  while (stack.length > 0) {
    const eventId = stack.pop()
    if (!eventId || visited.has(eventId)) {
      continue
    }

    visited.add(eventId)

    const event = eventMap.get(eventId)
    if (!event) {
      continue
    }

    for (const nextId of event.next) {
      stack.push(nextId)
    }
  }

  return visited
}

export function validateStoryDocument(document: StoryDocument): ValidationResult {
  const issues: ValidationIssue[] = []
  const graphEvents = document.graphEvents
  const bigOnceEvents = document.bigOnceEvents
  const loopEvents = document.loopEvents
  const graphEventMap = buildEventMap(graphEvents)
  const eventMap = buildAllEventMap(graphEvents, bigOnceEvents, loopEvents)
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
    { key: "graphEvents", events: graphEvents },
    { key: "bigOnceEvents", events: bigOnceEvents },
    { key: "loopEvents", events: loopEvents }
  ] as const satisfies Array<{
    key: "graphEvents" | "bigOnceEvents" | "loopEvents"
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

      if (group.key === "bigOnceEvents") {
        validateBigOnceEvent(event as StoryBigOnceEventFile, eventIndex, document, issues)
      }
    }
  }

  if (document.story.startEventId) {
    if (!graphEventMap.has(document.story.startEventId)) {
      pushIssue(
        issues,
        "error",
        "story.invalid-start",
        `Start event "${document.story.startEventId}" does not exist.`,
        ["story", "startEventId"]
      )
    } else {
      const reachable = collectReachableEvents(document.story.startEventId, graphEventMap)

      for (const event of graphEvents) {
        if (!reachable.has(event.id)) {
          pushIssue(
            issues,
            "warning",
            "event.unreachable",
            `Event "${event.id}" cannot be reached from the configured start event.`,
            ["graphEvents", event.id]
          )
        }
      }
    }
  } else {
    pushIssue(
      issues,
      "warning",
      "story.no-start-event",
      "The story does not define a start event yet.",
      ["story", "startEventId"]
    )
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

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues
  }
}
