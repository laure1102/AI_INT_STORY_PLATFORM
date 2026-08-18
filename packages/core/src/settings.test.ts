import { describe, expect, it } from "vitest"
import { appSettingsSchema } from "./schema/settings"

describe("app settings security", () => {
  it("does not retain API keys in parsed or serialized settings", () => {
    const settings = appSettingsSchema.parse({
      ai: {
        text: { apiKey: "text-secret", baseUrl: "https://text.example/v1", model: "text-model" },
        image: { apiKey: "image-secret", baseUrl: "https://image.example/v1", model: "image-model" },
        agent: { apiKey: "agent-secret", baseUrl: "https://agent.example/v1" }
      }
    })

    expect(JSON.stringify(settings)).not.toContain("secret")
    expect(settings.ai.text).toEqual({ baseUrl: "https://text.example/v1", model: "text-model" })
    expect(settings.ai.image).toEqual({ baseUrl: "https://image.example/v1", model: "image-model" })
    expect(settings.ai.agent).not.toHaveProperty("apiKey")
  })
})
