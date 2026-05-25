<script setup lang="ts">
import type { StoryEventFile } from "@story-mgr/core"

defineProps<{
  events: StoryEventFile[]
  selectedEventId: string | null
}>()

const emit = defineEmits<{
  select: [eventId: string]
}>()
</script>

<template>
  <div class="event-list">
    <button
      v-for="event in events"
      :key="event.id"
      class="event-item"
      :class="{ 'event-item--active': event.id === selectedEventId }"
      type="button"
      @click="emit('select', event.id)"
    >
      <div class="event-item__meta">
        <span>{{ event.kind }}</span>
        <span>{{ event.next.length }} links</span>
      </div>
      <strong class="event-item__title">{{ event.title }}</strong>
      <span class="event-item__id">{{ event.id }}</span>
    </button>
  </div>
</template>

<style scoped>
.event-list {
  display: grid;
  gap: 12px;
}

.event-item {
  display: grid;
  gap: 8px;
  padding: 15px 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  text-align: left;
  transition:
    border-color 160ms ease,
    transform 160ms ease,
    background 160ms ease;
}

.event-item:hover {
  transform: translateY(-1px);
  border-color: var(--line-strong);
}

.event-item--active {
  border-color: rgba(124, 227, 195, 0.72);
  background: rgba(124, 227, 195, 0.12);
}

.event-item__meta,
.event-item__id {
  color: var(--text-muted);
  font-size: 0.84rem;
}

.event-item__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.event-item__title {
  font-size: 1rem;
}
</style>
