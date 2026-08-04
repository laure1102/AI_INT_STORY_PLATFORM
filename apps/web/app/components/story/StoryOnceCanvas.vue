<script setup lang="ts">
import type { StoryOnceEventFile } from "@story-mgr/core"

const props = defineProps<{
  events: StoryOnceEventFile[]
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

/** 执行 `summarizeTrigger` 对应的局部业务逻辑。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function summarizeTrigger(event: StoryOnceEventFile) {
  const mode = event.trigger_mode ?? "default"

  if (mode === "default") {
    return "默认触发"
  }

  if (mode === "invoke") {
    return "被调用"
  }

  const trimmed = event.trigger_expr.trim()

  if (!trimmed) {
    return "条件未填写"
  }

  if (trimmed.length <= 56) {
    return trimmed
  }

  return `${trimmed.slice(0, 56)}...`
}

/** 执行 `summarizePresentation` 对应的局部业务逻辑。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function summarizePresentation(event: StoryOnceEventFile) {
  if (event.presentation.type === "silent") {
    return "静默"
  }

  if (event.presentation.type === "message") {
    return "消息"
  }

  return `${event.presentation.dialogues.length} 条对白`
}

/** 处理 `Edit` 用户交互。 @param eventId 调用方传入的 `eventId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleEdit(eventId: string) {
  emit("select", eventId)
  emit("edit", eventId)
}

/** 处理 `Delete` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleDelete(event: StoryOnceEventFile) {
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
  <section class="once-board glass-panel">
    <div class="once-board__header">
      <div class="once-board__copy">
        <span class="eyebrow">事件画布</span>
        <h2 class="section-title">一次性事件管理</h2>
        <p class="once-board__summary">
          一次性事件彼此独立，不提供连接点或连接线。
        </p>
      </div>

      <div class="once-board__actions">
        <span class="pill">{{ events.length }} 个事件</span>
        <button class="btn-secondary once-board__button" type="button" @click="emit('create')">
          创建事件
        </button>
      </div>
    </div>

    <div v-if="events.length" class="once-board__grid">
      <article
        v-for="event in events"
        :key="event.id"
        class="once-card"
        :class="{ 'once-card--active': event.id === selectedEventId }"
      >
        <span
          v-if="(event.trigger_mode ?? 'default') === 'invoke'"
          class="once-card__trigger-mark once-card__trigger-mark--invoke"
          title="被调用"
          aria-label="被调用"
        />
        <span
          v-else-if="(event.trigger_mode ?? 'default') === 'condition'"
          class="once-card__trigger-mark once-card__trigger-mark--condition"
          title="条件触发"
          aria-label="条件触发"
        >
          ★
        </span>
        <button class="once-card__body" type="button" @click="emit('select', event.id)">
          <div class="once-card__meta">
            <span class="once-card__kind">一次性事件</span>
            <span class="once-card__tag">独立事件</span>
          </div>
          <strong class="once-card__title">{{ event.title }}</strong>
          <span class="once-card__id">{{ event.id }}</span>
          <div class="once-card__facts">
            <span class="once-card__fact">
              <strong>触发</strong>
              <span>{{ summarizeTrigger(event) }}</span>
            </span>
            <span class="once-card__fact">
              <strong>地点</strong>
              <span>{{ event.location.trim() || "未设置" }}</span>
            </span>
            <span class="once-card__fact">
              <strong>对象</strong>
              <span>{{ event.object_keys.length }} 个</span>
            </span>
            <span class="once-card__fact">
              <strong>表现</strong>
              <span>{{ summarizePresentation(event) }}</span>
            </span>
          </div>
        </button>

        <div class="once-card__footer">
          <span class="once-card__status">
            {{ selectedEvent?.id === event.id ? "当前已选中" : "点击卡片查看详情" }}
          </span>
          <div class="once-card__actions">
            <button class="btn-danger once-card__delete" type="button" @click="handleDelete(event)">
              删除
            </button>
            <button class="btn-secondary once-card__edit" type="button" @click="handleEdit(event.id)">
              编辑
            </button>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="once-board__empty">
      <strong class="once-board__empty-title">还没有一次性事件</strong>
      <p class="once-board__empty-copy">
        这里管理的是彼此独立的一次性事件节点，可以先创建一个事件开始编辑。
      </p>
      <button class="btn-primary" type="button" @click="emit('create')">创建事件</button>
    </div>
  </section>
</template>

<style scoped>
.once-board {
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

.once-board__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.once-board__copy {
  display: grid;
  gap: 6px;
}

.once-board__summary {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.once-board__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.once-board__button {
  min-height: 32px;
}

.once-board__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.once-card {
  position: relative;
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

.once-card__trigger-mark {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}

.once-card__trigger-mark--invoke {
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  border-top: 24px solid rgba(255, 180, 84, 0.96);
  border-right: 24px solid transparent;
  filter: drop-shadow(0 0 8px rgba(255, 180, 84, 0.34));
}

.once-card__trigger-mark--condition {
  left: 10px;
  bottom: 10px;
  color: rgba(255, 214, 107, 0.98);
  font-size: 0.9rem;
  line-height: 1;
  text-shadow: 0 0 10px rgba(255, 214, 107, 0.45);
}

.once-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 180, 84, 0.34);
}

.once-card--active {
  border-color: rgba(255, 180, 84, 0.62);
  box-shadow:
    0 0 0 1px rgba(255, 180, 84, 0.22),
    0 22px 32px rgba(0, 0, 0, 0.24);
}

.once-card__body {
  display: grid;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.once-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.once-card__kind,
.once-card__tag {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 180, 84, 0.14);
  color: rgba(255, 212, 160, 0.92);
  font-size: 0.74rem;
  letter-spacing: 0.08em;
}

.once-card__title {
  font-size: 1.05rem;
  color: #fff3df;
  line-height: 1.35;
}

.once-card__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}

.once-card__fact {
  display: grid;
  gap: 4px;
}

.once-card__fact strong {
  font-size: 0.74rem;
  letter-spacing: 0.08em;
  color: rgba(255, 212, 160, 0.72);
}

.once-card__fact span {
  font-size: 0.9rem;
  color: rgba(242, 246, 255, 0.88);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.once-card__id,
.once-card__status {
  font-size: 0.8rem;
  color: rgba(214, 222, 236, 0.72);
}

.once-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.once-card__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.once-card__delete,
.once-card__edit {
  min-height: 32px;
}

.once-board__empty {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  gap: 12px;
  text-align: center;
  padding: 28px;
  border: 1px dashed rgba(255, 180, 84, 0.2);
  border-radius: 24px;
  background: rgba(6, 12, 22, 0.4);
}

.once-board__empty-title {
  font-size: 1.05rem;
  color: #fff3df;
}

.once-board__empty-copy {
  max-width: 460px;
  margin: 0;
  color: var(--text-muted);
  line-height: 1.6;
}

@media (max-width: 900px) {
  .once-board {
    padding: 14px;
  }

  .once-board__header,
  .once-card__footer {
    grid-template-columns: 1fr;
    display: grid;
  }

  .once-board__actions {
    justify-content: flex-start;
  }

  .once-card__facts {
    grid-template-columns: 1fr;
  }
}
</style>
