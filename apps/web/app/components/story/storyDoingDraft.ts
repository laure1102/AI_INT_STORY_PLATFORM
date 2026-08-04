/**
 * “行动”编辑器的草稿转换层。
 *
 * 输入是 Core 的菜单、行动和事件表现对象，输出给弹窗及事件详情面板编辑。
 * 这里不保存文件，也不维护当前选中项；这些副作用仍留在父组件中。
 */
import type {
  StoryDoingDefinition,
  StoryDoingMenu,
  StoryEventLocationFile,
  StoryEventPresentation,
  StoryOnceEventFile,
  StoryRolesFile,
  StorySceneFile
} from "@story-mgr/core"

export interface DoingMenuDraft extends StoryDoingMenu {
  draftKey: string
  sortOrderText: string
}

export interface DoingDraft extends StoryDoingDefinition {
  draftKey: string
  cooldownHoursText: string
  isNew: boolean
}

export const EMPTY_ROLES: StoryRolesFile = {
  important: { ai: emptyRoleAi(), roles: [] },
  normal: { ai: emptyRoleAi(), roles: [] }
}

export const EMPTY_EVENT_LOCATIONS: StoryEventLocationFile = {
  ai: { width: 0, height: 0, global_prompt: "", compress_quality_1: 0, compress_quality_2: 0 },
  assignments: []
}

export const EMPTY_SCENES: StorySceneFile = {
  ai: { compress_quality: 0 },
  scenes: []
}

/** 执行 `emptyRoleAi` 对应的局部业务逻辑。 @returns 计算、查找或构建后的结果。 */
function emptyRoleAi() {
  return { width: 0, height: 0, global_prompt: "", compress_quality_1: 0, compress_quality_2: 0 }
}

/** 将 `DoingNumberText` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
export function normalizeDoingNumberText(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback)
}

/** 清理 `DoingId` 输入中的非法字符或范围。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function sanitizeDoingId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

/** 解析 `DoingInteger` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
export function parseDoingInteger(value: unknown, fallback = 0) {
  const parsed = Number(String(value ?? "").trim())
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

/** 复制 `DoingPresentation`，避免共享可变引用。 @param presentation 调用方传入的 `presentation`。 @returns 计算、查找或构建后的结果。 */
export function cloneDoingPresentation(
  presentation?: StoryEventPresentation
): StoryEventPresentation {
  if (presentation?.type === "message") {
    return {
      type: "message",
      message: { ...presentation.message }
    }
  }
  if (presentation?.type === "dialogue") {
    return {
      type: "dialogue",
      dialogues: presentation.dialogues.map((dialogue) => ({ ...dialogue }))
    }
  }
  return { type: "silent" }
}

/** 创建一份新的 `DoingMenuDraft` 数据。 @param menu 调用方传入的 `menu`。 @param nextDraftKey 调用方传入的 `nextDraftKey`。 @returns 计算、查找或构建后的结果。 */
export function createDoingMenuDraft(
  menu: StoryDoingMenu,
  nextDraftKey: (prefix: string) => string
): DoingMenuDraft {
  return {
    ...menu,
    draftKey: nextDraftKey("menu"),
    sortOrderText: normalizeDoingNumberText(menu.sort_order)
  }
}

/** 创建一份新的 `DoingDraft` 数据。 @param doing 调用方传入的 `doing`。 @param nextDraftKey 调用方传入的 `nextDraftKey`。 @param isNew 调用方传入的 `isNew`。 @returns 计算、查找或构建后的结果。 */
export function createDoingDraft(
  doing: StoryDoingDefinition,
  nextDraftKey: (prefix: string) => string,
  isNew = false
): DoingDraft {
  return {
    ...doing,
    object_keys: [...doing.object_keys],
    presentation: cloneDoingPresentation(doing.presentation),
    meta: doing.meta ? { ...doing.meta } : undefined,
    draftKey: nextDraftKey("doing"),
    cooldownHoursText: normalizeDoingNumberText(doing.cooldown_hours),
    isNew
  }
}

/** 创建一份新的 `DoingEditorEvent` 数据。 @param doing 调用方传入的 `doing`。 @returns 计算、查找或构建后的结果。 */
export function createDoingEditorEvent(doing: DoingDraft): StoryOnceEventFile {
  const event: StoryOnceEventFile = {
    id: doing.id,
    title: doing.title,
    trigger_mode: "default",
    trigger_expr: "",
    invoke_params: [],
    init_script: doing.init_script,
    object_keys: [...doing.object_keys],
    presentation: cloneDoingPresentation(doing.presentation),
    location: doing.location,
    bgm: doing.bgm,
    end_script: doing.end_script
  }
  if (doing.meta) event.meta = { ...doing.meta }
  return event
}
