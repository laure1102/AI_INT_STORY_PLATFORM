<script setup lang="ts">
/** AI 创作工作区门面：保持原 props/emits，页面状态由独立控制器维护。 */
import StoryCreationResults from "./StoryCreationResults.vue"
import {
  useStoryCreationWorkspace,
  type StoryCreationWorkspaceEmits,
  type StoryCreationWorkspaceProps
} from "./useStoryCreationWorkspace"

const props = defineProps<StoryCreationWorkspaceProps>()
const emit = defineEmits<StoryCreationWorkspaceEmits>()
const controller = useStoryCreationWorkspace(props, emit)
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
  <section class="creation-workspace">
    <div class="creation-workspace__main">
      <div class="creation-workspace__head">
        <div>
          <span class="eyebrow">创作</span>
          <h2 class="creation-workspace__title">AI 生成剧情</h2>
        </div>

        <div class="creation-workspace__head-actions">
          <button
            class="btn-secondary creation-history__toggle"
            type="button"
            @click="creationHistoryExpanded = !creationHistoryExpanded"
          >
            创作记录 {{ historySessionCount }}
          </button>
          <div class="creation-workspace__status">
            <span class="creation-workspace__status-label">Agent 模型</span>
            <strong>{{ agentModelSummary }}</strong>
          </div>
        </div>
      </div>

      <section class="creation-command-panel">
        <div v-if="draftPreview" class="creation-command-panel__head">
          <div>
            <span class="eyebrow">New</span>
            <strong>新剧情创作</strong>
          </div>
          <button
            class="btn-secondary"
            type="button"
            @click="newCreationExpanded = !newCreationExpanded"
          >
            {{ showNewCreationForm ? "收起" : "新建创作" }}
          </button>
        </div>

        <template v-if="showNewCreationForm">
          <label class="creation-command">
            <span class="creation-command__label">创作指令</span>
            <textarea
              v-model="commandText"
              class="creation-command__input"
              placeholder="例如：围绕县城第一天暴富后的舆论发酵，生成一组可玩的事件、地点和角色。"
            />
          </label>

          <div class="creation-actions">
            <button
              class="btn-primary"
              type="button"
              :disabled="!canRunAgent"
              @click="runAgent"
            >
              {{ isNewCreationRunning ? "运行中..." : "运行 Agent" }}
            </button>
            <button
              v-if="agentRunning"
              class="btn-secondary"
              type="button"
              @click="emit('abortAgent')"
            >
              中止当前任务
            </button>
            <span class="creation-actions__status">{{ runStatus }}</span>
          </div>
        </template>
      </section>

      <section v-if="creationHistoryExpanded" class="creation-history">
        <div class="creation-history__head">
          <strong>创作记录</strong>
          <span>{{ historySessionCount }} 次创作</span>
        </div>
        <ul v-if="historySessions.length" class="creation-history__list">
          <li
            v-for="session in historySessions"
            :key="session.id"
            class="creation-history__item"
            :class="{ 'creation-history__item--active': activeHistorySessionId === session.id }"
          >
            <button type="button" class="creation-history__button" @click="restoreHistorySession(session)">
              <span
                class="creation-history__status"
                :class="historyStatusClass(session.status)"
              >
                {{ historyStatusLabel(session.status) }}
              </span>
              <span class="creation-history__content">
                <strong>{{ session.title || "未命名创作" }}</strong>
                <span>{{ session.initialInstruction }}</span>
              </span>
              <span class="creation-history__meta">
                {{ formatHistoryTime(session.updatedAt) }} · {{ session.turns.length }} 轮
              </span>
            </button>
            <button
              type="button"
              class="creation-history__delete"
              :disabled="saving || (agentRunning && activeHistorySessionId === session.id)"
              @click="deleteHistorySession(session)"
            >
              删除
            </button>
          </li>
        </ul>
        <p v-else class="creation-history__empty">还没有创作记录。</p>
      </section>

      <div class="creation-pipeline">
        <div
          v-for="step in pipelineSteps"
          :key="step.role"
          class="creation-pipeline__step"
          :class="{
            'creation-pipeline__step--active': agentRunning && activeAgentRole === step.role,
            'creation-pipeline__step--done': loggedRoles.has(step.role)
          }"
        >
          <span>{{ step.label }}</span>
        </div>
      </div>

      <StoryCreationResults
        :agent-running="agentRunning"
        :agent-result="agentResult"
        :applying="applying"
        :apply-message="applyMessage"
        :apply-warnings="applyWarnings"
        :controller="controller"
        :story="story"
      />
    </div>

    <aside class="creation-workspace__bible">
      <div class="story-bible__header">
        <div>
          <span class="eyebrow">Bible</span>
          <h2 class="story-bible__title">创作设定</h2>
        </div>

        <div class="story-bible__counter">
          {{ filledBibleFieldCount }} / {{ bibleFields.length }}
        </div>
      </div>

      <div class="story-bible__tabs" role="tablist" aria-label="创作设定">
        <button
          v-for="field in bibleFields"
          :key="field.key"
          class="story-bible__tab"
          :class="{ 'story-bible__tab--active': activeBibleField === field.key }"
          type="button"
          role="tab"
          :aria-selected="activeBibleField === field.key"
          @click="activeBibleField = field.key"
        >
          {{ field.label }}
        </button>
      </div>

      <label v-if="activeBibleFieldConfig" class="story-bible__editor">
        <span class="story-bible__label">{{ activeBibleFieldConfig.label }}</span>
        <textarea
          v-model="draft[activeBibleFieldConfig.key]"
          class="story-bible__textarea"
          :placeholder="activeBibleFieldConfig.placeholder"
        />
      </label>

      <div class="story-bible__actions">
        <button class="btn-primary" type="button" :disabled="saving" @click="submitStoryBible">
          {{ saving ? "保存中..." : "保存设定" }}
        </button>
      </div>
    </aside>
  </section>
</template>

<style scoped src="./styles/StoryCreationWorkspace.part1.css"></style>
<style scoped src="./styles/StoryCreationWorkspace.part2.css"></style>
