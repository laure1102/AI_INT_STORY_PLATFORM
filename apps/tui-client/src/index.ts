import { DEFAULT_MAX_CALC_NESTING_DEPTH } from "@story-mgr/runtime"

export interface TuiClientPlaceholderConfig {
  storyId?: string
}

export function createTuiClientPlaceholder(
  config: TuiClientPlaceholderConfig = {}
) {
  return {
    platform: "tui-client" as const,
    storyId: config.storyId ?? null,
    runtimeMaxCalcDepth: DEFAULT_MAX_CALC_NESTING_DEPTH
  }
}
