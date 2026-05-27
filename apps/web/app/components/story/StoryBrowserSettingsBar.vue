<script setup lang="ts">
const emit = defineEmits<{
  openSettings: []
}>()
</script>

<template>
  <div class="settings-bar">
    <button class="btn-secondary settings-bar__button" type="button" @click="emit('openSettings')">
      设置
    </button>
  </div>
</template>

<style scoped>
.settings-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.settings-bar__button {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 0.8rem;
}
</style>
