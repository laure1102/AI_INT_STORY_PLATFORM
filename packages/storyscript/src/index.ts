/**
 * StoryScript 包的稳定入口。
 *
 * 调用方继续从 @story-mgr/storyscript 导入，内部文件如何拆分不会影响外部 API。
 */
export * from "./types"
export * from "./input"
export * from "./api"
export { evaluateStoryValCalcRule } from "./engine"
