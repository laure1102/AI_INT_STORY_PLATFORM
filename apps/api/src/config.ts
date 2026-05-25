import path from "node:path"
import { fileURLToPath } from "node:url"

export interface ApiConfig {
  port: number
  dataDir: string
  buildDir: string
}

export function createApiConfig(): ApiConfig {
  const workspaceRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)))

  return {
    port: Number(process.env.STORY_MGR_API_PORT ?? 4000),
    dataDir: process.env.STORY_MGR_DATA_DIR
      ? path.resolve(process.env.STORY_MGR_DATA_DIR)
      : path.join(workspaceRoot, "data"),
    buildDir: process.env.STORY_MGR_BUILD_DIR
      ? path.resolve(process.env.STORY_MGR_BUILD_DIR)
      : path.join(workspaceRoot, "build")
  }
}
