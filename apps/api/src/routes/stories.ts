/**
 * Stories API 的总装配入口。
 *
 * 这个文件不再直接处理几十个 HTTP 请求。它只创建带 `/api` 前缀的 Router，并按领域注册故事文档、
 * AI 创作、事件、配置数据、资产、校验和导出路由。真正的请求参数、响应和失败处理都在对应模块的
 * 命名函数中，并为每个函数提供面向初学者的 JSDoc。
 */
import Router from "@koa/router"
import type { StoryFileStore } from "@story-mgr/file-store"
import type { ApiConfig } from "../config"
import type { StoryCreationJobService } from "../services/story-creation-jobs"
import { registerStoryAiAssetRoutes } from "./story-ai-asset-routes"
import { registerStoryAssetRoutes } from "./story-asset-routes"
import { registerStoryCreationRoutes } from "./story-creation-routes"
import { registerStoryDocumentRoutes } from "./story-document-routes"
import { registerStoryDomainRoutes } from "./story-domain-routes"
import { registerStoryEventRoutes } from "./story-event-routes"
import { registerStoryValidationRoutes } from "./story-validation-routes"

/**
 * 创建 Stories API Router，并安装全部故事相关端点。
 *
 * @param store File Store 门面。所有故事读取、revision 检查和事务写入都从这里进入。
 * @param config API 运行配置。路由主要使用数据目录和编译输出目录。
 * @param creationJobs 可恢复 AI 创作任务服务，负责 job 查询、取消和 SSE 订阅。
 * @returns 已注册全部 `/api/...` 路径的 Koa Router；调用方继续把它挂到 Koa 应用。
 *
 * 关键逻辑：注册顺序按“基础文档 → AI → 事件 → 领域数据 → 资产 → 校验导出”排列，方便阅读。
 * 各路径互不重叠，因此拆分不会改变 Koa 的匹配结果或现有 HTTP 契约。
 */
export function createStoriesRouter(
  store: StoryFileStore,
  config: ApiConfig,
  creationJobs: StoryCreationJobService
) {
  const router = new Router({ prefix: "/api" })

  registerStoryDocumentRoutes(router, store)
  registerStoryCreationRoutes(router, store, config, creationJobs)
  registerStoryEventRoutes(router, store)
  registerStoryDomainRoutes(router, store)
  registerStoryAiAssetRoutes(router, store)
  registerStoryAssetRoutes(router, store)
  registerStoryValidationRoutes(router, store, config)

  return router
}
