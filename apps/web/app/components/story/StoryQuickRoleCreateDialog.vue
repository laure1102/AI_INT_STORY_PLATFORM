<script setup lang="ts">
import type { StoryRoleScope, StoryRolesFile } from "@story-mgr/core"
import {
  buildQuickCreateRolePayload,
  hasQuickRoleNameConflict,
  sanitizeQuickRoleNameInput
} from "./storyQuickRole"

const props = defineProps<{
  roles: StoryRolesFile
  saving?: boolean
}>()

const emit = defineEmits<{
  close: []
  create: [payload: {
    descr: string
    mingzi: string
    name: string
    qufenXingbie: boolean
    roleKey: string
    scope: StoryRoleScope
    zhiye: string
  }]
}>()

const nameInputRef = useTemplateRef<HTMLInputElement>("nameInput")

const draft = reactive({
  descr: "",
  mingzi: "",
  name: "",
  qufenXingbie: false,
  scope: "normal" as StoryRoleScope,
  zhiye: ""
})

const sanitizedName = computed(() => sanitizeQuickRoleNameInput(draft.name))
const isImportantRole = computed(() => draft.scope === "important")
const hasNameConflict = computed(() => {
  return hasQuickRoleNameConflict(props.roles, draft.scope, sanitizedName.value)
})
const nameError = computed(() => {
  if (!draft.name.trim()) {
    return "请填写名称"
  }

  if (!sanitizedName.value) {
    return "名称会自动规范成英文/数字/下划线"
  }

  if (hasNameConflict.value) {
    return isImportantRole.value ? "重要角色里已有同名角色" : "普通角色里已有同名角色"
  }

  return ""
})
const canSubmit = computed(() => !nameError.value && !props.saving)

watch(
  () => draft.scope,
  (scope) => {
    if (scope !== "important") {
      draft.qufenXingbie = false
    }
  }
)

onMounted(() => {
  nameInputRef.value?.focus()
})

function submit() {
  if (!canSubmit.value) {
    return
  }

  const payload = buildQuickCreateRolePayload({
    descr: draft.descr,
    mingzi: draft.mingzi,
    name: draft.name,
    qufenXingbie: draft.qufenXingbie,
    scope: draft.scope,
    zhiye: draft.zhiye
  })

  if (!payload) {
    return
  }

  emit("create", payload)
}
</script>

<template>
  <div class="quick-role-dialog" @click.self="emit('close')">
    <section class="quick-role-dialog__panel glass-panel">
      <div class="quick-role-dialog__header">
        <div>
          <span class="eyebrow">快捷创建</span>
          <h3 class="quick-role-dialog__title">创建角色</h3>
        </div>
        <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
      </div>

      <div class="quick-role-dialog__body">
        <fieldset class="quick-role-dialog__scope">
          <legend class="quick-role-dialog__label">角色类型</legend>
          <label class="quick-role-dialog__scope-option">
            <input v-model="draft.scope" type="radio" value="normal" />
            <span>普通角色</span>
          </label>
          <label class="quick-role-dialog__scope-option">
            <input v-model="draft.scope" type="radio" value="important" />
            <span>重要角色</span>
          </label>
        </fieldset>

        <label v-if="isImportantRole" class="quick-role-dialog__field">
          <span class="quick-role-dialog__label">区分性别</span>
          <label class="quick-role-dialog__checkbox">
            <input v-model="draft.qufenXingbie" type="checkbox" />
            <span>开启</span>
          </label>
        </label>

        <label class="quick-role-dialog__field">
          <span class="quick-role-dialog__label">名称</span>
          <input
            ref="nameInput"
            v-model="draft.name"
            class="text-input"
            type="text"
            placeholder="villager_old_man"
          />
          <span v-if="sanitizedName" class="quick-role-dialog__hint">
            保存为：{{ sanitizedName }}
          </span>
          <span v-if="nameError" class="quick-role-dialog__error">
            {{ nameError }}
          </span>
        </label>

        <label class="quick-role-dialog__field">
          <span class="quick-role-dialog__label">名字</span>
          <input
            v-model="draft.mingzi"
            class="text-input"
            type="text"
            placeholder="老孙"
          />
        </label>

        <label class="quick-role-dialog__field">
          <span class="quick-role-dialog__label">职业</span>
          <input
            v-model="draft.zhiye"
            class="text-input"
            type="text"
            placeholder="算命先生"
          />
        </label>

        <label class="quick-role-dialog__field">
          <span class="quick-role-dialog__label">描述</span>
          <textarea
            v-model="draft.descr"
            class="text-area quick-role-dialog__textarea"
            placeholder="用于快速登记角色，不生成提示词和图片"
          />
        </label>
      </div>

      <div class="quick-role-dialog__footer">
        <button class="btn-secondary" type="button" @click="emit('close')">取消</button>
        <button class="btn-primary" type="button" :disabled="!canSubmit" @click="submit">
          {{ saving ? "保存中..." : "保存" }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.quick-role-dialog {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.quick-role-dialog__panel {
  width: min(560px, calc(100vw - 40px));
  padding: 20px;
  border-radius: 22px;
  display: grid;
  gap: 18px;
}

.quick-role-dialog__header,
.quick-role-dialog__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.quick-role-dialog__title {
  margin: 8px 0 0;
  font-size: 1.2rem;
}

.quick-role-dialog__body {
  display: grid;
  gap: 14px;
}

.quick-role-dialog__scope {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0;
  padding: 0;
  border: none;
  min-width: 0;
  flex-wrap: wrap;
}

.quick-role-dialog__scope-option,
.quick-role-dialog__checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
}

.quick-role-dialog__field {
  display: grid;
  gap: 8px;
}

.quick-role-dialog__label {
  color: var(--text-muted);
  font-size: 0.84rem;
}

.quick-role-dialog__hint {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.quick-role-dialog__error {
  color: #ff8f8f;
  font-size: 0.8rem;
}

.quick-role-dialog__textarea {
  min-height: 120px;
}

.quick-role-dialog__footer {
  justify-content: flex-end;
}

.quick-role-dialog :deep(.text-input),
.quick-role-dialog :deep(.text-area) {
  background: rgba(255, 255, 255, 0.04);
}

@media (max-width: 720px) {
  .quick-role-dialog {
    padding: 10px;
  }

  .quick-role-dialog__header,
  .quick-role-dialog__footer {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
