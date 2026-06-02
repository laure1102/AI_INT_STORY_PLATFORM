import {
  buildStoryRoleKey,
  type StoryImportantRoleDefinition,
  type StoryNormalRoleDefinition,
  type StoryRoleScope,
  type StoryRolesFile
} from "@story-mgr/core"

export interface StoryQuickCreateRolePayload {
  descr: string
  name: string
  qufenXingbie: boolean
  roleKey: string
  scope: StoryRoleScope
  zhiye: string
}

export function sanitizeQuickRoleNameInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function hasQuickRoleNameConflict(
  roles: StoryRolesFile,
  scope: StoryRoleScope,
  sanitizedName: string
) {
  if (!sanitizedName) {
    return false
  }

  const sourceRoles = scope === "important" ? roles.important.roles : roles.normal.roles

  return sourceRoles.some((role) => role.name.trim() === sanitizedName)
}

function createNormalQuickRole(payload: StoryQuickCreateRolePayload): StoryNormalRoleDefinition {
  return {
    descr: payload.descr.trim(),
    img_compress_1: "",
    img_compress_2: "",
    img_raw: "",
    name: payload.name,
    prompt: "",
    zhiye: payload.zhiye.trim()
  }
}

function createImportantQuickRole(payload: StoryQuickCreateRolePayload): StoryImportantRoleDefinition {
  const baseRole: StoryImportantRoleDefinition = {
    descr: payload.qufenXingbie ? "" : payload.descr.trim(),
    descr_female: payload.qufenXingbie ? payload.descr.trim() : "",
    descr_male: payload.qufenXingbie ? payload.descr.trim() : "",
    img_compress_1: "",
    img_compress_2: "",
    img_female_compress_1: "",
    img_female_compress_2: "",
    img_female_raw: "",
    img_male_compress_1: "",
    img_male_compress_2: "",
    img_male_raw: "",
    img_raw: "",
    name: payload.name,
    prompt: "",
    prompt_female: "",
    prompt_male: "",
    qufen_xingbie: payload.qufenXingbie,
    xingge: "",
    zhiye: payload.zhiye.trim()
  }

  return baseRole
}

export function appendQuickRoleToRoles(
  roles: StoryRolesFile,
  payload: StoryQuickCreateRolePayload
): StoryRolesFile {
  if (payload.scope === "important") {
    return {
      ...roles,
      important: {
        ...roles.important,
        roles: [...roles.important.roles, createImportantQuickRole(payload)]
      }
    }
  }

  return {
    ...roles,
    normal: {
      ...roles.normal,
      roles: [...roles.normal.roles, createNormalQuickRole(payload)]
    }
  }
}

export function buildQuickCreateRolePayload(input: {
  descr: string
  name: string
  qufenXingbie: boolean
  scope: StoryRoleScope
  zhiye: string
}): StoryQuickCreateRolePayload | null {
  const sanitizedName = sanitizeQuickRoleNameInput(input.name)

  if (!sanitizedName) {
    return null
  }

  return {
    descr: input.descr.trim(),
    name: sanitizedName,
    qufenXingbie: input.scope === "important" ? input.qufenXingbie : false,
    roleKey: buildStoryRoleKey(input.scope, sanitizedName),
    scope: input.scope,
    zhiye: input.zhiye.trim()
  }
}
