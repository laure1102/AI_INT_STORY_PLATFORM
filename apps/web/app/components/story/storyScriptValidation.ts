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
  shopProductIds?: string[]
  readableTokens?: string[]
  writableTokens?: string[]
  bagMode?: "read" | "write"
  contactMode?: "read" | "write"
  doingMode?: "read" | "write"
  shopMode?: "read" | "write"
  story?: StoryDocument | null
}

export interface StoryScriptFieldValidationResult {
  ok: boolean
  issues: StoryScriptValidationIssue[]
}

/** 收集 `StoryScriptValueNames` 所需的数据。 @param vals 调用方传入的 `vals`。 @returns 计算、查找或构建后的结果。 */
export function collectStoryScriptValueNames(vals: StoryValsFile) {
  return buildStoryScriptValAutocompleteItems(vals).map((item) => item.name)
}

/** 执行 `toContextValueMap` 对应的局部业务逻辑。 @param tokens 调用方传入的 `tokens`。 @returns 计算、查找或构建后的结果。 */
function toContextValueMap(tokens: string[] | undefined) {
  return Object.fromEntries(
    (tokens ?? [])
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => [token, null] as const)
  )
}

/** 收集 `StoryRoleKeys` 所需的数据。 @param story 调用方传入的 `story`。 @returns 计算、查找或构建后的结果。 */
function collectStoryRoleKeys(story: StoryDocument | null | undefined) {
  if (!story) {
    return []
  }

  return [
    ...story.roles.important.roles.map((role) => `important:${role.id.trim()}`),
    ...story.roles.normal.roles.map((role) => `normal:${role.id.trim()}`)
  ].filter((roleKey) => roleKey !== "important:" && roleKey !== "normal:")
}

/** 收集 `StoryDoingIds` 所需的数据。 @param story 调用方传入的 `story`。 @returns 计算、查找或构建后的结果。 */
function collectStoryDoingIds(story: StoryDocument | null | undefined) {
  return story?.doing.doings.map((doing) => doing.id.trim()).filter(Boolean) ?? []
}

/** 收集 `StoryShopProductIds` 所需的数据。 @param story 调用方传入的 `story`。 @returns 计算、查找或构建后的结果。 */
function collectStoryShopProductIds(story: StoryDocument | null | undefined) {
  return story?.shop.products.map((product) => product.id.trim()).filter(Boolean) ?? []
}

/** 收集 `StoryReferValues` 所需的数据。 @param story 调用方传入的 `story`。 @returns 计算、查找或构建后的结果。 */
function collectStoryReferValues(story: StoryDocument | null | undefined) {
  if (!story) {
    return {}
  }

  return Object.fromEntries(
    story.refer.terms
      .map((term) => term.id.trim().replace(/^term\./, ""))
      .filter(Boolean)
      .map((termId) => [`term.${termId}`, null] as const)
  )
}

/** 收集 `StoryItemIds` 所需的数据。 @param story 调用方传入的 `story`。 @returns 计算、查找或构建后的结果。 */
function collectStoryItemIds(story: StoryDocument | null | undefined) {
  return story?.items.items.map((item) => item.id.trim()).filter(Boolean) ?? []
}

/** 校验 `InvokeOnceReferences` 并整理错误信息。 @param source 调用方传入的 `source`。 @param story 调用方传入的 `story`。 @returns 计算、查找或构建后的结果。 */
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

/** 校验 `StoryScriptField` 并整理错误信息。 @param options 调用方传入的 `options`。 @returns 计算、查找或构建后的结果。 */
export function validateStoryScriptField(
  options: StoryScriptFieldValidationOptions
): StoryScriptFieldValidationResult {
  const issues = validateStoryScriptContent(
    options.vals,
    options.source,
    options.mode,
    undefined,
    createStoryScriptValidationContext({
      values: {
        ...collectStoryReferValues(options.story),
        ...toContextValueMap(options.readableTokens)
      },
      assignableValues: toContextValueMap(options.writableTokens),
      itemIds: options.itemIds ?? collectStoryItemIds(options.story),
      roleKeys: options.roleKeys ?? collectStoryRoleKeys(options.story),
      doingIds: options.doingIds ?? collectStoryDoingIds(options.story),
      shopProductIds: options.shopProductIds ?? collectStoryShopProductIds(options.story),
      bagMode: options.bagMode ?? (options.mode === "predicate" ? "read" : "write"),
      contactMode: options.contactMode ?? (options.mode === "predicate" ? "read" : "write"),
      doingMode: options.doingMode ?? (options.mode === "predicate" ? "read" : "write"),
      shopMode: options.shopMode ?? (options.mode === "predicate" ? "read" : "write")
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

/** 把 `StoryScriptValidationIssue` 转换成界面可读文本。 @param issue 调用方传入的 `issue`。 @returns 计算、查找或构建后的结果。 */
export function formatStoryScriptValidationIssue(issue: StoryScriptValidationIssue) {
  return issue.lineNumber > 0
    ? `第 ${issue.lineNumber} 行: ${issue.message}`
    : issue.message
}
