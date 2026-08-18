import path from "node:path"

export const DEFAULT_SEMANTIC_MODEL_ID = "Xenova/bge-small-zh-v1.5" as const

export interface EvolutionEmbeddingProvider {
  readonly modelId: typeof DEFAULT_SEMANTIC_MODEL_ID
  readonly dimension: 512
  readonly normalized: true
  embedMany(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>
  close?(): Promise<void> | void
}

type FeatureExtractionPipeline = ((text: string, options: { pooling: "mean"; normalize: true }) => Promise<{ data: ArrayLike<number> }>) & {
  dispose?: () => Promise<void> | void
}

/** 在模型加载和逐条推理之间响应任务取消。 */
function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Evolution embedding was aborted.", "AbortError")
}

/** 校验 BGE 输出维度并进行最终的 L2 归一化。 */
function normalizeVector(values: ArrayLike<number>): number[] {
  const vector = Array.from(values)
  if (vector.length !== 512 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding model returned ${vector.length} dimensions; expected 512.`)
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Embedding model returned an empty vector.")
  return vector.map((value) => value / norm)
}

/** 懒加载本地 Transformers.js BGE 模型，并复用同一 pipeline 预计算发布向量。 */
export class XenovaEvolutionEmbeddingProvider implements EvolutionEmbeddingProvider {
  readonly modelId = DEFAULT_SEMANTIC_MODEL_ID
  readonly dimension = 512 as const
  readonly normalized = true as const
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null

  /** 创建固定 BGE-small-zh 模型的本地缓存提供器。 */
  constructor(private readonly cacheDir: string, configuredModelId: string = DEFAULT_SEMANTIC_MODEL_ID) {
    if (configuredModelId !== DEFAULT_SEMANTIC_MODEL_ID) {
      throw new Error(`Unsupported STORY_EMBEDDING_MODEL: ${configuredModelId}. Evolution package schema requires ${DEFAULT_SEMANTIC_MODEL_ID}.`)
    }
  }

  /** 懒加载并复用 Transformers.js feature-extraction pipeline。 */
  private getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const moduleName = "@xenova/transformers"
        const transformers = await import(moduleName) as {
          env: { cacheDir?: string; useFSCache?: boolean; allowRemoteModels?: boolean }
          pipeline: (task: string, modelId: string, options: { quantized: boolean }) => Promise<FeatureExtractionPipeline>
        }
        transformers.env.cacheDir = path.resolve(this.cacheDir)
        transformers.env.useFSCache = true
        transformers.env.allowRemoteModels = true
        return transformers.pipeline("feature-extraction", this.modelId, { quantized: true })
      })()
    }
    return this.pipelinePromise
  }

  /** 批量计算 512 维归一化文本向量。 */
  async embedMany(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return []
    assertNotAborted(signal)
    const extractor = await this.getPipeline()
    const result: number[][] = []
    for (const text of texts) {
      assertNotAborted(signal)
      const output = await extractor(text, { pooling: "mean", normalize: true })
      result.push(normalizeVector(output.data))
    }
    assertNotAborted(signal)
    return result
  }

  /** 释放已加载的模型 pipeline。 */
  async close(): Promise<void> {
    if (!this.pipelinePromise) return
    const extractor = await this.pipelinePromise.catch(() => null)
    await extractor?.dispose?.()
    this.pipelinePromise = null
  }
}
