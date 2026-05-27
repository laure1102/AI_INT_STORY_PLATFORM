<script setup lang="ts">
import type { AppSettingsFile } from "@story-mgr/core"

interface AppSettingsDraft {
  imageApiKey: string
  imageBaseUrl: string
  imageModel: string
  textApiKey: string
  textBaseUrl: string
  textModel: string
}

const props = defineProps<{
  saving: boolean
  settings: AppSettingsFile
}>()

const emit = defineEmits<{
  close: []
  save: [settings: AppSettingsFile]
}>()

const draft = reactive<AppSettingsDraft>({
  imageApiKey: "",
  imageBaseUrl: "",
  imageModel: "",
  textApiKey: "",
  textBaseUrl: "",
  textModel: ""
})

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function syncDraft(settings: AppSettingsFile) {
  draft.imageApiKey = normalizeText(settings.ai.image.apiKey)
  draft.imageBaseUrl = normalizeText(settings.ai.image.baseUrl)
  draft.imageModel = normalizeText(settings.ai.image.model)
  draft.textApiKey = normalizeText(settings.ai.text.apiKey)
  draft.textBaseUrl = normalizeText(settings.ai.text.baseUrl)
  draft.textModel = normalizeText(settings.ai.text.model)
}

function submitDraft() {
  emit("save", {
    ai: {
      image: {
        apiKey: draft.imageApiKey.trim(),
        baseUrl: draft.imageBaseUrl.trim(),
        model: draft.imageModel.trim()
      },
      text: {
        apiKey: draft.textApiKey.trim(),
        baseUrl: draft.textBaseUrl.trim(),
        model: draft.textModel.trim()
      }
    }
  })
}

watch(
  () => props.settings,
  (settings) => {
    syncDraft(settings)
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <div class="settings-dialog">
      <section class="settings-dialog__panel glass-panel">
        <div class="settings-dialog__header">
          <div>
            <span class="eyebrow">设置</span>
            <h2 class="settings-dialog__title">AI 全局设置</h2>
          </div>

          <div class="settings-dialog__actions">
            <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
            <button class="btn-primary" type="button" :disabled="saving" @click="submitDraft">
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>

        <div class="settings-dialog__body">
          <div class="settings-dialog__group">
            <h3 class="settings-dialog__group-title">文生</h3>
            <label class="settings-dialog__field">
              <span class="settings-dialog__label">baseUrl</span>
              <input
                v-model="draft.textBaseUrl"
                class="text-input"
                type="text"
                placeholder="https://api.example.com/v1"
              />
            </label>

            <label class="settings-dialog__field">
              <span class="settings-dialog__label">apiKey</span>
              <input v-model="draft.textApiKey" class="text-input" type="password" placeholder="sk-..." />
            </label>

            <label class="settings-dialog__field">
              <span class="settings-dialog__label">模型</span>
              <input v-model="draft.textModel" class="text-input" type="text" placeholder="gpt-4.1-mini" />
            </label>
          </div>

          <div class="settings-dialog__group">
            <h3 class="settings-dialog__group-title">图生</h3>
            <label class="settings-dialog__field">
              <span class="settings-dialog__label">baseUrl</span>
              <input
                v-model="draft.imageBaseUrl"
                class="text-input"
                type="text"
                placeholder="https://api.example.com/v1"
              />
            </label>

            <label class="settings-dialog__field">
              <span class="settings-dialog__label">apiKey</span>
              <input v-model="draft.imageApiKey" class="text-input" type="password" placeholder="sk-..." />
            </label>

            <label class="settings-dialog__field">
              <span class="settings-dialog__label">模型</span>
              <input v-model="draft.imageModel" class="text-input" type="text" placeholder="gpt-image-1" />
            </label>
          </div>
        </div>

        <div class="settings-dialog__actions settings-dialog__actions--footer">
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
.settings-dialog {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.settings-dialog__panel {
  width: min(840px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: auto;
  border-radius: 22px;
}

.settings-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.settings-dialog__title,
.settings-dialog__group-title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
  line-height: 1.1;
}

.settings-dialog__body {
  display: grid;
  gap: 14px;
  margin-top: 18px;
}

.settings-dialog__group {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.settings-dialog__field {
  display: grid;
  gap: 6px;
}

.settings-dialog__label {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.settings-dialog__actions {
  display: flex;
  gap: 8px;
}

.settings-dialog__actions--footer {
  margin-top: 16px;
  justify-content: flex-end;
}

@media (max-width: 900px) {
  .settings-dialog__header,
  .settings-dialog__actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
