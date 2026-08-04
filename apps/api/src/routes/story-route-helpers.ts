/**
 * Stories Router 共用的 path/query 参数和上传边界。
 *
 * 浏览器传来的 path、query、multipart 都是不可信输入。路由处理器先在这里把它们转换成确定类型，
 * 后面的 File Store 和领域服务就不需要到处重复 `undefined` 判断。
 */
import multer from "@koa/multer"
import type { StoryEventCollectionType } from "@story-mgr/core"
import { FileStoreError } from "@story-mgr/file-store"

/**
 * 单图片上传中间件。
 *
 * 文件暂存在内存，最多一个且不超过 25 MiB；超过限制由全局错误层转换为 413。这个限制只保护
 * 请求内存，不能证明内容是图片，File Store 仍会用 Sharp 解码后才允许保存。
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1
  }
})

/**
 * 读取必填路由参数。
 *
 * @param value Koa `context.params` 中可能缺失的原始值。
 * @param name 用于错误信息的参数名，例如 storyId。
 * @returns 已确认存在的字符串。
 * @throws 值为空时抛 400 `route.missing-param`。
 */
export function requireParam(value: string | undefined, name: string) {
  if (!value) {
    throw new FileStoreError(`Missing route parameter "${name}".`, 400, "route.missing-param")
  }

  return value
}

/**
 * 读取必填 query 字符串。
 *
 * @param value Koa query 中类型仍为 unknown 的值。
 * @param name 用于错误信息的 query 名称。
 * @returns 非空字符串；保留原文本，由后续路径工具继续执行安全解析。
 * @throws 不是字符串或只有空白时抛 400 `route.missing-query`。
 */
export function requireQueryString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FileStoreError(`Missing query parameter "${name}".`, 400, "route.missing-query")
  }

  return value
}

/**
 * 解析所有修改请求必须携带的 expectedRevision。
 *
 * @param value JSON body 中的 number，或 query/form 中的数字字符串。
 * @returns 非负整数 revision。
 * @throws 缺失、负数、小数或非数字时抛 400 `revision.expected-required`。
 *
 * 这里只验证格式；是否与服务端当前 revision 一致由 `withStoryMutation` 在故事锁内判断。
 */
export function requireExpectedRevision(value: unknown) {
  const revision = typeof value === "string" ? Number(value) : value
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    throw new FileStoreError(
      "A non-negative expectedRevision is required.",
      400,
      "revision.expected-required"
    )
  }

  return Number(revision)
}

/**
 * 把事件集合名称统一成当前内部契约。
 *
 * @param value body/query 中的 collectionType。
 * @returns chain、pool 或 schedule；旧 once 映射到 pool，旧 loop 映射到 schedule，缺失默认 chain。
 *
 * 兼容只发生在 HTTP 读取边界，File Store 和新写出数据不会继续传播 once/loop 旧名称。
 */
export function normalizeEventCollectionType(value: unknown): StoryEventCollectionType {
  if (value === "pool" || value === "schedule" || value === "chain") {
    return value
  }

  if (value === "once") {
    return "pool"
  }

  if (value === "loop") {
    return "schedule"
  }

  return "chain"
}
