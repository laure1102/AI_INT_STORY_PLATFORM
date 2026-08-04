<script setup lang="ts">
import type {
  StoryEventCollectionType,
  StoryEventFile,
  StoryLoopEventFile,
  StoryOnceDialogueDefinition,
  StoryOnceEventFile,
  StoryRolesFile
} from "@story-mgr/core"
import type { GenerateStoryDialogueResponse } from "@story-mgr/shared"

type DialogueEventDraft = StoryEventFile | StoryOnceEventFile | StoryLoopEventFile

const props = defineProps<{
  errorMessage?: string | null
  event: DialogueEventDraft
  collectionType: StoryEventCollectionType
  loading: boolean
  open: boolean
  prompt: string
  result: GenerateStoryDialogueResponse | null
  roles: StoryRolesFile
}>()

const emit = defineEmits<{
  close: []
  updatePrompt: [value: string]
  run: []
  apply: [dialogues: StoryOnceDialogueDefinition[]]
  abort: []
}>()

/** 根据当前上下文解析 `SpeakerLabel`。 @param dialogue 调用方传入的 `dialogue`。 @returns 计算、查找或构建后的结果。 */
function resolveSpeakerLabel(dialogue: StoryOnceDialogueDefinition) {
  if (dialogue.speaker_type === "player") {
    return "主角"
  }

  const importantRole = props.roles.important.roles.find((role) => `important:${role.id}` === dialogue.speaker_key)
  if (importantRole) {
    return importantRole.name?.trim() || importantRole.id
  }

  const normalRole = props.roles.normal.roles.find((role) => `normal:${role.id}` === dialogue.speaker_key)
  if (normalRole) {
    return normalRole.name?.trim() || normalRole.id
  }

  return dialogue.speaker_key
}

const currentDialogueCount = computed(() => {
  return props.event.presentation.type === "dialogue"
    ? props.event.presentation.dialogues.length
    : 0
})

const canRun = computed(() => props.prompt.trim().length > 0 && !props.loading)
</script>

<template>
  <div v-if="open" class="dialogue-ai-dialog" @click.self="emit('close')">
    <section class="dialogue-ai-dialog__panel glass-panel">
      <div class="dialogue-ai-dialog__head">
        <div class="dialogue-ai-dialog__head-copy">
          <span class="eyebrow">AI 补对白</span>
          <h3 class="dialogue-ai-dialog__title">{{ event.title || event.id }}</h3>
          <p class="dialogue-ai-dialog__summary">
            当前事件已有 {{ currentDialogueCount }} 条对白。生成结果会先预览，确认后覆盖当前对白。
          </p>
        </div>
        <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
      </div>

      <label class="field dialogue-ai-dialog__field">
        <span class="field-label">提示词</span>
        <textarea
          :value="prompt"
          class="text-area dialogue-ai-dialog__prompt"
          placeholder="例如：根据当前剧情链、人物关系和县城背景，补一段更有压迫感的对峙对白，主角先克制后反击。"
          @input="emit('updatePrompt', ($event.target as HTMLTextAreaElement).value)"
        />
      </label>

      <div class="dialogue-ai-dialog__actions">
        <button
          v-if="loading"
          class="btn-secondary"
          type="button"
          @click="emit('abort')"
        >
          中止
        </button>
        <button
          class="btn-primary"
          type="button"
          :disabled="!canRun"
          @click="emit('run')"
        >
          {{ loading ? "生成中..." : "生成对白" }}
        </button>
      </div>

      <div v-if="loading" class="dialogue-ai-dialog__status">
        正在结合故事背景、事件对象和现有剧情生成对白...
      </div>

      <div v-if="errorMessage" class="dialogue-ai-dialog__error">
        {{ errorMessage }}
      </div>

      <section v-if="result" class="dialogue-ai-dialog__result">
        <div class="dialogue-ai-dialog__result-head">
          <div>
            <h4 class="dialogue-ai-dialog__result-title">生成预览</h4>
            <p class="dialogue-ai-dialog__result-summary">{{ result.summary }}</p>
          </div>
          <button
            class="btn-primary"
            type="button"
            :disabled="loading"
            @click="emit('apply', result.dialogues)"
          >
            覆盖当前对白
          </button>
        </div>

        <div class="dialogue-ai-dialog__preview-list">
          <article
            v-for="(dialogue, index) in result.dialogues"
            :key="`${index}-${dialogue.speaker_type}-${dialogue.speaker_key}`"
            class="dialogue-ai-dialog__preview-item"
          >
            <div class="dialogue-ai-dialog__preview-meta">
              <span class="dialogue-ai-dialog__preview-index">{{ index + 1 }}</span>
              <span class="dialogue-ai-dialog__preview-speaker">
                {{ resolveSpeakerLabel(dialogue) }}
              </span>
            </div>
            <p class="dialogue-ai-dialog__preview-content">{{ dialogue.content }}</p>
          </article>
        </div>

        <div v-if="result.warnings.length" class="dialogue-ai-dialog__warnings">
          <strong>提示</strong>
          <ul>
            <li v-for="warning in result.warnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>
      </section>
    </section>
  </div>
</template>

<style scoped>
.dialogue-ai-dialog {
  position: fixed;
  inset: 0;
  z-index: 75;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.dialogue-ai-dialog__panel {
  width: min(900px, calc(100vw - 32px));
  max-height: calc(100dvh - 40px);
  padding: 20px;
  display: grid;
  gap: 16px;
  overflow: auto;
}

.dialogue-ai-dialog__head,
.dialogue-ai-dialog__result-head,
.dialogue-ai-dialog__actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dialogue-ai-dialog__head-copy {
  min-width: 0;
}

.dialogue-ai-dialog__title,
.dialogue-ai-dialog__result-title {
  margin: 8px 0 0;
  font-size: 1.12rem;
}

.dialogue-ai-dialog__summary,
.dialogue-ai-dialog__result-summary {
  margin: 8px 0 0;
  color: var(--text-muted);
  line-height: 1.5;
}

.dialogue-ai-dialog__field {
  display: grid;
  gap: 8px;
}

.dialogue-ai-dialog__prompt {
  min-height: 180px;
}

.dialogue-ai-dialog__status,
.dialogue-ai-dialog__error,
.dialogue-ai-dialog__warnings {
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-muted);
  line-height: 1.5;
}

.dialogue-ai-dialog__error {
  border-color: rgba(255, 111, 111, 0.34);
  background: rgba(255, 111, 111, 0.08);
  color: #ffb1b1;
}

.dialogue-ai-dialog__result {
  display: grid;
  gap: 14px;
}

.dialogue-ai-dialog__preview-list {
  display: grid;
  gap: 10px;
}

.dialogue-ai-dialog__preview-item {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.025);
}

.dialogue-ai-dialog__preview-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dialogue-ai-dialog__preview-index {
  color: var(--text-dim);
  font-size: 0.76rem;
  font-weight: 700;
}

.dialogue-ai-dialog__preview-speaker {
  color: var(--accent);
  font-size: 0.84rem;
}

.dialogue-ai-dialog__preview-content {
  margin: 0;
  line-height: 1.55;
  white-space: pre-wrap;
}

.dialogue-ai-dialog__warnings ul {
  margin: 8px 0 0;
  padding-left: 18px;
}

@media (max-width: 900px) {
  .dialogue-ai-dialog__head,
  .dialogue-ai-dialog__result-head,
  .dialogue-ai-dialog__actions {
    flex-direction: column;
  }
}
</style>
