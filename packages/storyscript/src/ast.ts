/**
 * StoryScript 的 AST 安全读取工具。
 *
 * Acorn 返回的是一棵由普通对象组成的语法树。本模块把“不确定的字段值”收窄成可执行节点，并把
 * 所有语法错误统一转换成带源码行号的 StoryScriptError。它不解释表达式，也不修改故事变量。
 */
import { StoryScriptError, type AstNode } from "./types"

/**
 * 确认一个未知值确实是 AST 节点。
 *
 * @param value 从 Acorn 节点字段中读出的未知值。
 * @returns 类型已收窄的 AstNode。
 * @throws 值为空、不是对象或没有字符串类型的 `type` 字段时抛错。
 */
export function asNode(value: unknown): AstNode {
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") {
    throw new Error("Invalid StoryScript syntax node.")
  }
  return value as AstNode
}

/**
 * 读取一个可以为空的 AST 节点。
 *
 * @param value AST 可选字段，例如 for 语句可以省略的 init。
 * @returns 空值返回 null，否则返回经过 `asNode` 校验的节点。
 */
export function asOptionalNode(value: unknown) {
  return value === null || value === undefined ? null : asNode(value)
}

/**
 * 把未知值转换为 AST 节点数组。
 *
 * @param value Acorn 的 body、arguments、properties 等数组字段。
 * @returns 输入不是数组时返回空数组；是数组时逐项校验并返回 AstNode[]。
 */
export function asNodes(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.map(asNode) : []
}

/**
 * 取得节点在源代码中的起始行。
 *
 * @param node 已通过校验的 AST 节点。
 * @returns 从 1 开始的行号；缺少位置信息时安全回退到第 1 行。
 */
export function nodeLine(node: AstNode) {
  const location = node.loc as { start?: { line?: number } } | null | undefined
  return location?.start?.line ?? 1
}

/**
 * 在某个语法节点处中止解释，并保留用户可理解的源码行号。
 *
 * @param node 发现错误的 AST 节点。
 * @param message 面向故事作者的错误原因。
 * @returns 永不返回；never 类型帮助 TypeScript 理解后续分支已终止。
 * @throws 始终抛出 StoryScriptError。
 */
export function fail(node: AstNode, message: string): never {
  throw new StoryScriptError(nodeLine(node), message)
}
