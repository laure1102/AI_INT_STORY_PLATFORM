import type { StoryDocument, ValidationIssue, ValidationResult } from "./types"
import { evaluateStoryBooleanExpression } from "@story-mgr/storyscript"

export interface StorySemanticContactIntentCore {
  id: string
  role_key: string
  utterances: string[]
  response_kind: "talk" | "action"
  response_id: string
  condition_expr: string
  min_score: number
  priority: number
  vector?: number[]
}

/** 提取条件表达式中访问的 world 键。 */
function worldKeysInExpression(expression: string): string[] {
  return Array.from(expression.matchAll(/\$\{world\.([A-Za-z_][A-Za-z0-9_-]*)\}/g), (match) => match[1]!)
}

/** 检测语义条件中禁止的赋值或自增操作。 */
function containsAssignment(expression: string): boolean {
  return /(?:^|[^=!<>])(?:\+=|-=|\*=|\/=|%=|=(?!=))|\+\+|--/.test(expression)
}

/** 验证演化包中的语义联系人条目只能引用联系人领域已有能力。 */
export function validateSemanticContactIntents(
  document: StoryDocument,
  entries: readonly StorySemanticContactIntentCore[]
): ValidationResult {
  const issues: ValidationIssue[] = []
  const roleKeys = new Set([
    ...document.roles.normal.roles.map((role) => `normal:${role.id}`),
    ...document.roles.important.roles.map((role) => `important:${role.id}`)
  ])
  const talks = new Set(document.contact.talk_library.map((item) => item.id))
  const actions = new Set(document.contact.action_library.map((item) => item.id))
  const validationVals = {
    variables: [
      ...structuredClone(document.vals.variables),
      ...structuredClone(document.systemVals.variables)
    ]
  }
  const seen = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    const path = ["semantic_entries", String(index)]
    if (seen.has(entry.id)) issues.push({ level: "error", code: "semantic.duplicate-id", message: `Duplicate semantic intent "${entry.id}".`, path })
    seen.add(entry.id)
    if (!roleKeys.has(entry.role_key)) issues.push({ level: "error", code: "semantic.missing-role", message: `Semantic intent references missing role "${entry.role_key}".`, path: [...path, "role_key"] })
    const responseSet = entry.response_kind === "talk" ? talks : actions
    if (!responseSet.has(entry.response_id)) issues.push({ level: "error", code: "semantic.missing-response", message: `Semantic intent references missing ${entry.response_kind} "${entry.response_id}".`, path: [...path, "response_id"] })
    if (entry.condition_expr.trim()) {
      try {
        if (containsAssignment(entry.condition_expr)) throw new Error("Semantic conditions are read-only and cannot assign values.")
        const worldKeys = worldKeysInExpression(entry.condition_expr)
        const vals = structuredClone(validationVals)
        if (worldKeys.length > 0) {
          vals.variables.push({ name: "world", vals: Array.from(new Set(worldKeys), (name) => ({ name, value_type: "value" as const, value: 0, calc_rule: "" })) })
        }
        evaluateStoryBooleanExpression(vals, entry.condition_expr)
      } catch (error) {
        issues.push({ level: "error", code: "semantic.invalid-condition", message: error instanceof Error ? error.message : "Invalid condition expression.", path: [...path, "condition_expr"] })
      }
    }
    if (entry.vector && entry.vector.length !== 512) issues.push({ level: "error", code: "semantic.invalid-vector", message: "Semantic vector must have dimension 512.", path: [...path, "vector"] })
    if (entry.vector?.length === 512) {
      const norm = Math.sqrt(entry.vector.reduce((sum, value) => sum + value * value, 0))
      if (Math.abs(norm - 1) > 0.001) issues.push({ level: "error", code: "semantic.vector-not-normalized", message: "Semantic vector must be normalized.", path: [...path, "vector"] })
    }
  }
  return { ok: issues.every((issue) => issue.level !== "error"), issues }
}

/** 校验演化 patch 不包含受保护的基础配置或执行器字段。 */
export function validateEvolutionPatchKeys(patch: Record<string, unknown>): ValidationResult {
  const issues: ValidationIssue[] = []
  const forbidden = ["system_vals", "systemVals", "player_override_vals", "playerOverrideVals", "story_bible", "storyBible", "script_executor", "runtime_script_executor"]
  /** 递归检查所有 patch 嵌套字段。 */
  const visit = (value: unknown, path: string[]) => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]))
      return
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.includes(key)) issues.push({ level: "error", code: "evolution.protected-field", message: `Evolution patch cannot modify protected field "${key}".`, path: [...path, key] })
      visit(nested, [...path, key])
    }
  }
  visit(patch, [])
  return { ok: issues.length === 0, issues }
}

/** 验证包声明的父包链、基础 hash 和 scope 顺序，拒绝孤儿及循环依赖。 */
export function validateEvolutionPackageDependencies(
  packages: readonly { package_id: string; base_content_hash: string; parent_package_ids: string[]; scope: { type: "global" | "shard" | "player"; id: string }; sequence: number }[],
  baseContentHash: string
): ValidationResult {
  const issues: ValidationIssue[] = []
  const byId = new Map(packages.map((pkg) => [pkg.package_id, pkg]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const rank = { global: 0, shard: 1, player: 2 } as const
  /** 深度优先校验一个包及其父依赖。 */
  const visit = (id: string) => {
    if (visited.has(id)) return
    const pkg = byId.get(id)
    if (!pkg) { issues.push({ level: "error", code: "evolution.missing-parent", message: `Missing parent package "${id}".`, path: ["parent_package_ids"] }); return }
    if (visiting.has(id)) { issues.push({ level: "error", code: "evolution.parent-cycle", message: `Evolution package dependency cycle at "${id}".`, path: ["package_id"] }); return }
    visiting.add(id)
    if (pkg.base_content_hash !== baseContentHash) issues.push({ level: "error", code: "evolution.base-hash", message: `Package "${id}" has a mismatched base content hash.`, path: ["base_content_hash"] })
    if (pkg.scope.type === "global" && pkg.scope.id !== "global") issues.push({ level: "error", code: "evolution.global-scope-id", message: `Package "${id}" uses an invalid global scope id.`, path: ["scope", "id"] })
    for (const parentId of pkg.parent_package_ids) {
      const parent = byId.get(parentId)
      if (parent && (rank[parent.scope.type] > rank[pkg.scope.type] || (rank[parent.scope.type] === rank[pkg.scope.type] && parent.sequence > pkg.sequence))) issues.push({ level: "error", code: "evolution.order", message: `Package "${id}" depends on a later package.`, path: ["parent_package_ids"] })
      if (parent && parent.scope.type === pkg.scope.type && parent.scope.id !== pkg.scope.id) issues.push({ level: "error", code: "evolution.scope-lineage", message: `Package "${id}" depends on a different ${pkg.scope.type} scope.`, path: ["parent_package_ids"] })
      visit(parentId)
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const pkg of packages) visit(pkg.package_id)
  return { ok: issues.every((issue) => issue.level !== "error"), issues }
}
