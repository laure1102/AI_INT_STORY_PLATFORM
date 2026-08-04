/**
 * 物品编辑器的草稿、图片和批处理工作流。
 *
 * 输入来自物品弹窗 props，输出给表单模板；保存仍由父页面确认。
 */
import type {
  StoryItemsFile
} from "@story-mgr/core"
import {
  formatAssetMetadata as formatAssetMeta,
  formatStoryApiError as formatErrorMessage,
  normalizeAssetText as normalizeText,
  parseCompressQualityInput,
  parsePositiveIntegerInput,
  sanitizeAssetNameInput as sanitizeIdInput,
  type StoryAssetEditorState as ItemAssetState,
  type StoryImagePreviewState as ImagePreviewState,
  type StoryPromptEditorState as ItemPromptState
} from "./storyAssetEditor"
import {
  cloneItemCategory,
  cloneItemDefinition,
  type ItemCategoryDraft,
  type ItemDraft
} from "./storyItemDraft"

export type ItemImageVariant = "raw" | "compress1" | "compress2"

interface ItemAiDraft {
  compressQuality1Text: string
  compressQuality2Text: string
  globalPrompt: string
  imageHeightText: string
  imageWidthText: string
}

export interface StoryItemsEditorProps {
  items: StoryItemsFile
  saveSuccessMessage?: string | null
  saving: boolean
  storyId: string
  storyTitle?: string
}

export interface StoryItemsEditorEmits {
  close: []
  save: [items: StoryItemsFile]
}

export type StoryItemsEditorEmit = <EventName extends keyof StoryItemsEditorEmits>(
  event: EventName,
  ...args: StoryItemsEditorEmits[EventName]
) => void
/** 创建物品编辑器控制器。 @param props 原物品文件、故事 id 和保存状态。 @param emit 关闭或提交完整 StoryItemsFile 的父级事件。 @returns 分类/物品草稿、图片与提示词状态、预览、批处理进度和操作函数；只在 submitDraft 时向父层写出。 */
export function useStoryItemsEditor(
  props: Readonly<StoryItemsEditorProps>,
  emit: StoryItemsEditorEmit
) {
  const {
  compressItemImage,
  generateItemImage,
  generateItemPrompt,
  getStoryAssetMeta,
  getStoryAssetUrl
} = useStoryApi()

const draft = reactive({
  ai: {
    compressQuality1Text: "60",
    compressQuality2Text: "80",
    globalPrompt: "",
    imageHeightText: "1024",
    imageWidthText: "1024"
  } satisfies ItemAiDraft,
  categories: [] as ItemCategoryDraft[],
  items: [] as ItemDraft[]
})

const assetStates = reactive<Record<string, ItemAssetState>>({})
const promptStates = reactive<Record<string, ItemPromptState>>({})
const promptEditorState = reactive<{
  itemKey: string | null
  value: string
}>({
  itemKey: null,
  value: ""
})
const imagePreviewState = reactive<ImagePreviewState>({
  path: "",
  title: "",
  url: ""
})
const isCategoryDialogOpen = shallowRef(false)
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
/** 解析 `TagsText` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function parseTagsText(value: string) {
  return value
    .split(/[,\n，、]/g)
    .map((tag) => tag.trim())
    .filter(Boolean)
}
/** 读取或计算 `NextDefaultCategoryId`。 @returns 计算、查找或构建后的结果。 */
function getNextDefaultCategoryId() {
  const usedIds = new Set(draft.categories.map((category) => category.id.trim()).filter(Boolean))
  let index = draft.categories.length + 1
  let candidate = `category_${index}`

  while (usedIds.has(candidate)) {
    index += 1
    candidate = `category_${index}`
  }

  return candidate
}
/** 读取或计算 `NextDefaultItemId`。 @returns 计算、查找或构建后的结果。 */
function getNextDefaultItemId() {
  const usedIds = new Set(draft.items.map((item) => item.id.trim()).filter(Boolean))
  let index = draft.items.length + 1
  let candidate = `item_${index}`

  while (usedIds.has(candidate)) {
    index += 1
    candidate = `item_${index}`
  }

  return candidate
}
/** 创建一份新的 `EmptyAssetState` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyAssetState(): ItemAssetState {
  return {
    error: null,
    loading: false,
    meta: null
  }
}
/** 创建一份新的 `EmptyPromptState` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyPromptState(): ItemPromptState {
  return {
    error: null,
    loading: false
  }
}
/** 读取或计算 `AssetStateKey`。 @param draftKey 调用方传入的 `draftKey`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetStateKey(draftKey: string, variant: ItemImageVariant) {
  return `${draftKey}:${variant}`
}
/** 读取或计算 `PromptStateKey`。 @param draftKey 调用方传入的 `draftKey`。 @returns 计算、查找或构建后的结果。 */
function getPromptStateKey(draftKey: string) {
  return `${draftKey}:prompt`
}
/** 执行 `initializeAssetState` 对应的局部业务逻辑。 @param item 调用方传入的 `item`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function initializeAssetState(item: ItemDraft) {
  assetStates[getAssetStateKey(item.draftKey, "raw")] = createEmptyAssetState()
  assetStates[getAssetStateKey(item.draftKey, "compress1")] = createEmptyAssetState()
  assetStates[getAssetStateKey(item.draftKey, "compress2")] = createEmptyAssetState()
}
/** 执行 `initializePromptState` 对应的局部业务逻辑。 @param item 调用方传入的 `item`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function initializePromptState(item: ItemDraft) {
  promptStates[getPromptStateKey(item.draftKey)] = createEmptyPromptState()
}
/** 重置或清理 `clearAssetState` 对应的临时状态。 @param item 调用方传入的 `item`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function clearAssetState(item: ItemDraft) {
  delete assetStates[getAssetStateKey(item.draftKey, "raw")]
  delete assetStates[getAssetStateKey(item.draftKey, "compress1")]
  delete assetStates[getAssetStateKey(item.draftKey, "compress2")]
}
/** 重置或清理 `clearPromptState` 对应的临时状态。 @param item 调用方传入的 `item`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function clearPromptState(item: ItemDraft) {
  delete promptStates[getPromptStateKey(item.draftKey)]
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
/** 读取或计算 `AssetState`。 @param item 调用方传入的 `item`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetState(item: ItemDraft, variant: ItemImageVariant) {
  return assetStates[getAssetStateKey(item.draftKey, variant)]
}
/** 读取或计算 `PromptState`。 @param item 调用方传入的 `item`。 @returns 计算、查找或构建后的结果。 */
function getPromptState(item: ItemDraft) {
  return promptStates[getPromptStateKey(item.draftKey)]
}
/** 复制 `Category`，避免共享可变引用。 @param category 调用方传入的 `category`。 @returns 计算、查找或构建后的结果。 */
function cloneCategory(category: StoryItemsFile["categories"][number]): ItemCategoryDraft {
  return cloneItemCategory(category, createDraftKey)
}
/** 复制 `Item`，避免共享可变引用。 @param item 调用方传入的 `item`。 @returns 计算、查找或构建后的结果。 */
function cloneItem(item: StoryItemsFile["items"][number]): ItemDraft {
  const itemDraft = cloneItemDefinition(item, createDraftKey)

  initializeAssetState(itemDraft)
  initializePromptState(itemDraft)
  return itemDraft
}
/** 读取或计算 `ImageVariantLabel`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getImageVariantLabel(variant: ItemImageVariant) {
  if (variant === "raw") return "原图"
  if (variant === "compress1") return "压缩图1"
  return "压缩图2"
}
/** 读取或计算 `AssetPath`。 @param item 调用方传入的 `item`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetPath(item: ItemDraft, variant: ItemImageVariant) {
  if (variant === "compress1") return item.img_compress_1.trim()
  if (variant === "compress2") return item.img_compress_2.trim()
  return item.img_raw.trim()
}
/** 更新 `AssetPath` 对应的响应式值。 @param item 调用方传入的 `item`。 @param variant 调用方传入的 `variant`。 @param assetPath 调用方传入的 `assetPath`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setAssetPath(item: ItemDraft, variant: ItemImageVariant, assetPath: string) {
  if (variant === "compress1") {
    item.img_compress_1 = assetPath
    return
  }

  if (variant === "compress2") {
    item.img_compress_2 = assetPath
    return
  }

  item.img_raw = assetPath
}
/** 读取或计算 `AssetUrl`。 @param item 调用方传入的 `item`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetUrl(item: ItemDraft, variant: ItemImageVariant) {
  const assetPath = getAssetPath(item, variant)
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
/** 异步加载 `AssetMeta` 数据并更新响应式状态。 @param item 调用方传入的 `item`。 @param variant 调用方传入的 `variant`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
async function loadAssetMeta(item: ItemDraft, variant: ItemImageVariant) {
  const state = getAssetState(item, variant)
  const assetPath = getAssetPath(item, variant)

  state.error = null

  if (!assetPath) {
    state.loading = false
    state.meta = null
    return
  }

  state.loading = true

  try {
    const asset = await getStoryAssetMeta(props.storyId, assetPath)

    if (getAssetPath(item, variant) === assetPath) {
      state.meta = asset
      state.error = null
    }
  } catch (error) {
    if (getAssetPath(item, variant) === assetPath) {
      state.meta = null
      state.error = formatErrorMessage(error, "读取图片信息失败。")
    }
  } finally {
    if (getAssetPath(item, variant) === assetPath) {
      state.loading = false
    }
  }
}
/** 执行 `hydrateAssetMeta` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
async function hydrateAssetMeta() {
  const tasks: Promise<void>[] = []

  for (const item of draft.items) {
    tasks.push(loadAssetMeta(item, "raw"))
    tasks.push(loadAssetMeta(item, "compress1"))
    tasks.push(loadAssetMeta(item, "compress2"))
  }

  await Promise.allSettled(tasks)
}
/** 把外部或服务端数据同步到本地响应式状态。 @param items 调用方传入的 `items`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(items: StoryItemsFile) {
  resetAssetStates()
  resetPromptStates()
  draft.ai.globalPrompt = normalizeText(items.ai.global_prompt)
  draft.ai.imageWidthText = String(items.ai.width ?? 1024)
  draft.ai.imageHeightText = String(items.ai.height ?? 1024)
  draft.ai.compressQuality1Text = String(items.ai.compress_quality_1 ?? 60)
  draft.ai.compressQuality2Text = String(items.ai.compress_quality_2 ?? 80)
  draft.categories = items.categories.map(cloneCategory)
  draft.items = items.items.map(cloneItem)
  void hydrateAssetMeta()
}

const sortedCategoryOptions = computed(() =>
  [...draft.categories].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order
    }

    return left.id.localeCompare(right.id)
  })
)

const categoryIdSet = computed(() =>
  new Set(draft.categories.map((category) => sanitizeIdInput(category.id)).filter(Boolean))
)

const categoryUsageCounts = computed(() => {
  const counts = new Map<string, number>()

  for (const item of draft.items) {
    const categoryId = sanitizeIdInput(item.category_id)
    if (!categoryId) continue
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1)
  }

  return counts
})

const selectedCount = computed(() => draft.items.filter((item) => item.selected).length)
const allSelected = computed({
  get: () => draft.items.length > 0 && selectedCount.value === draft.items.length,
  set: (checked: boolean) => {
    for (const item of draft.items) {
      item.selected = checked
    }
  }
})

const duplicateCategoryIds = computed(() => {
  const counts = new Map<string, number>()

  for (const category of draft.categories) {
    const normalizedId = sanitizeIdInput(category.id)
    if (!normalizedId) continue
    counts.set(normalizedId, (counts.get(normalizedId) ?? 0) + 1)
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([id]) => id)
  )
})

const duplicateItemIds = computed(() => {
  const counts = new Map<string, number>()

  for (const item of draft.items) {
    const normalizedId = sanitizeIdInput(item.id)
    if (!normalizedId) continue
    counts.set(normalizedId, (counts.get(normalizedId) ?? 0) + 1)
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([id]) => id)
  )
})

const invalidCategoryReferenceCount = computed(() =>
  draft.items.filter((item) => !categoryIdSet.value.has(sanitizeIdInput(item.category_id))).length
)

const hasInvalidDraft = computed(() => {
  if (parsePositiveIntegerInput(draft.ai.imageWidthText) === null) return true
  if (parsePositiveIntegerInput(draft.ai.imageHeightText) === null) return true
  if (parseCompressQualityInput(draft.ai.compressQuality1Text) === null) return true
  if (parseCompressQualityInput(draft.ai.compressQuality2Text) === null) return true
  if (duplicateCategoryIds.value.size > 0 || duplicateItemIds.value.size > 0) return true
  if (invalidCategoryReferenceCount.value > 0) return true

  return draft.categories.some((category) => !sanitizeIdInput(category.id))
    || draft.items.some((item) =>
      !sanitizeIdInput(item.id)
      || !sanitizeIdInput(item.category_id)
      || parsePositiveIntegerInput(item.maxStackText) === null
    )
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
  && draft.items.some((item) => item.selected && item.descr.trim())
)
const canBatchGenerateImages = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && parsePositiveIntegerInput(draft.ai.imageWidthText) !== null
  && parsePositiveIntegerInput(draft.ai.imageHeightText) !== null
  && draft.items.some((item) => item.selected && item.prompt.trim())
)
const canBatchCompressImages1 = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && draft.items.some((item) => item.selected && item.img_raw.trim())
)
const canBatchCompressImages2 = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && draft.items.some((item) => item.selected && item.img_raw.trim())
)
/** 读取或计算 `CategoryName`。 @param categoryId 调用方传入的 `categoryId`。 @returns 计算、查找或构建后的结果。 */
function getCategoryName(categoryId: string) {
  const normalizedId = sanitizeIdInput(categoryId)
  const category = draft.categories.find((item) => sanitizeIdInput(item.id) === normalizedId)
  return category?.name.trim() || category?.id.trim() || ""
}
/** 读取或计算 `CategoryUsageCount`。 @param category 调用方传入的 `category`。 @returns 计算、查找或构建后的结果。 */
function getCategoryUsageCount(category: ItemCategoryDraft) {
  return categoryUsageCounts.value.get(sanitizeIdInput(category.id)) ?? 0
}
/** 打开 `CategoryDialog` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openCategoryDialog() {
  isCategoryDialogOpen.value = true
}
/** 关闭 `CategoryDialog` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeCategoryDialog() {
  isCategoryDialogOpen.value = false
}
/** 新增一项 `Category` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addCategory() {
  const sortOrder = draft.categories.length > 0
    ? Math.max(...draft.categories.map((category) => category.sort_order)) + 10
    : 10

  draft.categories.push({
    draftKey: createDraftKey("category"),
    id: getNextDefaultCategoryId(),
    name: "新分类",
    descr: "",
    sort_order: sortOrder
  })
}
/** 移除指定的 `Category` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeCategory(index: number) {
  const category = draft.categories[index]
  if (!category || getCategoryUsageCount(category) > 0) {
    return
  }

  draft.categories.splice(index, 1)
}
/** 新增一项 `Item` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addItem() {
  if (draft.categories.length === 0) {
    addCategory()
  }

  const item: ItemDraft = {
    draftKey: createDraftKey("item"),
    id: getNextDefaultItemId(),
    name: "新物品",
    category_id: draft.categories[0]?.id ?? "",
    descr: "",
    prompt: "",
    tags: [],
    tagsText: "",
    rarity: "common",
    stackable: true,
    max_stack: 1,
    maxStackText: "1",
    usable: false,
    img_raw: "",
    img_compress_1: "",
    img_compress_2: "",
    selected: false
  }

  initializeAssetState(item)
  initializePromptState(item)
  draft.items.push(item)
}
/** 移除指定的 `Item` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeItem(index: number) {
  const item = draft.items[index]
  if (!item) return
  clearAssetState(item)
  clearPromptState(item)
  draft.items.splice(index, 1)
}
/** 读取或计算 `SelectedItems`。 @returns 计算、查找或构建后的结果。 */
function getSelectedItems() {
  return draft.items.filter((item) => item.selected)
}
/** 打开 `PromptEditor` 界面并初始化临时状态。 @param item 调用方传入的 `item`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openPromptEditor(item: ItemDraft) {
  promptEditorState.itemKey = item.draftKey
  promptEditorState.value = item.prompt
}
/** 关闭 `PromptEditor` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closePromptEditor() {
  promptEditorState.itemKey = null
  promptEditorState.value = ""
}
/** 保存 `PromptEditor` 数据并同步界面状态。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
function savePromptEditor() {
  const item = draft.items.find((currentItem) => currentItem.draftKey === promptEditorState.itemKey)

  if (item) {
    item.prompt = promptEditorState.value.trim()
  }

  closePromptEditor()
}
/** 读取或计算 `PromptPreview`。 @param prompt 调用方传入的 `prompt`。 @returns 计算、查找或构建后的结果。 */
function getPromptPreview(prompt: string) {
  const trimmedPrompt = prompt.trim()
  return trimmedPrompt ? trimmedPrompt.slice(0, 48) : "编辑提示词"
}
/** 读取或计算 `ImagePreviewTitle`。 @param item 调用方传入的 `item`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getImagePreviewTitle(item: ItemDraft, variant: ItemImageVariant) {
  return `${item.name.trim() || item.id.trim() || "物品"} ${getImageVariantLabel(variant)}`
}
/** 处理 `GeneratePrompt` 用户交互。 @param item 调用方传入的 `item`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleGeneratePrompt(item: ItemDraft) {
  const state = getPromptState(item)
  state.error = null
  state.loading = true

  try {
    item.prompt = await generateItemPrompt(props.storyId, {
      categoryName: getCategoryName(item.category_id),
      descr: item.descr,
      itemName: item.name || item.id,
      storyTitle: props.storyTitle
    })
  } catch (error) {
    state.error = formatErrorMessage(error, "生成提示词失败。")
  } finally {
    state.loading = false
  }
}
/** 处理 `GenerateImage` 用户交互。 @param item 调用方传入的 `item`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleGenerateImage(item: ItemDraft) {
  const state = getAssetState(item, "raw")
  state.error = null
  state.loading = true

  try {
    const asset = await generateItemImage(props.storyId, {
      globalPrompt: draft.ai.globalPrompt,
      width: parsePositiveIntegerInput(draft.ai.imageWidthText) ?? 1024,
      height: parsePositiveIntegerInput(draft.ai.imageHeightText) ?? 1024,
      prompt: item.prompt,
      targetName: sanitizeIdInput(item.id) || "item"
    })

    item.img_raw = asset.assetPath
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, "生成图片失败。")
  } finally {
    state.loading = false
  }
}
/** 处理 `CompressImage` 用户交互。 @param item 调用方传入的 `item`。 @param slot 调用方传入的 `slot`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleCompressImage(item: ItemDraft, slot: 1 | 2) {
  const variant: ItemImageVariant = slot === 1 ? "compress1" : "compress2"
  const state = getAssetState(item, variant)
  state.error = null
  state.loading = true

  try {
    const asset = await compressItemImage(props.storyId, {
      quality:
        parseCompressQualityInput(
          slot === 1 ? draft.ai.compressQuality1Text : draft.ai.compressQuality2Text
        ) ?? (slot === 1 ? 60 : 80),
      slot,
      sourcePath: item.img_raw,
      targetName: sanitizeIdInput(item.id) || "item"
    })

    setAssetPath(item, variant, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `压缩图片${slot}失败。`)
  } finally {
    state.loading = false
  }
}
/** 为所有已选且有描述的物品串行生成提示词。 @returns 完成后的 Promise；逐项复用单条错误状态并更新进度，finally 必定释放批处理锁。串行执行避免同时向本地 AI 服务发送大量请求。 */
async function handleBatchGeneratePrompts() {
  const items = getSelectedItems().filter((item) => item.descr.trim())
  if (!items.length) return

  batchState.generatingPrompts = true
  batchState.promptDone = 0
  batchState.promptTotal = items.length

  try {
    for (const item of items) {
      await handleGeneratePrompt(item)
      batchState.promptDone += 1
    }
  } finally {
    batchState.generatingPrompts = false
  }
}
/** 为所有已选且有提示词的物品串行生成原图。 @returns 完成后的 Promise；尺寸非法时不启动，逐项更新进度，finally 必定清除 generatingImages。 */
async function handleBatchGenerateImages() {
  const items = getSelectedItems().filter((item) => item.prompt.trim())
  if (
    !items.length
    || parsePositiveIntegerInput(draft.ai.imageWidthText) === null
    || parsePositiveIntegerInput(draft.ai.imageHeightText) === null
  ) {
    return
  }

  batchState.generatingImages = true
  batchState.imageDone = 0
  batchState.imageTotal = items.length

  try {
    for (const item of items) {
      await handleGenerateImage(item)
      batchState.imageDone += 1
    }
  } finally {
    batchState.generatingImages = false
  }
}
/** 处理 `BatchCompressImages` 用户交互。 @param slot 调用方传入的 `slot`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
async function handleBatchCompressImages(slot: 1 | 2) {
  const items = getSelectedItems().filter((item) => item.img_raw.trim())
  if (!items.length) return

  if (slot === 1) {
    batchState.compressing1 = true
    batchState.compress1Done = 0
    batchState.compress1Total = items.length
  } else {
    batchState.compressing2 = true
    batchState.compress2Done = 0
    batchState.compress2Total = items.length
  }

  try {
    for (const item of items) {
      await handleCompressImage(item, slot)
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
      width: parsePositiveIntegerInput(draft.ai.imageWidthText) ?? 1024,
      height: parsePositiveIntegerInput(draft.ai.imageHeightText) ?? 1024
    },
    categories: draft.categories.map((category) => ({
      id: sanitizeIdInput(category.id),
      name: category.name.trim(),
      descr: category.descr.trim(),
      sort_order: Number.isInteger(Number(category.sort_order)) ? Number(category.sort_order) : 0
    })),
    items: draft.items.map((item) => ({
      id: sanitizeIdInput(item.id),
      name: item.name.trim(),
      category_id: sanitizeIdInput(item.category_id),
      descr: item.descr.trim(),
      prompt: item.prompt.trim(),
      tags: parseTagsText(item.tagsText),
      rarity: item.rarity.trim() || "common",
      stackable: item.stackable,
      max_stack: parsePositiveIntegerInput(item.maxStackText) ?? 1,
      usable: item.usable,
      img_raw: item.img_raw.trim(),
      img_compress_1: item.img_compress_1.trim(),
      img_compress_2: item.img_compress_2.trim()
    }))
  })
}

watch(
  () => props.items,
  (items) => {
    syncDraft(items)
  },
  { immediate: true }
)

  return reactive({
    draft,
    assetStates,
    promptStates,
    promptEditorState,
    imagePreviewState,
    isCategoryDialogOpen,
    batchState,
    sortedCategoryOptions,
    categoryIdSet,
    categoryUsageCounts,
    selectedCount,
    allSelected,
    duplicateCategoryIds,
    duplicateItemIds,
    invalidCategoryReferenceCount,
    hasInvalidDraft,
    hasBatchSelection,
    isBatchRunning,
    canBatchGeneratePrompts,
    canBatchGenerateImages,
    canBatchCompressImages1,
    canBatchCompressImages2,
    getCategoryName,
    getCategoryUsageCount,
    openCategoryDialog,
    closeCategoryDialog,
    addCategory,
    removeCategory,
    addItem,
    removeItem,
    openPromptEditor,
    closePromptEditor,
    savePromptEditor,
    getPromptPreview,
    getImagePreviewTitle,
    getImageVariantLabel,
    getAssetState,
    getPromptState,
    getAssetPath,
    getAssetUrl,
    openImagePreview,
    closeImagePreview,
    formatAssetMeta,
    handleGeneratePrompt,
    handleGenerateImage,
    handleCompressImage,
    handleBatchGeneratePrompts,
    handleBatchGenerateImages,
    handleBatchCompressImages,
    submitDraft,
  })
}

/** 物品表单使用的响应式控制器类型。 */
export type StoryItemsEditorController = ReturnType<typeof useStoryItemsEditor>

