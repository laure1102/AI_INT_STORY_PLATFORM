/**
 * 故事变量输入框的文本转换工具。
 *
 * 编辑器保存前用它把字符串转换为布尔值、数字或 JSON；
 * 再次展示时则通过 formatStoryValInput 转回便于编辑的文本。
 */
/**
 * 把变量编辑框中的文本转换为实际数据类型。
 *
 * @param valueText 用户在输入框中输入的原始文字。
 * @returns 可识别的 true/false/null/十进制数/JSON；无法解析时保留原字符串。
 *
 * JSON 解析失败不会抛错，因为普通对白文字也可能以括号开头；保存后仍由 Schema 做最终校验。
 */
export function parseStoryValInput(valueText: string): unknown {
  const trimmed = valueText.trim()
  if (trimmed === "") return ""
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null") return null
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    try { return JSON.parse(trimmed) } catch { return valueText }
  }
  return valueText
}

/**
 * 把变量值转换成表单输入框可以编辑的文本。
 *
 * @param value 当前变量值，可能是字符串、基础类型、数组或对象。
 * @returns 字符串原样返回；undefined 为空串；其他值尽量 JSON 序列化。
 *
 * 本函数与 parseStoryValInput 配对使用，只负责显示，不会修改传入对象。
 */
export function formatStoryValInput(value: unknown) {
  if (typeof value === "string") return value
  if (value === undefined) return ""
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}
