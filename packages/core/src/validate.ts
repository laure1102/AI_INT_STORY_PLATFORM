import type {
  StoryBigOnceEventFile,
  StoryDocument,
  StoryEventFile,
  StoryLoopEventFile,
  ValidationIssue,
  ValidationResult
} from "./types"

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
  ] as const

  for (const group of eventGroups) {
    for (const event of group.events) {
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
  }

  if (document.story.startEventId) {
    if (!eventMap.has(document.story.startEventId)) {
      pushIssue(
        issues,
        "error",
        "story.invalid-start",
        `Start event "${document.story.startEventId}" does not exist.`,
        ["story", "startEventId"]
      )
    } else {
      const reachable = collectReachableEvents(document.story.startEventId, eventMap)

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

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues
  }
}
