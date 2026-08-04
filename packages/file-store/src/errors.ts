/**
 * File Store 的统一错误类型。
 *
 * API 层通过 statusCode 和 code 把可预期错误转换为稳定 HTTP 响应。
 */
export class FileStoreError extends Error {
  statusCode: number
  code: string

  /**
   * 创建一个可安全映射到 HTTP 响应的文件存储错误。
   * @param message 供服务端日志和上层诊断使用的错误说明。
   * @param statusCode 建议返回的 HTTP 状态码，默认表示请求数据有误的 400。
   * @param code 稳定的机器可读错误码，前端不应依赖易变化的 message 做判断。
   */
  constructor(message: string, statusCode = 400, code = "file-store.error") {
    super(message)
    this.name = "FileStoreError"
    this.statusCode = statusCode
    this.code = code
  }
}

/**
 * 判断未知异常是否由 File Store 主动抛出。
 * @param error `catch` 捕获到的未知值。
 * @returns 是 `FileStoreError` 时返回 true，并帮助 TypeScript 收窄类型。
 */
export function isFileStoreError(error: unknown): error is FileStoreError {
  return error instanceof FileStoreError
}
