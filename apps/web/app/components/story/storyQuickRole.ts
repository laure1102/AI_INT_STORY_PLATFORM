import {
  buildStoryRoleKey,
  type StoryImportantRoleDefinition,
  type StoryNormalRoleDefinition,
  type StoryRoleScope,
  type StoryRolesFile
} from "@story-mgr/core"

export interface StoryQuickCreateRolePayload {
  descr: string
  id: string
  name: string
  qufenXingbie: boolean
  roleKey: string
  scope: StoryRoleScope
  zhiye: string
}

/** 清理 `QuickRoleIdInput` 输入中的非法字符或范围。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function sanitizeQuickRoleIdInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/** 判断 `hasQuickRoleIdConflict` 对应的条件是否成立。 @param roles 调用方传入的 `roles`。 @param scope 调用方传入的 `scope`。 @param sanitizedId 调用方传入的 `sanitizedId`。 @returns 布尔判断结果。 */
export function hasQuickRoleIdConflict(
  roles: StoryRolesFile,
  scope: StoryRoleScope,
  sanitizedId: string
) {
  if (!sanitizedId) {
    return false
  }

  const sourceRoles = scope === "important" ? roles.important.roles : roles.normal.roles

  return sourceRoles.some((role) => role.id.trim() === sanitizedId)
}

/** 创建一份新的 `NormalQuickRole` 数据。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
function createNormalQuickRole(payload: StoryQuickCreateRolePayload): StoryNormalRoleDefinition {
  return {
    contact_enabled: false,
    contact_initial_favor: 20,
    contact_track: "none",
    descr: payload.descr.trim(),
    id: payload.id,
    img_compress_1: "",
    img_compress_2: "",
    img_raw: "",
    name: payload.name.trim(),
    prompt: "",
    xingge_id: "",
    xingge_note: "",
    zhiye: payload.zhiye.trim()
  }
}

/** 创建一份新的 `ImportantQuickRole` 数据。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
function createImportantQuickRole(payload: StoryQuickCreateRolePayload): StoryImportantRoleDefinition {
  const baseRole: StoryImportantRoleDefinition = {
    contact_enabled: false,
    contact_initial_favor: 20,
    contact_track: "none",
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
    id: payload.id,
    name: payload.name.trim(),
    prompt: "",
    prompt_female: "",
    prompt_male: "",
    qufen_xingbie: payload.qufenXingbie,
    xingge: "",
    xingge_id: "",
    xingge_note: "",
    zhiye: payload.zhiye.trim()
  }

  return baseRole
}

/** 执行 `appendQuickRoleToRoles` 对应的局部业务逻辑。 @param roles 调用方传入的 `roles`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
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

/** 根据当前输入构建 `QuickCreateRolePayload` 结果。 @param input 调用方传入的 `input`。 @returns 计算、查找或构建后的结果。 */
export function buildQuickCreateRolePayload(input: {
  descr: string
  id: string
  name: string
  qufenXingbie: boolean
  scope: StoryRoleScope
  zhiye: string
}): StoryQuickCreateRolePayload | null {
  const sanitizedId = sanitizeQuickRoleIdInput(input.id)

  if (!sanitizedId) {
    return null
  }

  return {
    descr: input.descr.trim(),
    id: sanitizedId,
    name: input.name.trim(),
    qufenXingbie: input.scope === "important" ? input.qufenXingbie : false,
    roleKey: buildStoryRoleKey(input.scope, sanitizedId),
    scope: input.scope,
    zhiye: input.zhiye.trim()
  }
}
