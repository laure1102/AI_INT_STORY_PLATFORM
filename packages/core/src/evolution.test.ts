import { describe, expect, it } from "vitest"
import type { StoryDocument } from "./types"
import { validateEvolutionPackageDependencies, validateEvolutionPatchKeys, validateSemanticContactIntents } from "./evolution"

function document(): StoryDocument {
  return {
    vals: { variables: [] },
    systemVals: { variables: [{ name: "system", vals: [{ name: "day", value_type: "value", value: 1, calc_rule: "" }] }] },
    roles: { normal: { roles: [{ id: "npc" }] }, important: { roles: [] } },
    contact: { talk_library: [{ id: "talk" }], action_library: [] }
  } as unknown as StoryDocument
}

describe("evolution core validation", () => {
  it("accepts runtime variables and readonly world context in semantic conditions", () => {
    const vector = [1, ...Array(511).fill(0)]
    const result = validateSemanticContactIntents(document(), [{
      id: "intent", role_key: "normal:npc", utterances: ["你好"], response_kind: "talk", response_id: "talk",
      condition_expr: "${world.phase} != \"closed\" && ${system.day} >= 1", min_score: 0.6, priority: 1, vector
    }])
    expect(result.ok).toBe(true)
  })

  it("rejects recursive protected keys, unknown responses and non-normalized vectors", () => {
    expect(validateEvolutionPatchKeys({ contact: { upsert: [{ meta: { story_bible: "forbidden" } }] } }).ok).toBe(false)
    const result = validateSemanticContactIntents(document(), [{
      id: "intent", role_key: "normal:npc", utterances: ["你好"], response_kind: "action", response_id: "missing",
      condition_expr: "", min_score: 0.6, priority: 1, vector: Array(512).fill(1)
    }])
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["semantic.missing-response", "semantic.vector-not-normalized"]))
  })

  it("rejects cross-scope lineage, later parents and missing parents", () => {
    const packages = [
      { package_id: "g", base_content_hash: "base", parent_package_ids: [], scope: { type: "global" as const, id: "global" }, sequence: 1 },
      { package_id: "s1", base_content_hash: "base", parent_package_ids: ["g"], scope: { type: "shard" as const, id: "one" }, sequence: 2 },
      { package_id: "s2", base_content_hash: "base", parent_package_ids: ["s1", "missing"], scope: { type: "shard" as const, id: "two" }, sequence: 1 }
    ]
    const result = validateEvolutionPackageDependencies(packages, "base")
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["evolution.scope-lineage", "evolution.order", "evolution.missing-parent"]))
  })
})
