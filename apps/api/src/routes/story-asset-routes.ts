/**
 * 故事图片上传、压缩、元数据和二进制文件读取路由。
 *
 * 上传使用 25 MiB 内存上限，真正保存前由 File Store/Sharp 验证图片可解码。所有会产生文件的操作
 * 都携带 expectedRevision；读取端点只返回受路径安全检查保护的故事目录内资产。
 */
import { readFile } from "node:fs/promises"
import Router from "@koa/router"
import { FileStoreError, type StoryFileStore } from "@story-mgr/file-store"
import type { StoryAssetResponse } from "@story-mgr/shared"
import { parseRequestBody, requestSchemas } from "../request"
import {
  requireExpectedRevision,
  requireParam,
  requireQueryString,
  upload
} from "./story-route-helpers"

/**
 * 描述 multer 放入 `context.request.file` 的最小字段。
 *
 * 这里只声明路由实际使用的原始文件名与内存 Buffer，避免把 multer 的全部实现类型扩散到业务代码。
 */
interface UploadedImageRequest {
  file?: {
    originalname?: string
    buffer?: Buffer
  }
}

/**
 * 创建故事资产处理函数。
 *
 * @param store File Store 门面，负责路径安全、图片解码、压缩和文件写入。
 * @returns 压缩、上传和读取资产的命名处理函数集合。
 */
function createStoryAssetRouteHandlers(store: StoryFileStore) {
  /**
   * 从地点原图生成一个压缩版本。
   *
   * @param context body 提供 sourcePath、slot、targetName、quality 和 expectedRevision。
   * @returns Promise；响应包含压缩资产元数据和新 revision。
   * @throws 源路径越界/不存在、质量参数非法、图片解码失败或 revision 冲突时抛错。
   */
  async function compressLocationImage(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.compressLocationImage)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.compressLocationImage(storyId, {
        sourcePath: body.sourcePath,
        slot: body.slot,
        targetName: body.targetName,
        quality: body.quality
      })
    )
    context.body = {
      asset: result.value,
      revision: result.revision
    } satisfies StoryAssetResponse
  }

  /**
   * 从物品原图生成一个压缩版本。
   *
   * @param context body 提供物品源图相对路径、压缩槽位、目标名、质量和 expectedRevision。
   * @returns Promise；返回物品压缩图元数据和新 revision。
   * @throws 路径、图片、参数或并发版本错误。
   */
  async function compressItemImage(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.compressItemImage)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.compressItemImage(storyId, {
        sourcePath: body.sourcePath,
        slot: body.slot,
        targetName: body.targetName,
        quality: body.quality
      })
    )
    context.body = {
      asset: result.value,
      revision: result.revision
    } satisfies StoryAssetResponse
  }

  /**
   * 从角色原图生成一个压缩版本。
   *
   * @param context body 提供角色源图、槽位、目标名、质量和 expectedRevision。
   * @returns Promise；返回压缩后的角色资产元数据和新 revision。
   * @throws 路径穿越、源图不存在、Sharp 失败或 revision 冲突时抛错。
   */
  async function compressRoleImage(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.compressRoleImage)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.compressRoleImage(storyId, {
        sourcePath: body.sourcePath,
        slot: body.slot,
        targetName: body.targetName,
        quality: body.quality
      })
    )
    context.body = {
      asset: result.value,
      revision: result.revision
    } satisfies StoryAssetResponse
  }

  /**
   * 接收 multipart 图片并保存为场景背景原图。
   *
   * @param context path 提供 storyId；multipart `file` 提供图片；表单字段提供 expectedRevision。
   * @returns Promise；响应包含保存后的背景资产元数据和新 revision。
   * @throws 未选择文件返回 400；超过 25 MiB 返回 413；不可解码图片返回 400；冲突返回 409。
   *
   * multer 只负责有上限地读取 Buffer，不能证明文件真是图片；File Store 写入前还会调用 Sharp 解码。
   */
  async function uploadSceneBackground(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const request = context.request as typeof context.request & UploadedImageRequest
    const uploadedFile = request.file
    const expectedRevision = requireExpectedRevision(
      (context.request.body as Record<string, unknown> | undefined)?.expectedRevision
    )

    if (!uploadedFile?.buffer || !uploadedFile.originalname) {
      throw new FileStoreError("Please choose an image file to upload.", 400, "asset.file-required")
    }

    const result = await store.withStoryMutation(storyId, expectedRevision, () =>
      store.writeSceneBackgroundSource(
        storyId,
        uploadedFile.originalname!,
        uploadedFile.buffer!
      )
    )
    context.body = {
      asset: result.value,
      revision: result.revision
    } satisfies StoryAssetResponse
  }

  /**
   * 从背景原图生成指定槽位的压缩图。
   *
   * @param context body 必须符合 `compressSceneBackground` Schema，并包含 expectedRevision。
   * @returns Promise；返回压缩背景元数据和新 revision。
   * @throws 输入、源图片、路径或 revision 错误。
   */
  async function compressSceneBackground(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const body = parseRequestBody(context, requestSchemas.compressSceneBackground)
    const result = await store.withStoryMutation(storyId, body.expectedRevision, () =>
      store.compressSceneBackground(storyId, body)
    )
    context.body = {
      asset: result.value,
      revision: result.revision
    } satisfies StoryAssetResponse
  }

  /**
   * 读取故事资产的 MIME、尺寸和文件大小等元数据。
   *
   * @param context path 提供 storyId；query.path 提供故事目录内相对资产路径。
   * @returns Promise；响应包含 `{ asset }`，不读取整个二进制文件。
   * @throws path 缺失、越出故事目录或文件不存在时抛错。
   */
  async function getAssetMeta(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const assetPath = requireQueryString(context.query.path, "path")
    context.body = {
      asset: await store.readStoryAssetMeta(storyId, assetPath)
    } satisfies StoryAssetResponse
  }

  /**
   * 返回故事资产的原始二进制内容。
   *
   * @param context path 提供 storyId；query.path 提供相对资产路径。
   * @returns Promise；设置 Content-Type、Content-Length 和 Buffer 响应体。
   * @throws 路径越界或文件不存在时抛错。
   *
   * 先通过 `readStoryAssetMeta` 和 `resolveStoryAssetPath` 双重边界确认文件，再读取；`no-store` 防止
   * 编辑器刚覆盖图片后浏览器继续展示旧缓存。
   */
  async function getAssetFile(context: Router.RouterContext) {
    const storyId = requireParam(context.params.storyId, "storyId")
    const assetPath = requireQueryString(context.query.path, "path")
    const asset = await store.readStoryAssetMeta(storyId, assetPath)
    const resolvedPath = store.resolveStoryAssetPath(storyId, assetPath)

    context.set("Cache-Control", "no-store")
    context.type = asset.mimeType
    context.length = asset.sizeBytes
    context.body = await readFile(resolvedPath)
  }

  return {
    compressItemImage,
    compressLocationImage,
    compressRoleImage,
    compressSceneBackground,
    getAssetFile,
    getAssetMeta,
    uploadSceneBackground
  }
}

/**
 * 注册故事资产端点。
 *
 * @param router Stories 总 Router。
 * @param store File Store 门面。
 * @returns 无返回值；添加七个资产端点。
 */
export function registerStoryAssetRoutes(router: Router, store: StoryFileStore) {
  const handlers = createStoryAssetRouteHandlers(store)

  router.post("/stories/:storyId/event-locations/compress", handlers.compressLocationImage)
  router.post("/stories/:storyId/items/compress", handlers.compressItemImage)
  router.post("/stories/:storyId/roles/compress", handlers.compressRoleImage)
  router.post(
    "/stories/:storyId/assets/upload",
    upload.single("file"),
    handlers.uploadSceneBackground
  )
  router.post("/stories/:storyId/assets/compress", handlers.compressSceneBackground)
  router.get("/stories/:storyId/assets/meta", handlers.getAssetMeta)
  router.get("/stories/:storyId/assets/file", handlers.getAssetFile)
}
