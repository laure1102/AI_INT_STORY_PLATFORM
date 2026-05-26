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

export interface StoryValCalcDisplay {
  ok: boolean
  text: string
  detail?: string
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function normalizeRowName(value: unknown) {
  return normalizeText(value).trim()
}

function isCalcRow(row: Pick<StoryValEntryDefinition, "value_type">) {
  return row.value_type === "calc"
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

function normalizeCalcExpression(calcRule: string) {
  let expression = calcRule

  for (const [pattern, replacement] of CALC_MATH_ALIAS_PATTERNS) {
    expression = expression.replace(pattern, replacement)
  }

  for (const [pattern, replacement] of CALC_BARE_MATH_FUNCTION_ALIASES) {
    expression = expression.replace(pattern, replacement)
  }

  return expression
}

function assertCalcExpressionIdentifiers(expression: string) {
  const allowedIdentifiers = new Set(CALC_MATH_CONTEXT_KEYS)
  const identifiers = expression.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? []

  for (const identifier of identifiers) {
    if (!allowedIdentifiers.has(identifier as keyof typeof CALC_MATH_CONTEXT)) {
      throw new Error(`规则中包含不支持的标识符：${identifier}`)
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

function evaluateArithmeticExpression(expression: string) {
  const normalizedExpression = normalizeCalcExpression(expression)

  if (!/^[\d+\-*/%().,\sA-Za-z_]+$/.test(normalizedExpression)) {
    throw new Error("规则中包含不支持的字符")
  }

  assertCalcExpressionIdentifiers(normalizedExpression)

  const result = Function(
    ...CALC_MATH_CONTEXT_KEYS,
    `"use strict"; return (${normalizedExpression})`
  )(...CALC_MATH_CONTEXT_KEYS.map((key) => CALC_MATH_CONTEXT[key])) as unknown

  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("计算结果不是有效数值")
  }

  return result
}

function resolveCalcEntryValue(
  group: StoryValDefinition,
  rowName: string,
  visited: Set<string>,
  depth: number,
  maxDepth: number
): number {
  if (depth > maxDepth) {
    throw new Error(`最多只支持 ${maxDepth} 层嵌套计算`)
  }

  if (visited.has(rowName)) {
    throw new Error(`检测到循环引用：${[...visited, rowName].join(" -> ")}`)
  }

  const row = group.vals.find((item) => normalizeRowName(item.name) === rowName)

  if (!row) {
    throw new Error(`未找到变量 {${rowName}}`)
  }

  if (!isCalcRow(row)) {
    const numericValue = toNumericValue(row.value)
    if (numericValue === null) {
      throw new Error(`变量 {${rowName}} 不是数值`)
    }

    return numericValue
  }

  const nestedRule = normalizeText(row.calc_rule).trim()
  if (!nestedRule) {
    throw new Error(`变量 {${rowName}} 缺少 calc_rule`)
  }

  const nextVisited = new Set(visited)
  nextVisited.add(rowName)

  return evaluateStoryValCalcRule(group, nestedRule, {
    visited: nextVisited,
    depth: depth + 1,
    maxDepth
  }).result
}

export function evaluateStoryValCalcRule(
  group: StoryValDefinition,
  calcRule: string,
  options?: {
    visited?: Set<string>
    depth?: number
    maxDepth?: number
  }
): StoryValCalcEvaluation {
  const depth = options?.depth ?? 1
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_CALC_NESTING_DEPTH
  const visited = options?.visited ?? new Set<string>()

  if (depth > maxDepth) {
    throw new Error(`最多只支持 ${maxDepth} 层嵌套计算`)
  }

  const trimmedRule = normalizeText(calcRule).trim()
  if (!trimmedRule) {
    throw new Error("请先输入 calc_rule")
  }

  const expression = trimmedRule.replace(/\{([^{}]+)\}/g, (_match, token: string) => {
    const rowName = token.trim()

    if (!rowName) {
      throw new Error("引用占位符不能为空")
    }

    return String(resolveCalcEntryValue(group, rowName, visited, depth, maxDepth))
  })

  return {
    expression,
    result: evaluateArithmeticExpression(expression)
  }
}

export function getStoryValCalcDisplay(
  group: StoryValDefinition,
  row: StoryValEntryDefinition,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH
): StoryValCalcDisplay {
  const rowName = normalizeRowName(row.name)
  const visited = new Set<string>()

  if (rowName) {
    visited.add(rowName)
  }

  try {
    const preview = evaluateStoryValCalcRule(group, normalizeText(row.calc_rule), {
      visited,
      depth: 1,
      maxDepth
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
      detail: error instanceof Error ? error.message : "计算失败"
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
        const visited = new Set<string>()

        if (rowName) {
          visited.add(rowName)
        }

        evaluateStoryValCalcRule(group, normalizeText(row.calc_rule), {
          visited,
          depth: 1,
          maxDepth
        })

        return []
      } catch (error) {
        return [
          {
            groupIndex,
            rowIndex,
            groupName: group.name,
            rowName: row.name,
            message: error instanceof Error ? error.message : "calc_rule 校验失败"
          }
        ]
      }
    })
  )
}
