import { createApp } from "./app"
import { createApiConfig } from "./config"

const config = createApiConfig()
const app = createApp(config)

app.listen(config.port, () => {
  console.info(`[api] listening on http://localhost:${config.port}`)
  console.info(`[api] data dir: ${config.dataDir}`)
})
