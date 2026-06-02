<script setup lang="ts">
import StoryRoleMultiSelect from "./StoryRoleMultiSelect.vue"

interface RoleOption {
  key: string
  label: string
}

const props = defineProps<{
  specialOptions?: RoleOption[]
  importantOptions: RoleOption[]
  normalOptions: RoleOption[]
  placeholder?: string
}>()

const model = defineModel<string[]>({ required: true })

const emit = defineEmits<{
  quickCreate: []
}>()
</script>

<template>
  <div class="field">
    <div class="story-event-object-field__label-row">
      <span class="field-label">对象</span>
      <button
        class="btn-secondary story-event-object-field__button"
        type="button"
        @click="emit('quickCreate')"
      >
        创建角色
      </button>
    </div>

    <StoryRoleMultiSelect
      v-model="model"
      :special-options="props.specialOptions ?? []"
      :important-options="importantOptions"
      :normal-options="normalOptions"
      :placeholder="props.placeholder ?? '搜索并选择对象角色'"
    />
  </div>
</template>

<style scoped>
.story-event-object-field__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.story-event-object-field__button {
  min-height: 30px;
  padding: 0 12px;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .story-event-object-field__label-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
