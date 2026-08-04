import { createHash } from "node:crypto"
import type { CompiledStory, StoryDocument } from "@story-mgr/core"
import { validateStoryDocument } from "@story-mgr/core"

/**
 * 递归按对象键排序，使同一故事内容拥有稳定 JSON 表示。
 * @param value 任意 JSON 风格值。 @returns 数组顺序保持、对象键排序后的新值；原始对象不被修改。
 */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)])
    )
  }

  return value
}

/** @param value 要标识的编译内容。 @returns 对稳定排序 JSON 计算得到的 SHA-256 十六进制哈希。 */
function createContentHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(sortValue(value)))
    .digest("hex")
}

/**
 * 将编辑器 StoryDocument 编译成 Runtime 可直接加载的 v2 bundle。
 *
 * @param document 已由 File Store 聚合的规范故事文档。
 * @returns `compiled` bundle 和同一文档的完整校验结果；即使校验有 issue 也返回 bundle 供编辑器诊断。
 *
 * 编译时把 chain 数组索引成 id 字典，并显式区分 event/action 节点；随后只对真正影响运行的 content
 * 计算稳定哈希。`generatedAt` 仅表示本次生成时间，不参与 contentHash，因此重复编译相同内容版本不变。
 */
export function compileStory(document: StoryDocument): {
  compiled: CompiledStory
  result: ReturnType<typeof validateStoryDocument>
} {
  const chainEventsSource = document.chainEvents
  const poolEventsSource = document.poolEvents
  const scheduleEventsSource = document.scheduleEvents
  const chainEvents = Object.fromEntries(
    chainEventsSource.map((event) => [
      event.id,
      "exec_script" in event
        ? {
            node_type: "action" as const,
            id: event.id,
            title: event.title,
            vars: event.vars,
            exec_script: event.exec_script,
            next: event.next,
            meta: event.meta
          }
        : {
            node_type: "event" as const,
            id: event.id,
            title: event.title,
            trigger_mode: event.trigger_mode,
            trigger_expr: event.trigger_expr,
            invoke_params: event.invoke_params,
            init_script: event.init_script,
            end_script: event.end_script,
            object_keys: event.object_keys,
            presentation: event.presentation,
            location: event.location,
            next: event.next,
            meta: event.meta
          }
    ])
  )

  const content = {
      schemaVersion: 2 as const,
      storyId: document.story.id,
      title: document.story.title,
      gameSettings: document.story.game_settings,
      vals: document.vals,
      playerOverrideVals: document.playerOverrideVals,
      systemVals: document.systemVals,
      refer: document.refer,
      scenes: document.scenes,
      roles: document.roles,
      eventLocations: document.eventLocations,
      items: document.items,
      shop: document.shop,
      initialBags: document.initialBags,
      phone: document.phone,
      phoneConversations: document.phoneConversations,
      doing: document.doing,
      chainEvents,
      poolEvents: poolEventsSource,
      scheduleEvents: scheduleEventsSource
  }
  const compiled: CompiledStory = {
    ...content,
    contentHash: createContentHash(content),
    generatedAt: new Date().toISOString()
  }

  return {
    compiled,
    result: validateStoryDocument(document)
  }
}
