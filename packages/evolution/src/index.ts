import { createHash } from "node:crypto"
import { z } from "zod"
import type { StoryDocument, StoryContactFile, StoryRolesFile, StoryValsFile } from "@story-mgr/core"
import { evolutionPackageSchema, evolutionPatchSchema, evolutionScopeSchema, semanticContactIntentSchema, storyEvolutionManifestSchema, telemetryEventSchema } from "@story-mgr/core"
export { evolutionPackageSchema, evolutionPatchSchema, evolutionScopeSchema, semanticContactIntentSchema, storyEvolutionManifestSchema, telemetryEventSchema }


export type StoryEvolutionScope = z.infer<typeof evolutionScopeSchema>
export type StorySemanticContactIntent = z.infer<typeof semanticContactIntentSchema>
export type StoryEvolutionPatch = z.infer<typeof evolutionPatchSchema>
export type StoryEvolutionPackage = z.infer<typeof evolutionPackageSchema>

export interface StoryEvolutionManifest {
  storyId: string
  baseContentHash: string
  packageIds: string[]
  effectiveContentHash: string
  semanticModel: { modelId: string; dimension: number; normalized: true }
  worldRevision: number
  generatedAt: string
}


export type StoryTelemetryEventType = "event.completed" | "choice.selected" | "doing.used" | "contact.intent_matched" | "contact.intent_fallback" | "milestone.reached" | "package.installed" | "package.rejected"
export interface StoryTelemetryEvent {
  eventId: string
  storyId: string
  playerId: string
  shardId: string
  sessionId: string
  sequence: number
  occurredAt: string
  type: StoryTelemetryEventType
  payload: Record<string, string | number | boolean | null>
}


export interface EvolutionPackageValidationResult {
  ok: boolean
  errors: string[]
}

/** 将 JSON 值按键排序后编码，保证 hash 稳定。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/** 计算不含 package_hash 字段的内容包 SHA-256。 */
export function hashEvolutionPackage(pkg: Omit<StoryEvolutionPackage, "package_hash">): string {
  return createHash("sha256").update(canonical(pkg)).digest("hex")
}

/** 校验内容包结构、基线 hash、包 hash 和语义向量元数据。 */
export function validateEvolutionPackage(pkg: unknown, baseContentHash?: string): EvolutionPackageValidationResult {
  const parsed = evolutionPackageSchema.safeParse(pkg)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) }
  const value = parsed.data
  const errors: string[] = []
  if (baseContentHash && value.base_content_hash !== baseContentHash) errors.push("基础内容 hash 不匹配。")
  const { package_hash: _packageHash, ...unsignedPackage } = value
  if (value.package_hash !== hashEvolutionPackage(unsignedPackage)) errors.push("内容包 hash 无效。")
  if (value.semantic_model.dimension !== 512) errors.push("语义模型维度必须为 512。")
  if (new Set(value.parent_package_ids).size !== value.parent_package_ids.length) errors.push("父包列表不能包含重复 id。")
  for (const entry of value.semantic_entries) {
    if (entry.vector && entry.vector.length !== value.semantic_model.dimension) errors.push(`语义条目 ${entry.id} 的向量维度不匹配。`)
    if (entry.vector?.length === value.semantic_model.dimension) {
      const norm = Math.sqrt(entry.vector.reduce((sum, item) => sum + item * item, 0))
      if (Math.abs(norm - 1) > 0.001) errors.push(`语义条目 ${entry.id} 的向量未归一化。`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** 读取 patch 项目的稳定标识。 */
function itemId(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const record = value as Record<string, unknown>
  return typeof record.id === "string"
    ? record.id
    : typeof record.name === "string"
      ? record.name
      : typeof record.role_key === "string"
        ? record.role_key
        : ""
}

/** 对数组应用明确的 upsert/remove patch。 */
function applyCollection(current: unknown, patch: { upsert?: unknown[]; remove?: string[] }): unknown {
  if (!Array.isArray(current)) return current
  const removed = new Set(patch.remove ?? [])
  const output = current.filter((item) => !removed.has(itemId(item)))
  for (const item of patch.upsert ?? []) {
    const id = itemId(item)
    if (!id || removed.has(id)) continue
    const index = output.findIndex((existing) => itemId(existing) === id)
    if (index >= 0) output[index] = structuredClone(item)
    else output.push(structuredClone(item))
  }
  return output
}

/** 清除只用于选择领域子集合的元数据，避免它进入最终 StoryDocument。 */
function stripCollectionHint(value: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...value }
  delete clean.collection
  delete clean.library
  return clean
}

/** 根据显式 hint、已有 id 和领域字段选择对象内的目标数组。 */
function resolveDomainCollection(record: Record<string, unknown>, value: Record<string, unknown>, collections: string[]): string {
  const requested = typeof value.collection === "string"
    ? value.collection
    : typeof value.library === "string"
      ? value.library
      : ""
  if (collections.includes(requested)) return requested
  const id = itemId(value)
  const existing = collections.find((name) => (record[name] as unknown[]).some((entry) => itemId(entry) === id))
  if (existing) return existing
  if (collections.includes("doings") && ("menu_id" in value || "presentation" in value || "init_script" in value)) return "doings"
  if (collections.includes("menus") && ("parent_id" in value || !collections.includes("doings"))) return "menus"
  if (collections.includes("products") && ("item_id" in value || "price" in value || "allow_gift" in value)) return "products"
  if (collections.includes("items") && ("category_id" in value || "stackable" in value || "rarity" in value)) return "items"
  return collections[0] ?? ""
}

/** 对数组领域或包含多个标准数组字段的领域对象应用 patch。 */
function applyDomain(current: unknown, patch: { upsert?: unknown[]; remove?: string[] }): unknown {
  if (Array.isArray(current)) return applyCollection(current, patch)
  if (!current || typeof current !== "object") return current
  const record = structuredClone(current) as Record<string, unknown>
  const collections = Object.keys(record).filter((key) => Array.isArray(record[key]))
  if (collections.length === 0) return record
  const removed = new Set(patch.remove ?? [])
  for (const collection of collections) {
    record[collection] = (record[collection] as unknown[]).filter((entry) => !removed.has(itemId(entry)))
  }
  for (const item of patch.upsert ?? []) {
    if (!item || typeof item !== "object") continue
    const value = item as Record<string, unknown>
    const id = itemId(value)
    if (!id || removed.has(id)) continue
    const collection = resolveDomainCollection(record, value, collections)
    if (!collection) continue
    const clean = stripCollectionHint(value)
    const values = record[collection] as unknown[]
    const index = values.findIndex((entry) => itemId(entry) === id)
    if (index >= 0) values[index] = structuredClone(clean)
    else values.push(structuredClone(clean))
  }
  return record
}

/** 分别处理 normal/important 角色命名空间。 */
function applyRoles(current: StoryRolesFile, patch: { upsert?: unknown[]; remove?: string[] }): StoryRolesFile {
  const next = structuredClone(current)
  const remove = new Set(patch.remove ?? [])
  for (const item of patch.upsert ?? []) {
    if (!item || typeof item !== "object") continue
    const value = item as Record<string, unknown>
    const namespace = value.namespace === "important" || value.role_type === "important" ? "important" : "normal"
    const role = { ...value }
    delete role.namespace
    delete role.role_type
    const id = itemId(role)
    if (!id || remove.has(id)) continue
    const roles = next[namespace].roles as unknown as Array<Record<string, unknown>>
    const index = roles.findIndex((entry) => itemId(entry) === id)
    if (index >= 0) roles[index] = structuredClone(role)
    else roles.push(structuredClone(role))
  }
  next.normal.roles = next.normal.roles.filter((role) => !remove.has(itemId(role)))
  next.important.roles = next.important.roles.filter((role) => !remove.has(itemId(role)))
  return next
}

/** 应用变量分组 patch。 */
function applyVals(current: StoryValsFile, patch: { upsert?: unknown[]; remove?: string[] }): StoryValsFile {
  const next = structuredClone(current)
  const values = next.variables as unknown as Array<Record<string, unknown>>
  const remove = new Set(patch.remove ?? [])
  const remaining = values.filter((entry) => !remove.has(itemId(entry)))
  next.variables = remaining as unknown as StoryValsFile["variables"]
  for (const item of patch.upsert ?? []) {
    if (!item || typeof item !== "object") continue
    const id = itemId(item)
    if (!id || remove.has(id)) continue
    const index = remaining.findIndex((entry) => itemId(entry) === id)
    if (index >= 0) remaining[index] = structuredClone(item) as Record<string, unknown>
    else remaining.push(structuredClone(item) as Record<string, unknown>)
  }
  return next
}

/** 应用联系人多个 library 的 patch。 */
function applyContact(current: StoryContactFile, patch: { upsert?: unknown[]; remove?: string[] }): StoryContactFile {
  const next = structuredClone(current)
  const remove = new Set(patch.remove ?? [])
  const collections = ["channels", "personality_library", "talk_library", "action_library", "reply_library", "player_quick_messages", "contact_profiles"] as const
  for (const collection of collections) {
    const values = next[collection] as unknown[]
    next[collection] = values.filter((entry) => !remove.has(itemId(entry))) as never
  }
  for (const item of patch.upsert ?? []) {
    if (!item || typeof item !== "object") continue
    const value = item as Record<string, unknown>
    const requested = typeof value.collection === "string" ? value.collection : typeof value.library === "string" ? value.library : ""
    const collection = (collections as readonly string[]).includes(requested) ? requested as typeof collections[number] : collections.find((name) => (next[name] as unknown[]).some((entry) => itemId(entry) === itemId(value))) ?? "talk_library"
    const clean = { ...value }
    delete clean.collection
    delete clean.library
    if (remove.has(itemId(clean))) continue
    const values = next[collection] as unknown[]
    const index = values.findIndex((entry) => itemId(entry) === itemId(clean))
    if (index >= 0) values[index] = structuredClone(clean)
    else values.push(structuredClone(clean))
  }
  return next
}

/** 按父依赖、scope 层级、sequence 和 id 做确定性拓扑排序。 */
export function orderEvolutionPackages(packages: readonly StoryEvolutionPackage[]): StoryEvolutionPackage[] {
  const byId = new Map(packages.map((pkg) => [pkg.package_id, pkg]))
  const result: StoryEvolutionPackage[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  /** 深度优先访问一个包及其父包。 */
  const visit = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`Evolution package dependency cycle at ${id}.`)
    const pkg = byId.get(id)
    if (!pkg) throw new Error(`Missing evolution package dependency ${id}.`)
    visiting.add(id)
    for (const parent of pkg.parent_package_ids) visit(parent)
    visiting.delete(id)
    visited.add(id)
    result.push(pkg)
  }
  const scopeRank: Record<StoryEvolutionScope["type"], number> = { global: 0, shard: 1, player: 2 }
  for (const pkg of [...packages].sort((a, b) => scopeRank[a.scope.type] - scopeRank[b.scope.type] || a.sequence - b.sequence || a.package_id.localeCompare(b.package_id))) visit(pkg.package_id)
  return result
}

/** 将有序内容包合并到基础故事文档，并汇总语义条目和 world state。 */
export function applyEvolutionPackages(document: StoryDocument, packages: readonly StoryEvolutionPackage[]): { document: StoryDocument; semanticEntries: StorySemanticContactIntent[]; worldState: Record<string, string | number | boolean | null>; packageIds: string[] } {
  let next = structuredClone(document) as StoryDocument
  const semanticEntries: StorySemanticContactIntent[] = []
  const worldState: Record<string, string | number | boolean | null> = {}
  const ordered = orderEvolutionPackages(packages)
  for (const pkg of ordered) {
    const patch = pkg.patch
    const domains: Array<[keyof StoryEvolutionPatch, keyof StoryDocument]> = [
      ["vals", "vals"], ["roles", "roles"], ["items", "items"], ["eventLocations", "eventLocations"],
      ["chainEvents", "chainEvents"], ["poolEvents", "poolEvents"], ["scheduleEvents", "scheduleEvents"],
      ["contact", "contact"], ["contactConversations", "contactConversations"], ["doing", "doing"], ["shop", "shop"]
    ]
    for (const [patchKey, domainKey] of domains) {
      const domainPatch = patch[patchKey]
      if (domainPatch) {
        if (patchKey === "roles") (next as unknown as Record<string, unknown>)[domainKey] = applyRoles(next.roles, domainPatch)
        else if (patchKey === "vals") (next as unknown as Record<string, unknown>)[domainKey] = applyVals(next.vals, domainPatch)
        else if (patchKey === "contact") (next as unknown as Record<string, unknown>)[domainKey] = applyContact(next.contact, domainPatch)
        else (next as unknown as Record<string, unknown>)[domainKey] = applyDomain((next as unknown as Record<string, unknown>)[domainKey], domainPatch)
      }
    }
    const entriesPatch = patch.semantic_entries
    const removedSemanticIds = new Set(entriesPatch?.remove ?? [])
    if (entriesPatch) {
      const merged = applyCollection(semanticEntries, entriesPatch) as StorySemanticContactIntent[]
      semanticEntries.splice(0, semanticEntries.length, ...merged)
    }
    Object.assign(worldState, patch.world_state_patch, pkg.world_state_patch)
    for (const entry of pkg.semantic_entries) {
      if (removedSemanticIds.has(entry.id)) continue
      const index = semanticEntries.findIndex((existing) => existing.id === entry.id)
      if (index >= 0) semanticEntries[index] = structuredClone(entry)
      else semanticEntries.push(structuredClone(entry))
    }
  }
  return { document: next, semanticEntries, worldState, packageIds: ordered.map((pkg) => pkg.package_id) }
}

/** 对指定联系人执行余弦相似度 top-k、阈值和 margin 判定。 */
export function matchSemanticIntent(inputVector: readonly number[], entries: readonly StorySemanticContactIntent[], options: { roleKey: string; minMargin?: number } ): { entry: StorySemanticContactIntent; score: number } | null {
  const candidates = entries.filter((entry) => entry.role_key === options.roleKey && entry.vector && entry.vector.length === inputVector.length)
  const scored = candidates.map((entry) => ({ entry, score: entry.vector!.reduce((sum, value, index) => sum + value * inputVector[index]!, 0) })).sort((a, b) => b.score - a.score || b.entry.priority - a.entry.priority)
  const best = scored[0]
  if (!best || best.score < best.entry.min_score) return null
  if (scored[1] && best.score - scored[1].score < (options.minMargin ?? 0.03)) return null
  return best
}
