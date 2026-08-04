<script setup lang="ts">
/** 角色管理弹窗门面：保留原有 props/emits，只把界面动作交给独立控制器。 */
import {
  useStoryRolesEditor,
  type StoryRolesEditorEmits,
  type StoryRolesEditorProps
} from "./useStoryRolesEditor"

const props = defineProps<StoryRolesEditorProps>()
const emit = defineEmits<StoryRolesEditorEmits>()
const controller = useStoryRolesEditor(props, emit)
const {
  imageVariants, contactTrackOptions, activeTab, draft,
  promptEditorState, imagePreviewState, batchState, personalityOptions,
  parseImageDimensionInput, getPromptState, getAssetState, formatAssetMeta,
  getPromptPreview, getImageVariantLabel, getImagePreviewTitle, getNormalAssetPath,
  getNormalAssetUrl, getImportantAssetPath, getImportantAssetUrl, openImagePreview,
  closeImagePreview, getRoleDisplayName, addNormalRole, addImportantRole,
  removeNormalRole, removeImportantRole, openPromptEditor, closePromptEditor,
  savePromptEditor, normalRoleCount, importantRoleCount, activeRoleCount,
  activeSelectedCount, allSelected, hasInvalidDraft, canBatchGeneratePrompts,
  canBatchGenerateImages, canBatchGenerateMaleImages, canBatchGenerateFemaleImages, canBatchCompressImages1,
  canBatchCompressImages2, handleGenerateNormalPrompt, handleGenerateImportantPrompt, handleGenerateNormalImage,
  handleCompressNormalImage, handleGenerateImportantImage, handleCompressImportantImage, handleBatchGeneratePrompts,
  handleBatchGenerateImages, handleBatchCompressImages, submitDraft
} = controller
</script>

<template>
  <Teleport to="body">
    <div class="roles-dialog">
      <section class="roles-dialog__panel glass-panel">
        <div class="roles-dialog__header">
          <div>
            <span class="eyebrow">角色</span>
            <h2 class="roles-dialog__title">角色设置</h2>
          </div>

          <div class="roles-dialog__actions">
            <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
            <button class="btn-primary" type="button" :disabled="saving || hasInvalidDraft" @click="submitDraft">
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>

        <div class="roles-dialog__body">
          <div v-if="props.saveSuccessMessage" class="roles-dialog__success">
            {{ props.saveSuccessMessage }}
          </div>

          <div class="roles-dialog__tabs">
            <button
              class="roles-dialog__tab"
              :class="{ 'roles-dialog__tab--active': activeTab === 'normal' }"
              type="button"
              @click="activeTab = 'normal'"
            >
              普通角色（{{ normalRoleCount }}）
            </button>
            <button
              class="roles-dialog__tab"
              :class="{ 'roles-dialog__tab--active': activeTab === 'important' }"
              type="button"
              @click="activeTab = 'important'"
            >
              重要角色（{{ importantRoleCount }}）
            </button>
          </div>

          <div class="roles-dialog__toolbar">
            <div class="roles-dialog__count">
              当前{{ activeTab === "normal" ? "普通角色" : "重要角色" }}数量：{{ activeRoleCount }}，已选择：{{ activeSelectedCount }}
            </div>

            <div class="roles-dialog__batch-actions">
              <label class="roles-dialog__select-all">
                <input v-model="allSelected" type="checkbox" />
                <span>全选</span>
              </label>

              <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="!canBatchGeneratePrompts" @click="handleBatchGeneratePrompts">
                {{
                  batchState.generatingPrompts
                    ? `批量生成中 ${batchState.promptDone}/${batchState.promptTotal}`
                    : "批量生成提示词"
                }}
              </button>

              <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="!canBatchGenerateImages" @click="handleBatchGenerateImages('common')">
                {{
                  batchState.generatingCommonImages
                    ? `批量生图中 ${batchState.commonImageDone}/${batchState.commonImageTotal}`
                    : "批量生成通用原图"
                }}
              </button>

              <button
                v-if="activeTab === 'important'"
                class="btn-secondary roles-dialog__row-button"
                type="button"
                :disabled="!canBatchGenerateMaleImages"
                @click="handleBatchGenerateImages('male')"
              >
                {{
                  batchState.generatingMaleImages
                    ? `男图生成中 ${batchState.maleImageDone}/${batchState.maleImageTotal}`
                    : "批量生成男原图"
                }}
              </button>

              <button
                v-if="activeTab === 'important'"
                class="btn-secondary roles-dialog__row-button"
                type="button"
                :disabled="!canBatchGenerateFemaleImages"
                @click="handleBatchGenerateImages('female')"
              >
                {{
                  batchState.generatingFemaleImages
                    ? `女图生成中 ${batchState.femaleImageDone}/${batchState.femaleImageTotal}`
                    : "批量生成女原图"
                }}
              </button>

              <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="!canBatchCompressImages1" @click="handleBatchCompressImages(1)">
                {{
                  batchState.compressing1
                    ? `批量压缩1中 ${batchState.compress1Done}/${batchState.compress1Total}`
                    : "批量压缩到1"
                }}
              </button>

              <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="!canBatchCompressImages2" @click="handleBatchCompressImages(2)">
                {{
                  batchState.compressing2
                    ? `批量压缩2中 ${batchState.compress2Done}/${batchState.compress2Total}`
                    : "批量压缩到2"
                }}
              </button>
            </div>
          </div>

          <div v-if="activeTab === 'normal'" class="roles-dialog__section">
            <section class="roles-dialog__config">
              <div class="roles-dialog__config-head">
                <h3 class="roles-dialog__config-title">普通角色 AI 工具配置</h3>
              </div>

              <div class="roles-dialog__config-grid">
                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">图片宽度</span>
                  <input v-model="draft.normalAi.imageWidthText" class="text-input" type="number" min="1" step="1" placeholder="1536" />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">图片高度</span>
                  <input v-model="draft.normalAi.imageHeightText" class="text-input" type="number" min="1" step="1" placeholder="1024" />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">压缩质量1</span>
                  <input
                    v-model="draft.normalAi.compressQuality1Text"
                    class="text-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    placeholder="60"
                  />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">压缩质量2</span>
                  <input
                    v-model="draft.normalAi.compressQuality2Text"
                    class="text-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    placeholder="30"
                  />
                </label>

                <label class="roles-dialog__field roles-dialog__field--wide">
                  <span class="roles-dialog__label">整体提示词</span>
                  <textarea
                    v-model="draft.normalAi.globalPrompt"
                    class="text-input roles-dialog__textarea"
                    rows="3"
                    placeholder="统一风格、时代背景、镜头语言、材质倾向等"
                  />
                </label>
              </div>
            </section>

            <div class="roles-dialog__table-wrap">
              <table class="roles-dialog__table">
                <thead>
                  <tr>
                    <th class="roles-dialog__select-col">选择</th>
                    <th>ID</th>
                    <th>名字</th>
                    <th>职业</th>
                    <th>联系人/性格</th>
                    <th>描述</th>
                    <th>提示词</th>
                    <th>图片</th>
                    <th>AI 操作</th>
                    <th class="roles-dialog__actions-col">操作</th>
                  </tr>
                </thead>
                <tbody v-if="draft.normalRoles.length">
                  <tr v-for="(role, index) in draft.normalRoles" :key="role.draftKey">
                    <td class="roles-dialog__select-col">
                      <input v-model="role.selected" type="checkbox" />
                    </td>
                    <td>
                      <input v-model="role.id" class="text-input roles-dialog__cell-input" type="text" placeholder="villager_old_man" />
                    </td>
                    <td>
                      <input v-model="role.name" class="text-input roles-dialog__cell-input" type="text" placeholder="老孙" />
                    </td>
                    <td>
                      <input v-model="role.zhiye" class="text-input roles-dialog__cell-input" type="text" placeholder="算命先生" />
                    </td>
                    <td>
                      <div class="roles-dialog__meta-stack">
                        <label class="roles-dialog__inline-check">
                          <input v-model="role.contact_enabled" type="checkbox" />
                          <span>加入联系人</span>
                        </label>
                        <select v-model="role.contact_track" class="text-input roles-dialog__select">
                          <option v-for="option in contactTrackOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>
                        <input
                          v-model.number="role.contact_initial_favor"
                          class="text-input roles-dialog__cell-input"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          placeholder="20"
                        />
                        <select v-model="role.xingge_id" class="text-input roles-dialog__select">
                          <option value="">未指定性格</option>
                          <option v-for="option in personalityOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>
                        <textarea
                          v-model="role.xingge_note"
                          class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                          rows="2"
                          placeholder="补充说话方式或气质说明"
                        />
                      </div>
                    </td>
                    <td>
                      <textarea
                        v-model="role.descr"
                        class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                        rows="3"
                        placeholder="普通路人，朴素布衣，生活气息"
                      />
                    </td>
                    <td>
                      <div class="roles-dialog__prompt-cell">
                        <button class="roles-dialog__prompt-link" type="button" @click="openPromptEditor(role.draftKey, role.prompt)">
                          {{ getPromptPreview(role.prompt) }}
                        </button>
                        <span v-if="getPromptState(role.draftKey).loading" class="roles-dialog__prompt-status">生成中...</span>
                        <span v-if="getPromptState(role.draftKey).error" class="roles-dialog__prompt-error">
                          {{ getPromptState(role.draftKey).error }}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div class="roles-dialog__asset-grid">
                        <div v-for="variant in imageVariants" :key="variant" class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">{{ getImageVariantLabel(variant) }}</span>
                          <button
                            v-if="variant === 'raw' && getNormalAssetPath(role, variant)"
                            class="roles-dialog__asset-thumb-button"
                            type="button"
                            @click="openImagePreview(getImagePreviewTitle(role.id, variant), getNormalAssetPath(role, variant))"
                          >
                            <img
                              class="roles-dialog__asset-thumb"
                              :src="getNormalAssetUrl(role, variant)"
                              :alt="`${getRoleDisplayName(role)} ${getImageVariantLabel(variant)} 缩略图`"
                              loading="lazy"
                            />
                          </button>
                          <a v-if="getNormalAssetPath(role, variant)" class="roles-dialog__asset-link" :href="getNormalAssetUrl(role, variant)" target="_blank" rel="noreferrer">
                            {{ getNormalAssetPath(role, variant) }}
                          </a>
                          <span v-else class="roles-dialog__asset-empty">暂无图片</span>
                          <span v-if="formatAssetMeta(getAssetState(role.draftKey, 'common', variant).meta)" class="roles-dialog__asset-meta">
                            {{ formatAssetMeta(getAssetState(role.draftKey, 'common', variant).meta) }}
                          </span>
                          <span v-if="getAssetState(role.draftKey, 'common', variant).loading" class="roles-dialog__asset-status">处理中...</span>
                          <span v-if="getAssetState(role.draftKey, 'common', variant).error" class="roles-dialog__asset-error">
                            {{ getAssetState(role.draftKey, 'common', variant).error }}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="roles-dialog__action-stack">
                        <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getPromptState(role.draftKey).loading || !role.descr.trim()" @click="handleGenerateNormalPrompt(role)">
                          生成提示词
                        </button>
                        <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'raw').loading || !role.prompt.trim() || parseImageDimensionInput(draft.normalAi.imageWidthText) === null || parseImageDimensionInput(draft.normalAi.imageHeightText) === null" @click="handleGenerateNormalImage(role)">
                          生成原图
                        </button>
                        <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'compress1').loading || !role.img_raw.trim()" @click="handleCompressNormalImage(role, 1)">
                          压缩到1
                        </button>
                        <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'compress2').loading || !role.img_raw.trim()" @click="handleCompressNormalImage(role, 2)">
                          压缩到2
                        </button>
                      </div>
                    </td>
                    <td class="roles-dialog__actions-col">
                      <button class="btn-secondary roles-dialog__row-button" type="button" @click="removeNormalRole(index)">删除</button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div v-if="!draft.normalRoles.length" class="roles-dialog__empty">
                还没有普通角色，先添加一行。
              </div>
            </div>
          </div>

          <div v-else class="roles-dialog__section">
            <section class="roles-dialog__config">
              <div class="roles-dialog__config-head">
                <h3 class="roles-dialog__config-title">重要角色 AI 工具配置</h3>
              </div>

              <div class="roles-dialog__config-grid">
                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">图片宽度</span>
                  <input v-model="draft.importantAi.imageWidthText" class="text-input" type="number" min="1" step="1" placeholder="1536" />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">图片高度</span>
                  <input v-model="draft.importantAi.imageHeightText" class="text-input" type="number" min="1" step="1" placeholder="1024" />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">压缩质量1</span>
                  <input
                    v-model="draft.importantAi.compressQuality1Text"
                    class="text-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    placeholder="60"
                  />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">压缩质量2</span>
                  <input
                    v-model="draft.importantAi.compressQuality2Text"
                    class="text-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    placeholder="30"
                  />
                </label>

                <label class="roles-dialog__field roles-dialog__field--wide">
                  <span class="roles-dialog__label">整体提示词</span>
                  <textarea
                    v-model="draft.importantAi.globalPrompt"
                    class="text-input roles-dialog__textarea"
                    rows="3"
                    placeholder="统一风格、时代背景、镜头语言、材质倾向等"
                  />
                </label>
              </div>
            </section>

            <div class="roles-dialog__table-wrap">
              <table class="roles-dialog__table">
                <thead>
                  <tr>
                    <th class="roles-dialog__select-col">选择</th>
                    <th>ID</th>
                    <th>名字</th>
                    <th>职业</th>
                    <th>描述</th>
                    <th>联系人/性格</th>
                    <th>区分性别</th>
                    <th>提示词</th>
                    <th>图片</th>
                    <th>AI 操作</th>
                    <th class="roles-dialog__actions-col">操作</th>
                  </tr>
                </thead>
                <tbody v-if="draft.importantRoles.length">
                  <tr v-for="(role, index) in draft.importantRoles" :key="role.draftKey">
                    <td class="roles-dialog__select-col">
                      <input v-model="role.selected" type="checkbox" />
                    </td>
                    <td>
                      <input v-model="role.id" class="text-input roles-dialog__cell-input" type="text" placeholder="suanming_xiansheng" />
                    </td>
                    <td>
                      <input v-model="role.name" class="text-input roles-dialog__cell-input" type="text" placeholder="李助理" />
                    </td>
                    <td>
                      <input v-model="role.zhiye" class="text-input roles-dialog__cell-input" type="text" placeholder="县长" />
                    </td>
                    <td>
                      <div v-if="role.qufen_xingbie" class="roles-dialog__asset-group roles-dialog__asset-group--images">
                        <div class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">男描述</span>
                          <textarea
                            v-model="role.descr_male"
                            class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                            rows="3"
                            placeholder="男性角色描述"
                          />
                        </div>
                        <div class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">女描述</span>
                          <textarea
                            v-model="role.descr_female"
                            class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                            rows="3"
                            placeholder="女性角色描述"
                          />
                        </div>
                      </div>
                      <textarea
                        v-else
                        v-model="role.descr"
                        class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                        rows="3"
                        placeholder="算命先生，长衫，手持签筒，江湖感"
                      />
                    </td>
                    <td>
                      <div class="roles-dialog__meta-stack">
                        <label class="roles-dialog__inline-check">
                          <input v-model="role.contact_enabled" type="checkbox" />
                          <span>加入联系人</span>
                        </label>
                        <select v-model="role.contact_track" class="text-input roles-dialog__select">
                          <option v-for="option in contactTrackOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>
                        <input
                          v-model.number="role.contact_initial_favor"
                          class="text-input roles-dialog__cell-input"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          placeholder="20"
                        />
                        <select v-model="role.xingge_id" class="text-input roles-dialog__select">
                          <option value="">未指定性格</option>
                          <option v-for="option in personalityOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>
                        <textarea
                          v-model="role.xingge"
                          class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                          rows="2"
                          placeholder="兼容旧字段的性格描述"
                        />
                        <textarea
                          v-model="role.xingge_note"
                          class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                          rows="2"
                          placeholder="补充不同场景下的说话方式"
                        />
                      </div>
                    </td>
                    <td>
                      <select v-model="role.qufen_xingbie" class="text-input roles-dialog__select">
                        <option :value="false">否</option>
                        <option :value="true">是</option>
                      </select>
                    </td>
                    <td>
                      <div v-if="role.qufen_xingbie" class="roles-dialog__asset-group roles-dialog__asset-group--images">
                        <div class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">男提示词</span>
                          <button class="roles-dialog__prompt-link" type="button" @click="openPromptEditor(role.draftKey, role.prompt_male, 'male')">
                            {{ getPromptPreview(role.prompt_male) }}
                          </button>
                        </div>
                        <div class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">女提示词</span>
                          <button class="roles-dialog__prompt-link" type="button" @click="openPromptEditor(role.draftKey, role.prompt_female, 'female')">
                            {{ getPromptPreview(role.prompt_female) }}
                          </button>
                        </div>
                      </div>
                      <div v-else class="roles-dialog__prompt-cell">
                        <button class="roles-dialog__prompt-link" type="button" @click="openPromptEditor(role.draftKey, role.prompt)">
                          {{ getPromptPreview(role.prompt) }}
                        </button>
                      </div>
                      <div class="roles-dialog__prompt-cell">
                        <span v-if="getPromptState(role.draftKey).loading" class="roles-dialog__prompt-status">生成中...</span>
                        <span v-if="getPromptState(role.draftKey).error" class="roles-dialog__prompt-error">
                          {{ getPromptState(role.draftKey).error }}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div v-if="role.qufen_xingbie" class="roles-dialog__asset-group roles-dialog__asset-group--images">
                        <div class="roles-dialog__asset-set">
                          <span class="roles-dialog__asset-set-title">男图</span>
                          <div class="roles-dialog__asset-grid">
                            <div v-for="variant in imageVariants" :key="`male-${variant}`" class="roles-dialog__asset-card">
                              <span class="roles-dialog__asset-title">{{ getImageVariantLabel(variant) }}</span>
                              <button
                                v-if="variant === 'raw' && getImportantAssetPath(role, 'male', variant)"
                                class="roles-dialog__asset-thumb-button"
                                type="button"
                                @click="openImagePreview(getImagePreviewTitle(role.id, variant, 'male'), getImportantAssetPath(role, 'male', variant))"
                              >
                                <img
                                  class="roles-dialog__asset-thumb"
                                  :src="getImportantAssetUrl(role, 'male', variant)"
                                  :alt="`${getRoleDisplayName(role)} 男图 ${getImageVariantLabel(variant)} 缩略图`"
                                  loading="lazy"
                                />
                              </button>
                              <a v-if="getImportantAssetPath(role, 'male', variant)" class="roles-dialog__asset-link" :href="getImportantAssetUrl(role, 'male', variant)" target="_blank" rel="noreferrer">
                                {{ getImportantAssetPath(role, 'male', variant) }}
                              </a>
                              <span v-else class="roles-dialog__asset-empty">暂无图片</span>
                              <span v-if="formatAssetMeta(getAssetState(role.draftKey, 'male', variant).meta)" class="roles-dialog__asset-meta">
                                {{ formatAssetMeta(getAssetState(role.draftKey, 'male', variant).meta) }}
                              </span>
                              <span v-if="getAssetState(role.draftKey, 'male', variant).loading" class="roles-dialog__asset-status">处理中...</span>
                              <span v-if="getAssetState(role.draftKey, 'male', variant).error" class="roles-dialog__asset-error">
                                {{ getAssetState(role.draftKey, 'male', variant).error }}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div class="roles-dialog__asset-set">
                          <span class="roles-dialog__asset-set-title">女图</span>
                          <div class="roles-dialog__asset-grid">
                            <div v-for="variant in imageVariants" :key="`female-${variant}`" class="roles-dialog__asset-card">
                              <span class="roles-dialog__asset-title">{{ getImageVariantLabel(variant) }}</span>
                              <button
                                v-if="variant === 'raw' && getImportantAssetPath(role, 'female', variant)"
                                class="roles-dialog__asset-thumb-button"
                                type="button"
                                @click="openImagePreview(getImagePreviewTitle(role.id, variant, 'female'), getImportantAssetPath(role, 'female', variant))"
                              >
                                <img
                                  class="roles-dialog__asset-thumb"
                                  :src="getImportantAssetUrl(role, 'female', variant)"
                                  :alt="`${getRoleDisplayName(role)} 女图 ${getImageVariantLabel(variant)} 缩略图`"
                                  loading="lazy"
                                />
                              </button>
                              <a v-if="getImportantAssetPath(role, 'female', variant)" class="roles-dialog__asset-link" :href="getImportantAssetUrl(role, 'female', variant)" target="_blank" rel="noreferrer">
                                {{ getImportantAssetPath(role, 'female', variant) }}
                              </a>
                              <span v-else class="roles-dialog__asset-empty">暂无图片</span>
                              <span v-if="formatAssetMeta(getAssetState(role.draftKey, 'female', variant).meta)" class="roles-dialog__asset-meta">
                                {{ formatAssetMeta(getAssetState(role.draftKey, 'female', variant).meta) }}
                              </span>
                              <span v-if="getAssetState(role.draftKey, 'female', variant).loading" class="roles-dialog__asset-status">处理中...</span>
                              <span v-if="getAssetState(role.draftKey, 'female', variant).error" class="roles-dialog__asset-error">
                                {{ getAssetState(role.draftKey, 'female', variant).error }}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div v-else class="roles-dialog__asset-set">
                        <span class="roles-dialog__asset-set-title">通用图</span>
                        <div class="roles-dialog__asset-grid">
                          <div v-for="variant in imageVariants" :key="`common-${variant}`" class="roles-dialog__asset-card">
                            <span class="roles-dialog__asset-title">{{ getImageVariantLabel(variant) }}</span>
                            <button
                              v-if="variant === 'raw' && getImportantAssetPath(role, 'common', variant)"
                              class="roles-dialog__asset-thumb-button"
                              type="button"
                              @click="openImagePreview(getImagePreviewTitle(role.id, variant, 'common'), getImportantAssetPath(role, 'common', variant))"
                            >
                              <img
                                class="roles-dialog__asset-thumb"
                                :src="getImportantAssetUrl(role, 'common', variant)"
                                :alt="`${getRoleDisplayName(role)} 通用图 ${getImageVariantLabel(variant)} 缩略图`"
                                loading="lazy"
                              />
                            </button>
                            <a v-if="getImportantAssetPath(role, 'common', variant)" class="roles-dialog__asset-link" :href="getImportantAssetUrl(role, 'common', variant)" target="_blank" rel="noreferrer">
                              {{ getImportantAssetPath(role, 'common', variant) }}
                            </a>
                            <span v-else class="roles-dialog__asset-empty">暂无图片</span>
                            <span v-if="formatAssetMeta(getAssetState(role.draftKey, 'common', variant).meta)" class="roles-dialog__asset-meta">
                              {{ formatAssetMeta(getAssetState(role.draftKey, 'common', variant).meta) }}
                            </span>
                            <span v-if="getAssetState(role.draftKey, 'common', variant).loading" class="roles-dialog__asset-status">处理中...</span>
                            <span v-if="getAssetState(role.draftKey, 'common', variant).error" class="roles-dialog__asset-error">
                              {{ getAssetState(role.draftKey, 'common', variant).error }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="roles-dialog__action-stack">
                        <button
                          class="btn-secondary roles-dialog__row-button"
                          type="button"
                          :disabled="getPromptState(role.draftKey).loading || (role.qufen_xingbie ? (!role.descr_male.trim() && !role.descr_female.trim()) : !role.descr.trim())"
                          @click="handleGenerateImportantPrompt(role)"
                        >
                          生成提示词
                        </button>

                        <template v-if="role.qufen_xingbie">
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'male', 'raw').loading || !role.prompt_male.trim() || parseImageDimensionInput(draft.importantAi.imageWidthText) === null || parseImageDimensionInput(draft.importantAi.imageHeightText) === null" @click="handleGenerateImportantImage(role, 'male')">
                            生成男原图
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'female', 'raw').loading || !role.prompt_female.trim() || parseImageDimensionInput(draft.importantAi.imageWidthText) === null || parseImageDimensionInput(draft.importantAi.imageHeightText) === null" @click="handleGenerateImportantImage(role, 'female')">
                            生成女原图
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'male', 'compress1').loading || !role.img_male_raw.trim()" @click="handleCompressImportantImage(role, 'male', 1)">
                            男图压缩到1
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'male', 'compress2').loading || !role.img_male_raw.trim()" @click="handleCompressImportantImage(role, 'male', 2)">
                            男图压缩到2
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'female', 'compress1').loading || !role.img_female_raw.trim()" @click="handleCompressImportantImage(role, 'female', 1)">
                            女图压缩到1
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'female', 'compress2').loading || !role.img_female_raw.trim()" @click="handleCompressImportantImage(role, 'female', 2)">
                            女图压缩到2
                          </button>
                        </template>

                        <template v-else>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'raw').loading || !role.prompt.trim() || parseImageDimensionInput(draft.importantAi.imageWidthText) === null || parseImageDimensionInput(draft.importantAi.imageHeightText) === null" @click="handleGenerateImportantImage(role, 'common')">
                            生成通用原图
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'compress1').loading || !role.img_raw.trim()" @click="handleCompressImportantImage(role, 'common', 1)">
                            压缩到1
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'compress2').loading || !role.img_raw.trim()" @click="handleCompressImportantImage(role, 'common', 2)">
                            压缩到2
                          </button>
                        </template>
                      </div>
                    </td>
                    <td class="roles-dialog__actions-col">
                      <button class="btn-secondary roles-dialog__row-button" type="button" @click="removeImportantRole(index)">删除</button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div v-if="!draft.importantRoles.length" class="roles-dialog__empty">
                还没有重要角色，先添加一行。
              </div>
            </div>
          </div>

          <div class="roles-dialog__footer">
            <button
              class="btn-secondary roles-dialog__row-add"
              type="button"
              @click="activeTab === 'normal' ? addNormalRole() : addImportantRole()"
            >
              + 添加{{ activeTab === "normal" ? "普通角色" : "重要角色" }}
            </button>
          </div>
        </div>

        <div class="roles-dialog__actions roles-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
          <button class="btn-primary" type="button" :disabled="saving || hasInvalidDraft" @click="submitDraft">
            {{ saving ? "保存中..." : "保存" }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="promptEditorState.roleKey" class="roles-dialog__prompt-modal">
      <section class="roles-dialog__prompt-panel glass-panel">
        <div class="roles-dialog__prompt-head">
          <h3 class="roles-dialog__prompt-title">编辑提示词</h3>
          <button class="btn-secondary" type="button" @click="closePromptEditor">关闭</button>
        </div>

        <textarea
          v-model="promptEditorState.value"
          class="text-input roles-dialog__prompt-textarea"
          rows="10"
          placeholder="这里填写或修改当前角色的最终提示词"
        />

        <div class="roles-dialog__actions roles-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="closePromptEditor">取消</button>
          <button class="btn-primary" type="button" @click="savePromptEditor">保存提示词</button>
        </div>
      </section>
    </div>

    <div
      v-if="imagePreviewState.url"
      class="roles-dialog__image-modal"
      @click.self="closeImagePreview"
    >
      <section class="roles-dialog__image-panel glass-panel">
        <div class="roles-dialog__image-head">
          <div class="roles-dialog__image-copy">
            <h3 class="roles-dialog__image-title">{{ imagePreviewState.title }}</h3>
            <span class="roles-dialog__image-path">{{ imagePreviewState.path }}</span>
          </div>
          <button class="btn-secondary" type="button" @click="closeImagePreview">关闭</button>
        </div>

        <div class="roles-dialog__image-frame">
          <img
            class="roles-dialog__image-full"
            :src="imagePreviewState.url"
            :alt="imagePreviewState.title"
          />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./styles/StoryRolesDialog.css"></style>
