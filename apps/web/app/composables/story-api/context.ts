/**
 * Story API 模块共享的请求上下文。
 *
 * 输入来自 Nuxt 运行时配置和页面级修订号状态；输出给各领域 API 工厂使用。
 * 本模块只处理地址、修订号与写请求排队，不关心具体业务请求体。
 */

const storyMutationQueues = new Map<string, Promise<void>>()

export interface StoryApiContext {
  apiBase: string
  setStoryRevision: (storyId: string, revision: number | undefined) => void
  runStoryMutation: <T extends { revision?: number }>(
    storyId: string,
    operation: (expectedRevision: number) => Promise<T>
  ) => Promise<T>
}

/** 创建一组领域 API 共用的修订号与请求配置。 */
export function createStoryApiContext(): StoryApiContext {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase)
  const storyRevisions = useState<Record<string, number>>("story-revisions", () => ({}))

  /** 更新 `StoryRevision` 对应的响应式值。 @param storyId 调用方传入的 `storyId`。 @param revision 调用方传入的 `revision`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function setStoryRevision(storyId: string, revision: number | undefined) {
    if (typeof revision === "number") {
      storyRevisions.value[storyId] = revision
    }
  }

  /** 执行 `requireStoryRevision` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @returns 计算、查找或构建后的结果。 */
  function requireStoryRevision(storyId: string) {
    const revision = storyRevisions.value[storyId]
    if (typeof revision !== "number") {
      throw new Error("故事修订号尚未加载，请重新打开故事后再保存。")
    }
    return revision
  }

  /** 执行 `runStoryMutation` 对应的异步业务流程。 @param storyId 调用方传入的 `storyId`。 @param operation 调用方传入的 `operation`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function runStoryMutation<T extends { revision?: number }>(
    storyId: string,
    operation: (expectedRevision: number) => Promise<T>
  ): Promise<T> {
    const previous = storyMutationQueues.get(storyId) ?? Promise.resolve()

    // 同一故事的写请求逐个执行；前一个失败也不能阻塞后续请求。
    const task = previous.catch(() => undefined).then(async () => {
      const response = await operation(requireStoryRevision(storyId))
      if (typeof response.revision !== "number") {
        throw new Error("服务器未返回故事修订号，请重新加载故事。")
      }
      setStoryRevision(storyId, response.revision)
      return response
    })
    const tail = task.then(() => undefined, () => undefined)
    storyMutationQueues.set(storyId, tail)

    try {
      return await task
    } finally {
      if (storyMutationQueues.get(storyId) === tail) {
        storyMutationQueues.delete(storyId)
      }
    }
  }

  return { apiBase, setStoryRevision, runStoryMutation }
}
