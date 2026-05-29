import type {
  StoryImportantRoleDefinition,
  StoryNormalRoleDefinition,
  StoryRolesFile
} from "./types"

export type StoryRoleScope = "normal" | "important"

export interface StoryRoleReference {
  key: string
  name: string
  scope: StoryRoleScope
  zhiye: string
}

function normalizeRoleName(name: string) {
  return name.trim()
}

function createStoryRoleReference(
  scope: StoryRoleScope,
  role: StoryNormalRoleDefinition | StoryImportantRoleDefinition
): StoryRoleReference {
  return {
    key: buildStoryRoleKey(scope, role.name),
    name: normalizeRoleName(role.name),
    scope,
    zhiye: role.zhiye.trim()
  }
}

export function buildStoryRoleKey(scope: StoryRoleScope, name: string) {
  return `${scope}:${normalizeRoleName(name)}`
}

export function parseStoryRoleKey(roleKey: string): {
  name: string
  scope: StoryRoleScope
} | null {
  const trimmedRoleKey = roleKey.trim()
  const separatorIndex = trimmedRoleKey.indexOf(":")

  if (separatorIndex <= 0) {
    return null
  }

  const scope = trimmedRoleKey.slice(0, separatorIndex)
  const name = normalizeRoleName(trimmedRoleKey.slice(separatorIndex + 1))

  if ((scope !== "normal" && scope !== "important") || !name) {
    return null
  }

  return {
    name,
    scope
  }
}

export function listStoryRoleReferences(roles: StoryRolesFile): StoryRoleReference[] {
  return [
    ...roles.important.roles.map((role) => createStoryRoleReference("important", role)),
    ...roles.normal.roles.map((role) => createStoryRoleReference("normal", role))
  ]
}

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
      (role) => normalizeRoleName(role.name) === parsedRoleKey.name
    )

    return matchedRole
      ? createStoryRoleReference(parsedRoleKey.scope, matchedRole)
      : null
  }

  const legacyMatches = listStoryRoleReferences(roles).filter(
    (roleReference) => roleReference.name === trimmedRoleKey
  )

  return legacyMatches.length === 1 ? (legacyMatches[0] ?? null) : null
}

export function normalizeStoryRoleKey(roles: StoryRolesFile, roleKey: string) {
  return findStoryRoleReference(roles, roleKey)?.key ?? roleKey.trim()
}
