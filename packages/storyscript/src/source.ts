/**
 * StoryScript 源码预处理与 Acorn 解析。
 *
 * 本模块只负责去除注释、转换 invoke_once、替换占位符并缓存 AST；
 * 它不会读取故事变量，也不会执行任何表达式。
 */
import { parse } from "acorn"
import { StoryScriptError, type AstNode, type PlaceholderBinding } from "./types"

export const INTERNAL_INVOKE = "__story_invoke_once"
export const LEGACY_PLACEHOLDER = /(?<!\$)\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\}/
export const TEMPLATE_PLACEHOLDER = /\$\{([^{}]*)\}/g

const parsedProgramCache = new Map<string, AstNode>()
const MAX_PARSE_CACHE_SIZE = 500

/**
 * 用 Acorn 把预处理后的 StoryScript 解析成 AST，并缓存重复源码。
 *
 * @param source 已去除注释、转换 invoke、替换占位符的 JavaScript 子集源码。
 * @returns Acorn Program 节点；相同 source 会直接复用只读 AST。
 * @throws 语法错误转换成带 1-based 行号的 StoryScriptError。
 *
 * 缓存最多保存 500 条。达到上限时删除 Map 中最早插入的键，避免编辑器长时间运行后无限占内存。
 */
export function parseProgram(source: string) {
  const cached = parsedProgramCache.get(source)
  if (cached) {
    return cached
  }

  try {
    const program = parse(source, {
      ecmaVersion: "latest",
      locations: true,
      sourceType: "script",
      allowReturnOutsideFunction: true
    }) as unknown as AstNode
    if (parsedProgramCache.size >= MAX_PARSE_CACHE_SIZE) {
      const oldestKey = parsedProgramCache.keys().next().value
      if (typeof oldestKey === "string") {
        parsedProgramCache.delete(oldestKey)
      }
    }
    parsedProgramCache.set(source, program)
    return program
  } catch (error) {
    const syntaxError = error as SyntaxError & { loc?: { line?: number } }
    throw new StoryScriptError(syntaxError.loc?.line ?? 1, syntaxError.message)
  }
}

/**
 * 把字符串索引转换为从 1 开始的源码行号。
 *
 * @param source 完整源码。
 * @param index 错误字符在 source 中的零基索引。
 * @returns index 之前换行数加一；负数按 0 处理。
 */
export function sourceLine(source: string, index: number) {
  return source.slice(0, Math.max(0, index)).split(/\r?\n/).length
}

/**
 * 用等长空白替换行注释和块注释，同时保留换行位置。
 *
 * @param source 原始 StoryScript。
 * @returns 去除注释后的源码，字符/行位置仍可用于错误定位。
 * @throws 块注释没有 `*\/` 时在注释起始行抛 StoryScriptError。
 *
 * 算法逐字符维护引号和转义状态，所以字符串里的 `//`、`/*` 不会被误删。
 */
export function stripComments(source: string) {
  let result = ""
  let index = 0
  let quote: "'" | '"' | "`" | null = null
  let escaping = false
  while (index < source.length) {
    const char = source[index] ?? ""
    const next = source[index + 1] ?? ""
    if (quote) {
      result += char
      if (escaping) escaping = false
      else if (char === "\\") escaping = true
      else if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char
      result += char
      index += 1
      continue
    }
    if (char === "/" && next === "/") {
      result += "  "
      index += 2
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") {
        result += " "
        index += 1
      }
      continue
    }
    if (char === "/" && next === "*") {
      const line = sourceLine(source, index)
      result += "  "
      index += 2
      let closed = false
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          result += "  "
          index += 2
          closed = true
          break
        }
        result += source[index] === "\n" || source[index] === "\r" ? source[index] : " "
        index += 1
      }
      if (!closed) throw new StoryScriptError(line, "Unterminated StoryScript block comment.")
      continue
    }
    result += char
    index += 1
  }
  return result
}

/**
 * 拆分 `invoke_once` 行尾的 `name=expression` 参数。
 *
 * @param source 事件 id 之后的参数文本。
 * @param lineNumber 当前源码行，供错误提示使用。
 * @returns 保持声明顺序的参数名和表达式数组。
 * @throws 参数名、等号或表达式缺失时抛错。
 *
 * 括号深度和引号状态用于判断空格究竟属于表达式，还是下一个参数的分隔符。
 */
function splitInvokeArguments(source: string, lineNumber: number) {
  const args: Array<{ name: string; expression: string }> = []
  let index = 0
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index += 1
    if (index >= source.length) break
    const name = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0]
    if (!name) throw new StoryScriptError(lineNumber, "invoke_once argument name is invalid.")
    index += name.length
    while (/\s/.test(source[index] ?? "")) index += 1
    if (source[index] !== "=") throw new StoryScriptError(lineNumber, `invoke_once argument "${name}" must use name=expression.`)
    index += 1
    const start = index
    let depth = 0
    let quote: string | null = null
    let escaping = false
    while (index < source.length) {
      const char = source[index] ?? ""
      if (quote) {
        if (escaping) escaping = false
        else if (char === "\\") escaping = true
        else if (char === quote) quote = null
        index += 1
        continue
      }
      if (char === "'" || char === '"' || char === "`") quote = char
      else if ("([{ ".trim().includes(char)) depth += 1
      else if (")] }".replace(/ /g, "").includes(char)) depth = Math.max(0, depth - 1)
      else if (/\s/.test(char) && depth === 0 && /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(source.slice(index).trimStart())) break
      index += 1
    }
    const expression = source.slice(start, index).trim()
    if (!expression) throw new StoryScriptError(lineNumber, `invoke_once argument "${name}" is missing its expression.`)
    args.push({ name, expression })
  }
  return args
}

/**
 * 把 StoryScript 专用的 `invoke_once` 行转换成内部白名单函数调用。
 *
 * @param source 已去除注释的多行源码。
 * @returns 行数不变的源码；非 invoke 行原样保留。
 *
 * 目标类型和事件 id 通过 JSON.stringify 编码，参数表达式仍交给 Acorn 解析，避免字符串拼接注入。
 */
function transformInvokeStatements(source: string) {
  return source.split(/\r?\n/).map((line, index) => {
    const match = line.match(/^(\s*)invoke_once\s+(chain|pool|schedule|once|graph|loop)\s+([A-Za-z0-9_\-:.]+)(?:\s+(.+?))?\s*$/)
    if (!match) return line
    const args = splitInvokeArguments(match[4] ?? "", index + 1)
    const object = args.length ? `{ ${args.map((arg) => `${arg.name}: (${arg.expression})`).join(", ")} }` : "{}"
    return `${match[1] ?? ""}${INTERNAL_INVOKE}(${JSON.stringify(match[2])}, ${JSON.stringify(match[3])}, ${object});`
  }).join("\n")
}

/**
 * 完成 StoryScript 进入 Acorn 前的全部预处理。
 *
 * @param source 用户编写的原始脚本。
 * @returns `compiled` 安全源码和标识符到变量 token 的 bindings。
 * @throws 旧式 `{group.row}` 或不合法 `${...}` 占位符会立即报错。
 *
 * `${group.row}` 不能直接作为 JavaScript 标识符，因此先替换为 `__story_ref_N`；解释器求值时再按
 * bindings 读取真实变量。这既保留简洁语法，也避免直接改写字符串值。
 */
export function compileSource(source: string) {
  const transformed = transformInvokeStatements(stripComments(source))
  const legacy = LEGACY_PLACEHOLDER.exec(transformed)
  if (legacy) {
    throw new StoryScriptError(sourceLine(transformed, legacy.index), `StoryScript variable references must use \${...}. Found legacy placeholder "${legacy[0]}".`)
  }
  const bindings: PlaceholderBinding[] = []
  const compiled = transformed.replace(/\$\{([^{}]+)\}/g, (_match, tokenText: string) => {
    const token = tokenText.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(token)) {
      throw new Error(`Invalid placeholder: \${${token}}`)
    }
    const identifier = `__story_ref_${bindings.length}`
    bindings.push({ identifier, token })
    return identifier
  })
  return { compiled, bindings }
}
