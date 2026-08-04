/**
 * API 请求体的运行时校验入口。
 *
 * 浏览器发来的 JSON 在 TypeScript 看来只是 `unknown`：即使前端类型写得完全正确，用户仍可以用
 * curl、旧版本页面或损坏的缓存发送任意内容。本模块用 Zod 在数据进入路由业务逻辑之前检查它，
 * 成功后把可信数据交给 File Store 或 AI 服务，失败则由 `app.ts` 统一转换成带字段路径的 400 响应。
 *
 * 本模块只负责“请求长什么样”，不负责读取故事、检查 revision 是否最新，也不负责写文件。
 */
import type Koa from "koa"
import { z } from "zod"
import {
  appSettingsSchema,
  storyActionSchema,
  storyBibleSchema,
  storyDoingSchema,
  storyEventLocationSchema,
  storyEventSchema,
  storyItemsSchema,
  storyLoopEventSchema,
  storyMetaSchema,
  storyOnceEventSchema,
  storyPhoneConversationsSchema,
  storyPhoneSchema,
  storyPlayerOverrideValsSchema,
  storyReferSchema,
  storyRolesSchema,
  storySceneSchema,
  storyShopSchema,
  storyValsSchema
} from "@story-mgr/core"
import { storyCreationDraftSchema } from "./services/story-creation"

// 下面是多个请求会复用的小规则。先把它们集中命名，可以避免同一字段在不同端点出现不同限制。
const eventCollectionTypeSchema = z.enum(["chain", "pool", "schedule", "graph", "once", "loop"])
const storyAnyEventSchema = z.union([
  storyLoopEventSchema,
  storyOnceEventSchema,
  storyActionSchema,
  storyEventSchema
])
const nonEmptyString = z.string().trim().min(1)
const optionalStoryTitle = z.string().optional()
const imageSize = z.number().int().min(1).max(8192)
const imageQuality = z.number().min(1).max(100)
const imageSlot = z.union([z.literal(1), z.literal(2)])
const expectedRevision = z.number().int().min(0)

/** AI 草稿应用时允许用户逐项勾选的内容；未勾选的数据不会写入故事。 */
const creationSelectionSchema = z.object({
  eventKeys: z.array(z.string()),
  locationIds: z.array(z.string()),
  roleKeys: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
  phonePersonalityIds: z.array(z.string()).optional(),
  phoneTalkIds: z.array(z.string()).optional(),
  phoneActionIds: z.array(z.string()).optional(),
  phoneReplyIds: z.array(z.string()).optional(),
  phoneContactProfileKeys: z.array(z.string()).optional(),
  phoneConversationIds: z.array(z.string()).optional(),
  doingMenuIds: z.array(z.string()).optional(),
  doingIds: z.array(z.string()).optional(),
  shopCategoryIds: z.array(z.string()).optional(),
  shopProductIds: z.array(z.string()).optional(),
  roleIds: z.array(z.string()).optional(),
  variableKeys: z.array(z.string()).optional(),
  variables: z.array(z.string()).optional()
})

/** 六个创作 Agent 返回给界面展示的简短过程日志。 */
const creationAgentLogSchema = z.object({
  role: z.enum([
    "chiefEditor",
    "plotPlanner",
    "assetDesigner",
    "eventWriter",
    "scriptDoctor",
    "consistencyChecker"
  ]),
  title: z.string(),
  summary: z.string()
})

/** 旧版同步创作接口的一次完整返回：候选草稿加 Agent 日志。 */
const creationAgentResponseSchema = z.object({
  draft: storyCreationDraftSchema,
  logs: z.array(creationAgentLogSchema)
})

/** 一次创作会话中的单轮指令，用于恢复“继续修改草稿”的聊天历史。 */
const creationHistoryTurnSchema = z.object({
  id: nonEmptyString,
  mode: z.enum(["new", "feedback"]),
  instruction: z.string(),
  status: z.enum(["running", "done", "failed", "cancelled"]),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  response: creationAgentResponseSchema.optional()
})

/** 一个完整创作会话，包含多轮指令、当前草稿以及最终应用结果。 */
const creationHistorySessionSchema = z.object({
  id: nonEmptyString,
  title: z.string(),
  status: z.enum(["running", "draft", "applied", "failed", "cancelled"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  initialInstruction: z.string(),
  turns: z.array(creationHistoryTurnSchema),
  currentDraft: storyCreationDraftSchema.optional(),
  applied: z.object({
    appliedAt: z.string(),
    message: z.string(),
    selection: creationSelectionSchema,
    applied: z.object({
      events: z.number().int().min(0),
      locations: z.number().int().min(0),
      roles: z.number().int().min(0),
      items: z.number().int().min(0),
      variables: z.number().int().min(0),
      phonePersonalities: z.number().int().min(0),
      phoneTalks: z.number().int().min(0),
      phoneActions: z.number().int().min(0),
      phoneReplies: z.number().int().min(0),
      phoneContactProfiles: z.number().int().min(0),
      phoneConversations: z.number().int().min(0),
      doingMenus: z.number().int().min(0),
      doings: z.number().int().min(0),
      shopCategories: z.number().int().min(0),
      shopProducts: z.number().int().min(0)
    }),
    warnings: z.array(z.string()),
    draft: storyCreationDraftSchema
  }).optional()
})

/** 三类资产压缩接口共享的字段限制。 */
const sourceCompressionSchema = z.object({
  expectedRevision,
  sourcePath: nonEmptyString,
  targetName: nonEmptyString,
  quality: imageQuality,
  slot: imageSlot
})

/** 三类 AI 图片生成接口共享的尺寸、提示词和写入目标。 */
const generatedImageSchema = z.object({
  expectedRevision,
  globalPrompt: z.string(),
  width: imageSize,
  height: imageSize,
  prompt: nonEmptyString,
  targetName: nonEmptyString
})

/**
 * 所有 JSON 请求体的 Schema 字典。
 *
 * 路由通过 `requestSchemas.端点名称` 取得对应规则，再交给 `parseRequestBody`。这里是 HTTP 输入的
 * 单一入口：新增请求字段时应先修改这里，再在处理函数中使用解析结果。这样业务函数永远不会直接
 * 信任 `context.request.body`。
 */
export const requestSchemas = {
  // 创建故事：id 同时会成为目录名，所以只允许字母、数字、下划线和短横线。
  createStory: z.object({
    id: nonEmptyString.regex(/^[A-Za-z0-9_-]+$/),
    title: nonEmptyString,
    description: z.string().optional(),
    tags: z.array(z.string()).optional()
  }),
  // 应用设置不属于某一个故事，因此不需要 expectedRevision。
  saveAppSettings: z.object({ settings: appSettingsSchema }),
  // 下列故事写操作都要求客户端携带它最后看到的 revision，用于发现并发覆盖。
  saveStoryMeta: z.object({ story: storyMetaSchema, expectedRevision }),
  saveStoryBible: z.object({ storyBible: storyBibleSchema, expectedRevision }),
  runStoryCreationAgent: z.object({
    instruction: nonEmptyString,
    baseDraft: storyCreationDraftSchema.optional()
  }),
  // 草稿和 selection 分开传入：AI 只能提出候选内容，用户选择后才允许应用。
  applyStoryCreationDraft: z.object({
    draft: storyCreationDraftSchema,
    selection: creationSelectionSchema,
    expectedRevision
  }),
  // 单事件对白生成只返回候选对白，不会直接保存该事件。
  generateStoryDialogue: z.object({
    collectionType: eventCollectionTypeSchema,
    event: z.union([storyLoopEventSchema, storyOnceEventSchema, storyEventSchema]),
    instruction: z.string()
  }),
  // 编辑器自己的创作历史仍属于故事数据，所以保存时也受 revision 保护。
  saveCreationHistorySession: z.object({
    session: creationHistorySessionSchema,
    expectedRevision
  }),
  // eventId 位于 URL 中，body 中的 event 是服务端最终要校验和写入的事件内容。
  saveEvent: z.object({
    collectionType: eventCollectionTypeSchema,
    event: storyAnyEventSchema,
    expectedRevision
  }),
  saveVals: z.object({ vals: storyValsSchema, expectedRevision }),
  saveSystemVals: z.object({ systemVals: storyValsSchema, expectedRevision }),
  savePlayerOverrideVals: z.object({
    playerOverrideVals: storyPlayerOverrideValsSchema,
    expectedRevision
  }),
  saveScenes: z.object({ scenes: storySceneSchema, expectedRevision }),
  saveRoles: z.object({ roles: storyRolesSchema, expectedRevision }),
  saveEventLocations: z.object({ eventLocations: storyEventLocationSchema, expectedRevision }),
  saveItems: z.object({ items: storyItemsSchema, expectedRevision }),
  saveShop: z.object({ shop: storyShopSchema, expectedRevision }),
  savePhone: z.object({ phone: storyPhoneSchema, expectedRevision }),
  savePhoneConversations: z.object({
    phoneConversations: storyPhoneConversationsSchema,
    expectedRevision
  }),
  saveRefer: z.object({ refer: storyReferSchema, expectedRevision }),
  saveDoing: z.object({ doing: storyDoingSchema, expectedRevision }),
  // 提示词生成只调用文本模型，不写故事，因此这些请求不需要 revision。
  generateLocationPrompt: z.object({
    descr: z.string(),
    locationName: nonEmptyString,
    storyTitle: optionalStoryTitle
  }),
  generateItemPrompt: z.object({
    categoryName: z.string(),
    descr: z.string(),
    itemName: nonEmptyString,
    storyTitle: optionalStoryTitle
  }),
  generateRolePrompt: z.object({
    descr: z.string(),
    gender: z.enum(["common", "male", "female"]),
    important: z.boolean(),
    qufenXingbie: z.boolean(),
    roleName: nonEmptyString,
    storyTitle: optionalStoryTitle,
    xingge: z.string().optional()
  }),
  // 图片生成和压缩会落盘，所以必须携带 expectedRevision。
  generateLocationImage: generatedImageSchema,
  generateItemImage: generatedImageSchema,
  generateRoleImage: generatedImageSchema.extend({
    gender: z.enum(["common", "male", "female"])
  }),
  compressLocationImage: sourceCompressionSchema,
  compressItemImage: sourceCompressionSchema,
  compressRoleImage: sourceCompressionSchema,
  compressSceneBackground: z.object({
    expectedRevision,
    sourcePath: nonEmptyString,
    level: z.number().int().min(1),
    variant: z.enum(["day", "night"]),
    quality: imageQuality
  })
} as const

/**
 * 校验并返回当前请求的 JSON body。
 *
 * @param context Koa 请求上下文。`koa-bodyparser` 已把原始 JSON 放在 `context.request.body` 中。
 * @param schema 当前路由指定的 Zod Schema，决定允许哪些字段以及各字段的类型和范围。
 * @returns 经过 Schema 解析后的新值；返回类型由传入 Schema 自动推导，后续代码可以安全读取字段。
 * @throws `ZodError` 当字段缺失、类型错误或数值越界时抛出；`app.ts` 会把它转换为 HTTP 400，
 * 并在 `details` 中告诉前端具体是哪一个字段出错。
 *
 * 这里必须调用 `schema.parse`，不能写成 `context.request.body as 某类型`。`as` 只会让编译器暂时
 * 相信开发者，并不会检查真实网络数据；Zod 才会在程序运行时真正拦住非法输入。
 */
export function parseRequestBody<TSchema extends z.ZodTypeAny>(
  context: Koa.Context,
  schema: TSchema
): z.output<TSchema> {
  return schema.parse(context.request.body)
}
