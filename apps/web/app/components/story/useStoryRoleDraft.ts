/**
 * 角色草稿状态：负责克隆输入、维护表单状态、图片路径和提示词弹窗。
 *
 * API 只用于读取图片元数据与生成预览地址；真正的生成、压缩和批处理由上层控制器负责。
 */
import type {
  StoryImportantRoleDefinition,
  StoryNormalRoleDefinition,
  StoryRolesFile
} from "@story-mgr/core"
import type { StoryAssetMetadata } from "@story-mgr/shared"
import { computed, reactive, shallowRef } from "vue"
import type { useStoryApi } from "../../composables/useStoryApi"
import {
  imageVariants,
  type ImageVariant,
  type ImportantRoleDraft,
  type ImportantRoleImageMode,
  type ImagePreviewState,
  type NormalRoleDraft,
  type RoleAiDraft,
  type RoleAssetState,
  type RolePromptState,
  type RolesTab,
  type StoryRolesEditorProps
} from "./storyRoleDraft"

type StoryApi = ReturnType<typeof useStoryApi>

export interface UseStoryRoleDraftOptions {
  getStoryAssetMeta: StoryApi["getStoryAssetMeta"]
  getStoryAssetUrl: StoryApi["getStoryAssetUrl"]
  props: Readonly<StoryRolesEditorProps>
}

/** 创建与角色弹窗生命周期绑定的草稿控制器。 @param options 只读 props 以及资产元数据/URL API。 @returns 普通/重要角色草稿、三种性别图片槽状态、提示词编辑器、批处理进度和操作方法；本模块不执行生成或保存。 */
export function useStoryRoleDraft(options: UseStoryRoleDraftOptions) {
  const { getStoryAssetMeta, getStoryAssetUrl, props } = options

const activeTab = shallowRef<RolesTab>("normal")
/** 创建一份新的 `RoleAiDraft` 数据。 @returns 计算、查找或构建后的结果。 */
function createRoleAiDraft(): RoleAiDraft {
  return {
    compressQuality1Text: "60",
    compressQuality2Text: "30",
    globalPrompt: "",
    imageHeightText: "1024",
    imageWidthText: "1536"
  }
}

const draft = reactive({
  importantAi: createRoleAiDraft(),
  importantRoles: [] as ImportantRoleDraft[],
  normalAi: createRoleAiDraft(),
  normalRoles: [] as NormalRoleDraft[]
})

const assetStates = reactive<Record<string, RoleAssetState>>({})
const promptStates = reactive<Record<string, RolePromptState>>({})
const promptEditorState = reactive<{
  mode: ImportantRoleImageMode
  roleKey: string | null
  value: string
}>({
  mode: "common",
  roleKey: null,
  value: ""
})
const imagePreviewState = reactive<ImagePreviewState>({
  path: "",
  title: "",
  url: ""
})
const batchState = reactive({
  commonImageDone: 0,
  commonImageTotal: 0,
  compress1Done: 0,
  compress1Total: 0,
  compress2Done: 0,
  compress2Total: 0,
  compressing1: false,
  compressing2: false,
  femaleImageDone: 0,
  femaleImageTotal: 0,
  generatingCommonImages: false,
  generatingFemaleImages: false,
  generatingMaleImages: false,
  generatingPrompts: false,
  maleImageDone: 0,
  maleImageTotal: 0,
  promptDone: 0,
  promptTotal: 0
})

const personalityOptions = computed(() =>
  props.contact.personality_library.map((entry) => ({
    label: entry.name || entry.id,
    value: entry.id
  }))
)

let draftKeySeed = 0
/** 创建一份新的 `DraftKey` 数据。 @param prefix 调用方传入的 `prefix`。 @returns 计算、查找或构建后的结果。 */
function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}
/** 将 `Text` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}
/** 执行 `clampFavorInput` 对应的局部业务逻辑。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function clampFavorInput(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(parsed)) {
    return 20
  }

  return Math.max(0, Math.min(100, parsed))
}
/** 读取或计算 `PersonalityLabel`。 @param personalityId 调用方传入的 `personalityId`。 @returns 计算、查找或构建后的结果。 */
function getPersonalityLabel(personalityId: string) {
  const matched = props.contact.personality_library.find((entry) => entry.id === personalityId)
  return matched?.name ?? personalityId
}
/** 根据当前输入构建 `RoleXinggePromptText` 结果。 @param role 调用方传入的 `role`。 @returns 计算、查找或构建后的结果。 */
function buildRoleXinggePromptText(role: {
  xingge?: string
  xingge_id?: string
  xingge_note?: string
}) {
  return [
    role.xingge_id ? getPersonalityLabel(role.xingge_id) : "",
    normalizeText(role.xingge_note),
    normalizeText(role.xingge)
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("，")
}
/** 清理 `NameInput` 输入中的非法字符或范围。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function sanitizeNameInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}
/** 解析 `CompressQualityInput` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function parseCompressQualityInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null
}
/** 解析 `ImageDimensionInput` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function parseImageDimensionInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}
/** 创建一份新的 `EmptyAssetState` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyAssetState(): RoleAssetState {
  return {
    error: null,
    loading: false,
    meta: null
  }
}
/** 创建一份新的 `EmptyPromptState` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyPromptState(): RolePromptState {
  return {
    error: null,
    loading: false
  }
}
/** 读取或计算 `PromptStateKey`。 @param draftKey 调用方传入的 `draftKey`。 @returns 计算、查找或构建后的结果。 */
function getPromptStateKey(draftKey: string) {
  return `${draftKey}:prompt`
}
/** 读取或计算 `AssetStateKey`。 @param draftKey 调用方传入的 `draftKey`。 @param mode 调用方传入的 `mode`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetStateKey(
  draftKey: string,
  mode: ImportantRoleImageMode = "common",
  variant: ImageVariant = "raw"
) {
  return `${draftKey}:${mode}:${variant}`
}
/** 执行 `initializeNormalRoleState` 对应的局部业务逻辑。 @param role 调用方传入的 `role`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function initializeNormalRoleState(role: NormalRoleDraft) {
  for (const variant of imageVariants) {
    assetStates[getAssetStateKey(role.draftKey, "common", variant)] = createEmptyAssetState()
  }

  promptStates[getPromptStateKey(role.draftKey)] = createEmptyPromptState()
}
/** 执行 `initializeImportantRoleState` 对应的局部业务逻辑。 @param role 调用方传入的 `role`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function initializeImportantRoleState(role: ImportantRoleDraft) {
  for (const mode of ["common", "male", "female"] as ImportantRoleImageMode[]) {
    for (const variant of imageVariants) {
      assetStates[getAssetStateKey(role.draftKey, mode, variant)] = createEmptyAssetState()
    }
  }

  promptStates[getPromptStateKey(role.draftKey)] = createEmptyPromptState()
}
/** 重置或清理 `clearRoleState` 对应的临时状态。 @param draftKey 调用方传入的 `draftKey`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function clearRoleState(draftKey: string) {
  delete promptStates[getPromptStateKey(draftKey)]

  for (const mode of ["common", "male", "female"] as ImportantRoleImageMode[]) {
    for (const variant of imageVariants) {
      delete assetStates[getAssetStateKey(draftKey, mode, variant)]
    }
  }
}
/** 重置或清理 `resetStates` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function resetStates() {
  for (const key of Object.keys(assetStates)) {
    delete assetStates[key]
  }

  for (const key of Object.keys(promptStates)) {
    delete promptStates[key]
  }
}
/** 读取或计算 `PromptState`。 @param draftKey 调用方传入的 `draftKey`。 @returns 计算、查找或构建后的结果。 */
function getPromptState(draftKey: string) {
  return promptStates[getPromptStateKey(draftKey)]
}
/** 读取或计算 `AssetState`。 @param draftKey 调用方传入的 `draftKey`。 @param mode 调用方传入的 `mode`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetState(
  draftKey: string,
  mode: ImportantRoleImageMode = "common",
  variant: ImageVariant = "raw"
) {
  return assetStates[getAssetStateKey(draftKey, mode, variant)]
}
/** 复制 `NormalRole`，避免共享可变引用。 @param role 调用方传入的 `role`。 @returns 计算、查找或构建后的结果。 */
function cloneNormalRole(role: StoryNormalRoleDefinition): NormalRoleDraft {
  const draftRole: NormalRoleDraft = {
    contact_enabled: Boolean(role.contact_enabled),
    contact_initial_favor: Number(role.contact_initial_favor ?? 20),
    contact_track: role.contact_track ?? "none",
    descr: normalizeText(role.descr),
    draftKey: createDraftKey("normal-role"),
    id: normalizeText(role.id),
    img_compress_1: normalizeText(role.img_compress_1),
    img_compress_2: normalizeText(role.img_compress_2),
    img_raw: normalizeText(role.img_raw),
    name: normalizeText(role.name),
    prompt: normalizeText(role.prompt),
    selected: false,
    xingge_id: normalizeText(role.xingge_id),
    xingge_note: normalizeText(role.xingge_note),
    zhiye: normalizeText(role.zhiye)
  }

  initializeNormalRoleState(draftRole)
  return draftRole
}
/** 复制 `ImportantRole`，避免共享可变引用。 @param role 调用方传入的 `role`。 @returns 计算、查找或构建后的结果。 */
function cloneImportantRole(role: StoryImportantRoleDefinition): ImportantRoleDraft {
  const draftRole: ImportantRoleDraft = {
    contact_enabled: Boolean(role.contact_enabled),
    contact_initial_favor: Number(role.contact_initial_favor ?? 20),
    contact_track: role.contact_track ?? "none",
    descr: normalizeText(role.descr),
    descr_female: normalizeText(role.descr_female),
    descr_male: normalizeText(role.descr_male),
    draftKey: createDraftKey("important-role"),
    id: normalizeText(role.id),
    img_compress_1: normalizeText(role.img_compress_1),
    img_compress_2: normalizeText(role.img_compress_2),
    img_female_compress_1: normalizeText(role.img_female_compress_1),
    img_female_compress_2: normalizeText(role.img_female_compress_2),
    img_female_raw: normalizeText(role.img_female_raw),
    img_male_compress_1: normalizeText(role.img_male_compress_1),
    img_male_compress_2: normalizeText(role.img_male_compress_2),
    img_male_raw: normalizeText(role.img_male_raw),
    img_raw: normalizeText(role.img_raw),
    name: normalizeText(role.name),
    prompt: normalizeText(role.prompt),
    prompt_female: normalizeText(role.prompt_female),
    prompt_male: normalizeText(role.prompt_male),
    qufen_xingbie: Boolean(role.qufen_xingbie),
    selected: false,
    xingge: normalizeText(role.xingge),
    xingge_id: normalizeText(role.xingge_id),
    xingge_note: normalizeText(role.xingge_note),
    zhiye: normalizeText(role.zhiye)
  }

  initializeImportantRoleState(draftRole)
  return draftRole
}
/** 把 `Bytes` 转换成界面可读文本。 @param sizeBytes 调用方传入的 `sizeBytes`。 @returns 计算、查找或构建后的结果。 */
function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
}
/** 把 `AssetMeta` 转换成界面可读文本。 @param meta 调用方传入的 `meta`。 @returns 计算、查找或构建后的结果。 */
function formatAssetMeta(meta: StoryAssetMetadata | null) {
  if (!meta) return ""

  const dimensions =
    typeof meta.width === "number" && typeof meta.height === "number"
      ? `${meta.width} x ${meta.height}`
      : "尺寸未知"

  return `${dimensions} / ${formatBytes(meta.sizeBytes)}`
}
/** 把 `ErrorMessage` 转换成界面可读文本。 @param error 调用方传入的 `error`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
function formatErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const responseError = error as {
      data?: {
        error?: {
          message?: string
        }
      }
      message?: string
      statusMessage?: string
    }

    const apiMessage = responseError.data?.error?.message?.trim()

    if (apiMessage) {
      return apiMessage
    }

    if (typeof responseError.message === "string" && responseError.message.trim()) {
      return responseError.message
    }

    if (typeof responseError.statusMessage === "string" && responseError.statusMessage.trim()) {
      return responseError.statusMessage
    }
  }

  return error instanceof Error ? error.message : fallback
}
/** 读取或计算 `PromptPreview`。 @param prompt 调用方传入的 `prompt`。 @returns 计算、查找或构建后的结果。 */
function getPromptPreview(prompt: string) {
  const trimmedPrompt = prompt.trim()
  return trimmedPrompt ? trimmedPrompt.slice(0, 48) : "编辑提示词"
}
/** 把 `RoleAiDraft` 结果应用到当前草稿或状态。 @param target 调用方传入的 `target`。 @param source 调用方传入的 `source`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
function applyRoleAiDraft(
  target: RoleAiDraft,
  source: {
    compress_quality_1?: number
    compress_quality_2?: number
    global_prompt?: string
    height?: number
    width?: number
  }
) {
  target.globalPrompt = normalizeText(source.global_prompt)
  target.imageWidthText = String(source.width ?? 1536)
  target.imageHeightText = String(source.height ?? 1024)
  target.compressQuality1Text = String(source.compress_quality_1 ?? 60)
  target.compressQuality2Text = String(source.compress_quality_2 ?? 30)
}
/** 读取或计算 `ActiveAiDraft`。 @returns 计算、查找或构建后的结果。 */
function getActiveAiDraft() {
  return activeTab.value === "normal" ? draft.normalAi : draft.importantAi
}
/** 把外部或服务端数据同步到本地响应式状态。 @param roles 调用方传入的 `roles`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(roles: StoryRolesFile) {
  resetStates()
  applyRoleAiDraft(draft.normalAi, roles.normal.ai)
  applyRoleAiDraft(draft.importantAi, roles.important.ai)
  draft.normalRoles = roles.normal.roles.map(cloneNormalRole)
  draft.importantRoles = roles.important.roles.map(cloneImportantRole)
  void hydrateAssetMeta()
}
/** 异步加载 `AssetMeta` 数据并更新响应式状态。 @param draftKey 调用方传入的 `draftKey`。 @param assetPath 调用方传入的 `assetPath`。 @param mode 调用方传入的 `mode`。 @param variant 调用方传入的 `variant`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
async function loadAssetMeta(
  draftKey: string,
  assetPath: string,
  mode: ImportantRoleImageMode = "common",
  variant: ImageVariant = "raw"
) {
  const state = getAssetState(draftKey, mode, variant)
  const trimmedPath = assetPath.trim()

  state.error = null

  if (!trimmedPath) {
    state.loading = false
    state.meta = null
    return
  }

  state.loading = true

  try {
    const asset = await getStoryAssetMeta(props.storyId, trimmedPath)
    state.meta = asset
  } catch (error) {
    state.meta = null
    state.error = formatErrorMessage(error, "读取图片信息失败。")
  } finally {
    state.loading = false
  }
}
/** 执行 `hydrateAssetMeta` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
async function hydrateAssetMeta() {
  const tasks: Promise<void>[] = []

  for (const role of draft.normalRoles) {
    for (const variant of imageVariants) {
      tasks.push(loadAssetMeta(role.draftKey, getNormalAssetPath(role, variant), "common", variant))
    }
  }

  for (const role of draft.importantRoles) {
    if (role.qufen_xingbie) {
      for (const variant of imageVariants) {
        tasks.push(loadAssetMeta(role.draftKey, getImportantAssetPath(role, "male", variant), "male", variant))
        tasks.push(loadAssetMeta(role.draftKey, getImportantAssetPath(role, "female", variant), "female", variant))
      }
      continue
    }

    for (const variant of imageVariants) {
      tasks.push(loadAssetMeta(role.draftKey, getImportantAssetPath(role, "common", variant), "common", variant))
    }
  }

  await Promise.allSettled(tasks)
}
/** 读取或计算 `ImageVariantLabel`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getImageVariantLabel(variant: ImageVariant) {
  if (variant === "raw") return "原图"
  if (variant === "compress1") return "压缩图1"
  return "压缩图2"
}
/** 读取或计算 `RoleImageModeLabel`。 @param mode 调用方传入的 `mode`。 @returns 计算、查找或构建后的结果。 */
function getRoleImageModeLabel(mode: ImportantRoleImageMode) {
  if (mode === "male") return "男图"
  if (mode === "female") return "女图"
  return "通用图"
}
/** 读取或计算 `ImagePreviewTitle`。 @param name 调用方传入的 `name`。 @param variant 调用方传入的 `variant`。 @param mode 调用方传入的 `mode`。 @returns 计算、查找或构建后的结果。 */
function getImagePreviewTitle(
  name: string,
  variant: ImageVariant,
  mode?: ImportantRoleImageMode
) {
  const trimmedName = name.trim() || "角色"
  const suffix = mode ? `${getRoleImageModeLabel(mode)} ${getImageVariantLabel(variant)}` : getImageVariantLabel(variant)
  return `${trimmedName} ${suffix}`
}
/** 读取或计算 `NormalAssetPath`。 @param role 调用方传入的 `role`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getNormalAssetPath(role: NormalRoleDraft, variant: ImageVariant) {
  if (variant === "compress1") return role.img_compress_1.trim()
  if (variant === "compress2") return role.img_compress_2.trim()
  return role.img_raw.trim()
}
/** 更新 `NormalAssetPath` 对应的响应式值。 @param role 调用方传入的 `role`。 @param variant 调用方传入的 `variant`。 @param assetPath 调用方传入的 `assetPath`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setNormalAssetPath(role: NormalRoleDraft, variant: ImageVariant, assetPath: string) {
  if (variant === "compress1") {
    role.img_compress_1 = assetPath
    return
  }

  if (variant === "compress2") {
    role.img_compress_2 = assetPath
    return
  }

  role.img_raw = assetPath
}
/** 读取或计算 `NormalAssetUrl`。 @param role 调用方传入的 `role`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getNormalAssetUrl(role: NormalRoleDraft, variant: ImageVariant) {
  const assetPath = getNormalAssetPath(role, variant)
  return assetPath ? getStoryAssetUrl(props.storyId, assetPath) : ""
}
/** 读取或计算 `ImportantAssetPath`。 @param role 调用方传入的 `role`。 @param mode 调用方传入的 `mode`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getImportantAssetPath(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  variant: ImageVariant
) {
  if (mode === "male") {
    if (variant === "compress1") return role.img_male_compress_1.trim()
    if (variant === "compress2") return role.img_male_compress_2.trim()
    return role.img_male_raw.trim()
  }

  if (mode === "female") {
    if (variant === "compress1") return role.img_female_compress_1.trim()
    if (variant === "compress2") return role.img_female_compress_2.trim()
    return role.img_female_raw.trim()
  }

  if (variant === "compress1") return role.img_compress_1.trim()
  if (variant === "compress2") return role.img_compress_2.trim()
  return role.img_raw.trim()
}
/** 更新 `ImportantAssetPath` 对应的响应式值。 @param role 调用方传入的 `role`。 @param mode 调用方传入的 `mode`。 @param variant 调用方传入的 `variant`。 @param assetPath 调用方传入的 `assetPath`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setImportantAssetPath(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  variant: ImageVariant,
  assetPath: string
) {
  if (mode === "male") {
    if (variant === "compress1") {
      role.img_male_compress_1 = assetPath
      return
    }

    if (variant === "compress2") {
      role.img_male_compress_2 = assetPath
      return
    }

    role.img_male_raw = assetPath
    return
  }

  if (mode === "female") {
    if (variant === "compress1") {
      role.img_female_compress_1 = assetPath
      return
    }

    if (variant === "compress2") {
      role.img_female_compress_2 = assetPath
      return
    }

    role.img_female_raw = assetPath
    return
  }

  if (variant === "compress1") {
    role.img_compress_1 = assetPath
    return
  }

  if (variant === "compress2") {
    role.img_compress_2 = assetPath
    return
  }

  role.img_raw = assetPath
}
/** 读取或计算 `ImportantAssetUrl`。 @param role 调用方传入的 `role`。 @param mode 调用方传入的 `mode`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getImportantAssetUrl(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  variant: ImageVariant
) {
  const assetPath = getImportantAssetPath(role, mode, variant)
  return assetPath ? getStoryAssetUrl(props.storyId, assetPath) : ""
}
/** 打开 `ImagePreview` 界面并初始化临时状态。 @param title 调用方传入的 `title`。 @param assetPath 调用方传入的 `assetPath`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openImagePreview(title: string, assetPath: string) {
  const trimmedPath = assetPath.trim()

  if (!trimmedPath) return

  imagePreviewState.path = trimmedPath
  imagePreviewState.title = title
  imagePreviewState.url = getStoryAssetUrl(props.storyId, trimmedPath)
}
/** 关闭 `ImagePreview` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeImagePreview() {
  imagePreviewState.path = ""
  imagePreviewState.title = ""
  imagePreviewState.url = ""
}
/** 读取或计算 `ImportantRolePrompt`。 @param role 调用方传入的 `role`。 @param mode 调用方传入的 `mode`。 @returns 计算、查找或构建后的结果。 */
function getImportantRolePrompt(role: ImportantRoleDraft, mode: ImportantRoleImageMode) {
  if (mode === "male") return role.prompt_male.trim()
  if (mode === "female") return role.prompt_female.trim()
  return role.prompt.trim()
}
/** 更新 `ImportantRolePrompt` 对应的响应式值。 @param role 调用方传入的 `role`。 @param mode 调用方传入的 `mode`。 @param prompt 调用方传入的 `prompt`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setImportantRolePrompt(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  prompt: string
) {
  if (mode === "male") {
    role.prompt_male = prompt
    return
  }

  if (mode === "female") {
    role.prompt_female = prompt
    return
  }

  role.prompt = prompt
}
/** 读取或计算 `NextDefaultId`。 @param target 调用方传入的 `target`。 @returns 计算、查找或构建后的结果。 */
function getNextDefaultId(target: RolesTab) {
  const source = target === "normal" ? draft.normalRoles : draft.importantRoles
  const prefix = target === "normal" ? "normal_role" : "important_role"
  const usedIds = new Set(source.map((role) => role.id.trim()).filter(Boolean))

  let index = source.length + 1
  let candidate = `${prefix}_${index}`

  while (usedIds.has(candidate)) {
    index += 1
    candidate = `${prefix}_${index}`
  }

  return candidate
}
/** 读取或计算 `RoleDisplayName`。 @param role 调用方传入的 `role`。 @returns 计算、查找或构建后的结果。 */
function getRoleDisplayName(role: { name?: string; id: string }) {
  return normalizeText(role.name).trim() || normalizeText(role.id).trim() || "角色"
}
/** 新增一项 `NormalRole` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addNormalRole() {
  const role: NormalRoleDraft = {
    contact_enabled: false,
    contact_initial_favor: 20,
    contact_track: "none",
    descr: "",
    draftKey: createDraftKey("normal-role"),
    img_compress_1: "",
    img_compress_2: "",
    img_raw: "",
    name: "",
    id: getNextDefaultId("normal"),
    prompt: "",
    selected: false,
    xingge_id: "",
    xingge_note: "",
    zhiye: ""
  }

  initializeNormalRoleState(role)
  draft.normalRoles.push(role)
}
/** 新增一项 `ImportantRole` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addImportantRole() {
  const role: ImportantRoleDraft = {
    contact_enabled: false,
    contact_initial_favor: 20,
    contact_track: "none",
    descr: "",
    descr_female: "",
    descr_male: "",
    draftKey: createDraftKey("important-role"),
    img_compress_1: "",
    img_compress_2: "",
    img_female_compress_1: "",
    img_female_compress_2: "",
    img_female_raw: "",
    img_male_compress_1: "",
    img_male_compress_2: "",
    img_male_raw: "",
    img_raw: "",
    name: "",
    id: getNextDefaultId("important"),
    prompt: "",
    prompt_female: "",
    prompt_male: "",
    qufen_xingbie: false,
    selected: false,
    xingge: "",
    xingge_id: "",
    xingge_note: "",
    zhiye: ""
  }

  initializeImportantRoleState(role)
  draft.importantRoles.push(role)
}
/** 移除指定的 `NormalRole` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeNormalRole(index: number) {
  const role = draft.normalRoles[index]
  if (!role) return
  clearRoleState(role.draftKey)
  draft.normalRoles.splice(index, 1)
}
/** 移除指定的 `ImportantRole` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeImportantRole(index: number) {
  const role = draft.importantRoles[index]
  if (!role) return
  clearRoleState(role.draftKey)
  draft.importantRoles.splice(index, 1)
}
/** 打开 `PromptEditor` 界面并初始化临时状态。 @param draftKey 调用方传入的 `draftKey`。 @param prompt 调用方传入的 `prompt`。 @param mode 调用方传入的 `mode`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openPromptEditor(
  draftKey: string,
  prompt: string,
  mode: ImportantRoleImageMode = "common"
) {
  promptEditorState.mode = mode
  promptEditorState.roleKey = draftKey
  promptEditorState.value = prompt
}
/** 关闭 `PromptEditor` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closePromptEditor() {
  promptEditorState.mode = "common"
  promptEditorState.roleKey = null
  promptEditorState.value = ""
}
/** 保存 `PromptEditor` 数据并同步界面状态。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
function savePromptEditor() {
  if (!promptEditorState.roleKey) {
    closePromptEditor()
    return
  }

  const normalRole = draft.normalRoles.find((role) => role.draftKey === promptEditorState.roleKey)
  if (normalRole) {
    normalRole.prompt = promptEditorState.value.trim()
    closePromptEditor()
    return
  }

  const importantRole = draft.importantRoles.find(
    (role) => role.draftKey === promptEditorState.roleKey
  )
  if (importantRole) {
    setImportantRolePrompt(importantRole, promptEditorState.mode, promptEditorState.value.trim())
  }

  closePromptEditor()
}

  return {
    activeTab, createRoleAiDraft, draft, assetStates,
    promptStates, promptEditorState, imagePreviewState, batchState,
    personalityOptions, createDraftKey, normalizeText, clampFavorInput,
    getPersonalityLabel, buildRoleXinggePromptText, sanitizeNameInput, parseCompressQualityInput,
    parseImageDimensionInput, createEmptyAssetState, createEmptyPromptState, getPromptStateKey,
    getAssetStateKey, initializeNormalRoleState, initializeImportantRoleState, clearRoleState,
    resetStates, getPromptState, getAssetState, cloneNormalRole,
    cloneImportantRole, formatBytes, formatAssetMeta, formatErrorMessage,
    getPromptPreview, applyRoleAiDraft, getActiveAiDraft, syncDraft,
    loadAssetMeta, hydrateAssetMeta, getImageVariantLabel, getRoleImageModeLabel,
    getImagePreviewTitle, getNormalAssetPath, setNormalAssetPath, getNormalAssetUrl,
    getImportantAssetPath, setImportantAssetPath, getImportantAssetUrl, openImagePreview,
    closeImagePreview, getImportantRolePrompt, setImportantRolePrompt, getNextDefaultId,
    getRoleDisplayName, addNormalRole, addImportantRole, removeNormalRole,
    removeImportantRole, openPromptEditor, closePromptEditor, savePromptEditor
  }
}

export type StoryRoleDraftController = ReturnType<typeof useStoryRoleDraft>
