/**
 * AI 创作工作流与任务服务之间的公共观察契约。
 *
 * LangGraph 节点通过 observer 上报生命周期，任务服务据此持久化日志；模型回调还会兼容不同供应商
 * 的 token 字段。本模块不建立图，也不直接读写 SQLite。
 */
import type { LLMResult } from "@langchain/core/outputs"
import type { BaseCheckpointSaver } from "@langchain/langgraph"
import type {
  StoryCreationAgentRole,
  StoryCreationJobTokenUsage
} from "@story-mgr/shared"

/** 工作流节点可上报的五类事件；实现者通常是 `StoryCreationJobService`。 */
export interface StoryCreationWorkflowObserver {
  /** 节点即将调用模型时触发。 */
  onNodeStart(role: StoryCreationAgentRole, model: string): void
  /** 节点成功并生成摘要时触发。 */
  onNodeComplete(role: StoryCreationAgentRole, summary: string): void
  /** 节点失败或被取消时触发。 */
  onNodeError(role: StoryCreationAgentRole, error: unknown): void
  /** 每次 structured-output 模型尝试前触发。 */
  onModelAttempt(role: StoryCreationAgentRole, attempt: number): void
  /** LangChain 返回 token 用量时触发。 */
  onTokenUsage(role: StoryCreationAgentRole, usage: StoryCreationJobTokenUsage): void
}

/** 运行工作流时可选的持久化、恢复、取消和观察配置。 */
export interface StoryCreationWorkflowOptions {
  checkpointer?: BaseCheckpointSaver
  threadId?: string
  resume?: boolean
  observer?: StoryCreationWorkflowObserver
}

/**
 * 把上游不可信 token 字段转换成非负整数。
 *
 * @param value 供应商返回的任意字段值。
 * @returns 有限且非负的 number 会截成整数；字符串、负数和无穷值返回 null。
 */
function numericTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null
}

/**
 * 从一种供应商 token 记录中读取统一字段。
 *
 * @param value 可能使用 snake_case、camelCase 或 OpenAI 旧字段名的对象。
 * @returns `{ inputTokens, outputTokens, totalTokens }`；完全没有有效数字时返回 null。
 *
 * total 未提供但输入和输出都存在时会相加推导，任何无法确认的单项继续保留 null，不假装为 0。
 */
function readTokenUsageRecord(value: unknown): StoryCreationJobTokenUsage | null {
  if (!value || typeof value !== "object") return null
  const usage = value as Record<string, unknown>
  const inputTokens = numericTokenCount(usage.input_tokens ?? usage.inputTokens ?? usage.promptTokens)
  const outputTokens = numericTokenCount(usage.output_tokens ?? usage.outputTokens ?? usage.completionTokens)
  const reportedTotal = numericTokenCount(usage.total_tokens ?? usage.totalTokens)
  const totalTokens = reportedTotal ?? (
    inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
  )

  if (inputTokens === null && outputTokens === null && totalTokens === null) return null
  return { inputTokens, outputTokens, totalTokens }
}

/**
 * 从一次 LangChain LLMResult 中汇总 token 用量。
 *
 * @param output LangChain 模型结束回调提供的完整结果。
 * @returns 可用的统一 token 统计；所有位置都未报告时返回 null。
 *
 * 先读取顶层 `llmOutput`，因为多数供应商已在这里给出总数；若没有，再遍历每个 generation 的
 * message metadata 并累加。使用 has 标记区分“真实的 0”和“供应商没有提供”。
 */
export function extractStoryCreationTokenUsage(
  output: LLMResult
): StoryCreationJobTokenUsage | null {
  const llmUsage = readTokenUsageRecord(
    output.llmOutput?.tokenUsage ?? output.llmOutput?.usage_metadata ?? output.llmOutput?.estimatedTokenUsage
  )
  if (llmUsage) return llmUsage

  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let hasInput = false
  let hasOutput = false
  let hasTotal = false

  for (const generations of output.generations) {
    for (const generation of generations) {
      if (!("message" in generation) || !generation.message || typeof generation.message !== "object") continue
      const usage = readTokenUsageRecord(
        (generation.message as { usage_metadata?: unknown }).usage_metadata
      )
      if (!usage) continue
      if (usage.inputTokens !== null) {
        inputTokens += usage.inputTokens
        hasInput = true
      }
      if (usage.outputTokens !== null) {
        outputTokens += usage.outputTokens
        hasOutput = true
      }
      if (usage.totalTokens !== null) {
        totalTokens += usage.totalTokens
        hasTotal = true
      }
    }
  }

  if (!hasInput && !hasOutput && !hasTotal) return null
  return {
    inputTokens: hasInput ? inputTokens : null,
    outputTokens: hasOutput ? outputTokens : null,
    totalTokens: hasTotal ? totalTokens : hasInput && hasOutput ? inputTokens + outputTokens : null
  }
}

/**
 * 为一次 Agent 模型调用创建 LangChain runnable 配置。
 *
 * @param role 当前调用所属 Agent 角色，token 回调需要用它定位日志。
 * @param signal 可选取消信号，浏览器断开或任务取消时传给模型。
 * @param observer 可选工作流观察器。
 * @returns 没有 signal/observer 时返回 undefined；否则返回含 signal 和/或 callbacks 的配置对象。
 *
 * 回调只在 LLM 完成后提取 token，不改变模型输出。这样同步旧接口可以不传 observer，而可恢复任务
 * 可以把每个角色的用量实时写入 SQLite。
 */
export function createStoryCreationModelConfig(
  role: StoryCreationAgentRole,
  signal?: AbortSignal,
  observer?: StoryCreationWorkflowObserver
) {
  if (!observer) return signal ? { signal } : undefined

  return {
    ...(signal ? { signal } : {}),
    callbacks: [{
      /**
       * 处理 LangChain 的模型结束事件。
       * @param output 本次模型调用结果。
       * @returns 无返回值；若能解析 token，就通知 observer。
       */
      handleLLMEnd(output: LLMResult): void {
        const usage = extractStoryCreationTokenUsage(output)
        if (usage) observer.onTokenUsage(role, usage)
      }
    }]
  }
}
