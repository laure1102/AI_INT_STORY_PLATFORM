import type { LLMResult } from "@langchain/core/outputs"
import { describe, expect, it } from "vitest"
import { extractStoryCreationTokenUsage } from "./story-creation-workflow"

describe("story creation workflow metrics", () => {
  it("reads OpenAI llmOutput token usage", () => {
    const usage = extractStoryCreationTokenUsage({
      generations: [],
      llmOutput: { tokenUsage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 } }
    })
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 })
  })

  it("aggregates message usage metadata", () => {
    const output = {
      generations: [[
        { text: "a", message: { usage_metadata: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } } },
        { text: "b", message: { usage_metadata: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } } }
      ]]
    } as unknown as LLMResult

    expect(extractStoryCreationTokenUsage(output)).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14
    })
  })
})
