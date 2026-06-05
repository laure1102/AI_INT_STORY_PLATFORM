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

  const contextValues = buildStoryReadableContextValues(context)
  const preparedExpression = prepareExpressionTemplate(trimmedExpression, (token) =>
    resolveStoryValueReference(valsFile, token, maxDepth, contextValues)
  )

  return {
    expression: preparedExpression.expression,
    result: evaluateBooleanExpression(
      preparedExpression.expression,
      preparedExpression.extraContext
    )
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

function parseStoryScript(script: string) {
  const statements: StoryScriptStatement[] = []
  const lines = normalizeText(script).split(/\r?\n/)

  for (const [lineIndex, rawLine] of lines.entries()) {
    let line = rawLine.trim()

    if (!line || line.startsWith("//")) {
      continue
    }

    if (line.endsWith(";")) {
      line = line.slice(0, -1).trimEnd()
    }

    if (!line) {
      continue
    }

    const lineNumber = lineIndex + 1
    const invokeMatch = line.match(/^invoke_once\s+([A-Za-z0-9_\-:.]+)(?:\s+(.+))?$/)
    if (invokeMatch) {
      const eventId = (invokeMatch[1] ?? "").trim()

      if (!eventId) {
        throw new StoryScriptError(lineNumber, "invoke_once requires an event id.")
      }

      statements.push({
        kind: "invokeOnce",
        lineNumber,
        eventId,
        args: parseStoryScriptInvokeArguments(invokeMatch[2] ?? "", lineNumber)
      })
      continue
    }

    const declareMatch = line.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/)
    if (declareMatch) {
      const identifier = declareMatch[1] ?? ""
      const expression = declareMatch[2] ?? ""
      statements.push({
        kind: "declareLocal",
        lineNumber,
        target: identifier,
        expression: expression.trim()
      })
      continue
    }

    const globalCompoundAssignMatch =
      line.match(/^\{([^{}]+)\}\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/)
    if (globalCompoundAssignMatch) {
      const token = globalCompoundAssignMatch[1] ?? ""
      const operator =
        (globalCompoundAssignMatch[2] as StoryScriptCompoundAssignmentOperator | undefined)
        ?? "+="
      const expression = globalCompoundAssignMatch[3] ?? ""
      const normalizedToken = token.trim()
      statements.push({
        kind: "assignGlobal",
        lineNumber,
        target: normalizedToken,
        expression: createStoryScriptCompoundAssignmentExpression(
          `{${normalizedToken}}`,
          operator,
          expression
        )
      })
      continue
    }

    const globalAssignMatch = line.match(/^\{([^{}]+)\}\s*=\s*(.+)$/)
    if (globalAssignMatch) {
      const token = globalAssignMatch[1] ?? ""
      const expression = globalAssignMatch[2] ?? ""
      statements.push({
        kind: "assignGlobal",
        lineNumber,
        target: token.trim(),
        expression: expression.trim()
      })
      continue
    }

    const localCompoundAssignMatch =
      line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/)
    if (localCompoundAssignMatch) {
      const identifier = localCompoundAssignMatch[1] ?? ""
      const operator =
        (localCompoundAssignMatch[2] as StoryScriptCompoundAssignmentOperator | undefined) ?? "+="
      const expression = localCompoundAssignMatch[3] ?? ""
      statements.push({
        kind: "assignLocal",
        lineNumber,
        target: identifier,
        expression: createStoryScriptCompoundAssignmentExpression(
          identifier,
          operator,
          expression
        )
      })
      continue
    }

    const localAssignMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/)
    if (localAssignMatch) {
      const identifier = localAssignMatch[1] ?? ""
      const expression = localAssignMatch[2] ?? ""
      statements.push({
        kind: "assignLocal",
        lineNumber,
        target: identifier,
        expression: expression.trim()
      })
      continue
    }

    throw new StoryScriptError(lineNumber, "Unsupported script statement.")
  }

  return statements
}

function evaluateStoryScriptExpression(
  valsFile: StoryValsFile,
  expression: string,
  locals: Record<string, unknown>,
  maxDepth: number,
  context?: StoryScriptExecutionContext
) {
  const trimmedExpression = normalizeText(expression).trim()

  if (!trimmedExpression) {
    throw new Error("Script expression is required.")
  }

  const contextValues = buildStoryReadableContextValues(context)
  const preparedExpression = prepareExpressionTemplate(trimmedExpression, (token) =>
    resolveStoryValueReference(valsFile, token, maxDepth, contextValues)
  )

  return {
    expression: preparedExpression.expression,
    result: evaluateDynamicExpression(preparedExpression.expression, [
      ...preparedExpression.extraContext,
      ...Object.entries(locals).map(([key, value]) => ({ key, value }))
    ])
  }
}

function assignStoryScriptGlobalValue(
  valsFile: StoryValsFile,
  token: string,
  value: unknown,
  context?: StoryScriptExecutionContext
) {
  if (
    context?.assignableValues &&
    Object.prototype.hasOwnProperty.call(context.assignableValues, token)
  ) {
    context.assignableValues[token] = value
    return
  }

  const reference = getStoryValueEntryReference(valsFile, token)

  if (isCalcRow(reference.row)) {
    throw new Error(`Cannot assign to calc variable: {${reference.groupName}.${reference.rowName}}`)
  }

  reference.row.value = value
}

export function executeStoryScript(
  valsFile: StoryValsFile,
  script: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryScriptExecutionContext
): StoryScriptExecutionResult {
  const nextVals = cloneStoryValsFile(valsFile)
  const locals: Record<string, unknown> = {}
  const invocations: StoryScriptInvocation[] = []
  const executionContext: StoryScriptExecutionContext = {
    values: { ...(context?.values ?? {}) },
    assignableValues: { ...(context?.assignableValues ?? {}) }
  }

  for (const statement of parseStoryScript(script)) {
    try {
      if (statement.kind === "invokeOnce") {
        const args = Object.fromEntries(
          statement.args.map((arg) => [
            arg.name,
            evaluateStoryScriptExpression(
              nextVals,
              arg.expression,
              locals,
              maxDepth,
              executionContext
            ).result
          ])
        )

        invocations.push({
          eventId: statement.eventId,
          args
        })
        continue
      }

      if (statement.kind === "declareLocal") {
        assertScriptLocalIdentifier(statement.target)

        if (Object.prototype.hasOwnProperty.call(locals, statement.target)) {
          throw new Error(`Temporary variable "${statement.target}" is already declared.`)
        }

        locals[statement.target] = evaluateStoryScriptExpression(
          nextVals,
          statement.expression,
          locals,
          maxDepth,
          executionContext
        ).result
        continue
      }

      if (statement.kind === "assignLocal") {
        assertScriptLocalIdentifier(statement.target)

        if (!Object.prototype.hasOwnProperty.call(locals, statement.target)) {
          throw new Error(`Temporary variable "${statement.target}" was not declared.`)
        }

        locals[statement.target] = evaluateStoryScriptExpression(
          nextVals,
          statement.expression,
          locals,
          maxDepth,
          executionContext
        ).result
        continue
      }

      const nextValue = evaluateStoryScriptExpression(
        nextVals,
        statement.expression,
        locals,
        maxDepth,
        executionContext
      ).result

      assignStoryScriptGlobalValue(nextVals, statement.target, nextValue, executionContext)
    } catch (error) {
      if (error instanceof StoryScriptError) {
        throw error
      }

      throw new StoryScriptError(
        statement.lineNumber,
        error instanceof Error ? error.message : "Script execution failed."
      )
    }
  }

  return {
    vals: nextVals,
    locals: { ...locals },
    externalValues: { ...(executionContext.assignableValues ?? {}) },
    invocations
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

export function renderStoryTextTemplate(
  valsFile: StoryValsFile,
  template: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryExpressionContext
) {
  const contextValues = buildStoryReadableContextValues(context)

  return normalizeText(template).replace(/\{([^{}]+)\}/g, (_match, token: string) => {
    const trimmedToken = token.trim()

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
