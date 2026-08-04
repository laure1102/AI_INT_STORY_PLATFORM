/**
 * 故事全量校验和 Runtime bundle 导出路由。
 *
 * 校验只读取故事并返回 issues；导出会编译完整 StoryDocument，并把结果写到配置的 build 目录。
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import Router from "@koa/router"
import { compileStory } from "@story-mgr/compiler"
import { validateStoryDocument } from "@story-mgr/core"
import type { StoryFileStore } from "@story-mgr/file-store"
import type { ApiConfig } from "../config"
import { requireParam } from "./story-route-helpers"

/**
 * 创建校验和导出处理函数。
 *
 * @param store File Store 门面，用于读取统一 StoryDocument。
 * @param config API 配置，导出函数使用其中的 buildDir。
 * @returns 两个命名处理函数。
 */
function createStoryValidationRouteHandlers(store: StoryFileStore, config: ApiConfig) {
  /**
   * 对当前故事执行 Core 全量校验。
   *
   * @param context path 参数 storyId 指定故事。
   * @returns Promise；响应 `{ result }` 包含 error/warning issues，不修改故事。
   * @throws 故事读取或 Schema 解析失败时抛 File Store 错误。
   */
  async function validateStory(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const story = await store.readStoryDocument(storyId)
    context.body = {
      result: validateStoryDocument(story)
    }
  }

  /**
   * 编译故事并把 Runtime bundle 写入 build 目录。
   *
   * @param context path 参数 storyId 指定故事。
   * @returns Promise；响应包含 compiled bundle、编译校验结果和 outputPath。
   * @throws 故事读取、编译或文件写入失败时抛错。
   *
   * 关键步骤：读取聚合文档 → Compiler 生成稳定 contentHash 的 bundle → 创建输出目录 → 以格式化
   * JSON 写盘。导出文件不属于故事源数据，不增加故事 revision。
   */
  async function exportStory(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const story = await store.readStoryDocument(storyId)
    const { compiled, result } = compileStory(story)
    const outputPath = path.join(config.buildDir, "stories", `${storyId}.json`)

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(compiled, null, 2)}\n`, "utf8")

    context.body = { compiled, result, outputPath }
  }

  return { exportStory, validateStory }
}

/**
 * 注册故事校验和导出端点。
 *
 * @param router Stories 总 Router。
 * @param store File Store 门面。
 * @param config API 配置。
 * @returns 无返回值；添加两个 POST 端点。
 */
export function registerStoryValidationRoutes(
  router: Router,
  store: StoryFileStore,
  config: ApiConfig
) {
  const handlers = createStoryValidationRouteHandlers(store, config)
  router.post("/stories/:storyId/validate", handlers.validateStory)
  router.post("/stories/:storyId/export", handlers.exportStory)
}
