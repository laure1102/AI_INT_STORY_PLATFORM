import { describe, expect, it } from "vitest"
import { compileStory } from "@story-mgr/compiler"
import { storyDocumentSchema } from "@story-mgr/core"
import { validateEvolutionPackage } from "@story-mgr/evolution"
import type { EvolutionEmbeddingProvider } from "./evolution-embedding"
import { EVOLUTION_NODE_NAMES, runEvolutionWorkflow, type EvolutionStructuredOutputInvoker } from "./evolution-workflow"

const semanticEntry = {
  id: "semantic-greeting",
  role_key: "normal:npc",
  utterances: ["你好", "在吗"],
  response_kind: "talk" as const,
  response_id: "hello",
  condition_expr: "",
  min_score: 0.7,
  priority: 10
}

function createDocument() {
  return storyDocumentSchema.parse({
    story: { id: "story", title: "Evolution Workflow" },
    vals: { variables: [{ name: "player", vals: [{ name: "money", value_type: "value", value: 0, calc_rule: "" }] }] },
    playerOverrideVals: { entries: [] },
    systemVals: { variables: [] },
    scenes: {},
    roles: { normal: { roles: [{ id: "npc", name: "NPC" }] }, important: { roles: [] } },
    eventLocations: {},
    initialBags: { player: { entries: [] } },
    contact: { talk_library: [{ id: "hello", text: "你好。" }] }
  })
}

describe("runEvolutionWorkflow", () => {
  it("executes the fixed graph, validates structured output and publishes a simulated package", async () => {
    const calls: string[] = []
    const structuredOutputInvoker: EvolutionStructuredOutputInvoker = async (_schema, name) => {
      calls.push(name)
      if (name === "StoryEvolutionWorldState") return { summary: "世界进入新阶段", world_state_patch: { phase: "rising" } }
      if (name === "StoryEvolutionPlotPlan") return { summary: "NPC 主动回应", goals: ["新增语义入口"], constraints: ["保留现有引用"] }
      if (name === "StoryEvolutionEventPatch") {
        return { patch: { world_state_patch: { event_ready: true } }, semantic_entries: [], world_state_patch: { event_ready: true } }
      }
      if (name === "StoryEvolutionContactPatch" || name === "StoryEvolutionScriptDoctor") {
        return {
          patch: { world_state_patch: { contact_ready: true } },
          semantic_entries: [semanticEntry],
          world_state_patch: { contact_ready: true }
        }
      }
      throw new Error(`Unexpected structured output request: ${name}`)
    }
    let embeddedTexts: readonly string[] = []
    const embeddingProvider: EvolutionEmbeddingProvider = {
      modelId: "Xenova/bge-small-zh-v1.5",
      dimension: 512,
      normalized: true,
      async embedMany(texts) {
        embeddedTexts = texts
        return texts.map(() => [1, ...Array(511).fill(0)])
      }
    }
    const document = createDocument()
    const baseContentHash = compileStory(document).compiled.contentHash!
    const pkg = await runEvolutionWorkflow({
      storyId: "story",
      instruction: "让 NPC 响应问候",
      scope: { type: "global", id: "global" },
      document,
      baseContentHash,
      parentPackageIds: [],
      sequence: 1,
      context: { worldState: { phase: "quiet" }, aggregates: { "contact.intent_fallback": 12 } },
      structuredOutputInvoker,
      embeddingProvider
    })

    expect(EVOLUTION_NODE_NAMES).toEqual([
      "contextCollector", "worldStateAnalyzer", "plotPlanner", "eventWriter", "contactWriter",
      "scriptDoctor", "consistencyChecker", "runtimeSimulator", "packagePublisher"
    ])
    expect(calls).toEqual([
      "StoryEvolutionWorldState", "StoryEvolutionPlotPlan", "StoryEvolutionEventPatch",
      "StoryEvolutionContactPatch", "StoryEvolutionScriptDoctor"
    ])
    expect(embeddedTexts).toEqual(["你好\n在吗"])
    expect(pkg.semantic_entries[0]?.vector).toHaveLength(512)
    expect(pkg.world_state_patch).toEqual({ phase: "rising", event_ready: true, contact_ready: true })
    expect(validateEvolutionPackage(pkg, baseContentHash)).toEqual({ ok: true, errors: [] })
  })

  it("rejects invalid structured model output before publication", async () => {
    const document = createDocument()
    await expect(runEvolutionWorkflow({
      storyId: "story",
      instruction: "invalid",
      scope: { type: "global", id: "global" },
      document,
      baseContentHash: compileStory(document).compiled.contentHash!,
      parentPackageIds: [],
      sequence: 1,
      structuredOutputInvoker: async () => ({ summary: "missing required fields" })
    })).rejects.toThrow()
  })
})
