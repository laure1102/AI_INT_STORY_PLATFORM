import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createStoryFileStore } from "@story-mgr/file-store"
import type { ApplyStoryCreationDraftRequest } from "@story-mgr/shared"
import { afterEach, describe, expect, it } from "vitest"
import { applyStoryCreationDraft } from "./apply"

let testDirectory: string | undefined

afterEach(async () => {
  if (testDirectory) {
    await rm(testDirectory, { recursive: true, force: true })
    testDirectory = undefined
  }
})

describe("applyStoryCreationDraft contact channels", () => {
  it("applies selected channels and clears an unavailable profile override", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "story-mgr-contact-apply-"))
    const store = createStoryFileStore(testDirectory)
    await store.createStory({ id: "test", title: "Test" })

    const request: ApplyStoryCreationDraftRequest = {
      expectedRevision: 0,
      draft: {
        title: "联系人媒介草稿",
        summary: "",
        arc: "",
        locations: [],
        roles: [{
          id: "guide",
          name: "向导",
          zhiye: "向导",
          descr: "测试联系人",
          prompt: "",
          important: false
        }],
        items: [],
        events: [],
        variables: [{
          group: "player",
          name: "money",
          description: "测试资金",
          value_type: "value",
          value: 100,
          calc_rule: ""
        }],
        contact: {
          channels: [
            { id: "letter", name: "书信", preset: "letter", labels: {} },
            { id: "transmission", name: "传讯", preset: "transmission", labels: {} }
          ],
          personality_library: [],
          talk_library: [],
          action_library: [],
          reply_library: [],
          contact_profiles: [{
            role_key: "normal:guide",
            channel_id: "transmission",
            enabled: true,
            auto_add: true,
            initial_favor: 20,
            preferred_tags: [],
            reply_by_tag: {},
            proactive_messages: []
          }]
        },
        contactConversations: { conversations: [] },
        doing: { menus: [], doings: [] },
        shop: { categories: [], products: [] },
        notes: [],
        warnings: []
      },
      selection: {
        eventKeys: [],
        locationIds: [],
        roleKeys: ["normal:guide"],
        itemIds: [],
        contactChannelIds: ["letter"],
        contactPersonalityIds: [],
        contactTalkIds: [],
        contactActionIds: [],
        contactReplyIds: [],
        contactProfileKeys: ["normal:guide"],
        contactConversationIds: [],
        doingMenuIds: [],
        doingIds: [],
        shopCategoryIds: [],
        shopProductIds: [],
        variableKeys: ["player.money"]
      }
    }

    const result = await applyStoryCreationDraft(store, "test", request)

    expect(result.applied.contactChannels).toBe(1)
    expect(result.story.contact.default_channel_id).toBe("generic")
    expect(result.story.contact.channels.map((channel) => channel.id)).toEqual([
      "generic",
      "letter"
    ])
    expect(result.story.contact.contact_profiles[0]?.channel_id).toBe("")
    expect(result.warnings).toContain(
      "联系人配置 normal:guide 引用了不存在或未应用的媒介 transmission，已清空覆盖并继承默认媒介。"
    )
  })
})
