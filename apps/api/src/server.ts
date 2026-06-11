import { createApp } from "./app"
import { createApiConfig } from "./config"

const config = createApiConfig()
const app = createApp(config)

const server = app.listen(config.port, () => {
  console.info(`[api] listening on http://localhost:${config.port}`)
  console.info(`[api] data dir: ${config.dataDir}`)
})

let isShuttingDown = false

function shutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  console.info(`[api] received ${signal}, shutting down...`)

  const forceExitTimer = setTimeout(() => {
    console.error("[api] graceful shutdown timed out.")
    process.exit(1)
  }, 5000)
  forceExitTimer.unref()

  server.close((error) => {
    clearTimeout(forceExitTimer)

    if (error) {
      console.error("[api] shutdown failed", error)
      process.exit(1)
    }

    console.info("[api] server closed.")
    process.exit(0)
  })
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
