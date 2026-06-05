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

function normalizeRoleId(id: string) {
  return id.trim()
}

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

export function buildStoryRoleKey(scope: StoryRoleScope, id: string) {
  return `${scope}:${normalizeRoleId(id)}`
}

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

export function normalizeStoryRoleKey(roles: StoryRolesFile, roleKey: string) {
  return findStoryRoleReference(roles, roleKey)?.key ?? roleKey.trim()
}
