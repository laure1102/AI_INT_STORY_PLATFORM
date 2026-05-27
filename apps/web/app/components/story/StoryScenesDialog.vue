<script setup lang="ts">
import type {
  StorySceneBackgroundVariant,
  StorySceneDefinition,
  StorySceneFile
} from "@story-mgr/core"
import type { StoryAssetMetadata } from "@story-mgr/shared"

interface StorySceneDraft {
  draftKey: string
  levelText: string
  description: string
  music: string
  dayImg: string
  nightImg: string
}

interface SceneAssetState {
  error: string | null
  loading: boolean
  meta: StoryAssetMetadata | null
}

const props = defineProps<{
  storyId: string
  saving: boolean
  scenes: StorySceneFile
}>()

const emit = defineEmits<{
  close: []
  save: [scenes: StorySceneFile]
}>()

const { compressSceneAsset, getStoryAssetMeta, getStoryAssetUrl, uploadStoryAsset } = useStoryApi()

const draft = reactive<{
  compressQualityText: string
  scenes: StorySceneDraft[]
}>({
  compressQualityText: "60",
  scenes: []
})

const assetStates = reactive<Record<string, SceneAssetState>>({})

let draftKeySeed = 0

function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function formatLevelInput(level: unknown) {
  return typeof level === "number" && Number.isFinite(level) ? String(level) : ""
}

function parseLevelInput(levelText: string) {
  const trimmed = levelText.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

function parseCompressQualityInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null
}

function createEmptyAssetState(): SceneAssetState {
  return {
    error: null,
    loading: false,
    meta: null
  }
}

function getAssetStateKey(draftKey: string, variant: StorySceneBackgroundVariant) {
  return `${draftKey}:${variant}`
}

function initializeSceneAssetStates(scene: StorySceneDraft) {
  assetStates[getAssetStateKey(scene.draftKey, "day")] = createEmptyAssetState()
  assetStates[getAssetStateKey(scene.draftKey, "night")] = createEmptyAssetState()
}

function resetAssetStates() {
  for (const key of Object.keys(assetStates)) {
    delete assetStates[key]
  }
}

function getAssetState(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  return assetStates[getAssetStateKey(scene.draftKey, variant)]
}

function getSceneAssetPath(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  return variant === "day" ? scene.dayImg : scene.nightImg
}

function setSceneAssetPath(
  scene: StorySceneDraft,
  variant: StorySceneBackgroundVariant,
  assetPath: string
) {
  if (variant === "day") {
    scene.dayImg = assetPath
    return
  }

  scene.nightImg = assetPath
}

function clearSceneAssetState(scene: StorySceneDraft) {
  delete assetStates[getAssetStateKey(scene.draftKey, "day")]
  delete assetStates[getAssetStateKey(scene.draftKey, "night")]
}

function cloneScene(scene: StorySceneDefinition): StorySceneDraft {
  const draftScene = {
    draftKey: createDraftKey("scene"),
    levelText: formatLevelInput(scene.level),
    description: normalizeText(scene.description),
    music: normalizeText(scene.music),
    dayImg: normalizeText(scene.day_img),
    nightImg: normalizeText(scene.night_img)
  }

  initializeSceneAssetStates(draftScene)
  return draftScene
}

function getNextSceneLevel() {
  const levels = draft.scenes
    .map((scene) => parseLevelInput(scene.levelText))
    .filter((level): level is number => level !== null)

  return levels.length > 0 ? Math.max(...levels) + 1 : 1
}

function createEmptyScene(): StorySceneDraft {
  const draftScene = {
    draftKey: createDraftKey("scene"),
    levelText: String(getNextSceneLevel()),
    description: "",
    music: "",
    dayImg: "",
    nightImg: ""
  }

  initializeSceneAssetStates(draftScene)
  return draftScene
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

function getAssetUrl(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  const assetPath = getSceneAssetPath(scene, variant).trim()
  return assetPath ? getStoryAssetUrl(props.storyId, assetPath) : ""
}

async function loadAssetMeta(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  const state = getAssetState(scene, variant)
  const assetPath = getSceneAssetPath(scene, variant).trim()

  state.error = null

  if (!assetPath) {
    state.loading = false
    state.meta = null
    return
  }

  state.loading = true

  try {
    const asset = await getStoryAssetMeta(props.storyId, assetPath)

    if (getSceneAssetPath(scene, variant).trim() === assetPath) {
      state.meta = asset
      state.error = null
    }
  } catch (error) {
    if (getSceneAssetPath(scene, variant).trim() === assetPath) {
      state.meta = null
      state.error = formatErrorMessage(error, "读取图片信息失败。")
    }
  } finally {
    if (getSceneAssetPath(scene, variant).trim() === assetPath) {
      state.loading = false
    }
  }
}

async function hydrateAssetMeta() {
  const tasks = draft.scenes.flatMap((scene) => [
    loadAssetMeta(scene, "day"),
    loadAssetMeta(scene, "night")
  ])

  await Promise.allSettled(tasks)
}

function syncDraft(scenes: StorySceneFile) {
  resetAssetStates()
  draft.compressQualityText = String(scenes.ai.compress_quality ?? 60)
  draft.scenes = scenes.scenes.map(cloneScene)
  void hydrateAssetMeta()
}

const sceneCount = computed(() => draft.scenes.length)
const hasInvalidDraft = computed(() => {
  return parseCompressQualityInput(draft.compressQualityText) === null
    || draft.scenes.some((scene) => parseLevelInput(scene.levelText) === null)
})

function addScene() {
  draft.scenes.push(createEmptyScene())
}

function removeScene(index: number) {
  const removedScene = draft.scenes[index]
  if (!removedScene) return
  clearSceneAssetState(removedScene)
  draft.scenes.splice(index, 1)
}

async function handleAssetSelected(
  scene: StorySceneDraft,
  variant: StorySceneBackgroundVariant,
  event: Event
) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]

  if (input) {
    input.value = ""
  }

  if (!file) return

  const state = getAssetState(scene, variant)
  state.error = null
  state.loading = true

  try {
    const asset = await uploadStoryAsset(props.storyId, file)
    setSceneAssetPath(scene, variant, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, "上传图片失败。")
  } finally {
    state.loading = false
  }
}

function canCompress(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  return parseLevelInput(scene.levelText) !== null
    && getSceneAssetPath(scene, variant).trim().length > 0
}

async function handleCompress(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  const level = parseLevelInput(scene.levelText)
  const sourcePath = getSceneAssetPath(scene, variant).trim()
  const state = getAssetState(scene, variant)

  if (level === null || !sourcePath) {
    state.error = "请先填写有效级别并选择图片。"
    return
  }

  state.error = null
  state.loading = true

  try {
    const asset = await compressSceneAsset(props.storyId, {
      level,
      quality: parseCompressQualityInput(draft.compressQualityText) ?? 60,
      sourcePath,
      variant
    })

    setSceneAssetPath(scene, variant, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, "压缩图片失败。")
  } finally {
    state.loading = false
  }
}

function submitDraft() {
  emit("save", {
    ai: {
      compress_quality: parseCompressQualityInput(draft.compressQualityText) ?? 60
    },
    scenes: draft.scenes.map((scene) => ({
      level: parseLevelInput(scene.levelText) ?? 1,
      description: normalizeText(scene.description).trim(),
      music: normalizeText(scene.music).trim(),
      day_img: normalizeText(scene.dayImg).trim(),
      night_img: normalizeText(scene.nightImg).trim()
    }))
  })
}

watch(
  () => props.scenes,
  (scenes) => {
    syncDraft(scenes)
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <div class="scenes-dialog">
      <section class="scenes-dialog__panel glass-panel">
        <div class="scenes-dialog__header">
          <div>
            <span class="eyebrow">场景</span>
            <h2 class="scenes-dialog__title">场景设置</h2>
          </div>

          <div class="scenes-dialog__actions">
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

        <p class="scenes-dialog__hint">
          白天图和夜晚图会先保存原图，再按需压缩为故事目录下的 WebP 背景资源。
        </p>
        <p v-if="hasInvalidDraft" class="scenes-dialog__warning">
          场景级别必须大于等于 1，压缩质量必须在 1 到 100 之间。
        </p>

        <div class="scenes-dialog__body">
          <section class="scenes-dialog__config">
            <label class="scenes-dialog__field">
              <span class="scenes-dialog__label">压缩质量</span>
              <input
                v-model="draft.compressQualityText"
                class="text-input scenes-dialog__cell-input scenes-dialog__cell-input--level"
                type="number"
                min="1"
                max="100"
                step="1"
                placeholder="60"
              />
            </label>
          </section>

          <div class="scenes-dialog__count">当前场景数：{{ sceneCount }}</div>

          <div class="scenes-dialog__table-wrap">
            <table class="scenes-dialog__table">
              <thead>
                <tr>
                  <th>级别</th>
                  <th>描述</th>
                  <th>音乐</th>
                  <th>白天图片</th>
                  <th>晚上图片</th>
                  <th>压缩</th>
                  <th class="scenes-dialog__actions-col">操作</th>
                </tr>
              </thead>
              <tbody v-if="draft.scenes.length">
                <tr v-for="(scene, index) in draft.scenes" :key="scene.draftKey">
                  <td>
                    <input
                      v-model="scene.levelText"
                      class="text-input scenes-dialog__cell-input scenes-dialog__cell-input--level"
                      type="number"
                      min="1"
                      step="1"
                    />
                  </td>
                  <td>
                    <input
                      v-model="scene.description"
                      class="text-input scenes-dialog__cell-input"
                      type="text"
                      placeholder="场景描述"
                    />
                  </td>
                  <td>
                    <input
                      v-model="scene.music"
                      class="text-input scenes-dialog__cell-input"
                      type="text"
                      placeholder="abc.mp3"
                    />
                  </td>
                  <td>
                    <div class="scenes-dialog__asset-cell">
                      <label class="btn-secondary scenes-dialog__asset-button">
                        选择图片
                        <input
                          class="scenes-dialog__file-input"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          @change="handleAssetSelected(scene, 'day', $event)"
                        />
                      </label>
                      <a
                        v-if="scene.dayImg"
                        class="scenes-dialog__asset-link"
                        :href="getAssetUrl(scene, 'day')"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {{ scene.dayImg }}
                      </a>
                      <span v-else class="scenes-dialog__asset-empty">未选择图片</span>
                      <span
                        v-if="formatAssetMeta(getAssetState(scene, 'day').meta)"
                        class="scenes-dialog__asset-meta"
                      >
                        {{ formatAssetMeta(getAssetState(scene, "day").meta) }}
                      </span>
                      <span v-if="getAssetState(scene, 'day').loading" class="scenes-dialog__asset-status">
                        处理中...
                      </span>
                      <span v-if="getAssetState(scene, 'day').error" class="scenes-dialog__asset-error">
                        {{ getAssetState(scene, "day").error }}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="scenes-dialog__asset-cell">
                      <label class="btn-secondary scenes-dialog__asset-button">
                        选择图片
                        <input
                          class="scenes-dialog__file-input"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          @change="handleAssetSelected(scene, 'night', $event)"
                        />
                      </label>
                      <a
                        v-if="scene.nightImg"
                        class="scenes-dialog__asset-link"
                        :href="getAssetUrl(scene, 'night')"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {{ scene.nightImg }}
                      </a>
                      <span v-else class="scenes-dialog__asset-empty">未选择图片</span>
                      <span
                        v-if="formatAssetMeta(getAssetState(scene, 'night').meta)"
                        class="scenes-dialog__asset-meta"
                      >
                        {{ formatAssetMeta(getAssetState(scene, "night").meta) }}
                      </span>
                      <span v-if="getAssetState(scene, 'night').loading" class="scenes-dialog__asset-status">
                        处理中...
                      </span>
                      <span v-if="getAssetState(scene, 'night').error" class="scenes-dialog__asset-error">
                        {{ getAssetState(scene, "night").error }}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="scenes-dialog__compress-actions">
                      <button
                        class="btn-secondary scenes-dialog__row-button"
                        type="button"
                        :disabled="getAssetState(scene, 'day').loading || !canCompress(scene, 'day')"
                        @click="handleCompress(scene, 'day')"
                      >
                        压缩白天
                      </button>
                      <button
                        class="btn-secondary scenes-dialog__row-button"
                        type="button"
                        :disabled="getAssetState(scene, 'night').loading || !canCompress(scene, 'night')"
                        @click="handleCompress(scene, 'night')"
                      >
                        压缩晚上
                      </button>
                    </div>
                  </td>
                  <td class="scenes-dialog__actions-col">
                    <button
                      class="btn-secondary scenes-dialog__row-button"
                      type="button"
                      @click="removeScene(index)"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="!draft.scenes.length" class="scenes-dialog__empty">
              还没有场景，先添加一行。
            </div>
          </div>

          <div class="scenes-dialog__footer">
            <button class="btn-secondary scenes-dialog__row-add" type="button" @click="addScene">
              + 添加场景
            </button>
          </div>
        </div>

        <div class="scenes-dialog__actions scenes-dialog__actions--footer">
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
  </Teleport>
</template>

<style scoped>
.scenes-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
  backdrop-filter: blur(10px);
}

.scenes-dialog__panel {
  width: min(1360px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: auto;
  border-radius: 22px;
}

.scenes-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.scenes-dialog__title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
  line-height: 1.1;
}

.scenes-dialog__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.scenes-dialog__hint,
.scenes-dialog__warning {
  margin: 10px 0 0;
  font-size: 0.86rem;
  color: var(--text-muted);
}

.scenes-dialog__warning {
  color: var(--warning);
}

.scenes-dialog__body {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.scenes-dialog__config {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.scenes-dialog__field {
  display: grid;
  gap: 6px;
}

.scenes-dialog__label,
.scenes-dialog__count {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.scenes-dialog__table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.scenes-dialog__table {
  width: 100%;
  min-width: 1220px;
  border-collapse: collapse;
}

.scenes-dialog__table th,
.scenes-dialog__table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.scenes-dialog__table th {
  position: sticky;
  top: 0;
  background: rgba(9, 19, 30, 0.92);
  font-size: 0.82rem;
  color: var(--text-muted);
}

.scenes-dialog__cell-input {
  min-width: 0;
  padding: 8px 10px;
}

.scenes-dialog__cell-input--level {
  width: 96px;
}

.scenes-dialog__asset-cell {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.scenes-dialog__asset-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 0.8rem;
  cursor: pointer;
}

.scenes-dialog__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.scenes-dialog__asset-link,
.scenes-dialog__asset-empty,
.scenes-dialog__asset-meta,
.scenes-dialog__asset-status,
.scenes-dialog__asset-error {
  min-width: 0;
  font-size: 0.78rem;
  line-height: 1.3;
}

.scenes-dialog__asset-link {
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}

.scenes-dialog__asset-empty,
.scenes-dialog__asset-meta,
.scenes-dialog__asset-status {
  color: var(--text-muted);
}

.scenes-dialog__asset-error {
  color: var(--warning);
}

.scenes-dialog__compress-actions {
  display: grid;
  gap: 6px;
}

.scenes-dialog__actions-col {
  width: 96px;
}

.scenes-dialog__row-add,
.scenes-dialog__row-button {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 0.8rem;
}

.scenes-dialog__empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.scenes-dialog__footer {
  display: flex;
  justify-content: flex-start;
}

.scenes-dialog__actions--footer {
  margin-top: 16px;
  justify-content: flex-end;
}

@media (max-width: 900px) {
  .scenes-dialog__header,
  .scenes-dialog__actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
