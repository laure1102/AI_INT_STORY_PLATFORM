<script setup lang="ts">
/** 故事编辑器页面门面：保留 storyId 属性，具体业务由独立控制器组合。 */
import type { StoryLoopEventFile, StoryOnceEventFile } from "@story-mgr/core"
import { useStoryEditorShell, type StoryEditorShellProps } from "./useStoryEditorShell"

const props = defineProps<StoryEditorShellProps>()
const controller = useStoryEditorShell(props)
const {
  projectStore, isAgentRunning, isCreationDraftApplying, creationAgentResult,
  creationAgentRunMode, creationAgentError, creationApplyMessage, creationApplyWarnings,
  creationHistory, activeCreationHistorySessionId, editingEventId, creatingFromEventId,
  creatingEventDraft, scenesSaveSuccessMessage, locationsSaveSuccessMessage, itemsSaveSuccessMessage,
  shopSaveSuccessMessage, contactSaveSuccessMessage, contactConversationsSaveErrorMessage, contactConversationsSaveSuccessMessage,
  referSaveSuccessMessage, doingSaveSuccessMessage, rolesSaveSuccessMessage, activeWorkspaceTab,
  workspaceTabOptions, selectedEventId, selectedEvent, editingEvent,
  activeDraftEvent, activeGraphParentNodeId, activeGraphDraftEvent, activeGraphDraftAction,
  graphNodeOptions, storyScriptVals, storyScriptItemIds, contactInvokeEventOptions,
  buildGraphEventBranchAutocompleteItemsFromActions, activeGraphBranchAutocompleteItems, isCreateMode, replaceEventInDocument,
  removeEventFromDocument, refreshValidation, closeEditor, openValsDialog,
  closeValsDialog, openPlayerOverrideValsDialog, closePlayerOverrideValsDialog, openSystemValsDialog,
  closeSystemValsDialog, openScenesDialog, closeScenesDialog, openLocationsDialog,
  closeLocationsDialog, openItemsDialog, closeItemsDialog, openShopDialog,
  closeShopDialog, openContactDialog, closeContactDialog, openReferDialog,
  closeReferDialog, openRolesDialog, closeRolesDialog, openSettingsDialog,
  closeSettingsDialog, openGameSettingsDialog, closeGameSettingsDialog, createHistoryId,
  getActiveCreationHistorySession, upsertLocalCreationHistorySession, persistCreationHistorySession, createCreationHistorySession,
  handleRestoreCreationHistorySession, buildRunningCreationHistoryTurn, settleCreationHistoryTurn, completeCreationRun,
  handleDeleteCreationHistorySession, loadStory, handleSelectEvent, handleEditEvent,
  sanitizeIdSegment, createUniqueEventId, buildNewEventFromParent, buildNewActionFromParent,
  buildNewRootEvent, buildNewStandaloneEvent, handleCreateGraphEvent, handleCreateGraphAction,
  handleCreateGraphRootEvent, handleCreateStandaloneEvent, handleSwitchEventTab, handleSwitchWorkspaceTab,
  handleDeleteGraphNode, handleSaveEvent, handleDeleteEvent, handleSaveVals,
  handleSaveSystemVals, handleSavePlayerOverrideVals, handleSaveScenes, handleSaveEventLocations,
  handleSaveItems, handleSaveShop, handleSaveContact, handleSaveContactConversations,
  handleSaveRefer, handleSaveDoing, handleSaveRoles, handleQuickCreateRole,
  handleQuickCreateLocation, handleSaveStoryBible, handleRunCreationAgent, resumePendingCreationTask,
  handleAbortCreationAgent, isAbortError, selectAppliedEvent, handleApplyCreationDraft,
  handleSaveAppSettings, handleSaveStoryMeta, handleToggleLink, handleExport,
  issueKey, applyStoryCreationDraft, deleteEvent, exportStory,
  getAppSettings, getStoryCreationHistory, getStory, deleteStoryCreationHistorySession,
  saveAppSettings, saveEvent, saveEventLocations, saveDoing,
  saveStoryMeta, saveStoryCreationHistorySession, saveItems, saveContact,
  saveContactConversations, saveRefer, saveShop, savePlayerOverrideVals,
  saveRoles, saveScenes, saveStoryBible, saveSystemVals,
  saveVals, validateStory, creationJob, cancelCreationTask,
  resumeCreationTask, runCreationTask, appSettings, errorMessage,
  exportPath, isExporting, isLoading, isSaving,
  issueSummary, storyDocument, validation, activeEventTab,
  activeEventTabLabel, activeEvents, activeGraphEvents, activeLoopEvents,
  activeOnceEvents, eventTabOptions, eventTriggerFilter, eventTriggerFilterOptions,
  filteredGraphCanvasEvents, filteredLoopCanvasEvents, filteredOnceCanvasEvents, getEventsByCollectionType,
  getGraphNodes, isEventCanvasTab, isGraphActionNode, isGraphEventNode,
  normalizeEventTriggerMode, closeAllTools, isValsDialogOpen, isPlayerOverrideValsDialogOpen,
  isSystemValsDialogOpen, isScenesDialogOpen, isLocationsDialogOpen, isItemsDialogOpen,
  isShopDialogOpen, isContactDialogOpen, isReferDialogOpen, isRolesDialogOpen,
  isSettingsDialogOpen, isGameSettingsDialogOpen
} = controller
</script>

<template>
  <main class="page-shell page-shell--editor fade-up">
    <div class="editor-header">
      <div class="editor-header__copy">
        <NuxtLink class="editor-header__back" to="/">返回剧情列表</NuxtLink>
        <h1 class="editor-header__title">
          {{ storyDocument?.story.title || "正在加载剧情..." }}
        </h1>
        <div class="editor-header__tools" aria-label="故事配置入口">
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openValsDialog">
            全局变量
          </button>
          <button
            class="btn-secondary editor-header__tool-button"
            type="button"
            @click="openPlayerOverrideValsDialog"
          >
            玩家覆盖变量
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openSystemValsDialog">
            系统变量
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openScenesDialog">
            场景
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openLocationsDialog">
            地点
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openItemsDialog">
            物品
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openShopDialog">
            商城
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openContactDialog">
            联系人
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openReferDialog">
            称谓
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openRolesDialog">
            角色
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openSettingsDialog">
            设置
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openGameSettingsDialog">
            游戏设置
          </button>
        </div>
      </div>

      <div class="editor-header__actions">
        <button class="btn-secondary" type="button" :disabled="isLoading" @click="loadStory">
          重新加载剧情
        </button>
        <button class="btn-primary" type="button" :disabled="isExporting" @click="handleExport">
          {{ isExporting ? "导出中..." : "导出运行时 JSON" }}
        </button>
      </div>
    </div>

    <div v-if="errorMessage" class="editor-banner editor-banner--error">
      {{ errorMessage }}
    </div>

    <div v-if="exportPath" class="editor-banner">
      运行时数据已导出到 {{ exportPath }}
    </div>

    <div v-if="storyDocument" class="editor-workspace-tabs" role="tablist" aria-label="故事工作区">
      <button
        v-for="tab in workspaceTabOptions"
        :key="tab.key"
        class="editor-workspace-tabs__button"
        :class="{ 'editor-workspace-tabs__button--active': activeWorkspaceTab === tab.key }"
        type="button"
        role="tab"
        :aria-selected="activeWorkspaceTab === tab.key"
        @click="handleSwitchWorkspaceTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <section v-if="activeWorkspaceTab === 'events' || (isLoading && !storyDocument)" class="editor-main">
      <div class="editor-validation-row">
        <div class="editor-status glass-panel">
          <div>
            <span class="eyebrow">校验</span>
            <h2 class="section-title">
              {{ issueSummary.errorCount }} 个错误 / {{ issueSummary.warningCount }} 个警告
            </h2>
          </div>
          <div class="editor-status__actions">
            <button class="btn-secondary" type="button" @click="refreshValidation">
              重新校验
            </button>
          </div>
        </div>

        <section class="issues glass-panel">
          <div class="issues__head">
            <h2 class="section-title">校验结果</h2>
          </div>

          <ul v-if="validation?.issues.length" class="issues__list">
            <li
              v-for="(issue, index) in validation.issues"
              :key="issueKey(issue, index)"
              class="issues__item"
              :class="`issues__item--${issue.level}`"
            >
              <strong>{{ issue.code }}</strong>
              <span>{{ issue.message }}</span>
              <code>{{ issue.path.join(" / ") }}</code>
            </li>
          </ul>
          <p v-else class="muted">未发现结构问题。</p>
        </section>
      </div>

      <p v-if="isLoading && !storyDocument" class="muted">正在加载剧情数据...</p>
    </section>

    <LazyStoryCreationWorkspace
      v-if="storyDocument && activeWorkspaceTab === 'creation'"
      :agent-result="creationAgentResult"
      :creation-job="creationJob"
      :agent-run-mode="creationAgentRunMode"
      :agent-running="isAgentRunning"
      :agent-error="creationAgentError"
      :apply-message="creationApplyMessage"
      :apply-warnings="creationApplyWarnings"
      :applying="isCreationDraftApplying"
      :creation-history="creationHistory"
      :active-history-session-id="activeCreationHistorySessionId"
      :settings="appSettings"
      :saving="isSaving"
      :story="storyDocument"
      @apply-draft="handleApplyCreationDraft"
      @abort-agent="handleAbortCreationAgent"
      @delete-history-session="handleDeleteCreationHistorySession"
      @restore-history-session="handleRestoreCreationHistorySession"
      @run-agent="handleRunCreationAgent"
      @save-story-bible="handleSaveStoryBible"
    />

    <section v-if="storyDocument && activeWorkspaceTab === 'events'" class="editor-canvas-band">
      <div class="editor-event-tabs">
        <div class="editor-event-tabs__tablist" role="tablist" aria-label="剧情事件类型">
          <button
            v-for="tab in eventTabOptions"
            :key="tab.key"
            class="editor-event-tabs__button"
            :class="{ 'editor-event-tabs__button--active': activeEventTab === tab.key }"
            type="button"
            role="tab"
            :aria-selected="activeEventTab === tab.key"
            @click="handleSwitchEventTab(tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>

        <div v-if="isEventCanvasTab(activeEventTab)" class="editor-trigger-filter" role="group" aria-label="触发方式筛选">
          <span class="editor-trigger-filter__label">触发</span>
          <button
            v-for="option in eventTriggerFilterOptions"
            :key="option.key"
            class="editor-trigger-filter__button"
            :class="{ 'editor-trigger-filter__button--active': eventTriggerFilter === option.key }"
            type="button"
            @click="eventTriggerFilter = option.key"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <LazyStoryGraphCanvas
        v-if="activeEventTab === 'chain'"
        :events="filteredGraphCanvasEvents"
        :selected-event-id="selectedEventId"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @delete="handleDeleteGraphNode"
        @create="handleCreateGraphEvent"
        @create-action="handleCreateGraphAction"
        @create-root="handleCreateGraphRootEvent"
        @toggle-link="handleToggleLink"
      />

      <LazyStoryOnceCanvas
        v-else-if="activeEventTab === 'pool'"
        :events="filteredOnceCanvasEvents"
        :selected-event-id="selectedEventId"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @delete="handleDeleteEvent"
        @create="handleCreateStandaloneEvent"
      />

      <LazyStoryLoopEventCanvas
        v-else-if="activeEventTab === 'schedule'"
        :events="filteredLoopCanvasEvents"
        :selected-event-id="selectedEventId"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @delete="handleDeleteEvent"
        @create="handleCreateStandaloneEvent"
      />

      <LazyStoryDoingDialog
        v-else-if="activeEventTab === 'doing'"
        embedded
        :doing="storyDocument.doing"
        :item-ids="storyScriptItemIds"
        :roles="storyDocument.roles"
        :save-success-message="doingSaveSuccessMessage"
        :saving="isSaving"
        :story="storyDocument"
        :vals="storyScriptVals"
        @quick-create-location="handleQuickCreateLocation"
        @quick-create-role="handleQuickCreateRole"
        @save="handleSaveDoing"
      />

      <LazyStoryContactConversationsDialog
        v-else-if="activeEventTab === 'contact-conversations'"
        embedded
        :invoke-event-options="contactInvokeEventOptions"
        :contact-conversations="storyDocument.contactConversations"
        :roles="storyDocument.roles"
        :save-error-message="contactConversationsSaveErrorMessage"
        :save-success-message="contactConversationsSaveSuccessMessage"
        :saving="isSaving"
        :story="storyDocument"
        :vals="storyScriptVals"
        @save="handleSaveContactConversations"
      />
    </section>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="storyDocument && activeWorkspaceTab === 'events' && isEventCanvasTab(activeEventTab) && (editingEvent || creatingEventDraft)"
          class="editor-modal"
          @click.self="closeEditor"
        >
          <div class="editor-modal__panel">
            <LazyGraphEventDetailPanel
              v-if="activeEventTab === 'chain' && activeGraphDraftEvent"
              :event="activeGraphDraftEvent"
              :branch-autocomplete-items="activeGraphBranchAutocompleteItems"
              :event-locations="storyDocument.eventLocations"
              :graph-node-options="graphNodeOptions"
              :mode="isCreateMode ? 'create' : 'edit'"
              :parent-event-id="activeGraphParentNodeId"
              :roles="storyDocument.roles"
              :saving="isSaving"
              :item-ids="storyScriptItemIds"
              :story="storyDocument"
              :vals="storyScriptVals"
              @close="closeEditor"
              @quick-create-location="handleQuickCreateLocation"
              @quick-create-role="handleQuickCreateRole"
              @save="handleSaveEvent"
            />
            <LazyGraphActionDetailPanel
              v-else-if="activeEventTab === 'chain' && activeGraphDraftAction"
              :action="activeGraphDraftAction"
              :graph-node-options="graphNodeOptions"
              :mode="isCreateMode ? 'create' : 'edit'"
              :saving="isSaving"
              :story="storyDocument"
              :vals="storyScriptVals"
              @close="closeEditor"
              @save="handleSaveEvent"
            />
            <LazyOnceEventDetailPanel
              v-else-if="activeEventTab === 'pool'"
              :event="activeDraftEvent as StoryOnceEventFile | null"
              :event-locations="storyDocument.eventLocations"
              :mode="isCreateMode ? 'create' : 'edit'"
              :roles="storyDocument.roles"
              :saving="isSaving"
              :scenes="storyDocument.scenes"
              :item-ids="storyScriptItemIds"
              :story="storyDocument"
              :vals="storyScriptVals"
              @close="closeEditor"
              @quick-create-location="handleQuickCreateLocation"
              @quick-create-role="handleQuickCreateRole"
              @save="handleSaveEvent"
            />
            <LazyLoopEventDetailPanel
              v-else
              :event="activeDraftEvent as StoryLoopEventFile | null"
              :event-locations="storyDocument.eventLocations"
              :mode="isCreateMode ? 'create' : 'edit'"
              :roles="storyDocument.roles"
              :saving="isSaving"
              :scenes="storyDocument.scenes"
              :schedule-events="storyDocument.scheduleEvents"
              :item-ids="storyScriptItemIds"
              :story="storyDocument"
              :vals="storyScriptVals"
              @close="closeEditor"
              @quick-create-location="handleQuickCreateLocation"
              @quick-create-role="handleQuickCreateRole"
              @save="handleSaveEvent"
            />
          </div>
        </div>
      </Transition>
    </Teleport>

    <LazyStoryValsDialog
      v-if="storyDocument && isValsDialogOpen"
      :saving="isSaving"
      :vals="storyDocument.vals"
      @close="closeValsDialog"
      @save="handleSaveVals"
    />

    <LazyStoryValsDialog
      v-if="storyDocument && isSystemValsDialogOpen"
      eyebrow="系统变量"
      title="系统变量设置"
      :saving="isSaving"
      :vals="storyDocument.systemVals"
      @close="closeSystemValsDialog"
      @save="handleSaveSystemVals"
    />

    <LazyStoryPlayerOverrideValsDialog
      v-if="storyDocument && isPlayerOverrideValsDialogOpen"
      :player-override-vals="storyDocument.playerOverrideVals"
      :saving="isSaving"
      :vals="storyDocument.vals"
      @close="closePlayerOverrideValsDialog"
      @save="handleSavePlayerOverrideVals"
    />

    <LazyStoryScenesDialog
      v-if="storyDocument && isScenesDialogOpen"
      :save-success-message="scenesSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :scenes="storyDocument.scenes"
      @close="closeScenesDialog"
      @save="handleSaveScenes"
    />

    <LazyStoryLocationsDialog
      v-if="storyDocument && isLocationsDialogOpen"
      :event-locations="storyDocument.eventLocations"
      :save-success-message="locationsSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :story-title="storyDocument.story.title"
      @close="closeLocationsDialog"
      @save="handleSaveEventLocations"
    />

    <LazyStoryItemsDialog
      v-if="storyDocument && isItemsDialogOpen"
      :items="storyDocument.items"
      :save-success-message="itemsSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :story-title="storyDocument.story.title"
      @close="closeItemsDialog"
      @save="handleSaveItems"
    />

    <LazyStoryShopDialog
      v-if="storyDocument && isShopDialogOpen"
      :items="storyDocument.items"
      :save-success-message="shopSaveSuccessMessage"
      :saving="isSaving"
      :shop="storyDocument.shop"
      :story="storyDocument"
      :vals="storyScriptVals"
      @close="closeShopDialog"
      @save="handleSaveShop"
    />

    <LazyStoryContactDialog
      v-if="storyDocument && isContactDialogOpen"
      :item-ids="storyScriptItemIds"
      :invoke-event-options="contactInvokeEventOptions"
      :contact="storyDocument.contact"
      :roles="storyDocument.roles"
      :save-success-message="contactSaveSuccessMessage"
      :saving="isSaving"
      :story="storyDocument"
      :vals="storyScriptVals"
      @close="closeContactDialog"
      @save="handleSaveContact"
    />

    <LazyStoryReferDialog
      v-if="storyDocument && isReferDialogOpen"
      :refer="storyDocument.refer"
      :save-success-message="referSaveSuccessMessage"
      :saving="isSaving"
      @close="closeReferDialog"
      @save="handleSaveRefer"
    />

    <LazyStoryRolesDialog
      v-if="storyDocument && isRolesDialogOpen"
      :contact="storyDocument.contact"
      :roles="storyDocument.roles"
      :save-success-message="rolesSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :story-title="storyDocument.story.title"
      @close="closeRolesDialog"
      @save="handleSaveRoles"
    />

    <LazyAppSettingsDialog
      v-if="appSettings && isSettingsDialogOpen"
      :saving="isSaving"
      :settings="appSettings"
      @close="closeSettingsDialog"
      @save="handleSaveAppSettings"
    />

    <LazyStoryGameSettingsDialog
      v-if="storyDocument && isGameSettingsDialogOpen"
      :saving="isSaving"
      :story="storyDocument.story"
      @close="closeGameSettingsDialog"
      @save="handleSaveStoryMeta"
    />
  </main>
</template>

<style scoped src="./styles/StoryEditorShell.css"></style>
