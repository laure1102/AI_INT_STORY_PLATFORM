<script setup lang="ts">
import type { StoryEventFile } from "@story-mgr/core"

const props = defineProps<{
  events: StoryEventFile[]
  selectedEventId: string | null
}>()

const emit = defineEmits<{
  select: [eventId: string]
  edit: [eventId: string]
  create: []
}>()

const selectedEvent = computed(() => {
  return props.events.find((event) => event.id === props.selectedEventId) ?? null
})

function handleEdit(eventId: string) {
  emit("select", eventId)
  emit("edit", eventId)
}
</script>

<template>
  <section class="big-once-board glass-panel">
    <div class="big-once-board__header">
      <div class="big-once-board__copy">
        <span class="eyebrow">大事件画布</span>
        <h2 class="section-title">一次性大事件管理</h2>
        <p class="big-once-board__summary">
          一次性大事件彼此独立，不提供连接点或连接线。
        </p>
      </div>

      <div class="big-once-board__actions">
        <span class="pill">{{ events.length }} 个事件</span>
        <button class="btn-secondary big-once-board__button" type="button" @click="emit('create')">
          创建事件
        </button>
      </div>
    </div>

    <div v-if="events.length" class="big-once-board__grid">
      <article
        v-for="event in events"
        :key="event.id"
        class="big-once-card"
        :class="{ 'big-once-card--active': event.id === selectedEventId }"
      >
        <button class="big-once-card__body" type="button" @click="emit('select', event.id)">
          <div class="big-once-card__meta">
            <span class="big-once-card__kind">{{ event.kind }}</span>
            <span class="big-once-card__tag">独立事件</span>
          </div>
          <strong class="big-once-card__title">{{ event.title }}</strong>
          <span class="big-once-card__id">{{ event.id }}</span>
          <p class="big-once-card__text">
            {{ event.body?.trim() || "暂无正文内容。" }}
          </p>
        </button>

        <div class="big-once-card__footer">
          <span class="big-once-card__status">
            {{ selectedEvent?.id === event.id ? "当前已选中" : "点击卡片查看详情" }}
          </span>
          <button class="btn-secondary big-once-card__edit" type="button" @click="handleEdit(event.id)">
            编辑
          </button>
        </div>
      </article>
    </div>

    <div v-else class="big-once-board__empty">
      <strong class="big-once-board__empty-title">还没有一次性大事件</strong>
      <p class="big-once-board__empty-copy">
        这里管理的是彼此独立的大事件节点，可以先创建一个事件开始编辑。
      </p>
      <button class="btn-primary" type="button" @click="emit('create')">创建事件</button>
    </div>
  </section>
</template>

<style scoped>
.big-once-board {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    radial-gradient(circle at top left, rgba(255, 180, 84, 0.12), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
}

.big-once-board__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.big-once-board__copy {
  display: grid;
  gap: 6px;
}

.big-once-board__summary {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.big-once-board__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.big-once-board__button {
  min-height: 32px;
}

.big-once-board__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.big-once-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(255, 180, 84, 0.16);
  border-radius: 22px;
  background:
    linear-gradient(145deg, rgba(255, 180, 84, 0.08), rgba(255, 255, 255, 0.02)),
    rgba(8, 18, 29, 0.88);
  box-shadow: 0 20px 30px rgba(0, 0, 0, 0.2);
  transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}

.big-once-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 180, 84, 0.34);
}

.big-once-card--active {
  border-color: rgba(255, 180, 84, 0.62);
  box-shadow:
    0 0 0 1px rgba(255, 180, 84, 0.22),
    0 22px 32px rgba(0, 0, 0, 0.24);
}

.big-once-card__body {
  display: grid;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.big-once-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.big-once-card__kind,
.big-once-card__tag {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}

.big-once-card__title {
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.05rem;
  line-height: 1.35;
}

.big-once-card__id,
.big-once-card__status {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.big-once-card__text {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.6;
}

.big-once-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.big-once-card__edit {
  min-height: 30px;
}

.big-once-board__empty {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  place-items: center;
  gap: 10px;
  padding: 24px;
  border: 1px dashed rgba(255, 180, 84, 0.34);
  border-radius: 24px;
  background: rgba(255, 180, 84, 0.05);
  text-align: center;
}

.big-once-board__empty-title {
  font-size: 1.02rem;
}

.big-once-board__empty-copy {
  max-width: 420px;
  margin: 0;
  color: var(--text-muted);
  line-height: 1.6;
}

@media (max-width: 900px) {
  .big-once-board {
    padding: 12px;
  }

  .big-once-board__header,
  .big-once-card__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .big-once-board__actions {
    justify-content: flex-start;
  }
}
</style>
