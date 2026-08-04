/**
 * 生产源码函数注释门禁。
 *
 * 扫描 apps/ 与 packages/ 中的 TypeScript、JavaScript 和 Vue `<script setup>`，要求每个命名函数、
 * 构造器、对象方法及赋给变量的箭头函数前都有 JSDoc。测试、构建产物和依赖目录不参与门禁。
 */
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"

const sourceRoots = ["apps", "packages"]
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx", ".vue"])
const ignoredDirectories = new Set([".nuxt", ".output", "coverage", "dist", "node_modules"])

interface ParsedSource {
  filePath: string
  lineOffset: number
  source: string
  sourceFile: ts.SourceFile
}

interface MissingComment {
  filePath: string
  functionName: string
  line: number
}

/** @param fileName 候选文件名。 @returns 是否属于非测试的生产脚本源码。 */
function isProductionScript(fileName: string): boolean {
  if (!sourceExtensions.has(path.extname(fileName))) return false
  return !/\.(?:spec|test)\.[^.]+$/u.test(fileName)
}

/**
 * 递归收集生产脚本文件。
 * @param directory 当前扫描目录。 @returns 当前目录树下的源码绝对路径。
 */
async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryPath))
    } else if (entry.isFile() && isProductionScript(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

/**
 * 提取可交给 TypeScript AST 的脚本内容。
 * @param filePath 源码路径。 @returns 普通文件全文，或 Vue `<script setup>` 内容及其行号偏移；没有脚本的 Vue 返回 null。
 */
async function parseSource(filePath: string): Promise<ParsedSource | null> {
  const completeSource = await readFile(filePath, "utf8")
  let source = completeSource
  let lineOffset = 0

  if (path.extname(filePath) === ".vue") {
    const scriptMatch = /<script\s+setup(?:\s+lang=["']ts["'])?\s*>([\s\S]*?)<\/script>/iu.exec(completeSource)
    if (!scriptMatch) return null
    source = scriptMatch[1] ?? ""
    const scriptStart = scriptMatch.index + scriptMatch[0].indexOf(source)
    lineOffset = completeSource.slice(0, scriptStart).split(/\r?\n/u).length - 1
  }

  const extension = path.extname(filePath)
  const scriptKind = [".js", ".jsx", ".mjs", ".cjs"].includes(extension)
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS

  return {
    filePath,
    lineOffset,
    source,
    sourceFile: ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind)
  }
}

/**
 * 取得门禁需要检查的函数名称和 JSDoc 挂载节点。
 * @param node 当前 AST 节点。 @param sourceFile 所属源码。 @returns 非命名函数为 null，否则返回名称和注释目标节点。
 */
function getNamedFunction(
  node: ts.Node,
  sourceFile: ts.SourceFile
): { functionName: string; commentTarget: ts.Node } | null {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return { functionName: node.name.text, commentTarget: node }
  }
  if (ts.isMethodDeclaration(node)) {
    return { functionName: node.name.getText(sourceFile), commentTarget: node }
  }
  if (ts.isConstructorDeclaration(node)) {
    return { functionName: "constructor", commentTarget: node }
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    && ts.isVariableDeclaration(node.parent)
    && ts.isIdentifier(node.parent.name)
  ) {
    return {
      functionName: node.parent.name.text,
      commentTarget: node.parent.parent.parent
    }
  }
  return null
}

/** @param parsed 已解析源码。 @returns 缺少 JSDoc 的函数位置列表。 */
function findMissingComments(parsed: ParsedSource): MissingComment[] {
  const missing: MissingComment[] = []

  /** @param node 当前 AST 节点。 @returns 无返回值；递归收集缺口。 */
  function visit(node: ts.Node): void {
    const namedFunction = getNamedFunction(node, parsed.sourceFile)

    if (namedFunction) {
      const commentRanges = ts.getLeadingCommentRanges(
        parsed.source,
        namedFunction.commentTarget.getFullStart()
      ) ?? []
      const hasJsDoc = commentRanges.some((range) =>
        parsed.source.slice(range.pos, range.end).startsWith("/**")
      )

      if (!hasJsDoc) {
        const location = parsed.sourceFile.getLineAndCharacterOfPosition(node.getStart(parsed.sourceFile))
        missing.push({
          filePath: parsed.filePath,
          functionName: namedFunction.functionName,
          line: location.line + 1 + parsed.lineOffset
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(parsed.sourceFile)
  return missing
}

const sourceFiles = (
  await Promise.all(sourceRoots.map((root) => collectSourceFiles(path.resolve(root))))
).flat()
const parsedSources = (await Promise.all(sourceFiles.map(parseSource))).filter(
  (source): source is ParsedSource => source !== null
)
const missingComments = parsedSources.flatMap(findMissingComments)

for (const missing of missingComments) {
  const relativePath = path.relative(process.cwd(), missing.filePath).replaceAll(path.sep, "/")
  console.error(`[函数注释缺失] ${relativePath}:${missing.line} ${missing.functionName}`)
}

if (missingComments.length > 0) {
  console.error(`发现 ${missingComments.length} 个生产函数缺少 JSDoc。`)
  process.exitCode = 1
} else {
  console.log(`函数注释门禁通过：${parsedSources.length} 个生产源码文件没有注释缺口。`)
}
