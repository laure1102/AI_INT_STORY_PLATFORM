import type { StoryEventLocationAssignment, StoryEventLocationFile } from "@story-mgr/core"

export interface StoryQuickCreateLocationPayload {
  descr: string
  name: string
}

export function sanitizeQuickLocationNameInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function hasQuickLocationNameConflict(
  eventLocations: StoryEventLocationFile,
  sanitizedName: string
) {
  if (!sanitizedName) {
    return false
  }

  return eventLocations.assignments.some((assignment) => assignment.name.trim() === sanitizedName)
}

export function buildQuickCreateLocationPayload(input: {
  descr: string
  name: string
}): StoryQuickCreateLocationPayload | null {
  const sanitizedName = sanitizeQuickLocationNameInput(input.name)

  if (!sanitizedName) {
    return null
  }

  return {
    descr: input.descr.trim(),
    name: sanitizedName
  }
}

function createQuickLocationAssignment(
  payload: StoryQuickCreateLocationPayload
): StoryEventLocationAssignment {
  return {
    descr: payload.descr.trim(),
    img_compress_1: "",
    img_compress_2: "",
    img_raw: "",
    name: payload.name,
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
