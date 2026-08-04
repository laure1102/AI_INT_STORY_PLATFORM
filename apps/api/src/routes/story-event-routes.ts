/**
 * 单个 chain、pool、schedule 事件的读取、保存和删除路由。
 *
 * 三类事件共用相同 HTTP 路径，通过 collectionType 区分实际文件。旧名称 once/loop 只在读取边界
 * 兼容，传给 File Store 前会统一成 pool/schedule。
 */
import Router from "@koa/router"
import type { StoryFileStore } from "@story-mgr/file-store"
import type { StoryDeleteEventResponse } from "@story-mgr/shared"
import { parseRequestBody, requestSchemas } from "../request"
import {
  normalizeEventCollectionType,
  requireExpectedRevision,
  requireParam
} from "./story-route-helpers"

/**
 * 创建事件路由处理函数。
 *
 * @param store File Store 门面，负责定位正确事件文件并执行写入。
 * @returns 读取、保存、删除三个命名处理函数。
 */
function createStoryEventRouteHandlers(store: StoryFileStore) {
  /**
   * 读取一个事件。
   *
   * @param context Koa 上下文；path 提供 storyId/eventId，query.collectionType 指定事件集合。
   * @returns Promise；通过 `context.body.event` 返回事件。
   * @throws 事件不存在、参数缺失或路径非法时抛统一 File Store 错误。
   */
  async function getEvent(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const eventId = requireParam(context.params.eventId, "eventId")
    const collectionType = normalizeEventCollectionType(context.query.collectionType)
    context.body = {
      event: await store.readEvent(storyId, eventId, collectionType)
    }
  }

  /**
   * 新增或更新一个事件。
   *
   * @param context Koa 上下文；path 中 eventId 是写入目标，body 包含事件、集合和 expectedRevision。
   * @returns Promise；返回服务端规范化后的事件与新 revision。
   * @throws body 不合法返回 400；revision 过期返回 409；事件引用错误由 Store/Core 校验报告。
   *
   * 写操作必须包在 `withStoryMutation` 中，使同一故事串行执行，并防止旧编辑器覆盖新内容。
   */
  async function saveEvent(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const eventId = requireParam(context.params.eventId, "eventId")
    const body = parseRequestBody(context, requestSchemas.saveEvent)

    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeEvent(
        storyId,
        eventId,
        body.event,
        normalizeEventCollectionType(body.collectionType)
      )
    )
    context.body = {
      event: result.value,
      revision: result.revision
    }
  }

  /**
   * 删除一个事件。
   *
   * @param context Koa 上下文；path 提供 storyId/eventId，query 提供 collectionType/expectedRevision。
   * @returns Promise；成功返回 `{ ok: true, revision }`。
   * @throws 缺少 expectedRevision 返回 400；并发冲突返回 409；目标不存在由 File Store 报错。
   */
  async function deleteEvent(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const eventId = requireParam(context.params.eventId, "eventId")
    const collectionType = normalizeEventCollectionType(context.query.collectionType)
    const expectedRevision = requireExpectedRevision(context.query.expectedRevision)

    const result = await store.withStoryMutation(storyId, expectedRevision, () =>
      store.deleteEvent(storyId, eventId, collectionType)
    )

    context.body = {
      ok: true,
      revision: result.revision
    } satisfies StoryDeleteEventResponse
  }

  return { deleteEvent, getEvent, saveEvent }
}

/**
 * 注册三个单事件端点。
 *
 * @param router Stories 总 Router。
 * @param store File Store 门面。
 * @returns 无返回值；只向 router 添加路由。
 */
export function registerStoryEventRoutes(router: Router, store: StoryFileStore) {
  const handlers = createStoryEventRouteHandlers(store)

  router.get("/stories/:storyId/events/:eventId", handlers.getEvent)
  router.put("/stories/:storyId/events/:eventId", handlers.saveEvent)
  router.delete("/stories/:storyId/events/:eventId", handlers.deleteEvent)
}
