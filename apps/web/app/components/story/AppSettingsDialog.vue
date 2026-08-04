<script setup lang="ts">
import type { AppSettingsFile } from "@story-mgr/core"

interface AppSettingsDraft {
  imageApiKey: string
  imageBaseUrl: string
  imageModel: string
  textApiKey: string
  textBaseUrl: string
  textModel: string
  agentApiKey: string
  agentBaseUrl: string
  chiefEditorModel: string
  plotPlannerModel: string
  assetDesignerModel: string
  eventWriterModel: string
  scriptDoctorModel: string
  consistencyCheckerModel: string
  agentTemperatureText: string
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
  textModel: "",
  agentApiKey: "",
  agentBaseUrl: "",
  chiefEditorModel: "",
  plotPlannerModel: "",
  assetDesignerModel: "",
  eventWriterModel: "",
  scriptDoctorModel: "",
  consistencyCheckerModel: "",
  agentTemperatureText: "0.7"
})

/** 将 `Text` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

/** 将 `Temperature` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeTemperature(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0.7"
}

/** 解析 `Temperature` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function parseTemperature(value: string) {
  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    return 0.7
  }

  return Math.max(0, Math.min(2, parsedValue))
}

/** 把外部设置同步到本地响应式草稿。 @param settings 当前应用设置。 @returns 无返回值；原地更新 draft。 */
function syncDraft(settings: AppSettingsFile) {
  draft.imageApiKey = normalizeText(settings.ai.image.apiKey)
  draft.imageBaseUrl = normalizeText(settings.ai.image.baseUrl)
  draft.imageModel = normalizeText(settings.ai.image.model)
  draft.textApiKey = normalizeText(settings.ai.text.apiKey)
  draft.textBaseUrl = normalizeText(settings.ai.text.baseUrl)
  draft.textModel = normalizeText(settings.ai.text.model)
  draft.agentApiKey = normalizeText(settings.ai.agent.apiKey)
  draft.agentBaseUrl = normalizeText(settings.ai.agent.baseUrl)
  draft.chiefEditorModel = normalizeText(settings.ai.agent.chiefEditorModel)
  draft.plotPlannerModel = normalizeText(settings.ai.agent.plotPlannerModel)
  draft.assetDesignerModel = normalizeText(settings.ai.agent.assetDesignerModel)
  draft.eventWriterModel = normalizeText(settings.ai.agent.eventWriterModel)
  draft.scriptDoctorModel = normalizeText(settings.ai.agent.scriptDoctorModel)
  draft.consistencyCheckerModel = normalizeText(settings.ai.agent.consistencyCheckerModel)
  draft.agentTemperatureText = normalizeTemperature(settings.ai.agent.temperature)
}

/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
      },
      agent: {
        apiKey: draft.agentApiKey.trim(),
        baseUrl: draft.agentBaseUrl.trim(),
        chiefEditorModel: draft.chiefEditorModel.trim(),
        plotPlannerModel: draft.plotPlannerModel.trim(),
        assetDesignerModel: draft.assetDesignerModel.trim(),
        eventWriterModel: draft.eventWriterModel.trim(),
        scriptDoctorModel: draft.scriptDoctorModel.trim(),
        consistencyCheckerModel: draft.consistencyCheckerModel.trim(),
        temperature: parseTemperature(draft.agentTemperatureText)
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

          <div class="settings-dialog__group">
            <h3 class="settings-dialog__group-title">创作 Agent</h3>
            <div class="settings-dialog__grid">
              <label class="settings-dialog__field">
                <span class="settings-dialog__label">baseUrl</span>
                <input
                  v-model="draft.agentBaseUrl"
                  class="text-input"
                  type="text"
                  placeholder="https://api.example.com/v1"
                />
              </label>

              <label class="settings-dialog__field">
                <span class="settings-dialog__label">apiKey</span>
                <input v-model="draft.agentApiKey" class="text-input" type="password" placeholder="sk-..." />
              </label>
            </div>

            <div class="settings-dialog__grid settings-dialog__grid--agents">
              <label class="settings-dialog__field">
                <span class="settings-dialog__label">主编 Agent</span>
                <input v-model="draft.chiefEditorModel" class="text-input" type="text" placeholder="gpt-5.4-mini" />
              </label>

              <label class="settings-dialog__field">
                <span class="settings-dialog__label">规划 Agent</span>
                <input v-model="draft.plotPlannerModel" class="text-input" type="text" placeholder="gpt-5.4-mini" />
              </label>

              <label class="settings-dialog__field">
                <span class="settings-dialog__label">资产 Agent</span>
                <input v-model="draft.assetDesignerModel" class="text-input" type="text" placeholder="gpt-5.4-mini" />
              </label>

              <label class="settings-dialog__field">
                <span class="settings-dialog__label">事件 Agent</span>
                <input v-model="draft.eventWriterModel" class="text-input" type="text" placeholder="gpt-5.4-mini" />
              </label>

              <label class="settings-dialog__field">
                <span class="settings-dialog__label">审校 Agent</span>
                <input v-model="draft.scriptDoctorModel" class="text-input" type="text" placeholder="gpt-5.4-mini" />
              </label>

              <label class="settings-dialog__field">
                <span class="settings-dialog__label">一致性 Agent</span>
                <input
                  v-model="draft.consistencyCheckerModel"
                  class="text-input"
                  type="text"
                  placeholder="gpt-5.4-mini"
                />
              </label>
            </div>

            <label class="settings-dialog__field settings-dialog__field--narrow">
              <span class="settings-dialog__label">temperature</span>
              <input
                v-model="draft.agentTemperatureText"
                class="text-input"
                type="number"
                min="0"
                max="2"
                step="0.1"
                placeholder="0.7"
              />
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

.settings-dialog__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.settings-dialog__grid--agents {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.settings-dialog__field--narrow {
  max-width: 220px;
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

  .settings-dialog__grid,
  .settings-dialog__grid--agents {
    grid-template-columns: 1fr;
  }

  .settings-dialog__field--narrow {
    max-width: none;
  }
}
</style>
