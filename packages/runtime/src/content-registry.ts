import { createHash } from "node:crypto"
import {
  applyEvolutionPackages,
  hashEvolutionPackage,
  orderEvolutionPackages,
  validateEvolutionPackage,
  type StoryEvolutionPackage
} from "@story-mgr/evolution"
import type { RuntimeStoryBundle, RuntimePackageInstallResult } from "./session/contracts-view"

/** Runtime 内容注册表：管理不可变基础 bundle、活动包、待安装包和有效版本指纹。 */
export interface RuntimeContentRegistry {
  getBaseBundle(): RuntimeStoryBundle
  getActivePackageIds(): string[]
  getEffectiveBundle(): RuntimeStoryBundle
  queuePackage(pkg: StoryEvolutionPackage): RuntimePackageInstallResult
  applyPendingPackages(): RuntimePackageInstallResult
  replacePackages(packages: readonly StoryEvolutionPackage[]): RuntimePackageInstallResult
}

/** 将 JSON 值编码为稳定键序字符串。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/** 计算 Runtime 有效内容的稳定 SHA-256。 */
function stableHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex")
}

/** 读取 patch 项目的稳定 id；领域 patch 只接受带 id/name/role_key 的结构化项目。 */
function patchId(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const item = value as Record<string, unknown>
  return typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : typeof item.role_key === "string" ? item.role_key : ""
}

/** 对编译 bundle 的数组或 id 字典应用明确的 upsert/remove 操作。 */
function applyBundleCollection(current: unknown, patch: { upsert?: unknown[]; remove?: string[] }): unknown {
  const remove = new Set(patch.remove ?? [])
  if (Array.isArray(current)) {
    const result = current.filter((item) => !remove.has(patchId(item))).map((item) => structuredClone(item))
    for (const item of patch.upsert ?? []) {
      const id = patchId(item)
      if (!id || remove.has(id)) continue
      const index = result.findIndex((existing) => patchId(existing) === id)
      if (index >= 0) result[index] = structuredClone(item)
      else result.push(structuredClone(item))
    }
    return result
  }
  if (current && typeof current === "object") {
    const result = structuredClone(current) as Record<string, unknown>
    for (const id of remove) delete result[id]
    for (const item of patch.upsert ?? []) {
      const id = patchId(item)
      if (id && !remove.has(id)) result[id] = structuredClone(item)
    }
    return result
  }
  return current
}

/** 去除仅用于选择子集合的 patch 元数据。 */
function stripCollectionHint(value: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...value }
  delete clean.collection
  delete clean.library
  delete clean.namespace
  delete clean.role_type
  return clean
}

/** 为多数组领域选择目标集合。 */
function resolveBundleCollection(record: Record<string, unknown>, value: Record<string, unknown>, collections: string[]): string {
  const requested = typeof value.collection === "string" ? value.collection : typeof value.library === "string" ? value.library : ""
  if (collections.includes(requested)) return requested
  const id = patchId(value)
  const existing = collections.find((name) => (record[name] as unknown[]).some((entry) => patchId(entry) === id))
  if (existing) return existing
  if (collections.includes("contact_profiles") && "role_key" in value) return "contact_profiles"
  if (collections.includes("reply_library") && "replies" in value) return "reply_library"
  if (collections.includes("action_library") && ("cost" in value || "costs" in value || "label" in value)) return "action_library"
  if (collections.includes("personality_library") && ("traits" in value || "personality" in value)) return "personality_library"
  if (collections.includes("channels") && ("preset" in value || "labels" in value)) return "channels"
  if (collections.includes("talk_library")) return "talk_library"
  if (collections.includes("doings") && ("menu_id" in value || "presentation" in value || "init_script" in value)) return "doings"
  if (collections.includes("products") && ("item_id" in value || "price" in value || "allow_gift" in value)) return "products"
  if (collections.includes("items") && ("category_id" in value || "stackable" in value || "rarity" in value)) return "items"
  return collections[0] ?? ""
}

/** 对 Runtime bundle 中的多集合领域应用 upsert/remove。 */
function applyBundleDomainObject(current: unknown, patch: { upsert?: unknown[]; remove?: string[] }): unknown {
  if (Array.isArray(current)) return applyBundleCollection(current, patch)
  if (!current || typeof current !== "object") return current
  const record = structuredClone(current) as Record<string, unknown>
  const collections = Object.keys(record).filter((key) => Array.isArray(record[key]))
  const removed = new Set(patch.remove ?? [])
  for (const collection of collections) {
    record[collection] = (record[collection] as unknown[]).filter((entry) => !removed.has(patchId(entry)))
  }
  for (const item of patch.upsert ?? []) {
    if (!item || typeof item !== "object") continue
    const value = item as Record<string, unknown>
    const id = patchId(value)
    if (!id || removed.has(id)) continue
    const collection = resolveBundleCollection(record, value, collections)
    if (!collection) continue
    const values = record[collection] as unknown[]
    const clean = stripCollectionHint(value)
    const index = values.findIndex((entry) => patchId(entry) === id)
    if (index >= 0) values[index] = structuredClone(clean)
    else values.push(structuredClone(clean))
  }
  return record
}

/** 在没有原始 StoryDocument 时直接对 Runtime bundle 合并演化领域 patch。 */
function applyBundlePatch(bundle: RuntimeStoryBundle, pkg: StoryEvolutionPackage): void {
  const patch = pkg.patch as Record<string, { upsert?: unknown[]; remove?: string[] } | undefined>
  const domains: Record<string, keyof RuntimeStoryBundle> = {
    vals: "vals", roles: "roles", items: "items", eventLocations: "eventLocations", chainEvents: "chainEvents",
    poolEvents: "poolEvents", scheduleEvents: "scheduleEvents", contact: "contact", contactConversations: "contactConversations",
    doing: "doing", shop: "shop"
  }
  for (const [patchKey, bundleKey] of Object.entries(domains)) {
    const domainPatch = patch[patchKey]
    if (!domainPatch) continue
    const current = bundle[bundleKey]
    if (patchKey === "roles" && current && typeof current === "object") {
      const roles = structuredClone(current) as Record<string, unknown>
      const removed = new Set(domainPatch.remove ?? [])
      for (const namespace of ["normal", "important"] as const) {
        const group = roles[namespace]
        if (group && typeof group === "object") {
          const value = group as Record<string, unknown>
          value.roles = (value.roles as unknown[]).filter((role) => !removed.has(patchId(role)))
        }
      }
      for (const item of domainPatch.upsert ?? []) {
        if (!item || typeof item !== "object") continue
        const value = item as Record<string, unknown>
        const id = patchId(value)
        if (!id || removed.has(id)) continue
        const namespace = value.namespace === "important" || value.role_type === "important" ? "important" : "normal"
        const group = roles[namespace] as Record<string, unknown>
        const values = group.roles as unknown[]
        const clean = stripCollectionHint(value)
        const index = values.findIndex((role) => patchId(role) === id)
        if (index >= 0) values[index] = structuredClone(clean)
        else values.push(structuredClone(clean))
      }
      bundle[bundleKey] = roles as never
    } else if (patchKey === "contact" && current && typeof current === "object") {
      bundle[bundleKey] = applyBundleDomainObject(current, domainPatch) as never
    } else if (["contactConversations", "vals", "items", "eventLocations", "doing", "shop"].includes(patchKey)) {
      bundle[bundleKey] = applyBundleDomainObject(current, domainPatch) as never
    } else {
      bundle[bundleKey] = applyBundleCollection(current, domainPatch) as never
    }
  }
}

/** 创建一个以已有编译 bundle 为基础的本地内容注册表。 */
export function createRuntimeContentRegistry(options: {
  baseBundle: RuntimeStoryBundle
  baseDocument?: unknown
  activePackages?: readonly StoryEvolutionPackage[]
}): RuntimeContentRegistry {
  const baseBundle = structuredClone(options.baseBundle)
  const active = new Map<string, StoryEvolutionPackage>((options.activePackages ?? []).map((pkg) => [pkg.package_id, structuredClone(pkg)]))
  const pending: StoryEvolutionPackage[] = []
  let effective = structuredClone(baseBundle)

  /** 从活动包重新构造有效 bundle 和内容 hash。 */
  const rebuild = () => {
    const packages = orderEvolutionPackages([...active.values()])
    if (options.baseDocument) {
      const applied = applyEvolutionPackages(options.baseDocument as Parameters<typeof applyEvolutionPackages>[0], packages)
      effective = {
        ...structuredClone(baseBundle),
        activePackageIds: applied.packageIds,
        semanticEntries: applied.semanticEntries,
        worldState: applied.worldState,
        effectiveContentHash: stableHash({ base: baseBundle.contentHash, packages: packages.map((pkg) => hashEvolutionPackage(Object.fromEntries(Object.entries(pkg).filter(([key]) => key !== "package_hash")) as Omit<StoryEvolutionPackage, "package_hash">)), document: applied.document })
      }
    } else {
      effective = structuredClone(baseBundle)
      const semanticEntries: StoryEvolutionPackage["semantic_entries"] = structuredClone(baseBundle.semanticEntries ?? [])
      const worldState: Record<string, string | number | boolean | null> = { ...(baseBundle.worldState ?? {}) }
      for (const pkg of packages) {
        applyBundlePatch(effective, pkg)
        const semanticPatch = pkg.patch.semantic_entries
        const removedSemanticIds = new Set(semanticPatch?.remove ?? [])
        for (const id of semanticPatch?.remove ?? []) {
          const index = semanticEntries.findIndex((entry) => entry.id === id)
          if (index >= 0) semanticEntries.splice(index, 1)
        }
        for (const entry of semanticPatch?.upsert ?? []) {
          const value = entry as StoryEvolutionPackage["semantic_entries"][number]
          const index = semanticEntries.findIndex((item) => item.id === value.id)
          if (index >= 0) semanticEntries[index] = structuredClone(value)
          else semanticEntries.push(structuredClone(value))
        }
        for (const entry of pkg.semantic_entries) {
          if (removedSemanticIds.has(entry.id)) continue
          const index = semanticEntries.findIndex((item) => item.id === entry.id)
          if (index >= 0) semanticEntries[index] = structuredClone(entry)
          else semanticEntries.push(structuredClone(entry))
        }
        Object.assign(worldState, pkg.patch.world_state_patch, pkg.world_state_patch)
      }
      effective.activePackageIds = packages.map((pkg) => pkg.package_id)
      effective.semanticEntries = semanticEntries
      effective.worldState = worldState
      effective.effectiveContentHash = stableHash({ base: baseBundle.contentHash, packages: effective.activePackageIds, semanticEntries, worldState, content: effective })
    }
  }

  /** 安装单个已校验包并重建有效内容。 */
  const install = (pkg: StoryEvolutionPackage) => {
    active.set(pkg.package_id, structuredClone(pkg))
    rebuild()
  }

  return {
    getBaseBundle: () => structuredClone(baseBundle),
    getActivePackageIds: () => [...(effective.activePackageIds ?? [])],
    getEffectiveBundle: () => structuredClone(effective),
    /** 校验并将新包加入 pending 队列。 */
    queuePackage(pkg) {
      const validation = validateEvolutionPackage(pkg, baseBundle.baseContentHash ?? baseBundle.contentHash)
      if (!validation.ok) return { installed: false, queued: false, packageIds: [...(effective.activePackageIds ?? [])], reason: validation.errors.join("；") }
      const rank = { global: 0, shard: 1, player: 2 } as const
      for (const parentId of pkg.parent_package_ids) {
        const parent = active.get(parentId) ?? pending.find((item) => item.package_id === parentId)
        if (parent && (rank[parent.scope.type] > rank[pkg.scope.type] || (rank[parent.scope.type] === rank[pkg.scope.type] && parent.sequence > pkg.sequence))) {
          return { installed: false, queued: false, packageIds: [...(effective.activePackageIds ?? [])], reason: "父包 scope 或 sequence 顺序无效。" }
        }
      }
      if (active.has(pkg.package_id) || pending.some((item) => item.package_id === pkg.package_id)) return { installed: false, queued: false, packageIds: [...(effective.activePackageIds ?? [])], reason: "内容包已经安装或排队。" }
      pending.push(structuredClone(pkg))
      return { installed: false, queued: true, packageIds: [...(effective.activePackageIds ?? [])] }
    },
    /** 按父依赖排序并安装所有可用 pending 包。 */
    applyPendingPackages() {
      const packages = pending.splice(0)
      const available = new Set(active.keys())
      const installable: StoryEvolutionPackage[] = []
      const unresolved: StoryEvolutionPackage[] = []
      for (const pkg of packages) {
        if (pkg.parent_package_ids.every((parentId) => available.has(parentId) || packages.some((candidate) => candidate.package_id === parentId))) installable.push(pkg)
        else unresolved.push(pkg)
      }
      let ordered: StoryEvolutionPackage[] = []
      try { ordered = orderEvolutionPackages(installable) } catch {
        unresolved.push(...installable)
      }
      for (const pkg of ordered) { install(pkg); available.add(pkg.package_id) }
      pending.push(...unresolved.filter((pkg) => !available.has(pkg.package_id)))
      return { installed: ordered.length > 0, queued: pending.length > 0, packageIds: [...(effective.activePackageIds ?? [])], reason: unresolved.length > 0 ? "存在尚未满足的父包依赖。" : undefined }
    },
    /** 用存档声明的完整包链替换当前活动包。 */
    replacePackages(packages) {
      const next = packages.map((pkg) => structuredClone(pkg))
      const ids = new Set<string>()
      const scopeSequences = new Set<string>()
      for (const pkg of next) {
        const validation = validateEvolutionPackage(pkg, baseBundle.baseContentHash ?? baseBundle.contentHash)
        if (!validation.ok) return { installed: false, queued: false, packageIds: [...(effective.activePackageIds ?? [])], reason: validation.errors.join("；") }
        if (pkg.story_id !== baseBundle.storyId) return { installed: false, queued: false, packageIds: [...(effective.activePackageIds ?? [])], reason: "内容包 story_id 与基础故事不匹配。" }
        if (ids.has(pkg.package_id)) return { installed: false, queued: false, packageIds: [...(effective.activePackageIds ?? [])], reason: "内容包集合包含重复 id。" }
        const scopeSequence = `${pkg.scope.type}:${pkg.scope.id}:${pkg.sequence}`
        if (scopeSequences.has(scopeSequence)) return { installed: false, queued: false, packageIds: [...(effective.activePackageIds ?? [])], reason: "同一 scope 存在重复 sequence。" }
        ids.add(pkg.package_id)
        scopeSequences.add(scopeSequence)
      }
      if (next.some((pkg) => pkg.parent_package_ids.some((parentId) => !ids.has(parentId)))) return { installed: false, queued: false, packageIds: [...(effective.activePackageIds ?? [])], reason: "内容包集合缺少父包。" }
      try { orderEvolutionPackages(next) } catch (error) {
        return { installed: false, queued: false, packageIds: [...(effective.activePackageIds ?? [])], reason: error instanceof Error ? error.message : "内容包依赖无效。" }
      }
      const before = effective.effectiveContentHash ?? effective.contentHash ?? ""
      active.clear()
      for (const pkg of next) active.set(pkg.package_id, pkg)
      pending.length = 0
      rebuild()
      const after = effective.effectiveContentHash ?? effective.contentHash ?? ""
      return { installed: before !== after, queued: false, packageIds: [...(effective.activePackageIds ?? [])] }
    }
  }
}
