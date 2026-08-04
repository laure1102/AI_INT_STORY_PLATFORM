import { describe, expect, it } from "vitest"
import { storyDocumentSchema } from "./schema"
import { validateStoryDocument } from "./validate"

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
})
