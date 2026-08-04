import type { StoryEventLocationAssignment, StoryEventLocationFile } from "@story-mgr/core"

export interface StoryQuickCreateLocationPayload {
  descr: string
  id: string
}

/** 清理 `QuickLocationIdInput` 输入中的非法字符或范围。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function sanitizeQuickLocationIdInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/** 判断 `hasQuickLocationIdConflict` 对应的条件是否成立。 @param eventLocations 调用方传入的 `eventLocations`。 @param sanitizedId 调用方传入的 `sanitizedId`。 @returns 布尔判断结果。 */
export function hasQuickLocationIdConflict(
  eventLocations: StoryEventLocationFile,
  sanitizedId: string
) {
  if (!sanitizedId) {
    return false
  }

  return eventLocations.assignments.some((assignment) => assignment.id.trim() === sanitizedId)
}

/** 根据当前输入构建 `QuickCreateLocationPayload` 结果。 @param input 调用方传入的 `input`。 @returns 计算、查找或构建后的结果。 */
export function buildQuickCreateLocationPayload(input: {
  descr: string
  id: string
}): StoryQuickCreateLocationPayload | null {
  const sanitizedId = sanitizeQuickLocationIdInput(input.id)

  if (!sanitizedId) {
    return null
  }

  return {
    descr: input.descr.trim(),
    id: sanitizedId
  }
}

/** 创建一份新的 `QuickLocationAssignment` 数据。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
function createQuickLocationAssignment(
  payload: StoryQuickCreateLocationPayload
): StoryEventLocationAssignment {
  return {
    descr: payload.descr.trim(),
    id: payload.id,
    img_compress_1: "",
    img_compress_2: "",
    img_raw: "",
    prompt: ""
  }
}

/** 执行 `appendQuickLocationToEventLocations` 对应的局部业务逻辑。 @param eventLocations 调用方传入的 `eventLocations`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
export function appendQuickLocationToEventLocations(
  eventLocations: StoryEventLocationFile,
  payload: StoryQuickCreateLocationPayload
): StoryEventLocationFile {
  return {
    ...eventLocations,
    assignments: [...eventLocations.assignments, createQuickLocationAssignment(payload)]
  }
}
