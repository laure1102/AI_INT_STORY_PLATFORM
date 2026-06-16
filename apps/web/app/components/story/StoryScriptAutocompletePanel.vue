<script setup lang="ts">
import type { StoryScriptAutocompleteItem } from "./storyScriptEditor"

const props = defineProps<{
  activeIndex: number
  emptyText?: string
  items: StoryScriptAutocompleteItem[]
  placement: "top" | "bottom"
}>()

const emit = defineEmits<{
  select: [itemName: string]
}>()

const activeItem = computed(() => {
  if (!props.items.length) {
    return null
  }

  return props.items[props.activeIndex % props.items.length] ?? null
})
</script>

<template>
  <div
    class="story-script-autocomplete"
    :class="{ 'story-script-autocomplete--top': placement === 'top' }"
  >
    <button
      v-for="(item, index) in items"
      :key="item.name"
      class="story-script-autocomplete__item"
      :class="{ 'story-script-autocomplete__item--active': index === activeIndex }"
      type="button"
      @mousedown.prevent="emit('select', item.name)"
    >
      <span class="story-script-autocomplete__name">{{ item.name }}</span>
      <span v-if="item.description" class="story-script-autocomplete__description">
        {{ item.description }}
      </span>
    </button>

    <div v-if="!items.length" class="story-script-autocomplete__empty">
      {{ emptyText ?? "没有匹配的变量" }}
    </div>

    <div
      v-if="activeItem?.detailTitle || activeItem?.detailLines?.length"
      class="story-script-autocomplete__detail"
    >
      <strong v-if="activeItem?.detailTitle" class="story-script-autocomplete__detail-title">
        {{ activeItem.detailTitle }}
      </strong>
      <ul v-if="activeItem?.detailLines?.length" class="story-script-autocomplete__detail-list">
        <li v-for="line in activeItem.detailLines" :key="line">
          {{ line }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.story-script-autocomplete {
  position: absolute;
  z-index: 35;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  display: grid;
  gap: 4px;
  max-height: 260px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid rgba(124, 227, 195, 0.24);
  border-radius: 12px;
  background: rgba(8, 19, 31, 0.98);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(14px);
}

.story-script-autocomplete--top {
  top: auto;
  bottom: calc(100% + 6px);
}

.story-script-autocomplete__item {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.story-script-autocomplete__item:hover,
.story-script-autocomplete__item--active {
  background: rgba(124, 227, 195, 0.12);
}

.story-script-autocomplete__name {
  color: var(--accent);
  font-family: "JetBrains Mono", monospace;
  font-size: 0.82rem;
}

.story-script-autocomplete__description,
.story-script-autocomplete__empty {
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.35;
}

.story-script-autocomplete__empty {
  padding: 10px;
  text-align: center;
}

.story-script-autocomplete__detail {
  display: grid;
  gap: 6px;
  margin-top: 4px;
  padding: 9px 10px;
  border-top: 1px solid rgba(186, 220, 255, 0.12);
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.45;
}

.story-script-autocomplete__detail-title {
  color: var(--text);
}

.story-script-autocomplete__detail-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}
</style>
