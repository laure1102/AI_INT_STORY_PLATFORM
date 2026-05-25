<script setup lang="ts">
import type {
  StoryDocument,
  StoryEventFile,
  StoryViewFile,
  ValidationIssue,
  ValidationResult
} from "@story-mgr/core"
import EventDetailPanel from "./EventDetailPanel.vue"
import StoryGraphCanvas from "./StoryGraphCanvas.vue"

const props = defineProps<{
  storyId: string
}>()

const projectStore = useProjectStore()
const { exportStory, getStory, saveEvent, saveView, validateStory } = useStoryApi()

const storyDocument = ref<StoryDocument | null>(null)
const validation = shallowRef<ValidationResult | null>(null)
const exportPath = shallowRef<string | null>(null)
const isLoading = shallowRef(true)
const isSaving = shallowRef(false)
const isSavingView = shallowRef(false)
const isExporting = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)
const editingEventId = shallowRef<string | null>(null)
const creatingFromEventId = shallowRef<string | null>(null)
const creatingEventDraft = shallowRef<StoryEventFile | null>(null)

const selectedEventId = computed(() => projectStore.getSelectedEventId(props.storyId))
const activeView = computed(() => storyDocument.value?.views[0] ?? null)

const selectedEvent = computed(() => {
  return storyDocument.value?.graphEvents.find((event) => event.id === selectedEventId.value) ?? null
})

const editingEvent = computed(() => {
  return storyDocument.value?.graphEvents.find((event) => event.id === editingEventId.value) ?? null
})

const activeDraftEvent = computed(() => {
  if (creatingFromEventId.value) {
    return creatingEventDraft.value
  }

  return editingEvent.value
})

const isCreateMode = computed(() => !!creatingFromEventId.value)

const issueSummary = computed(() => {
  const issues = validation.value?.issues ?? []
  const errorCount = issues.filter((issue) => issue.level === "error").length
  const warningCount = issues.filter((issue) => issue.level === "warning").length

  return { errorCount, warningCount }
})

function replaceEventInDocument(savedEvent: StoryEventFile, matchEventId = savedEvent.id) {
  if (!storyDocument.value) {
    return
  }

  const hasExistingEvent = storyDocument.value.graphEvents.some((currentEvent) => currentEvent.id === matchEventId)

  storyDocument.value = {
    ...storyDocument.value,
    graphEvents: hasExistingEvent
      ? storyDocument.value.graphEvents.map((currentEvent) =>
          currentEvent.id === matchEventId ? savedEvent : currentEvent
        )
      : [...storyDocument.value.graphEvents, savedEvent]
  }
}

function upsertViewInDocument(savedView: StoryViewFile) {
  if (!storyDocument.value) {
    return
  }

  const hasExistingView = storyDocument.value.views.some((view) => view.id === savedView.id)

  storyDocument.value = {
    ...storyDocument.value,
    views: hasExistingView
      ? storyDocument.value.views.map((view) => (view.id === savedView.id ? savedView : view))
      : [...storyDocument.value.views, savedView]
  }
}

async function refreshValidation() {
  validation.value = await validateStory(props.storyId)
}

function closeEditor() {
  editingEventId.value = null
  creatingFromEventId.value = null
  creatingEventDraft.value = null
}

async function loadStory() {
  isLoading.value = true
  errorMessage.value = null
  exportPath.value = null

  try {
    storyDocument.value = await getStory(props.storyId)

    const currentSelection = projectStore.getSelectedEventId(props.storyId)
    const fallbackEventId = storyDocument.value.graphEvents[0]?.id

    if (currentSelection) {
      const stillExists = storyDocument.value.graphEvents.some((event) => event.id === currentSelection)

      if (!stillExists) {
        if (fallbackEventId) {
          projectStore.selectEvent(props.storyId, fallbackEventId)
        } else {
          projectStore.clearEvent(props.storyId)
        }
      }
    } else if (fallbackEventId) {
      projectStore.selectEvent(props.storyId, fallbackEventId)
    }

    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载剧情失败。"
  } finally {
    isLoading.value = false
  }
}

function handleSelectEvent(eventId: string) {
  projectStore.selectEvent(props.storyId, eventId)
}

function handleEditEvent(eventId: string) {
  creatingFromEventId.value = null
  editingEventId.value = eventId
  projectStore.selectEvent(props.storyId, eventId)
}

function sanitizeIdSegment(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function createUniqueEventId(baseEventId: string) {
  const events = storyDocument.value?.graphEvents ?? []
  const usedIds = new Set(events.map((event) => event.id))
  const base = `${sanitizeIdSegment(baseEventId) || "event"}-child`

  let candidate = base
  let index = 2
  while (usedIds.has(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }

  return candidate
}

function buildNewEventFromParent(parentEventId: string): StoryEventFile {
  const parentEvent = storyDocument.value?.graphEvents.find((event) => event.id === parentEventId)
  const newId = createUniqueEventId(parentEventId)

  return {
    id: newId,
    title: "新事件",
    kind: parentEvent?.kind ?? "scene",
    body: "",
    next: []
  }
}

function handleCreateEvent(parentEventId: string) {
  creatingFromEventId.value = parentEventId
  editingEventId.value = null
  creatingEventDraft.value = buildNewEventFromParent(parentEventId)
  projectStore.selectEvent(props.storyId, parentEventId)
}

async function handleSaveEvent(event: StoryEventFile) {
  isSaving.value = true
  errorMessage.value = null

  try {
    const isCreating = !!creatingFromEventId.value
    const previousEventId = selectedEventId.value ?? event.id
    const savedEvent = await saveEvent(props.storyId, event)

    if (isCreating && creatingFromEventId.value) {
      const sourceEvent = storyDocument.value?.graphEvents.find(
        (currentEvent) => currentEvent.id === creatingFromEventId.value
      )

      if (sourceEvent && !sourceEvent.next.includes(savedEvent.id)) {
        const linkedSourceEvent = await saveEvent(props.storyId, {
          ...sourceEvent,
          next: [...sourceEvent.next, savedEvent.id]
        })

        replaceEventInDocument(linkedSourceEvent, sourceEvent.id)
      }

      replaceEventInDocument(savedEvent)
    } else {
      replaceEventInDocument(savedEvent, previousEventId)
    }

    if (savedEvent.id !== previousEventId) {
      projectStore.selectEvent(props.storyId, savedEvent.id)
    }

    editingEventId.value = savedEvent.id
    creatingFromEventId.value = null
    creatingEventDraft.value = null
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存事件失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveView(view: StoryViewFile) {
  isSavingView.value = true
  errorMessage.value = null

  try {
    const savedView = await saveView(props.storyId, view)
    upsertViewInDocument(savedView)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存画布视图失败。"
  } finally {
    isSavingView.value = false
  }
}

async function handleToggleLink(payload: {
  sourceEventId: string
  targetEventId: string
}) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const sourceEvent = storyDocument.value.graphEvents.find((event) => event.id === payload.sourceEventId)

    if (!sourceEvent) {
      return
    }

    const next = sourceEvent.next.includes(payload.targetEventId)
      ? sourceEvent.next.filter((eventId) => eventId !== payload.targetEventId)
      : [...sourceEvent.next, payload.targetEventId]

    const savedEvent = await saveEvent(props.storyId, {
      ...sourceEvent,
      next
    })

    replaceEventInDocument(savedEvent, payload.sourceEventId)
    await refreshValidation()
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "更新图谱连线失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleExport() {
  isExporting.value = true
  errorMessage.value = null

  try {
    const response = await exportStory(props.storyId)
    validation.value = response.result
    exportPath.value = response.outputPath
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "导出运行时 JSON 失败。"
  } finally {
    isExporting.value = false
  }
}

function issueKey(issue: ValidationIssue, index: number) {
  return `${issue.code}:${issue.path.join("/")}:${index}`
}

watch(
  () => props.storyId,
  () => {
    editingEventId.value = null
    creatingFromEventId.value = null
    creatingEventDraft.value = null
    void loadStory()
  },
  { immediate: true }
)
</script>

<template>
  <main class="page-shell fade-up">
    <div class="editor-header">
      <div class="editor-header__copy">
        <NuxtLink class="editor-header__back" to="/">返回剧情列表</NuxtLink>
        <h1 class="editor-header__title">
          {{ storyDocument?.story.title || "正在加载剧情..." }}
        </h1>
        <p class="editor-header__description">
          {{ storyDocument?.story.description || "这个剧情暂时还没有描述。" }}
        </p>
      </div>

      <div class="editor-header__actions">
        <button class="btn-secondary" type="button" :disabled="isLoading" @click="loadStory">
          重新加载剧情
        </button>
        <button class="btn-primary" type="button" :disabled="isExporting" @click="handleExport">
          {{ isExporting ? "导出中..." : "导出运行时 JSON" }}
        </button>
      </div>
    </div>

    <div v-if="errorMessage" class="editor-banner editor-banner--error">
      {{ errorMessage }}
    </div>

    <div v-if="exportPath" class="editor-banner">
      运行时数据已导出到 {{ exportPath }}
    </div>

    <section class="editor-main">
      <div class="editor-validation-row">
        <div class="editor-status glass-panel">
          <div>
            <span class="eyebrow">校验</span>
            <h2 class="section-title">
              {{ issueSummary.errorCount }} 个错误 / {{ issueSummary.warningCount }} 个警告
            </h2>
          </div>
          <div class="editor-status__actions">
            <span v-if="isSavingView" class="muted">正在保存画布...</span>
            <button class="btn-secondary" type="button" @click="refreshValidation">
              重新校验
            </button>
          </div>
        </div>

        <section class="issues glass-panel">
          <div class="issues__head">
            <h2 class="section-title">校验结果</h2>
          </div>

          <ul v-if="validation?.issues.length" class="issues__list">
            <li
              v-for="(issue, index) in validation.issues"
              :key="issueKey(issue, index)"
              class="issues__item"
              :class="`issues__item--${issue.level}`"
            >
              <strong>{{ issue.code }}</strong>
              <span>{{ issue.message }}</span>
              <code>{{ issue.path.join(" / ") }}</code>
            </li>
          </ul>
          <p v-else class="muted">未发现结构问题。</p>
        </section>
      </div>

      <p v-if="isLoading && !storyDocument" class="muted">正在加载剧情数据...</p>
    </section>

    <section v-if="storyDocument" class="editor-canvas-band">
      <StoryGraphCanvas
        :entry-event-id="storyDocument.story.startEventId ?? storyDocument.graphEvents[0]?.id ?? null"
        :events="storyDocument.graphEvents"
        :selected-event-id="selectedEventId"
        :view="activeView"
        @save-view="handleSaveView"
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @create="handleCreateEvent"
        @toggle-link="handleToggleLink"
      />
    </section>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="editingEvent || creatingEventDraft" class="editor-modal" @click.self="closeEditor">
          <div class="editor-modal__panel">
            <button
              class="editor-modal__close"
              type="button"
              aria-label="关闭编辑窗口"
              title="关闭"
              @click="closeEditor"
            >
              ×
            </button>
            <EventDetailPanel
              :event="activeDraftEvent"
              :mode="isCreateMode ? 'create' : 'edit'"
              :parent-event-id="creatingFromEventId"
              :saving="isSaving"
              @save="handleSaveEvent"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}

.editor-header__copy {
  display: grid;
  gap: 10px;
}

.editor-header__back {
  color: var(--accent);
  font-family: "Space Grotesk", sans-serif;
  font-size: 0.92rem;
}

.editor-header__title {
  margin: 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: clamp(2rem, 4vw, 3rem);
}

.editor-header__description {
  max-width: 58ch;
  margin: 0;
  color: var(--text-muted);
  line-height: 1.8;
}

.editor-header__actions {
  display: flex;
  gap: 12px;
}

.editor-banner {
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid rgba(124, 227, 195, 0.4);
  border-radius: 16px;
  background: rgba(124, 227, 195, 0.12);
}

.editor-banner--error {
  border-color: rgba(255, 139, 123, 0.45);
  background: rgba(255, 139, 123, 0.14);
}

.editor-main {
  display: grid;
  gap: 18px;
}

.editor-canvas-band {
  width: 100vw;
  margin: 18px 0 0 calc(50% - 50vw);
}

.editor-validation-row {
  display: grid;
  grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
  gap: 18px;
  align-items: stretch;
}

.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 22px;
}

.editor-status__actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.issues {
  padding: 20px 22px;
}

.issues__head {
  margin-bottom: 14px;
}

.issues__list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.issues__item {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
}

.issues__item--error {
  border-color: rgba(255, 139, 123, 0.4);
}

.issues__item--warning {
  border-color: rgba(255, 180, 84, 0.4);
}

.issues__item code {
  color: var(--text-muted);
}

.editor-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(2, 8, 16, 0.72);
  backdrop-filter: blur(10px);
}

.editor-modal__panel {
  position: relative;
  width: min(980px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: rgba(7, 16, 26, 0.98);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
}

.editor-modal__close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 40px;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
  font-size: 1.5rem;
  line-height: 1;
}

@media (max-width: 1024px) {
  .editor-header,
  .editor-header__actions,
  .editor-status,
  .editor-status__actions,
  .editor-validation-row {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
