<script setup lang="ts">
interface LocationOption {
  label: string
  value: string
}

const props = defineProps<{
  options: LocationOption[]
}>()

const model = defineModel<string>({ required: true })

const emit = defineEmits<{
  quickCreate: []
}>()
</script>

<template>
  <label class="field">
    <div class="story-event-location-field__label-row">
      <span class="field-label">地点</span>
      <button
        class="btn-secondary story-event-location-field__button"
        type="button"
        @click="emit('quickCreate')"
      >
        创建地点
      </button>
    </div>

    <select v-model="model" class="select-input">
      <option value="">不设置地点</option>
      <option
        v-for="location in props.options"
        :key="location.value"
        :value="location.value"
      >
        {{ location.label }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.story-event-location-field__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.story-event-location-field__button {
  min-height: 30px;
  padding: 0 12px;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .story-event-location-field__label-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
