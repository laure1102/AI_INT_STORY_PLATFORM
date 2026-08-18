import { describe, expect, it } from "vitest"
import { createRuntimeContentRegistry } from "./content-registry"
import { hashEvolutionPackage, type StoryEvolutionPackage } from "@story-mgr/evolution"

function makePackage(id: string, sequence: number, parents: string[] = []): StoryEvolutionPackage {
  const unsigned = {
    schema_version: 1 as const,
    package_id: id,
    story_id: "story",
    scope: { type: "global" as const, id: "global" },
    sequence,
    base_content_hash: "a".repeat(64),
    parent_package_ids: parents,
    created_at: "2026-01-01T00:00:00.000Z",
    patch: { world_state_patch: { [id]: sequence } },
    semantic_model: { model_id: "Xenova/bge-small-zh-v1.5" as const, dimension: 512 as const, normalized: true as const },
    semantic_entries: [],
    world_state_patch: { [id]: sequence }
  }
  return { ...unsigned, package_hash: hashEvolutionPackage(unsigned) }
}

describe("RuntimeContentRegistry", () => {
  it("queues, applies dependencies and exposes an immutable effective bundle", () => {
    const registry = createRuntimeContentRegistry({ baseBundle: { storyId: "story", title: "Story", generatedAt: "now", contentHash: "a".repeat(64), vals: { variables: [] }, playerOverrideVals: { entries: [] }, systemVals: { variables: [] }, scenes: {}, roles: {}, eventLocations: {}, items: { items: [] }, chainEvents: {} } })
    const parent = makePackage("parent", 1)
    const child = makePackage("child", 2, ["parent"])
    expect(registry.queuePackage(child).queued).toBe(true)
    expect(registry.queuePackage(parent).queued).toBe(true)
    expect(registry.applyPendingPackages().installed).toBe(true)
    expect(registry.getActivePackageIds()).toEqual(["parent", "child"])
    const bundle = registry.getEffectiveBundle()
    bundle.worldState!.parent = 999
    expect(registry.getEffectiveBundle().worldState?.parent).toBe(1)
  })

  it("applies structured bundle domain patches and removes stale entries", () => {
    const registry = createRuntimeContentRegistry({ baseBundle: {
      storyId: "story", title: "Story", generatedAt: "now", contentHash: "a".repeat(64), vals: { variables: [{ name: "old", vals: [] }] },
      playerOverrideVals: { entries: [] }, systemVals: { variables: [] }, scenes: {}, roles: { normal: { roles: [{ id: "r1", name: "旧" }] }, important: { roles: [] } },
      eventLocations: {}, items: { items: [{ id: "i1", name: "旧物" }] }, chainEvents: {},
      doing: { menus: [], doings: [] }, shop: { currency_value_key: "player.money", categories: [], products: [] },
      contact: { default_channel_id: "generic", channels: [], relationship_tracks: [], personality_library: [], talk_library: [], action_library: [], reply_library: [], player_quick_messages: [], contact_profiles: [], fallback_replies: {} }
    } })
    const unsigned = makePackage("domain", 1)
    const pkg = { ...unsigned, patch: {
      vals: { upsert: [{ name: "new", vals: [] }], remove: ["old"] },
      roles: { upsert: [{ namespace: "important", id: "r2", name: "重要角色" }], remove: [] },
      items: { upsert: [{ collection: "items", id: "i2", name: "新物", category_id: "prop" }], remove: ["i1"] },
      doing: { upsert: [{ collection: "menus", id: "m1", title: "菜单" }, { collection: "doings", id: "d1", menu_id: "m1" }], remove: [] },
      shop: { upsert: [{ collection: "categories", id: "c1", name: "分类" }, { collection: "products", id: "p1", item_id: "i2" }], remove: [] },
      contact: { upsert: [{ collection: "talk_library", id: "talk-1", text: "你好" }], remove: [] },
      world_state_patch: {}
    } } as StoryEvolutionPackage
    const { package_hash: _packageHash, ...unsignedPackage } = pkg
    const signed = { ...pkg, package_hash: hashEvolutionPackage(unsignedPackage) }
    expect(registry.queuePackage(signed).queued).toBe(true)
    registry.applyPendingPackages()
    const bundle = registry.getEffectiveBundle()
    expect(bundle.vals.variables.map((item) => item.name)).toEqual(["new"])
    expect(bundle.items?.items.map((item) => item.id)).toEqual(["i2"])
    expect((bundle.roles as { normal: { roles: unknown[] }; important: { roles: Array<{ id: string }> } }).normal.roles).toHaveLength(1)
    expect((bundle.roles as { normal: { roles: unknown[] }; important: { roles: Array<{ id: string }> } }).important.roles.map((role) => role.id)).toEqual(["r2"])
    expect(bundle.doing?.menus.map((item) => item.id)).toEqual(["m1"])
    expect(bundle.doing?.doings.map((item) => item.id)).toEqual(["d1"])
    expect(bundle.shop?.categories.map((item) => item.id)).toEqual(["c1"])
    expect(bundle.shop?.products.map((item) => item.id)).toEqual(["p1"])
    expect(bundle.contact?.talk_library.map((item) => item.id)).toEqual(["talk-1"])
    expect(bundle.contact?.channels).toEqual([])
  })

  it("replaces the active package set so a manifest rollback removes later content", () => {
    const registry = createRuntimeContentRegistry({ baseBundle: { storyId: "story", title: "Story", generatedAt: "now", contentHash: "a".repeat(64), vals: { variables: [] }, playerOverrideVals: { entries: [] }, systemVals: { variables: [] }, scenes: {}, roles: {}, eventLocations: {}, items: { items: [] }, chainEvents: {} } })
    const parent = makePackage("parent", 1)
    const child = makePackage("child", 2, ["parent"])
    expect(registry.replacePackages([parent, child]).packageIds).toEqual(["parent", "child"])
    expect(registry.getEffectiveBundle().worldState).toEqual({ parent: 1, child: 2 })
    expect(registry.replacePackages([parent]).packageIds).toEqual(["parent"])
    expect(registry.getEffectiveBundle().worldState).toEqual({ parent: 1 })
    expect(registry.replacePackages([child]).reason).toContain("缺少父包")
  })
})
