import { DEFAULT_MAX_CALC_NESTING_DEPTH } from "@story-mgr/runtime"

export interface CommandClientPlaceholderConfig {
  storyId?: string
}

export function createCommandClientPlaceholder(
  config: CommandClientPlaceholderConfig = {}
) {
  return {
    platform: "command-client" as const,
    storyId: config.storyId ?? null,
    runtimeMaxCalcDepth: DEFAULT_MAX_CALC_NESTING_DEPTH
  }
}
