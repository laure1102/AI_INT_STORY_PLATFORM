/**
 * 故事变量、场景、角色、地点、物品、手机、行动和商城等领域文件路由。
 *
 * 每个 PUT 端点遵循同一安全顺序：校验 storyId → 用 Zod 解析 body → 在 expectedRevision 锁内写入
 * 单个领域 → 返回服务端值和新 revision。即使这些数据分属不同 JSON5 文件，也不能绕过并发检查。
 */
import Router from "@koa/router"
import type { StoryFileStore } from "@story-mgr/file-store"
import type {
  StoryDoingResponse,
  StoryItemsResponse,
  StoryPhoneConversationsResponse,
  StoryPhoneResponse,
  StoryPlayerOverrideValsResponse,
  StoryReferResponse,
  StoryRolesResponse,
  StoryShopResponse,
  StorySystemValsResponse
} from "@story-mgr/shared"
import { parseRequestBody, requestSchemas } from "../request"
import { requireParam } from "./story-route-helpers"

/**
 * 创建领域文件处理函数，并让它们共享同一个 File Store。
 *
 * @param store File Store 门面，提供各领域的 Schema 校验和 JSON5 写入。
 * @returns 可直接注册到 Koa Router 的命名处理函数集合。
 */
function createStoryDomainRouteHandlers(store: StoryFileStore) {
  /**
   * 保存普通全局变量 `vals.json5`。
   *
   * @param context path 提供 storyId；body 提供 vals 与 expectedRevision。
   * @returns Promise；响应包含实际写入的 vals 和新 revision。
   * @throws 非法变量结构返回 400，并发版本冲突返回 409。
   */
  async function saveVals(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveVals)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeVals(storyId, body.vals)
    )
    context.body = { vals: result.value, revision: result.revision }
  }

  /**
   * 保存运行时拥有的系统变量定义 `system_vals.json5`。
   *
   * @param context path 提供 storyId；body 提供 systemVals 与 expectedRevision。
   * @returns Promise；响应包含 systemVals 和新 revision。
   * @throws Schema 错误返回 400，revision 冲突返回 409。
   */
  async function saveSystemVals(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveSystemVals)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeSystemVals(storyId, body.systemVals)
    )
    context.body = {
      systemVals: result.value,
      revision: result.revision
    } satisfies StorySystemValsResponse
  }

  /**
   * 保存新建玩家档案时需要填写的变量覆盖配置。
   *
   * @param context body 提供 playerOverrideVals 与 expectedRevision。
   * @returns Promise；响应包含保存后的配置和新 revision。
   * @throws 引用不存在的普通变量等 Schema/业务错误返回 400。
   */
  async function savePlayerOverrideVals(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.savePlayerOverrideVals)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writePlayerOverrideVals(storyId, body.playerOverrideVals)
    )
    context.body = {
      playerOverrideVals: result.value,
      revision: result.revision
    } satisfies StoryPlayerOverrideValsResponse
  }

  /**
   * 保存场景背景配置 `scene.json5`。
   *
   * @param context body 提供 scenes 与 expectedRevision。
   * @returns Promise；响应包含 scenes 和新 revision。
   * @throws 请求体非法或 revision 过期时抛统一 API 错误。
   */
  async function saveScenes(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveScenes)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeScenes(storyId, body.scenes)
    )
    context.body = { scenes: result.value, revision: result.revision }
  }

  /**
   * 保存普通角色与重要角色文件。
   *
   * @param context body 提供聚合 roles 与 expectedRevision。
   * @returns Promise；返回 File Store 分别写入两类角色文件后的聚合值和 revision。
   * @throws 角色 id 重复、字段非法或 revision 冲突时抛错。
   */
  async function saveRoles(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveRoles)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeRoles(storyId, body.roles)
    )
    context.body = {
      roles: result.value,
      revision: result.revision
    } satisfies StoryRolesResponse
  }

  /**
   * 保存事件地点库 `event_location.json5`。
   *
   * @param context body 提供 eventLocations 与 expectedRevision。
   * @returns Promise；响应包含保存后的地点库和新 revision。
   * @throws 地点 id/字段非法或并发冲突时抛错。
   */
  async function saveEventLocations(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveEventLocations)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeEventLocations(storyId, body.eventLocations)
    )
    context.body = { eventLocations: result.value, revision: result.revision }
  }

  /**
   * 保存物品分类和物品资产库 `items.json5`。
   *
   * @param context body 提供 items 与 expectedRevision。
   * @returns Promise；响应包含完整物品库和新 revision。
   * @throws 重复 id、无效 category_id 或 revision 冲突时抛错。
   */
  async function saveItems(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveItems)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeItems(storyId, body.items)
    )
    context.body = {
      items: result.value,
      revision: result.revision
    } satisfies StoryItemsResponse
  }

  /**
   * 保存商城分类和商品货架 `shop.json5`。
   *
   * @param context body 提供 shop 与 expectedRevision。
   * @returns Promise；响应包含保存后的商城和新 revision。
   * @throws 商品引用不存在的物品/分类或版本冲突时抛错。
   */
  async function saveShop(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveShop)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeShop(storyId, body.shop)
    )
    context.body = {
      shop: result.value,
      revision: result.revision
    } satisfies StoryShopResponse
  }

  /**
   * 保存普通手机关系、话术、动作、回复和联系人配置。
   *
   * @param context body 提供 phone 与 expectedRevision。
   * @returns Promise；响应包含 phone 和新 revision。
   * @throws 角色/事件/物品引用非法或 revision 冲突时抛错。
   */
  async function savePhone(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.savePhone)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writePhone(storyId, body.phone)
    )
    context.body = {
      phone: result.value,
      revision: result.revision
    } satisfies StoryPhoneResponse
  }

  /**
   * 读取连续剧情手机对话文件。
   *
   * @param context path 参数 storyId 指定故事。
   * @returns Promise；响应包含 phoneConversations。
   * @throws 故事不存在或文件内容损坏时抛 File Store 错误。
   */
  async function getPhoneConversations(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    context.body = {
      phoneConversations: await store.readPhoneConversations(storyId)
    } satisfies StoryPhoneConversationsResponse
  }

  /**
   * 保存连续剧情手机对话。
   *
   * @param context body 提供 phoneConversations 与 expectedRevision。
   * @returns Promise；返回保存后的对话文件和新 revision。
   * @throws 节点、入口、角色或调用引用非法时拒绝保存。
   */
  async function savePhoneConversations(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.savePhoneConversations)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writePhoneConversations(storyId, body.phoneConversations)
    )
    context.body = {
      phoneConversations: result.value,
      revision: result.revision
    } satisfies StoryPhoneConversationsResponse
  }

  /**
   * 保存性别相关称谓库 `refer.json5`。
   *
   * @param context body 提供 refer 与 expectedRevision。
   * @returns Promise；响应包含保存后的 refer 和新 revision。
   * @throws term id 重复、字段非法或 revision 冲突时抛错。
   */
  async function saveRefer(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveRefer)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeRefer(storyId, body.refer)
    )
    context.body = {
      refer: result.value,
      revision: result.revision
    } satisfies StoryReferResponse
  }

  /**
   * 保存玩家主动行动菜单和行动事件 `doing.json5`。
   *
   * @param context body 提供 doing 与 expectedRevision。
   * @returns Promise；响应包含保存后的 doing 和新 revision。
   * @throws 菜单、地点、角色或 StoryScript 引用非法时拒绝保存。
   */
  async function saveDoing(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.saveDoing)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.writeDoing(storyId, body.doing)
    )
    context.body = {
      doing: result.value,
      revision: result.revision
    } satisfies StoryDoingResponse
  }

  return {
    getPhoneConversations,
    saveDoing,
    saveEventLocations,
    saveItems,
    savePhone,
    savePhoneConversations,
    savePlayerOverrideVals,
    saveRefer,
    saveRoles,
    saveScenes,
    saveShop,
    saveSystemVals,
    saveVals
  }
}

/**
 * 注册故事领域文件端点。
 *
 * @param router Stories 总 Router。
 * @param store File Store 门面。
 * @returns 无返回值；副作用是向 router 添加十三个端点。
 */
export function registerStoryDomainRoutes(router: Router, store: StoryFileStore) {
  const handlers = createStoryDomainRouteHandlers(store)

  router.put("/stories/:storyId/vals", handlers.saveVals)
  router.put("/stories/:storyId/system-vals", handlers.saveSystemVals)
  router.put("/stories/:storyId/player-override-vals", handlers.savePlayerOverrideVals)
  router.put("/stories/:storyId/scenes", handlers.saveScenes)
  router.put("/stories/:storyId/roles", handlers.saveRoles)
  router.put("/stories/:storyId/event-locations", handlers.saveEventLocations)
  router.put("/stories/:storyId/items", handlers.saveItems)
  router.put("/stories/:storyId/shop", handlers.saveShop)
  router.put("/stories/:storyId/phone", handlers.savePhone)
  router.get("/stories/:storyId/phone-conversations", handlers.getPhoneConversations)
  router.put("/stories/:storyId/phone-conversations", handlers.savePhoneConversations)
  router.put("/stories/:storyId/refer", handlers.saveRefer)
  router.put("/stories/:storyId/doing", handlers.saveDoing)
}
