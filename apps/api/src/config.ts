/**
 * API 启动配置的读取与安全默认值。
 *
 * 配置从环境变量进入，最终交给 `server.ts`、Koa 中间件、File Store 和 AI 任务服务使用。本模块
 * 只负责解析路径和阻止危险的监听组合，不会启动端口，也不会自行修改环境变量。
 */
import path from "node:path"
import { fileURLToPath } from "node:url"

export interface ApiConfig {
  port: number
  host: string
  corsOrigins: string[]
  accessToken?: string
  dataDir: string
  buildDir: string
  stateDir: string
}

/**
 * 判断监听地址是否只允许本机访问。
 *
 * @param host 即将传给 Node `listen` 的主机名或 IP。
 * @returns `127.0.0.1`、`::1`、`localhost` 返回 true；局域网地址和 `0.0.0.0` 返回 false。
 *
 * 这是安全判断，不是 DNS 查询。项目只把三个明确的本机写法当成可信默认值，避免一个拼写错误
 * 意外把没有鉴权的编辑器暴露到局域网。
 */
function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost"
}

/**
 * 从环境变量构造 API 的完整运行配置。
 *
 * @returns 可直接交给 `createApp` 和 HTTP Server 的 `ApiConfig`。未配置时监听 `127.0.0.1:4000`，
 * CORS 只允许 `http://localhost:3000`，数据、构建和状态目录位于工作区内。
 * @throws 当 host 不是环回地址，但没有同时显式提供允许来源和访问令牌时抛错，阻止服务启动。
 *
 * 关键流程：
 * 1. 以本文件位置反推仓库根目录，避免启动命令所在目录改变默认路径。
 * 2. 读取并清理 Host、CORS 和 Token；空字符串按“未配置”处理。
 * 3. 只要服务可能被其他机器访问，就强制要求三项安全配置都由使用者明确填写。
 * 4. 最后把相对目录解析为绝对路径，让后续路径安全检查有稳定基准。
 */
export function createApiConfig(): ApiConfig {
  const workspaceRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)))
  const host = process.env.STORY_MGR_API_HOST?.trim() || "127.0.0.1"
  const configuredCorsOrigins = process.env.STORY_MGR_CORS_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
  const corsOrigins = configuredCorsOrigins?.length
    ? configuredCorsOrigins
    : ["http://localhost:3000"]
  const accessToken = process.env.STORY_MGR_ACCESS_TOKEN?.trim() || undefined

  if (!isLoopbackHost(host)) {
    if (!process.env.STORY_MGR_API_HOST?.trim()) {
      throw new Error("Non-loopback API listening requires STORY_MGR_API_HOST.")
    }

    if (!configuredCorsOrigins?.length) {
      throw new Error("Non-loopback API listening requires STORY_MGR_CORS_ORIGINS.")
    }

    if (!accessToken) {
      throw new Error("Non-loopback API listening requires STORY_MGR_ACCESS_TOKEN.")
    }
  }

  return {
    port: Number(process.env.STORY_MGR_API_PORT ?? 4000),
    host,
    corsOrigins,
    accessToken,
    dataDir: process.env.STORY_MGR_DATA_DIR
      ? path.resolve(process.env.STORY_MGR_DATA_DIR)
      : path.join(workspaceRoot, "data"),
    buildDir: process.env.STORY_MGR_BUILD_DIR
      ? path.resolve(process.env.STORY_MGR_BUILD_DIR)
      : path.join(workspaceRoot, "build"),
    stateDir: process.env.STORY_MGR_STATE_DIR
      ? path.resolve(process.env.STORY_MGR_STATE_DIR)
      : path.join(workspaceRoot, ".story-manager")
  }
}
