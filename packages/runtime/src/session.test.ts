import { describe, expect, it } from "vitest"
import {
  createStorySession,
  type RuntimeScheduledEvent,
  type RuntimeStoryBundle,
  type RuntimeStorySaveState,
  type RuntimeStorySession,
  type RuntimeStorySessionSnapshot
} from "./session"

function createBundle(options: Partial<RuntimeStoryBundle> = {}): RuntimeStoryBundle {
  return {
    schemaVersion: 2,
    contentHash: "test-content-hash",
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
    schema_version: 3,
    slot_id: slotId,
    story_id: bundle.storyId,
    profile_id: "profile-1",
    bundle_content_hash: bundle.contentHash ?? bundle.generatedAt,
    saved_at: "2026-01-01T00:00:00.000Z",
    playback: session.getPlaybackState(),
    session_state: session.getSnapshot()
  }
}

describe("RuntimeStorySession v2 saves", () => {
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
    const beforeSaveHistory = session.getSnapshot().history.length

    const restored = createStorySession({ bundle, saveState: createSave(session, bundle) })
    const view = restored.getViewModel()

    expect(view.currentDialogue?.content).toBe("second")
    expect(view.currentDialogue?.index).toBe(2)
    expect(restored.getSnapshot().history).toHaveLength(beforeSaveHistory)
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
      schema_version: 2
    } as unknown as RuntimeStorySaveState

    expect(() => createStorySession({ bundle, saveState: v1Save }))
      .toThrow("Save schema v1 is incompatible with the contact runtime; only v3 saves are supported.")
    expect(() => createStorySession({ bundle, saveState: v2Save }))
      .toThrow("Save schema v2 is incompatible with the contact runtime; only v3 saves are supported.")
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
    expect(snapshot.contact.threads[0]?.messages.at(-1)?.content).toContain("礼盒 x2")
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
      expect(session.getSnapshot()).toEqual(before)
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
    expect(session.getSnapshot()).toEqual(before)
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
    expect(nonContactSession.getSnapshot()).toEqual(nonContactBefore)

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
    expect(lockedSession.getSnapshot()).toEqual(lockedBefore)

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
    expect(conversationSession.getSnapshot()).toEqual(conversationBefore)
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
    const afterShopGift = shopFirst.getSnapshot()
    expect(shopFirst.dispatch({
      type: "bag-gift",
      itemId: "gift_box",
      roleKey: "normal:friend",
      quantity: 1
    })).toBe(false)
    expect(shopFirst.getSnapshot()).toEqual(afterShopGift)

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
    const afterBagGift = bagFirst.getSnapshot()
    bagFirst.dispatch({ type: "shop-gift", productId: "gift_box_product", roleKey: "normal:friend" })
    expect(bagFirst.getSnapshot()).toEqual(afterBagGift)
    expect(bagFirst.getViewModel().notifications.at(-1)).toContain("送礼冷却中")
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
      schema_version: 3,
      slot_id: "seed",
      story_id: "runtime_test",
      profile_id: "profile-1",
      bundle_content_hash: "test-content-hash",
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
