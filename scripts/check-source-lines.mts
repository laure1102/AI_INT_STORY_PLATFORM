/**
 * 生产源码物理行数门禁。
 *
 * 脚本只扫描 apps/ 与 packages/ 中会参与产品运行的源码；测试、构建产物和缓存不参与。
 * 500 行起输出提醒，超过 800 行立即失败，促使新增职责进入独立模块。
 */
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const reportThreshold = 500
const failureThreshold = 800
const sourceRoots = ["apps", "packages"]
const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".js",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".vue"
])
const ignoredDirectories = new Set([
  ".nuxt",
  ".output",
  "coverage",
  "dist",
  "node_modules"
])

interface SourceLineResult {
  filePath: string
  lineCount: number
}

function isProductionSource(fileName: string) {
  if (!sourceExtensions.has(path.extname(fileName))) return false
  return !/\.(?:spec|test)\.[^.]+$/u.test(fileName)
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryPath))
    } else if (entry.isFile() && isProductionSource(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

async function countPhysicalLines(filePath: string): Promise<SourceLineResult> {
  const source = await readFile(filePath, "utf8")
  return {
    filePath: path.relative(process.cwd(), filePath).replaceAll(path.sep, "/"),
    lineCount: source.length === 0 ? 0 : source.split(/\r?\n/u).length
  }
}

const sourceFiles = (
  await Promise.all(sourceRoots.map((root) => collectSourceFiles(path.resolve(root))))
).flat()
const results = await Promise.all(sourceFiles.map(countPhysicalLines))
const reports = results
  .filter((result) => result.lineCount >= reportThreshold)
  .sort((left, right) => right.lineCount - left.lineCount || left.filePath.localeCompare(right.filePath))

for (const result of reports) {
  const level = result.lineCount > failureThreshold ? "失败" : "提醒"
  console.log(`[源码行数${level}] ${result.lineCount.toString().padStart(4)}  ${result.filePath}`)
}

const failures = reports.filter((result) => result.lineCount > failureThreshold)
if (failures.length > 0) {
  console.error(`发现 ${failures.length} 个生产源码文件超过 ${failureThreshold} 行。`)
  process.exitCode = 1
} else {
  console.log(`源码行数门禁通过：${sourceFiles.length} 个文件均未超过 ${failureThreshold} 行。`)
}
