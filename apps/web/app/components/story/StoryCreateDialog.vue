<script setup lang="ts">
import type { CreateStoryRequest } from "@story-mgr/shared"

interface StoryCreateDraft {
  id: string
  title: string
  description: string
  tagsText: string
}

const props = defineProps<{
  existingStoryIds: string[]
  saving: boolean
}>()

const emit = defineEmits<{
  close: []
  create: [payload: CreateStoryRequest]
}>()

const draft = reactive<StoryCreateDraft>({
  id: "",
  title: "",
  description: "",
  tagsText: ""
})
const isIdTouched = shallowRef(false)

const normalizedExistingStoryIds = computed(() => {
  return new Set(props.existingStoryIds.map((storyId) => storyId.trim().toLowerCase()))
})

const normalizedId = computed(() => draft.id.trim().toLowerCase())

const tags = computed(() => {
  return Array.from(
    new Set(
      draft.tagsText
        .split(/[,，\s]+/g)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  )
})

const idError = computed(() => {
  if (!normalizedId.value) {
    return "请填写故事 id。"
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalizedId.value)) {
    return "只能使用小写字母、数字、下划线、短横线，并且以字母或数字开头。"
  }

  if (normalizedExistingStoryIds.value.has(normalizedId.value)) {
    return "这个故事 id 已经存在。"
  }

  return ""
})

const titleError = computed(() => {
  return draft.title.trim() ? "" : "请填写故事名称。"
})

const canSubmit = computed(() => {
  return !props.saving && !titleError.value && !idError.value
})

function slugifyStoryId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function handleIdInput() {
  isIdTouched.value = true
  draft.id = normalizedId.value
}

function submitDraft() {
  if (!canSubmit.value) {
    return
  }

  emit("create", {
    id: normalizedId.value,
    title: draft.title.trim(),
    description: draft.description.trim() || undefined,
    tags: tags.value.length > 0 ? tags.value : undefined
  })
}

watch(
  () => draft.title,
  (title) => {
    if (isIdTouched.value) {
      return
    }

    draft.id = slugifyStoryId(title)
  }
)
</script>

<template>
  <Teleport to="body">
    <div class="story-create-dialog">
      <section class="story-create-dialog__panel glass-panel">
        <div class="story-create-dialog__header">
          <div>
            <span class="eyebrow">新建故事</span>
            <h2 class="story-create-dialog__title">创建故事骨架</h2>
          </div>

          <button class="btn-secondary" type="button" :disabled="saving" @click="emit('close')">
            关闭
          </button>
        </div>

        <form class="story-create-dialog__body" @submit.prevent="submitDraft">
          <label class="story-create-dialog__field">
            <span class="story-create-dialog__label">故事名称</span>
            <input
              v-model="draft.title"
              class="text-input"
              type="text"
              placeholder="例如：重生县城首富"
              autocomplete="off"
            />
            <span v-if="titleError" class="story-create-dialog__hint story-create-dialog__hint--error">
              {{ titleError }}
            </span>
          </label>

          <label class="story-create-dialog__field">
            <span class="story-create-dialog__label">故事 id</span>
            <input
              v-model="draft.id"
              class="text-input"
              type="text"
              placeholder="例如：county-tycoon"
              autocomplete="off"
              @input="handleIdInput"
            />
            <span class="story-create-dialog__hint" :class="{ 'story-create-dialog__hint--error': idError }">
              {{ idError || "会作为 data/stories 下的目录名。" }}
            </span>
          </label>

          <label class="story-create-dialog__field">
            <span class="story-create-dialog__label">简介</span>
            <textarea
              v-model="draft.description"
              class="text-area story-create-dialog__textarea"
              placeholder="可以先写一句故事基调，后面也能继续补。"
            />
          </label>

          <label class="story-create-dialog__field">
            <span class="story-create-dialog__label">标签</span>
            <input
              v-model="draft.tagsText"
              class="text-input"
              type="text"
              placeholder="县城, 神豪, 经营"
              autocomplete="off"
            />
          </label>

          <div class="story-create-dialog__actions">
            <button class="btn-secondary" type="button" :disabled="saving" @click="emit('close')">
              取消
            </button>
            <button class="btn-primary" type="submit" :disabled="!canSubmit">
              {{ saving ? "创建中..." : "创建故事" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.story-create-dialog {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.story-create-dialog__panel {
  width: min(620px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: auto;
  border-radius: 22px;
}

.story-create-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.story-create-dialog__title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
  line-height: 1.1;
}

.story-create-dialog__body {
  display: grid;
  gap: 14px;
  margin-top: 18px;
}

.story-create-dialog__field {
  display: grid;
  gap: 6px;
}

.story-create-dialog__label {
  color: var(--text-muted);
  font-size: 0.86rem;
}

.story-create-dialog__hint {
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.5;
}

.story-create-dialog__hint--error {
  color: var(--warning);
}

.story-create-dialog__textarea {
  min-height: 96px;
}

.story-create-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

@media (max-width: 700px) {
  .story-create-dialog__header,
  .story-create-dialog__actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
