export interface RuntimeRngState {
  algorithm: "mulberry32"
  state: number
}

export interface RuntimeRngSeedSource {
  contentHash?: string
  generatedAt?: string
  storyId: string
}

/**
 * 从稳定的故事标识生成确定性随机数初始状态。
 * @param source 优先使用 contentHash，其次兼容 generatedAt，最后使用 storyId。 @returns 可随存档持久化的 RNG 状态。
 * 使用 FNV-1a 风格散列把字符串折叠为 32 位种子，使同一 bundle 在不同客户端得到相同随机序列。
 */
export function createRuntimeRngState(source: RuntimeRngSeedSource): RuntimeRngState {
  const seedSource = source.contentHash ?? source.generatedAt ?? source.storyId
  let seed = 2166136261
  for (let index = 0; index < seedSource.length; index += 1) {
    seed ^= seedSource.charCodeAt(index)
    seed = Math.imul(seed, 16777619)
  }
  return { algorithm: "mulberry32", state: seed >>> 0 }
}

/**
 * 恢复存档中的 RNG；旧存档没有合法状态时重新从 bundle 生成。
 * @param value 存档状态。 @param source 生成回退种子的故事信息。 @returns 规范的无符号 32 位 RNG 状态。
 */
export function normalizeRuntimeRngState(
  value: RuntimeRngState | null | undefined,
  source: RuntimeRngSeedSource
): RuntimeRngState {
  const state = Number(value?.state)
  return Number.isInteger(state)
    ? { algorithm: "mulberry32", state: state >>> 0 }
    : createRuntimeRngState(source)
}

/**
 * 使用 Mulberry32 算法取得下一个确定性随机数，并原地推进状态。
 * @param rng 可变的随机状态。 @returns 大于等于 0 且小于 1 的小数；副作用是更新 `rng.state`。
 */
export function nextRuntimeRandom(rng: RuntimeRngState) {
  let state = (rng.state + 0x6d2b79f5) >>> 0
  rng.state = state
  state = Math.imul(state ^ (state >>> 15), state | 1)
  state ^= state + Math.imul(state ^ (state >>> 7), state | 61)
  return ((state ^ (state >>> 14)) >>> 0) / 4294967296
}
