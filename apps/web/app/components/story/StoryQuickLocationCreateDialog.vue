<script setup lang="ts">
import type { StoryEventLocationFile } from "@story-mgr/core"
import {
  buildQuickCreateLocationPayload,
  hasQuickLocationNameConflict,
  sanitizeQuickLocationNameInput
} from "./storyQuickLocation"

const props = defineProps<{
  eventLocations: StoryEventLocationFile
  saving?: boolean
}>()

const emit = defineEmits<{
  close: []
  create: [payload: {
    descr: string
    name: string
  }]
}>()

const nameInputRef = useTemplateRef<HTMLInputElement>("nameInput")

const draft = reactive({
  descr: "",
  name: ""
})

const sanitizedName = computed(() => sanitizeQuickLocationNameInput(draft.name))
const hasNameConflict = computed(() => {
  return hasQuickLocationNameConflict(props.eventLocations, sanitizedName.value)
})
const nameError = computed(() => {
  if (!draft.name.trim()) {
    return "请填写名称"
  }

  if (!sanitizedName.value) {
    return "名称会自动规范成英文/数字/下划线"
  }

  if (hasNameConflict.value) {
    return "地点里已有同名条目"
  }

  return ""
})
const canSubmit = computed(() => !nameError.value && !props.saving)

onMounted(() => {
  nameInputRef.value?.focus()
})

function submit() {
  if (!canSubmit.value) {
    return
  }

  const payload = buildQuickCreateLocationPayload({
    descr: draft.descr,
    name: draft.name
  })

  if (!payload) {
    return
  }

  emit("create", payload)
}
</script>

<template>
  <div class="quick-location-dialog" @click.self="emit('close')">
    <section class="quick-location-dialog__panel glass-panel">
      <div class="quick-location-dialog__header">
        <div>
          <span class="eyebrow">快捷创建</span>
          <h3 class="quick-location-dialog__title">创建地点</h3>
        </div>
        <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
      </div>

      <div class="quick-location-dialog__body">
        <label class="quick-location-dialog__field">
          <span class="quick-location-dialog__label">名称</span>
          <input
            ref="nameInput"
            v-model="draft.name"
            class="text-input"
            type="text"
            placeholder="street_market"
          />
          <span v-if="sanitizedName" class="quick-location-dialog__hint">
            保存为：{{ sanitizedName }}
          </span>
          <span v-if="nameError" class="quick-location-dialog__error">
            {{ nameError }}
          </span>
        </label>

        <label class="quick-location-dialog__field">
          <span class="quick-location-dialog__label">描述</span>
          <textarea
            v-model="draft.descr"
            class="text-area quick-location-dialog__textarea"
            placeholder="用于快速登记地点，不生成提示词和图片"
          />
        </label>
      </div>

      <div class="quick-location-dialog__footer">
        <button class="btn-secondary" type="button" @click="emit('close')">取消</button>
        <button class="btn-primary" type="button" :disabled="!canSubmit" @click="submit">
          {{ saving ? "保存中..." : "保存" }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.quick-location-dialog {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.quick-location-dialog__panel {
  width: min(520px, calc(100vw - 40px));
  padding: 20px;
  border-radius: 22px;
  display: grid;
  gap: 18px;
}

.quick-location-dialog__header,
.quick-location-dialog__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.quick-location-dialog__title {
  margin: 8px 0 0;
  font-size: 1.2rem;
}

.quick-location-dialog__body {
  display: grid;
  gap: 14px;
}

.quick-location-dialog__field {
  display: grid;
  gap: 8px;
}

.quick-location-dialog__label {
  color: var(--text-muted);
  font-size: 0.84rem;
}

.quick-location-dialog__hint {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.quick-location-dialog__error {
  color: #ff8f8f;
  font-size: 0.8rem;
}

.quick-location-dialog__textarea {
  min-height: 140px;
}

.quick-location-dialog__footer {
  justify-content: flex-end;
}

.quick-location-dialog :deep(.text-input),
.quick-location-dialog :deep(.text-area) {
  background: rgba(255, 255, 255, 0.04);
}

@media (max-width: 720px) {
  .quick-location-dialog {
    padding: 10px;
  }

  .quick-location-dialog__header,
  .quick-location-dialog__footer {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
