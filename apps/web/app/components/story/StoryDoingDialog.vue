<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from "vue"
import type {
  StoryDocument,
  StoryDoingDefinition,
  StoryDoingFile,
  StoryDoingMenu,
  StoryEventLocationFile,
  StoryEventPresentation,
  StoryOnceEventFile,
  StoryRolesFile,
  StorySceneFile,
  StoryValsFile
} from "@story-mgr/core"
import OnceEventDetailPanel from "./OnceEventDetailPanel.vue"
import StoryScriptTextarea from "./StoryScriptTextarea.vue"
import { openStoryScriptReferencePage } from "./storyScriptEditor"
import type { StoryQuickCreateLocationPayload } from "./storyQuickLocation"
import type { StoryQuickCreateRolePayload } from "./storyQuickRole"
import {
  formatStoryScriptValidationIssue,
  validateStoryScriptField
} from "./storyScriptValidation"

interface DoingMenuDraft extends StoryDoingMenu {
  draftKey: string
  sortOrderText: string
}

interface DoingDraft extends StoryDoingDefinition {
  draftKey: string
  cooldownHoursText: string
  isNew: boolean
}

type DoingPredicateField = "visible_expr"
type ScriptValidationStatus = "idle" | "checking" | "passed" | "failed"

interface ScriptValidationState {
  status: ScriptValidationStatus
  issues: string[]
}

const EMPTY_ROLE_AI = {
  width: 0,
  height: 0,
  global_prompt: "",
  compress_quality_1: 0,
  compress_quality_2: 0
}

const EMPTY_ROLES: StoryRolesFile = {
  important: {
    ai: EMPTY_ROLE_AI,
    roles: []
  },
  normal: {
    ai: EMPTY_ROLE_AI,
    roles: []
  }
}

const EMPTY_EVENT_LOCATIONS: StoryEventLocationFile = {
  ai: {
    width: 0,
    height: 0,
    global_prompt: "",
    compress_quality_1: 0,
    compress_quality_2: 0
  },
  assignments: []
}

const EMPTY_SCENES: StorySceneFile = {
  ai: {
    compress_quality: 0
  },
  scenes: []
}

const props = defineProps<{
  doing: StoryDoingFile
  embedded?: boolean
  itemIds?: string[]
  roles?: StoryRolesFile
  saveSuccessMessage?: string | null
  saving: boolean
  story?: StoryDocument | null
  vals?: StoryValsFile
}>()

const emit = defineEmits<{
  close: []
  quickCreateLocation: [payload: StoryQuickCreateLocationPayload]
  quickCreateRole: [payload: StoryQuickCreateRolePayload]
  save: [doing: StoryDoingFile]
}>()

const activeTab = shallowRef<"menus" | "doings">("menus")
const selectedDoingDraftKey = shallowRef<string | null>(null)
const editingDoingDraftKey = shallowRef<string | null>(null)

const draft = reactive({
  menus: [] as DoingMenuDraft[],
  doings: [] as DoingDraft[]
})
const scriptValidationState = reactive<Record<string, ScriptValidationState>>({})

const EMPTY_SCRIPT_VALIDATION_STATE: ScriptValidationState = {
  status: "idle",
  issues: []
}

let draftKeySeed = 0
let pendingEditingIdAfterSync: string | null = null

function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

function getValidationState(key: string) {
  return scriptValidationState[key] ?? EMPTY_SCRIPT_VALIDATION_STATE
}

function ensureValidationState(key: string) {
  scriptValidationState[key] ??= {
    status: "idle",
    issues: []
  }
  return scriptValidationState[key]
}

function resetValidationState(key: string) {
  delete scriptValidationState[key]
}

function clearValidationStates() {
  for (const key of Object.keys(scriptValidationState)) {
    delete scriptValidationState[key]
  }
}

const effectiveRoles = computed(() => props.roles ?? props.story?.roles ?? EMPTY_ROLES)
const effectiveEventLocations = computed(() => props.story?.eventLocations ?? EMPTY_EVENT_LOCATIONS)
const effectiveScenes = computed(() => props.story?.scenes ?? EMPTY_SCENES)
const effectiveItemIds = computed(() =>
  props.itemIds ?? props.story?.items.items.map((item) => item.id.trim()).filter(Boolean) ?? []
)
const validationVals = computed<StoryValsFile>(() => {
  if (props.vals) {
    return props.vals
  }

  return {
    variables: [
      ...(props.story?.vals.variables ?? []),
      ...(props.story?.systemVals.variables ?? [])
    ]
  }
})
const storyForEditor = computed<StoryDocument | null>(() => {
  if (!props.story) {
    return null
  }

  return {
    ...props.story,
    doing: buildDoingFile()
  }
})

const draftDoingIds = computed(() =>
  draft.doings.map((doing) => doing.id.trim()).filter(Boolean)
)

const menuOptions = computed(() =>
  draft.menus.map((menu) => ({
    label: `${menu.title || menu.id} (${menu.id})`,
    value: menu.id
  }))
)

const menuLabelMap = computed(() => new Map(menuOptions.value.map((option) => [option.value, option.label])))

const selectedDoing = computed(() => {
  return draft.doings.find((doing) => doing.draftKey === selectedDoingDraftKey.value) ?? null
})

const editingDoing = computed(() => {
  return draft.doings.find((doing) => doing.draftKey === editingDoingDraftKey.value) ?? null
})

const editingDoingEvent = computed(() => {
  return editingDoing.value ? createDoingEditorEvent(editingDoing.value) : null
})

const sortedDoingCards = computed(() => {
  return draft.doings.map((doing, index) => ({
    doing,
    index
  }))
})

function getMenuValidationKey(menu: DoingMenuDraft, field: DoingPredicateField) {
  return `menu:${menu.draftKey}:${field}`
}

function getDoingValidationKey(doing: DoingDraft, field: DoingPredicateField) {
  return `doing:${doing.draftKey}:${field}`
}

function getValidationButtonLabel(key: string) {
  return getValidationState(key).status === "checking" ? "校验中" : "校验"
}

function getValidationClass(key: string) {
  return `doing-dialog__validation--${getValidationState(key).status}`
}

function getValidationMessages(key: string, emptyMessage: string, passedMessage: string) {
  const state = getValidationState(key)

  if (state.status === "idle") {
    return []
  }

  if (state.status === "checking") {
    return ["校验中..."]
  }

  if (state.status === "passed") {
    return [state.issues[0] ?? (sourceIsEmptyMessage(emptyMessage, passedMessage))]
  }

  return state.issues
}

function sourceIsEmptyMessage(emptyMessage: string, passedMessage: string) {
  return passedMessage || emptyMessage
}

async function validateScriptSource(
  key: string,
  source: string,
  emptyMessage: string,
  passedMessage: string
) {
  const state = ensureValidationState(key)
  state.status = "checking"
  state.issues = []
  await Promise.resolve()

  const result = validateStoryScriptField({
    vals: validationVals.value,
    source,
    mode: "predicate",
    itemIds: effectiveItemIds.value,
    story: storyForEditor.value,
    doingIds: draftDoingIds.value,
    bagMode: "read",
    phoneMode: "read",
    doingMode: "read"
  })

  state.status = result.ok ? "passed" : "failed"
  state.issues = result.ok
    ? [source.trim() ? passedMessage : emptyMessage]
    : result.issues.map((issue) => formatStoryScriptValidationIssue(issue))
}

async function validateMenuField(menu: DoingMenuDraft, field: DoingPredicateField) {
  await validateScriptSource(
    getMenuValidationKey(menu, field),
    menu[field],
    "空条件，无需校验。",
    "条件可以执行。"
  )
}

async function validateDoingMetaField(doing: DoingDraft, field: DoingPredicateField) {
  await validateScriptSource(
    getDoingValidationKey(doing, field),
    doing[field],
    "空条件，无需校验。",
    "条件可以执行。"
  )
}

function normalizeNumberText(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback)
}

function sanitizeIdInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function parseIntegerInput(value: unknown, fallback = 0) {
  const parsed = Number(String(value ?? "").trim())
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function clonePresentation(presentation?: StoryEventPresentation): StoryEventPresentation {
  if (!presentation) {
    return {
      type: "silent"
    }
  }

  if (presentation.type === "message") {
    return {
      type: "message",
      message: {
        content: presentation.message.content,
        duration_seconds: presentation.message.duration_seconds
      }
    }
  }

  if (presentation.type === "dialogue") {
    return {
      type: "dialogue",
      dialogues: presentation.dialogues.map((dialogue) => ({
        speaker_type: dialogue.speaker_type,
        speaker_key: dialogue.speaker_key,
        content: dialogue.content
      }))
    }
  }

  return {
    type: "silent"
  }
}

function createMenuDraft(menu: StoryDoingMenu): DoingMenuDraft {
  return {
    ...menu,
    draftKey: createDraftKey("menu"),
    sortOrderText: normalizeNumberText(menu.sort_order)
  }
}

function createDoingDraft(doing: StoryDoingDefinition, isNew = false): DoingDraft {
  return {
    id: doing.id,
    title: doing.title,
    menu_id: doing.menu_id,
    descr: doing.descr,
    visible_expr: doing.visible_expr,
    cooldown_hours: doing.cooldown_hours,
    once: doing.once,
    init_script: doing.init_script,
    object_keys: [...doing.object_keys],
    presentation: clonePresentation(doing.presentation),
    location: doing.location,
    bgm: doing.bgm,
    end_script: doing.end_script,
    meta: doing.meta ? { ...doing.meta } : undefined,
    draftKey: createDraftKey("doing"),
    cooldownHoursText: normalizeNumberText(doing.cooldown_hours),
    isNew
  }
}

function createDoingEditorEvent(doing: DoingDraft): StoryOnceEventFile {
  const event: StoryOnceEventFile = {
    id: doing.id,
    title: doing.title,
    trigger_mode: "default",
    trigger_expr: "",
    invoke_params: [],
    init_script: doing.init_script,
    object_keys: [...doing.object_keys],
    presentation: clonePresentation(doing.presentation),
    location: doing.location,
    bgm: doing.bgm,
    end_script: doing.end_script
  }

  if (doing.meta) {
    event.meta = { ...doing.meta }
  }

  return event
}

function findDoingDraftKeyById(doingId: string | null) {
  if (!doingId) {
    return null
  }

  return draft.doings.find((doing) => doing.id === doingId)?.draftKey ?? null
}

function syncFromDoing(doing: StoryDoingFile) {
  const previousSelectedId = selectedDoing.value?.id ?? null
  const previousEditingId = pendingEditingIdAfterSync ?? editingDoing.value?.id ?? null

  draft.menus = doing.menus.map(createMenuDraft)
  draft.doings = doing.doings.map((item) => createDoingDraft(item))

  selectedDoingDraftKey.value =
    findDoingDraftKeyById(previousSelectedId)
    ?? findDoingDraftKeyById(previousEditingId)
    ?? draft.doings[0]?.draftKey
    ?? null
  editingDoingDraftKey.value = findDoingDraftKeyById(previousEditingId)
  pendingEditingIdAfterSync = null
  clearValidationStates()
}

watch(
  () => props.doing,
  (nextDoing) => syncFromDoing(nextDoing),
  { immediate: true, deep: true }
)

function getParentMenuOptions(menu: DoingMenuDraft) {
  return menuOptions.value.filter((option) => option.value !== menu.id)
}

function getDoingMenuLabel(doing: DoingDraft) {
  return doing.menu_id.trim()
    ? menuLabelMap.value.get(doing.menu_id) ?? doing.menu_id
    : "未选择菜单"
}

function summarizeCondition(source: string) {
  const trimmed = source.trim()
  if (!trimmed) {
    return "始终通过"
  }

  return trimmed.length > 56 ? `${trimmed.slice(0, 56)}...` : trimmed
}

function summarizePresentation(doing: DoingDraft) {
  if (doing.presentation.type === "silent") {
    return "静默"
  }

  if (doing.presentation.type === "message") {
    return "消息"
  }

  return `${doing.presentation.dialogues.length} 条对白`
}

function openStoryScriptHelp() {
  openStoryScriptReferencePage()
}

function nextUniqueId(base: string, usedIds: Set<string>) {
  const normalizedBase = sanitizeIdInput(base) || "doing"
  let candidate = normalizedBase
  let index = 2
  while (usedIds.has(candidate)) {
    candidate = `${normalizedBase}_${index}`
    index += 1
  }
  return candidate
}

function addMenu() {
  const usedIds = new Set(draft.menus.map((menu) => menu.id))
  const id = nextUniqueId(`menu_${draft.menus.length + 1}`, usedIds)
  draft.menus.push({
    draftKey: createDraftKey("menu"),
    id,
    title: "新菜单",
    parent_id: "",
    sort_order: 100,
    sortOrderText: "100",
    visible_expr: "",
    descr: ""
  })
  activeTab.value = "menus"
}

function removeMenu(index: number) {
  const menu = draft.menus[index]
  if (!menu) return

  const usedByDoing = draft.doings.some((doing) => doing.menu_id === menu.id)
  const usedByChild = draft.menus.some((candidate) => candidate.parent_id === menu.id)
  if ((usedByDoing || usedByChild) && !window.confirm("这个菜单仍被引用，删除后相关引用会被清空。继续删除吗？")) {
    return
  }

  draft.menus.splice(index, 1)
  for (const doing of draft.doings) {
    if (doing.menu_id === menu.id) {
      doing.menu_id = ""
    }
  }
  for (const candidate of draft.menus) {
    if (candidate.parent_id === menu.id) {
      candidate.parent_id = ""
    }
  }
}

function createEmptyDoingDefinition(id: string): StoryDoingDefinition {
  return {
    id,
    title: "新行动",
    menu_id: draft.menus[0]?.id ?? "",
    descr: "",
    visible_expr: "",
    cooldown_hours: 0,
    once: false,
    init_script: "",
    object_keys: [],
    presentation: {
      type: "silent"
    },
    location: "",
    bgm: "",
    end_script: ""
  }
}

function addDoing() {
  const usedIds = new Set(draft.doings.map((doing) => doing.id))
  const id = nextUniqueId(`doing_${draft.doings.length + 1}`, usedIds)
  const nextDoing = createDoingDraft(createEmptyDoingDefinition(id), true)

  draft.doings.push(nextDoing)
  selectedDoingDraftKey.value = nextDoing.draftKey
  editingDoingDraftKey.value = nextDoing.draftKey
  activeTab.value = "doings"
}

function removeDoing(index: number) {
  const doing = draft.doings[index]
  if (!doing) {
    return
  }

  if (!window.confirm("确认删除这个行动吗？")) {
    return
  }

  draft.doings.splice(index, 1)
  if (selectedDoingDraftKey.value === doing.draftKey) {
    selectedDoingDraftKey.value = draft.doings[Math.min(index, draft.doings.length - 1)]?.draftKey ?? null
  }
  if (editingDoingDraftKey.value === doing.draftKey) {
    editingDoingDraftKey.value = null
  }
}

function openDoingEditor(doing: DoingDraft) {
  selectedDoingDraftKey.value = doing.draftKey
  editingDoingDraftKey.value = doing.draftKey
}

function closeDoingEditor() {
  editingDoingDraftKey.value = null
}

function mergeEventIntoDoing(doing: DoingDraft, event: StoryOnceEventFile) {
  doing.id = event.id
  doing.title = event.title
  doing.init_script = event.init_script
  doing.object_keys = [...event.object_keys]
  doing.presentation = clonePresentation(event.presentation)
  doing.location = event.location
  doing.bgm = event.bgm
  doing.end_script = event.end_script
  doing.meta = event.meta ? { ...event.meta } : undefined
}

function serializeDoing(doing: DoingDraft): StoryDoingDefinition {
  const next: StoryDoingDefinition = {
    id: doing.id.trim(),
    title: doing.title.trim(),
    menu_id: doing.menu_id.trim(),
    descr: doing.descr,
    visible_expr: doing.visible_expr.trim(),
    cooldown_hours: Math.max(0, parseIntegerInput(doing.cooldownHoursText, 0)),
    once: doing.once,
    init_script: doing.init_script,
    object_keys: Array.from(new Set(doing.object_keys.map((objectKey) => objectKey.trim()).filter(Boolean))),
    presentation: clonePresentation(doing.presentation),
    location: doing.location.trim(),
    bgm: doing.bgm.trim(),
    end_script: doing.end_script
  }

  if (doing.meta) {
    next.meta = { ...doing.meta }
  }

  return next
}

function buildDoingFile(): StoryDoingFile {
  return {
    menus: draft.menus.map((menu) => ({
      id: menu.id.trim(),
      title: menu.title.trim(),
      parent_id: menu.parent_id.trim(),
      sort_order: parseIntegerInput(menu.sortOrderText, 0),
      visible_expr: menu.visible_expr.trim(),
      descr: menu.descr
    })),
    doings: draft.doings.map(serializeDoing)
  }
}

function handleSave() {
  pendingEditingIdAfterSync = editingDoing.value?.id ?? null
  emit("save", buildDoingFile())
}

function handleSaveDoingEvent(event: StoryOnceEventFile) {
  const target = editingDoing.value
  if (!target) {
    return
  }

  mergeEventIntoDoing(target, event)
  pendingEditingIdAfterSync = event.id
  emit("save", buildDoingFile())
}

function handleQuickCreateLocation(payload: StoryQuickCreateLocationPayload) {
  emit("quickCreateLocation", payload)
}

function handleQuickCreateRole(payload: StoryQuickCreateRolePayload) {
  emit("quickCreateRole", payload)
}
</script>

<template>
  <div class="doing-dialog" :class="{ 'doing-dialog--embedded': embedded }">
    <div class="doing-dialog__panel glass-panel">
      <header class="doing-dialog__header">
        <div class="doing-dialog__copy">
          <span class="eyebrow">行动</span>
          <h2 class="doing-dialog__title">主动行动菜单</h2>
          <p class="doing-dialog__subtitle">
            行动列表里的事件本体与平面事件池保持一致，菜单、显示条件和冷却是行动额外配置。
          </p>
        </div>
        <div class="doing-dialog__actions">
          <span v-if="saveSuccessMessage" class="doing-dialog__success">{{ saveSuccessMessage }}</span>
          <button v-if="!embedded" class="btn-secondary" type="button" @click="emit('close')">关闭</button>
          <button class="btn-primary" type="button" :disabled="saving" @click="handleSave">
            {{ saving ? "保存中..." : "保存行动" }}
          </button>
        </div>
      </header>

      <div class="doing-dialog__tabs" role="tablist" aria-label="行动配置标签">
        <button
          class="doing-dialog__tab"
          :class="{ 'doing-dialog__tab--active': activeTab === 'menus' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'menus'"
          @click="activeTab = 'menus'"
        >
          菜单树
        </button>
        <button
          class="doing-dialog__tab"
          :class="{ 'doing-dialog__tab--active': activeTab === 'doings' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'doings'"
          @click="activeTab = 'doings'"
        >
          行动列表
        </button>
      </div>

      <section v-if="activeTab === 'menus'" class="doing-dialog__section">
        <div class="doing-dialog__section-head">
          <div>
            <h3 class="doing-dialog__section-title">菜单树</h3>
            <p class="doing-dialog__section-note">菜单用于组织行动入口，可通过条件表达式控制显示。</p>
          </div>
          <button class="btn-secondary" type="button" @click="addMenu">新增菜单</button>
        </div>

        <div v-if="draft.menus.length" class="doing-dialog__table-wrap">
          <table class="doing-dialog__table">
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>父菜单</th>
                <th>排序</th>
                <th>显示条件</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(menu, index) in draft.menus" :key="menu.draftKey">
                <td><input v-model="menu.id" class="text-input doing-dialog__cell-input"></td>
                <td><input v-model="menu.title" class="text-input doing-dialog__cell-input"></td>
                <td>
                  <select v-model="menu.parent_id" class="text-input doing-dialog__select">
                    <option value="">根菜单</option>
                    <option
                      v-for="option in getParentMenuOptions(menu)"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </td>
                <td><input v-model="menu.sortOrderText" class="text-input doing-dialog__mini-input"></td>
                <td>
                  <div class="doing-dialog__script-field">
                    <StoryScriptTextarea
                      v-model="menu.visible_expr"
                      min-height="58px"
                      mode="predicate"
                      :story="storyForEditor"
                      :vals="validationVals"
                      @update:model-value="resetValidationState(getMenuValidationKey(menu, 'visible_expr'))"
                    />
                    <div class="doing-dialog__field-actions">
                      <button
                        class="doing-dialog__help-button"
                        type="button"
                        aria-label="查看显示条件说明"
                        @click.stop="openStoryScriptHelp"
                      >
                        ?
                      </button>
                      <button
                        class="doing-dialog__validate-button"
                        type="button"
                        :disabled="getValidationState(getMenuValidationKey(menu, 'visible_expr')).status === 'checking'"
                        @click="validateMenuField(menu, 'visible_expr')"
                      >
                        {{ getValidationButtonLabel(getMenuValidationKey(menu, 'visible_expr')) }}
                      </button>
                    </div>
                    <div
                      v-if="getValidationState(getMenuValidationKey(menu, 'visible_expr')).status !== 'idle'"
                      class="doing-dialog__validation"
                      :class="getValidationClass(getMenuValidationKey(menu, 'visible_expr'))"
                    >
                      <span
                        v-for="message in getValidationMessages(getMenuValidationKey(menu, 'visible_expr'), '空条件，无需校验。', '条件可以执行。')"
                        :key="message"
                        class="doing-dialog__validation-message"
                      >
                        {{ message }}
                      </span>
                    </div>
                  </div>
                </td>
                <td><textarea v-model="menu.descr" class="text-input doing-dialog__textarea doing-dialog__textarea--cell" /></td>
                <td><button class="btn-secondary" type="button" @click="removeMenu(index)">删除</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="doing-dialog__empty">还没有行动菜单。</div>
      </section>

      <section v-else class="doing-dialog__section">
        <div class="doing-dialog__section-head">
          <div>
            <h3 class="doing-dialog__section-title">行动列表</h3>
            <p class="doing-dialog__section-note">点击行动会打开与平面事件池相同的事件编辑器。</p>
          </div>
          <button class="btn-secondary" type="button" @click="addDoing">新增行动</button>
        </div>

        <div v-if="draft.doings.length" class="doing-dialog__cards">
          <article
            v-for="{ doing, index } in sortedDoingCards"
            :key="doing.draftKey"
            class="doing-card"
            :class="{ 'doing-card--active': doing.draftKey === selectedDoingDraftKey }"
          >
            <button class="doing-card__body" type="button" @click="openDoingEditor(doing)">
              <div class="doing-card__meta">
                <span class="doing-card__kind">行动</span>
                <span class="doing-card__tag">{{ getDoingMenuLabel(doing) }}</span>
              </div>
              <strong class="doing-card__title">{{ doing.title || doing.id || `doing_${index + 1}` }}</strong>
              <span class="doing-card__id">{{ doing.id || "未设置 ID" }}</span>
              <div class="doing-card__facts">
                <span class="doing-card__fact">
                  <strong>显示</strong>
                  <span>{{ summarizeCondition(doing.visible_expr) }}</span>
                </span>
                <span class="doing-card__fact">
                  <strong>对象</strong>
                  <span>{{ doing.object_keys.length }} 个</span>
                </span>
                <span class="doing-card__fact">
                  <strong>表现</strong>
                  <span>{{ summarizePresentation(doing) }}</span>
                </span>
              </div>
            </button>

            <div class="doing-card__footer">
              <span class="doing-card__status">
                {{ selectedDoing?.draftKey === doing.draftKey ? "当前已选中" : "点击卡片编辑" }}
              </span>
              <div class="doing-card__actions">
                <button class="btn-danger doing-card__button" type="button" @click="removeDoing(index)">
                  删除
                </button>
                <button class="btn-secondary doing-card__button" type="button" @click="openDoingEditor(doing)">
                  编辑
                </button>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="doing-dialog__empty">还没有行动。</div>
      </section>

      <Teleport to="body">
        <Transition name="fade">
          <div
            v-if="editingDoing"
            class="doing-editor-modal"
            @click.self="closeDoingEditor"
          >
            <OnceEventDetailPanel
              eyebrow="行动事件编辑"
              :event="editingDoingEvent"
              :event-locations="effectiveEventLocations"
              :item-ids="effectiveItemIds"
              :mode="editingDoing.isNew ? 'create' : 'edit'"
              :roles="effectiveRoles"
              :saving="saving"
              :scenes="effectiveScenes"
              :story="storyForEditor"
              :vals="validationVals"
              @close="closeDoingEditor"
              @quick-create-location="handleQuickCreateLocation"
              @quick-create-role="handleQuickCreateRole"
              @save="handleSaveDoingEvent"
            >
              <template #base-info-extra>
                <div class="doing-event-base-extra">
                  <label class="field">
                    <span class="field-label">所属菜单</span>
                    <select v-model="editingDoing.menu_id" class="select-input">
                      <option value="">未选择</option>
                      <option v-for="option in menuOptions" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                  </label>

                  <label class="field">
                    <span class="field-label">冷却时间（小时）</span>
                    <input v-model="editingDoing.cooldownHoursText" class="text-input" type="text">
                  </label>

                  <label class="doing-event-base-extra__check">
                    <input v-model="editingDoing.once" type="checkbox">
                    <span>一次性行动</span>
                  </label>
                </div>
              </template>

              <template #event-config-trigger>
                <div class="field doing-event-visible-config">
                  <div class="doing-event-visible-config__label-row">
                    <span class="field-label">显示条件 visible_expr</span>
                    <div class="doing-event-visible-config__tools">
                      <button
                        class="doing-dialog__help-button"
                        type="button"
                        aria-label="查看显示条件说明"
                        @click.stop="openStoryScriptHelp"
                      >
                        ?
                      </button>
                      <button
                        class="doing-dialog__validate-button"
                        type="button"
                        :disabled="getValidationState(getDoingValidationKey(editingDoing, 'visible_expr')).status === 'checking'"
                        @click="validateDoingMetaField(editingDoing, 'visible_expr')"
                      >
                        {{ getValidationButtonLabel(getDoingValidationKey(editingDoing, 'visible_expr')) }}
                      </button>
                    </div>
                  </div>
                  <StoryScriptTextarea
                    v-model="editingDoing.visible_expr"
                    min-height="96px"
                    mode="predicate"
                    :story="storyForEditor"
                    :vals="validationVals"
                    @update:model-value="resetValidationState(getDoingValidationKey(editingDoing, 'visible_expr'))"
                  />
                  <div
                    v-if="getValidationState(getDoingValidationKey(editingDoing, 'visible_expr')).status !== 'idle'"
                    class="doing-dialog__validation"
                    :class="getValidationClass(getDoingValidationKey(editingDoing, 'visible_expr'))"
                  >
                    <span
                      v-for="message in getValidationMessages(getDoingValidationKey(editingDoing, 'visible_expr'), '空条件，无需校验。', '条件可以执行。')"
                      :key="message"
                      class="doing-dialog__validation-message"
                    >
                      {{ message }}
                    </span>
                  </div>
                </div>
              </template>
            </OnceEventDetailPanel>
          </div>
        </Transition>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.doing-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.doing-dialog--embedded {
  position: relative;
  inset: auto;
  z-index: auto;
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  background: transparent;
  overflow: hidden;
}

.doing-dialog__panel {
  width: min(1320px, calc(100vw - 40px));
  max-height: calc(100dvh - 40px);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  padding: 18px;
  overflow: hidden;
  border-radius: 20px;
}

.doing-dialog--embedded .doing-dialog__panel {
  width: 100%;
  height: 100%;
  max-height: none;
  border-top-left-radius: 0;
  border-top-right-radius: 18px;
  border-bottom-right-radius: 18px;
  border-bottom-left-radius: 18px;
}

.doing-dialog__header,
.doing-dialog__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.doing-dialog__copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.doing-dialog__title,
.doing-dialog__section-title {
  margin: 0;
  color: var(--text);
  font-family: "Space Grotesk", sans-serif;
}

.doing-dialog__subtitle,
.doing-dialog__section-note,
.doing-dialog__success {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.86rem;
  line-height: 1.5;
}

.doing-dialog__success {
  color: var(--accent);
}

.doing-dialog__actions,
.doing-dialog__tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.doing-dialog__tab {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 8px 12px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
}

.doing-dialog__tab--active {
  color: #06121f;
  border-color: transparent;
  background: var(--accent);
}

.doing-dialog__section {
  min-height: 0;
  display: grid;
  gap: 14px;
  overflow: auto;
  padding-right: 4px;
}

.doing-dialog__table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.doing-dialog__table {
  width: 100%;
  min-width: 1180px;
  border-collapse: collapse;
}

.doing-dialog__table th,
.doing-dialog__table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.doing-dialog__table th {
  position: sticky;
  top: 0;
  background: rgba(9, 19, 30, 0.92);
  color: var(--text-muted);
  font-size: 0.82rem;
}

.doing-dialog__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.doing-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(124, 227, 195, 0.16);
  border-radius: 14px;
  background:
    linear-gradient(145deg, rgba(124, 227, 195, 0.08), rgba(255, 255, 255, 0.02)),
    rgba(8, 18, 29, 0.88);
  box-shadow: 0 14px 22px rgba(0, 0, 0, 0.18);
  transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}

.doing-card:hover {
  transform: translateY(-2px);
  border-color: rgba(124, 227, 195, 0.34);
}

.doing-card--active {
  border-color: rgba(124, 227, 195, 0.62);
  box-shadow:
    0 0 0 1px rgba(124, 227, 195, 0.22),
    0 16px 24px rgba(0, 0, 0, 0.22);
}

.doing-card__body {
  display: grid;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.doing-card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.doing-card__kind,
.doing-card__tag {
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(124, 227, 195, 0.12);
  color: rgba(174, 255, 229, 0.92);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
}

.doing-card__tag {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doing-card__title {
  color: #ecfff9;
  font-size: 0.96rem;
  line-height: 1.3;
}

.doing-card__id,
.doing-card__status {
  color: rgba(214, 222, 236, 0.72);
  font-size: 0.74rem;
}

.doing-card__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 10px;
}

.doing-card__fact {
  display: grid;
  gap: 2px;
}

.doing-card__fact strong {
  color: rgba(174, 255, 229, 0.72);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
}

.doing-card__fact span {
  color: rgba(242, 246, 255, 0.88);
  font-size: 0.82rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.doing-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.doing-card__actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.doing-card__button {
  min-height: 28px;
  padding: 5px 9px;
  font-size: 0.78rem;
}

.doing-dialog__script-field {
  display: grid;
  gap: 6px;
}

.doing-dialog__field-actions,
.doing-event-visible-config__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.doing-event-visible-config {
  display: grid;
  gap: 8px;
  align-content: start;
}

.doing-event-visible-config__tools {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.doing-dialog__validate-button {
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid rgba(124, 227, 195, 0.24);
  border-radius: 999px;
  color: var(--accent);
  background: rgba(124, 227, 195, 0.08);
  font-size: 0.74rem;
  white-space: nowrap;
}

.doing-dialog__validate-button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.doing-dialog__help-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 180, 84, 0.32);
  border-radius: 999px;
  background: rgba(255, 180, 84, 0.1);
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
}

.doing-dialog__validation {
  display: grid;
  gap: 4px;
  padding: 7px 9px;
  border: 1px solid rgba(186, 220, 255, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  font-size: 0.78rem;
  line-height: 1.4;
}

.doing-dialog__validation--passed {
  border-color: rgba(124, 227, 195, 0.3);
  color: var(--accent);
  background: rgba(124, 227, 195, 0.08);
}

.doing-dialog__validation--failed {
  border-color: rgba(255, 139, 123, 0.36);
  color: #ffb4a9;
  background: rgba(255, 139, 123, 0.08);
}

.doing-dialog__validation--checking {
  color: var(--text-muted);
}

.doing-dialog__validation-message {
  overflow-wrap: anywhere;
}

.doing-dialog__cell-input,
.doing-dialog__select,
.doing-dialog__mini-input {
  width: 100%;
  min-width: 0;
}

.doing-dialog__mini-input {
  max-width: 92px;
}

.doing-dialog__textarea {
  min-height: 72px;
  resize: vertical;
}

.doing-dialog__textarea--cell {
  min-height: 58px;
}

.doing-dialog__empty {
  border: 1px dashed var(--line);
  border-radius: 14px;
  padding: 24px;
  color: var(--text-muted);
  text-align: center;
}

.doing-editor-modal {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 12px;
  background: rgba(2, 8, 16, 0.74);
  backdrop-filter: blur(10px);
}

.doing-event-base-extra {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(140px, 180px) minmax(120px, auto);
  gap: 14px;
  align-items: end;
}

.doing-event-base-extra__check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  color: var(--text-muted);
  font-size: 0.86rem;
  white-space: nowrap;
}

@media (max-width: 960px) {
  .doing-dialog__header,
  .doing-dialog__section-head,
  .doing-dialog__actions,
  .doing-card__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .doing-card__facts,
  .doing-event-base-extra {
    grid-template-columns: 1fr;
  }
}
</style>
