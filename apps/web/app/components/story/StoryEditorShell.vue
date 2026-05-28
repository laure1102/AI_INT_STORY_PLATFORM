<script setup lang="ts">
import type {
  AppSettingsFile,
  StoryDocument,
  StoryEventFile,
  StoryEventLocationFile,
  StoryRolesFile,
  StorySceneFile,
  StoryValsFile,
  ValidationIssue,
  ValidationResult
} from "@story-mgr/core"
import AppSettingsDialog from "./AppSettingsDialog.vue"
import EventDetailPanel from "./EventDetailPanel.vue"
import StoryGraphCanvas from "./StoryGraphCanvas.vue"
import StoryLocationsDialog from "./StoryLocationsDialog.vue"
import StoryRolesDialog from "./StoryRolesDialog.vue"
import StoryScenesDialog from "./StoryScenesDialog.vue"
import StoryValsDialog from "./StoryValsDialog.vue"

const props = defineProps<{
  storyId: string
}>()

const projectStore = useProjectStore()
const {
  exportStory,
  getAppSettings,
  getStory,
  saveAppSettings,
  saveEvent,
  saveEventLocations,
  saveRoles,
  saveScenes,
  saveVals,
  validateStory
} = useStoryApi()

const storyDocument = ref<StoryDocument | null>(null)
const appSettings = ref<AppSettingsFile | null>(null)
const validation = shallowRef<ValidationResult | null>(null)
const exportPath = shallowRef<string | null>(null)
const isLoading = shallowRef(true)
const isSaving = shallowRef(false)
const isExporting = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)
const editingEventId = shallowRef<string | null>(null)
const creatingFromEventId = shallowRef<string | null>(null)
const creatingEventDraft = shallowRef<StoryEventFile | null>(null)
const isValsDialogOpen = shallowRef(false)
const isScenesDialogOpen = shallowRef(false)
const isLocationsDialogOpen = shallowRef(false)
const isRolesDialogOpen = shallowRef(false)
const isSettingsDialogOpen = shallowRef(false)
const scenesSaveSuccessMessage = shallowRef<string | null>(null)
const locationsSaveSuccessMessage = shallowRef<string | null>(null)
const rolesSaveSuccessMessage = shallowRef<string | null>(null)

const selectedEventId = computed(() => projectStore.getSelectedEventId(props.storyId))

const selectedEvent = computed(() => {
  return storyDocument.value?.graphEvents.find((event) => event.id === selectedEventId.value) ?? null
})

const editingEvent = computed(() => {
  return storyDocument.value?.graphEvents.find((event) => event.id === editingEventId.value) ?? null
})

const activeDraftEvent = computed(() => {
  if (creatingFromEventId.value || creatingEventDraft.value) {
    return creatingEventDraft.value
  }

  return editingEvent.value
})

const isCreateMode = computed(() => !!creatingEventDraft.value)

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

async function refreshValidation() {
  validation.value = await validateStory(props.storyId)
}

function closeEditor() {
  editingEventId.value = null
  creatingFromEventId.value = null
  creatingEventDraft.value = null
}

function openValsDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isRolesDialogOpen.value = false
  isValsDialogOpen.value = true
}

function closeValsDialog() {
  isValsDialogOpen.value = false
}

function openScenesDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isLocationsDialogOpen.value = false
  isRolesDialogOpen.value = false
  scenesSaveSuccessMessage.value = null
  isScenesDialogOpen.value = true
}

function closeScenesDialog() {
  scenesSaveSuccessMessage.value = null
  isScenesDialogOpen.value = false
}

function openLocationsDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isRolesDialogOpen.value = false
  locationsSaveSuccessMessage.value = null
  isLocationsDialogOpen.value = true
}

function closeLocationsDialog() {
  locationsSaveSuccessMessage.value = null
  isLocationsDialogOpen.value = false
}

function openRolesDialog() {
  if (!storyDocument.value) {
    return
  }

  closeEditor()
  isValsDialogOpen.value = false
  isScenesDialogOpen.value = false
  isLocationsDialogOpen.value = false
  rolesSaveSuccessMessage.value = null
  isRolesDialogOpen.value = true
}

function closeRolesDialog() {
  rolesSaveSuccessMessage.value = null
  isRolesDialogOpen.value = false
}

function openSettingsDialog() {
  if (!appSettings.value) {
    return
  }

  isSettingsDialogOpen.value = true
}

function closeSettingsDialog() {
  isSettingsDialogOpen.value = false
}

async function loadStory() {
  isLoading.value = true
  errorMessage.value = null
  exportPath.value = null

  try {
    const [story, settings] = await Promise.all([getStory(props.storyId), getAppSettings()])
    storyDocument.value = story
    appSettings.value = settings

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

function buildNewRootEvent(): StoryEventFile {
  const newId = createUniqueEventId("root")

  return {
    id: newId,
    title: "新根事件",
    kind: "scene",
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

function handleCreateRootEvent() {
  creatingFromEventId.value = null
  editingEventId.value = null
  creatingEventDraft.value = buildNewRootEvent()
  projectStore.clearEvent(props.storyId)
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

async function handleSaveVals(vals: StoryValsFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null

  try {
    const savedVals = await saveVals(props.storyId, vals)
    storyDocument.value = {
      ...storyDocument.value,
      vals: savedVals
    }
    isValsDialogOpen.value = false
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存全局变量失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveScenes(scenes: StorySceneFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  scenesSaveSuccessMessage.value = null

  try {
    const savedScenes = await saveScenes(props.storyId, scenes)
    storyDocument.value = {
      ...storyDocument.value,
      scenes: savedScenes
    }
    scenesSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存场景失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveEventLocations(eventLocations: StoryEventLocationFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  locationsSaveSuccessMessage.value = null

  try {
    const savedEventLocations = await saveEventLocations(props.storyId, eventLocations)
    storyDocument.value = {
      ...storyDocument.value,
      eventLocations: savedEventLocations
    }
    locationsSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存地点失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveRoles(roles: StoryRolesFile) {
  if (!storyDocument.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = null
  rolesSaveSuccessMessage.value = null

  try {
    const savedRoles = await saveRoles(props.storyId, roles)
    storyDocument.value = {
      ...storyDocument.value,
      roles: savedRoles
    }
    rolesSaveSuccessMessage.value = "已保存"
    await refreshValidation()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存角色失败。"
  } finally {
    isSaving.value = false
  }
}

async function handleSaveAppSettings(settings: AppSettingsFile) {
  isSaving.value = true
  errorMessage.value = null

  try {
    appSettings.value = await saveAppSettings(settings)
    isSettingsDialogOpen.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存设置失败。"
  } finally {
    isSaving.value = false
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
    isValsDialogOpen.value = false
    isScenesDialogOpen.value = false
    isLocationsDialogOpen.value = false
    isRolesDialogOpen.value = false
    scenesSaveSuccessMessage.value = null
    locationsSaveSuccessMessage.value = null
    rolesSaveSuccessMessage.value = null
    void loadStory()
  },
  { immediate: true }
)
</script>

<template>
  <main class="page-shell page-shell--editor fade-up">
    <div class="editor-header">
      <div class="editor-header__copy">
        <NuxtLink class="editor-header__back" to="/">返回剧情列表</NuxtLink>
        <h1 class="editor-header__title">
          {{ storyDocument?.story.title || "正在加载剧情..." }}
        </h1>
        <div class="editor-header__tools" aria-label="故事配置入口">
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openValsDialog">
            全局变量
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openScenesDialog">
            场景
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openLocationsDialog">
            地点
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openRolesDialog">
            角色
          </button>
          <button class="btn-secondary editor-header__tool-button" type="button" @click="openSettingsDialog">
            设置
          </button>
        </div>
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
        @select="handleSelectEvent"
        @edit="handleEditEvent"
        @create="handleCreateEvent"
        @create-root="handleCreateRootEvent"
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

    <StoryValsDialog
      v-if="storyDocument && isValsDialogOpen"
      :saving="isSaving"
      :vals="storyDocument.vals"
      @close="closeValsDialog"
      @save="handleSaveVals"
    />

    <StoryScenesDialog
      v-if="storyDocument && isScenesDialogOpen"
      :save-success-message="scenesSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :scenes="storyDocument.scenes"
      @close="closeScenesDialog"
      @save="handleSaveScenes"
    />

    <StoryLocationsDialog
      v-if="storyDocument && isLocationsDialogOpen"
      :event-locations="storyDocument.eventLocations"
      :save-success-message="locationsSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :story-title="storyDocument.story.title"
      @close="closeLocationsDialog"
      @save="handleSaveEventLocations"
    />

    <StoryRolesDialog
      v-if="storyDocument && isRolesDialogOpen"
      :roles="storyDocument.roles"
      :save-success-message="rolesSaveSuccessMessage"
      :saving="isSaving"
      :story-id="storyId"
      :story-title="storyDocument.story.title"
      @close="closeRolesDialog"
      @save="handleSaveRoles"
    />

    <AppSettingsDialog
      v-if="appSettings && isSettingsDialogOpen"
      :saving="isSaving"
      :settings="appSettings"
      @close="closeSettingsDialog"
      @save="handleSaveAppSettings"
    />
  </main>
</template>

<style scoped>
.page-shell--editor {
  width: 100%;
  max-width: none;
  height: 100dvh;
  min-height: 100dvh;
  margin: 0;
  padding: 10px 10px 0;
  padding-bottom: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.editor-header__copy {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.editor-header__back {
  color: var(--accent);
  font-family: "Space Grotesk", sans-serif;
  font-size: 0.78rem;
  flex-shrink: 0;
}

.editor-header__title {
  margin: 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: clamp(1.1rem, 1.9vw, 1.45rem);
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
}

.editor-header__actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.editor-header__tools {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.editor-header__tool-button {
  min-height: 28px;
  padding: 0 10px;
  border-radius: 10px;
  font-size: 0.78rem;
}

.editor-header :deep(.btn-primary),
.editor-header :deep(.btn-secondary),
.editor-main :deep(.btn-secondary) {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 10px;
}

.editor-banner {
  margin-bottom: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(124, 227, 195, 0.4);
  border-radius: 12px;
  background: rgba(124, 227, 195, 0.12);
  font-size: 0.82rem;
  line-height: 1.25;
}

.editor-banner--error {
  border-color: rgba(255, 139, 123, 0.45);
  background: rgba(255, 139, 123, 0.14);
}

.editor-main {
  display: grid;
  gap: 6px;
  flex-shrink: 0;
}

.editor-canvas-band {
  display: flex;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  width: 100%;
  margin: 4px 0 0;
}

.editor-validation-row {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 16px;
}

.editor-status__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.issues {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 12px;
  border-radius: 16px;
}

.issues__head {
  margin: 0;
  flex-shrink: 0;
}

.issues__list {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
  max-height: none;
  overflow-x: auto;
  overflow-y: hidden;
  padding-right: 0;
  white-space: nowrap;
}

.issues__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 0.8rem;
  flex-shrink: 0;
}

.issues__item--error {
  border-color: rgba(255, 139, 123, 0.4);
}

.issues__item--warning {
  border-color: rgba(255, 180, 84, 0.4);
}

.issues__item code {
  color: var(--text-muted);
  font-size: 0.72rem;
}

.editor-main .section-title {
  font-size: 0.92rem;
  line-height: 1;
}

.editor-main .eyebrow {
  gap: 6px;
  font-size: 0.72rem;
}

.editor-main .eyebrow::before {
  width: 22px;
}

.issues .muted {
  margin: 0;
  font-size: 0.8rem;
  white-space: nowrap;
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
  .page-shell--editor {
    width: 100%;
    height: 100dvh;
    margin: 0;
    padding: 8px 6px 0;
    padding-bottom: 0;
  }

  .editor-header,
  .editor-header__actions,
  .editor-status,
  .editor-status__actions,
  .editor-validation-row {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }

  .editor-header__copy {
    display: grid;
    gap: 4px;
  }

  .editor-header__title,
  .editor-header__tools {
    white-space: normal;
  }

  .issues {
    align-items: flex-start;
  }

  .issues__list {
    width: 100%;
  }
}
</style>
