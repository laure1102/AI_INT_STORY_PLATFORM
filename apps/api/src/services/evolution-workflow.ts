import { Annotation, END, START, StateGraph } from "@langchain/langgraph"
import type { BaseCheckpointSaver } from "@langchain/langgraph"
import { randomUUID } from "node:crypto"
import { hashEvolutionPackage, evolutionPatchSchema, semanticContactIntentSchema, type StoryEvolutionPackage, type StoryEvolutionPatch, type StoryEvolutionScope } from "@story-mgr/evolution"
import { compileEffectiveStory } from "@story-mgr/compiler"
import { validateEvolutionPatchKeys, type StoryDocument } from "@story-mgr/core"
import { createStorySession } from "@story-mgr/runtime"
import { ChatOpenAI } from "@langchain/openai"
import { z } from "zod"
import { DEFAULT_SEMANTIC_MODEL_ID, type EvolutionEmbeddingProvider } from "./evolution-embedding"

const worldAnalysisSchema = z.object({
  summary: z.string(),
  world_state_patch: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
}).strict()
const plotPlanSchema = z.object({ summary: z.string(), goals: z.array(z.string()), constraints: z.array(z.string()) }).strict()
const generatedSchema = z.object({
  patch: evolutionPatchSchema,
  semantic_entries: z.array(semanticContactIntentSchema),
  world_state_patch: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
}).strict()

export interface EvolutionWorkflowContext {
  worldState: Record<string, string | number | boolean | null>
  aggregates: Record<string, number>
}

export type EvolutionStructuredOutputInvoker = (
  schema: z.ZodTypeAny,
  name: string,
  prompt: string,
  signal?: AbortSignal
) => Promise<unknown>

const EvolutionState = Annotation.Root({
  storyId: Annotation<string>, instruction: Annotation<string>, scope: Annotation<StoryEvolutionScope>, document: Annotation<StoryDocument>,
  baseContentHash: Annotation<string>, parentPackageIds: Annotation<string[]>({ reducer: (_, right) => right, default: () => [] }), sequence: Annotation<number>,
  context: Annotation<Record<string, unknown>>({ reducer: (_, right) => right, default: () => ({}) }),
  worldAnalysis: Annotation<z.infer<typeof worldAnalysisSchema>>({ reducer: (_, right) => right, default: () => ({ summary: "", world_state_patch: {} }) }),
  plotPlan: Annotation<z.infer<typeof plotPlanSchema>>({ reducer: (_, right) => right, default: () => ({ summary: "", goals: [], constraints: [] }) }),
  eventPatch: Annotation<StoryEvolutionPatch>({ reducer: (_, right) => right, default: () => ({ world_state_patch: {} }) }),
  contactPatch: Annotation<StoryEvolutionPatch>({ reducer: (_, right) => right, default: () => ({ world_state_patch: {} }) }),
  patch: Annotation<StoryEvolutionPatch>({ reducer: (_, right) => right, default: () => ({ world_state_patch: {} }) }),
  semanticEntries: Annotation<StoryEvolutionPackage["semantic_entries"]>({ reducer: (_, right) => right, default: () => [] }),
  worldStatePatch: Annotation<Record<string, string | number | boolean | null>>({ reducer: (_, right) => right, default: () => ({}) }),
  package: Annotation<StoryEvolutionPackage | null>({ reducer: (_, right) => right, default: () => null }),
  simulationOk: Annotation<boolean>({ reducer: (_, right) => right, default: () => false })
})

export type EvolutionWorkflowInput = {
  storyId: string
  instruction: string
  scope: StoryEvolutionScope
  document: StoryDocument
  baseContentHash: string
  parentPackageIds: string[]
  parentPackages?: StoryEvolutionPackage[]
  sequence: number
  context?: EvolutionWorkflowContext
  model?: { apiKey?: string; baseUrl?: string; model?: string }
  structuredOutputInvoker?: EvolutionStructuredOutputInvoker
  embeddingProvider?: EvolutionEmbeddingProvider
  checkpointer?: BaseCheckpointSaver
  threadId?: string
  resume?: boolean
  signal?: AbortSignal
}

export const EVOLUTION_NODE_NAMES = ["contextCollector", "worldStateAnalyzer", "plotPlanner", "eventWriter", "contactWriter", "scriptDoctor", "consistencyChecker", "runtimeSimulator", "packagePublisher"] as const

/** 合并各写作节点产生的受限领域 patch。 */
function mergePatches(...patches: StoryEvolutionPatch[]): StoryEvolutionPatch {
  const result: StoryEvolutionPatch = { world_state_patch: {} }
  for (const patch of patches) {
    for (const [key, value] of Object.entries(patch)) {
      if (key === "world_state_patch") {
        Object.assign(result.world_state_patch, value)
        continue
      }
      if (!value || typeof value !== "object") continue
      const collection = value as { upsert?: unknown[]; remove?: string[] }
      const current = result[key as keyof Omit<StoryEvolutionPatch, "world_state_patch">] as { upsert: unknown[]; remove: string[] } | undefined
      result[key as keyof Omit<StoryEvolutionPatch, "world_state_patch">] = {
        upsert: [...(current?.upsert ?? []), ...(collection.upsert ?? [])],
        remove: [...(current?.remove ?? []), ...(collection.remove ?? [])]
      } as never
    }
  }
  return evolutionPatchSchema.parse(result)
}

/** 提取提供给模型的有限故事摘要和引用索引。 */
function summarizeDocument(document: StoryDocument): Record<string, unknown> {
  return {
    story: document.story,
    storyBible: document.storyBible,
    counts: {
      vals: document.vals.variables.length,
      roles: document.roles.normal.roles.length + document.roles.important.roles.length,
      items: document.items.items.length,
      chainEvents: document.chainEvents.length,
      poolEvents: document.poolEvents.length,
      scheduleEvents: document.scheduleEvents.length,
      contacts: document.contact.contact_profiles.length,
      contactConversations: document.contactConversations.conversations.length,
      doings: document.doing.doings.length,
      shopProducts: document.shop.products.length
    },
    references: {
      roleKeys: [...document.roles.normal.roles.map((role) => `normal:${role.id}`), ...document.roles.important.roles.map((role) => `important:${role.id}`)],
      talkIds: document.contact.talk_library.map((entry) => entry.id),
      actionIds: document.contact.action_library.map((entry) => entry.id),
      eventIds: [...document.chainEvents, ...document.poolEvents, ...document.scheduleEvents].map((entry) => entry.id)
    }
  }
}

/** 将 prompt 上下文编码并限制到可控长度。 */
function promptJson(value: unknown): string {
  const text = JSON.stringify(value)
  return text.length <= 60_000 ? text : `${text.slice(0, 60_000)}...`
}

/** Evolution Agent 的固定九节点图；所有模型输出都经过 strict Zod schema 和最终 Runtime 模拟。 */
export async function runEvolutionWorkflow(input: EvolutionWorkflowInput): Promise<StoryEvolutionPackage> {
  const model = input.model?.apiKey && input.model.baseUrl && input.model.model
    ? new ChatOpenAI({ apiKey: input.model.apiKey, configuration: { baseURL: input.model.baseUrl }, model: input.model.model, temperature: 0.2, maxRetries: 1, timeout: 120000 })
    : null
  const hasStructuredModel = Boolean(model || input.structuredOutputInvoker)

  /** 调用注入或生产模型，并再次用节点 schema 解析返回值。 */
  const invokeStructured = async <T extends z.ZodTypeAny>(schema: T, name: string, prompt: string): Promise<z.infer<T>> => {
    if (input.structuredOutputInvoker) {
      return schema.parse(await input.structuredOutputInvoker(schema, name, prompt, input.signal))
    }
    if (!model) throw new Error("Evolution model is not configured.")
    return schema.parse(await model.withStructuredOutput(schema, { name }).invoke(prompt, { signal: input.signal }))
  }

  /** 汇总故事摘要、世界状态和聚合指标。 */
  const contextCollector = async (state: typeof EvolutionState.State) => ({
    context: {
      instruction: state.instruction,
      scope: state.scope,
      baseContentHash: state.baseContentHash,
      currentWorldState: input.context?.worldState ?? {},
      aggregateMetrics: input.context?.aggregates ?? {},
      document: summarizeDocument(state.document)
    }
  })

  /** 分析统计指标对应的世界状态增量。 */
  const worldStateAnalyzer = async (state: typeof EvolutionState.State) => {
    if (!hasStructuredModel) return { worldAnalysis: { summary: "No model configured; preserve current world state.", world_state_patch: {} } }
    const worldAnalysis = await invokeStructured(worldAnalysisSchema, "StoryEvolutionWorldState", `分析结构化世界状态与聚合指标，只提出必要的世界状态增量。不得包含原始玩家文本。\n${promptJson(state.context)}`)
    return { worldAnalysis }
  }

  /** 生成受故事 bible 和现有引用约束的增量计划。 */
  const plotPlanner = async (state: typeof EvolutionState.State) => {
    if (!hasStructuredModel) return { plotPlan: { summary: "No generated evolution.", goals: [], constraints: [] } }
    const plotPlan = await invokeStructured(plotPlanSchema, "StoryEvolutionPlotPlan", `基于故事 bible、当前内容摘要、世界分析和演化指令制定本次增量剧情计划。计划必须保持已有引用有效。\n${promptJson({ context: state.context, worldAnalysis: state.worldAnalysis })}`)
    return { plotPlan }
  }

  /** 生成事件、物品、变量、行动和商店领域 patch。 */
  const eventWriter = async (state: typeof EvolutionState.State) => {
    if (!hasStructuredModel) return { eventPatch: { world_state_patch: {} } }
    const output = await invokeStructured(generatedSchema, "StoryEvolutionEventPatch", `根据计划生成结构化领域 patch。重点处理 vals、roles、items、eventLocations、chainEvents、poolEvents、scheduleEvents、doing、shop。禁止 system_vals、player_override_vals、story_bible、执行器代码和未知字段。StoryScript 只能使用项目允许的变量与 helper。\n${promptJson({ context: state.context, plan: state.plotPlan })}`)
    return { eventPatch: output.patch, worldStatePatch: { ...state.worldAnalysis.world_state_patch, ...output.world_state_patch } }
  }

  /** 生成联系人领域 patch 和语义意图。 */
  const contactWriter = async (state: typeof EvolutionState.State) => {
    if (!hasStructuredModel) return { contactPatch: { world_state_patch: {} }, semanticEntries: [] }
    const output = await invokeStructured(generatedSchema, "StoryEvolutionContactPatch", `根据计划补充 contact、contactConversations 和 semantic_entries。semantic response 只能引用已有或本次新增 talk/action，condition_expr 只读；不要生成 vector，服务端会用 BGE 预计算。\n${promptJson({ context: state.context, plan: state.plotPlan, eventPatch: state.eventPatch })}`)
    return { contactPatch: output.patch, semanticEntries: output.semantic_entries, worldStatePatch: { ...state.worldStatePatch, ...output.world_state_patch } }
  }

  /** 修正候选 patch 中的脚本、模板和引用问题。 */
  const scriptDoctor = async (state: typeof EvolutionState.State) => {
    const candidate = { patch: mergePatches(state.eventPatch, state.contactPatch), semantic_entries: state.semanticEntries, world_state_patch: state.worldStatePatch }
    if (!hasStructuredModel) return { patch: candidate.patch, semanticEntries: candidate.semantic_entries, worldStatePatch: candidate.world_state_patch }
    const corrected = await invokeStructured(generatedSchema, "StoryEvolutionScriptDoctor", `审查并修正候选 patch 中的 StoryScript、模板、引用和越权字段。保持结构化 upsert/remove，不得引入任意执行器代码。\n${promptJson({ context: state.context, candidate })}`)
    return { patch: corrected.patch, semanticEntries: corrected.semantic_entries, worldStatePatch: { ...candidate.world_state_patch, ...corrected.world_state_patch } }
  }

  /** 校验 patch 权限并为新增语义条目预计算向量。 */
  const consistencyChecker = async (state: typeof EvolutionState.State) => {
    const patchValidation = validateEvolutionPatchKeys(state.patch as unknown as Record<string, unknown>)
    if (!patchValidation.ok) throw new Error(patchValidation.issues.map((issue) => issue.message).join("；"))
    if (state.semanticEntries.length > 0 && !input.embeddingProvider) throw new Error("Evolution semantic entries require a server embedding provider.")
    const vectors = await input.embeddingProvider?.embedMany(state.semanticEntries.map((entry) => entry.utterances.join("\n")), input.signal) ?? []
    return { semanticEntries: state.semanticEntries.map((entry, index) => ({ ...entry, vector: vectors[index] })) }
  }

  /** 从图状态构造尚未签名的不可变内容包。 */
  const buildUnsignedPackage = (state: typeof EvolutionState.State, packageId: string) => ({
    schema_version: 1 as const, package_id: packageId, story_id: state.storyId, scope: state.scope, sequence: state.sequence,
    base_content_hash: state.baseContentHash, parent_package_ids: state.parentPackageIds, created_at: new Date().toISOString(), patch: state.patch,
    semantic_model: { model_id: DEFAULT_SEMANTIC_MODEL_ID, dimension: 512 as const, normalized: true as const },
    semantic_entries: state.semanticEntries, world_state_patch: state.worldStatePatch
  })

  /** 编译候选有效故事并创建 Runtime 会话做最小模拟。 */
  const runtimeSimulator = async (state: typeof EvolutionState.State) => {
    const unsigned = buildUnsignedPackage(state, `simulation-${randomUUID()}`)
    const effective = compileEffectiveStory({ document: state.document, evolutionPackages: [...(input.parentPackages ?? []), { ...unsigned, package_hash: hashEvolutionPackage(unsigned) }] })
    if (!effective.result.ok) throw new Error(effective.result.issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join("；"))
    const session = createStorySession({ bundle: effective.compiled })
    session.getViewModel()
    session.tick(0)
    return { simulationOk: true }
  }

  /** 仅在模拟通过后计算内容包 hash 并输出包。 */
  const packagePublisher = async (state: typeof EvolutionState.State) => {
    if (!state.simulationOk) throw new Error("Runtime 模拟未通过。")
    const unsigned = buildUnsignedPackage(state, `evo-${randomUUID()}`)
    return { package: { ...unsigned, package_hash: hashEvolutionPackage(unsigned) } }
  }

  const retryPolicy = { maxAttempts: 2, initialInterval: 1 }
  const graph = new StateGraph(EvolutionState)
    .addNode("contextCollector", contextCollector)
    .addNode("worldStateAnalyzer", worldStateAnalyzer, { retryPolicy })
    .addNode("plotPlanner", plotPlanner, { retryPolicy })
    .addNode("eventWriter", eventWriter, { retryPolicy })
    .addNode("contactWriter", contactWriter, { retryPolicy })
    .addNode("scriptDoctor", scriptDoctor, { retryPolicy })
    .addNode("consistencyChecker", consistencyChecker)
    .addNode("runtimeSimulator", runtimeSimulator)
    .addNode("packagePublisher", packagePublisher)
    .addEdge(START, "contextCollector")
    .addEdge("contextCollector", "worldStateAnalyzer")
    .addEdge("worldStateAnalyzer", "plotPlanner")
    .addEdge("plotPlanner", "eventWriter")
    .addEdge("eventWriter", "contactWriter")
    .addEdge("contactWriter", "scriptDoctor")
    .addEdge("scriptDoctor", "consistencyChecker")
    .addEdge("consistencyChecker", "runtimeSimulator")
    .addEdge("runtimeSimulator", "packagePublisher")
    .addEdge("packagePublisher", END)
    .compile(input.checkpointer ? { checkpointer: input.checkpointer } : undefined)

  const graphInput = input.resume ? null : {
    storyId: input.storyId, instruction: input.instruction, scope: input.scope, document: input.document, baseContentHash: input.baseContentHash,
    parentPackageIds: input.parentPackageIds, sequence: input.sequence, context: {}, worldAnalysis: { summary: "", world_state_patch: {} },
    plotPlan: { summary: "", goals: [], constraints: [] }, eventPatch: { world_state_patch: {} }, contactPatch: { world_state_patch: {} },
    patch: { world_state_patch: {} }, semanticEntries: [], worldStatePatch: {}, package: null, simulationOk: false
  } as typeof EvolutionState.State
  const config = input.checkpointer
    ? { configurable: { thread_id: input.threadId ?? `evolution:${input.storyId}:${input.scope.type}:${input.scope.id}:${input.sequence}` }, signal: input.signal }
    : { signal: input.signal }
  const result = await graph.invoke(graphInput, config)
  if (!result.package) throw new Error("Evolution workflow did not publish a package.")
  return result.package
}
