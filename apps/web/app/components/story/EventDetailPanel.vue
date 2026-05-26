<script setup lang="ts">
import { reactive } from "vue"
import type { StoryEventFile } from "@story-mgr/core"

interface EventDraft {
  id: string
  title: string
  kind: string
  body: string
  nextText: string
}

const props = defineProps<{
  event: StoryEventFile | null
  mode?: "create" | "edit"
  parentEventId?: string | null
  saving: boolean
}>()

const emit = defineEmits<{
  save: [event: StoryEventFile]
}>()

const draft = reactive<EventDraft>({
  id: "",
  title: "",
  kind: "",
  body: "",
  nextText: ""
})

function syncDraft(event: StoryEventFile | null) {
  draft.id = event?.id ?? ""
  draft.title = event?.title ?? ""
  draft.kind = event?.kind ?? ""
  draft.body = event?.body ?? ""
  draft.nextText = event?.next.join("\n") ?? ""
}

function submitDraft() {
  if (!props.event) {
    return
  }

  emit("save", {
    ...props.event,
    id: draft.id.trim(),
    title: draft.title.trim(),
    kind: draft.kind.trim(),
    body: draft.body.trim() || undefined,
    next: draft.nextText
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
  })
}

const panelEyebrow = computed(() => {
  return props.mode === "create" ? "新事件" : "事件编辑"
})

const panelTitle = computed(() => {
  if (draft.title.trim()) {
    return draft.title.trim()
  }

  return props.mode === "create" ? "未命名事件" : (props.event?.title ?? "事件")
})

const submitLabel = computed(() => {
  if (props.saving) {
    return props.mode === "create" ? "创建中..." : "保存中..."
  }

  return props.mode === "create" ? "创建事件" : "保存事件"
})

watch(
  () => props.event,
  (event) => {
    syncDraft(event)
  },
  { immediate: true }
)
</script>

<template>
  <section class="detail-panel glass-panel">
    <template v-if="event">
      <div class="detail-panel__header">
        <div>
          <span class="eyebrow">{{ panelEyebrow }}</span>
          <h2 class="detail-panel__title">{{ panelTitle }}</h2>
        </div>
        <button class="btn-primary" type="button" :disabled="saving" @click="submitDraft">
          {{ submitLabel }}
        </button>
      </div>

      <div class="detail-panel__form">
        <label class="field">
          <span class="field-label">事件 ID</span>
          <input
            v-model="draft.id"
            class="text-input"
            type="text"
            :readonly="props.mode !== 'create'"
          />
          <span v-if="props.mode !== 'create'" class="detail-panel__hint">
            事件 ID 当前为只读，后续可以再补充安全重命名能力。
          </span>
          <span v-else class="detail-panel__hint">请为新节点填写一个唯一的事件 ID。</span>
        </label>

        <p v-if="props.mode === 'create' && props.parentEventId" class="detail-panel__callout">
          这个新节点会从 <code>{{ props.parentEventId }}</code> 连出。
        </p>
        <p v-else-if="props.mode === 'create'" class="detail-panel__callout">
          这个新节点会作为一个没有父节点的根事件创建。
        </p>

        <div class="detail-panel__row">
          <label class="field">
            <span class="field-label">标题</span>
            <input v-model="draft.title" class="text-input" type="text" />
          </label>

          <label class="field">
            <span class="field-label">类型</span>
            <input v-model="draft.kind" class="text-input" type="text" />
          </label>
        </div>

        <label class="field">
          <span class="field-label">正文</span>
          <textarea v-model="draft.body" class="text-area detail-panel__body" />
        </label>

        <label class="field">
          <span class="field-label">后续事件 ID</span>
          <textarea
            v-model="draft.nextText"
            class="text-area detail-panel__links"
            placeholder="每行一个事件 ID，或使用逗号分隔多个 ID"
          />
        </label>
      </div>
    </template>

    <div v-else class="detail-panel__empty">请先在画布中选择一个事件再开始编辑。</div>
  </section>
</template>

<style scoped>
.detail-panel {
  padding: 22px;
}

.detail-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.detail-panel__title {
  margin: 14px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.8rem;
}

.detail-panel__form {
  display: grid;
  gap: 18px;
}

.detail-panel__row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}

.detail-panel__body {
  min-height: 200px;
}

.detail-panel__links {
  min-height: 120px;
}

.detail-panel__empty {
  display: grid;
  place-items: center;
  min-height: 360px;
  border: 1px dashed var(--line);
  border-radius: 18px;
  color: var(--text-muted);
  text-align: center;
}

.detail-panel :deep(.text-input),
.detail-panel :deep(.text-area) {
  background: rgba(255, 255, 255, 0.04);
}

.detail-panel__hint {
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.5;
}

.detail-panel__callout {
  margin: -6px 0 2px;
  padding: 12px 14px;
  border: 1px solid rgba(124, 227, 195, 0.32);
  border-radius: 14px;
  background: rgba(124, 227, 195, 0.08);
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .detail-panel__header {
    flex-direction: column;
    align-items: stretch;
  }

  .detail-panel__row {
    grid-template-columns: 1fr;
  }
}
</style>
