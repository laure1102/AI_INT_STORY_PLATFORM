/**
 * Story API 的兼容入口。
 *
 * 页面仍然只需要调用 `useStoryApi()`；真正的请求按领域放在 `story-api/` 下，
 * 这样故事文档、事件、素材和 AI 创作互不混杂，也便于初学者逐块阅读。
 */
import { createStoryApiContext } from "./story-api/context"
import { createStoryAssetApi } from "./story-api/assets"
import { createStoryCreationApi } from "./story-api/creation"
import { createStoryEventApi } from "./story-api/events"
import { createStoryDocumentApi } from "./story-api/stories"
import { createStorySettingsApi } from "./story-api/settings"

/**
 * 创建当前页面使用的 Story Manager HTTP 客户端。
 *
 * 所有写请求共享同一个故事修订号和串行队列，因此拆分模块后仍不会发生
 * “后打开的旧弹窗覆盖新内容”的并发保存问题。
 */
export function useStoryApi() {
  const context = createStoryApiContext()

  return {
    ...createStoryDocumentApi(context),
    ...createStoryEventApi(context),
    ...createStoryAssetApi(context),
    ...createStoryCreationApi(context),
    ...createStorySettingsApi(context)
  }
}
