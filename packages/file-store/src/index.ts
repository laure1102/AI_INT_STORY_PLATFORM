/**
 * @story-mgr/file-store 的稳定入口。
 *
 * 外部调用方继续使用原有导入路径；内部实现按职责拆分。
 */
export * from "./errors"
export * from "./types"
export { createStoryFileStore } from "./store"
