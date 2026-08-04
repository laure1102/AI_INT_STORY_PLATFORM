/**
 * StoryScript 的公共数据契约。
 *
 * 这里仅描述调用者能传入和得到的数据，不执行任何脚本。
 * 把类型与解释器分开后，阅读 API 时不需要先理解 AST 执行细节。
 */
import type { Node } from "acorn"

export const DEFAULT_MAX_CALC_NESTING_DEPTH = 5

export interface StoryValEntryDefinition {
  name: string
  description?: string
  value_type: "value" | "calc"
  value?: unknown
  calc_rule: string
}

export interface StoryValDefinition {
  name: string
  description?: string
  vals: StoryValEntryDefinition[]
}

export interface StoryValsFile {
  variables: StoryValDefinition[]
}

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

export interface StoryScriptInvokeValidationTarget {
  type: "chain" | "pool" | "schedule"
  eventId: string
  paramNames: string[]
}

export interface StoryExpressionContext {
  values?: Record<string, unknown>
  functions?: Record<string, (...args: unknown[]) => unknown>
  random?: () => number
}

export interface StoryScriptExecutionContext extends StoryExpressionContext {
  assignableValues?: Record<string, unknown>
}

export interface StoryScriptInvocation {
  targetType: "chain" | "pool" | "schedule" | "graph" | "once" | "loop"
  eventId: string
  args: Record<string, unknown>
  delay?: StoryScriptInvokeDelay
}

export type StoryScriptInvokeDelayUnit = "hours" | "days" | "months" | "years"

export interface StoryScriptInvokeDelay {
  unit: StoryScriptInvokeDelayUnit
  value: number
}

export type AstNode = Node & Record<string, unknown>

export interface PlaceholderBinding {
  identifier: string
  token: string
}

/**
 * StoryScript 在解析或执行失败时抛出的错误。
 *
 * `lineNumber` 使用从 1 开始的行号，界面可以直接显示给故事作者。
 */
export class StoryScriptError extends Error {
  lineNumber: number

  /**
   * 创建一个可直接显示在脚本编辑器中的错误。
   *
   * @param lineNumber 从 1 开始的源码行号。
   * @param message 具体错误原因。
   * @returns 新的 StoryScriptError 实例；构造过程没有外部副作用。
   */
  constructor(lineNumber: number, message: string) {
    super(message)
    this.name = "StoryScriptError"
    this.lineNumber = lineNumber
  }
}
