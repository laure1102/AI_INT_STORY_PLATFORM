<script setup lang="ts">
/** 物品配置弹窗：只负责表单布局，状态和图片流程由 composable 提供。 */
import { toRefs } from "vue"
import { parsePositiveIntegerInput } from "./storyAssetEditor"
import {
  useStoryItemsEditor,
  type ItemImageVariant,
  type StoryItemsEditorEmits,
  type StoryItemsEditorProps
} from "./useStoryItemsEditor"

const props = defineProps<StoryItemsEditorProps>()
const emit = defineEmits<StoryItemsEditorEmits>()
const editor = useStoryItemsEditor(props, emit)
const {
  allSelected, batchState, canBatchCompressImages1, canBatchCompressImages2,
  canBatchGenerateImages, canBatchGeneratePrompts, draft, duplicateCategoryIds,
  duplicateItemIds, hasInvalidDraft, imagePreviewState, invalidCategoryReferenceCount,
  isCategoryDialogOpen, promptEditorState, selectedCount, sortedCategoryOptions
} = toRefs(editor)
const {
  addCategory, addItem, closeCategoryDialog, closeImagePreview, closePromptEditor,
  formatAssetMeta, getAssetPath, getAssetState, getAssetUrl, getCategoryUsageCount,
  getImagePreviewTitle, getImageVariantLabel, getPromptPreview, getPromptState,
  handleBatchCompressImages, handleBatchGenerateImages, handleBatchGeneratePrompts,
  handleCompressImage, handleGenerateImage, handleGeneratePrompt, openCategoryDialog,
  openImagePreview, openPromptEditor, removeCategory, removeItem, savePromptEditor,
  submitDraft
} = editor
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

<style scoped src="./styles/StoryItemsDialog.css"></style>
