import { describe, expect, it } from "vitest"
import type { StoryDocument } from "@story-mgr/core"
import { applyEvolutionPackages, hashEvolutionPackage, matchSemanticIntent, orderEvolutionPackages, validateEvolutionPackage, type StoryEvolutionPackage } from "./index"

function pkg(id: string, scope: StoryEvolutionPackage["scope"], sequence: number, parents: string[] = []): StoryEvolutionPackage {
  const unsigned = {
    schema_version: 1 as const, package_id: id, story_id: "story", scope, sequence,
    base_content_hash: "a".repeat(64), parent_package_ids: parents, created_at: "2026-01-01T00:00:00.000Z",
    patch: { world_state_patch: {} }, semantic_model: { model_id: "Xenova/bge-small-zh-v1.5" as const, dimension: 512 as const, normalized: true as const }, semantic_entries: [], world_state_patch: {}
  }
  return { ...unsigned, package_hash: hashEvolutionPackage(unsigned) }
}

describe("evolution package primitives", () => {
  it("validates deterministic hashes and orders scopes", () => {
    const global = pkg("g", { type: "global", id: "global" }, 1)
    const shard = pkg("s", { type: "shard", id: "one" }, 1, ["g"])
    const player = pkg("p", { type: "player", id: "me" }, 1, ["s"])
    expect(validateEvolutionPackage(global, "a".repeat(64)).ok).toBe(true)
    expect(orderEvolutionPackages([player, global, shard]).map((item) => item.package_id)).toEqual(["g", "s", "p"])
  })

  it("rejects a changed package hash and matches by margin", () => {
    const value = pkg("g", { type: "global", id: "global" }, 1)
    expect(validateEvolutionPackage({ ...value, package_hash: "bad" }).ok).toBe(false)
    const entries = [
      { id: "a", role_key: "normal:npc", utterances: ["a"], response_kind: "talk" as const, response_id: "t", condition_expr: "", min_score: 0.5, priority: 1, vector: [1, 0] },
      { id: "b", role_key: "normal:npc", utterances: ["b"], response_kind: "talk" as const, response_id: "t", condition_expr: "", min_score: 0.5, priority: 1, vector: [0, 1] }
    ]
    expect(matchSemanticIntent([1, 0], entries, { roleKey: "normal:npc" })?.entry.id).toBe("a")
    expect(matchSemanticIntent([0.71, 0.7], entries, { roleKey: "normal:npc", minMargin: 0.03 })).toBeNull()
  })

  it("rejects invalid model metadata and non-normalized vectors", () => {
    const value = pkg("g", { type: "global", id: "global" }, 1)
    const invalidDimension = { ...value, semantic_model: { ...value.semantic_model, dimension: 384 } }
    expect(validateEvolutionPackage(invalidDimension).ok).toBe(false)
    const unsigned = {
      ...value,
      semantic_entries: [{ id: "intent", role_key: "normal:npc", utterances: ["你好"], response_kind: "talk" as const, response_id: "talk", condition_expr: "", min_score: 0.5, priority: 1, vector: Array(512).fill(1) }]
    }
    const { package_hash: _oldHash, ...withoutHash } = unsigned
    expect(validateEvolutionPackage({ ...unsigned, package_hash: hashEvolutionPackage(withoutHash) }).ok).toBe(false)
  })

  it("applies array and multi-collection domains while remove wins over every upsert source", () => {
    const document = {
      vals: { variables: [] }, roles: { normal: { roles: [] }, important: { roles: [] } },
      items: { categories: [], items: [] }, eventLocations: { assignments: [] }, chainEvents: [], poolEvents: [], scheduleEvents: [],
      contact: { channels: [], personality_library: [], talk_library: [], action_library: [], reply_library: [], player_quick_messages: [], contact_profiles: [] },
      contactConversations: { conversations: [] }, doing: { menus: [], doings: [] }, shop: { categories: [], products: [] }
    } as unknown as StoryDocument
    const base = pkg("domains", { type: "global", id: "global" }, 1)
    const intent = { id: "removed-intent", role_key: "normal:npc", utterances: ["a"], response_kind: "talk" as const, response_id: "talk", condition_expr: "", min_score: 0.5, priority: 1, vector: [1] }
    const evolved: StoryEvolutionPackage = {
      ...base,
      patch: {
        chainEvents: { upsert: [{ id: "event-1", title: "事件" }], remove: [] },
        doing: { upsert: [{ collection: "menus", id: "menu-1", title: "菜单" }, { collection: "doings", id: "doing-1", menu_id: "menu-1" }], remove: [] },
        shop: { upsert: [{ collection: "categories", id: "category-1", name: "分类" }, { collection: "products", id: "product-1", item_id: "item-1" }], remove: [] },
        semantic_entries: { upsert: [intent], remove: [intent.id] },
        world_state_patch: {}
      },
      semantic_entries: [intent]
    }
    const { package_hash: _hash, ...unsigned } = evolved
    evolved.package_hash = hashEvolutionPackage(unsigned)
    const applied = applyEvolutionPackages(document, [evolved])
    expect(applied.document.chainEvents.map((entry) => entry.id)).toEqual(["event-1"])
    expect(applied.document.doing.menus.map((entry) => entry.id)).toEqual(["menu-1"])
    expect(applied.document.doing.doings.map((entry) => entry.id)).toEqual(["doing-1"])
    expect(applied.document.shop.categories.map((entry) => entry.id)).toEqual(["category-1"])
    expect(applied.document.shop.products.map((entry) => entry.id)).toEqual(["product-1"])
    expect(applied.semanticEntries).toEqual([])
  })
})
