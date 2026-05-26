import { z } from "zod"

const looseMetaSchema = z.record(z.unknown())

export const storyMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  startEventId: z.string().min(1).optional(),
  tags: z.array(z.string()).optional()
})

export const storyValSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1).optional(),
  initialValue: z.unknown().optional(),
  description: z.string().optional(),
  meta: looseMetaSchema.optional()
})

export const storyValsSchema = z.object({
  variables: z.array(storyValSchema).default([])
})

export const storySceneEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  image: z.string().min(1).optional(),
  description: z.string().optional(),
  meta: looseMetaSchema.optional()
})

export const storySceneSchema = z.object({
  scenes: z.array(storySceneEntrySchema).default([])
})

export const storyRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  avatar: z.string().min(1).optional(),
  description: z.string().optional(),
  meta: looseMetaSchema.optional()
})

export const storyRolesSchema = z.object({
  roles: z.array(storyRoleSchema).default([])
})

export const storyEventLocationAssignmentSchema = z.object({
  eventId: z.string().min(1),
  sceneId: z.string().min(1).optional(),
  location: z.string().min(1),
  description: z.string().optional(),
  meta: looseMetaSchema.optional()
})

export const storyEventLocationSchema = z.object({
  assignments: z.array(storyEventLocationAssignmentSchema).default([])
})

export const storyEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.string().min(1),
  body: z.string().optional(),
  next: z.array(z.string()),
  meta: z.record(z.unknown()).optional()
})

export const storyEventTriggerSchema = z.object({
  all: z.array(looseMetaSchema).optional(),
  any: z.array(looseMetaSchema).optional(),
  none: z.array(looseMetaSchema).optional()
})

export const storyGraphEventsSchema = z.array(storyEventSchema).default([])

export const storyBigOnceEventSchema = storyEventSchema.extend({
  trigger: storyEventTriggerSchema.optional()
})

export const storyBigOnceEventsSchema = z.array(storyBigOnceEventSchema).default([])

export const storyLoopEventSchema = storyEventSchema.extend({
  trigger: storyEventTriggerSchema.optional(),
  cooldown: looseMetaSchema.optional()
})

export const storyLoopEventsSchema = z.array(storyLoopEventSchema).default([])

export const storyDocumentSchema = z.object({
  story: storyMetaSchema,
  vals: storyValsSchema,
  scenes: storySceneSchema,
  roles: storyRolesSchema,
  eventLocations: storyEventLocationSchema,
  graphEvents: storyGraphEventsSchema,
  bigOnceEvents: storyBigOnceEventsSchema,
  loopEvents: storyLoopEventsSchema
})
