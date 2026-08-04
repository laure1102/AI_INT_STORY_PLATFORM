/**
 * Core 持久化 Schema 的稳定入口。
 *
 * 外部调用方继续从原路径导入；具体 Schema 按业务文件分散在 schema/ 目录。
 */
export * from "./schema/base"
export * from "./schema/assets"
export * from "./schema/commerce"
export * from "./schema/phone"
export * from "./schema/settings"
export * from "./schema/events"
export * from "./schema/document"
