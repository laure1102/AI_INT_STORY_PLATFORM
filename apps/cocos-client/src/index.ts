export interface CocosClientPlaceholderConfig {
  storyId?: string
}

/**
 * 创建尚未接入 Cocos 引擎前使用的最小客户端描述对象。
 * @param config 可选故事 id。 @returns 固定平台名和规范为 string/null 的故事 id。
 * 此函数不加载 bundle 或创建 Runtime Session，只用于验证 workspace 包可导入。
 */
export function createCocosClientPlaceholder(
  config: CocosClientPlaceholderConfig = {}
) {
  return {
    platform: "cocos-client" as const,
    storyId: config.storyId ?? null
  }
}
