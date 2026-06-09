<script setup lang="ts">
import type {
  StoryItemCategory,
  StoryItemDefinition,
  StoryItemsFile
} from "@story-mgr/core"
import type { StoryAssetMetadata } from "@story-mgr/shared"

type ItemImageVariant = "raw" | "compress1" | "compress2"

interface ItemCategoryDraft extends StoryItemCategory {
  draftKey: string
}

interface ItemDraft extends StoryItemDefinition {
  draftKey: string
  selected: boolean
  tagsText: string
  maxStackText: string
}

interface ItemAiDraft {
  compressQuality1Text: string
  compressQuality2Text: string
  globalPrompt: string
  imageHeightText: string
  imageWidthText: string
}

interface ItemAssetState {
  error: string | null
  loading: boolean
  meta: StoryAssetMetadata | null
}

interface ItemPromptState {
  error: string | null
  loading: boolean
}

interface ImagePreviewState {
  path: string
  title: string
  url: string
}

const props = defineProps<{
  items: StoryItemsFile
  saveSuccessMessage?: string | null
  saving: boolean
  storyId: string
  storyTitle?: string
}>()

const emit = defineEmits<{
  close: []
  save: [items: StoryItemsFile]
}>()

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

function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function sanitizeIdInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function parsePositiveIntegerInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

function parseCompressQualityInput(value: unknown) {
  const parsed = parsePositiveIntegerInput(value)
  return parsed !== null && parsed <= 100 ? parsed : null
}

function parseTagsText(value: string) {
  return value
    .split(/[,\n，、]/g)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

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

function createEmptyAssetState(): ItemAssetState {
  return {
    error: null,
    loading: false,
    meta: null
  }
}

function createEmptyPromptState(): ItemPromptState {
  return {
    error: null,
    loading: false
  }
}

function getAssetStateKey(draftKey: string, variant: ItemImageVariant) {
  return `${draftKey}:${variant}`
}

function getPromptStateKey(draftKey: string) {
  return `${draftKey}:prompt`
}

function initializeAssetState(item: ItemDraft) {
  assetStates[getAssetStateKey(item.draftKey, "raw")] = createEmptyAssetState()
  assetStates[getAssetStateKey(item.draftKey, "compress1")] = createEmptyAssetState()
  assetStates[getAssetStateKey(item.draftKey, "compress2")] = createEmptyAssetState()
}

function initializePromptState(item: ItemDraft) {
  promptStates[getPromptStateKey(item.draftKey)] = createEmptyPromptState()
}

function clearAssetState(item: ItemDraft) {
  delete assetStates[getAssetStateKey(item.draftKey, "raw")]
  delete assetStates[getAssetStateKey(item.draftKey, "compress1")]
  delete assetStates[getAssetStateKey(item.draftKey, "compress2")]
}

function clearPromptState(item: ItemDraft) {
  delete promptStates[getPromptStateKey(item.draftKey)]
}

function resetAssetStates() {
  for (const key of Object.keys(assetStates)) {
    delete assetStates[key]
  }
}

function resetPromptStates() {
  for (const key of Object.keys(promptStates)) {
    delete promptStates[key]
  }
}

function getAssetState(item: ItemDraft, variant: ItemImageVariant) {
  return assetStates[getAssetStateKey(item.draftKey, variant)]
}

function getPromptState(item: ItemDraft) {
  return promptStates[getPromptStateKey(item.draftKey)]
}

function cloneCategory(category: StoryItemCategory): ItemCategoryDraft {
  return {
    draftKey: createDraftKey("category"),
    id: normalizeText(category.id),
    name: normalizeText(category.name),
    descr: normalizeText(category.descr),
    sort_order: Number.isInteger(category.sort_order) ? category.sort_order : 0
  }
}

function cloneItem(item: StoryItemDefinition): ItemDraft {
  const itemDraft: ItemDraft = {
    draftKey: createDraftKey("item"),
    id: normalizeText(item.id),
    name: normalizeText(item.name),
    category_id: normalizeText(item.category_id),
    descr: normalizeText(item.descr),
    prompt: normalizeText(item.prompt),
    tags: Array.isArray(item.tags) ? item.tags : [],
    tagsText: Array.isArray(item.tags) ? item.tags.join(", ") : "",
    rarity: normalizeText(item.rarity) || "common",
    stackable: item.stackable ?? true,
    max_stack: Number.isInteger(item.max_stack) && item.max_stack > 0 ? item.max_stack : 1,
    maxStackText: String(Number.isInteger(item.max_stack) && item.max_stack > 0 ? item.max_stack : 1),
    usable: item.usable ?? false,
    img_raw: normalizeText(item.img_raw),
    img_compress_1: normalizeText(item.img_compress_1),
    img_compress_2: normalizeText(item.img_compress_2),
    selected: false
  }

  initializeAssetState(itemDraft)
  initializePromptState(itemDraft)
  return itemDraft
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
}

function formatAssetMeta(meta: StoryAssetMetadata | null) {
  if (!meta) return ""

  const dimensions =
    typeof meta.width === "number" && typeof meta.height === "number"
      ? `${meta.width} x ${meta.height}`
      : "尺寸未知"

  return `${dimensions} / ${formatBytes(meta.sizeBytes)}`
}

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

function getImageVariantLabel(variant: ItemImageVariant) {
  if (variant === "raw") return "原图"
  if (variant === "compress1") return "压缩图1"
  return "压缩图2"
}

function getAssetPath(item: ItemDraft, variant: ItemImageVariant) {
  if (variant === "compress1") return item.img_compress_1.trim()
  if (variant === "compress2") return item.img_compress_2.trim()
  return item.img_raw.trim()
}

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

function getAssetUrl(item: ItemDraft, variant: ItemImageVariant) {
  const assetPath = getAssetPath(item, variant)
  return assetPath ? getStoryAssetUrl(props.storyId, assetPath) : ""
}

function openImagePreview(title: string, assetPath: string) {
  const trimmedPath = assetPath.trim()

  if (!trimmedPath) return

  imagePreviewState.path = trimmedPath
  imagePreviewState.title = title
  imagePreviewState.url = getStoryAssetUrl(props.storyId, trimmedPath)
}

function closeImagePreview() {
  imagePreviewState.path = ""
  imagePreviewState.title = ""
  imagePreviewState.url = ""
}

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

async function hydrateAssetMeta() {
  const tasks: Promise<void>[] = []

  for (const item of draft.items) {
    tasks.push(loadAssetMeta(item, "raw"))
    tasks.push(loadAssetMeta(item, "compress1"))
    tasks.push(loadAssetMeta(item, "compress2"))
  }

  await Promise.allSettled(tasks)
}

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

function getCategoryName(categoryId: string) {
  const normalizedId = sanitizeIdInput(categoryId)
  const category = draft.categories.find((item) => sanitizeIdInput(item.id) === normalizedId)
  return category?.name.trim() || category?.id.trim() || ""
}

function getCategoryUsageCount(category: ItemCategoryDraft) {
  return categoryUsageCounts.value.get(sanitizeIdInput(category.id)) ?? 0
}

function openCategoryDialog() {
  isCategoryDialogOpen.value = true
}

function closeCategoryDialog() {
  isCategoryDialogOpen.value = false
}

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

function removeCategory(index: number) {
  const category = draft.categories[index]
  if (!category || getCategoryUsageCount(category) > 0) {
    return
  }

  draft.categories.splice(index, 1)
}

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

function removeItem(index: number) {
  const item = draft.items[index]
  if (!item) return
  clearAssetState(item)
  clearPromptState(item)
  draft.items.splice(index, 1)
}

function getSelectedItems() {
  return draft.items.filter((item) => item.selected)
}

function openPromptEditor(item: ItemDraft) {
  promptEditorState.itemKey = item.draftKey
  promptEditorState.value = item.prompt
}

function closePromptEditor() {
  promptEditorState.itemKey = null
  promptEditorState.value = ""
}

function savePromptEditor() {
  const item = draft.items.find((currentItem) => currentItem.draftKey === promptEditorState.itemKey)

  if (item) {
    item.prompt = promptEditorState.value.trim()
  }

  closePromptEditor()
}

function getPromptPreview(prompt: string) {
  const trimmedPrompt = prompt.trim()
  return trimmedPrompt ? trimmedPrompt.slice(0, 48) : "编辑提示词"
}

function getImagePreviewTitle(item: ItemDraft, variant: ItemImageVariant) {
  return `${item.name.trim() || item.id.trim() || "物品"} ${getImageVariantLabel(variant)}`
}

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
</script>

<template>
  <Teleport to="body">
    <div class="items-dialog">
      <section class="items-dialog__panel glass-panel">
        <div class="items-dialog__header">
          <div>
            <span class="eyebrow">Items</span>
            <h2 class="items-dialog__title">物品库</h2>
          </div>
          <div class="items-dialog__actions">
            <span v-if="saveSuccessMessage" class="items-dialog__success">{{ saveSuccessMessage }}</span>
            <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
          </div>
        </div>

        <div class="items-dialog__body">
          <section class="items-dialog__config">
            <h3 class="items-dialog__config-title">AI 图片配置</h3>
            <div class="items-dialog__config-grid">
              <label class="items-dialog__field">
                <span class="items-dialog__label">图片宽度</span>
                <input v-model="draft.ai.imageWidthText" class="text-input" type="text">
              </label>
              <label class="items-dialog__field">
                <span class="items-dialog__label">图片高度</span>
                <input v-model="draft.ai.imageHeightText" class="text-input" type="text">
              </label>
              <label class="items-dialog__field">
                <span class="items-dialog__label">压缩质量1</span>
                <input v-model="draft.ai.compressQuality1Text" class="text-input" type="text">
              </label>
              <label class="items-dialog__field">
                <span class="items-dialog__label">压缩质量2</span>
                <input v-model="draft.ai.compressQuality2Text" class="text-input" type="text">
              </label>
              <label class="items-dialog__field items-dialog__field--wide">
                <span class="items-dialog__label">整体提示词</span>
                <textarea
                  v-model="draft.ai.globalPrompt"
                  class="text-input items-dialog__textarea"
                  rows="2"
                />
              </label>
            </div>
          </section>

          <div class="items-dialog__toolbar">
            <div class="items-dialog__count">
              当前物品数：{{ draft.items.length }}，分类：{{ draft.categories.length }}，已选择：{{ selectedCount }}
            </div>
            <div class="items-dialog__batch-actions">
              <button
                class="btn-secondary items-dialog__row-button"
                type="button"
                @click="openCategoryDialog"
              >
                分类
              </button>
              <label class="items-dialog__select-all">
                <input v-model="allSelected" type="checkbox">
                全选
              </label>
              <button
                class="btn-secondary items-dialog__row-button"
                type="button"
                :disabled="!canBatchGeneratePrompts"
                @click="handleBatchGeneratePrompts"
              >
                {{
                  batchState.generatingPrompts
                    ? `批量生成中 ${batchState.promptDone}/${batchState.promptTotal}`
                    : "批量生成提示词"
                }}
              </button>
              <button
                class="btn-secondary items-dialog__row-button"
                type="button"
                :disabled="!canBatchGenerateImages"
                @click="handleBatchGenerateImages"
              >
                {{
                  batchState.generatingImages
                    ? `批量生图中 ${batchState.imageDone}/${batchState.imageTotal}`
                    : "批量生成原图"
                }}
              </button>
              <button
                class="btn-secondary items-dialog__row-button"
                type="button"
                :disabled="!canBatchCompressImages1"
                @click="handleBatchCompressImages(1)"
              >
                {{
                  batchState.compressing1
                    ? `批量压缩1中 ${batchState.compress1Done}/${batchState.compress1Total}`
                    : "批量压缩到1"
                }}
              </button>
              <button
                class="btn-secondary items-dialog__row-button"
                type="button"
                :disabled="!canBatchCompressImages2"
                @click="handleBatchCompressImages(2)"
              >
                {{
                  batchState.compressing2
                    ? `批量压缩2中 ${batchState.compress2Done}/${batchState.compress2Total}`
                    : "批量压缩到2"
                }}
              </button>
            </div>
          </div>

          <div v-if="duplicateItemIds.size" class="items-dialog__warning">
            物品 ID 不能重复。
          </div>
          <div v-if="invalidCategoryReferenceCount" class="items-dialog__warning">
            有 {{ invalidCategoryReferenceCount }} 个物品引用了不存在的分类。
          </div>

          <div class="items-dialog__table-wrap">
            <table class="items-dialog__table">
              <thead>
                <tr>
                  <th class="items-dialog__select-col">选择</th>
                  <th>ID / 名称</th>
                  <th>分类</th>
                  <th>属性</th>
                  <th>描述</th>
                  <th>提示词</th>
                  <th>图片</th>
                  <th>AI 操作</th>
                  <th class="items-dialog__actions-col">操作</th>
                </tr>
              </thead>
              <tbody v-if="draft.items.length">
                <tr v-for="(item, index) in draft.items" :key="item.draftKey">
                  <td class="items-dialog__select-col">
                    <input v-model="item.selected" type="checkbox">
                  </td>
                  <td>
                    <div class="items-dialog__cell-stack">
                      <input
                        v-model="item.id"
                        class="text-input items-dialog__cell-input"
                        type="text"
                        placeholder="cash_10000"
                      >
                      <input
                        v-model="item.name"
                        class="text-input items-dialog__cell-input"
                        type="text"
                        placeholder="一万元现金"
                      >
                    </div>
                  </td>
                  <td>
                    <select v-model="item.category_id" class="text-input items-dialog__cell-input">
                      <option
                        v-for="category in sortedCategoryOptions"
                        :key="category.draftKey"
                        :value="category.id"
                      >
                        {{ category.name || category.id }}
                      </option>
                    </select>
                  </td>
                  <td>
                    <div class="items-dialog__cell-stack">
                      <input
                        v-model="item.rarity"
                        class="text-input items-dialog__cell-input"
                        type="text"
                        placeholder="common"
                      >
                      <input
                        v-model="item.tagsText"
                        class="text-input items-dialog__cell-input"
                        type="text"
                        placeholder="标签，用逗号分隔"
                      >
                      <label class="items-dialog__inline-check">
                        <input v-model="item.stackable" type="checkbox">
                        可堆叠
                      </label>
                      <input
                        v-model="item.maxStackText"
                        class="text-input items-dialog__cell-input"
                        type="text"
                        placeholder="最大堆叠"
                      >
                      <label class="items-dialog__inline-check">
                        <input v-model="item.usable" type="checkbox">
                        可使用
                      </label>
                    </div>
                  </td>
                  <td>
                    <textarea
                      v-model="item.descr"
                      class="text-input items-dialog__textarea items-dialog__textarea--cell"
                      rows="4"
                      placeholder="物品说明、来源、用途、在剧情中的价值"
                    />
                  </td>
                  <td>
                    <div class="items-dialog__prompt-cell">
                      <button
                        class="items-dialog__prompt-link"
                        type="button"
                        @click="openPromptEditor(item)"
                      >
                        {{ getPromptPreview(item.prompt) }}
                      </button>
                      <span v-if="getPromptState(item).loading" class="items-dialog__status">
                        生成中...
                      </span>
                      <span v-if="getPromptState(item).error" class="items-dialog__error">
                        {{ getPromptState(item).error }}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="items-dialog__asset-grid">
                      <div
                        v-for="variant in ['raw', 'compress1', 'compress2'] as ItemImageVariant[]"
                        :key="variant"
                        class="items-dialog__asset-card"
                      >
                        <span class="items-dialog__asset-title">{{ getImageVariantLabel(variant) }}</span>
                        <button
                          v-if="variant === 'raw' && getAssetPath(item, variant)"
                          class="items-dialog__asset-thumb-button"
                          type="button"
                          @click="openImagePreview(getImagePreviewTitle(item, variant), getAssetPath(item, variant))"
                        >
                          <img
                            class="items-dialog__asset-thumb"
                            :src="getAssetUrl(item, variant)"
                            :alt="`${item.name || item.id || '物品'} ${getImageVariantLabel(variant)} 缩略图`"
                            loading="lazy"
                          >
                        </button>
                        <a
                          v-if="getAssetPath(item, variant)"
                          class="items-dialog__asset-link"
                          :href="getAssetUrl(item, variant)"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {{ getAssetPath(item, variant) }}
                        </a>
                        <span v-else class="items-dialog__asset-empty">暂无图片</span>
                        <span
                          v-if="formatAssetMeta(getAssetState(item, variant).meta)"
                          class="items-dialog__asset-meta"
                        >
                          {{ formatAssetMeta(getAssetState(item, variant).meta) }}
                        </span>
                        <span v-if="getAssetState(item, variant).loading" class="items-dialog__status">
                          处理中...
                        </span>
                        <span v-if="getAssetState(item, variant).error" class="items-dialog__error">
                          {{ getAssetState(item, variant).error }}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div class="items-dialog__action-stack">
                      <button
                        class="btn-secondary items-dialog__row-button"
                        type="button"
                        :disabled="getPromptState(item).loading || !item.descr.trim()"
                        @click="handleGeneratePrompt(item)"
                      >
                        生成提示词
                      </button>
                      <button
                        class="btn-secondary items-dialog__row-button"
                        type="button"
                        :disabled="getAssetState(item, 'raw').loading || !item.prompt.trim() || parsePositiveIntegerInput(draft.ai.imageWidthText) === null || parsePositiveIntegerInput(draft.ai.imageHeightText) === null"
                        @click="handleGenerateImage(item)"
                      >
                        生成原图
                      </button>
                      <button
                        class="btn-secondary items-dialog__row-button"
                        type="button"
                        :disabled="getAssetState(item, 'compress1').loading || !item.img_raw.trim()"
                        @click="handleCompressImage(item, 1)"
                      >
                        压缩到1
                      </button>
                      <button
                        class="btn-secondary items-dialog__row-button"
                        type="button"
                        :disabled="getAssetState(item, 'compress2').loading || !item.img_raw.trim()"
                        @click="handleCompressImage(item, 2)"
                      >
                        压缩到2
                      </button>
                    </div>
                  </td>
                  <td class="items-dialog__actions-col">
                    <button
                      class="btn-secondary items-dialog__row-button"
                      type="button"
                      @click="removeItem(index)"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="!draft.items.length" class="items-dialog__empty">
              还没有物品，先添加一行。
            </div>
          </div>

          <div class="items-dialog__footer">
            <button class="btn-secondary items-dialog__row-add" type="button" @click="addItem">
              + 添加物品
            </button>
          </div>
        </div>

        <div class="items-dialog__actions items-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
          <button
            class="btn-primary"
            type="button"
            :disabled="saving || hasInvalidDraft"
            @click="submitDraft"
          >
            {{ saving ? "保存中..." : "保存" }}
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="isCategoryDialogOpen"
      class="items-dialog__category-modal"
      @click.self="closeCategoryDialog"
    >
      <section class="items-dialog__category-panel glass-panel">
        <div class="items-dialog__category-head">
          <div>
            <h3 class="items-dialog__prompt-title">物品分类</h3>
            <span class="items-dialog__label">当前分类数：{{ draft.categories.length }}</span>
          </div>
          <div class="items-dialog__actions">
            <button class="btn-secondary" type="button" @click="addCategory">+ 添加分类</button>
            <button class="btn-secondary" type="button" @click="closeCategoryDialog">关闭</button>
          </div>
        </div>

        <div v-if="duplicateCategoryIds.size" class="items-dialog__warning">
          分类 ID 不能重复。
        </div>

        <div class="items-dialog__category-table-wrap">
          <table class="items-dialog__category-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>排序</th>
                <th>说明</th>
                <th>使用数</th>
                <th class="items-dialog__actions-col">操作</th>
              </tr>
            </thead>
            <tbody v-if="draft.categories.length">
              <tr v-for="(category, index) in draft.categories" :key="category.draftKey">
                <td>
                  <input v-model="category.id" class="text-input items-dialog__cell-input" type="text" placeholder="prop">
                </td>
                <td>
                  <input v-model="category.name" class="text-input items-dialog__cell-input" type="text" placeholder="道具">
                </td>
                <td>
                  <input v-model.number="category.sort_order" class="text-input items-dialog__sort-input" type="number">
                </td>
                <td>
                  <textarea
                    v-model="category.descr"
                    class="text-input items-dialog__textarea items-dialog__category-descr"
                    rows="2"
                    placeholder="分类说明"
                  />
                </td>
                <td class="items-dialog__category-usage">
                  {{ getCategoryUsageCount(category) }}
                </td>
                <td class="items-dialog__actions-col">
                  <button
                    class="btn-secondary items-dialog__row-button"
                    type="button"
                    :disabled="getCategoryUsageCount(category) > 0"
                    @click="removeCategory(index)"
                  >
                    删除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <div v-if="!draft.categories.length" class="items-dialog__empty">
            还没有分类，先添加一行。
          </div>
        </div>
      </section>
    </div>

    <div v-if="promptEditorState.itemKey" class="items-dialog__prompt-modal">
      <section class="items-dialog__prompt-panel glass-panel">
        <div class="items-dialog__prompt-head">
          <h3 class="items-dialog__prompt-title">编辑提示词</h3>
          <button class="btn-secondary" type="button" @click="closePromptEditor">关闭</button>
        </div>

        <textarea
          v-model="promptEditorState.value"
          class="text-input items-dialog__prompt-textarea"
          rows="10"
          placeholder="这里填写或修改当前物品的最终提示词"
        />

        <div class="items-dialog__actions items-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="closePromptEditor">取消</button>
          <button class="btn-primary" type="button" @click="savePromptEditor">保存提示词</button>
        </div>
      </section>
    </div>

    <div
      v-if="imagePreviewState.url"
      class="items-dialog__image-modal"
      @click.self="closeImagePreview"
    >
      <section class="items-dialog__image-panel glass-panel">
        <div class="items-dialog__image-head">
          <div class="items-dialog__image-copy">
            <h3 class="items-dialog__image-title">{{ imagePreviewState.title }}</h3>
            <span class="items-dialog__image-path">{{ imagePreviewState.path }}</span>
          </div>
          <button class="btn-secondary" type="button" @click="closeImagePreview">关闭</button>
        </div>

        <div class="items-dialog__image-frame">
          <img
            class="items-dialog__image-full"
            :src="imagePreviewState.url"
            :alt="imagePreviewState.title"
          >
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.items-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.items-dialog__panel {
  width: min(1760px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: auto;
  border-radius: 22px;
}

.items-dialog__header,
.items-dialog__section-head,
.items-dialog__toolbar,
.items-dialog__category-head,
.items-dialog__prompt-head,
.items-dialog__image-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.items-dialog__title,
.items-dialog__config-title,
.items-dialog__prompt-title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
  line-height: 1.1;
}

.items-dialog__body {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.items-dialog__config {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.items-dialog__config-grid {
  display: grid;
  grid-template-columns:
    minmax(160px, 200px)
    minmax(160px, 200px)
    minmax(160px, 200px)
    minmax(160px, 200px)
    minmax(0, 1fr);
  gap: 12px;
}

.items-dialog__field {
  display: grid;
  gap: 6px;
}

.items-dialog__field--wide {
  grid-column: 1 / -1;
  min-width: 0;
}

.items-dialog__label,
.items-dialog__count,
.items-dialog__category-usage,
.items-dialog__select-all {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.items-dialog__toolbar,
.items-dialog__batch-actions,
.items-dialog__actions,
.items-dialog__select-all {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.items-dialog__batch-actions {
  justify-content: flex-end;
}

.items-dialog__warning {
  color: var(--warning);
  font-size: 0.82rem;
}

.items-dialog__success {
  color: var(--accent);
  font-size: 0.84rem;
}

.items-dialog__textarea {
  resize: vertical;
}

.items-dialog__textarea--cell {
  min-height: 92px;
}

.items-dialog__table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.items-dialog__table {
  width: 100%;
  min-width: 1740px;
  border-collapse: collapse;
}

.items-dialog__table th,
.items-dialog__table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.items-dialog__table th {
  position: sticky;
  top: 0;
  background: rgba(9, 19, 30, 0.92);
  color: var(--text-muted);
  font-size: 0.82rem;
}

.items-dialog__select-col {
  width: 56px;
  text-align: center;
}

.items-dialog__actions-col {
  width: 96px;
}

.items-dialog__cell-stack,
.items-dialog__prompt-cell,
.items-dialog__asset-card,
.items-dialog__action-stack {
  display: grid;
  gap: 6px;
}

.items-dialog__cell-input {
  min-width: 0;
}

.items-dialog__inline-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.items-dialog__prompt-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 0.8rem;
  text-align: left;
  word-break: break-all;
}

.items-dialog__status,
.items-dialog__error {
  font-size: 0.76rem;
  line-height: 1.3;
}

.items-dialog__status,
.items-dialog__asset-empty,
.items-dialog__asset-meta {
  color: var(--text-muted);
}

.items-dialog__error {
  color: var(--warning);
}

.items-dialog__asset-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.items-dialog__asset-title {
  color: var(--text-muted);
  font-size: 0.76rem;
}

.items-dialog__asset-thumb-button {
  justify-self: start;
  width: 78px;
  aspect-ratio: 1;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(186, 220, 255, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  cursor: zoom-in;
}

.items-dialog__asset-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.items-dialog__asset-link,
.items-dialog__asset-empty,
.items-dialog__asset-meta {
  min-width: 0;
  font-size: 0.78rem;
  line-height: 1.3;
}

.items-dialog__asset-link {
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}

.items-dialog__row-add,
.items-dialog__row-button {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 0.8rem;
}

.items-dialog__empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.items-dialog__footer {
  display: flex;
  justify-content: flex-start;
}

.items-dialog__actions--footer {
  margin-top: 16px;
  justify-content: flex-end;
}

.items-dialog__category-modal {
  position: fixed;
  inset: 0;
  z-index: 61;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.78);
}

.items-dialog__category-panel {
  width: min(1040px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  padding: 18px;
  overflow: auto;
  border-radius: 20px;
}

.items-dialog__category-table-wrap {
  margin-top: 12px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.items-dialog__category-table {
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
}

.items-dialog__category-table th,
.items-dialog__category-table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.items-dialog__category-table th {
  position: sticky;
  top: 0;
  background: rgba(9, 19, 30, 0.92);
  color: var(--text-muted);
  font-size: 0.82rem;
}

.items-dialog__sort-input {
  width: 90px;
  min-width: 0;
}

.items-dialog__category-descr {
  min-height: 58px;
}

.items-dialog__category-usage {
  text-align: center;
}

.items-dialog__prompt-modal {
  position: fixed;
  inset: 0;
  z-index: 62;
  display: grid;
  place-items: center;
  padding: 20px;
  pointer-events: none;
}

.items-dialog__prompt-panel {
  width: min(880px, calc(100vw - 48px));
  padding: 18px;
  border-radius: 20px;
  pointer-events: auto;
}

.items-dialog__prompt-textarea {
  width: 100%;
  min-height: 240px;
  margin-top: 14px;
  resize: vertical;
}

.items-dialog__image-modal {
  position: fixed;
  inset: 0;
  z-index: 63;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.82);
}

.items-dialog__image-panel {
  width: min(1120px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  padding: 18px;
  overflow: auto;
  border-radius: 20px;
}

.items-dialog__image-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.items-dialog__image-title {
  margin: 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.1rem;
  line-height: 1.2;
}

.items-dialog__image-path {
  min-width: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.4;
  word-break: break-all;
}

.items-dialog__image-frame {
  display: grid;
  place-items: center;
  margin-top: 14px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
}

.items-dialog__image-full {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 220px);
  object-fit: contain;
}

@media (max-width: 900px) {
  .items-dialog__header,
  .items-dialog__section-head,
  .items-dialog__actions,
  .items-dialog__toolbar,
  .items-dialog__config-grid,
  .items-dialog__category-head,
  .items-dialog__prompt-head,
  .items-dialog__image-head {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }

  .items-dialog__asset-grid {
    grid-template-columns: 1fr;
  }
}
</style>
