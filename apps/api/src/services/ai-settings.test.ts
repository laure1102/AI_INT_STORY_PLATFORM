import { afterEach, describe, expect, it } from "vitest"
import type { AppSettingsFile } from "@story-mgr/core"
import { requireImageProvider, requireTextProvider } from "./ai-provider-http"
import { requireAgentSettings } from "./story-creation/model"

const environmentNames = [
  "STORY_AI_TEXT_API_KEY",
  "STORY_AI_IMAGE_API_KEY",
  "STORY_AI_AGENT_API_KEY",
  "STORY_AI_AGENT_BASE_URL"
] as const

const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]))

afterEach(() => {
  for (const name of environmentNames) {
    const value = originalEnvironment[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function settings(): AppSettingsFile {
  return {
    ai: {
      text: { apiKey: "stored-text-secret", baseUrl: "https://text.example/v1", model: "text-model" },
      image: { apiKey: "stored-image-secret", baseUrl: "https://image.example/v1", model: "image-model" },
      agent: {
        apiKey: "stored-agent-secret",
        baseUrl: "https://stored-agent.example/v1",
        evolutionModel: "stored-evolution-model",
        chiefEditorModel: "agent-model",
        plotPlannerModel: "agent-model",
        assetDesignerModel: "agent-model",
        eventWriterModel: "agent-model",
        scriptDoctorModel: "agent-model",
        consistencyCheckerModel: "agent-model",
        temperature: 0.7
      }
    }
  }
}

describe("AI runtime secrets", () => {
  it("uses stored text and image keys, with environment overrides", () => {
    delete process.env.STORY_AI_TEXT_API_KEY
    delete process.env.STORY_AI_IMAGE_API_KEY
    expect(requireTextProvider(settings()).apiKey).toBe("stored-text-secret")
    expect(requireImageProvider(settings()).apiKey).toBe("stored-image-secret")

    process.env.STORY_AI_TEXT_API_KEY = "text-runtime-secret"
    process.env.STORY_AI_IMAGE_API_KEY = "image-runtime-secret"
    expect(requireTextProvider(settings()).apiKey).toBe("text-runtime-secret")
    expect(requireImageProvider(settings()).apiKey).toBe("image-runtime-secret")
  })

  it("uses stored Agent credentials when environment overrides are absent", () => {
    delete process.env.STORY_AI_AGENT_API_KEY
    delete process.env.STORY_AI_AGENT_BASE_URL
    const agent = requireAgentSettings(settings())

    expect(agent.apiKey).toBe("stored-agent-secret")
    expect(agent.baseUrl).toBe("https://stored-agent.example/v1")
  })

  it("uses the Agent environment secret and base URL override", () => {
    process.env.STORY_AI_AGENT_API_KEY = "agent-runtime-secret"
    process.env.STORY_AI_AGENT_BASE_URL = "https://runtime-agent.example"
    const agent = requireAgentSettings(settings())

    expect(agent.apiKey).toBe("agent-runtime-secret")
    expect(agent.baseUrl).toBe("https://runtime-agent.example/v1")
  })
})
