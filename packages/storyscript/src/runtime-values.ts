/**
 * StoryScript 解释器内部使用的变量与显示值工具。
 *
 * 本模块只做纯数据转换和变量定位，不解析源码、不执行 AST。解释器与公开 API 都复用这些函数，
 * 从而保证“脚本执行、模板渲染、calc 预览”使用完全相同的变量命名规则。
 */
import type {
  StoryExpressionContext,
  StoryScriptExecutionContext,
  StoryValEntryDefinition,
  StoryValsFile
} from "./types"

/**
 * 把未知输入整理成字符串。
 *
 * @param value 可能来自 JSON、表单或脚本的任意值。
 * @returns 字符串原样返回，其他类型返回空字符串。
 */
export function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

/**
 * 深复制可序列化的故事数据，避免解释器直接改坏调用方对象。
 *
 * @param value 要复制的值。
 * @returns 与输入内容相同、引用独立的新值。
 * @throws 输入不能被 structuredClone 复制时抛出平台错误。
 */
export function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

/**
 * 深复制变量文件。
 *
 * @param valsFile 原始故事变量定义。
 * @returns 可由本次脚本安全修改的独立副本。
 */
export function cloneValsFile(valsFile: StoryValsFile): StoryValsFile {
  return cloneValue(valsFile)
}

/**
 * 规范化变量组名称。
 *
 * @param value 变量组 name 字段。
 * @returns 去掉首尾空格的字符串；非字符串变为空字符串。
 */
export function normalizeGroupName(value: unknown) {
  return normalizeText(value).trim()
}

/**
 * 规范化变量行名称。
 *
 * @param value 变量行 name 字段。
 * @returns 去掉首尾空格的字符串；非字符串变为空字符串。
 */
export function normalizeRowName(value: unknown) {
  return normalizeText(value).trim()
}

/**
 * 判断变量行是否通过 calc_rule 动态计算。
 *
 * @param row 一个变量定义行。
 * @returns `value_type` 为 `calc` 时返回 true。
 */
export function isCalcRow(row: StoryValEntryDefinition) {
  return row.value_type === "calc"
}

/**
 * 按 `组名.变量名` 查找变量定义。
 *
 * @param valsFile 要搜索的变量文件。
 * @param token 不带 `${}` 的变量引用，例如 `player.money`。
 * @returns 命中的组、变量行以及规范化后的两个名称。
 * @throws token 格式错误、变量组不存在或变量不存在时抛出可读错误。
 */
export function findValueEntry(valsFile: StoryValsFile, token: string) {
  const parts = token.split(".")
  if (parts.length !== 2) {
    throw new Error(`Invalid variable reference: \${${token}}. Use \${group.row}.`)
  }
  const groupName = normalizeGroupName(parts[0])
  const rowName = normalizeRowName(parts[1])
  const group = valsFile.variables.find((item) => normalizeGroupName(item.name) === groupName)
  if (!group) {
    throw new Error(`Referenced variable group was not found: ${groupName}`)
  }
  const row = group.vals.find((item) => normalizeRowName(item.name) === rowName)
  if (!row) {
    throw new Error(`Referenced variable was not found: \${${groupName}.${rowName}}`)
  }
  return { group, row, groupName, rowName }
}

/**
 * 合并脚本可读取的外部值。
 *
 * @param context 调用方提供的只读 values 和可写 assignableValues。
 * @returns 一个只用于本次读取的浅拷贝；同名可写值覆盖只读值。
 */
export function buildReadableValues(context?: StoryExpressionContext | StoryScriptExecutionContext) {
  const assignable = context && "assignableValues" in context ? context.assignableValues ?? {} : {}
  return { ...(context?.values ?? {}), ...assignable }
}

/**
 * 把变量值严格转换成有限数字。
 *
 * @param value 原始变量值。
 * @returns 有限 number，或可安全解析的十进制字符串；其他情况返回 null。
 */
export function toNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * 把任意变量值转换成可插入对白模板的文本。
 *
 * @param value 模板占位符解析出的值。
 * @returns null/undefined 为空串，基础类型为文字，对象优先使用 JSON。
 */
export function formatTemplateValue(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}
