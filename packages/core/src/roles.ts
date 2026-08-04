/**
 * 普通角色与重要角色的统一引用工具。
 *
 * 持久化数据用 `normal:id` / `important:id` 消除同名歧义；本模块也兼容只有 id 的旧引用。
 */
import type {
  StoryImportantRoleDefinition,
  StoryNormalRoleDefinition,
  StoryRolesFile
} from "./types"

export type StoryRoleScope = "normal" | "important"

export interface StoryRoleReference {
  key: string
  id: string
  scope: StoryRoleScope
  zhiye: string
}

/** @param id 原始角色 id。 @returns 去掉首尾空格的 id。 */
function normalizeRoleId(id: string) {
  return id.trim()
}

/**
 * 把某个角色定义转换成统一引用对象。
 *
 * @param scope 角色来自普通库还是重要角色库。
 * @param role 原始角色定义。
 * @returns 包含规范 key、id、scope 和职业文字的新对象。
 */
function createStoryRoleReference(
  scope: StoryRoleScope,
  role: StoryNormalRoleDefinition | StoryImportantRoleDefinition
): StoryRoleReference {
  return {
    key: buildStoryRoleKey(scope, role.id),
    id: normalizeRoleId(role.id),
    scope,
    zhiye: role.zhiye.trim()
  }
}

/**
 * 创建无歧义角色 key。
 * @param scope 角色库范围。 @param id 角色 id。 @returns `scope:id` 格式字符串。
 */
export function buildStoryRoleKey(scope: StoryRoleScope, id: string) {
  return `${scope}:${normalizeRoleId(id)}`
}

/**
 * 解析规范角色 key。
 *
 * @param roleKey 待解析文字。
 * @returns 合法时返回 scope/id；格式、scope 或 id 不合法时返回 null。
 */
export function parseStoryRoleKey(roleKey: string): {
  id: string
  scope: StoryRoleScope
} | null {
  const trimmedRoleKey = roleKey.trim()
  const separatorIndex = trimmedRoleKey.indexOf(":")

  if (separatorIndex <= 0) {
    return null
  }

  const scope = trimmedRoleKey.slice(0, separatorIndex)
  const id = normalizeRoleId(trimmedRoleKey.slice(separatorIndex + 1))

  if ((scope !== "normal" && scope !== "important") || !id) {
    return null
  }

  return {
    id,
    scope
  }
}

/**
 * 扁平列出两个角色库中的全部引用。
 * @param roles 普通和重要角色文件。 @returns 重要角色在前、普通角色在后的新数组。
 */
export function listStoryRoleReferences(roles: StoryRolesFile): StoryRoleReference[] {
  return [
    ...roles.important.roles.map((role) => createStoryRoleReference("important", role)),
    ...roles.normal.roles.map((role) => createStoryRoleReference("normal", role))
  ]
}

/**
 * 查找规范或旧式角色引用。
 *
 * @param roles 两个角色库。
 * @param roleKey 规范 `scope:id` 或旧式裸 id。
 * @returns 唯一命中时返回引用，否则返回 null。
 *
 * 裸 id 若同时出现在两个角色库会返回 null，不能偷偷猜测角色范围。
 */
export function findStoryRoleReference(
  roles: StoryRolesFile,
  roleKey: string
): StoryRoleReference | null {
  const trimmedRoleKey = roleKey.trim()

  if (!trimmedRoleKey) {
    return null
  }

  const parsedRoleKey = parseStoryRoleKey(trimmedRoleKey)

  if (parsedRoleKey) {
    const sourceRoles =
      parsedRoleKey.scope === "important" ? roles.important.roles : roles.normal.roles
    const matchedRole = sourceRoles.find(
      (role) => normalizeRoleId(role.id) === parsedRoleKey.id
    )

    return matchedRole
      ? createStoryRoleReference(parsedRoleKey.scope, matchedRole)
      : null
  }

  const legacyMatches = listStoryRoleReferences(roles).filter(
    (roleReference) => roleReference.id === trimmedRoleKey
  )

  return legacyMatches.length === 1 ? (legacyMatches[0] ?? null) : null
}

/**
 * 尽可能把旧裸 id 升级成规范 key。
 * @param roles 角色库。 @param roleKey 原引用。 @returns 可唯一解析时返回规范 key，否则仅 trim 原值。
 */
export function normalizeStoryRoleKey(roles: StoryRolesFile, roleKey: string) {
  return findStoryRoleReference(roles, roleKey)?.key ?? roleKey.trim()
}
