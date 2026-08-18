import { z } from "zod"

const evolutionIdentifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const evolutionFileIdentifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const evolutionContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/)

/** Shared schema for a player, shard or global evolution scope. */
export const evolutionScopeSchema = z.object({
  type: z.enum(["player", "shard", "global"]),
  id: evolutionIdentifierSchema
}).superRefine((scope, context) => {
  if (scope.type === "global" && scope.id !== "global") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["id"], message: "Global evolution scope id must be global." })
  }
})

/** Shared schema for a local semantic contact intent. */
export const semanticContactIntentSchema = z.object({
  id: evolutionIdentifierSchema, role_key: z.string().min(1), utterances: z.array(z.string().min(1)).min(1),
  response_kind: z.enum(["talk", "action"]), response_id: z.string().min(1), condition_expr: z.string(),
  min_score: z.number().finite().min(-1).max(1), priority: z.number().int(), vector: z.array(z.number().finite()).optional()
})

const patchCollectionSchema = z.object({ upsert: z.array(z.unknown()).default([]), remove: z.array(z.string()).default([]) }).strict()

/** Shared schema for the constrained, structured evolution patch. */
export const evolutionPatchSchema = z.object({
  vals: patchCollectionSchema.optional(), roles: patchCollectionSchema.optional(), items: patchCollectionSchema.optional(),
  eventLocations: patchCollectionSchema.optional(), chainEvents: patchCollectionSchema.optional(), poolEvents: patchCollectionSchema.optional(),
  scheduleEvents: patchCollectionSchema.optional(), contact: patchCollectionSchema.optional(), contactConversations: patchCollectionSchema.optional(),
  doing: patchCollectionSchema.optional(), shop: patchCollectionSchema.optional(), semantic_entries: patchCollectionSchema.optional(),
  world_state_patch: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
}).strict()

/** Shared schema for the immutable package envelope. */
export const evolutionPackageSchema = z.object({
  schema_version: z.literal(1), package_id: evolutionFileIdentifierSchema, story_id: evolutionIdentifierSchema, scope: evolutionScopeSchema,
  sequence: z.number().int().nonnegative(), base_content_hash: evolutionContentHashSchema, parent_package_ids: z.array(evolutionFileIdentifierSchema),
  created_at: z.string().datetime(), patch: evolutionPatchSchema,
  semantic_model: z.object({ model_id: z.literal("Xenova/bge-small-zh-v1.5"), dimension: z.literal(512), normalized: z.literal(true) }).strict(),
  semantic_entries: z.array(semanticContactIntentSchema), world_state_patch: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])), package_hash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()

/** Shared schema for manifest responses. */
export const storyEvolutionManifestSchema = z.object({
  storyId: evolutionIdentifierSchema, baseContentHash: evolutionContentHashSchema, packageIds: z.array(evolutionFileIdentifierSchema), effectiveContentHash: evolutionContentHashSchema,
  semanticModel: z.object({ modelId: z.literal("Xenova/bge-small-zh-v1.5"), dimension: z.literal(512), normalized: z.literal(true) }),
  worldRevision: z.number().int().nonnegative(), generatedAt: z.string().datetime()
})

/** Shared schema for structured telemetry accepted by the API. */
export const telemetryEventSchema = z.object({
  eventId: z.string().min(1).max(128), storyId: z.string().min(1).max(128), playerId: z.string().min(1).max(128), shardId: z.string().min(1).max(128), sessionId: z.string().min(1).max(128), sequence: z.number().int().nonnegative(), occurredAt: z.string().datetime(),
  type: z.enum(["event.completed", "choice.selected", "doing.used", "contact.intent_matched", "contact.intent_fallback", "milestone.reached", "package.installed", "package.rejected"]),
  payload: z.record(z.union([z.string().max(512), z.number(), z.boolean(), z.null()])).default({})
}).strict()
