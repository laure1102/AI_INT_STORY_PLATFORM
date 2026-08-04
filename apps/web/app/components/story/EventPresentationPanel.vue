<script setup lang="ts">
/**
 * 事件表现区：统一编辑“静默、短消息、对白”三种客户端表现。
 *
 * 输入来自事件面板控制器，修改会直接写回同一份响应式草稿；保存和校验仍由父面板负责。
 * 本组件只处理表现方式与对白列表，不负责对白弹窗、StoryScript 或事件提交。
 */
import type { GraphEventEditorController } from "./useGraphEventEditor"
import type { LoopEventEditorController } from "./useLoopEventEditor"
import type { OnceEventEditorController } from "./useOnceEventEditor"

type EventEditorController =
  | GraphEventEditorController
  | LoopEventEditorController
  | OnceEventEditorController

const { controller } = defineProps<{ controller: EventEditorController }>()
const {
  draft,
  moveDialogue,
  openCreateDialogueEditor,
  openDialogueAiDialog,
  openEditDialogueEditor,
  removeDialogue,
  roleOptionMap
} = controller
</script>

<template>
  <aside class="detail-panel__dialogue-card">
    <div class="detail-panel__dialogue-head">
      <div>
        <h3 class="detail-card__title">事件表现</h3>
        <p class="detail-panel__dialogue-summary">
          {{
            draft.presentationType === "silent"
              ? "静默执行脚本，不显示客户端内容。"
              : draft.presentationType === "message"
                ? "显示一段短消息，随后自动继续。"
                : `当前 ${draft.dialogues.length} 条对白。只有右侧列表会滚动。`
          }}
        </p>
      </div>
      <div v-if="draft.presentationType === 'dialogue'" class="detail-panel__dialogue-head-actions">
        <button class="btn-secondary detail-panel__dialogue-add" type="button" @click="openDialogueAiDialog">
          AI 补对白
        </button>
        <button class="btn-secondary detail-panel__dialogue-add" type="button" @click="openCreateDialogueEditor">
          添加对白
        </button>
      </div>
    </div>

    <div class="detail-panel__presentation-mode">
      <label class="detail-panel__trigger-mode-option">
        <input v-model="draft.presentationType" type="radio" value="silent" />
        <span>静默执行</span>
      </label>
      <label class="detail-panel__trigger-mode-option">
        <input v-model="draft.presentationType" type="radio" value="message" />
        <span>消息提示</span>
      </label>
      <label class="detail-panel__trigger-mode-option">
        <input v-model="draft.presentationType" type="radio" value="dialogue" />
        <span>对白</span>
      </label>
    </div>

    <div v-if="draft.presentationType === 'silent'" class="detail-panel__presentation-empty">
      静默执行事件只运行初始化脚本、结束脚本和后续推进。
    </div>
    <div v-else-if="draft.presentationType === 'message'" class="detail-panel__message-fields">
      <label class="field">
        <span class="field-label">提示消息</span>
        <textarea
          v-model="draft.messageContent"
          class="text-area detail-panel__message-text"
          placeholder="昨日人口流动统计已完成。"
        />
      </label>
      <label class="field">
        <span class="field-label">显示秒数</span>
        <input v-model.number="draft.messageDurationSeconds" class="text-input" min="0" step="0.5" type="number" />
      </label>
    </div>

    <div v-else-if="draft.dialogues.length" class="dialogue-list">
      <div class="dialogue-list__table">
        <div class="dialogue-list__table-head">
          <span>排序</span><span>说话人</span><span>对白</span><span>操作</span>
        </div>
        <div v-for="(dialogue, index) in draft.dialogues" :key="dialogue.id" class="dialogue-list__row">
          <div class="dialogue-list__sort">
            <button class="btn-secondary dialogue-list__icon-btn" type="button" title="上移" :disabled="index === 0" @click="moveDialogue(dialogue.id, -1)">↑</button>
            <button class="btn-secondary dialogue-list__icon-btn" type="button" title="下移" :disabled="index === draft.dialogues.length - 1" @click="moveDialogue(dialogue.id, 1)">↓</button>
          </div>
          <div class="dialogue-list__speaker-cell">
            <span class="dialogue-list__index">{{ index + 1 }}</span>
            <span class="dialogue-list__speaker">
              {{ dialogue.speaker_type === "player" ? "主角" : (roleOptionMap.get(dialogue.speaker_key)?.label ?? dialogue.speaker_key) }}
            </span>
          </div>
          <button class="dialogue-list__content-button" type="button" @click="openEditDialogueEditor(dialogue.id)">
            <span class="dialogue-list__content">{{ dialogue.content.trim() || "点击编辑对白内容" }}</span>
          </button>
          <div class="dialogue-list__actions">
            <button class="btn-secondary dialogue-list__icon-btn" type="button" title="编辑" @click="openEditDialogueEditor(dialogue.id)">
              <svg class="dialogue-list__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.99-1.66Z" fill="currentColor" /></svg>
            </button>
            <button class="btn-secondary dialogue-list__icon-btn dialogue-list__icon-btn--danger" type="button" title="删除" @click="removeDialogue(dialogue.id)">
              <svg class="dialogue-list__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Zm-1 11h12a2 2 0 0 0 2-2V8H4v10a2 2 0 0 0 2 2Z" fill="currentColor" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="dialogue-empty">还没有对白，点击“添加对白”开始编辑。</div>
  </aside>
</template>

<style scoped src="./styles/OnceEventDetailPanel.css"></style>
