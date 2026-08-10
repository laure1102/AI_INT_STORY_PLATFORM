import { describe, expect, it } from "vitest"
import { storyContactSchema, storyDocumentSchema, storyShopSchema } from "./schema"
import {
  createStoryScriptValidationContext,
  validateStoryDocument,
  validateStoryScriptContent
} from "./validate"

function createDocument(overrides: Record<string, unknown> = {}) {
  return storyDocumentSchema.parse({
    story: {
      id: "test",
      title: "Test"
    },
    vals: {
      variables: []
    },
    playerOverrideVals: {
      entries: []
    },
    systemVals: {
      variables: []
    },
    scenes: {},
    roles: {},
    eventLocations: {},
    initialBags: {
      player: {
        entries: []
      }
    },
    ...overrides
  })
}

function createScheduleEvent(id: string, dependencies: { after?: string[]; before?: string[] } = {}) {
  return {
    id,
    title: id,
    trigger_expr: "",
    init_script: "",
    object_keys: ["player"],
    presentation: {
      type: "silent" as const
    },
    location: "",
    bgm: "",
    end_script: "",
    loop: {
      mode: "daily" as const,
      ...dependencies
    }
  }
}

describe("validateStoryDocument", () => {
  it("accepts player as the built-in playable object", () => {
    const document = createDocument({
      poolEvents: [{
        id: "intro",
        title: "Intro",
        trigger_expr: "",
        init_script: "",
        object_keys: ["player"],
        presentation: {
          type: "dialogue",
          dialogues: [{
            speaker_type: "player",
            speaker_key: "player",
            content: "Hello"
          }]
        },
        location: "",
        bgm: "",
        end_script: ""
      }]
    })

    const result = validateStoryDocument(document)

    expect(result.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "pool.missing-object" })
    ]))
  })

  it("rejects duplicate variable groups, rows, and global/system conflicts", () => {
    const document = createDocument({
      vals: {
        variables: [
          {
            name: "player",
            vals: [
              { name: "money", value_type: "value", value: 1 },
              { name: "money", value_type: "value", value: 2 }
            ]
          },
          { name: "player", vals: [] }
        ]
      },
      systemVals: {
        variables: [{
          name: "player",
          vals: [{ name: "money", value_type: "value", value: 0 }]
        }]
      }
    })

    const codes = validateStoryDocument(document).issues.map((issue) => issue.code)

    expect(codes).toContain("vals.duplicate-group")
    expect(codes).toContain("vals.duplicate-variable")
    expect(codes).toContain("vals.system-name-conflict")
  })

  it("rejects schedule dependency cycles", () => {
    const document = createDocument({
      scheduleEvents: [
        createScheduleEvent("first", { after: ["second"] }),
        createScheduleEvent("second", { after: ["first"] })
      ]
    })

    expect(validateStoryDocument(document).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "schedule.dependency-cycle", level: "error" })
    ]))
  })

  it("rejects multiple giftable shop products for the same item", () => {
    const duplicateShop = {
      currency_value_key: "player.money",
      categories: [{ id: "gifts", name: "礼品" }],
      products: [
        { id: "first_gift", category_id: "gifts", item_id: "gift_box", allow_gift: true },
        { id: "second_gift", category_id: "gifts", item_id: "gift_box", allow_gift: true }
      ]
    }
    expect(storyShopSchema.safeParse(duplicateShop).success).toBe(false)

    const document = createDocument({
      shop: {
        currency_value_key: "player.money",
        categories: [{ id: "gifts", name: "礼品" }],
        products: [{
          id: "first_gift",
          category_id: "gifts",
          item_id: "gift_box",
          allow_gift: true
        }]
      }
    })
    document.shop.products.push({
      ...document.shop.products[0]!,
      id: "second_gift"
    })

    expect(validateStoryDocument(document).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "shop.product.duplicate-gift-item",
        level: "error"
      })
    ]))
  })
})

describe("contact contracts", () => {
  it("rejects duplicate, missing default, and missing profile channels", () => {
    const duplicate = storyContactSchema.safeParse({
      default_channel_id: "generic",
      channels: [
        { id: "generic", name: "通用", preset: "generic", labels: {} },
        { id: "generic", name: "重复", preset: "letter", labels: {} }
      ]
    })
    const missingDefault = storyContactSchema.safeParse({
      default_channel_id: "missing",
      channels: [{ id: "generic", name: "通用", preset: "generic", labels: {} }]
    })
    const missingProfileChannel = storyContactSchema.safeParse({
      default_channel_id: "generic",
      channels: [{ id: "generic", name: "通用", preset: "generic", labels: {} }],
      contact_profiles: [{ role_key: "normal:guide", channel_id: "missing" }]
    })

    expect(duplicate.success).toBe(false)
    expect(missingDefault.success).toBe(false)
    expect(missingProfileChannel.success).toBe(false)
    if (!duplicate.success) {
      expect(duplicate.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["channels", 1, "id"] })
      ]))
    }
    if (!missingDefault.success) {
      expect(missingDefault.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["default_channel_id"] })
      ]))
    }
    if (!missingProfileChannel.success) {
      expect(missingProfileChannel.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["contact_profiles", 0, "channel_id"] })
      ]))
    }
  })

  it("enforces contact StoryScript permissions and conversation references", () => {
    const vals = { variables: [] }
    const readable = createStoryScriptValidationContext({
      roleKeys: ["normal:guide"],
      contactConversationIds: ["intro"],
      contactMode: "read"
    })
    const writable = createStoryScriptValidationContext({
      roleKeys: ["normal:guide"],
      contactConversationIds: ["intro"],
      contactMode: "write"
    })

    expect(validateStoryScriptContent(
      vals,
      'contact_has("normal:guide") && contact_unread_count("normal:guide") === 0',
      "predicate",
      undefined,
      readable
    )).toEqual([])
    expect(validateStoryScriptContent(
      vals,
      'contact_add("normal:guide")',
      "predicate",
      undefined,
      readable
    )[0]?.message).toMatch(/Unsupported (identifier|function)/)
    expect(validateStoryScriptContent(
      vals,
      'contact_add("normal:guide")\ncontact_start_conversation("intro")',
      "procedure",
      undefined,
      writable
    )).toEqual([])
    expect(validateStoryScriptContent(
      vals,
      'contact_start_conversation("missing")',
      "procedure",
      undefined,
      writable
    )[0]?.message).toContain('contact conversation "missing" does not exist')
  })
})
