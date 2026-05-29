<script setup lang="ts">
import type { StoryLoopEventFile } from "@story-mgr/core"

const props = defineProps<{
  events: StoryLoopEventFile[]
  selectedEventId: string | null
}>()

const emit = defineEmits<{
  select: [eventId: string]
  edit: [eventId: string]
  delete: [eventId: string]
  create: []
}>()

const selectedEvent = computed(() => {
  return props.events.find((event) => event.id === props.selectedEventId) ?? null
})

function summarizeTrigger(expression: string) {
  const trimmed = expression.trim()

  if (!trimmed) {
    return "无条件触发"
  }

  if (trimmed.length <= 56) {
    return trimmed
  }

  return `${trimmed.slice(0, 56)}...`
}

function formatLoopMode(event: StoryLoopEventFile) {
  if (event.loop.mode === "daily") {
    return "每天"
  }

  if (event.loop.mode === "weekly") {
    const weekdayMap: Record<number, string> = {
      1: "周一",
      2: "周二",
      3: "周三",
      4: "周四",
      5: "周五",
      6: "周六",
      7: "周日"
    }

    return `每周 ${weekdayMap[event.loop.weekday ?? 1] ?? "周一"}`
  }

  if (event.loop.mode === "monthly") {
    return `每月 ${event.loop.month_day ?? 1} 日`
  }

  return `每 ${event.loop.interval_days ?? 1} 天`
}

function handleEdit(eventId: string) {
  emit("select", eventId)
  emit("edit", eventId)
}

function handleDelete(event: StoryLoopEventFile) {
  const label = event.title.trim() || event.id
  const confirmed =
    typeof window === "undefined"
      ? true
      : window.confirm(`确认删除事件“${label}”吗？\n\n删除后无法撤销。`)

  if (!confirmed) {
    return
  }

  emit("delete", event.id)
}
</script>

<template>
  <section class="loop-board glass-panel">
    <div class="loop-board__header">
      <div class="loop-board__copy">
        <span class="eyebrow">循环事件画布</span>
        <h2 class="section-title">定时循环事件管理</h2>
        <p class="loop-board__summary">
          循环事件以独立列表维护，不提供连接点或连接线。
        </p>
      </div>

      <div class="loop-board__actions">
        <span class="pill">{{ events.length }} 个事件</span>
        <button class="btn-secondary loop-board__button" type="button" @click="emit('create')">
          创建事件
        </button>
      </div>
    </div>

    <div v-if="events.length" class="loop-board__lane">
      <article
        v-for="event in events"
        :key="event.id"
        class="loop-card"
        :class="{ 'loop-card--active': event.id === selectedEventId }"
      >
        <button class="loop-card__body" type="button" @click="emit('select', event.id)">
          <div class="loop-card__top">
            <strong class="loop-card__title">{{ event.title }}</strong>
            <span class="loop-card__badge">{{ formatLoopMode(event) }}</span>
          </div>
          <span class="loop-card__id">{{ event.id }}</span>
          <div class="loop-card__facts">
            <span class="loop-card__fact">
              <strong>触发</strong>
              <span>{{ summarizeTrigger(event.trigger_expr) }}</span>
            </span>
            <span class="loop-card__fact">
              <strong>地点</strong>
              <span>{{ event.location.trim() || "未设置" }}</span>
            </span>
            <span class="loop-card__fact">
              <strong>对象</strong>
              <span>{{ event.object_keys.length }} 个</span>
            </span>
            <span class="loop-card__fact">
              <strong>对白</strong>
              <span>{{ event.dialogues.length }} 条</span>
            </span>
          </div>
        </button>

        <div class="loop-card__actions">
          <span class="loop-card__hint">
            {{ selectedEvent?.id === event.id ? "当前已选中" : "独立循环事件" }}
          </span>
          <div class="loop-card__action-row">
            <button class="btn-danger loop-card__delete" type="button" @click="handleDelete(event)">
              删除
            </button>
            <button class="btn-secondary loop-card__edit" type="button" @click="handleEdit(event.id)">
              编辑
            </button>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="loop-board__empty">
      <strong class="loop-board__empty-title">还没有循环事件</strong>
      <p class="loop-board__empty-copy">
        循环事件会单独存在于这个画布里，先创建一个事件作为起点即可。
      </p>
      <button class="btn-primary" type="button" @click="emit('create')">创建事件</button>
    </div>
  </section>
</template>

<style scoped>
.loop-board {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    radial-gradient(circle at top right, rgba(124, 227, 195, 0.12), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015));
}

.loop-board__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.loop-board__copy {
  display: grid;
  gap: 6px;
}

.loop-board__summary {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.loop-board__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.loop-board__button {
  min-height: 32px;
}

.loop-board__lane {
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 12px;
  padding-right: 4px;
}

.loop-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(124, 227, 195, 0.16);
  border-radius: 22px;
  background:
    linear-gradient(145deg, rgba(124, 227, 195, 0.08), rgba(255, 255, 255, 0.02)),
    rgba(8, 18, 29, 0.88);
  box-shadow: 0 20px 30px rgba(0, 0, 0, 0.2);
  transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}

.loop-card:hover {
  transform: translateY(-2px);
  border-color: rgba(124, 227, 195, 0.34);
}

.loop-card--active {
  border-color: rgba(124, 227, 195, 0.6);
  box-shadow:
    0 0 0 1px rgba(124, 227, 195, 0.2),
    0 20px 30px rgba(0, 0, 0, 0.22);
}

.loop-card__body {
  display: grid;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.loop-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.loop-card__title {
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.05rem;
  line-height: 1.35;
}

.loop-card__badge {
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(124, 227, 195, 0.1);
  color: var(--text-muted);
  font-size: 0.8rem;
  white-space: nowrap;
}

.loop-card__id,
.loop-card__hint {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.loop-card__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.loop-card__fact {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
}

.loop-card__fact strong {
  font-size: 0.76rem;
  color: rgba(255, 255, 255, 0.72);
}

.loop-card__fact span {
  min-width: 0;
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.45;
  word-break: break-word;
}

.loop-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.loop-card__action-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.loop-card__delete,
.loop-card__edit {
  min-height: 30px;
}

.loop-board__empty {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  place-items: center;
  gap: 10px;
  padding: 24px;
  border: 1px dashed rgba(124, 227, 195, 0.34);
  border-radius: 24px;
  background: rgba(124, 227, 195, 0.05);
  text-align: center;
}

.loop-board__empty-title {
  font-size: 1.02rem;
}

.loop-board__empty-copy {
  max-width: 420px;
  margin: 0;
  color: var(--text-muted);
  line-height: 1.6;
}

@media (max-width: 900px) {
  .loop-board {
    padding: 12px;
  }

  .loop-board__header,
  .loop-card__actions {
    grid-template-columns: 1fr;
  }

  .loop-board__actions,
  .loop-card__actions {
    justify-content: flex-start;
    align-items: stretch;
  }

  .loop-card__facts {
    grid-template-columns: 1fr;
  }
}
</style>
