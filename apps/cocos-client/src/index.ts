export interface CocosClientPlaceholderConfig {
  storyId?: string
}

export function createCocosClientPlaceholder(
  config: CocosClientPlaceholderConfig = {}
) {
  return {
    platform: "cocos-client" as const,
    storyId: config.storyId ?? null
  }
}
