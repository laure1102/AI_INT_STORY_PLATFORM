/**
 * HTML 客户端的本地 JSON/JSON5 文件工具。
 *
 * 输入来自档案、存档和编译 bundle 路径；输出写入客户端运行目录。
 * 本模块只处理目录与序列化，不理解故事、档案或存档业务规则。
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import JSON5 from "json5"

/** @param directory 目标目录。 @returns 目录存在后的 Promise；父目录缺失时一并创建。 */
export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
}

/** @param filePath JSON5 文件路径。 @returns 解析后的泛型值。 @throws 文件不存在、读取失败或 JSON5 语法错误时抛错。 */
export async function readJson5File<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8")
  return JSON5.parse(raw) as T
}

/**
 * 读取允许尚未创建的 JSON5 文件。
 * @param filePath 文件路径。 @returns 文件存在时的解析值；仅 ENOENT 返回 null。
 * @throws 文件存在但损坏或无权限时继续抛错，防止把真实故障伪装成“没有数据”。
 */
export async function readOptionalJson5File<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson5File<T>(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }

    throw error
  }
}

/** @param filePath 写入路径。 @param value 可序列化值。 @returns 写入完成的 Promise；自动创建目录并以两空格格式化。 */
export async function writeJson5File(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath))
  await writeFile(filePath, `${JSON5.stringify(value, null, 2)}\n`, "utf8")
}

/** @param filePath 写入路径。 @param value 标准 JSON 可序列化值。 @returns 写入完成的 Promise；自动创建父目录。 */
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath))
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

/** @param filePath 标准 JSON 文件路径。 @returns 解析后的泛型值。 @throws 读取或 JSON 解析失败时抛错。 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8")
  return JSON.parse(raw) as T
}

/**
 * 列出目录中的直接子目录名称。
 * @param directory 目标目录。 @returns 按名称稳定排序的子目录名；目录不存在时返回空数组。
 */
export async function readDirectoryNames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }
}
