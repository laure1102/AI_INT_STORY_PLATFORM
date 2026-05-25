<script setup lang="ts">
import type { StorySummary } from "@story-mgr/core"

defineProps<{
  stories: StorySummary[]
  selectedStoryId: string | null
}>()

const emit = defineEmits<{
  select: [storyId: string]
}>()
</script>

<template>
  <div class="story-list">
    <button
      v-for="story in stories"
      :key="story.id"
      class="story-card"
      :class="{ 'story-card--active': story.id === selectedStoryId }"
      type="button"
      @click="emit('select', story.id)"
    >
      <div class="story-card__meta">
        <span class="story-card__id">{{ story.id }}</span>
        <span class="story-card__count">{{ story.eventCount }} events</span>
      </div>
      <h3 class="story-card__title">{{ story.title }}</h3>
      <p class="story-card__description">
        {{ story.description || "还没有补充故事简介。" }}
      </p>
    </button>
  </div>
</template>

<style scoped>
.story-list {
  display: grid;
  gap: 14px;
}

.story-card {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  text-align: left;
  transition:
    border-color 160ms ease,
    transform 160ms ease,
    background 160ms ease;
}

.story-card:hover {
  transform: translateY(-2px);
  border-color: var(--line-strong);
}

.story-card--active {
  border-color: rgba(255, 180, 84, 0.7);
  background: rgba(255, 180, 84, 0.12);
}

.story-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-muted);
  font-size: 0.86rem;
}

.story-card__title {
  margin: 10px 0 8px;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.15rem;
}

.story-card__description {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.6;
}
</style>
