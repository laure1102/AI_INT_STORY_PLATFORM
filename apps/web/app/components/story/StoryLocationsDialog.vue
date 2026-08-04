<script setup lang="ts">
/** 地点配置弹窗：只负责表单布局，业务状态集中在 useStoryLocationsEditor。 */
import { toRefs } from "vue"
import {
  useStoryLocationsEditor,
  type LocationImageVariant,
  type StoryLocationsEditorEmits,
  type StoryLocationsEditorProps
} from "./useStoryLocationsEditor"

const props = defineProps<StoryLocationsEditorProps>()
const emit = defineEmits<StoryLocationsEditorEmits>()
const editor = useStoryLocationsEditor(props, emit)
const {
  allSelected, assetStates, batchState, canBatchCompressImages1,
  canBatchCompressImages2, canBatchGenerateImages, canBatchGeneratePrompts,
  draft, duplicateIds, hasInvalidDraft, imagePreviewState, locationCount,
  promptEditorState, selectedCount
} = toRefs(editor)
const {
  addLocation, closeImagePreview, closePromptEditor, formatAssetMeta,
  getAssetPath, getAssetState, getAssetUrl, getImagePreviewTitle, getImageVariantLabel,
  getPromptPreview,
  getPromptState, handleBatchCompressImages, handleBatchGenerateImages,
  handleBatchGeneratePrompts, handleCompressImage, handleGenerateImage,
  handleGeneratePrompt, openImagePreview, openPromptEditor, parseImageDimensionInput, removeLocation,
  savePromptEditor, submitDraft
} = editor
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
              <h3 class="locations-dialog__config-title">地点 AI 工具配置</h3>
            </div>

            <div class="locations-dialog__config-grid">
              <label class="locations-dialog__field">
                <span class="locations-dialog__label">图片宽度</span>
                <input
                  v-model="draft.ai.imageWidthText"
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
                  v-model="draft.ai.imageHeightText"
                  class="text-input"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="1024"
                />
              </label>

              <label class="locations-dialog__field">
                <span class="locations-dialog__label">压缩质量1</span>
                <input
                  v-model="draft.ai.compressQuality1Text"
                  class="text-input"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="60"
                />
              </label>

              <label class="locations-dialog__field">
                <span class="locations-dialog__label">压缩质量2</span>
                <input
                  v-model="draft.ai.compressQuality2Text"
                  class="text-input"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="80"
                />
              </label>

              <label class="locations-dialog__field locations-dialog__field--wide">
                <span class="locations-dialog__label">整体提示词</span>
                <textarea
                  v-model="draft.ai.globalPrompt"
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
                    : "批量生成原图"
                }}
              </button>

              <button
                class="btn-secondary locations-dialog__row-button"
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
                class="btn-secondary locations-dialog__row-button"
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

          <div v-if="duplicateIds.size" class="locations-dialog__warning">
            地点 ID 不能重复，请检查 `id`。
          </div>

          <div class="locations-dialog__table-wrap">
            <table class="locations-dialog__table">
              <thead>
                <tr>
                  <th class="locations-dialog__select-col">选择</th>
                  <th>ID</th>
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
                      v-model="assignment.id"
                      class="text-input locations-dialog__cell-input"
                      type="text"
                      placeholder="office_small"
                    />
                  </td>
                  <td>
                    <textarea
                      v-model="assignment.descr"
                      class="text-input locations-dialog__textarea locations-dialog__textarea--cell"
                      rows="3"
                      placeholder="现代办公室，落地窗，夜景，简洁商务风"
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
                    <div class="locations-dialog__asset-grid">
                      <div
                        v-for="variant in ['raw', 'compress1', 'compress2'] as LocationImageVariant[]"
                        :key="variant"
                        class="locations-dialog__asset-card"
                      >
                        <span class="locations-dialog__asset-title">
                          {{ getImageVariantLabel(variant) }}
                        </span>
                        <button
                          v-if="variant === 'raw' && getAssetPath(assignment, variant)"
                          class="locations-dialog__asset-thumb-button"
                          type="button"
                          @click="openImagePreview(getImagePreviewTitle(assignment.id, variant), getAssetPath(assignment, variant))"
                        >
                          <img
                            class="locations-dialog__asset-thumb"
                            :src="getAssetUrl(assignment, variant)"
                            :alt="`${assignment.id || '地点'} ${getImageVariantLabel(variant)} 缩略图`"
                            loading="lazy"
                          />
                        </button>
                        <a
                          v-if="getAssetPath(assignment, variant)"
                          class="locations-dialog__asset-link"
                          :href="getAssetUrl(assignment, variant)"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {{ getAssetPath(assignment, variant) }}
                        </a>
                        <span v-else class="locations-dialog__asset-empty">暂无图片</span>
                        <span
                          v-if="formatAssetMeta(getAssetState(assignment, variant).meta)"
                          class="locations-dialog__asset-meta"
                        >
                          {{ formatAssetMeta(getAssetState(assignment, variant).meta) }}
                        </span>
                        <span
                          v-if="getAssetState(assignment, variant).loading"
                          class="locations-dialog__asset-status"
                        >
                          处理中...
                        </span>
                        <span
                          v-if="getAssetState(assignment, variant).error"
                          class="locations-dialog__asset-error"
                        >
                          {{ getAssetState(assignment, variant).error }}
                        </span>
                      </div>
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
                        :disabled="getAssetState(assignment, 'raw').loading || !assignment.prompt.trim() || parseImageDimensionInput(draft.ai.imageWidthText) === null || parseImageDimensionInput(draft.ai.imageHeightText) === null"
                        @click="handleGenerateImage(assignment)"
                      >
                        生成原图
                      </button>
                      <button
                        class="btn-secondary locations-dialog__row-button"
                        type="button"
                        :disabled="getAssetState(assignment, 'compress1').loading || !assignment.img_raw.trim()"
                        @click="handleCompressImage(assignment, 1)"
                      >
                        压缩到1
                      </button>
                      <button
                        class="btn-secondary locations-dialog__row-button"
                        type="button"
                        :disabled="getAssetState(assignment, 'compress2').loading || !assignment.img_raw.trim()"
                        @click="handleCompressImage(assignment, 2)"
                      >
                        压缩到2
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

<style scoped src="./styles/StoryLocationsDialog.css"></style>
