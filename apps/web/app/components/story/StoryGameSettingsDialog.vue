<script setup lang="ts">
import type { StoryMetaFile } from "@story-mgr/core"

interface GameSettingsDraft {
  startTime: string
}

const props = defineProps<{
  saving: boolean
  story: StoryMetaFile
}>()

const emit = defineEmits<{
  close: []
  save: [story: StoryMetaFile]
}>()

const draft = reactive<GameSettingsDraft>({
  startTime: "00:00"
})

const validationMessage = shallowRef<string | null>(null)

/** 将 `StartTime` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeStartTime(value: unknown) {
  if (typeof value !== "string") {
    return "00:00"
  }

  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "00:00"
}

/** 把外部或服务端数据同步到本地响应式状态。 @param story 调用方传入的 `story`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(story: StoryMetaFile) {
  draft.startTime = normalizeStartTime(story.game_settings?.start_time)
  validationMessage.value = null
}

/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function submitDraft() {
  const startTime = normalizeStartTime(draft.startTime)
  if (startTime !== draft.startTime) {
    validationMessage.value = "开始时间必须是 HH:mm 格式。"
    return
  }

  validationMessage.value = null
  emit("save", {
    ...props.story,
    game_settings: {
      ...props.story.game_settings,
      start_time: startTime
    }
  })
}

watch(
  () => props.story,
  (story) => {
    syncDraft(story)
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <div class="game-settings-dialog">
      <section class="game-settings-dialog__panel glass-panel">
        <div class="game-settings-dialog__header">
          <div>
            <span class="eyebrow">游戏设置</span>
            <h2 class="game-settings-dialog__title">运行时初始化</h2>
          </div>

          <div class="game-settings-dialog__actions">
            <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
            <button class="btn-primary" type="button" :disabled="saving" @click="submitDraft">
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>

        <div class="game-settings-dialog__body">
          <label class="game-settings-dialog__field">
            <span class="game-settings-dialog__label">开始时间</span>
            <input v-model="draft.startTime" class="text-input" type="time" step="60" />
            <span class="game-settings-dialog__hint">新建游戏时从第 1 天这个时间开始。</span>
          </label>

          <div v-if="validationMessage" class="game-settings-dialog__error">
            {{ validationMessage }}
          </div>
        </div>

        <div class="game-settings-dialog__actions game-settings-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
          <button class="btn-primary" type="button" :disabled="saving" @click="submitDraft">
            {{ saving ? "保存中..." : "保存" }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.game-settings-dialog {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.game-settings-dialog__panel {
  width: min(520px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: auto;
  border-radius: 22px;
}

.game-settings-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.game-settings-dialog__title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
  line-height: 1.1;
}

.game-settings-dialog__body {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.game-settings-dialog__field {
  display: grid;
  gap: 6px;
}

.game-settings-dialog__label {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.game-settings-dialog__hint {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.game-settings-dialog__error {
  padding: 10px 12px;
  border: 1px solid rgba(248, 113, 113, 0.34);
  border-radius: 12px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.24);
  font-size: 0.84rem;
}

.game-settings-dialog__actions {
  display: flex;
  gap: 8px;
}

.game-settings-dialog__actions--footer {
  margin-top: 16px;
  justify-content: flex-end;
}

@media (max-width: 640px) {
  .game-settings-dialog__header,
  .game-settings-dialog__actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
