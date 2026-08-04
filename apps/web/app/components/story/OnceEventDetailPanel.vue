<script setup lang="ts">
/** 单次事件面板门面：保留原有 props/emits，编辑状态由 useOnceEventEditor 管理。 */
import StoryEventLocationField from "./StoryEventLocationField.vue"
import StoryEventObjectField from "./StoryEventObjectField.vue"
import EventPresentationPanel from "./EventPresentationPanel.vue"
import StoryDialogueAiDialog from "./StoryDialogueAiDialog.vue"
import StoryQuickLocationCreateDialog from "./StoryQuickLocationCreateDialog.vue"
import StoryQuickRoleCreateDialog from "./StoryQuickRoleCreateDialog.vue"
import {
  useOnceEventEditor,
  type OnceEventEditorEmits,
  type OnceEventEditorProps
} from "./useOnceEventEditor"

const props = defineProps<OnceEventEditorProps>()
const emit = defineEmits<OnceEventEditorEmits>()
const controller = useOnceEventEditor(props, emit)
const {
  STORY_SCRIPT_TEMPLATE_PLACEHOLDER, PLAYER_OBJECT_OPTION,
  triggerExprFieldRef, triggerExprTextareaRef, initScriptFieldRef, initScriptTextareaRef,
  endScriptFieldRef, endScriptTextareaRef, triggerAutocompleteState, initScriptAutocompleteState,
  endScriptAutocompleteState, scriptValidationState, globalAutocompleteCandidates,
  invokeParamAutocompleteCandidates, scriptAutocompleteCandidates, triggerAutocompleteItems,
  invokeAutocompleteContext, initScriptAutocompleteItems, endScriptAutocompleteItems,
  highlightedInitScriptTokens, highlightedEndScriptTokens, isTriggerAutocompleteOpen,
  isInitScriptAutocompleteOpen, isEndScriptAutocompleteOpen, activeTriggerAutocompleteItem,
  activeInitScriptAutocompleteItem, activeEndScriptAutocompleteItem, activeInitScriptCommandDetail,
  activeEndScriptCommandDetail, normalizeAutocompleteText, toggleTriggerHelp, toggleInitScriptHelp,
  toggleEndScriptHelp, resetScriptValidation, getScriptValidationLabel,
  getScriptValidationMessage, getScriptValidationClass, getScriptAutocompleteState,
  getScriptAutocompleteItems, getActiveScriptAutocompleteItem, getScriptTextareaRef,
  getScriptFieldRef, getScriptFieldValue, setScriptFieldValue, closeScriptAutocomplete,
  updateScriptAutocompleteFromCaret, insertScriptAutocompleteItem, onTriggerExprInput,
  onTriggerExprKeydown, onInitScriptInput, onInitScriptKeydown, onInitScriptScroll,
  onEndScriptInput, onEndScriptKeydown, onEndScriptScroll, syncScriptEditorScroll,
  dialogueContentFieldRef, dialogueContentTextareaRef, isQuickLocationDialogOpen,
  isQuickRoleDialogOpen, pendingQuickRoleKey, dialogueContentAutocompleteState,
  dialogueIdSeed, invokeParamIdSeed, createDialogueId, createInvokeParamId, cloneDialogue,
  dialogueEditorState, isDialogueAiDialogOpen, dialogueAiPrompt, dialogueAiLoading,
  dialogueAiError, dialogueAiResult, dialogueAiAbortController, locationOptions,
  importantRoleOptions, normalRoleOptions, specialObjectOptions, roleOptionMap,
  objectKeyOptions, dialogueEditorTitle, dialogueContentAutocompleteItems,
  isDialogueContentAutocompleteOpen, activeDialogueContentAutocompleteItem, submitLabel,
  normalizeObjectKeys, normalizeStoredObjectKeys, createDialogueEditorDraft,
  openCreateDialogueEditor, openEditDialogueEditor, closeDialogueEditor, removeDialogue,
  addInvokeParam, removeInvokeParam, moveDialogue, handleDialogueEditorSpeakerTypeChange,
  getDialogueEditorSpeakerOptions, saveDialogueEditor, toggleDialogueTemplateHelp,
  getInvokeParamValidationTokens, closeDialogueContentAutocomplete,
  updateDialogueContentAutocompleteFromCaret, insertDialogueContentAutocompleteItem,
  onDialogueContentInput, onDialogueContentKeydown, openDialogueAiDialog,
  closeDialogueAiDialog, abortDialogueAi, applyDialogueAiResult, requestQuickCreateRole,
  requestQuickCreateLocation, closeQuickLocationDialog, closeQuickRoleDialog,
  submitQuickCreateRole, applyQuickCreatedRole,
  generateStoryDialogue, pendingQuickLocationName, cloneInvokeParam, draft,
  bgmOptions, panelTitle, panelEyebrow, normalizeDraftTriggerMode,
  syncPresentationDraft, syncDraft, getReadableValidationTokens, validateScriptField,
  closeAllScriptAutocomplete, onScriptFieldKeydown, buildDraftPresentation, buildDialogueEventDraft,
  runDialogueAi, submitDraft, submitQuickCreateLocation, handleDocumentPointerDown,
} = controller
</script>

<template>
  <section class="detail-panel glass-panel">
    <template v-if="event">
      <div class="detail-panel__header">
        <div class="detail-panel__header-copy">
          <span class="eyebrow">{{ panelEyebrow }}</span>
          <h2 class="detail-panel__title">{{ panelTitle }}</h2>
        </div>
      </div>

      <div class="detail-panel__workspace">
        <div class="detail-panel__main">
          <section class="detail-card">
            <h3 class="detail-card__title">基础信息</h3>
            <div class="detail-grid">
              <label class="field">
                <span class="field-label">事件 ID</span>
                <input
                  v-model="draft.id"
                  class="text-input"
                  type="text"
                  :readonly="props.mode !== 'create'"
                />
              </label>

              <label class="field">
                <span class="field-label">标题</span>
                <input v-model="draft.title" class="text-input" type="text" />
              </label>

              <StoryEventLocationField
                v-model="draft.location"
                :options="locationOptions"
                @quick-create="requestQuickCreateLocation"
              />

              <label class="field">
                <span class="field-label">背景音乐</span>
                <input v-model="draft.bgm" class="text-input" type="text" list="once-event-bgm" />
                <datalist id="once-event-bgm">
                  <option v-for="bgm in bgmOptions" :key="bgm" :value="bgm" />
                </datalist>
              </label>

              <slot name="base-info-extra" />
            </div>
          </section>

          <slot name="extra-main" />

          <section class="detail-card">
            <div class="detail-grid detail-grid--event-config">
              <StoryEventObjectField
                v-model="draft.selectedObjectKeys"
                :special-options="specialObjectOptions"
                :important-options="importantRoleOptions"
                :normal-options="normalRoleOptions"
                placeholder="搜索并选择对象角色"
                @quick-create="requestQuickCreateRole"
              />

              <slot name="event-config-trigger">
                <div ref="triggerExprField" class="field detail-panel__trigger-config">
                  <span class="field-label">触发方式</span>
                  <div class="detail-panel__trigger-mode">
                    <label class="detail-panel__trigger-mode-option">
                      <input
                        v-model="draft.triggerMode"
                        class="detail-panel__trigger-mode-input"
                        type="radio"
                        value="default"
                      />
                      <span>默认触发</span>
                    </label>
                    <label class="detail-panel__trigger-mode-option">
                      <input
                        v-model="draft.triggerMode"
                        class="detail-panel__trigger-mode-input"
                        type="radio"
                        value="condition"
                      />
                      <span>条件触发</span>
                    </label>
                    <label class="detail-panel__trigger-mode-option">
                      <input
                        v-model="draft.triggerMode"
                        class="detail-panel__trigger-mode-input"
                        type="radio"
                        value="invoke"
                      />
                      <span>被调用</span>
                    </label>
                  </div>

                  <template v-if="draft.triggerMode === 'condition'">
                    <div class="detail-panel__label-row">
                      <span class="field-label">触发条件</span>
                      <div class="detail-panel__help">
                        <button
                          class="detail-panel__help-button"
                          type="button"
                          aria-label="查看触发条件说明"
                          @click.stop="toggleTriggerHelp"
                      >
                        ?
                      </button>
                    </div>
                    <button
                      class="detail-panel__validate-button"
                      type="button"
                      :disabled="scriptValidationState.triggerExpr.status === 'checking'"
                      @click.stop="validateScriptField('triggerExpr')"
                    >
                      {{
                        scriptValidationState.triggerExpr.status === "checking"
                          ? "校验中"
                          : "校验"
                      }}
                    </button>
                  </div>
                  <div class="detail-panel__expression-wrap">
                      <textarea
                        ref="triggerExprTextarea"
                        v-model="draft.triggerExpr"
                        class="text-area detail-panel__expression"
                        placeholder="${county.gdp} >= 10000000000 && ${county.jiaoyu} >= 60"
                        @input="onTriggerExprInput"
                        @click="updateScriptAutocompleteFromCaret('triggerExpr')"
                        @keyup="updateScriptAutocompleteFromCaret('triggerExpr')"
                        @keydown="onTriggerExprKeydown"
                      />

                      <div
                        v-if="isTriggerAutocompleteOpen"
                        class="detail-panel__autocomplete"
                        :class="{
                          'detail-panel__autocomplete--top':
                            triggerAutocompleteState.placement === 'top'
                        }"
                      >
                        <button
                          v-for="(item, index) in triggerAutocompleteItems"
                          :key="item.name"
                          class="detail-panel__autocomplete-item"
                          :class="{
                            'detail-panel__autocomplete-item--active':
                              index === triggerAutocompleteState.activeIndex
                          }"
                          type="button"
                          @mousedown.prevent="insertScriptAutocompleteItem('triggerExpr', item.name)"
                        >
                          <span class="detail-panel__autocomplete-name">{{ item.name }}</span>
                          <span
                            v-if="item.description"
                            class="detail-panel__autocomplete-description"
                          >
                            {{ item.description }}
                          </span>
                        </button>

                        <div
                          v-if="!triggerAutocompleteItems.length"
                          class="detail-panel__autocomplete-empty"
                        >
                          没有匹配的变量
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="scriptValidationState.triggerExpr.status !== 'idle'"
                      class="detail-panel__validation"
                      :class="getScriptValidationClass('triggerExpr')"
                    >
                      <strong class="detail-panel__validation-title">
                        {{ getScriptValidationLabel("triggerExpr") }}
                      </strong>
                      <span
                        v-if="!scriptValidationState.triggerExpr.issues.length"
                        class="detail-panel__validation-message"
                      >
                        {{ getScriptValidationMessage("triggerExpr") }}
                      </span>
                      <ul v-else class="detail-panel__validation-list">
                        <li
                          v-for="issue in scriptValidationState.triggerExpr.issues"
                          :key="issue"
                        >
                          {{ issue }}
                        </li>
                      </ul>
                    </div>
                  </template>

                  <template v-else-if="draft.triggerMode === 'invoke'">
                    <div class="detail-panel__label-row">
                      <span class="field-label">调用参数</span>
                      <button
                        class="btn-secondary detail-panel__param-add"
                        type="button"
                        @click="addInvokeParam"
                      >
                        添加参数
                      </button>
                    </div>

                    <div v-if="draft.invokeParams.length" class="detail-panel__param-table">
                      <div class="detail-panel__param-table-head">
                        <span>参数名</span>
                        <span>说明</span>
                        <span>操作</span>
                      </div>

                      <div
                        v-for="param in draft.invokeParams"
                        :key="param.id"
                        class="detail-panel__param-row"
                      >
                        <input
                          v-model="param.name"
                          class="text-input"
                          type="text"
                          placeholder="county_name"
                        />
                        <input
                          v-model="param.descr"
                          class="text-input"
                          type="text"
                          placeholder="调用方需要传什么值"
                        />
                        <button
                          class="btn-secondary detail-panel__param-remove"
                          type="button"
                          @click="removeInvokeParam(param.id)"
                        >
                          删除
                        </button>
                      </div>
                    </div>

                    <div v-else class="detail-panel__param-empty">
                      这个事件不会自动扫描，只有通过 `invoke_once pool {{ draft.id || 'event_id' }}`
                      传参后才会入队。
                    </div>
                  </template>

                  <template v-else>
                    <div class="detail-panel__param-empty">
                      默认触发会参与运行时自动扫描，不需要填写触发条件。
                    </div>
                  </template>
                </div>
              </slot>

              <label ref="initScriptField" class="field">
                <div class="detail-panel__label-row">
                <span class="field-label">初始化脚本</span>
                  <div class="detail-panel__help">
                    <button
                      class="detail-panel__help-button"
                      type="button"
                      aria-label="查看初始化脚本说明"
                      @click.stop="toggleInitScriptHelp"
                    >
                      ?
                    </button>
                  </div>
                  <button
                    class="detail-panel__validate-button"
                    type="button"
                    :disabled="scriptValidationState.initScript.status === 'checking'"
                    @click.stop="validateScriptField('initScript')"
                  >
                    {{
                      scriptValidationState.initScript.status === "checking"
                        ? "校验中"
                        : "校验"
                    }}
                  </button>
                </div>
                <div class="detail-panel__script-wrap">
                  <div class="detail-panel__script-editor">
                    <pre class="detail-panel__script-highlight" data-script-highlight aria-hidden="true"><code><template
                          v-for="(token, index) in highlightedInitScriptTokens"
                          :key="`init-${index}`"
                        ><span
                            :class="[
                              'detail-panel__script-token',
                              token.highlighted ? 'detail-panel__script-token--keyword' : ''
                            ]"
                            v-html="token.text || '&nbsp;'"
                          /></template></code></pre>
                    <textarea
                      ref="initScriptTextarea"
                      v-model="draft.initScript"
                      class="text-area detail-panel__script detail-panel__script--overlay"
                      placeholder="let bonus = Math.floor(${county.level} * 2)"
                      spellcheck="false"
                      @input="onInitScriptInput"
                      @scroll="onInitScriptScroll"
                      @click="updateScriptAutocompleteFromCaret('initScript')"
                      @keyup="updateScriptAutocompleteFromCaret('initScript')"
                      @keydown="onInitScriptKeydown"
                    />
                  </div>

                  <div
                    v-if="isInitScriptAutocompleteOpen"
                    class="detail-panel__autocomplete"
                    :class="{
                      'detail-panel__autocomplete--top':
                        initScriptAutocompleteState.placement === 'top'
                    }"
                  >
                    <button
                      v-for="(item, index) in initScriptAutocompleteItems"
                      :key="item.name"
                      class="detail-panel__autocomplete-item"
                      :class="{
                        'detail-panel__autocomplete-item--active':
                          index === initScriptAutocompleteState.activeIndex
                      }"
                      type="button"
                      @mousedown.prevent="insertScriptAutocompleteItem('initScript', item.name)"
                    >
                      <span class="detail-panel__autocomplete-name">{{ item.name }}</span>
                      <span
                        v-if="item.description"
                        class="detail-panel__autocomplete-description"
                      >
                        {{ item.description }}
                      </span>
                    </button>

                    <div
                      v-if="!initScriptAutocompleteItems.length"
                      class="detail-panel__autocomplete-empty"
                    >
                      没有匹配的变量
                    </div>
                  </div>
                </div>
                <div
                  v-if="activeInitScriptCommandDetail?.detailTitle || activeInitScriptCommandDetail?.detailLines?.length"
                  class="detail-panel__autocomplete-detail"
                >
                  <strong
                    v-if="activeInitScriptCommandDetail?.detailTitle"
                    class="detail-panel__autocomplete-detail-title"
                  >
                    {{ activeInitScriptCommandDetail.detailTitle }}
                  </strong>
                  <ul
                    v-if="activeInitScriptCommandDetail?.detailLines?.length"
                    class="detail-panel__autocomplete-detail-list"
                  >
                    <li
                      v-for="line in activeInitScriptCommandDetail.detailLines"
                      :key="line"
                    >
                      {{ line }}
                    </li>
                  </ul>
                </div>
                <div
                  v-if="scriptValidationState.initScript.status !== 'idle'"
                  class="detail-panel__validation"
                  :class="getScriptValidationClass('initScript')"
                >
                  <strong class="detail-panel__validation-title">
                    {{ getScriptValidationLabel("initScript") }}
                  </strong>
                  <span
                    v-if="!scriptValidationState.initScript.issues.length"
                    class="detail-panel__validation-message"
                  >
                    {{ getScriptValidationMessage("initScript") }}
                  </span>
                  <ul v-else class="detail-panel__validation-list">
                    <li
                      v-for="issue in scriptValidationState.initScript.issues"
                      :key="issue"
                    >
                      {{ issue }}
                    </li>
                  </ul>
                </div>
                <span class="detail-panel__script-hint">
                  支持多行、`let` 临时变量、`Math` 函数，以及 `=`、`+=`、`-=`、`*=`、`/=`、`%=` 赋值；可读取 `calc` 变量，但不能给 `calc` 变量赋值。
                </span>
              </label>

              <label ref="endScriptField" class="field">
                <div class="detail-panel__label-row">
                <span class="field-label">结束脚本</span>
                  <div class="detail-panel__help">
                    <button
                      class="detail-panel__help-button"
                      type="button"
                      aria-label="查看结束脚本说明"
                      @click.stop="toggleEndScriptHelp"
                    >
                      ?
                    </button>
                  </div>
                  <button
                    class="detail-panel__validate-button"
                    type="button"
                    :disabled="scriptValidationState.endScript.status === 'checking'"
                    @click.stop="validateScriptField('endScript')"
                  >
                    {{
                      scriptValidationState.endScript.status === "checking"
                        ? "校验中"
                        : "校验"
                    }}
                  </button>
                </div>
                <div class="detail-panel__script-wrap">
                  <div class="detail-panel__script-editor">
                    <pre class="detail-panel__script-highlight" data-script-highlight aria-hidden="true"><code><template
                          v-for="(token, index) in highlightedEndScriptTokens"
                          :key="`end-${index}`"
                        ><span
                            :class="[
                              'detail-panel__script-token',
                              token.highlighted ? 'detail-panel__script-token--keyword' : ''
                            ]"
                            v-html="token.text || '&nbsp;'"
                          /></template></code></pre>
                    <textarea
                      ref="endScriptTextarea"
                      v-model="draft.endScript"
                      class="text-area detail-panel__script detail-panel__script--overlay"
                      placeholder="${county.exp} = ${county.exp} + 10"
                      spellcheck="false"
                      @input="onEndScriptInput"
                      @scroll="onEndScriptScroll"
                      @click="updateScriptAutocompleteFromCaret('endScript')"
                      @keyup="updateScriptAutocompleteFromCaret('endScript')"
                      @keydown="onEndScriptKeydown"
                    />
                  </div>

                  <div
                    v-if="isEndScriptAutocompleteOpen"
                    class="detail-panel__autocomplete"
                    :class="{
                      'detail-panel__autocomplete--top':
                        endScriptAutocompleteState.placement === 'top'
                    }"
                  >
                    <button
                      v-for="(item, index) in endScriptAutocompleteItems"
                      :key="item.name"
                      class="detail-panel__autocomplete-item"
                      :class="{
                        'detail-panel__autocomplete-item--active':
                          index === endScriptAutocompleteState.activeIndex
                      }"
                      type="button"
                      @mousedown.prevent="insertScriptAutocompleteItem('endScript', item.name)"
                    >
                      <span class="detail-panel__autocomplete-name">{{ item.name }}</span>
                      <span
                        v-if="item.description"
                        class="detail-panel__autocomplete-description"
                      >
                        {{ item.description }}
                      </span>
                    </button>

                    <div
                      v-if="!endScriptAutocompleteItems.length"
                      class="detail-panel__autocomplete-empty"
                    >
                      没有匹配的变量
                    </div>
                  </div>
                </div>
                <div
                  v-if="activeEndScriptCommandDetail?.detailTitle || activeEndScriptCommandDetail?.detailLines?.length"
                  class="detail-panel__autocomplete-detail"
                >
                  <strong
                    v-if="activeEndScriptCommandDetail?.detailTitle"
                    class="detail-panel__autocomplete-detail-title"
                  >
                    {{ activeEndScriptCommandDetail.detailTitle }}
                  </strong>
                  <ul
                    v-if="activeEndScriptCommandDetail?.detailLines?.length"
                    class="detail-panel__autocomplete-detail-list"
                  >
                    <li
                      v-for="line in activeEndScriptCommandDetail.detailLines"
                      :key="line"
                    >
                      {{ line }}
                    </li>
                  </ul>
                </div>
                <div
                  v-if="scriptValidationState.endScript.status !== 'idle'"
                  class="detail-panel__validation"
                  :class="getScriptValidationClass('endScript')"
                >
                  <strong class="detail-panel__validation-title">
                    {{ getScriptValidationLabel("endScript") }}
                  </strong>
                  <span
                    v-if="!scriptValidationState.endScript.issues.length"
                    class="detail-panel__validation-message"
                  >
                    {{ getScriptValidationMessage("endScript") }}
                  </span>
                  <ul v-else class="detail-panel__validation-list">
                    <li
                      v-for="issue in scriptValidationState.endScript.issues"
                      :key="issue"
                    >
                      {{ issue }}
                    </li>
                  </ul>
                </div>
                <span class="detail-panel__script-hint">
                  支持多行、`let` 临时变量、`Math` 函数，以及 `=`、`+=`、`-=`、`*=`、`/=`、`%=` 赋值；可读取 `calc` 变量，但不能给 `calc` 变量赋值。
                </span>
              </label>
            </div>
          </section>
        </div>

        <EventPresentationPanel :controller="controller" />
      </div>

      <div class="detail-panel__footer">
        <button class="btn-secondary detail-panel__close" type="button" @click="emit('close')">
          关闭
        </button>
        <button class="btn-primary detail-panel__submit" type="button" :disabled="saving" @click="submitDraft">
          {{ submitLabel }}
        </button>
      </div>

      <div
        v-if="dialogueEditorState.open"
        class="detail-panel__dialogue-modal"
        @click.self="closeDialogueEditor"
      >
        <section class="detail-panel__dialogue-modal-panel glass-panel">
          <div class="detail-panel__dialogue-modal-head">
            <h3 class="detail-panel__dialogue-modal-title">{{ dialogueEditorTitle }}</h3>
            <button class="btn-secondary" type="button" @click="closeDialogueEditor">关闭</button>
          </div>

          <div class="dialogue-editor__grid">
            <label class="field">
              <span class="field-label">说话人类型</span>
              <select
                v-model="dialogueEditorState.draft.speaker_type"
                class="select-input"
                @change="handleDialogueEditorSpeakerTypeChange"
              >
                <option value="player">主角</option>
                <option value="object">事件对象</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">说话人</span>
              <select v-model="dialogueEditorState.draft.speaker_key" class="select-input">
                <option
                  v-for="option in getDialogueEditorSpeakerOptions()"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>

          <label ref="dialogueContentField" class="field">
            <div class="detail-panel__label-row">
              <span class="field-label">对白</span>
              <div class="detail-panel__help">
                <button
                  class="detail-panel__help-button"
                  type="button"
                  aria-label="查看对白插值说明"
                  @click.stop="toggleDialogueTemplateHelp"
                >
                  ?
                </button>
              </div>
            </div>
            <div class="detail-panel__expression-wrap">
              <textarea
                ref="dialogueContentTextarea"
                v-model="dialogueEditorState.draft.content"
                class="text-area dialogue-editor__content"
                :placeholder="STORY_SCRIPT_TEMPLATE_PLACEHOLDER"
                @input="onDialogueContentInput"
                @click="updateDialogueContentAutocompleteFromCaret"
                @keyup="updateDialogueContentAutocompleteFromCaret"
                @keydown="onDialogueContentKeydown"
              />

              <div
                v-if="isDialogueContentAutocompleteOpen"
                class="detail-panel__autocomplete"
                :class="{
                  'detail-panel__autocomplete--top':
                    dialogueContentAutocompleteState.placement === 'top'
                }"
              >
                <button
                  v-for="(item, index) in dialogueContentAutocompleteItems"
                  :key="item.name"
                  class="detail-panel__autocomplete-item"
                  :class="{
                    'detail-panel__autocomplete-item--active':
                      index === dialogueContentAutocompleteState.activeIndex
                  }"
                  type="button"
                  @mousedown.prevent="insertDialogueContentAutocompleteItem(item.name)"
                >
                  <span class="detail-panel__autocomplete-name">{{ item.name }}</span>
                  <span
                    v-if="item.description"
                    class="detail-panel__autocomplete-description"
                  >
                    {{ item.description }}
                  </span>
                </button>

                <div
                  v-if="!dialogueContentAutocompleteItems.length"
                  class="detail-panel__autocomplete-empty"
                >
                  没有匹配的变量
                </div>
              </div>
            </div>
          </label>

          <div class="detail-panel__dialogue-modal-actions">
            <button class="btn-secondary" type="button" @click="closeDialogueEditor">取消</button>
            <button class="btn-primary" type="button" @click="saveDialogueEditor">保存</button>
          </div>
        </section>
      </div>

      <StoryQuickRoleCreateDialog
        v-if="isQuickRoleDialogOpen"
        :roles="props.roles"
        :saving="props.saving"
        @close="closeQuickRoleDialog"
        @create="submitQuickCreateRole"
      />

      <StoryQuickLocationCreateDialog
        v-if="isQuickLocationDialogOpen"
        :event-locations="props.eventLocations"
        :saving="props.saving"
        @close="closeQuickLocationDialog"
        @create="submitQuickCreateLocation"
      />

      <StoryDialogueAiDialog
        :open="isDialogueAiDialogOpen"
        :event="buildDialogueEventDraft() ?? event"
        collection-type="pool"
        :roles="props.roles"
        :loading="dialogueAiLoading"
        :prompt="dialogueAiPrompt"
        :result="dialogueAiResult"
        :error-message="dialogueAiError"
        @close="closeDialogueAiDialog"
        @update-prompt="dialogueAiPrompt = $event"
        @run="runDialogueAi"
        @abort="abortDialogueAi"
        @apply="applyDialogueAiResult"
      />
    </template>

    <div v-else class="detail-panel__empty">
      请先在画布中选择一个一次性事件再开始编辑。
    </div>
  </section>
</template>

<style scoped src="./styles/OnceEventDetailPanel.css"></style>
