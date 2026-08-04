/**
 * API 进程启动入口。
 *
 * 这里读取配置、启动 HTTP 监听，并在收到退出信号时关闭后台 AI 任务和 SQLite。它不定义路由，
 * 也不包含故事业务逻辑；这些内容由 `app.ts` 组合。
 */
import { createApp } from "./app"
import { createApiConfig } from "./config"

const config = createApiConfig()
const app = createApp(config)

/** 无入参、无返回值；端口监听成功后打印地址和实际数据目录。 */
function reportListening(): void {
  console.info(`[api] listening on http://${config.host}:${config.port}`)
  console.info(`[api] data dir: ${config.dataDir}`)
}

const server = app.listen(config.port, config.host, reportListening)

let isShuttingDown = false

/**
 * 收到系统退出信号后执行一次优雅关闭。
 *
 * @param signal Node 传入的 `SIGINT` 或 `SIGTERM`，仅用于日志说明退出原因。
 * @returns 无返回值；关闭流程通过 Server 回调异步完成，最终主动退出进程。
 *
 * 关键顺序：先阻止重复关闭 → 停止接收新连接 → 等待后台服务清理 → 正常退出。另设 5 秒兜底
 * 定时器，避免损坏的连接让进程永久挂住；若关闭失败或超时则使用退出码 1。
 */
function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  console.info(`[api] received ${signal}, shutting down...`)

  /** 无入参、无返回值；优雅关闭超时时记录错误并以失败状态退出。 */
  function forceExitAfterTimeout(): void {
    console.error("[api] graceful shutdown timed out.")
    process.exit(1)
  }

  const forceExitTimer = setTimeout(forceExitAfterTimeout, 5000)
  forceExitTimer.unref()

  /**
   * HTTP Server 停止接收连接后的收尾回调。
   *
   * @param error Node 关闭监听时可能给出的错误。
   * @returns Promise；任务数据库关闭后结束进程。
   */
  async function finishShutdown(error?: Error): Promise<void> {
    clearTimeout(forceExitTimer)

    if (error) {
      console.error("[api] shutdown failed", error)
      process.exit(1)
    }

    await app.closeServices()
    console.info("[api] server closed.")
    process.exit(0)
  }

  server.close(finishShutdown)
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
