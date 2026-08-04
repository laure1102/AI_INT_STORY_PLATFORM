/**
 * AI 创作、对白生成和创作历史请求。
 *
 * 任务流使用 SSE 持续接收服务端事件；取消由调用方传入 AbortSignal 控制。
 * 本模块只传输任务状态，不把草稿自动写入故事，应用草稿仍需用户确认。
 */
import type {
  ApplyStoryCreationDraftRequest,
  ApplyStoryCreationDraftResponse,
  CreateStoryCreationJobRequest,
  DeleteStoryCreationHistorySessionResponse,
  GenerateStoryDialogueRequest,
  GenerateStoryDialogueResponse,
  RunStoryCreationAgentRequest,
  RunStoryCreationAgentResponse,
  SaveStoryCreationHistorySessionRequest,
  SaveStoryCreationHistorySessionResponse,
  StoryCreationHistoryFile,
  StoryCreationHistoryResponse,
  StoryCreationHistorySession,
  StoryCreationJob,
  StoryCreationJobListResponse,
  StoryCreationJobResponse,
  StoryCreationJobStreamEvent
} from "@story-mgr/shared"
import type { StoryApiContext } from "./context"

/** 创建 AI 创作与历史 API。 */
export function createStoryCreationApi(context: StoryApiContext) {
  const { apiBase, runStoryMutation } = context

  /** 执行 `runStoryCreationAgent` 对应的异步业务流程。 @param storyId 调用方传入的 `storyId`。 @param instruction 调用方传入的 `instruction`。 @param baseDraft 调用方传入的 `baseDraft`。 @param signal 调用方传入的 `signal`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function runStoryCreationAgent(
    storyId: string,
    instruction: string,
    baseDraft?: RunStoryCreationAgentRequest["baseDraft"],
    signal?: AbortSignal
  ): Promise<RunStoryCreationAgentResponse> {
    const body = {
      instruction,
      ...(baseDraft ? { baseDraft } : {})
    } satisfies RunStoryCreationAgentRequest

    return $fetch<RunStoryCreationAgentResponse>(
      `${apiBase}/stories/${storyId}/creation-agent/run`,
      { method: "POST", body, signal }
    )
  }

  /** 把 `StoryCreationDraft` 结果应用到当前草稿或状态。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function applyStoryCreationDraft(
    storyId: string,
    payload: Omit<ApplyStoryCreationDraftRequest, "expectedRevision">
  ): Promise<ApplyStoryCreationDraftResponse> {
    return runStoryMutation(storyId, (expectedRevision) =>
      $fetch<ApplyStoryCreationDraftResponse>(`${apiBase}/stories/${storyId}/creation-agent/apply`, {
        method: "POST",
        body: { ...payload, expectedRevision } satisfies ApplyStoryCreationDraftRequest
      })
    )
  }

  /** 创建一份新的 `StoryCreationJob` 数据。 @param storyId 调用方传入的 `storyId`。 @param request 调用方传入的 `request`。 @returns 计算、查找或构建后的结果。 */
  async function createStoryCreationJob(
    storyId: string,
    request: CreateStoryCreationJobRequest
  ): Promise<StoryCreationJob> {
    const response = await $fetch<StoryCreationJobResponse>(
      `${apiBase}/stories/${storyId}/creation-jobs`,
      { method: "POST", body: request }
    )
    return response.job
  }

  /** 读取或计算 `StoryCreationJob`。 @param storyId 调用方传入的 `storyId`。 @param jobId 调用方传入的 `jobId`。 @returns 计算、查找或构建后的结果。 */
  async function getStoryCreationJob(storyId: string, jobId: string): Promise<StoryCreationJob> {
    const response = await $fetch<StoryCreationJobResponse>(
      `${apiBase}/stories/${storyId}/creation-jobs/${jobId}`
    )
    return response.job
  }

  /** 执行 `listStoryCreationJobs` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @returns 计算、查找或构建后的结果。 */
  async function listStoryCreationJobs(storyId: string): Promise<StoryCreationJob[]> {
    const response = await $fetch<StoryCreationJobListResponse>(
      `${apiBase}/stories/${storyId}/creation-jobs`
    )
    return response.jobs
  }

  /** 判断 `cancelStoryCreationJob` 对应的条件是否成立。 @param storyId 调用方传入的 `storyId`。 @param jobId 调用方传入的 `jobId`。 @returns 布尔判断结果。 */
  async function cancelStoryCreationJob(storyId: string, jobId: string): Promise<StoryCreationJob> {
    const response = await $fetch<StoryCreationJobResponse>(
      `${apiBase}/stories/${storyId}/creation-jobs/${jobId}`,
      { method: "DELETE" }
    )
    return response.job
  }

  /** 执行 `streamStoryCreationJob` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param jobId 调用方传入的 `jobId`。 @param onEvent 调用方传入的 `onEvent`。 @param signal 调用方传入的 `signal`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
  async function streamStoryCreationJob(
    storyId: string,
    jobId: string,
    onEvent: (event: StoryCreationJobStreamEvent) => void,
    signal?: AbortSignal
  ) {
    const response = await fetch(`${apiBase}/stories/${storyId}/creation-jobs/${jobId}/events`, {
      headers: { Accept: "text/event-stream" },
      signal
    })
    if (!response.ok || !response.body) {
      throw new Error(`创作任务日志连接失败（${response.status}）。`)
    }

    // SSE 可能把一条 JSON 拆成多个网络分片，因此先累积到空行边界再解析。
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ""
      for (const block of blocks) {
        const data = block.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trimStart())
          .join("\n")
        if (data) onEvent(JSON.parse(data) as StoryCreationJobStreamEvent)
      }
    }
  }

  /** 执行 `generateStoryDialogue` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @param signal 调用方传入的 `signal`。 @returns 计算、查找或构建后的结果。 */
  async function generateStoryDialogue(
    storyId: string,
    payload: GenerateStoryDialogueRequest,
    signal?: AbortSignal
  ): Promise<GenerateStoryDialogueResponse> {
    return $fetch<GenerateStoryDialogueResponse>(
      `${apiBase}/stories/${storyId}/dialogue-agent/generate`,
      { method: "POST", body: payload, signal }
    )
  }

  /** 读取或计算 `StoryCreationHistory`。 @param storyId 调用方传入的 `storyId`。 @returns 计算、查找或构建后的结果。 */
  async function getStoryCreationHistory(storyId: string): Promise<StoryCreationHistoryFile> {
    const response = await $fetch<StoryCreationHistoryResponse>(
      `${apiBase}/stories/${storyId}/creation-history`
    )
    return response.history
  }

  /** 保存 `StoryCreationHistorySession` 数据并同步界面状态。 @param storyId 调用方传入的 `storyId`。 @param session 调用方传入的 `session`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveStoryCreationHistorySession(
    storyId: string,
    session: StoryCreationHistorySession
  ): Promise<SaveStoryCreationHistorySessionResponse> {
    return runStoryMutation(storyId, (expectedRevision) =>
      $fetch<SaveStoryCreationHistorySessionResponse>(
        `${apiBase}/stories/${storyId}/creation-history/${session.id}`,
        {
          method: "PUT",
          body: { session, expectedRevision } satisfies SaveStoryCreationHistorySessionRequest
        }
      )
    )
  }

  /** 删除指定的 `StoryCreationHistorySession` 数据。 @param storyId 调用方传入的 `storyId`。 @param sessionId 调用方传入的 `sessionId`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function deleteStoryCreationHistorySession(
    storyId: string,
    sessionId: string
  ): Promise<DeleteStoryCreationHistorySessionResponse> {
    return runStoryMutation(storyId, (expectedRevision) =>
      $fetch<DeleteStoryCreationHistorySessionResponse>(
        `${apiBase}/stories/${storyId}/creation-history/${sessionId}`,
        { method: "DELETE", query: { expectedRevision } }
      )
    )
  }

  return {
    applyStoryCreationDraft,
    cancelStoryCreationJob,
    createStoryCreationJob,
    deleteStoryCreationHistorySession,
    generateStoryDialogue,
    getStoryCreationHistory,
    getStoryCreationJob,
    listStoryCreationJobs,
    runStoryCreationAgent,
    saveStoryCreationHistorySession,
    streamStoryCreationJob
  }
}
