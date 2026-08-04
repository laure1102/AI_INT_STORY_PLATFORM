<script setup lang="ts">
/**
 * AI 草稿结果区：展示 Agent 日志、影响分析与可选择的应用内容。
 * 所有修改仍写入父控制器的 editableDraft；本组件不执行网络请求或文件保存。
 */
import type { StoryDocument } from "@story-mgr/core"
import type { RunStoryCreationAgentResponse } from "@story-mgr/shared"
import StoryCreationAssetDraftPreview from "./StoryCreationAssetDraftPreview.vue"
import StoryCreationPhoneDraftPreview from "./StoryCreationPhoneDraftPreview.vue"
import type { StoryCreationWorkspaceController } from "./useStoryCreationWorkspace"

const { controller } = defineProps<{
  agentRunning: boolean
  agentResult: RunStoryCreationAgentResponse | null
  applying: boolean
  applyMessage: string | null
  applyWarnings: string[]
  controller: StoryCreationWorkspaceController
  story: StoryDocument
}>()
const {
  commandText, feedbackText, newCreationExpanded, creationHistoryExpanded,
  feedbackSeq, activeFeedbackId, activeBibleField, selectedEventKeys,
  selectedLocationIds, selectedRoleKeys, selectedItemIds, selectedVariableKeys,
  selectedPhonePersonalityIds, selectedPhoneTalkIds, selectedPhoneActionIds, selectedPhoneReplyIds,
  selectedPhoneContactProfileKeys, selectedPhoneConversationIds, selectedDoingMenuIds, selectedDoingIds,
  selectedShopCategoryIds, selectedShopProductIds, feedbackHistory, editableDraft,
  draftApplied, draft, bibleFields, pipelineSteps,
  activeBibleFieldConfig, agentModelSummary, filledBibleFieldCount, canRunAgent,
  canRefineDraft, isFeedbackRunning, isNewCreationRunning, abortAgentLabel,
  activeFeedbackItem, historySessions, historySessionCount, showNewCreationForm,
  runStatus, agentLogs, loggedRoles, activeAgentRole,
  draftPreview, eventTypeSummary, phoneDraftCount, phoneConversationDraftCount,
  doingDraftCount, shopDraftCount, selectedApplyCount, canApplyDraft,
  applyButtonLabel, existingLocationIds, existingRoleKeys, existingItemIds,
  existingItemCategoryIds, existingVariableKeys, existingPhonePersonalityIds, existingPhoneTalkIds,
  existingPhoneActionIds, existingPhoneReplyIds, existingPhoneContactProfileKeys, existingPhoneConversationIds,
  existingDoingMenuIds, existingDoingIds, existingShopCategoryIds, existingShopProductIds,
  existingChainIds, existingEventKeys, selectedDraftChainIds, availableLocationIdsForApply,
  availableRoleKeysForApply, availableChainIdsForApply, availableDoingMenuIdsForApply, availableItemIdsForApply,
  availableShopCategoryIdsForApply, selectedImpactSummary, applyPreviewMessage, syncDraft,
  submitStoryBible, runAgent, refineDraft, abortAgent,
  appendFeedbackHistory, finishActiveFeedback, updateFeedbackHistoryItem, clearFeedbackHistory,
  feedbackStatusLabel, getFeedbackStatusClass, historyStatusLabel, historyStatusClass,
  formatHistoryTime, syncFeedbackHistoryFromSession, restoreHistorySession, deleteHistorySession,
  getEventKey, getRoleKey, getVariableKey, cloneCreationDraft,
  syncEditableDraft, resetEditableDraft, syncApplySelection, toggleStringSelection,
  setEventSelected, setLocationSelected, setRoleSelected, setItemSelected,
  setVariableSelected, setPhonePersonalitySelected, setPhoneTalkSelected, setPhoneActionSelected,
  setPhoneReplySelected, setPhoneContactProfileSelected, setPhoneConversationSelected, setDoingMenuSelected,
  setDoingSelected, setShopCategorySelected, setShopProductSelected, getCheckboxChecked,
  handleLocationSelectionChange, handleRoleSelectionChange, handleItemSelectionChange, handleVariableSelectionChange,
  handleEventSelectionChange, handlePhonePersonalitySelectionChange, handlePhoneTalkSelectionChange, handlePhoneActionSelectionChange,
  handlePhoneReplySelectionChange, handlePhoneContactProfileSelectionChange, handlePhoneConversationSelectionChange, handleDoingMenuSelectionChange,
  handleDoingSelectionChange, handleShopCategorySelectionChange, handleShopProductSelectionChange, applyDraft,
  variableValueLabel, setVariableValueFromInput, createImpact, getLocationImpact,
  getRoleImpact, getItemImpact, getVariableImpact, getEventImpact,
  getPhonePersonalityImpact, getPhoneTalkImpact, getPhoneActionImpact, getPhoneReplyImpact,
  getPhoneContactProfileImpact, getPhoneConversationImpact, getDoingMenuImpact, getDoingImpact,
  getShopCategoryImpact, getShopProductImpact, getDraftPresentationDialogues, getPresentationLabel,
  getImpactClass, getItemCategoryName, getDraftOrExistingItemName, getDraftOrExistingShopCategoryName,
  getItemTagsText, splitListInput, setItemTagsText, getPhoneScopeText,
  getStringListText, setStringListText, setPhonePersonalityTags, setPhoneTalkTags,
  setPhoneActionTags, setPhoneReplyTags, setPhoneContactPreferredTags, getPhoneCostItemsText,
  getPhoneRepliesText, setPhoneRepliesText, getContactProfileSummary, getDoingPresentationSummary,
  setItemMaxStackFromInput, ensureScheduleLoop, getScheduleAt, setScheduleAt,
  getSchedulePriority, setSchedulePriority, getScheduleAfterText, setScheduleAfterText,
  getEventApplyWarnings, collectionTypeLabel, triggerModeLabel
} = controller
</script>

<template>
<section class="creation-results" aria-label="AI 生成草稿">
        <div v-if="draftPreview" class="creation-result">
          <section class="creation-feedback">
            <div class="creation-feedback__head">
              <div>
                <span class="eyebrow">Feedback</span>
                <strong>反馈优化</strong>
              </div>
              <div class="creation-feedback__actions">
                <button
                  class="btn-primary"
                  type="button"
                  :disabled="!canRefineDraft"
                  @click="refineDraft"
                >
                  {{ isFeedbackRunning ? "优化中..." : "反馈优化" }}
                </button>
                <button
                  v-if="agentRunning"
                  class="btn-secondary"
                  type="button"
                  @click="abortAgent"
                >
                  {{ abortAgentLabel }}
                </button>
              </div>
          </div>
            <div v-if="isFeedbackRunning" class="creation-feedback__status">
              <span class="creation-feedback__dot" aria-hidden="true" />
              <strong>优化中</strong>
              <span>{{ activeFeedbackItem?.content ?? "正在处理反馈" }}</span>
            </div>
            <textarea
              v-model="feedbackText"
              class="creation-feedback__input"
              placeholder="例如：人口统计事件需要按县城级别、教育、就业拆出变量，并且放在每日发钱之前执行。"
            />
            <ul v-if="feedbackHistory.length" class="creation-feedback-history">
              <li
                v-for="item in feedbackHistory"
                :key="item.id"
                class="creation-feedback-history__item"
              >
                <span
                  class="creation-feedback-history__state"
                  :class="getFeedbackStatusClass(item.status)"
                >
                  {{ feedbackStatusLabel(item.status, item.mode) }}
                </span>
                <p>{{ item.content }}</p>
                <small v-if="item.error">{{ item.error }}</small>
              </li>
            </ul>
          </section>

          <div class="creation-result__header">
            <div>
              <span class="eyebrow">Draft</span>
              <input
                v-model="draftPreview.title"
                class="creation-inline-input creation-inline-input--title"
                aria-label="草稿标题"
              >
            </div>
            <div class="creation-result__metrics">
              <span>链式 {{ eventTypeSummary.chain }}</span>
              <span>事件池 {{ eventTypeSummary.pool }}</span>
              <span>定时 {{ eventTypeSummary.schedule }}</span>
              <span v-if="phoneDraftCount">手机 {{ phoneDraftCount }}</span>
              <span v-if="doingDraftCount">行动 {{ doingDraftCount }}</span>
              <span v-if="shopDraftCount">商城 {{ shopDraftCount }}</span>
            </div>
          </div>

          <div class="creation-apply-bar">
            <div class="creation-apply-bar__copy">
              <strong>已选 {{ selectedApplyCount }} 项</strong>
              <span>{{ applyPreviewMessage }}</span>
            </div>
            <div class="creation-apply-bar__actions">
              <button
                class="btn-secondary"
                type="button"
                :disabled="applying || !agentResult"
                @click="resetEditableDraft"
              >
                重置草稿
              </button>
              <button
                class="btn-primary"
                :class="{ 'btn-primary--success': draftApplied }"
                type="button"
                :disabled="!canApplyDraft"
                @click="applyDraft"
              >
                {{ applyButtonLabel }}
              </button>
            </div>
          </div>

          <div v-if="draftApplied && applyMessage" class="creation-apply-success" role="status">
            <strong>应用成功</strong>
            <span>{{ applyMessage }}</span>
          </div>

          <ul v-if="applyWarnings.length" class="creation-apply-warnings">
            <li v-for="warning in applyWarnings" :key="warning">
              {{ warning }}
            </li>
          </ul>

          <label class="creation-edit-field">
            <span>摘要</span>
            <textarea v-model="draftPreview.summary" class="creation-edit-textarea" rows="2" />
          </label>
          <label class="creation-edit-field">
            <span>篇章</span>
            <input v-model="draftPreview.arc" class="creation-edit-input">
          </label>

          <div class="creation-result__grid">
            <section class="creation-result__section">
              <h4 class="creation-result__section-title">Agent 日志</h4>
              <ul class="creation-log-list">
                <li
                  v-for="log in agentLogs"
                  :key="log.role"
                  class="creation-log-list__item"
                >
                  <strong>{{ log.title }}</strong>
                  <span>{{ log.summary }}</span>
                </li>
              </ul>
            </section>

            <StoryCreationAssetDraftPreview :controller="controller" :story="story" />

            <StoryCreationPhoneDraftPreview :controller="controller" />

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">行动资产</h4>

              <template v-if="draftPreview.doing && doingDraftCount > 0">
                <div v-if="draftPreview.doing.menus.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">行动菜单</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="menu in draftPreview.doing.menus"
                      :key="menu.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedDoingMenuIds.includes(menu.id)"
                          @change="handleDoingMenuSelectionChange(menu.id, $event)"
                        >
                      </label>
                      <strong>{{ menu.id }} · {{ menu.title }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getDoingMenuImpact(menu))"
                        :title="getDoingMenuImpact(menu).detail"
                      >
                        {{ getDoingMenuImpact(menu).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>标题</span>
                        <input v-model="menu.title" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>父级菜单</span>
                        <input v-model="menu.parent_id" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>显示条件</span>
                        <input v-model="menu.visible_expr" class="creation-edit-input">
                      </label>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.doing.doings.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">行动事件</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="doing in draftPreview.doing.doings"
                      :key="doing.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedDoingIds.includes(doing.id)"
                          @change="handleDoingSelectionChange(doing.id, $event)"
                        >
                      </label>
                      <strong>{{ doing.id }} · {{ doing.title }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getDoingImpact(doing))"
                        :title="getDoingImpact(doing).detail"
                      >
                        {{ getDoingImpact(doing).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>所属菜单</span>
                        <input v-model="doing.menu_id" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>显示条件</span>
                        <input v-model="doing.visible_expr" class="creation-edit-input">
                      </label>
                      <div class="creation-event-edit-grid">
                        <label class="creation-edit-field">
                          <span>冷却小时</span>
                          <input v-model.number="doing.cooldown_hours" class="creation-edit-input" min="0" type="number">
                        </label>
                        <label class="creation-item-flags__check">
                          <input v-model="doing.once" type="checkbox">
                          一次性
                        </label>
                      </div>
                      <label class="creation-edit-field">
                        <span>开场脚本</span>
                        <textarea v-model="doing.init_script" class="creation-edit-textarea" rows="2" />
                      </label>
                      <label class="creation-edit-field">
                        <span>结束脚本</span>
                        <textarea v-model="doing.end_script" class="creation-edit-textarea" rows="2" />
                      </label>
                      <small class="creation-result__muted">
                        {{ getDoingPresentationSummary(doing) }} / 地点 {{ doing.location || "无" }}
                      </small>
                    </li>
                  </ul>
                </div>
              </template>

              <p v-else class="creation-result__muted">未生成行动资产。</p>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">商城资产</h4>

              <template v-if="draftPreview.shop && shopDraftCount > 0">
                <div v-if="draftPreview.shop.categories.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">商城分类</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="category in draftPreview.shop.categories"
                      :key="category.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedShopCategoryIds.includes(category.id)"
                          @change="handleShopCategorySelectionChange(category.id, $event)"
                        >
                      </label>
                      <strong>{{ category.id }} · {{ category.name }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getShopCategoryImpact(category))"
                        :title="getShopCategoryImpact(category).detail"
                      >
                        {{ getShopCategoryImpact(category).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>名称</span>
                        <input v-model="category.name" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>显示条件</span>
                        <input v-model="category.visible_expr" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>说明</span>
                        <textarea v-model="category.descr" class="creation-edit-textarea" rows="2" />
                      </label>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.shop.products.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">商城商品</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="product in draftPreview.shop.products"
                      :key="product.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedShopProductIds.includes(product.id)"
                          @change="handleShopProductSelectionChange(product.id, $event)"
                        >
                      </label>
                      <strong>{{ product.id }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getShopProductImpact(product))"
                        :title="getShopProductImpact(product).detail"
                      >
                        {{ getShopProductImpact(product).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>商城分类</span>
                        <input v-model="product.category_id" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>物品 id</span>
                        <input v-model="product.item_id" class="creation-edit-input">
                      </label>
                      <div class="creation-event-edit-grid">
                        <label class="creation-edit-field">
                          <span>价格</span>
                          <input v-model.number="product.price" class="creation-edit-input" min="0" type="number">
                        </label>
                        <label class="creation-edit-field">
                          <span>数量</span>
                          <input v-model.number="product.quantity" class="creation-edit-input" min="1" type="number">
                        </label>
                        <label class="creation-edit-field">
                          <span>送礼好感</span>
                          <input v-model.number="product.gift_favor_delta" class="creation-edit-input" min="-100" max="100" type="number">
                        </label>
                      </div>
                      <label class="creation-edit-field">
                        <span>购买条件</span>
                        <input v-model="product.available_expr" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>不可购买原因</span>
                        <input v-model="product.unavailable_reason" class="creation-edit-input">
                      </label>
                      <div class="creation-item-flags">
                        <label class="creation-item-flags__check">
                          <input v-model="product.enabled" type="checkbox">
                          启用
                        </label>
                        <label class="creation-item-flags__check">
                          <input v-model="product.allow_gift" type="checkbox">
                          可送礼
                        </label>
                      </div>
                      <small class="creation-result__muted">
                        {{ getDraftOrExistingShopCategoryName(product.category_id) }} / {{ getDraftOrExistingItemName(product.item_id) }} / 冷却 {{ product.purchase_cooldown_hours }}h / 送礼 {{ product.gift_cooldown_hours }}h
                      </small>
                    </li>
                  </ul>
                </div>
              </template>

              <p v-else class="creation-result__muted">未生成商城资产。</p>
            </section>
          </div>

          <section class="creation-result__section creation-result__section--events">
            <h4 class="creation-result__section-title">事件草稿</h4>
            <ul class="creation-event-list">
              <li
                v-for="event in draftPreview.events"
                :key="`${event.collectionType}:${event.id}`"
                class="creation-event-list__item"
              >
                <label class="creation-select creation-select--event">
                  <input
                    type="checkbox"
                    :checked="selectedEventKeys.includes(getEventKey(event))"
                    @change="handleEventSelectionChange(event, $event)"
                  >
                </label>
                <div class="creation-event-list__head">
                  <input
                    v-model="event.title"
                    class="creation-inline-input"
                    aria-label="事件标题"
                  >
                  <div class="creation-event-list__badges">
                    <span>
                      {{ collectionTypeLabel(event.collectionType) }} /
                      {{ triggerModeLabel(event.trigger_mode) }} /
                      {{ getPresentationLabel(event) }}
                    </span>
                    <span
                      class="creation-impact"
                      :class="getImpactClass(getEventImpact(event))"
                      :title="getEventImpact(event).detail"
                    >
                      {{ getEventImpact(event).label }}
                    </span>
                  </div>
                </div>
                <code>{{ event.id }}</code>
                <div class="creation-event-edit-grid">
                  <label class="creation-edit-field">
                    <span>地点</span>
                    <input v-model="event.location" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>触发</span>
                    <select v-model="event.trigger_mode" class="creation-edit-input">
                      <option value="default">默认触发</option>
                      <option value="condition">条件触发</option>
                      <option value="invoke">调用触发</option>
                    </select>
                  </label>
                  <label
                    v-if="event.trigger_mode === 'condition'"
                    class="creation-edit-field creation-event-edit-grid__wide"
                  >
                    <span>条件表达式</span>
                    <textarea v-model="event.trigger_expr" class="creation-edit-textarea" rows="2" />
                  </label>
                </div>
                <div
                  v-if="event.collectionType === 'schedule'"
                  class="creation-event-edit-grid"
                >
                  <label class="creation-edit-field">
                    <span>执行时间</span>
                    <input
                      class="creation-edit-input"
                      type="time"
                      step="60"
                      :value="getScheduleAt(event)"
                      @input="setScheduleAt(event, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                  <label class="creation-edit-field">
                    <span>优先级</span>
                    <input
                      class="creation-edit-input"
                      type="number"
                      step="1"
                      :value="getSchedulePriority(event)"
                      @input="setSchedulePriority(event, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                  <label class="creation-edit-field creation-event-edit-grid__wide">
                    <span>前置事件 after</span>
                    <input
                      class="creation-edit-input"
                      :value="getScheduleAfterText(event)"
                      @input="setScheduleAfterText(event, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                </div>
                <label
                  v-if="event.presentation.type === 'dialogue' && event.presentation.dialogues[0]"
                  class="creation-edit-field"
                >
                  <span>首句对白</span>
                  <textarea v-model="event.presentation.dialogues[0].content" class="creation-edit-textarea" rows="3" />
                </label>
                <div
                  v-else-if="event.presentation.type === 'message'"
                  class="creation-event-edit-grid"
                >
                  <label class="creation-edit-field">
                    <span>提示消息</span>
                    <textarea
                      v-model="event.presentation.message.content"
                      class="creation-edit-textarea"
                      rows="3"
                    />
                  </label>
                  <label class="creation-edit-field">
                    <span>显示秒数</span>
                    <input
                      v-model.number="event.presentation.message.duration_seconds"
                      class="creation-edit-input"
                      min="0"
                      step="0.5"
                      type="number"
                    >
                  </label>
                </div>
                <p v-else>
                  {{
                    event.presentation.type === "silent"
                      ? "静默执行：只运行脚本和后续推进。"
                      : "无对白预览"
                  }}
                </p>
                <div class="creation-event-edit-grid">
                  <label class="creation-edit-field">
                    <span>开场脚本</span>
                    <textarea v-model="event.init_script" class="creation-edit-textarea" rows="3" />
                  </label>
                  <label class="creation-edit-field">
                    <span>结束脚本</span>
                    <textarea v-model="event.end_script" class="creation-edit-textarea" rows="3" />
                  </label>
                </div>
                <div class="creation-event-list__meta">
                  <span v-if="event.location">地点 {{ event.location }}</span>
                  <span v-if="event.object_keys.length">对象 {{ event.object_keys.join(", ") }}</span>
                  <span v-if="event.next.length">后续 {{ event.next.join(", ") }}</span>
                </div>
                <ul v-if="getEventApplyWarnings(event).length" class="creation-event-warnings">
                  <li v-for="warning in getEventApplyWarnings(event)" :key="warning">
                    {{ warning }}
                  </li>
                </ul>
              </li>
            </ul>
          </section>

          <section
            v-if="draftPreview.notes.length || draftPreview.warnings.length"
            class="creation-result__section creation-result__section--notes"
          >
            <h4 class="creation-result__section-title">说明和告警</h4>
            <ul class="creation-note-list">
              <li v-for="note in draftPreview.notes" :key="`note:${note}`">
                {{ note }}
              </li>
              <li
                v-for="warning in draftPreview.warnings"
                :key="`warning:${warning}`"
                class="creation-note-list__warning"
              >
                {{ warning }}
              </li>
            </ul>
          </section>
        </div>

        <div v-else class="creation-results__empty">
          {{ agentRunning ? "正在等待多 Agent 返回结构化草稿..." : "输入创作指令后可运行后台创作 Agent。" }}
        </div>
      </section>
</template>

<style scoped src="./styles/StoryCreationWorkspace.part1.css"></style>
<style scoped src="./styles/StoryCreationWorkspace.part2.css"></style>
