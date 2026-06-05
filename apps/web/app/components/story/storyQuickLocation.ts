import type { StoryEventLocationAssignment, StoryEventLocationFile } from "@story-mgr/core"

export interface StoryQuickCreateLocationPayload {
  descr: string
  id: string
}

export function sanitizeQuickLocationIdInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function hasQuickLocationIdConflict(
  eventLocations: StoryEventLocationFile,
  sanitizedId: string
) {
  if (!sanitizedId) {
    return false
  }

  return eventLocations.assignments.some((assignment) => assignment.id.trim() === sanitizedId)
}

export function buildQuickCreateLocationPayload(input: {
  descr: string
  id: string
}): StoryQuickCreateLocationPayload | null {
  const sanitizedId = sanitizeQuickLocationIdInput(input.id)

  if (!sanitizedId) {
    return null
  }

  return {
    descr: input.descr.trim(),
    id: sanitizedId
  }
}

function createQuickLocationAssignment(
  payload: StoryQuickCreateLocationPayload
): StoryEventLocationAssignment {
  return {
    descr: payload.descr.trim(),
    id: payload.id,
    img_compress_1: "",
    img_compress_2: "",
    img_raw: "",
    prompt: ""
  }
}

export function appendQuickLocationToEventLocations(
  eventLocations: StoryEventLocationFile,
  payload: StoryQuickCreateLocationPayload
): StoryEventLocationFile {
  return {
    ...eventLocations,
    assignments: [...eventLocations.assignments, createQuickLocationAssignment(payload)]
  }
}
