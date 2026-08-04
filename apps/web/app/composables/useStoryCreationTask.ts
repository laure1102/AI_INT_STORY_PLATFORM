import type {
  RunStoryCreationAgentResponse,
  StoryCreationDraft,
  StoryCreationJob,
  StoryCreationJobStreamEvent
} from "@story-mgr/shared"
import type { MaybeRefOrGetter } from "vue"

/** 组合 `StoryCreationTask` 的响应式状态、派生值和操作方法。 @param storyId 调用方传入的 `storyId`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useStoryCreationTask(storyId: MaybeRefOrGetter<string>) {
  const {
    cancelStoryCreationJob,
    createStoryCreationJob,
    getStoryCreationJob,
    listStoryCreationJobs,
    streamStoryCreationJob
  } = useStoryApi()
  const activeJob = shallowRef<StoryCreationJob | null>(null)
  const streamController = shallowRef<AbortController | null>(null)
  /** 执行 `currentStoryId` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
  const currentStoryId = () => toValue(storyId)

  /** 把 `StreamEvent` 结果应用到当前草稿或状态。 @param event 调用方传入的 `event`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  function applyStreamEvent(event: StoryCreationJobStreamEvent) {
    if (event.type === "snapshot" || event.type === "status") {
      activeJob.value = event.job
      return
    }
    if (!activeJob.value) return
    const existingIndex = activeJob.value.logs.findIndex((log) => log.id === event.log.id)
    const logs = existingIndex < 0
      ? [...activeJob.value.logs, event.log]
      : activeJob.value.logs.map((log, index) => index === existingIndex ? event.log : log)
    activeJob.value = { ...activeJob.value, logs }
  }

  /** 执行 `followJob` 对应的局部业务逻辑。 @param job 调用方传入的 `job`。 @returns 计算、查找或构建后的结果。 */
  async function followJob(job: StoryCreationJob): Promise<RunStoryCreationAgentResponse> {
    activeJob.value = job
    streamController.value?.abort()
    const controller = new AbortController()
    streamController.value = controller
    try {
      await streamStoryCreationJob(currentStoryId(), job.id, applyStreamEvent, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) throw error
    } finally {
      if (streamController.value === controller) streamController.value = null
    }

    const finalJob = await getStoryCreationJob(currentStoryId(), job.id)
    activeJob.value = finalJob
    if (finalJob.status === "completed" && finalJob.result) return finalJob.result
    if (finalJob.status === "cancelled") {
      const abortError = new Error(finalJob.error?.message ?? "AI 创作任务已取消。")
      abortError.name = "AbortError"
      throw abortError
    }
    throw new Error(finalJob.error?.message ?? "AI 创作任务执行失败。")
  }

  /** 执行 `run` 对应的异步业务流程。 @param instruction 调用方传入的 `instruction`。 @param baseDraft 调用方传入的 `baseDraft`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function run(instruction: string, baseDraft?: StoryCreationDraft) {
    const job = await createStoryCreationJob(currentStoryId(), {
      instruction,
      ...(baseDraft ? { baseDraft } : {})
    })
    return followJob(job)
  }

  /** 执行 `resumeLatest` 对应的局部业务逻辑。 @returns 计算、查找或构建后的结果。 */
  async function resumeLatest() {
    const jobs = await listStoryCreationJobs(currentStoryId())
    const latestJob = jobs[0]
    return latestJob ? followJob(latestJob) : null
  }

  /** 判断 `cancel` 对应的条件是否成立。 @returns 布尔判断结果。 */
  async function cancel() {
    const job = activeJob.value
    if (!job || (job.status !== "queued" && job.status !== "running")) return
    activeJob.value = await cancelStoryCreationJob(currentStoryId(), job.id)
    streamController.value?.abort()
  }

  onScopeDispose(() => streamController.value?.abort())

  return {
    activeJob,
    cancel,
    resumeLatest,
    run
  }
}
