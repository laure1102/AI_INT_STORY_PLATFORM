import * as ts from "typescript"
import type {
  StoryValDefinition,
  StoryValEntryDefinition,
  StoryValsFile
} from "./types"

export const DEFAULT_MAX_CALC_NESTING_DEPTH = 5

export interface StoryValCalcEvaluation {
  expression: string
  result: number
}

export interface StoryBooleanExpressionEvaluation {
  expression: string
  result: boolean
}

export interface StoryValCalcDisplay {
  ok: boolean
  text: string
  detail?: string
}

export interface StoryScriptExecutionResult {
  vals: StoryValsFile
  locals: Record<string, unknown>
  externalValues: Record<string, unknown>
  invocations: StoryScriptInvocation[]
}

export interface StoryScriptValidationIssue {
  lineNumber: number
  message: string
}

export interface StoryExpressionContext {
  values?: Record<string, unknown>
}

export interface StoryScriptExecutionContext extends StoryExpressionContext {
  assignableValues?: Record<string, unknown>
}

export interface StoryScriptInvocation {
  eventId: string
  args: Record<string, unknown>
}

type StoryScriptMode = "predicate" | "procedure"

type StoryScriptControlFlow =
  | { kind: "normal" }
  | { kind: "return"; value: unknown }
  | { kind: "break" }
  | { kind: "continue" }

interface StoryScriptPlaceholderBinding {
  identifier: string
  token: string
}

interface CompiledStoryScriptSource {
  source: string
  placeholders: StoryScriptPlaceholderBinding[]
}

interface PredicateStoryScriptExecutionResult extends StoryScriptExecutionResult {
  result: boolean
}

interface StoryScriptRuntimeState {
  valsFile: StoryValsFile
  locals: Record<string, unknown>
  invocations: StoryScriptInvocation[]
  mode: StoryScriptMode
  maxDepth: number
  contextValues: Record<string, unknown>
  executionContext: StoryScriptExecutionContext
  placeholderMap: Map<string, string>
  sourceFile: ts.SourceFile
  stepCount: number
  lastExpressionValue: unknown
}

interface StoryValueEntryReference {
  group: StoryValDefinition
  row: StoryValEntryDefinition
  groupName: string
  rowName: string
}

interface StoryCalcEntryReference extends StoryValueEntryReference {
  displayLabel: string
  referenceKey: string
}

interface StoryScriptAssignStatement {
  kind: "declareLocal" | "assignLocal" | "assignGlobal"
  lineNumber: number
  target: string
  expression: string
}

interface StoryScriptInvokeArgument {
  name: string
  expression: string
}

interface StoryScriptInvokeStatement {
  kind: "invokeOnce"
  lineNumber: number
  eventId: string
  args: StoryScriptInvokeArgument[]
}

type StoryScriptStatement = StoryScriptAssignStatement | StoryScriptInvokeStatement

type StoryScriptCompoundAssignmentOperator = "+=" | "-=" | "*=" | "/=" | "%="

class StoryScriptError extends Error {
  lineNumber: number

  constructor(lineNumber: number, message: string) {
    super(message)
    this.name = "StoryScriptError"
    this.lineNumber = lineNumber
  }
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function normalizeGroupName(value: unknown) {
  return normalizeText(value).trim()
}

function normalizeRowName(value: unknown) {
  return normalizeText(value).trim()
}

function createStoryValueReferenceKey(groupName: string, rowName: string) {
  return groupName ? `${groupName}.${rowName}` : rowName
}

function isCalcRow(row: Pick<StoryValEntryDefinition, "value_type">) {
  return row.value_type === "calc"
}

function cloneStoryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneStoryValue(item))
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        cloneStoryValue(item)
      ])
    )
  }

  return value
}

function cloneStoryValsFile(valsFile: StoryValsFile): StoryValsFile {
  return {
    variables: valsFile.variables.map((group) => ({
      name: group.name,
      description: group.description,
      vals: group.vals.map((row) => ({
        name: row.name,
        description: row.description,
        value_type: row.value_type,
        value: cloneStoryValue(row.value),
        calc_rule: row.calc_rule
      }))
    }))
  }
}

const CALC_MATH_CONTEXT = {
  __math_E: Math.E,
  __math_PI: Math.PI,
  __math_abs: Math.abs,
  __math_acos: Math.acos,
  __math_asin: Math.asin,
  __math_atan: Math.atan,
  __math_atan2: Math.atan2,
  __math_ceil: Math.ceil,
  __math_clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max),
  __math_cos: Math.cos,
  __math_exp: Math.exp,
  __math_floor: Math.floor,
  __math_log: Math.log,
  __math_log10: Math.log10 ?? ((value: number) => Math.log(value) / Math.LN10),
  __math_log2: Math.log2 ?? ((value: number) => Math.log(value) / Math.LN2),
  __math_max: Math.max,
  __math_min: Math.min,
  __math_pow: Math.pow,
  __math_round: Math.round,
  __math_sign: Math.sign,
  __math_sin: Math.sin,
  __math_sqrt: Math.sqrt,
  __math_tan: Math.tan,
  __math_trunc: Math.trunc
} as const

const CALC_MATH_CONTEXT_KEYS = Object.keys(CALC_MATH_CONTEXT) as Array<
  keyof typeof CALC_MATH_CONTEXT
>

const CALC_MATH_ALIAS_PATTERNS: Array<[RegExp, string]> = [
  [/\bMath\.E\b/g, "__math_E"],
  [/\bMath\.PI\b/g, "__math_PI"],
  [/\bMath\.abs\b/g, "__math_abs"],
  [/\bMath\.acos\b/g, "__math_acos"],
  [/\bMath\.asin\b/g, "__math_asin"],
  [/\bMath\.atan2\b/g, "__math_atan2"],
  [/\bMath\.atan\b/g, "__math_atan"],
  [/\bMath\.ceil\b/g, "__math_ceil"],
  [/\bMath\.clamp\b/g, "__math_clamp"],
  [/\bMath\.cos\b/g, "__math_cos"],
  [/\bMath\.exp\b/g, "__math_exp"],
  [/\bMath\.floor\b/g, "__math_floor"],
  [/\bMath\.log10\b/g, "__math_log10"],
  [/\bMath\.log2\b/g, "__math_log2"],
  [/\bMath\.log\b/g, "__math_log"],
  [/\bMath\.max\b/g, "__math_max"],
  [/\bMath\.min\b/g, "__math_min"],
  [/\bMath\.pow\b/g, "__math_pow"],
  [/\bMath\.round\b/g, "__math_round"],
  [/\bMath\.sign\b/g, "__math_sign"],
  [/\bMath\.sin\b/g, "__math_sin"],
  [/\bMath\.sqrt\b/g, "__math_sqrt"],
  [/\bMath\.tan\b/g, "__math_tan"],
  [/\bMath\.trunc\b/g, "__math_trunc"]
]

const CALC_BARE_MATH_FUNCTION_ALIASES: Array<[RegExp, string]> = [
  [/\babs\b/g, "__math_abs"],
  [/\bacos\b/g, "__math_acos"],
  [/\basin\b/g, "__math_asin"],
  [/\batan2\b/g, "__math_atan2"],
  [/\batan\b/g, "__math_atan"],
  [/\bceil\b/g, "__math_ceil"],
  [/\bclamp\b/g, "__math_clamp"],
  [/\bcos\b/g, "__math_cos"],
  [/\bexp\b/g, "__math_exp"],
  [/\bfloor\b/g, "__math_floor"],
  [/\blog10\b/g, "__math_log10"],
  [/\blog2\b/g, "__math_log2"],
  [/\blog\b/g, "__math_log"],
  [/\bmax\b/g, "__math_max"],
  [/\bmin\b/g, "__math_min"],
  [/\bpow\b/g, "__math_pow"],
  [/\bround\b/g, "__math_round"],
  [/\bsign\b/g, "__math_sign"],
  [/\bsin\b/g, "__math_sin"],
  [/\bsqrt\b/g, "__math_sqrt"],
  [/\btan\b/g, "__math_tan"],
  [/\btrunc\b/g, "__math_trunc"]
]

const SCRIPT_RESERVED_IDENTIFIERS = new Set([
  "Math",
  "E",
  "PI",
  "abs",
  "acos",
  "asin",
  "atan",
  "atan2",
  "ceil",
  "clamp",
  "cos",
  "exp",
  "floor",
  "log",
  "log10",
  "log2",
  "max",
  "min",
  "pow",
  "round",
  "sign",
  "sin",
  "sqrt",
  "tan",
  "trunc",
  "true",
  "false",
  "null"
])

function normalizeCalcExpression(expression: string) {
  let normalizedExpression = expression

  for (const [pattern, replacement] of CALC_MATH_ALIAS_PATTERNS) {
    normalizedExpression = normalizedExpression.replace(pattern, replacement)
  }

  for (const [pattern, replacement] of CALC_BARE_MATH_FUNCTION_ALIASES) {
    normalizedExpression = normalizedExpression.replace(pattern, replacement)
  }

  return normalizedExpression
}

function assertExpressionIdentifiers(expression: string, extraAllowedIdentifiers: string[] = []) {
  const allowedIdentifiers = new Set([
    ...CALC_MATH_CONTEXT_KEYS,
    ...extraAllowedIdentifiers,
    "true",
    "false",
    "null"
  ])
  const identifiers = expression.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? []

  for (const identifier of identifiers) {
    if (!allowedIdentifiers.has(identifier)) {
      throw new Error(`Unsupported identifier in expression: ${identifier}`)
    }
  }
}

export function parseStoryValInput(valueText: string): unknown {
  const trimmed = valueText.trim()

  if (trimmed === "") {
    return ""
  }

  if (trimmed === "true") {
    return true
  }

  if (trimmed === "false") {
    return false
  }

  if (trimmed === "null") {
    return null
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  const maybeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))

  if (maybeJson) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return valueText
    }
  }

  return valueText
}

export function formatStoryValInput(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === undefined) {
    return ""
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

function toExpressionValue(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Referenced value must be a finite number.")
    }

    return value
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    const numericValue = toNumericValue(trimmed)
    return numericValue ?? value
  }

  if (typeof value === "boolean" || value === null) {
    return value
  }

  throw new Error("Referenced value type is not supported in trigger expressions.")
}

function formatTemplateValue(value: unknown) {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getStoryContextValue(
  token: string,
  contextValues?: Record<string, unknown>
) {
  if (
    contextValues &&
    Object.prototype.hasOwnProperty.call(contextValues, token)
  ) {
    return {
      found: true,
      value: contextValues[token]
    }
  }

  return {
    found: false,
    value: undefined
  }
}

function buildStoryReadableContextValues(
  context?: StoryExpressionContext | StoryScriptExecutionContext
) {
  const assignableValues = context && "assignableValues" in context
    ? (context.assignableValues ?? {})
    : {}

  return {
    ...(context?.values ?? {}),
    ...assignableValues
  }
}

function buildExpressionEvaluator(
  expression: string,
  extraContext: Array<{ key: string; value: unknown }>
) {
  const keys = [...CALC_MATH_CONTEXT_KEYS, ...extraContext.map((item) => item.key)]
  const values = [
    ...CALC_MATH_CONTEXT_KEYS.map((key) => CALC_MATH_CONTEXT[key]),
    ...extraContext.map((item) => item.value)
  ]

  return Function(
    ...keys,
    `"use strict"; return (${expression})`
  )(...values) as unknown
}

function evaluateDynamicExpression(
  expression: string,
  extraContext: Array<{ key: string; value: unknown }> = []
) {
  const normalizedExpression = normalizeCalcExpression(expression)

  if (!/^[\d+\-*/%().,\sA-Za-z_<>=!&|'"`]+$/.test(normalizedExpression)) {
    throw new Error("The expression contains unsupported characters.")
  }

  assertExpressionIdentifiers(
    normalizedExpression,
    extraContext.map((item) => item.key)
  )

  const result = buildExpressionEvaluator(normalizedExpression, extraContext)

  if (typeof result === "number") {
    if (!Number.isFinite(result)) {
      throw new Error("The expression result must be a finite number.")
    }

    return result
  }

  if (typeof result === "string" || typeof result === "boolean" || result === null) {
    return result
  }

  throw new Error("The expression result type is not supported.")
}

function evaluateArithmeticExpression(
  expression: string,
  extraContext: Array<{ key: string; value: unknown }> = []
) {
  const normalizedExpression = normalizeCalcExpression(expression)

  if (!/^[\d+\-*/%().,\sA-Za-z_]+$/.test(normalizedExpression)) {
    throw new Error("The expression contains unsupported characters.")
  }

  assertExpressionIdentifiers(
    normalizedExpression,
    extraContext.map((item) => item.key)
  )

  const result = buildExpressionEvaluator(normalizedExpression, extraContext)

  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("The calculation result must be a finite number.")
  }

  return result
}

function evaluateBooleanExpression(
  expression: string,
  extraContext: Array<{ key: string; value: unknown }> = []
) {
  const normalizedExpression = normalizeCalcExpression(expression)

  if (!/^[\d+\-*/%().,\sA-Za-z_<>=!&|'"`]+$/.test(normalizedExpression)) {
    throw new Error("The expression contains unsupported characters.")
  }

  assertExpressionIdentifiers(
    normalizedExpression,
    extraContext.map((item) => item.key)
  )

  const result = buildExpressionEvaluator(normalizedExpression, extraContext)

  if (typeof result !== "boolean") {
    throw new Error("The trigger expression must return a boolean value.")
  }

  return result
}

function resolveCalcEntryValue(
  valsFile: StoryValsFile,
  currentGroup: StoryValDefinition,
  token: string,
  visited: Set<string>,
  depth: number,
  maxDepth: number
): number {
  const reference = getStoryCalcEntryReference(valsFile, currentGroup, token)
  const { group, row, referenceKey, displayLabel, groupName } = reference

  if (depth > maxDepth) {
    throw new Error(`Calculation nesting exceeds the max depth of ${maxDepth}.`)
  }

  if (visited.has(referenceKey)) {
    throw new Error(
      `Circular calc reference detected: ${[...visited, referenceKey].join(" -> ")}`
    )
  }

  if (!isCalcRow(row)) {
    const numericValue = toNumericValue(row.value)
    if (numericValue === null) {
      throw new Error(`Referenced variable is not numeric: {${displayLabel}}`)
    }

    return numericValue
  }

  const nestedRule = normalizeText(row.calc_rule).trim()
  if (!nestedRule) {
    throw new Error(`calc_rule is required for {${displayLabel}}`)
  }

  const nextVisited = new Set(visited)
  nextVisited.add(referenceKey)

  return evaluateStoryValCalcRule(group, nestedRule, {
    visited: nextVisited,
    depth: depth + 1,
    maxDepth,
    valsFile,
    currentGroupName: groupName
  }).result
}

function resolveStoryValueReference(
  valsFile: StoryValsFile,
  token: string,
  maxDepth: number,
  contextValues?: Record<string, unknown>
) {
  const contextValue = getStoryContextValue(token, contextValues)
  if (contextValue.found) {
    return toExpressionValue(contextValue.value)
  }

  const reference = getStoryValueEntryReference(valsFile, token)
  const { group, row, groupName, rowName } = reference

  if (isCalcRow(row)) {
    const visited = new Set<string>()
    const referenceKey = createStoryValueReferenceKey(groupName, rowName)

    if (referenceKey) {
      visited.add(referenceKey)
    }

    return evaluateStoryValCalcRule(group, normalizeText(row.calc_rule), {
      visited,
      depth: 1,
      maxDepth,
      valsFile,
      currentGroupName: groupName
    }).result
  }

  return toExpressionValue(row.value)
}

function getStoryCalcEntryReference(
  valsFile: StoryValsFile,
  currentGroup: StoryValDefinition,
  token: string
): StoryCalcEntryReference {
  const parts = token.split(".")

  if (parts.length === 1) {
    const rowName = normalizeRowName(parts[0])

    if (!rowName) {
      throw new Error(`Invalid calc reference: {${token}}. Use {row} or {group.row}.`)
    }

    const row = currentGroup.vals.find((item) => normalizeRowName(item.name) === rowName)

    if (!row) {
      throw new Error(`Referenced variable was not found: {${rowName}}`)
    }

    const groupName = normalizeGroupName(currentGroup.name)

    return {
      group: currentGroup,
      row,
      groupName,
      rowName,
      displayLabel: rowName,
      referenceKey: createStoryValueReferenceKey(groupName, rowName)
    }
  }

  if (parts.length === 2) {
    const reference = getStoryValueEntryReference(valsFile, token)

    return {
      ...reference,
      displayLabel: `${reference.groupName}.${reference.rowName}`,
      referenceKey: createStoryValueReferenceKey(reference.groupName, reference.rowName)
    }
  }

  throw new Error(`Invalid calc reference: {${token}}. Use {row} or {group.row}.`)
}

function getStoryValueEntryReference(
  valsFile: StoryValsFile,
  token: string
): StoryValueEntryReference {
  const [groupNameRaw, rowNameRaw, ...rest] = token.split(".")
  const groupName = normalizeGroupName(groupNameRaw)
  const rowName = normalizeRowName(rowNameRaw)

  if (!groupName || !rowName || rest.length > 0) {
    throw new Error(`Invalid trigger reference: {${token}}. Use {group.row}.`)
  }

  const group = valsFile.variables.find((item) => normalizeGroupName(item.name) === groupName)
  if (!group) {
    throw new Error(`Referenced variable group was not found: ${groupName}`)
  }

  const row = group.vals.find((item) => normalizeRowName(item.name) === rowName)
  if (!row) {
    throw new Error(`Referenced variable was not found: {${groupName}.${rowName}}`)
  }

  return {
    group,
    row,
    groupName,
    rowName
  }
}

function prepareExpressionTemplate(
  expressionTemplate: string,
  resolveToken: (token: string) => unknown
) {
  const extraContext: Array<{ key: string; value: unknown }> = []
  let contextIndex = 0

  const expression = expressionTemplate.replace(/\{([^{}]+)\}/g, (_match, token: string) => {
    const trimmedToken = token.trim()

    if (!trimmedToken) {
      throw new Error("Empty placeholder is not allowed.")
    }

    const key = `__value_${contextIndex}`
    contextIndex += 1
    extraContext.push({
      key,
      value: resolveToken(trimmedToken)
    })
    return key
  })

  return {
    expression,
    extraContext
  }
}

const STORY_SCRIPT_MAX_STEPS = 20000
const STORY_SCRIPT_MAX_LOOP_ITERATIONS = 5000
const STORY_SCRIPT_INTERNAL_INVOKE_NAME = "__story_invoke_once"
const STORY_SCRIPT_LEGACY_PLACEHOLDER_PATTERN =
  /(?<!\$)\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\}/
const STORY_SCRIPT_TEMPLATE_PLACEHOLDER_PATTERN = /\$\{([^{}]*)\}/g
const STORY_SCRIPT_SAFE_MATH = Object.freeze({
  E: Math.E,
  PI: Math.PI,
  abs: Math.abs,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  atan2: Math.atan2,
  ceil: Math.ceil,
  clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max),
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  log: Math.log,
  log10: Math.log10 ?? ((value: number) => Math.log(value) / Math.LN10),
  log2: Math.log2 ?? ((value: number) => Math.log(value) / Math.LN2),
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
  trunc: Math.trunc
})

function isStoryScriptPlaceholderToken(token: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(token.trim())
}

function getStoryScriptSourceLineNumber(source: string, index: number) {
  return source.slice(0, Math.max(0, index)).split(/\r?\n/).length
}

function findLegacyStoryScriptPlaceholder(source: string) {
  const match = STORY_SCRIPT_LEGACY_PLACEHOLDER_PATTERN.exec(source)
  if (!match) {
    return null
  }

  return {
    placeholder: match[0],
    lineNumber: getStoryScriptSourceLineNumber(source, match.index ?? 0)
  }
}

function parseAdvancedInvokeOnceArguments(source: string, lineNumber: number) {
  const text = normalizeText(source)
  const args: StoryScriptInvokeArgument[] = []
  let index = 0

  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index] ?? "")) {
      index += 1
    }

    if (index >= text.length) {
      break
    }

    const nameMatch = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (!nameMatch) {
      throw new StoryScriptError(lineNumber, "invoke_once argument name is invalid.")
    }

    const name = nameMatch[0]
    index += name.length

    while (index < text.length && /\s/.test(text[index] ?? "")) {
      index += 1
    }

    if ((text[index] ?? "") !== "=") {
      throw new StoryScriptError(lineNumber, `invoke_once argument "${name}" must use name=expression.`)
    }

    index += 1
    const expressionStart = index
    let parenDepth = 0
    let bracketDepth = 0
    let braceDepth = 0
    let activeQuote: "'" | "\"" | "`" | null = null
    let escaping = false

    while (index < text.length) {
      const char = text[index] ?? ""

      if (activeQuote) {
        if (escaping) {
          escaping = false
          index += 1
          continue
        }

        if (char === "\\") {
          escaping = true
          index += 1
          continue
        }

        if (char === activeQuote) {
          activeQuote = null
        }

        index += 1
        continue
      }

      if (char === "'" || char === "\"" || char === "`") {
        activeQuote = char
        index += 1
        continue
      }

      if (char === "(") {
        parenDepth += 1
        index += 1
        continue
      }

      if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1)
        index += 1
        continue
      }

      if (char === "[") {
        bracketDepth += 1
        index += 1
        continue
      }

      if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1)
        index += 1
        continue
      }

      if (char === "{") {
        braceDepth += 1
        index += 1
        continue
      }

      if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1)
        index += 1
        continue
      }

      if (
        /\s/.test(char)
        && parenDepth === 0
        && bracketDepth === 0
        && braceDepth === 0
      ) {
        const rest = text.slice(index).trimStart()
        if (!rest) {
          break
        }

        if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(rest)) {
          break
        }
      }

      index += 1
    }

    const expression = text.slice(expressionStart, index).trim()
    if (!expression) {
      throw new StoryScriptError(lineNumber, `invoke_once argument "${name}" is missing its expression.`)
    }

    args.push({
      name,
      expression
    })
  }

  return args
}

function transformInvokeOnceStatements(script: string) {
  return normalizeText(script)
    .split(/\r?\n/)
    .map((rawLine, lineIndex) => {
      const match = rawLine.match(/^(\s*)invoke_once\s+([A-Za-z0-9_\-:.]+)(?:\s+(.+?))?\s*$/)
      if (!match) {
        return rawLine
      }

      const indentation = match[1] ?? ""
      const eventId = (match[2] ?? "").trim()
      const argsSource = match[3] ?? ""
      if (!eventId) {
        throw new StoryScriptError(lineIndex + 1, "invoke_once requires an event id.")
      }

      const args = parseAdvancedInvokeOnceArguments(argsSource, lineIndex + 1)
      const objectLiteral = args.length > 0
        ? `{ ${args.map((arg) => `${arg.name}: (${arg.expression})`).join(", ")} }`
        : "{}"

      return `${indentation}${STORY_SCRIPT_INTERNAL_INVOKE_NAME}(${JSON.stringify(eventId)}, ${objectLiteral});`
    })
    .join("\n")
}

function compileStoryScriptSource(source: string): CompiledStoryScriptSource {
  const transformedSource = transformInvokeOnceStatements(source)
  const placeholders: StoryScriptPlaceholderBinding[] = []
  let placeholderIndex = 0
  const legacyPlaceholderMatch = STORY_SCRIPT_LEGACY_PLACEHOLDER_PATTERN.exec(transformedSource)

  if (legacyPlaceholderMatch) {
    throw new StoryScriptError(
      getStoryScriptSourceLineNumber(transformedSource, legacyPlaceholderMatch.index ?? 0),
      `StoryScript variable references must use \${...}. Found legacy placeholder "${legacyPlaceholderMatch[0]}".`
    )
  }

  const compiledSource = transformedSource.replace(/\$\{([^{}]+)\}/g, (_match, tokenText: string) => {
    const token = tokenText.trim()
    if (!token) {
      throw new Error("Empty placeholder is not allowed.")
    }

    if (!isStoryScriptPlaceholderToken(token)) {
      throw new Error(`Invalid placeholder: \${${token}}`)
    }

    const identifier = `__story_ref_${placeholderIndex}`
    placeholderIndex += 1
    placeholders.push({
      identifier,
      token
    })
    return identifier
  })

  return {
    source: compiledSource,
    placeholders
  }
}

function getStoryScriptLineNumber(sourceFile: ts.SourceFile, node: ts.Node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function createStoryScriptErrorFromNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string
) {
  return new StoryScriptError(getStoryScriptLineNumber(sourceFile, node), message)
}

function bumpStoryScriptStep(state: StoryScriptRuntimeState, node: ts.Node) {
  state.stepCount += 1
  if (state.stepCount > STORY_SCRIPT_MAX_STEPS) {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      node,
      `StoryScript exceeded the maximum step count of ${STORY_SCRIPT_MAX_STEPS}.`
    )
  }
}

function getStoryScriptContextValues(state: StoryScriptRuntimeState) {
  return buildStoryReadableContextValues(state.executionContext)
}

function resolveStoryScriptPlaceholderValue(
  state: StoryScriptRuntimeState,
  identifier: string,
  node: ts.Node
) {
  const token = state.placeholderMap.get(identifier)
  if (!token) {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      node,
      `Unknown StoryScript placeholder identifier "${identifier}".`
    )
  }

  return resolveStoryValueReference(
    state.valsFile,
    token,
    state.maxDepth,
    getStoryScriptContextValues(state)
  )
}

function getStoryScriptSafeIdentifierValue(identifier: string) {
  if (identifier === "Math") {
    return STORY_SCRIPT_SAFE_MATH
  }

  if (Object.prototype.hasOwnProperty.call(STORY_SCRIPT_SAFE_MATH, identifier)) {
    return STORY_SCRIPT_SAFE_MATH[identifier as keyof typeof STORY_SCRIPT_SAFE_MATH]
  }

  return undefined
}

function assertStoryScriptBooleanValue(
  value: unknown,
  state: StoryScriptRuntimeState,
  node: ts.Node
) {
  if (typeof value !== "boolean") {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      node,
      "StoryScript condition must evaluate to a boolean value."
    )
  }

  return value
}

function isStoryScriptAssignmentOperator(kind: ts.SyntaxKind) {
  return kind === ts.SyntaxKind.EqualsToken
    || kind === ts.SyntaxKind.PlusEqualsToken
    || kind === ts.SyntaxKind.MinusEqualsToken
    || kind === ts.SyntaxKind.AsteriskEqualsToken
    || kind === ts.SyntaxKind.SlashEqualsToken
    || kind === ts.SyntaxKind.PercentEqualsToken
}

function resolveStoryScriptAssignmentTarget(
  left: ts.Expression,
  state: StoryScriptRuntimeState
):
  | { kind: "local"; name: string }
  | { kind: "placeholder"; token: string } {
  if (!ts.isIdentifier(left)) {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      left,
      "StoryScript assignment target must be a local variable or placeholder."
    )
  }

  const identifier = left.text
  const placeholderToken = state.placeholderMap.get(identifier)
  if (placeholderToken) {
    return {
      kind: "placeholder",
      token: placeholderToken
    }
  }

  if (Object.prototype.hasOwnProperty.call(state.locals, identifier)) {
    return {
      kind: "local",
      name: identifier
    }
  }

  throw createStoryScriptErrorFromNode(
    state.sourceFile,
    left,
    `Temporary variable "${identifier}" was not declared.`
  )
}

function getStoryScriptAssignmentCurrentValue(
  target: ReturnType<typeof resolveStoryScriptAssignmentTarget>,
  state: StoryScriptRuntimeState,
  node: ts.Node
) {
  if (target.kind === "local") {
    return state.locals[target.name]
  }

  return resolveStoryValueReference(
    state.valsFile,
    target.token,
    state.maxDepth,
    getStoryScriptContextValues(state)
  )
}

function assignStoryScriptTargetValue(
  target: ReturnType<typeof resolveStoryScriptAssignmentTarget>,
  value: unknown,
  state: StoryScriptRuntimeState,
  node: ts.Node
) {
  if (target.kind === "local") {
    state.locals[target.name] = value
    return value
  }

  // 条件脚本只允许计算结果，不允许修改外部变量。
  if (state.mode === "predicate") {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      node,
      "Predicate StoryScript is read-only and cannot assign external values."
    )
  }

  try {
    assignStoryScriptGlobalValue(state.valsFile, target.token, value, state.executionContext)
    return value
  } catch (error) {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      node,
      error instanceof Error ? error.message : "StoryScript assignment failed."
    )
  }
}

function evaluateStoryScriptBinaryOperator(
  operator: ts.SyntaxKind,
  left: unknown,
  right: unknown,
  state: StoryScriptRuntimeState,
  node: ts.Node
) {
  switch (operator) {
    case ts.SyntaxKind.PlusToken:
      return typeof left === "string" || typeof right === "string"
        ? `${left ?? ""}${right ?? ""}`
        : Number(left) + Number(right)
    case ts.SyntaxKind.MinusToken:
      return Number(left) - Number(right)
    case ts.SyntaxKind.AsteriskToken:
      return Number(left) * Number(right)
    case ts.SyntaxKind.SlashToken:
      return Number(left) / Number(right)
    case ts.SyntaxKind.PercentToken:
      return Number(left) % Number(right)
    case ts.SyntaxKind.GreaterThanToken:
      return (left as number | string) > (right as number | string)
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return (left as number | string) >= (right as number | string)
    case ts.SyntaxKind.LessThanToken:
      return (left as number | string) < (right as number | string)
    case ts.SyntaxKind.LessThanEqualsToken:
      return (left as number | string) <= (right as number | string)
    case ts.SyntaxKind.EqualsEqualsToken:
      return left == right
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return left === right
    case ts.SyntaxKind.ExclamationEqualsToken:
      return left != right
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return left !== right
    default:
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        node,
        `Unsupported StoryScript operator: ${ts.tokenToString(operator) ?? String(operator)}`
      )
  }
}

function executeStoryScriptVariableDeclarationList(
  declarationList: ts.VariableDeclarationList,
  state: StoryScriptRuntimeState,
  node: ts.Node
) {
  if ((declarationList.flags & ts.NodeFlags.Let) === 0) {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      node,
      "StoryScript only supports let variable declarations."
    )
  }

  for (const declaration of declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        declaration,
        "StoryScript variable declaration must use a simple identifier."
      )
    }

    const identifier = declaration.name.text
    assertScriptLocalIdentifier(identifier)
    if (Object.prototype.hasOwnProperty.call(state.locals, identifier)) {
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        declaration.name,
        `Temporary variable "${identifier}" is already declared.`
      )
    }

    if (!declaration.initializer) {
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        declaration,
        `Temporary variable "${identifier}" requires an initializer.`
      )
    }

    state.locals[identifier] = evaluateStoryScriptAstExpression(
      declaration.initializer,
      state
    )
  }
}

function executeStoryScriptSwitchStatement(
  statement: ts.SwitchStatement,
  state: StoryScriptRuntimeState
): StoryScriptControlFlow {
  const switchValue = evaluateStoryScriptAstExpression(statement.expression, state)
  const defaultClauseIndex = statement.caseBlock.clauses.findIndex((clause) =>
    ts.isDefaultClause(clause)
  )
  const startClauseIndex = statement.caseBlock.clauses.findIndex((clause) => {
    if (ts.isDefaultClause(clause)) {
      return false
    }

    return evaluateStoryScriptAstExpression(clause.expression, state) === switchValue
  })
  const clauseIndex = startClauseIndex >= 0 ? startClauseIndex : defaultClauseIndex

  if (clauseIndex < 0) {
    return {
      kind: "normal"
    }
  }

  for (let index = clauseIndex; index < statement.caseBlock.clauses.length; index += 1) {
    const clause = statement.caseBlock.clauses[index]
    if (!clause) {
      continue
    }

    for (const clauseStatement of clause.statements) {
      const flow = executeStoryScriptAstStatement(clauseStatement, state)
      if (flow.kind === "break") {
        return {
          kind: "normal"
        }
      }

      if (flow.kind !== "normal") {
        return flow
      }
    }
  }

  return {
    kind: "normal"
  }
}

function executeStoryScriptWhileStatement(
  statement: ts.WhileStatement,
  state: StoryScriptRuntimeState
): StoryScriptControlFlow {
  let iterationCount = 0

  while (
    assertStoryScriptBooleanValue(
      evaluateStoryScriptAstExpression(statement.expression, state),
      state,
      statement.expression
    )
  ) {
    iterationCount += 1
    // 循环单独限制迭代次数，避免长时间占住脚本执行器。
    if (iterationCount > STORY_SCRIPT_MAX_LOOP_ITERATIONS) {
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        statement,
        `StoryScript loop exceeded the maximum iteration count of ${STORY_SCRIPT_MAX_LOOP_ITERATIONS}.`
      )
    }

    const flow = executeStoryScriptAstStatement(statement.statement, state)
    if (flow.kind === "break") {
      return {
        kind: "normal"
      }
    }

    if (flow.kind === "continue") {
      continue
    }

    if (flow.kind !== "normal") {
      return flow
    }
  }

  return {
    kind: "normal"
  }
}

function executeStoryScriptForStatement(
  statement: ts.ForStatement,
  state: StoryScriptRuntimeState
): StoryScriptControlFlow {
  if (statement.initializer) {
    if (ts.isVariableDeclarationList(statement.initializer)) {
      executeStoryScriptVariableDeclarationList(
        statement.initializer,
        state,
        statement.initializer
      )
    } else {
      evaluateStoryScriptAstExpression(statement.initializer, state)
    }
  }

  let iterationCount = 0

  while (true) {
    if (
      statement.condition &&
      !assertStoryScriptBooleanValue(
        evaluateStoryScriptAstExpression(statement.condition, state),
        state,
        statement.condition
      )
    ) {
      return {
        kind: "normal"
      }
    }

    iterationCount += 1
    // for 循环与 while 循环共用同一套最大迭代次数限制。
    if (iterationCount > STORY_SCRIPT_MAX_LOOP_ITERATIONS) {
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        statement,
        `StoryScript loop exceeded the maximum iteration count of ${STORY_SCRIPT_MAX_LOOP_ITERATIONS}.`
      )
    }

    const flow = executeStoryScriptAstStatement(statement.statement, state)
    if (flow.kind === "return") {
      return flow
    }

    if (flow.kind === "break") {
      return {
        kind: "normal"
      }
    }

    if (statement.incrementor) {
      evaluateStoryScriptAstExpression(statement.incrementor, state)
    }

    if (flow.kind === "continue") {
      continue
    }

    if (flow.kind !== "normal") {
      return flow
    }
  }
}

function executeStoryScriptInvokeCall(
  expression: ts.CallExpression,
  state: StoryScriptRuntimeState
) {
  if (state.mode === "predicate") {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      expression,
      "Predicate StoryScript is read-only and cannot invoke events."
    )
  }

  if (expression.arguments.length !== 2) {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      expression,
      "invoke_once must receive exactly two arguments after transformation."
    )
  }

  const eventIdNode = expression.arguments[0]
  const argsNode = expression.arguments[1]
  if (!eventIdNode || !argsNode || !ts.isStringLiteral(eventIdNode)) {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      expression,
      "invoke_once event id must be a string literal."
    )
  }

  if (!ts.isObjectLiteralExpression(argsNode)) {
    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      expression,
      "invoke_once arguments must be transformed into an object literal."
    )
  }

  const args: Record<string, unknown> = {}
  for (const property of argsNode.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        property,
        "invoke_once only supports direct property assignments."
      )
    }

    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : null
    if (!name) {
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        property.name,
        "invoke_once argument name is invalid."
      )
    }

    args[name] = evaluateStoryScriptAstExpression(property.initializer, state)
  }

  state.invocations.push({
    eventId: eventIdNode.text,
    args
  })

  return null
}

function evaluateStoryScriptAstExpression(
  expression: ts.Expression,
  state: StoryScriptRuntimeState
): unknown {
  bumpStoryScriptStep(state, expression)

  if (ts.isParenthesizedExpression(expression)) {
    return evaluateStoryScriptAstExpression(expression.expression, state)
  }

  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text)
  }

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text
  }

  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true
  }

  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false
  }

  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return null
  }

  if (ts.isIdentifier(expression)) {
    if (Object.prototype.hasOwnProperty.call(state.locals, expression.text)) {
      return state.locals[expression.text]
    }

    if (state.placeholderMap.has(expression.text)) {
      return resolveStoryScriptPlaceholderValue(state, expression.text, expression)
    }

    const safeValue = getStoryScriptSafeIdentifierValue(expression.text)
    if (safeValue !== undefined) {
      return safeValue
    }

    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      expression,
      `Unsupported identifier in StoryScript: ${expression.text}`
    )
  }

  if (ts.isPrefixUnaryExpression(expression)) {
    const operand = evaluateStoryScriptAstExpression(expression.operand, state)
    switch (expression.operator) {
      case ts.SyntaxKind.ExclamationToken:
        return !operand
      case ts.SyntaxKind.MinusToken:
        return -Number(operand)
      case ts.SyntaxKind.PlusToken:
        return +Number(operand)
      default:
        throw createStoryScriptErrorFromNode(
          state.sourceFile,
          expression,
          "Unsupported unary operator in StoryScript."
        )
    }
  }

  if (ts.isConditionalExpression(expression)) {
    const condition = assertStoryScriptBooleanValue(
      evaluateStoryScriptAstExpression(expression.condition, state),
      state,
      expression.condition
    )

    return condition
      ? evaluateStoryScriptAstExpression(expression.whenTrue, state)
      : evaluateStoryScriptAstExpression(expression.whenFalse, state)
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const target = evaluateStoryScriptAstExpression(expression.expression, state)
    if (target === STORY_SCRIPT_SAFE_MATH) {
      const member = expression.name.text
      if (Object.prototype.hasOwnProperty.call(STORY_SCRIPT_SAFE_MATH, member)) {
        return STORY_SCRIPT_SAFE_MATH[member as keyof typeof STORY_SCRIPT_SAFE_MATH]
      }
    }

    throw createStoryScriptErrorFromNode(
      state.sourceFile,
      expression,
      "Unsupported property access in StoryScript."
    )
  }

  if (ts.isCallExpression(expression)) {
    if (ts.isIdentifier(expression.expression) && expression.expression.text === STORY_SCRIPT_INTERNAL_INVOKE_NAME) {
      return executeStoryScriptInvokeCall(expression, state)
    }

    const callee = evaluateStoryScriptAstExpression(expression.expression, state)
    if (typeof callee !== "function") {
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        expression.expression,
        "StoryScript call target must be a function."
      )
    }

    const args = expression.arguments.map((arg) => evaluateStoryScriptAstExpression(arg, state))
    return callee(...args)
  }

  if (ts.isBinaryExpression(expression)) {
    if (isStoryScriptAssignmentOperator(expression.operatorToken.kind)) {
      const target = resolveStoryScriptAssignmentTarget(expression.left, state)

      if (expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const assignedValue = evaluateStoryScriptAstExpression(expression.right, state)
        return assignStoryScriptTargetValue(target, assignedValue, state, expression.left)
      }

      const currentValue = getStoryScriptAssignmentCurrentValue(target, state, expression.left)
      const rightValue = evaluateStoryScriptAstExpression(expression.right, state)
      const mappedOperator = expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
        ? ts.SyntaxKind.PlusToken
        : expression.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken
          ? ts.SyntaxKind.MinusToken
          : expression.operatorToken.kind === ts.SyntaxKind.AsteriskEqualsToken
            ? ts.SyntaxKind.AsteriskToken
            : expression.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken
              ? ts.SyntaxKind.SlashToken
              : ts.SyntaxKind.PercentToken
      const nextValue = evaluateStoryScriptBinaryOperator(
        mappedOperator,
        currentValue,
        rightValue,
        state,
        expression
      )
      return assignStoryScriptTargetValue(target, nextValue, state, expression.left)
    }

    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const left = assertStoryScriptBooleanValue(
        evaluateStoryScriptAstExpression(expression.left, state),
        state,
        expression.left
      )

      return left
        ? assertStoryScriptBooleanValue(
            evaluateStoryScriptAstExpression(expression.right, state),
            state,
            expression.right
          )
        : false
    }

    if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      const left = assertStoryScriptBooleanValue(
        evaluateStoryScriptAstExpression(expression.left, state),
        state,
        expression.left
      )

      return left
        ? true
        : assertStoryScriptBooleanValue(
            evaluateStoryScriptAstExpression(expression.right, state),
            state,
            expression.right
          )
    }

    if (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const left = evaluateStoryScriptAstExpression(expression.left, state)
      return left ?? evaluateStoryScriptAstExpression(expression.right, state)
    }

    const left = evaluateStoryScriptAstExpression(expression.left, state)
    const right = evaluateStoryScriptAstExpression(expression.right, state)
    return evaluateStoryScriptBinaryOperator(
      expression.operatorToken.kind,
      left,
      right,
      state,
      expression
    )
  }

  throw createStoryScriptErrorFromNode(
    state.sourceFile,
    expression,
    `Unsupported StoryScript expression kind: ${ts.SyntaxKind[expression.kind] ?? expression.kind}`
  )
}

function executeStoryScriptAstStatements(
  statements: readonly ts.Statement[],
  state: StoryScriptRuntimeState
): StoryScriptControlFlow {
  for (const statement of statements) {
    const flow = executeStoryScriptAstStatement(statement, state)
    if (flow.kind !== "normal") {
      return flow
    }
  }

  return {
    kind: "normal"
  }
}

function executeStoryScriptAstStatement(
  statement: ts.Statement,
  state: StoryScriptRuntimeState
): StoryScriptControlFlow {
  bumpStoryScriptStep(state, statement)

  if (ts.isBlock(statement)) {
    return executeStoryScriptAstStatements(statement.statements, state)
  }

  if (ts.isEmptyStatement(statement)) {
    return {
      kind: "normal"
    }
  }

  if (ts.isVariableStatement(statement)) {
    executeStoryScriptVariableDeclarationList(statement.declarationList, state, statement)
    return {
      kind: "normal"
    }
  }

  if (ts.isExpressionStatement(statement)) {
    state.lastExpressionValue = evaluateStoryScriptAstExpression(statement.expression, state)
    return {
      kind: "normal"
    }
  }

  if (ts.isIfStatement(statement)) {
    const condition = assertStoryScriptBooleanValue(
      evaluateStoryScriptAstExpression(statement.expression, state),
      state,
      statement.expression
    )

    return condition
      ? executeStoryScriptAstStatement(statement.thenStatement, state)
      : (statement.elseStatement
          ? executeStoryScriptAstStatement(statement.elseStatement, state)
          : { kind: "normal" })
  }

  if (ts.isSwitchStatement(statement)) {
    return executeStoryScriptSwitchStatement(statement, state)
  }

  if (ts.isWhileStatement(statement)) {
    return executeStoryScriptWhileStatement(statement, state)
  }

  if (ts.isForStatement(statement)) {
    return executeStoryScriptForStatement(statement, state)
  }

  if (ts.isReturnStatement(statement)) {
    if (!statement.expression) {
      if (state.mode === "predicate") {
        throw createStoryScriptErrorFromNode(
          state.sourceFile,
          statement,
          "StoryScript predicate return must provide a boolean expression."
        )
      }

      return {
        kind: "return",
        value: undefined
      }
    }

    const returnValue = evaluateStoryScriptAstExpression(statement.expression, state)
    if (state.mode === "procedure") {
      throw createStoryScriptErrorFromNode(
        state.sourceFile,
        statement.expression,
        "Procedure StoryScript does not support return values."
      )
    }

    return {
      kind: "return",
      value: assertStoryScriptBooleanValue(returnValue, state, statement.expression)
    }
  }

  if (ts.isBreakStatement(statement)) {
    return {
      kind: "break"
    }
  }

  if (ts.isContinueStatement(statement)) {
    return {
      kind: "continue"
    }
  }

  throw createStoryScriptErrorFromNode(
    state.sourceFile,
    statement,
    `Unsupported StoryScript statement kind: ${ts.SyntaxKind[statement.kind] ?? statement.kind}`
  )
}

function executeCompiledStoryScript(
  valsFile: StoryValsFile,
  source: string,
  mode: "predicate",
  maxDepth: number,
  context?: StoryScriptExecutionContext
): PredicateStoryScriptExecutionResult
function executeCompiledStoryScript(
  valsFile: StoryValsFile,
  source: string,
  mode: "procedure",
  maxDepth: number,
  context?: StoryScriptExecutionContext
): StoryScriptExecutionResult
function executeCompiledStoryScript(
  valsFile: StoryValsFile,
  source: string,
  mode: StoryScriptMode,
  maxDepth: number,
  context?: StoryScriptExecutionContext
) {
  const nextVals = cloneStoryValsFile(valsFile)
  const executionContext: StoryScriptExecutionContext = {
    values: { ...(context?.values ?? {}) },
    assignableValues: { ...(context?.assignableValues ?? {}) }
  }
  const compiledSource = compileStoryScriptSource(source)
  const sourceFile = ts.createSourceFile(
    "storyscript.ts",
    compiledSource.source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  )

  const parseDiagnostics =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] })
      .parseDiagnostics ?? []
  const firstDiagnostic = parseDiagnostics.find(
    (diagnostic: ts.DiagnosticWithLocation) => diagnostic.category === ts.DiagnosticCategory.Error
  )
  if (firstDiagnostic) {
    const position = firstDiagnostic.start ?? 0
    const lineNumber = sourceFile.getLineAndCharacterOfPosition(position).line + 1
    throw new StoryScriptError(
      lineNumber,
      ts.flattenDiagnosticMessageText(firstDiagnostic.messageText, "\n")
    )
  }

  const state: StoryScriptRuntimeState = {
    valsFile: nextVals,
    locals: {},
    invocations: [],
    mode,
    maxDepth,
    contextValues: {},
    executionContext,
    placeholderMap: new Map(
      compiledSource.placeholders.map((binding) => [binding.identifier, binding.token] as const)
    ),
    sourceFile,
    stepCount: 0,
    lastExpressionValue: undefined
  }

  const flow = executeStoryScriptAstStatements(sourceFile.statements, state)
  if (flow.kind === "break" || flow.kind === "continue") {
    throw new StoryScriptError(
      1,
      `StoryScript ${flow.kind} is only valid inside loops.`
    )
  }

  if (mode === "predicate") {
    const result = flow.kind === "return" ? flow.value : state.lastExpressionValue
    if (typeof result !== "boolean") {
      throw new StoryScriptError(
        sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1,
        "StoryScript predicate must produce a boolean result."
      )
    }

    return {
      result,
      vals: nextVals,
      locals: { ...state.locals },
      externalValues: { ...(executionContext.assignableValues ?? {}) },
      invocations: [...state.invocations]
    }
  }

  return {
    vals: nextVals,
    locals: { ...state.locals },
    externalValues: { ...(executionContext.assignableValues ?? {}) },
    invocations: [...state.invocations]
  }
}

export function evaluateStoryValCalcRule(
  group: StoryValDefinition,
  calcRule: string,
  options?: {
    visited?: Set<string>
    depth?: number
    maxDepth?: number
    valsFile?: StoryValsFile
    currentGroupName?: string
  }
): StoryValCalcEvaluation {
  const depth = options?.depth ?? 1
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_CALC_NESTING_DEPTH
  const visited = options?.visited ?? new Set<string>()
  const valsFile = options?.valsFile ?? {
    variables: [group]
  }

  if (depth > maxDepth) {
    throw new Error(`Calculation nesting exceeds the max depth of ${maxDepth}.`)
  }

  const trimmedRule = normalizeText(calcRule).trim()
  if (!trimmedRule) {
    throw new Error("calc_rule is required.")
  }

  const preparedExpression = prepareExpressionTemplate(trimmedRule, (token) =>
    resolveCalcEntryValue(valsFile, group, token, visited, depth, maxDepth)
  )

  return {
    expression: preparedExpression.expression,
    result: evaluateArithmeticExpression(
      preparedExpression.expression,
      preparedExpression.extraContext
    )
  }
}

export function evaluateStoryBooleanExpression(
  valsFile: StoryValsFile,
  expression: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryExpressionContext
): StoryBooleanExpressionEvaluation {
  const trimmedExpression = normalizeText(expression).trim()

  if (!trimmedExpression) {
    return {
      expression: "true",
      result: true
    }
  }

  const predicateSource = /\breturn\b|[{};]/.test(trimmedExpression)
    ? trimmedExpression
    : `return (${trimmedExpression});`
  const compiled = executeCompiledStoryScript(
    valsFile,
    predicateSource,
    "predicate",
    maxDepth,
    {
      values: { ...(context?.values ?? {}) }
    }
  )

  return {
    expression: predicateSource,
    result: compiled.result
  }
}

function assertScriptLocalIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid temporary variable name: ${identifier}`)
  }

  if (identifier.startsWith("__")) {
    throw new Error(`Temporary variable name is reserved: ${identifier}`)
  }

  if (SCRIPT_RESERVED_IDENTIFIERS.has(identifier)) {
    throw new Error(`Temporary variable name is reserved: ${identifier}`)
  }
}

function getStoryScriptBinaryOperator(
  operator: StoryScriptCompoundAssignmentOperator
) {
  switch (operator) {
    case "+=":
      return "+"
    case "-=":
      return "-"
    case "*=":
      return "*"
    case "/=":
      return "/"
    case "%=":
      return "%"
  }
}

function createStoryScriptCompoundAssignmentExpression(
  targetReference: string,
  operator: StoryScriptCompoundAssignmentOperator,
  expression: string
) {
  const binaryOperator = getStoryScriptBinaryOperator(operator)
  return `${targetReference} ${binaryOperator} (${expression.trim()})`
}

function parseStoryScriptInvokeArguments(source: string, lineNumber: number) {
  const trimmedSource = normalizeText(source).trim()
  if (!trimmedSource) {
    return []
  }

  const args: StoryScriptInvokeArgument[] = []
  const parts = trimmedSource.split(/\s+/).filter(Boolean)

  for (const part of parts) {
    const separatorIndex = part.indexOf("=")
    if (separatorIndex <= 0 || separatorIndex >= part.length - 1) {
      throw new StoryScriptError(
        lineNumber,
        `Invalid invoke_once argument "${part}". Use name=expression.`
      )
    }

    const name = part.slice(0, separatorIndex).trim()
    const expression = part.slice(separatorIndex + 1).trim()

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new StoryScriptError(
        lineNumber,
        `Invalid invoke_once argument name "${name}".`
      )
    }

    if (!expression) {
      throw new StoryScriptError(
        lineNumber,
        `invoke_once argument "${name}" is missing its expression.`
      )
    }

    args.push({
      name,
      expression
    })
  }

  return args
}

function assignStoryScriptGlobalValue(
  valsFile: StoryValsFile,
  token: string,
  value: unknown,
  context?: StoryScriptExecutionContext
) {
  if (token.startsWith("call.")) {
    throw new Error(`Cannot assign to invoke parameter: \${${token}}`)
  }

  if (token.startsWith("system.")) {
    throw new Error(`Cannot assign to system variable: \${${token}}`)
  }

  if (
    context?.assignableValues &&
    Object.prototype.hasOwnProperty.call(context.assignableValues, token)
  ) {
    context.assignableValues[token] = value
    return
  }

  const reference = getStoryValueEntryReference(valsFile, token)

  if (isCalcRow(reference.row)) {
    throw new Error(`Cannot assign to calc variable: \${${reference.groupName}.${reference.rowName}}`)
  }

  reference.row.value = value
}

export function executeStoryScript(
  valsFile: StoryValsFile,
  script: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryScriptExecutionContext
): StoryScriptExecutionResult {
  const trimmedScript = normalizeText(script).trim()
  if (!trimmedScript) {
    return {
      vals: cloneStoryValsFile(valsFile),
      locals: {},
      externalValues: { ...(context?.assignableValues ?? {}) },
      invocations: []
    }
  }

  const compiled = executeCompiledStoryScript(
    valsFile,
    trimmedScript,
    "procedure",
    maxDepth,
    context
  )

  return {
    vals: compiled.vals,
    locals: compiled.locals,
    externalValues: compiled.externalValues,
    invocations: compiled.invocations
  }
}

export function validateStoryScript(
  valsFile: StoryValsFile,
  script: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryScriptExecutionContext
): StoryScriptValidationIssue[] {
  const trimmedScript = normalizeText(script).trim()

  if (!trimmedScript) {
    return []
  }

  try {
    executeStoryScript(valsFile, script, maxDepth, context)
    return []
  } catch (error) {
    if (error instanceof StoryScriptError) {
      return [{
        lineNumber: error.lineNumber,
        message: error.message
      }]
    }

    return [{
      lineNumber: 0,
      message: error instanceof Error ? error.message : "Script validation failed."
    }]
  }
}

export function validateStoryTextTemplate(template: string): StoryScriptValidationIssue[] {
  const normalizedTemplate = normalizeText(template)
  const legacyPlaceholder = findLegacyStoryScriptPlaceholder(normalizedTemplate)

  if (legacyPlaceholder) {
    return [{
      lineNumber: legacyPlaceholder.lineNumber,
      message: `StoryScript text template must use \${...}. Found legacy placeholder "${legacyPlaceholder.placeholder}".`
    }]
  }

  const issues: StoryScriptValidationIssue[] = []

  for (const match of normalizedTemplate.matchAll(STORY_SCRIPT_TEMPLATE_PLACEHOLDER_PATTERN)) {
    const token = (match[1] ?? "").trim()

    if (token && isStoryScriptPlaceholderToken(token)) {
      continue
    }

    issues.push({
      lineNumber: getStoryScriptSourceLineNumber(normalizedTemplate, match.index ?? 0),
      message: `Invalid StoryScript template placeholder "\${${match[1] ?? ""}}".`
    })
  }

  return issues
}

export function renderStoryTextTemplate(
  valsFile: StoryValsFile,
  template: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryExpressionContext
) {
  const contextValues = buildStoryReadableContextValues(context)
  const legacyPlaceholder = findLegacyStoryScriptPlaceholder(template)

  if (legacyPlaceholder) {
    throw new Error(
      `StoryScript text template must use \${...}. Found legacy placeholder "${legacyPlaceholder.placeholder}".`
    )
  }

  return normalizeText(template).replace(/\$\{([^{}]+)\}/g, (_match, tokenText: string) => {
    const trimmedToken = tokenText.trim()

    if (!trimmedToken) {
      return ""
    }

    const resolvedValue = resolveStoryValueReference(
      valsFile,
      trimmedToken,
      maxDepth,
      contextValues
    )

    return formatTemplateValue(resolvedValue)
  })
}

export function getStoryValCalcDisplay(
  valsFile: StoryValsFile,
  group: StoryValDefinition,
  row: StoryValEntryDefinition,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH
): StoryValCalcDisplay {
  const rowName = normalizeRowName(row.name)
  const groupName = normalizeGroupName(group.name)
  const visited = new Set<string>()
  const referenceKey = createStoryValueReferenceKey(groupName, rowName)

  if (referenceKey) {
    visited.add(referenceKey)
  }

  try {
    const preview = evaluateStoryValCalcRule(group, normalizeText(row.calc_rule), {
      visited,
      depth: 1,
      maxDepth,
      valsFile,
      currentGroupName: groupName
    })

    return {
      ok: true,
      text: String(preview.result),
      detail: preview.expression
    }
  } catch (error) {
    return {
      ok: false,
      text: "error",
      detail: error instanceof Error ? error.message : "Calculation failed."
    }
  }
}

export function validateStoryValsCalcRules(
  valsFile: StoryValsFile,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH
) {
  return valsFile.variables.flatMap((group, groupIndex) =>
    group.vals.flatMap((row, rowIndex) => {
      if (!isCalcRow(row)) {
        return []
      }

      try {
        const rowName = normalizeRowName(row.name)
        const groupName = normalizeGroupName(group.name)
        const visited = new Set<string>()
        const referenceKey = createStoryValueReferenceKey(groupName, rowName)

        if (referenceKey) {
          visited.add(referenceKey)
        }

        evaluateStoryValCalcRule(group, normalizeText(row.calc_rule), {
          visited,
          depth: 1,
          maxDepth,
          valsFile,
          currentGroupName: groupName
        })

        return []
      } catch (error) {
        return [
          {
            groupIndex,
            rowIndex,
            groupName: group.name,
            rowName: row.name,
            message: error instanceof Error ? error.message : "calc_rule validation failed."
          }
        ]
      }
    })
  )
}
