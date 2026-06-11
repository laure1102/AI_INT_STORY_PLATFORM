import {
  createStoryScriptValidationContext,
  validateStoryScriptContent,
  type StoryScriptValidationIssue,
  type StoryScriptValidationMode,
  type StoryValsFile
} from "@story-mgr/core"
import { buildStoryScriptValAutocompleteItems } from "./storyScriptEditor"

export interface StoryScriptFieldValidationOptions {
  vals: StoryValsFile
  source: string
  mode: StoryScriptValidationMode
  itemIds?: string[]
  readableTokens?: string[]
  writableTokens?: string[]
  bagMode?: "read" | "write"
}

export interface StoryScriptFieldValidationResult {
  ok: boolean
  issues: StoryScriptValidationIssue[]
}

export function collectStoryScriptValueNames(vals: StoryValsFile) {
  return buildStoryScriptValAutocompleteItems(vals).map((item) => item.name)
}

function toContextValueMap(tokens: string[] | undefined) {
  return Object.fromEntries(
    (tokens ?? [])
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => [token, null] as const)
  )
}

export function validateStoryScriptField(
  options: StoryScriptFieldValidationOptions
): StoryScriptFieldValidationResult {
  const issues = validateStoryScriptContent(
    options.vals,
    options.source,
    options.mode,
    undefined,
    createStoryScriptValidationContext({
      values: toContextValueMap(options.readableTokens),
      assignableValues: toContextValueMap(options.writableTokens),
      itemIds: options.itemIds ?? [],
      bagMode: options.bagMode ?? (options.mode === "predicate" ? "read" : "write")
    })
  )

  return {
    ok: issues.length === 0,
    issues
  }
}

export function formatStoryScriptValidationIssue(issue: StoryScriptValidationIssue) {
  return issue.lineNumber > 0
    ? `第 ${issue.lineNumber} 行: ${issue.message}`
    : issue.message
}
