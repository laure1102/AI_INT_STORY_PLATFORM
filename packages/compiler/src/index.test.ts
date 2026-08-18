import { describe, expect, it } from "vitest"
import { storyDocumentSchema, type StoryDocument } from "@story-mgr/core"
import { hashEvolutionPackage, type StoryEvolutionPackage } from "@story-mgr/evolution"
import { compileEffectiveStory } from "./index"

function createDocument(): StoryDocument {
  return storyDocumentSchema.parse({
    story: { id: "story", title: "Compiler Evolution" },
    vals: { variables: [{ name: "player", vals: [{ name: "money", value_type: "value", value: 0, calc_rule: "" }] }] },
    playerOverrideVals: { entries: [] },
    systemVals: { variables: [] },
    scenes: {},
    roles: { normal: { roles: [{ id: "npc", name: "NPC" }] }, important: { roles: [] } },
    eventLocations: {},
    initialBags: { player: { entries: [] } },
    contact: { talk_library: [{ id: "hello", text: "Hello" }] }
  })
}

function makePackage(document: StoryDocument, id: string, sequence: number, parents: string[] = [], overrides: Partial<StoryEvolutionPackage> = {}): StoryEvolutionPackage {
  const base = compileEffectiveStory({ document, evolutionPackages: [] }).compiled.contentHash!
  const unsigned = {
    schema_version: 1 as const,
    package_id: id,
    story_id: document.story.id,
    scope: { type: "global" as const, id: "global" },
    sequence,
    base_content_hash: base,
    parent_package_ids: parents,
    created_at: "2026-01-01T00:00:00.000Z",
    patch: { world_state_patch: { phase: id } },
    semantic_model: { model_id: "Xenova/bge-small-zh-v1.5" as const, dimension: 512 as const, normalized: true as const },
    semantic_entries: [],
    world_state_patch: { phase: id },
    ...overrides
  }
  const { package_hash: _ignored, ...unsignedPackage } = unsigned as typeof unsigned & { package_hash?: string }
  return { ...unsignedPackage, package_hash: hashEvolutionPackage(unsignedPackage) }
}

describe("compileEffectiveStory", () => {
  it("produces a stable effective hash for the same base and package chain", () => {
    const document = createDocument()
    const first = makePackage(document, "first", 1)
    const second = makePackage(document, "second", 2, ["first"])
    const left = compileEffectiveStory({ document, evolutionPackages: [first, second] })
    const right = compileEffectiveStory({ document, evolutionPackages: [second, first] })

    expect(left.result.ok).toBe(true)
    expect(right.result.ok).toBe(true)
    expect(left.compiled.effectiveContentHash).toBe(right.compiled.effectiveContentHash)
    expect(left.compiled.activePackageIds).toEqual(["first", "second"])
  })

  it("changes the effective hash when the package chain changes", () => {
    const document = createDocument()
    const first = makePackage(document, "first", 1)
    const second = makePackage(document, "second", 2, ["first"])
    const alternative = makePackage(document, "alternative", 2, ["first"])

    const originalHash = compileEffectiveStory({ document, evolutionPackages: [first, second] }).compiled.effectiveContentHash
    const alternativeHash = compileEffectiveStory({ document, evolutionPackages: [first, alternative] }).compiled.effectiveContentHash
    expect(originalHash).not.toBe(alternativeHash)
  })

  it("emits semantic entries and world state and revalidates the patched document", () => {
    const document = createDocument()
    const semantic = makePackage(document, "semantic", 1, [], {
      semantic_entries: [{
        id: "greet",
        role_key: "normal:npc",
        utterances: ["hello"],
        response_kind: "talk",
        response_id: "hello",
        condition_expr: "${world.enabled} === true",
        min_score: 0.7,
        priority: 1,
        vector: [1, ...Array(511).fill(0)]
      }],
      world_state_patch: { enabled: true },
      patch: { world_state_patch: { enabled: true } }
    })
    const valid = compileEffectiveStory({ document, evolutionPackages: [semantic] })
    expect(valid.result.ok).toBe(true)
    expect(valid.compiled.semanticEntries?.map((entry) => entry.id)).toEqual(["greet"])
    expect(valid.compiled.worldState).toEqual({ enabled: true })

    const removeRole = makePackage(document, "remove-role", 2, ["semantic"], {
      patch: { roles: { upsert: [], remove: ["npc"] }, world_state_patch: {} },
      world_state_patch: {}
    })
    const invalid = compileEffectiveStory({ document, evolutionPackages: [semantic, removeRole] })
    expect(invalid.result.ok).toBe(false)
    expect(invalid.result.issues.some((issue) => issue.code === "semantic.missing-role")).toBe(true)
  })
})
