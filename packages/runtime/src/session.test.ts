import { describe, expect, it } from "vitest"
import {
  createStorySession,
  type RuntimeScheduledEvent,
  type RuntimeStoryBundle,
  type RuntimeStorySaveState,
  type RuntimeStorySession,
  type RuntimeStorySessionSnapshot
} from "./session"
import { hashEvolutionPackage, type StoryEvolutionPackage } from "@story-mgr/evolution"

function createBundle(options: Partial<RuntimeStoryBundle> = {}): RuntimeStoryBundle {
  return {
    schemaVersion: 2,
    contentHash: "a".repeat(64),
    storyId: "runtime_test",
    title: "Runtime Test",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vals: { variables: [] },
    playerOverrideVals: { entries: [] },
    systemVals: { variables: [] },
    scenes: { scenes: [] },
    roles: { normal: { roles: [] }, important: { roles: [] } },
    eventLocations: { assignments: [] },
    chainEvents: {},
    poolEvents: [],
    scheduleEvents: [],
    ...options
  }
}

function makeEvolutionPackage(bundle: RuntimeStoryBundle, id: string, sequence: number, parents: string[] = [], worldState: Record<string, string | number | boolean | null> = { [id]: sequence }): StoryEvolutionPackage {
  const unsigned = {
    schema_version: 1 as const,
    package_id: id,
    story_id: bundle.storyId,
    scope: { type: "global" as const, id: "global" },
    sequence,
    base_content_hash: bundle.baseContentHash ?? bundle.contentHash!,
    parent_package_ids: parents,
    created_at: "2026-01-01T00:00:00.000Z",
    patch: { world_state_patch: worldState },
    semantic_model: { model_id: "Xenova/bge-small-zh-v1.5" as const, dimension: 512 as const, normalized: true as const },
    semantic_entries: [],
    world_state_patch: worldState
  }
  return { ...unsigned, package_hash: hashEvolutionPackage(unsigned) }
}

function createShopBundle(money: number): RuntimeStoryBundle {
  return createBundle({
    vals: {
      variables: [
        {
          name: "player",
          vals: [
            { name: "money", value_type: "value", value: money, calc_rule: "" }
          ]
        }
      ]
    },
    roles: {
      normal: {
        roles: [
          { id: "friend", name: "好友", descr: "测试好友", zhiye: "" }
        ]
      },
      important: { roles: [] }
    },
    items: {
      items: [
        { id: "gift_box", name: "礼盒", stackable: true, max_stack: 99 }
      ]
    },
    shop: {
      currency_value_key: "player.money",
      categories: [
        { id: "gifts", name: "礼品", sort_order: 10, visible_expr: "", descr: "" }
      ],
      products: [
        {
          id: "gift_box_product",
          category_id: "gifts",
          item_id: "gift_box",
          price: 199,
          quantity: 1,
          sort_order: 10,
          enabled: true,
          available_expr: "",
          unavailable_reason: "",
          allow_gift: true,
          gift_favor_delta: 3,
          purchase_cooldown_hours: 12,
          gift_cooldown_hours: 24
        }
      ]
    }
  })
}

/** @returns 含可赠、绑定和无配置物品，以及好友/陌生人角色的背包赠礼测试 bundle。 */
function createBagGiftBundle(): RuntimeStoryBundle {
  return createBundle({
    vals: {
      variables: [
        {
          name: "player",
          vals: [
            { name: "money", value_type: "value", value: 5000, calc_rule: "" }
          ]
        }
      ]
    },
    roles: {
      normal: {
        roles: [
          { id: "friend", name: "好友", descr: "测试好友", zhiye: "", contact_enabled: true },
          { id: "stranger", name: "陌生人", descr: "非联系人", zhiye: "", contact_enabled: true }
        ]
      },
      important: { roles: [] }
    },
    items: {
      items: [
        { id: "gift_box", name: "礼盒", stackable: true, max_stack: 99 },
        { id: "bound_badge", name: "绑定徽章", stackable: true, max_stack: 99 },
        { id: "plain_note", name: "普通便笺", stackable: true, max_stack: 99 }
      ]
    },
    initialBags: {
      player: {
        entries: [
          { item_id: "gift_box", quantity: 5 },
          { item_id: "bound_badge", quantity: 2, bound: true },
          { item_id: "plain_note", quantity: 2 }
        ]
      }
    },
    shop: {
      currency_value_key: "player.money",
      categories: [
        { id: "gifts", name: "礼品", sort_order: 10, visible_expr: "", descr: "" }
      ],
      products: [
        {
          id: "gift_box_product",
          category_id: "gifts",
          item_id: "gift_box",
          price: 199,
          quantity: 1,
          sort_order: 10,
          enabled: true,
          available_expr: "",
          unavailable_reason: "",
          allow_gift: true,
          gift_favor_delta: 3,
          purchase_cooldown_hours: 12,
          gift_cooldown_hours: 24
        },
        {
          id: "bound_badge_product",
          category_id: "gifts",
          item_id: "bound_badge",
          price: 10,
          quantity: 1,
          sort_order: 20,
          enabled: true,
          available_expr: "",
          unavailable_reason: "",
          allow_gift: true,
          gift_favor_delta: 1,
          purchase_cooldown_hours: 0,
          gift_cooldown_hours: 0
        }
      ]
    }
  })
}

/**
 * 创建已拥有好友联系人的背包赠礼会话。
 * @param bundle 测试 bundle。 @param updateSnapshot 可选的存档状态改写。 @returns 从测试存档恢复的会话。
 */
function createBagGiftSession(
  bundle: RuntimeStoryBundle,
  updateSnapshot?: (snapshot: RuntimeStorySessionSnapshot) => void
) {
  const seed = createStorySession({ bundle })
  const snapshot = seed.getSnapshot()
  snapshot.contact.contacts.push({
    role_key: "normal:friend",
    favor: 20,
    unlocked_at_day: 1
  })
  updateSnapshot?.(snapshot)
  const saveState = createSave(seed, bundle, "bag-gift")
  saveState.session_state = snapshot
  return createStorySession({ bundle, saveState })
}

function createSave(
  session: RuntimeStorySession,
  bundle: RuntimeStoryBundle,
  slotId = "slot-1"
): RuntimeStorySaveState {
  return {
    schema_version: 5,
    slot_id: slotId,
    story_id: bundle.storyId,
    profile_id: "profile-1",
    bundle_content_hash: bundle.contentHash ?? bundle.generatedAt,
    saved_at: "2026-01-01T00:00:00.000Z",
    playback: session.getPlaybackState(),
    session_state: session.getSnapshot()
  }
}

function withoutHistory(snapshot: RuntimeStorySessionSnapshot) {
  const { history: _history, ...rest } = snapshot
  return rest
}

describe("RuntimeStorySession v5 saves", () => {
  it("restores the exact dialogue cursor without replaying init", () => {
    const bundle = createBundle({
      chainEvents: {
        opening: {
          node_type: "event",
          id: "opening",
          title: "Opening",
          init_script: "",
          end_script: "",
          object_keys: ["player"],
          presentation: {
            type: "dialogue",
            dialogues: [
              { speaker_type: "player", speaker_key: "player", content: "first" },
              { speaker_type: "player", speaker_key: "player", content: "second" }
            ]
          },
          location: "",
          next: []
        }
      }
    })
    const session = createStorySession({ bundle })
    session.dispatch({ type: "continue" })
    const beforeSaveHistory = session.getSnapshot().history
    expect(beforeSaveHistory.at(-1)).toMatchObject({ category: "story", type: "dialogue", game_minute: 0 })

    const restored = createStorySession({ bundle, saveState: createSave(session, bundle) })
    const view = restored.getViewModel()

    expect(view.currentDialogue?.content).toBe("second")
    expect(view.currentDialogue?.index).toBe(2)
    expect(restored.getSnapshot().history).toEqual(beforeSaveHistory)
  })

  it("rejects v1 and v2 saves with an explicit compatibility error", () => {
    const bundle = createBundle({
      chainEvents: {
        opening: {
          node_type: "event",
          id: "opening",
          title: "Opening",
          init_script: "",
          end_script: "",
          object_keys: ["player"],
          presentation: {
            type: "dialogue",
            dialogues: [
              { speaker_type: "player", speaker_key: "player", content: "first" },
              { speaker_type: "player", speaker_key: "player", content: "second" }
            ]
          },
          location: "",
          next: []
        }
      }
    })
    const session = createStorySession({ bundle })
    session.dispatch({ type: "continue" })
    const v1Save = {
      slot_id: "legacy",
      story_id: bundle.storyId,
      profile_id: "profile-1",
      bundle_version: bundle.generatedAt,
      saved_at: "2026-01-01T00:00:00.000Z",
      session_state: session.getSnapshot()
    } as unknown as RuntimeStorySaveState

    const v2Save = {
      ...createSave(session, bundle),
      schema_version: 3
    } as unknown as RuntimeStorySaveState

    expect(() => createStorySession({ bundle, saveState: v1Save }))
      .toThrow("Save schema v1 is incompatible with the evolution runtime; only v5 saves are supported.")
    expect(() => createStorySession({ bundle, saveState: v2Save }))
      .toThrow("Save schema v3 is incompatible with the evolution runtime; only v5 saves are supported.")
  })

  it("persists deterministic RNG state across a save", () => {
    const bundle = createBundle({
      vals: {
        variables: [
          {
            name: "player",
            vals: [
              { name: "roll", value_type: "value", value: 0, calc_rule: "" }
            ]
          }
        ]
      },
      chainEvents: {
        first: {
          node_type: "event",
          id: "first",
          title: "First",
          init_script: "${player.roll} = Math.random();",
          end_script: "",
          object_keys: ["player"],
          presentation: { type: "message", message: { content: "first", duration_seconds: 60 } },
          location: "",
          next: ["second"]
        },
        second: {
          node_type: "event",
          id: "second",
          title: "Second",
          init_script: "${player.roll} = Math.random();",
          end_script: "",
          object_keys: ["player"],
          presentation: { type: "message", message: { content: "second", duration_seconds: 60 } },
          location: "",
          next: []
        }
      }
    })
    const uninterrupted = createStorySession({ bundle })
    const restored = createStorySession({
      bundle,
      saveState: createSave(uninterrupted, bundle)
    })

    uninterrupted.dispatch({ type: "continue" })
    restored.dispatch({ type: "continue" })

    const readRoll = (session: RuntimeStorySession) =>
      session.getSnapshot().vals.variables[0]?.vals[0]?.value
    expect(readRoll(restored)).toBe(readRoll(uninterrupted))
    expect(restored.getSnapshot().rng).toEqual(uninterrupted.getSnapshot().rng)
  })
})
describe("Runtime shop direct gifting", () => {
  it("charges the shop price and gifts without using the player bag", () => {
    const bundle = createShopBundle(500)
    const session = createStorySession({ bundle })

    session.dispatch({ type: "shop-gift", productId: "gift_box_product", roleKey: "normal:friend" })

    const snapshot = session.getSnapshot()
    expect(snapshot.vals.variables[0]?.vals[0]?.value).toBe(301)
    expect(snapshot.bags.player.entries).toEqual([])
    expect(snapshot.shop.purchases).toMatchObject([
      { product_id: "gift_box_product", purchased_count: 1, cooldown_until_game_minute: 720 }
    ])
    expect(snapshot.shop.gifts).toMatchObject([
      { product_id: "gift_box_product", role_key: "normal:friend", gifted_count: 1, cooldown_until_game_minute: 1440 }
    ])
    expect(snapshot.contact.contacts).toContainEqual(expect.objectContaining({ role_key: "normal:friend", favor: 23 }))
    expect(snapshot.history.at(-1)?.content).toContain("花费 199")
  })

  it("leaves all state unchanged when the direct gift cannot be purchased", () => {
    const bundle = createShopBundle(100)
    const session = createStorySession({ bundle })

    session.dispatch({ type: "shop-gift", productId: "gift_box_product", roleKey: "normal:friend" })

    const snapshot = session.getSnapshot()
    expect(snapshot.vals.variables[0]?.vals[0]?.value).toBe(100)
    expect(snapshot.bags.player.entries).toEqual([])
    expect(snapshot.shop.purchases).toEqual([])
    expect(snapshot.shop.gifts).toEqual([])
    expect(snapshot.contact.contacts).toEqual([])
    expect(session.getViewModel().notifications).toContain("需要 199 元，当前只有 100 元。")
  })
})

describe("Runtime contact talk cooldown", () => {
  it("keeps a talk cooldown keyed to that talk after another talk is sent", () => {
    const bundle = createBundle({
      roles: {
        normal: {
          roles: [
            { id: "friend", name: "好友", descr: "测试好友", zhiye: "", contact_enabled: true }
          ]
        },
        important: { roles: [] }
      },
      contact: {
        default_channel_id: "generic",
        channels: [{ id: "generic", name: "消息", preset: "generic", labels: {} }],
        relationship_tracks: [],
        personality_library: [],
        talk_library: [
          { id: "greet", text: "在吗", tags: [], scope: { role_keys: [], contact_tracks: [], personality_ids: [], min_favor: 0, max_favor: 100 }, base_favor_delta: 1, cooldown_hours: 6 },
          { id: "other", text: "最近怎么样", tags: [], scope: { role_keys: [], contact_tracks: [], personality_ids: [], min_favor: 0, max_favor: 100 }, base_favor_delta: 1, cooldown_hours: 0 }
        ],
        action_library: [],
        reply_library: [],
        player_quick_messages: [],
        contact_profiles: [],
        fallback_replies: {}
      }
    })
    const seed = createStorySession({ bundle })
    const snapshot = seed.getSnapshot()
    snapshot.contact.contacts.push({ role_key: "normal:friend", favor: 20, unlocked_at_day: 1 })
    const save = createSave(seed, bundle, "contact-talk-cooldown")
    save.session_state = snapshot
    const session = createStorySession({ bundle, saveState: save })

    session.dispatch({ type: "contact-send-talk", roleKey: "normal:friend", talkId: "greet" })
    expect(session.getSnapshot().contact.contacts[0]?.favor).toBe(21)

    session.dispatch({ type: "contact-send-talk", roleKey: "normal:friend", talkId: "other" })
    expect(session.getSnapshot().contact.contacts[0]?.favor).toBe(22)

    session.dispatch({ type: "contact-send-talk", roleKey: "normal:friend", talkId: "greet" })
    expect(session.getSnapshot().contact.contacts[0]?.favor).toBe(22)
    expect(session.getSnapshot().history.some((entry) => entry.content?.includes("好感 +0（当前 22）"))).toBe(true)

    const cooldownEndedSave = createSave(session, bundle, "contact-talk-cooldown-ended")
    cooldownEndedSave.session_state.clock.total_minutes = 360
    const cooldownEnded = createStorySession({ bundle, saveState: cooldownEndedSave })
    cooldownEnded.dispatch({ type: "contact-send-talk", roleKey: "normal:friend", talkId: "greet" })
    expect(cooldownEnded.getSnapshot().contact.contacts[0]?.favor).toBe(23)
  })

  it("allows repeated contact actions during cooldown but only applies favor once", () => {
    const bundle = createBundle({
      vals: {
        variables: [{
          name: "player",
          vals: [{ name: "money", value_type: "value", value: 100, calc_rule: "" }]
        }]
      },
      roles: {
        normal: { roles: [{ id: "friend", name: "好友", descr: "测试好友", zhiye: "", contact_enabled: true }] },
        important: { roles: [] }
      },
      contact: {
        default_channel_id: "generic",
        channels: [{ id: "generic", name: "消息", preset: "generic", labels: {} }],
        relationship_tracks: [],
        personality_library: [],
        talk_library: [],
        action_library: [{
          id: "visit",
          label: "见面",
          text: "我去找你",
          tags: [],
          scope: { role_keys: [], contact_tracks: [], personality_ids: [], min_favor: 0, max_favor: 100 },
          base_favor_delta: 2,
          cooldown_hours: 6,
          cost_money: 10,
          cost_items: []
        }],
        reply_library: [],
        player_quick_messages: [],
        contact_profiles: [],
        fallback_replies: {}
      }
    })
    const seed = createStorySession({ bundle })
    seed.getSnapshot().contact.contacts.push({ role_key: "normal:friend", favor: 20, unlocked_at_day: 1 })
    const save = createSave(seed, bundle, "contact-action-cooldown")
    save.session_state = seed.getSnapshot()
    const session = createStorySession({ bundle, saveState: save })

    session.dispatch({ type: "contact-send-action", roleKey: "normal:friend", actionId: "visit" })
    session.dispatch({ type: "contact-send-action", roleKey: "normal:friend", actionId: "visit" })
    expect(session.getSnapshot().contact.contacts[0]?.favor).toBe(22)
    expect(session.getSnapshot().vals.variables[0]?.vals[0]?.value).toBe(80)
    expect(session.getSnapshot().contact.threads[0]?.messages.filter((message) => message.option_id === "visit")).toHaveLength(2)
    expect(session.getSnapshot().history.filter((entry) => entry.title === "contact:normal:friend").at(-1)?.content).toContain("好感 +0")

    const cooldownEndedSave = createSave(session, bundle, "contact-action-cooldown-ended")
    cooldownEndedSave.session_state.clock.total_minutes = 360
    const cooldownEnded = createStorySession({ bundle, saveState: cooldownEndedSave })
    cooldownEnded.dispatch({ type: "contact-send-action", roleKey: "normal:friend", actionId: "visit" })
    expect(cooldownEnded.getSnapshot().contact.contacts[0]?.favor).toBe(24)
  })
})

describe("Runtime player bag gifting", () => {
  it("gifts multiple owned items, scales favor, and does not charge or record a purchase", () => {
    const bundle = createBagGiftBundle()
    const session = createBagGiftSession(bundle)

    expect(session.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:friend",
      quantity: 2
    })).toBe(true)

    const snapshot = session.getSnapshot()
    expect(snapshot.bags.player.entries.find((entry) => entry.item_id === "gift_box")?.quantity).toBe(3)
    expect(snapshot.contact.contacts[0]?.favor).toBe(26)
    expect(snapshot.vals.variables[0]?.vals[0]?.value).toBe(5000)
    expect(snapshot.shop.purchases).toEqual([])
    expect(snapshot.shop.gifts).toMatchObject([{
      product_id: "gift_box_product",
      role_key: "normal:friend",
      gifted_count: 1,
      cooldown_until_game_minute: 1440
    }])
    expect(snapshot.contact.threads[0]?.messages.some((message) => message.content.includes("礼盒 x2"))).toBe(true)
    expect(snapshot.contact.threads[0]?.messages.at(-1)?.content).toContain("好友度 +6")
    expect(snapshot.history.at(-1)?.title).toBe("bag:gift")

    const giftView = session.getViewModel().bagSummary
      .find((bag) => bag.ownerId === "player")
      ?.entries.find((entry) => entry.itemId === "gift_box")
    expect(giftView).toMatchObject({
      giftable: true,
      giftFavorDelta: 3,
      giftCooldownHours: 24,
      giftDisabledReason: null
    })
  })

  it("keeps the full snapshot unchanged for inventory and gift eligibility failures", () => {
    const cases = [
      { itemId: "gift_box", quantity: 6, message: "背包物品数量不足" },
      { itemId: "bound_badge", quantity: 1, message: "绑定物品不可赠送" },
      { itemId: "plain_note", quantity: 1, message: "没有可赠商城配置" }
    ]

    for (const testCase of cases) {
      const session = createBagGiftSession(createBagGiftBundle())
      const before = session.getSnapshot()
      expect(session.dispatch({
        type: "bag-gift",
        itemId: testCase.itemId,
        roleKey: "normal:friend",
        quantity: testCase.quantity
      })).toBe(false)
      expect(withoutHistory(session.getSnapshot())).toEqual(withoutHistory(before))
      expect(session.getSnapshot().history.at(-1)).toMatchObject({ category: "operation", title: "赠礼失败", content: expect.stringContaining(testCase.message) })
      expect(session.getViewModel().notifications.at(-1)).toContain(testCase.message)
    }
  })

  it("rejects duplicate gift mappings at runtime and marks the item unavailable", () => {
    const bundle = createBagGiftBundle()
    bundle.shop?.products.push({
      ...bundle.shop.products[0]!,
      id: "gift_box_product_legacy_duplicate"
    })
    const session = createBagGiftSession(bundle)
    const before = session.getSnapshot()

    expect(session.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:friend",
      quantity: 1
    })).toBe(false)
    expect(withoutHistory(session.getSnapshot())).toEqual(withoutHistory(before))
    expect(session.getSnapshot().history.at(-1)).toMatchObject({ category: "operation", title: "赠礼失败" })
    const giftBoxView = session.getViewModel().bagSummary[0]?.entries
      .find((entry) => entry.itemId === "gift_box")
    expect(giftBoxView).toMatchObject({
      giftable: false,
      giftDisabledReason: "物品 \"gift_box\" 存在多个可赠商城配置。"
    })
  })

  it("rejects non-contacts, locked contacts, and plot-locked chat without mutation", () => {
    const nonContactSession = createBagGiftSession(createBagGiftBundle())
    const nonContactBefore = nonContactSession.getSnapshot()
    expect(nonContactSession.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:stranger",
      quantity: 1
    })).toBe(false)
    expect(withoutHistory(nonContactSession.getSnapshot())).toEqual(withoutHistory(nonContactBefore))

    const lockedBundle = createBagGiftBundle()
    const roles = lockedBundle.roles as { normal: { roles: Array<{ id: string; contact_enabled?: boolean }> } }
    const friend = roles.normal.roles.find((role) => role.id === "friend")
    if (friend) friend.contact_enabled = false
    const lockedSession = createBagGiftSession(lockedBundle)
    const lockedBefore = lockedSession.getSnapshot()
    expect(lockedSession.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:friend",
      quantity: 1
    })).toBe(false)
    expect(withoutHistory(lockedSession.getSnapshot())).toEqual(withoutHistory(lockedBefore))

    const conversationBundle = createBagGiftBundle()
    conversationBundle.contactConversations = {
      conversations: [{
        id: "locked_chat",
        title: "锁定聊天",
        role_key: "normal:friend",
        enabled: true,
        once: false,
        lock_normal_chat: true,
        trigger_expr: "",
        entry_node_id: "start",
        nodes: [{
          id: "start",
          contact_messages: [{ content: "剧情中" }],
          player_options: [],
          end: false,
          end_script: ""
        }]
      }]
    }
    const conversationSession = createBagGiftSession(conversationBundle, (snapshot) => {
      snapshot.contact_conversation = {
        conversation_id: "locked_chat",
        role_key: "normal:friend",
        node_id: "start",
        finished: false
      }
    })
    const conversationBefore = conversationSession.getSnapshot()
    expect(conversationSession.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:friend",
      quantity: 1
    })).toBe(false)
    expect(withoutHistory(conversationSession.getSnapshot())).toEqual(withoutHistory(conversationBefore))
  })

  it("ignores shop purchase restrictions for already-owned items", () => {
    const bundle = createBagGiftBundle()
    const product = bundle.shop?.products[0]
    if (!product) throw new Error("missing test product")
    product.enabled = false
    product.price = 999999
    product.available_expr = "false"
    const session = createBagGiftSession(bundle, (snapshot) => {
      snapshot.shop.purchases.push({
        product_id: product.id,
        purchased_count: 1,
        last_purchased_game_minute: 0,
        cooldown_until_game_minute: 9999
      })
    })

    expect(session.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:friend",
      quantity: 1
    })).toBe(true)
    expect(session.getSnapshot().vals.variables[0]?.vals[0]?.value).toBe(5000)
  })

  it("shares gift cooldown with direct shop gifting in both directions", () => {
    const bundle = createBagGiftBundle()
    const shopFirst = createBagGiftSession(bundle)
    shopFirst.dispatch({ type: "shop-gift", productId: "gift_box_product", roleKey: "normal:friend" })
    expect(shopFirst.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:friend",
      quantity: 1
    })).toBe(true)
    expect(shopFirst.getSnapshot().contact.contacts[0]?.favor).toBe(23)
    expect(shopFirst.getSnapshot().bags.player.entries.find((entry) => entry.item_id === "gift_box")?.quantity).toBe(4)
    expect(shopFirst.getSnapshot().shop.gifts[0]).toMatchObject({ gifted_count: 2, cooldown_until_game_minute: 1440 })
    expect(shopFirst.getSnapshot().shop.purchases[0]).toMatchObject({ purchased_count: 1, cooldown_until_game_minute: 720 })
    expect(shopFirst.getSnapshot().history.at(-1)?.content).toContain("好感变化 0")

    const cooldownEndedSave = createSave(shopFirst, bundle, "cooldown-ended")
    cooldownEndedSave.session_state.clock.total_minutes = 1440
    const afterCooldown = createStorySession({ bundle, saveState: cooldownEndedSave })
    expect(afterCooldown.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:friend",
      quantity: 1
    })).toBe(true)

    const bagFirst = createBagGiftSession(createBagGiftBundle())
    expect(bagFirst.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:friend",
      quantity: 1
    })).toBe(true)
    bagFirst.dispatch({ type: "shop-gift", productId: "gift_box_product", roleKey: "normal:friend" })
    expect(bagFirst.getSnapshot().contact.contacts[0]?.favor).toBe(23)
    expect(bagFirst.getSnapshot().vals.variables[0]?.vals[0]?.value).toBe(4801)
    expect(bagFirst.getSnapshot().shop.gifts[0]).toMatchObject({ gifted_count: 2, cooldown_until_game_minute: 1440 })
    expect(bagFirst.getSnapshot().shop.purchases[0]).toMatchObject({ purchased_count: 1, cooldown_until_game_minute: 720 })
    expect(bagFirst.getSnapshot().history.at(-1)?.content).toContain("好感变化 0")
  })
})

describe("Runtime semantic contact input", () => {
  function semanticBundle(): RuntimeStoryBundle {
    return createBundle({
      roles: { normal: { roles: [{ id: "friend", name: "好友", descr: "", zhiye: "", contact_enabled: true }] }, important: { roles: [] } },
      contact: {
        default_channel_id: "generic",
        channels: [{ id: "generic", name: "联系", preset: "generic", labels: {} }],
        relationship_tracks: [], personality_library: [],
        talk_library: [{ id: "hello", text: "你好", tags: ["greeting"], scope: { role_keys: ["normal:friend"], contact_tracks: [], personality_ids: [], min_favor: 0, max_favor: 100 }, base_favor_delta: 0, cooldown_hours: 0 }],
        action_library: [], reply_library: [], player_quick_messages: [],
        contact_profiles: [{ role_key: "normal:friend", channel_id: "generic", enabled: true, auto_add: true, initial_favor: 20, preferred_tags: [], reply_by_tag: {}, proactive_messages: [] }],
        fallback_replies: { default: ["我没听懂。"] }
      },
      worldState: { open: true },
      semanticEntries: [{ id: "greet", role_key: "normal:friend", utterances: ["你好"], response_kind: "talk", response_id: "hello", condition_expr: "${world.open} === true", min_score: 0.7, priority: 1, vector: [1, ...Array(511).fill(0)] }]
    })
  }

  it("filters current intents, enforces threshold and forwards a valid talk", () => {
    const session = createStorySession({ bundle: semanticBundle() })
    expect(session.getAvailableSemanticContactIntents("normal:friend").map((entry) => entry.id)).toEqual(["greet"])
    expect(session.dispatch({ type: "contact-semantic-input", roleKey: "normal:friend", intentId: "greet", score: 0.69 })).toBe(false)
    expect(session.dispatch({ type: "contact-semantic-input", roleKey: "normal:friend", intentId: "greet", score: 0.9 })).toBe(true)
    expect(session.getSnapshot().contact.threads[0]?.messages[0]).toMatchObject({ sender: "player", content: "你好", option_id: "hello" })
  })

  it("writes a deterministic NPC fallback into the contact thread", () => {
    const session = createStorySession({ bundle: semanticBundle() })
    expect(session.dispatch({ type: "contact-semantic-fallback", roleKey: "normal:friend" })).toBe(true)
    expect(session.getSnapshot().contact.threads[0]?.messages[0]).toMatchObject({ sender: "contact", content: "我没听懂。", read: false })
  })

  it("reconciles a manifest package set and removes rolled-back world state", () => {
    const bundle = semanticBundle()
    const parent = makeEvolutionPackage(bundle, "parent", 1)
    const child = makeEvolutionPackage(bundle, "child", 2, ["parent"])
    const session = createStorySession({ bundle })
    expect(session.reconcileEvolutionPackages([parent, child]).packageIds).toEqual(["parent", "child"])
    expect(session.getSnapshot().world_state).toMatchObject({ parent: 1, child: 2 })
    expect(session.reconcileEvolutionPackages([parent]).packageIds).toEqual(["parent"])
    expect(session.getSnapshot().world_state).toEqual({ open: true, parent: 1 })
  })

  it("queues content during an active event and installs it immediately after the event ends", () => {
    const bundle = createBundle({
      vals: { variables: [{ name: "player", vals: [{ name: "init_count", value_type: "value", value: 0, calc_rule: "" }] }] },
      chainEvents: {
        opening: {
          node_type: "event",
          id: "opening",
          title: "Opening",
          init_script: "${player.init_count} += 1;",
          end_script: "",
          object_keys: ["player"],
          presentation: { type: "dialogue", dialogues: [{ speaker_type: "player", speaker_key: "player", content: "finish" }] },
          location: "",
          next: []
        }
      }
    })
    const session = createStorySession({ bundle })
    const pkg = makeEvolutionPackage(bundle, "after-event", 1, [], { phase: "next" })

    expect(session.reconcileEvolutionPackages([pkg])).toMatchObject({ installed: false, queued: true })
    expect(session.getSnapshot().content_package_ids).toEqual([])
    session.dispatch({ type: "continue" })
    expect(session.getSnapshot().content_package_ids).toEqual(["after-event"])
    expect(session.getSnapshot().world_state).toEqual({ phase: "next" })
    expect(session.getSnapshot().vals.variables[0]?.vals[0]?.value).toBe(1)
  })

  it("keeps content pending through a contact conversation and installs it after the final reply", () => {
    const bundle = semanticBundle()
    bundle.contactConversations = {
      conversations: [{
        id: "contact-plot",
        title: "Contact Plot",
        role_key: "normal:friend",
        enabled: true,
        once: false,
        lock_normal_chat: true,
        trigger_expr: "",
        entry_node_id: "start",
        nodes: [{
          id: "start",
          contact_messages: [],
          player_options: [{ id: "finish", text: "finish", next_node_id: "", script: "", visible_expr: "" }],
          end: false,
          end_script: ""
        }]
      }]
    }
    const seed = createStorySession({ bundle })
    const save = createSave(seed, bundle, "contact-pending")
    save.session_state.contact_conversation = {
      conversation_id: "contact-plot",
      role_key: "normal:friend",
      node_id: "start",
      finished: false
    }
    const session = createStorySession({ bundle, saveState: save })
    const pkg = makeEvolutionPackage(bundle, "after-contact", 1, [], { contact_phase: "done" })

    expect(session.reconcileEvolutionPackages([pkg])).toMatchObject({ installed: false, queued: true })
    session.dispatch({ type: "contact-select-conversation-reply", optionId: "finish" })
    expect(session.getSnapshot().contact_conversation).toBeNull()
    expect(session.getSnapshot().content_package_ids).toEqual(["after-contact"])
    expect(session.getSnapshot().world_state).toMatchObject({ open: true, contact_phase: "done" })
  })

  it("rejects an invalid package without mutating the active session", () => {
    const bundle = semanticBundle()
    const session = createStorySession({ bundle })
    const before = session.getSnapshot()
    const invalid = { ...makeEvolutionPackage(bundle, "invalid", 1), package_hash: "0".repeat(64) }

    expect(session.queueEvolutionPackage(invalid).reason).toContain("内容包 hash 无效")
    expect(session.getSnapshot()).toEqual(before)
    expect(session.getAvailableSemanticContactIntents("normal:friend").map((entry) => entry.id)).toEqual(["greet"])
  })
})

describe("Runtime schedule dependency ordering", () => {
  it("topologically orders same-minute events before priority and sequence", () => {
    const scheduleEvents = [
      { id: "a", priority: 1, after: ["b"] },
      { id: "b", priority: 100, after: ["c"] },
      { id: "c", priority: 200, after: [] }
    ]
    const bundle = createBundle({
      scheduleEvents: scheduleEvents.map((event) => ({
        id: event.id,
        title: event.id.toUpperCase(),
        trigger_mode: "default",
        trigger_expr: "",
        invoke_params: [],
        init_script: "",
        end_script: "",
        object_keys: [],
        presentation: { type: "message", message: { content: event.id, duration_seconds: 60 } },
        location: "",
        bgm: "",
        loop: { mode: "daily", at: "00:00", priority: event.priority, after: event.after, before: [] }
      }))
    })
    const emptySession = createStorySession({ bundle: createBundle() })
    const snapshot = emptySession.getSnapshot()
    const scheduled: RuntimeScheduledEvent[] = scheduleEvents.map((event, index) => ({
      instance_id: `manual-${event.id}`,
      source_type: "schedule",
      source_id: event.id,
      entry_event_id: event.id,
      due_game_minute: 0,
      priority: event.priority,
      after: event.after,
      before: [],
      seq: index + 1,
      dedupe_key: `manual-${event.id}`,
      call_values: {},
      trigger_locked: true,
      status: "scheduled"
    }))
    snapshot.scheduler.scheduled = scheduled
    snapshot.scheduler.next_seq = 4
    const session = createStorySession({ bundle, saveState: {
      schema_version: 5,
      slot_id: "seed",
      story_id: "runtime_test",
      profile_id: "profile-1",
      bundle_content_hash: "a".repeat(64),
      saved_at: "2026-01-01T00:00:00.000Z",
      playback: emptySession.getPlaybackState(),
      session_state: snapshot
    } })
    expect(session.getViewModel().activeEventId).toBe("c")
    session.dispatch({ type: "continue" })
    expect(session.getViewModel().activeEventId).toBe("b")
    session.dispatch({ type: "continue" })
    expect(session.getViewModel().activeEventId).toBe("a")
  })
})
