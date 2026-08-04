/**
 * 故事元信息、变量和称谓库的持久化 Schema。
 *
 * Schema 同时负责补默认值和清理字符串；业务引用完整性由 validate 模块检查。
 */
import { z } from "zod"

export const looseMetaSchema = z.record(z.unknown())

const storyTimeOfDaySchema = z.string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .default("00:00")

export const storyGameSettingsSchema = z.object({
  start_time: storyTimeOfDaySchema
}).default({
  start_time: "00:00"
})

export const storyMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  game_settings: storyGameSettingsSchema
})

const storyValValueTypeSchema = z.enum(["value", "calc"])

export const storyValEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  value_type: storyValValueTypeSchema.default("value"),
  value: z.unknown().optional(),
  calc_rule: z.string().default("")
}).superRefine((entry, context) => {
  if (entry.value_type === "calc" && entry.calc_rule.trim().length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "calc_rule is required when value_type is calc.",
      path: ["calc_rule"]
    })
  }
})

export const storyValSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  vals: z.array(storyValEntrySchema).default([])
})

export const storyValsSchema = z.object({
  variables: z.array(storyValSchema).default([])
})

const storyPlayerOverrideInputTypeSchema = z.enum(["text", "select"])

export const storyPlayerOverrideInputOptionSchema = z.object({
  label: z.string().default(""),
  value: z.string().default("")
})

export const storyPlayerOverrideValEntrySchema = z.object({
  var_key: z.string().min(1),
  need_player_override: z.boolean().default(false),
  tips: z.string().default(""),
  group_no: z.number().int().min(1).default(1),
  input_type: storyPlayerOverrideInputTypeSchema.default("text"),
  input_options: z.array(storyPlayerOverrideInputOptionSchema).default([])
})

export const storyPlayerOverrideValsSchema = z.object({
  entries: z.array(storyPlayerOverrideValEntrySchema).default([])
})

export const storyReferGenderAliasesSchema = z.object({
  male: z.array(z.string()).default(["男", "male", "m"]),
  female: z.array(z.string()).default(["女", "female", "f"])
}).transform((aliases) => ({
  male: Array.from(new Set(aliases.male.map((item) => item.trim()).filter(Boolean))),
  female: Array.from(new Set(aliases.female.map((item) => item.trim()).filter(Boolean)))
}))

export const storyReferTermSchema = z.object({
  id: z.string().min(1),
  label: z.string().default(""),
  male: z.string().default(""),
  female: z.string().default(""),
  fallback: z.string().default("")
}).transform((term) => ({
  id: term.id.trim(),
  label: term.label.trim(),
  male: term.male.trim(),
  female: term.female.trim(),
  fallback: term.fallback.trim()
}))

export const storyReferSchema = z.object({
  gender_value_key: z.string().default("player.gender"),
  gender_aliases: storyReferGenderAliasesSchema.default({
    male: ["男", "male", "m"],
    female: ["女", "female", "f"]
  }),
  terms: z.array(storyReferTermSchema).default([])
}).default({
  gender_value_key: "player.gender",
  gender_aliases: {
    male: ["男", "male", "m"],
    female: ["女", "female", "f"]
  },
  terms: []
}).superRefine((refer, context) => {
  const termIds = new Set<string>()

  for (const [termIndex, term] of refer.terms.entries()) {
    if (termIds.has(term.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate refer term id "${term.id}".`,
        path: ["terms", termIndex, "id"]
      })
    }

    termIds.add(term.id)
  }
}).transform((refer) => ({
  gender_value_key: refer.gender_value_key.trim() || "player.gender",
  gender_aliases: refer.gender_aliases,
  terms: refer.terms
}))

