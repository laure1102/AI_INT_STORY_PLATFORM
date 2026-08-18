import { describe, expect, it } from "vitest"
import { appSettingsSchema } from "./schema/settings"

describe("app settings persistence", () => {
  it("retains API keys and Evolution model configuration", () => {
    const settings = appSettingsSchema.parse({
      ai: {
        text: { apiKey: "text-secret", baseUrl: "https://text.example/v1", model: "text-model" },
        image: { apiKey: "image-secret", baseUrl: "https://image.example/v1", model: "image-model" },
        agent: { apiKey: "agent-secret", baseUrl: "https://agent.example/v1" }
      }
    })

    expect(settings.ai.text).toMatchObject({ apiKey: "text-secret", baseUrl: "https://text.example/v1", model: "text-model" })
    expect(settings.ai.image).toMatchObject({ apiKey: "image-secret", baseUrl: "https://image.example/v1", model: "image-model" })
    expect(settings.ai.agent).toMatchObject({ apiKey: "agent-secret", evolutionModel: "" })
  })
})
