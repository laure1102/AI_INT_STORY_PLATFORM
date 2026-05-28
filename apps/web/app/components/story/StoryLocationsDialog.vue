<script setup lang="ts">
import type { StoryEventLocationFile } from "@story-mgr/core"
import type { StoryAssetMetadata } from "@story-mgr/shared"

interface LocationDraft {
  draftKey: string
  descr: string
  img: string
  name: string
  prompt: string
  selected: boolean
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

const props = defineProps<{
  eventLocations: StoryEventLocationFile
  saveSuccessMessage?: string | null
  saving: boolean
  storyId: string
  storyTitle?: string
}>()

const emit = defineEmits<{
  close: []
  save: [eventLocations: StoryEventLocationFile]
}>()

const {
  compressLocationImage,
  generateLocationImage,
  generateLocationPrompt,
  getStoryAssetMeta,
  getStoryAssetUrl
} = useStoryApi()

const draft = reactive({
  aiGlobalPrompt: "",
  aiImageWidthText: "1536",
  aiImageHeightText: "1024",
  compressQualityText: "60",
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
  compressing: false,
  generatingImages: false,
  generatingPrompts: false,
  compressDone: 0,
  compressTotal: 0,
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

function sanitizeNameInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function parseCompressQualityInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null
}

function parseImageDimensionInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

function getNextDefaultName() {
  const usedNames = new Set(
    draft.assignments.map((assignment) => assignment.name.trim()).filter(Boolean)
  )

  let index = draft.assignments.length + 1
  let candidate = `location_${index}`

  while (usedNames.has(candidate)) {
    index += 1
    candidate = `location_${index}`
  }

  return candidate
}

function createEmptyAssetState(): LocationAssetState {
  return {
    error: null,
    loading: false,
    meta: null
  }
}

function createEmptyPromptState(): LocationPromptState {
  return {
    error: null,
    loading: false
  }
}

function getAssetStateKey(draftKey: string) {
  return `${draftKey}:img`
}

function getPromptStateKey(draftKey: string) {
  return `${draftKey}:prompt`
}

function initializeAssetState(assignment: LocationDraft) {
  assetStates[getAssetStateKey(assignment.draftKey)] = createEmptyAssetState()
}

function initializePromptState(assignment: LocationDraft) {
  promptStates[getPromptStateKey(assignment.draftKey)] = createEmptyPromptState()
}

function clearAssetState(assignment: LocationDraft) {
  delete assetStates[getAssetStateKey(assignment.draftKey)]
}

function clearPromptState(assignment: LocationDraft) {
  delete promptStates[getPromptStateKey(assignment.draftKey)]
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

function getAssetState(assignment: LocationDraft) {
  return assetStates[getAssetStateKey(assignment.draftKey)]
}

function getPromptState(assignment: LocationDraft) {
  return promptStates[getPromptStateKey(assignment.draftKey)]
}

function cloneAssignment(assignment: StoryEventLocationFile["assignments"][number]): LocationDraft {
  const draftAssignment = {
    draftKey: createDraftKey("location"),
    descr: normalizeText(assignment.descr),
    img: normalizeText(assignment.img),
    name: normalizeText(assignment.name),
    prompt: normalizeText(assignment.prompt),
    selected: false
  }

  initializeAssetState(draftAssignment)
  initializePromptState(draftAssignment)
  return draftAssignment
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
  return error instanceof Error ? error.message : fallback
}

function getAssetUrl(assignment: LocationDraft) {
  const assetPath = assignment.img.trim()
  return assetPath ? getStoryAssetUrl(props.storyId, assetPath) : ""
}

function getImagePreviewTitle(name: string) {
  const trimmedName = name.trim()
  return trimmedName ? `${trimmedName} 图片预览` : "图片预览"
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

async function loadAssetMeta(assignment: LocationDraft) {
  const state = getAssetState(assignment)
  const assetPath = assignment.img.trim()

  state.error = null

  if (!assetPath) {
    state.loading = false
    state.meta = null
    return
  }

  state.loading = true

  try {
    const asset = await getStoryAssetMeta(props.storyId, assetPath)

    if (assignment.img.trim() === assetPath) {
      state.meta = asset
      state.error = null
    }
  } catch (error) {
    if (assignment.img.trim() === assetPath) {
      state.meta = null
      state.error = formatErrorMessage(error, "读取图片信息失败。")
    }
  } finally {
    if (assignment.img.trim() === assetPath) {
      state.loading = false
    }
  }
}

async function hydrateAssetMeta() {
  await Promise.allSettled(draft.assignments.map((assignment) => loadAssetMeta(assignment)))
}

function syncDraft(eventLocations: StoryEventLocationFile) {
  resetAssetStates()
  resetPromptStates()
  draft.aiGlobalPrompt = normalizeText(eventLocations.ai.global_prompt)
  draft.aiImageWidthText = String(eventLocations.ai.width ?? 1536)
  draft.aiImageHeightText = String(eventLocations.ai.height ?? 1024)
  draft.compressQualityText = String(eventLocations.ai.compress_quality ?? 60)
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

const duplicateNames = computed(() => {
  const counts = new Map<string, number>()

  for (const assignment of draft.assignments) {
    const normalizedName = sanitizeNameInput(assignment.name)
    if (!normalizedName) continue
    counts.set(normalizedName, (counts.get(normalizedName) ?? 0) + 1)
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
  )
})

const hasInvalidDraft = computed(() => {
  if (parseImageDimensionInput(draft.aiImageWidthText) === null) return true
  if (parseImageDimensionInput(draft.aiImageHeightText) === null) return true
  if (parseCompressQualityInput(draft.compressQualityText) === null) return true

  return draft.assignments.some((assignment) => !sanitizeNameInput(assignment.name))
    || duplicateNames.value.size > 0
})

const hasBatchSelection = computed(() => selectedCount.value > 0)
const isBatchRunning = computed(
  () => batchState.generatingPrompts || batchState.generatingImages || batchState.compressing
)
const canBatchGeneratePrompts = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && draft.assignments.some((assignment) => assignment.selected && assignment.descr.trim())
)
const canBatchGenerateImages = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && parseImageDimensionInput(draft.aiImageWidthText) !== null
  && parseImageDimensionInput(draft.aiImageHeightText) !== null
  && draft.assignments.some((assignment) => assignment.selected && assignment.prompt.trim())
)
const canBatchCompressImages = computed(() =>
  hasBatchSelection.value
  && !isBatchRunning.value
  && draft.assignments.some((assignment) => assignment.selected && assignment.img.trim())
)

function addLocation() {
  const assignment: LocationDraft = {
    draftKey: createDraftKey("location"),
    descr: "",
    img: "",
    name: getNextDefaultName(),
    prompt: "",
    selected: false
  }

  initializeAssetState(assignment)
  initializePromptState(assignment)
  draft.assignments.push(assignment)
}

function removeLocation(index: number) {
  const assignment = draft.assignments[index]
  if (!assignment) return
  clearAssetState(assignment)
  clearPromptState(assignment)
  draft.assignments.splice(index, 1)
}

function getSelectedAssignments() {
  return draft.assignments.filter((assignment) => assignment.selected)
}

function openPromptEditor(assignment: LocationDraft) {
  promptEditorState.locationKey = assignment.draftKey
  promptEditorState.value = assignment.prompt
}

function closePromptEditor() {
  promptEditorState.locationKey = null
  promptEditorState.value = ""
}

function savePromptEditor() {
  const assignment = draft.assignments.find(
    (currentAssignment) => currentAssignment.draftKey === promptEditorState.locationKey
  )

  if (assignment) {
    assignment.prompt = promptEditorState.value.trim()
  }

  closePromptEditor()
}

function getPromptPreview(prompt: string) {
  const trimmedPrompt = prompt.trim()
  return trimmedPrompt ? trimmedPrompt.slice(0, 48) : "编辑提示词"
}

async function handleGeneratePrompt(assignment: LocationDraft) {
  const state = getPromptState(assignment)
  state.error = null
  state.loading = true

  try {
    assignment.prompt = await generateLocationPrompt(props.storyId, {
      descr: assignment.descr,
      locationName: assignment.name,
      storyTitle: props.storyTitle
    })
  } catch (error) {
    state.error = formatErrorMessage(error, "生成提示词失败。")
  } finally {
    state.loading = false
  }
}

async function handleGenerateImage(assignment: LocationDraft) {
  const state = getAssetState(assignment)
  state.error = null
  state.loading = true

  try {
    const asset = await generateLocationImage(props.storyId, {
      globalPrompt: draft.aiGlobalPrompt,
      width: parseImageDimensionInput(draft.aiImageWidthText) ?? 1536,
      height: parseImageDimensionInput(draft.aiImageHeightText) ?? 1024,
      prompt: assignment.prompt,
      targetName: assignment.name
    })

    assignment.img = asset.assetPath
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, "生成图片失败。")
  } finally {
    state.loading = false
  }
}

async function handleCompressImage(assignment: LocationDraft) {
  const state = getAssetState(assignment)
  state.error = null
  state.loading = true

  try {
    const asset = await compressLocationImage(props.storyId, {
      quality: parseCompressQualityInput(draft.compressQualityText) ?? 60,
      sourcePath: assignment.img,
      targetName: assignment.name
    })

    assignment.img = asset.assetPath
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, "压缩图片失败。")
  } finally {
    state.loading = false
  }
}

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

async function handleBatchGenerateImages() {
  const assignments = getSelectedAssignments().filter((assignment) => assignment.prompt.trim())
  if (
    !assignments.length ||
    parseImageDimensionInput(draft.aiImageWidthText) === null ||
    parseImageDimensionInput(draft.aiImageHeightText) === null
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

async function handleBatchCompressImages() {
  const assignments = getSelectedAssignments().filter((assignment) => assignment.img.trim())
  if (!assignments.length) return

  batchState.compressing = true
  batchState.compressDone = 0
  batchState.compressTotal = assignments.length

  try {
    for (const assignment of assignments) {
      await handleCompressImage(assignment)
      batchState.compressDone += 1
    }
  } finally {
    batchState.compressing = false
  }
}

function submitDraft() {
  emit("save", {
    ai: {
      compress_quality: parseCompressQualityInput(draft.compressQualityText) ?? 60,
      global_prompt: draft.aiGlobalPrompt.trim(),
      width: parseImageDimensionInput(draft.aiImageWidthText) ?? 1536,
      height: parseImageDimensionInput(draft.aiImageHeightText) ?? 1024
    },
    assignments: draft.assignments.map((assignment) => ({
      descr: assignment.descr.trim(),
      img: assignment.img.trim(),
      name: sanitizeNameInput(assignment.name),
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
</script>

<template>
  <Teleport to="body">
    <div class="locations-dialog">
      <section class="locations-dialog__panel glass-panel">
        <div class="locations-dialog__header">
          <div>
            <span class="eyebrow">地点</span>
            <h2 class="locations-dialog__title">地点设置</h2>
          </div>

          <div class="locations-dialog__actions">
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
        </div>

        <div class="locations-dialog__body">
          <div v-if="props.saveSuccessMessage" class="locations-dialog__success">
            {{ props.saveSuccessMessage }}
          </div>

          <section class="locations-dialog__config">
            <div class="locations-dialog__config-head">
              <h3 class="locations-dialog__config-title">地点 AI 配置</h3>
            </div>

            <div class="locations-dialog__config-grid">
              <label class="locations-dialog__field">
                <span class="locations-dialog__label">图片宽度</span>
                <input
                  v-model="draft.aiImageWidthText"
                  class="text-input"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="1536"
                />
              </label>

              <label class="locations-dialog__field">
                <span class="locations-dialog__label">图片高度</span>
                <input
                  v-model="draft.aiImageHeightText"
                  class="text-input"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="1024"
                />
              </label>

              <label class="locations-dialog__field">
                <span class="locations-dialog__label">压缩质量</span>
                <input
                  v-model="draft.compressQualityText"
                  class="text-input"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="60"
                />
              </label>

              <label class="locations-dialog__field locations-dialog__field--wide">
                <span class="locations-dialog__label">整体提示词</span>
                <textarea
                  v-model="draft.aiGlobalPrompt"
                  class="text-input locations-dialog__textarea"
                  rows="3"
                  placeholder="统一风格、时代背景、镜头语言、材质倾向等"
                />
              </label>
            </div>
          </section>

          <div class="locations-dialog__toolbar">
            <div class="locations-dialog__count">
              当前地点数：{{ locationCount }}，已选择：{{ selectedCount }}
            </div>

            <div class="locations-dialog__batch-actions">
              <label class="locations-dialog__select-all">
                <input v-model="allSelected" type="checkbox" />
                <span>全选</span>
              </label>

              <button
                class="btn-secondary locations-dialog__row-button"
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
                class="btn-secondary locations-dialog__row-button"
                type="button"
                :disabled="!canBatchGenerateImages"
                @click="handleBatchGenerateImages"
              >
                {{
                  batchState.generatingImages
                    ? `批量生图中 ${batchState.imageDone}/${batchState.imageTotal}`
                    : "批量生成图片"
                }}
              </button>

              <button
                class="btn-secondary locations-dialog__row-button"
                type="button"
                :disabled="!canBatchCompressImages"
                @click="handleBatchCompressImages"
              >
                {{
                  batchState.compressing
                    ? `批量压缩中 ${batchState.compressDone}/${batchState.compressTotal}`
                    : "批量压缩图片"
                }}
              </button>
            </div>
          </div>

          <div v-if="duplicateNames.size" class="locations-dialog__warning">
            地点名称不能重复，请检查 `name`。
          </div>

          <div class="locations-dialog__table-wrap">
            <table class="locations-dialog__table">
              <thead>
                <tr>
                  <th class="locations-dialog__select-col">选择</th>
                  <th>名称</th>
                  <th>描述</th>
                  <th>提示词</th>
                  <th>图片</th>
                  <th>AI 操作</th>
                  <th class="locations-dialog__actions-col">操作</th>
                </tr>
              </thead>
              <tbody v-if="draft.assignments.length">
                <tr v-for="(assignment, index) in draft.assignments" :key="assignment.draftKey">
                  <td class="locations-dialog__select-col">
                    <input v-model="assignment.selected" type="checkbox" />
                  </td>
                  <td>
                    <input
                      v-model="assignment.name"
                      class="text-input locations-dialog__cell-input"
                      type="text"
                      placeholder="office"
                    />
                  </td>
                  <td>
                    <textarea
                      v-model="assignment.descr"
                      class="text-input locations-dialog__textarea locations-dialog__textarea--cell"
                      rows="3"
                      placeholder="办公室，落地窗，夜景，现代商务风"
                    />
                  </td>
                  <td>
                    <div class="locations-dialog__prompt-cell">
                      <button
                        class="locations-dialog__prompt-link"
                        type="button"
                        @click="openPromptEditor(assignment)"
                      >
                        {{ getPromptPreview(assignment.prompt) }}
                      </button>
                      <span
                        v-if="getPromptState(assignment).loading"
                        class="locations-dialog__prompt-status"
                      >
                        生成中...
                      </span>
                      <span
                        v-if="getPromptState(assignment).error"
                        class="locations-dialog__prompt-error"
                      >
                        {{ getPromptState(assignment).error }}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="locations-dialog__asset-cell">
                      <button
                        v-if="assignment.img"
                        class="locations-dialog__asset-thumb-button"
                        type="button"
                        @click="openImagePreview(getImagePreviewTitle(assignment.name), assignment.img)"
                      >
                        <img
                          class="locations-dialog__asset-thumb"
                          :src="getAssetUrl(assignment)"
                          :alt="assignment.name || '地点缩略图'"
                          loading="lazy"
                        />
                      </button>
                      <a
                        v-if="assignment.img"
                        class="locations-dialog__asset-link"
                        :href="getAssetUrl(assignment)"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {{ assignment.img }}
                      </a>
                      <span v-else class="locations-dialog__asset-empty">未生成图片</span>
                      <span
                        v-if="formatAssetMeta(getAssetState(assignment).meta)"
                        class="locations-dialog__asset-meta"
                      >
                        {{ formatAssetMeta(getAssetState(assignment).meta) }}
                      </span>
                      <span
                        v-if="getAssetState(assignment).loading"
                        class="locations-dialog__asset-status"
                      >
                        处理中...
                      </span>
                      <span
                        v-if="getAssetState(assignment).error"
                        class="locations-dialog__asset-error"
                      >
                        {{ getAssetState(assignment).error }}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="locations-dialog__action-stack">
                      <button
                        class="btn-secondary locations-dialog__row-button"
                        type="button"
                        :disabled="getPromptState(assignment).loading || !assignment.descr.trim()"
                        @click="handleGeneratePrompt(assignment)"
                      >
                        生成提示词
                      </button>
                      <button
                        class="btn-secondary locations-dialog__row-button"
                        type="button"
                        :disabled="getAssetState(assignment).loading || !assignment.prompt.trim() || parseImageDimensionInput(draft.aiImageWidthText) === null || parseImageDimensionInput(draft.aiImageHeightText) === null"
                        @click="handleGenerateImage(assignment)"
                      >
                        生成图片
                      </button>
                      <button
                        class="btn-secondary locations-dialog__row-button"
                        type="button"
                        :disabled="getAssetState(assignment).loading || !assignment.img.trim()"
                        @click="handleCompressImage(assignment)"
                      >
                        压缩图片
                      </button>
                    </div>
                  </td>
                  <td class="locations-dialog__actions-col">
                    <button
                      class="btn-secondary locations-dialog__row-button"
                      type="button"
                      @click="removeLocation(index)"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="!draft.assignments.length" class="locations-dialog__empty">
              还没有地点，先添加一行。
            </div>
          </div>

          <div class="locations-dialog__footer">
            <button class="btn-secondary locations-dialog__row-add" type="button" @click="addLocation">
              + 添加地点
            </button>
          </div>
        </div>

        <div class="locations-dialog__actions locations-dialog__actions--footer">
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

    <div v-if="promptEditorState.locationKey" class="locations-dialog__prompt-modal">
      <section class="locations-dialog__prompt-panel glass-panel">
        <div class="locations-dialog__prompt-head">
          <h3 class="locations-dialog__prompt-title">编辑提示词</h3>
          <button class="btn-secondary" type="button" @click="closePromptEditor">关闭</button>
        </div>

        <textarea
          v-model="promptEditorState.value"
          class="text-input locations-dialog__prompt-textarea"
          rows="10"
          placeholder="这里填写或修改当前地点的最终提示词"
        />

        <div class="locations-dialog__actions locations-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="closePromptEditor">取消</button>
          <button class="btn-primary" type="button" @click="savePromptEditor">保存提示词</button>
        </div>
      </section>
    </div>

    <div
      v-if="imagePreviewState.url"
      class="locations-dialog__image-modal"
      @click.self="closeImagePreview"
    >
      <section class="locations-dialog__image-panel glass-panel">
        <div class="locations-dialog__image-head">
          <div class="locations-dialog__image-copy">
            <h3 class="locations-dialog__image-title">{{ imagePreviewState.title }}</h3>
            <span class="locations-dialog__image-path">{{ imagePreviewState.path }}</span>
          </div>
          <button class="btn-secondary" type="button" @click="closeImagePreview">关闭</button>
        </div>

        <div class="locations-dialog__image-frame">
          <img
            class="locations-dialog__image-full"
            :src="imagePreviewState.url"
            :alt="imagePreviewState.title"
          />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.locations-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.locations-dialog__panel {
  width: min(1420px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: auto;
  border-radius: 22px;
}

.locations-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.locations-dialog__title,
.locations-dialog__config-title,
.locations-dialog__prompt-title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
  line-height: 1.1;
}

.locations-dialog__body {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.locations-dialog__config {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.locations-dialog__config-grid {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(220px, 260px) minmax(220px, 260px) minmax(0, 1fr);
  gap: 12px;
}

.locations-dialog__field {
  display: grid;
  gap: 6px;
}

.locations-dialog__field--wide {
  min-width: 0;
}

.locations-dialog__label,
.locations-dialog__count {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.locations-dialog__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.locations-dialog__batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.locations-dialog__select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.locations-dialog__warning {
  color: var(--warning);
  font-size: 0.82rem;
}

.locations-dialog__success {
  color: var(--accent);
  font-size: 0.84rem;
}

.locations-dialog__textarea {
  resize: vertical;
}

.locations-dialog__textarea--cell {
  min-height: 82px;
}

.locations-dialog__table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.locations-dialog__table {
  width: 100%;
  min-width: 1320px;
  border-collapse: collapse;
}

.locations-dialog__table th,
.locations-dialog__table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.locations-dialog__table th {
  position: sticky;
  top: 0;
  background: rgba(9, 19, 30, 0.92);
  font-size: 0.82rem;
  color: var(--text-muted);
}

.locations-dialog__select-col {
  width: 56px;
  text-align: center;
}

.locations-dialog__cell-input {
  min-width: 0;
}

.locations-dialog__prompt-link {
  padding: 0;
  color: var(--accent);
  background: transparent;
  border: 0;
  text-align: left;
  word-break: break-all;
  font-size: 0.8rem;
}

.locations-dialog__prompt-cell {
  display: grid;
  gap: 6px;
}

.locations-dialog__prompt-status,
.locations-dialog__prompt-error {
  font-size: 0.76rem;
  line-height: 1.3;
}

.locations-dialog__prompt-status {
  color: var(--text-muted);
}

.locations-dialog__prompt-error {
  color: var(--warning);
}

.locations-dialog__asset-cell,
.locations-dialog__action-stack {
  display: grid;
  gap: 6px;
}

.locations-dialog__asset-thumb-button {
  width: 88px;
  aspect-ratio: 1;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(186, 220, 255, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  cursor: zoom-in;
}

.locations-dialog__asset-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.locations-dialog__asset-link,
.locations-dialog__asset-empty,
.locations-dialog__asset-meta,
.locations-dialog__asset-status,
.locations-dialog__asset-error {
  min-width: 0;
  font-size: 0.78rem;
  line-height: 1.3;
}

.locations-dialog__asset-link {
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}

.locations-dialog__asset-empty,
.locations-dialog__asset-meta,
.locations-dialog__asset-status {
  color: var(--text-muted);
}

.locations-dialog__asset-error {
  color: var(--warning);
}

.locations-dialog__actions {
  display: flex;
  gap: 8px;
}

.locations-dialog__actions-col {
  width: 96px;
}

.locations-dialog__row-add,
.locations-dialog__row-button {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 0.8rem;
}

.locations-dialog__empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.locations-dialog__footer {
  display: flex;
  justify-content: flex-start;
}

.locations-dialog__actions--footer {
  margin-top: 16px;
  justify-content: flex-end;
}

.locations-dialog__prompt-modal {
  position: fixed;
  inset: 0;
  z-index: 61;
  display: grid;
  place-items: center;
  padding: 20px;
  pointer-events: none;
}

.locations-dialog__prompt-panel {
  width: min(880px, calc(100vw - 48px));
  padding: 18px;
  border-radius: 20px;
  pointer-events: auto;
}

.locations-dialog__prompt-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.locations-dialog__prompt-textarea {
  width: 100%;
  min-height: 240px;
  margin-top: 14px;
  resize: vertical;
}

.locations-dialog__image-modal {
  position: fixed;
  inset: 0;
  z-index: 62;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.82);
}

.locations-dialog__image-panel {
  width: min(1120px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  padding: 18px;
  overflow: auto;
  border-radius: 20px;
}

.locations-dialog__image-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.locations-dialog__image-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.locations-dialog__image-title {
  margin: 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.1rem;
  line-height: 1.2;
}

.locations-dialog__image-path {
  min-width: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.4;
  word-break: break-all;
}

.locations-dialog__image-frame {
  display: grid;
  place-items: center;
  margin-top: 14px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
}

.locations-dialog__image-full {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 220px);
  object-fit: contain;
}

@media (max-width: 900px) {
  .locations-dialog__header,
  .locations-dialog__actions,
  .locations-dialog__config-grid,
  .locations-dialog__prompt-head,
  .locations-dialog__image-head {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
