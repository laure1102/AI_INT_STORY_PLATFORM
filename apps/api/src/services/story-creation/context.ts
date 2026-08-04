/**
 * AI 创作上下文的兼容入口。
 *
 * 业务代码仍可从原来的 `./context` 路径导入所有格式化与检索函数；具体实现按职责分散在四个
 * 小模块中：公共文本预处理、变量检索、物品与资产检索、其他领域摘要。
 *
 * 数据流可以理解为：
 * `故事文档 + 用户指令 + 上一步草稿 → 本地筛选/压缩 → prompt 文本 → 各 Agent 节点`。
 * 这个入口不执行任何逻辑，也不负责调用模型、验证最终草稿或写入故事文件。
 */
export * from "./context-domains"
export * from "./context-items"
export * from "./context-shared"
export * from "./context-variables"
