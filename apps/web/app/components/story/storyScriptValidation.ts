import {
  type StoryDocument,
  createStoryScriptValidationContext,
  validateStoryScriptInvokeReferences,
  validateStoryScriptContent,
  type StoryScriptValidationIssue,
  type StoryScriptValidationMode,
  type StoryValsFile
} from "@story-mgr/core"
import {
  buildStoryScriptInvokeAutocompleteContext,
  buildStoryScriptValAutocompleteItems
} from "./storyScriptEditor"

export interface StoryScriptFieldValidationOptions {
  vals: StoryValsFile
  source: string
  mode: StoryScriptValidationMode
  itemIds?: string[]
  roleKeys?: string[]
  doingIds?: string[]
  readableTokens?: string[]
  writableTokens?: string[]
  bagMode?: "read" | "write"
  phoneMode?: "read" | "write"
  doingMode?: "read" | "write"
  story?: StoryDocument | null
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

function collectStoryRoleKeys(story: StoryDocument | null | undefined) {
  if (!story) {
    return []
  }

  return [
    ...story.roles.important.roles.map((role) => `important:${role.id.trim()}`),
    ...story.roles.normal.roles.map((role) => `normal:${role.id.trim()}`)
  ].filter((roleKey) => roleKey !== "important:" && roleKey !== "normal:")
}

function collectStoryDoingIds(story: StoryDocument | null | undefined) {
  return story?.doing.doings.map((doing) => doing.id.trim()).filter(Boolean) ?? []
}

function collectStoryItemIds(story: StoryDocument | null | undefined) {
  return story?.items.items.map((item) => item.id.trim()).filter(Boolean) ?? []
}

function validateInvokeOnceReferences(
  source: string,
  story: StoryDocument | null | undefined
): StoryScriptValidationIssue[] {
  if (!story) {
    return []
  }

  const invokeContext = buildStoryScriptInvokeAutocompleteContext(story)
  return validateStoryScriptInvokeReferences(
    source,
    invokeContext.targets.map((target) => ({
      type: target.type,
      eventId: target.eventId,
      paramNames: target.params.map((param) => param.name)
    }))
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
      itemIds: options.itemIds ?? collectStoryItemIds(options.story),
      roleKeys: options.roleKeys ?? collectStoryRoleKeys(options.story),
      doingIds: options.doingIds ?? collectStoryDoingIds(options.story),
      bagMode: options.bagMode ?? (options.mode === "predicate" ? "read" : "write"),
      phoneMode: options.phoneMode ?? (options.mode === "predicate" ? "read" : "write"),
      doingMode: options.doingMode ?? (options.mode === "predicate" ? "read" : "write")
    })
  )
  const invokeIssues = options.mode === "procedure"
    ? validateInvokeOnceReferences(options.source, options.story)
    : []

  return {
    ok: issues.length === 0 && invokeIssues.length === 0,
    issues: [...issues, ...invokeIssues]
  }
}

export function formatStoryScriptValidationIssue(issue: StoryScriptValidationIssue) {
  return issue.lineNumber > 0
    ? `第 ${issue.lineNumber} 行: ${issue.message}`
    : issue.message
}
