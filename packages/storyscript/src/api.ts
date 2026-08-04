/**
 * StoryScript 对外 API。
 *
 * 调用方通过这里执行脚本、判断条件、渲染文本并校验 calc。底层 AST 解释细节留在 engine.ts，
 * 因此业务代码只需要理解输入和结果，不需要接触 Acorn 节点。
 */
import {
  DEFAULT_MAX_CALC_NESTING_DEPTH,
  StoryScriptError,
  type StoryBooleanExpressionEvaluation,
  type StoryExpressionContext,
  type StoryScriptExecutionContext,
  type StoryScriptExecutionResult,
  type StoryScriptInvokeValidationTarget,
  type StoryScriptValidationIssue,
  type StoryValCalcDisplay,
  type StoryValDefinition,
  type StoryValEntryDefinition,
  type StoryValsFile
} from "./types"
import { LEGACY_PLACEHOLDER, sourceLine, stripComments, TEMPLATE_PLACEHOLDER } from "./source"
import { evaluateStoryValCalcRule, resolveValue, run } from "./engine"
import {
  buildReadableValues,
  cloneValsFile,
  formatTemplateValue,
  isCalcRow,
  normalizeGroupName,
  normalizeRowName
} from "./runtime-values"

/**
 * 检查脚本里的 `invoke_once` 是否指向存在且参数完整的事件。
 *
 * @param script 要检查的完整 StoryScript 源码。
 * @param targets 当前故事允许被调用的事件类型、id 与必填参数名。
 * @returns 校验问题数组；空数组表示所有能识别的 invoke_once 引用都有效。
 *
 * 算法按源码行扫描声明语法，这样每条问题能保留准确行号；旧 graph/once/loop 名称会先转成
 * chain/pool/schedule，再与规范目标比较。这里只检查引用，不实际执行脚本。
 */
export function validateStoryScriptInvokeReferences(script: string, targets: StoryScriptInvokeValidationTarget[]) {
  const issues: StoryScriptValidationIssue[] = []
  const normalizedTargets = targets.map((target) => ({ ...target, eventId: target.eventId.trim() }))
  stripComments(script).split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*invoke_once\s+(chain|pool|schedule|graph|once|loop)\s+([A-Za-z0-9_\-:.]+)(?:\s+(.*))?\s*$/)
    if (!match) return
    const type = match[1] === "graph" ? "chain" : match[1] === "once" ? "pool" : match[1] === "loop" ? "schedule" : match[1]
    const target = normalizedTargets.find((item) => item.type === type && item.eventId === match[2])
    if (!target) {
      issues.push({ lineNumber: index + 1, message: `invoke_once 目标事件不存在，或不是 ${type} 类型中的“被调用”事件: ${match[2]}` })
      return
    }
    const names = Array.from((match[3] ?? "").matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=/g)).map((item) => item[1])
    for (const paramName of target.paramNames) {
      if (!names.includes(paramName)) issues.push({ lineNumber: index + 1, message: `invoke_once 调用 ${type}.${match[2]} 时缺少参数 "${paramName}"。` })
    }
  })
  return issues
}

/**
 * 执行一个必须得到布尔值的 StoryScript 条件。
 *
 * @param valsFile 故事普通变量与系统变量的合并视图。
 * @param expression 条件表达式或带 return 的小段脚本；空白条件视为 true。
 * @param maxDepth calc 变量互相引用时允许的最大递归深度。
 * @param context 额外只读值、白名单函数和确定性随机函数。
 * @returns 实际执行的源码与布尔结果。
 * @throws 语法非法、引用不存在、执行超限或最终结果不是 boolean 时抛错。
 */
export function evaluateStoryBooleanExpression(
  valsFile: StoryValsFile,
  expression: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryExpressionContext
): StoryBooleanExpressionEvaluation {
  const trimmed = expression.trim()
  if (!trimmed) return { expression: "true", result: true }
  const source = /\breturn\b|[{};]/.test(stripComments(trimmed)) ? trimmed : `return (${trimmed});`
  const { state, flow } = run(valsFile, source, maxDepth, context)
  const result = flow.kind === "return" ? flow.value : state.lastExpressionValue
  if (typeof result !== "boolean") throw new Error("StoryScript predicate must produce a boolean result.")
  return { expression: source, result }
}

/**
 * 在变量副本上执行一段 StoryScript。
 *
 * @param valsFile 执行前的变量文件；函数不会直接修改这个对象。
 * @param script 要执行的过程脚本。
 * @param maxDepth calc 变量递归求值上限。
 * @param context 外部值、可写外部值、领域函数和随机源。
 * @returns 执行后的变量副本、局部变量、外部可写值和排队的事件调用。
 * @throws 语法/运行时错误、非法赋值或安全步数上限触发时抛错。
 */
export function executeStoryScript(
  valsFile: StoryValsFile,
  script: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryScriptExecutionContext
): StoryScriptExecutionResult {
  if (!script.trim()) return { vals: cloneValsFile(valsFile), locals: {}, externalValues: { ...(context?.assignableValues ?? {}) }, invocations: [] }
  const { state } = run(valsFile, script, maxDepth, context)
  return {
    vals: state.valsFile,
    locals: { ...state.locals },
    externalValues: { ...(state.context.assignableValues ?? {}) },
    invocations: [...state.invocations]
  }
}

/**
 * 试运行过程脚本并把异常转换为编辑器可显示的问题数组。
 *
 * @param valsFile 校验时使用的变量定义。
 * @param script 要校验的脚本；空脚本直接通过。
 * @param maxDepth calc 递归上限。
 * @param context 校验阶段提供的模拟领域函数和上下文值。
 * @returns 空数组表示通过；失败时返回一条包含行号和消息的问题。
 */
export function validateStoryScript(
  valsFile: StoryValsFile,
  script: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryScriptExecutionContext
) {
  if (!script.trim()) return []
  try {
    executeStoryScript(valsFile, script, maxDepth, context)
    return []
  } catch (error) {
    return [{
      lineNumber: error instanceof StoryScriptError ? error.lineNumber : 0,
      message: error instanceof Error ? error.message : "Script validation failed."
    }]
  }
}

/**
 * 只检查对白/消息模板中的 `${组.变量}` 占位符格式。
 *
 * @param template 原始显示文本。
 * @returns 每个非法占位符的问题列表，包含从 1 开始的行号。
 */
export function validateStoryTextTemplate(template: string) {
  const legacy = LEGACY_PLACEHOLDER.exec(template)
  if (legacy) return [{ lineNumber: sourceLine(template, legacy.index), message: `StoryScript text template must use \${...}. Found legacy placeholder "${legacy[0]}".` }]
  const issues: StoryScriptValidationIssue[] = []
  for (const match of template.matchAll(TEMPLATE_PLACEHOLDER)) {
    const token = (match[1] ?? "").trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(token)) {
      issues.push({ lineNumber: sourceLine(template, match.index ?? 0), message: `Invalid StoryScript template placeholder "\${${match[1] ?? ""}}".` })
    }
  }
  return issues
}

/**
 * 把对白/消息模板中的变量占位符替换成当前值。
 *
 * @param valsFile 故事变量文件。
 * @param template 含 `${组.变量}` 的文本。
 * @param maxDepth calc 变量递归上限。
 * @param context 额外可读值，例如 call 参数和称谓 term。
 * @returns 完成替换的普通字符串。
 * @throws 使用旧 `{组.变量}`、引用不存在或 calc 失败时抛错。
 */
export function renderStoryTextTemplate(
  valsFile: StoryValsFile,
  template: string,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryExpressionContext
) {
  const legacy = LEGACY_PLACEHOLDER.exec(template)
  if (legacy) throw new Error(`StoryScript text template must use \${...}. Found legacy placeholder "${legacy[0]}".`)
  const values = buildReadableValues(context)
  return template.replace(/\$\{([^{}]+)\}/g, (_match, tokenText: string) =>
    formatTemplateValue(resolveValue(valsFile, tokenText.trim(), maxDepth, values))
  )
}

/**
 * 生成编辑器变量表中 calc 行的预览文字。
 *
 * @param valsFile 全部变量，供跨组引用。
 * @param group 当前变量组。
 * @param row 当前 calc 变量行。
 * @param maxDepth 最大递归深度。
 * @returns 成功时含计算值和替换后的表达式；失败时返回 error 与可读原因，不向外抛错。
 */
export function getStoryValCalcDisplay(
  valsFile: StoryValsFile,
  group: StoryValDefinition,
  row: StoryValEntryDefinition,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH
): StoryValCalcDisplay {
  try {
    const preview = evaluateStoryValCalcRule(group, row.calc_rule, {
      valsFile,
      maxDepth,
      visited: new Set([`${normalizeGroupName(group.name)}.${normalizeRowName(row.name)}`])
    })
    return { ok: true, text: String(preview.result), detail: preview.expression }
  } catch (error) {
    return { ok: false, text: "error", detail: error instanceof Error ? error.message : "Calculation failed." }
  }
}

/**
 * 校验变量文件里的每一条 calc_rule。
 *
 * @param valsFile 要检查的完整变量文件。
 * @param maxDepth 允许的最大嵌套计算深度。
 * @returns 带组/行索引和名称的问题数组；普通 value 行不会执行。
 *
 * 每个 calc 从包含自身的 visited 集合开始递归，遇到重复 key 就能给出明确的环路径。
 */
export function validateStoryValsCalcRules(valsFile: StoryValsFile, maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH) {
  return valsFile.variables.flatMap((group, groupIndex) => group.vals.flatMap((row, rowIndex) => {
    if (!isCalcRow(row)) return []
    try {
      evaluateStoryValCalcRule(group, row.calc_rule, {
        valsFile,
        maxDepth,
        visited: new Set([`${normalizeGroupName(group.name)}.${normalizeRowName(row.name)}`])
      })
      return []
    } catch (error) {
      return [{
        groupIndex,
        rowIndex,
        groupName: group.name,
        rowName: row.name,
        message: error instanceof Error ? error.message : "calc_rule validation failed."
      }]
    }
  }))
}
