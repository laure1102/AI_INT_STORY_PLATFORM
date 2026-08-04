/**
 * File Store 资产工具的兼容入口。
 *
 * 旧代码继续从 `./assets` 导入；具体实现按默认数据、创建输入、路径安全和无用文件清理拆开。
 */
export * from "./defaults"
export * from "./story-input"
export * from "./asset-paths"
export * from "./asset-pruning"
export { createStoryStatePaths } from "./persistence"
