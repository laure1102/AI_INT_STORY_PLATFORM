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
  saveSuccessMessage?: string | null
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

/** 创建一份新的 `DraftKey` 数据。 @param prefix 调用方传入的 `prefix`。 @returns 计算、查找或构建后的结果。 */
function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

/** 将 `Text` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

/** 把 `LevelInput` 转换成界面可读文本。 @param level 调用方传入的 `level`。 @returns 计算、查找或构建后的结果。 */
function formatLevelInput(level: unknown) {
  return typeof level === "number" && Number.isFinite(level) ? String(level) : ""
}

/** 解析 `LevelInput` 输入，并为非法值提供安全结果。 @param levelText 调用方传入的 `levelText`。 @returns 计算、查找或构建后的结果。 */
function parseLevelInput(levelText: string) {
  const trimmed = levelText.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

/** 解析 `CompressQualityInput` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function parseCompressQualityInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null
}

/** 创建一份新的 `EmptyAssetState` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyAssetState(): SceneAssetState {
  return {
    error: null,
    loading: false,
    meta: null
  }
}

/** 读取或计算 `AssetStateKey`。 @param draftKey 调用方传入的 `draftKey`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetStateKey(draftKey: string, variant: StorySceneBackgroundVariant) {
  return `${draftKey}:${variant}`
}

/** 执行 `initializeSceneAssetStates` 对应的局部业务逻辑。 @param scene 调用方传入的 `scene`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function initializeSceneAssetStates(scene: StorySceneDraft) {
  assetStates[getAssetStateKey(scene.draftKey, "day")] = createEmptyAssetState()
  assetStates[getAssetStateKey(scene.draftKey, "night")] = createEmptyAssetState()
}

/** 重置或清理 `resetAssetStates` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function resetAssetStates() {
  for (const key of Object.keys(assetStates)) {
    delete assetStates[key]
  }
}

/** 读取或计算 `AssetState`。 @param scene 调用方传入的 `scene`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetState(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  return assetStates[getAssetStateKey(scene.draftKey, variant)]
}

/** 读取或计算 `SceneAssetPath`。 @param scene 调用方传入的 `scene`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getSceneAssetPath(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  return variant === "day" ? scene.dayImg : scene.nightImg
}

/** 更新 `SceneAssetPath` 对应的响应式值。 @param scene 调用方传入的 `scene`。 @param variant 调用方传入的 `variant`。 @param assetPath 调用方传入的 `assetPath`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 重置或清理 `clearSceneAssetState` 对应的临时状态。 @param scene 调用方传入的 `scene`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function clearSceneAssetState(scene: StorySceneDraft) {
  delete assetStates[getAssetStateKey(scene.draftKey, "day")]
  delete assetStates[getAssetStateKey(scene.draftKey, "night")]
}

/** 复制 `Scene`，避免共享可变引用。 @param scene 调用方传入的 `scene`。 @returns 计算、查找或构建后的结果。 */
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

/** 读取或计算 `NextSceneLevel`。 @returns 计算、查找或构建后的结果。 */
function getNextSceneLevel() {
  const levels = draft.scenes
    .map((scene) => parseLevelInput(scene.levelText))
    .filter((level): level is number => level !== null)

  return levels.length > 0 ? Math.max(...levels) + 1 : 1
}

/** 创建一份新的 `EmptyScene` 数据。 @returns 计算、查找或构建后的结果。 */
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

/** 读取或计算 `AssetUrl`。 @param scene 调用方传入的 `scene`。 @param variant 调用方传入的 `variant`。 @returns 计算、查找或构建后的结果。 */
function getAssetUrl(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  const assetPath = getSceneAssetPath(scene, variant).trim()
  return assetPath ? getStoryAssetUrl(props.storyId, assetPath) : ""
}

/** 异步加载 `AssetMeta` 数据并更新响应式状态。 @param scene 调用方传入的 `scene`。 @param variant 调用方传入的 `variant`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
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

/** 执行 `hydrateAssetMeta` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
async function hydrateAssetMeta() {
  const tasks = draft.scenes.flatMap((scene) => [
    loadAssetMeta(scene, "day"),
    loadAssetMeta(scene, "night")
  ])

  await Promise.allSettled(tasks)
}

/** 把外部或服务端数据同步到本地响应式状态。 @param scenes 调用方传入的 `scenes`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 新增一项 `Scene` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addScene() {
  draft.scenes.push(createEmptyScene())
}

/** 移除指定的 `Scene` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeScene(index: number) {
  const removedScene = draft.scenes[index]
  if (!removedScene) return
  clearSceneAssetState(removedScene)
  draft.scenes.splice(index, 1)
}

/** 处理 `AssetSelected` 用户交互。 @param scene 调用方传入的 `scene`。 @param variant 调用方传入的 `variant`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 判断 `canCompress` 对应的条件是否成立。 @param scene 调用方传入的 `scene`。 @param variant 调用方传入的 `variant`。 @returns 布尔判断结果。 */
function canCompress(scene: StorySceneDraft, variant: StorySceneBackgroundVariant) {
  return parseLevelInput(scene.levelText) !== null
    && getSceneAssetPath(scene, variant).trim().length > 0
}

/** 处理 `Compress` 用户交互。 @param scene 调用方传入的 `scene`。 @param variant 调用方传入的 `variant`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

        <p v-if="props.saveSuccessMessage" class="scenes-dialog__success">
          {{ props.saveSuccessMessage }}
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

<style scoped src="./styles/StoryScenesDialog.css"></style>
