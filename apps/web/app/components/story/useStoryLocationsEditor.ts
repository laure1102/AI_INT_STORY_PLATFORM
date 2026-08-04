/**
 * 地点编辑器的状态与图片工作流。
 *
 * 输入来自地点弹窗 props，输出给表单模板；图片请求通过 Story API 完成。
 * 本模块不负责弹窗布局，也不自行关闭或保存父页面。
 */
import type { StoryEventLocationFile } from "@story-mgr/core"
import type { StoryAssetMetadata } from "@story-mgr/shared"

export type LocationImageVariant = "raw" | "compress1" | "compress2"

interface LocationDraft {
  draftKey: string
  descr: string
  img_compress_1: string
  img_compress_2: string
  img_raw: string
  id: string
  prompt: string
  selected: boolean
}

interface LocationAiDraft {
  compressQuality1Text: string
  compressQuality2Text: string
  globalPrompt: string
  imageHeightText: string
  imageWidthText: string
}

interface LocationAssetState {
  error: string | null
  loading: boolean
  meta: StoryAssetMetadata | null
}

interface LocationPromptState {
  error: string | null
  loading: boolean
}

interface ImagePreviewState {
  path: string
  title: string
  url: string
}

export interface StoryLocationsEditorProps {
  eventLocations: StoryEventLocationFile
  saveSuccessMessage?: string | null
  saving: boolean
  storyId: string
  storyTitle?: string
}

export interface StoryLocationsEditorEmits {
  close: []
  save: [eventLocations: StoryEventLocationFile]
}

export type StoryLocationsEditorEmit = <EventName extends keyof StoryLocationsEditorEmits>(
  event: EventName,
  ...args: StoryLocationsEditorEmits[EventName]
) => void
/** 创建地点编辑器控制器。 @param props 原地点文件、故事 id 和保存状态。 @param emit 关闭或保存完整地点文件的父级事件。 @returns 地点草稿、图片/提示词状态、预览、批处理进度和操作方法；props 变化通过同步函数重建本地草稿。 */
export function useStoryLocationsEditor(
  props: Readonly<StoryLocationsEditorProps>,
  emit: StoryLocationsEditorEmit
) {
  const {
  compressLocationImage,
  generateLocationImage,
  generateLocationPrompt,
  getStoryAssetMeta,
  getStoryAssetUrl
} = useStoryApi()

const draft = reactive({
  ai: {
    compressQuality1Text: "60",
    compressQuality2Text: "80",
    globalPrompt: "",
    imageHeightText: "1024",
    imageWidthText: "1536"
  } satisfies LocationAiDraft,
  assignments: [] as LocationDraft[]
})

const assetStates = reactive<Record<string, LocationAssetState>>({})
const promptStates = reactive<Record<string, LocationPromptState>>({})
const promptEditorState = reactive<{
  locationKey: string | null
  value: string
}>({
  locationKey: null,
  value: ""
})
const imagePreviewState = reactive<ImagePreviewState>({
  path: "",
  title: "",
  url: ""
})
const batchState = reactive({
  compressing1: false,
  compressing2: false,
  generatingImages: false,
  generatingPrompts: false,
  compress1Done: 0,
  compress1Total: 0,
  compress2Done: 0,
  compress2Total: 0,
  imageDone: 0,
  imageTotal: 0,
  promptDone: 0,
  promptTotal: 0
})

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
/** 读取或计算 `NextDefaultId`。 @returns 计算、查找或构建后的结果。 */
function getNextDefaultId() {
  const usedIds = new Set(
    draft.assignments.map((assignment) => assignment.id.trim()).filter(Boolean)
  )

  let index = draft.assignments.length + 1
  let candidate = `location_${index}`

  while (usedIds.has(candidate)) {
    index += 1
    candidate = `location_${index}`
  }

  return candidate
}
/** 创建一份新的 `EmptyAssetState` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyAssetState(): LocationAssetState {
  return {
    error: null,
    loading: false,
    meta: null
  }
}
/** 创建一份新的 `EmptyPromptState` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyPromptState(): LocationPromptState {
  return {
    error: null,
    loading: false
  }
}
/** 读取或计算 `AssetStateKey`。 @param draftKey 调用方传入的 `draftKey`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetStateKey(draftKey: string, variant: LocationImageVariant) {
  return `${draftKey}:${variant}`
}
/** 读取或计算 `PromptStateKey`。 @param draftKey 调用方传入的 `draftKey`。 @returns 计算、查找或构建后的结果。 */
function getPromptStateKey(draftKey: string) {
  return `${draftKey}:prompt`
}
/** 执行 `initializeAssetState` 对应的局部业务逻辑。 @param assignment 调用方传入的 `assignment`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function initializeAssetState(assignment: LocationDraft) {
  assetStates[getAssetStateKey(assignment.draftKey, "raw")] = createEmptyAssetState()
  assetStates[getAssetStateKey(assignment.draftKey, "compress1")] = createEmptyAssetState()
  assetStates[getAssetStateKey(assignment.draftKey, "compress2")] = createEmptyAssetState()
}
/** 执行 `initializePromptState` 对应的局部业务逻辑。 @param assignment 调用方传入的 `assignment`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function initializePromptState(assignment: LocationDraft) {
  promptStates[getPromptStateKey(assignment.draftKey)] = createEmptyPromptState()
}
/** 重置或清理 `clearAssetState` 对应的临时状态。 @param assignment 调用方传入的 `assignment`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function clearAssetState(assignment: LocationDraft) {
  delete assetStates[getAssetStateKey(assignment.draftKey, "raw")]
  delete assetStates[getAssetStateKey(assignment.draftKey, "compress1")]
  delete assetStates[getAssetStateKey(assignment.draftKey, "compress2")]
}
/** 重置或清理 `clearPromptState` 对应的临时状态。 @param assignment 调用方传入的 `assignment`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function clearPromptState(assignment: LocationDraft) {
  delete promptStates[getPromptStateKey(assignment.draftKey)]
}
/** 重置或清理 `resetAssetStates` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function resetAssetStates() {
  for (const key of Object.keys(assetStates)) {
    delete assetStates[key]
  }
}
/** 重置或清理 `resetPromptStates` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function resetPromptStates() {
  for (const key of Object.keys(promptStates)) {
    delete promptStates[key]
  }
}
/** 读取或计算 `AssetState`。 @param assignment 调用方传入的 `assignment`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetState(assignment: LocationDraft, variant: LocationImageVariant) {
  return assetStates[getAssetStateKey(assignment.draftKey, variant)]
}
/** 读取或计算 `PromptState`。 @param assignment 调用方传入的 `assignment`。 @returns 计算、查找或构建后的结果。 */
function getPromptState(assignment: LocationDraft) {
  return promptStates[getPromptStateKey(assignment.draftKey)]
}
/** 复制 `Assignment`，避免共享可变引用。 @param assignment 调用方传入的 `assignment`。 @returns 计算、查找或构建后的结果。 */
function cloneAssignment(assignment: StoryEventLocationFile["assignments"][number]): LocationDraft {
  const draftAssignment: LocationDraft = {
    draftKey: createDraftKey("location"),
    descr: normalizeText(assignment.descr),
    img_compress_1: normalizeText(assignment.img_compress_1),
    img_compress_2: normalizeText(assignment.img_compress_2),
    img_raw: normalizeText(assignment.img_raw),
    id: normalizeText(assignment.id),
    prompt: normalizeText(assignment.prompt),
    selected: false
  }

  initializeAssetState(draftAssignment)
  initializePromptState(draftAssignment)
  return draftAssignment
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
/** 读取或计算 `ImageVariantLabel`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getImageVariantLabel(variant: LocationImageVariant) {
  if (variant === "raw") return "原图"
  if (variant === "compress1") return "压缩图1"
  return "压缩图2"
}
/** 读取或计算 `ImagePreviewTitle`。 @param name 调用方传入的 `name`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getImagePreviewTitle(name: string, variant: LocationImageVariant) {
  const trimmedName = name.trim() || "地点"
  return `${trimmedName} ${getImageVariantLabel(variant)}`
}
/** 读取或计算 `AssetPath`。 @param assignment 调用方传入的 `assignment`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetPath(assignment: LocationDraft, variant: LocationImageVariant) {
  if (variant === "compress1") return assignment.img_compress_1.trim()
  if (variant === "compress2") return assignment.img_compress_2.trim()
  return assignment.img_raw.trim()
}
/** 更新 `AssetPath` 对应的响应式值。 @param assignment 调用方传入的 `assignment`。 @param variant 调用方传入的 `variant`。 @param assetPath 调用方传入的 `assetPath`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setAssetPath(
  assignment: LocationDraft,
  variant: LocationImageVariant,
  assetPath: string
) {
  if (variant === "compress1") {
    assignment.img_compress_1 = assetPath
    return
  }

  if (variant === "compress2") {
    assignment.img_compress_2 = assetPath
    return
  }

  assignment.img_raw = assetPath
}
/** 读取或计算 `AssetUrl`。 @param assignment 调用方传入的 `assignment`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetUrl(assignment: LocationDraft, variant: LocationImageVariant) {
  const assetPath = getAssetPath(assignment, variant)
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
/** 异步加载 `AssetMeta` 数据并更新响应式状态。 @param assignment 调用方传入的 `assignment`。 @param variant 调用方传入的 `variant`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
async function loadAssetMeta(
  assignment: LocationDraft,
  variant: LocationImageVariant
) {
  const state = getAssetState(assignment, variant)
  const assetPath = getAssetPath(assignment, variant)

  state.error = null

  if (!assetPath) {
    state.loading = false
    state.meta = null
    return
  }

  state.loading = true

  try {
    const asset = await getStoryAssetMeta(props.storyId, assetPath)

    if (getAssetPath(assignment, variant) === assetPath) {
      state.meta = asset
      state.error = null
    }
  } catch (error) {
    if (getAssetPath(assignment, variant) === assetPath) {
      state.meta = null
      state.error = formatErrorMessage(error, "读取图片信息失败。")
    }
  } finally {
    if (getAssetPath(assignment, variant) === assetPath) {
      state.loading = false
    }
  }
}
/** 执行 `hydrateAssetMeta` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
async function hydrateAssetMeta() {
  const tasks: Promise<void>[] = []

  for (const assignment of draft.assignments) {
    tasks.push(loadAssetMeta(assignment, "raw"))
    tasks.push(loadAssetMeta(assignment, "compress1"))
    tasks.push(loadAssetMeta(assignment, "compress2"))
  }

  await Promise.allSettled(tasks)
}
/** 把外部或服务端数据同步到本地响应式状态。 @param eventLocations 调用方传入的 `eventLocations`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(eventLocations: StoryEventLocationFile) {
  resetAssetStates()
  resetPromptStates()
  draft.ai.globalPrompt = normalizeText(eventLocations.ai.global_prompt)
  draft.ai.imageWidthText = String(eventLocations.ai.width ?? 1536)
  draft.ai.imageHeightText = String(eventLocations.ai.height ?? 1024)
  draft.ai.compressQuality1Text = String(eventLocations.ai.compress_quality_1 ?? 60)
  draft.ai.compressQuality2Text = String(eventLocations.ai.compress_quality_2 ?? 80)
  draft.assignments = eventLocations.assignments.map(cloneAssignment)
  void hydrateAssetMeta()
}

const locationCount = computed(() => draft.assignments.length)
const selectedCount = computed(() =>
  draft.assignments.filter((assignment) => assignment.selected).length
)
const allSelected = computed({
  get: () => draft.assignments.length > 0 && selectedCount.value === draft.assignments.length,
  set: (checked: boolean) => {
    for (const assignment of draft.assignments) {
      assignment.selected = checked
    }
  }
})

const duplicateIds = computed(() => {
  const counts = new Map<string, number>()

  for (const assignment of draft.assignments) {
    const normalizedId = sanitizeNameInput(assignment.id)
    if (!normalizedId) continue
    counts.set(normalizedId, (counts.get(normalizedId) ?? 0) + 1)
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([id]) => id)
  )
})

const hasInvalidDraft = computed(() => {
  if (parseImageDimensionInput(draft.ai.imageWidthText) === null) return true
  if (parseImageDimensionInput(draft.ai.imageHeightText) === null) return true
  if (parseCompressQualityInput(draft.ai.compressQuality1Text) === null) return true
  if (parseCompressQualityInput(draft.ai.compressQuality2Text) === null) return true

  return draft.assignments.some((assignment) => !sanitizeNameInput(assignment.id))
    || duplicateIds.value.size > 0
})

const hasBatchSelection = computed(() => selectedCount.value > 0)
const isBatchRunning = computed(
  () =>
    batchState.generatingPrompts
    || batchState.generatingImages
    || batchState.compressing1
    || batchState.compressing2
)
const canBatchGeneratePrompts = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && draft.assignments.some((assignment) => assignment.selected && assignment.descr.trim())
)
const canBatchGenerateImages = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && parseImageDimensionInput(draft.ai.imageWidthText) !== null
  && parseImageDimensionInput(draft.ai.imageHeightText) !== null
  && draft.assignments.some((assignment) => assignment.selected && assignment.prompt.trim())
)
const canBatchCompressImages1 = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && draft.assignments.some((assignment) => assignment.selected && assignment.img_raw.trim())
)
const canBatchCompressImages2 = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && draft.assignments.some((assignment) => assignment.selected && assignment.img_raw.trim())
)
/** 新增一项 `Location` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addLocation() {
  const assignment: LocationDraft = {
    draftKey: createDraftKey("location"),
    descr: "",
    img_compress_1: "",
    img_compress_2: "",
    img_raw: "",
    id: getNextDefaultId(),
    prompt: "",
    selected: false
  }

  initializeAssetState(assignment)
  initializePromptState(assignment)
  draft.assignments.push(assignment)
}
/** 移除指定的 `Location` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeLocation(index: number) {
  const assignment = draft.assignments[index]
  if (!assignment) return
  clearAssetState(assignment)
  clearPromptState(assignment)
  draft.assignments.splice(index, 1)
}
/** 读取或计算 `SelectedAssignments`。 @returns 计算、查找或构建后的结果。 */
function getSelectedAssignments() {
  return draft.assignments.filter((assignment) => assignment.selected)
}
/** 打开 `PromptEditor` 界面并初始化临时状态。 @param assignment 调用方传入的 `assignment`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openPromptEditor(assignment: LocationDraft) {
  promptEditorState.locationKey = assignment.draftKey
  promptEditorState.value = assignment.prompt
}
/** 关闭 `PromptEditor` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closePromptEditor() {
  promptEditorState.locationKey = null
  promptEditorState.value = ""
}
/** 保存 `PromptEditor` 数据并同步界面状态。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
function savePromptEditor() {
  const assignment = draft.assignments.find(
    (currentAssignment) => currentAssignment.draftKey === promptEditorState.locationKey
  )

  if (assignment) {
    assignment.prompt = promptEditorState.value.trim()
  }

  closePromptEditor()
}
/** 读取或计算 `PromptPreview`。 @param prompt 调用方传入的 `prompt`。 @returns 计算、查找或构建后的结果。 */
function getPromptPreview(prompt: string) {
  const trimmedPrompt = prompt.trim()
  return trimmedPrompt ? trimmedPrompt.slice(0, 48) : "编辑提示词"
}
/** 处理 `GeneratePrompt` 用户交互。 @param assignment 调用方传入的 `assignment`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleGeneratePrompt(assignment: LocationDraft) {
  const state = getPromptState(assignment)
  state.error = null
  state.loading = true

  try {
    assignment.prompt = await generateLocationPrompt(props.storyId, {
      descr: assignment.descr,
      locationName: assignment.id,
      storyTitle: props.storyTitle
    })
  } catch (error) {
    state.error = formatErrorMessage(error, "生成提示词失败。")
  } finally {
    state.loading = false
  }
}
/** 处理 `GenerateImage` 用户交互。 @param assignment 调用方传入的 `assignment`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleGenerateImage(assignment: LocationDraft) {
  const state = getAssetState(assignment, "raw")
  state.error = null
  state.loading = true

  try {
    const asset = await generateLocationImage(props.storyId, {
      globalPrompt: draft.ai.globalPrompt,
      width: parseImageDimensionInput(draft.ai.imageWidthText) ?? 1536,
      height: parseImageDimensionInput(draft.ai.imageHeightText) ?? 1024,
      prompt: assignment.prompt,
      targetName: sanitizeNameInput(assignment.id) || "location"
    })

    assignment.img_raw = asset.assetPath
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, "生成图片失败。")
  } finally {
    state.loading = false
  }
}
/** 处理 `CompressImage` 用户交互。 @param assignment 调用方传入的 `assignment`。 @param slot 调用方传入的 `slot`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleCompressImage(
  assignment: LocationDraft,
  slot: 1 | 2
) {
  const variant: LocationImageVariant = slot === 1 ? "compress1" : "compress2"
  const state = getAssetState(assignment, variant)
  state.error = null
  state.loading = true

  try {
    const asset = await compressLocationImage(props.storyId, {
      quality:
        parseCompressQualityInput(
          slot === 1 ? draft.ai.compressQuality1Text : draft.ai.compressQuality2Text
        ) ?? (slot === 1 ? 60 : 80),
      slot,
      sourcePath: assignment.img_raw,
      targetName: sanitizeNameInput(assignment.id) || "location"
    })

    setAssetPath(assignment, variant, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `压缩图片${slot}失败。`)
  } finally {
    state.loading = false
  }
}
/** 为已选且有描述的地点串行生成提示词。 @returns 完成后的 Promise；每项错误留在自己的 promptState 中，批处理进度持续更新，finally 释放运行标志。 */
async function handleBatchGeneratePrompts() {
  const assignments = getSelectedAssignments().filter((assignment) => assignment.descr.trim())
  if (!assignments.length) return

  batchState.generatingPrompts = true
  batchState.promptDone = 0
  batchState.promptTotal = assignments.length

  try {
    for (const assignment of assignments) {
      await handleGeneratePrompt(assignment)
      batchState.promptDone += 1
    }
  } finally {
    batchState.generatingPrompts = false
  }
}
/** 为已选且有提示词的地点串行生成原图。 @returns 完成后的 Promise；宽高不合法时直接结束，避免把坏参数提交给图片 API。 */
async function handleBatchGenerateImages() {
  const assignments = getSelectedAssignments().filter((assignment) => assignment.prompt.trim())
  if (
    !assignments.length
    || parseImageDimensionInput(draft.ai.imageWidthText) === null
    || parseImageDimensionInput(draft.ai.imageHeightText) === null
  ) {
    return
  }

  batchState.generatingImages = true
  batchState.imageDone = 0
  batchState.imageTotal = assignments.length

  try {
    for (const assignment of assignments) {
      await handleGenerateImage(assignment)
      batchState.imageDone += 1
    }
  } finally {
    batchState.generatingImages = false
  }
}
/** 处理 `BatchCompressImages` 用户交互。 @param slot 调用方传入的 `slot`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleBatchCompressImages(slot: 1 | 2) {
  const assignments = getSelectedAssignments().filter((assignment) => assignment.img_raw.trim())
  if (!assignments.length) return

  if (slot === 1) {
    batchState.compressing1 = true
    batchState.compress1Done = 0
    batchState.compress1Total = assignments.length
  } else {
    batchState.compressing2 = true
    batchState.compress2Done = 0
    batchState.compress2Total = assignments.length
  }

  try {
    for (const assignment of assignments) {
      await handleCompressImage(assignment, slot)
      if (slot === 1) {
        batchState.compress1Done += 1
      } else {
        batchState.compress2Done += 1
      }
    }
  } finally {
    if (slot === 1) {
      batchState.compressing1 = false
    } else {
      batchState.compressing2 = false
    }
  }
}
/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function submitDraft() {
  emit("save", {
    ai: {
      compress_quality_1: parseCompressQualityInput(draft.ai.compressQuality1Text) ?? 60,
      compress_quality_2: parseCompressQualityInput(draft.ai.compressQuality2Text) ?? 80,
      global_prompt: draft.ai.globalPrompt.trim(),
      width: parseImageDimensionInput(draft.ai.imageWidthText) ?? 1536,
      height: parseImageDimensionInput(draft.ai.imageHeightText) ?? 1024
    },
    assignments: draft.assignments.map((assignment) => ({
      descr: assignment.descr.trim(),
      img_compress_1: assignment.img_compress_1.trim(),
      img_compress_2: assignment.img_compress_2.trim(),
      img_raw: assignment.img_raw.trim(),
      id: sanitizeNameInput(assignment.id),
      prompt: assignment.prompt.trim()
    }))
  })
}

watch(
  () => props.eventLocations,
  (eventLocations) => {
    syncDraft(eventLocations)
  },
  { immediate: true }
)

  return reactive({
    draft,
    assetStates,
    promptStates,
    promptEditorState,
    imagePreviewState,
    batchState,
    getAssetState,
    getPromptState,
    formatAssetMeta,
    getImagePreviewTitle,
    getImageVariantLabel,
    getAssetPath,
    getAssetUrl,
    openImagePreview,
    closeImagePreview,
    locationCount,
    selectedCount,
    allSelected,
    duplicateIds,
    hasInvalidDraft,
    hasBatchSelection,
    isBatchRunning,
    canBatchGeneratePrompts,
    canBatchGenerateImages,
    canBatchCompressImages1,
    canBatchCompressImages2,
    addLocation,
    removeLocation,
    openPromptEditor,
    parseImageDimensionInput,
    closePromptEditor,
    savePromptEditor,
    getPromptPreview,
    handleGeneratePrompt,
    handleGenerateImage,
    handleCompressImage,
    handleBatchGeneratePrompts,
    handleBatchGenerateImages,
    handleBatchCompressImages,
    submitDraft,
  })
}

/** 地点表单使用的响应式控制器类型。 */
export type StoryLocationsEditorController = ReturnType<typeof useStoryLocationsEditor>
