<script setup lang="ts">
/** 玩家“行动”配置弹窗：编排菜单与行动卡片，详情复用平面事件编辑器。 */
import { computed, reactive, shallowRef, watch } from "vue"
import type {
  StoryDocument,
  StoryDoingDefinition,
  StoryDoingFile,
  StoryDoingMenu,
  StoryOnceEventFile,
  StoryRolesFile,
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
import {
  EMPTY_EVENT_LOCATIONS,
  EMPTY_ROLES,
  EMPTY_SCENES,
  cloneDoingPresentation as clonePresentation,
  createDoingDraft as createDoingDraftValue,
  createDoingEditorEvent,
  createDoingMenuDraft,
  normalizeDoingNumberText as normalizeNumberText,
  parseDoingInteger as parseIntegerInput,
  sanitizeDoingId as sanitizeIdInput,
  type DoingDraft,
  type DoingMenuDraft
} from "./storyDoingDraft"
type DoingPredicateField = "visible_expr"
type ScriptValidationStatus = "idle" | "checking" | "passed" | "failed"
interface ScriptValidationState {
  status: ScriptValidationStatus
  issues: string[]
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
/** 创建一份新的 `DraftKey` 数据。 @param prefix 调用方传入的 `prefix`。 @returns 计算、查找或构建后的结果。 */
function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}
/** 读取或计算 `ValidationState`。 @param key 调用方传入的 `key`。 @returns 计算、查找或构建后的结果。 */
function getValidationState(key: string) {
  return scriptValidationState[key] ?? EMPTY_SCRIPT_VALIDATION_STATE
}
/** 执行 `ensureValidationState` 对应的局部业务逻辑。 @param key 调用方传入的 `key`。 @returns 计算、查找或构建后的结果。 */
function ensureValidationState(key: string) {
  scriptValidationState[key] ??= {
    status: "idle",
    issues: []
  }
  return scriptValidationState[key]
}
/** 重置或清理 `resetValidationState` 对应的临时状态。 @param key 调用方传入的 `key`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function resetValidationState(key: string) {
  delete scriptValidationState[key]
}
/** 重置或清理 `clearValidationStates` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
/** 读取或计算 `MenuValidationKey`。 @param menu 调用方传入的 `menu`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
function getMenuValidationKey(menu: DoingMenuDraft, field: DoingPredicateField) {
  return `menu:${menu.draftKey}:${field}`
}
/** 读取或计算 `DoingValidationKey`。 @param doing 调用方传入的 `doing`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
function getDoingValidationKey(doing: DoingDraft, field: DoingPredicateField) {
  return `doing:${doing.draftKey}:${field}`
}
/** 读取或计算 `ValidationButtonLabel`。 @param key 调用方传入的 `key`。 @returns 计算、查找或构建后的结果。 */
function getValidationButtonLabel(key: string) {
  return getValidationState(key).status === "checking" ? "校验中" : "校验"
}
/** 读取或计算 `ValidationClass`。 @param key 调用方传入的 `key`。 @returns 计算、查找或构建后的结果。 */
function getValidationClass(key: string) {
  return `doing-dialog__validation--${getValidationState(key).status}`
}
/** 读取或计算 `ValidationMessages`。 @param key 调用方传入的 `key`。 @param emptyMessage 调用方传入的 `emptyMessage`。 @param passedMessage 调用方传入的 `passedMessage`。 @returns 计算、查找或构建后的结果。 */
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
/** 执行 `sourceIsEmptyMessage` 对应的局部业务逻辑。 @param emptyMessage 调用方传入的 `emptyMessage`。 @param passedMessage 调用方传入的 `passedMessage`。 @returns 计算、查找或构建后的结果。 */
function sourceIsEmptyMessage(emptyMessage: string, passedMessage: string) {
  return passedMessage || emptyMessage
}
/** 校验 `ScriptSource` 并整理错误信息。 @param key 调用方传入的 `key`。 @param source 调用方传入的 `source`。 @param emptyMessage 调用方传入的 `emptyMessage`。 @param passedMessage 调用方传入的 `passedMessage`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
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
/** 校验 `MenuField` 并整理错误信息。 @param menu 调用方传入的 `menu`。 @param field 调用方传入的 `field`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
async function validateMenuField(menu: DoingMenuDraft, field: DoingPredicateField) {
  await validateScriptSource(
    getMenuValidationKey(menu, field),
    menu[field],
    "空条件，无需校验。",
    "条件可以执行。"
  )
}
/** 校验 `DoingMetaField` 并整理错误信息。 @param doing 调用方传入的 `doing`。 @param field 调用方传入的 `field`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
async function validateDoingMetaField(doing: DoingDraft, field: DoingPredicateField) {
  await validateScriptSource(
    getDoingValidationKey(doing, field),
    doing[field],
    "空条件，无需校验。",
    "条件可以执行。"
  )
}
/** 创建一份新的 `MenuDraft` 数据。 @param menu 调用方传入的 `menu`。 @returns 计算、查找或构建后的结果。 */
function createMenuDraft(menu: StoryDoingMenu): DoingMenuDraft {
  return createDoingMenuDraft(menu, createDraftKey)
}
/** 创建一份新的 `DoingDraft` 数据。 @param doing 调用方传入的 `doing`。 @param isNew 调用方传入的 `isNew`。 @returns 计算、查找或构建后的结果。 */
function createDoingDraft(doing: StoryDoingDefinition, isNew = false): DoingDraft {
  return createDoingDraftValue(doing, createDraftKey, isNew)
}
/** 查找 `DoingDraftKeyById` 对应的数据。 @param doingId 调用方传入的 `doingId`。 @returns 计算、查找或构建后的结果。 */
function findDoingDraftKeyById(doingId: string | null) {
  if (!doingId) {
    return null
  }

  return draft.doings.find((doing) => doing.id === doingId)?.draftKey ?? null
}
/** 把外部或服务端数据同步到本地响应式状态。 @param doing 调用方传入的 `doing`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
/** 读取或计算 `ParentMenuOptions`。 @param menu 调用方传入的 `menu`。 @returns 计算、查找或构建后的结果。 */
function getParentMenuOptions(menu: DoingMenuDraft) {
  return menuOptions.value.filter((option) => option.value !== menu.id)
}
/** 读取或计算 `DoingMenuLabel`。 @param doing 调用方传入的 `doing`。 @returns 计算、查找或构建后的结果。 */
function getDoingMenuLabel(doing: DoingDraft) {
  return doing.menu_id.trim()
    ? menuLabelMap.value.get(doing.menu_id) ?? doing.menu_id
    : "未选择菜单"
}
/** 执行 `summarizeCondition` 对应的局部业务逻辑。 @param source 调用方传入的 `source`。 @returns 计算、查找或构建后的结果。 */
function summarizeCondition(source: string) {
  const trimmed = source.trim()
  if (!trimmed) {
    return "始终通过"
  }

  return trimmed.length > 56 ? `${trimmed.slice(0, 56)}...` : trimmed
}
/** 执行 `summarizePresentation` 对应的局部业务逻辑。 @param doing 调用方传入的 `doing`。 @returns 计算、查找或构建后的结果。 */
function summarizePresentation(doing: DoingDraft) {
  if (doing.presentation.type === "silent") {
    return "静默"
  }

  if (doing.presentation.type === "message") {
    return "消息"
  }

  return `${doing.presentation.dialogues.length} 条对白`
}
/** 打开 `StoryScriptHelp` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openStoryScriptHelp() {
  openStoryScriptReferencePage()
}
/** 执行 `nextUniqueId` 对应的局部业务逻辑。 @param base 调用方传入的 `base`。 @param usedIds 调用方传入的 `usedIds`。 @returns 计算、查找或构建后的结果。 */
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
/** 新增一项 `Menu` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
/** 移除指定的 `Menu` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
/** 创建一份新的 `EmptyDoingDefinition` 数据。 @param id 调用方传入的 `id`。 @returns 计算、查找或构建后的结果。 */
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
/** 新增一项 `Doing` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addDoing() {
  const usedIds = new Set(draft.doings.map((doing) => doing.id))
  const id = nextUniqueId(`doing_${draft.doings.length + 1}`, usedIds)
  const nextDoing = createDoingDraft(createEmptyDoingDefinition(id), true)

  draft.doings.push(nextDoing)
  selectedDoingDraftKey.value = nextDoing.draftKey
  editingDoingDraftKey.value = nextDoing.draftKey
  activeTab.value = "doings"
}
/** 移除指定的 `Doing` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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
/** 打开 `DoingEditor` 界面并初始化临时状态。 @param doing 调用方传入的 `doing`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openDoingEditor(doing: DoingDraft) {
  selectedDoingDraftKey.value = doing.draftKey
  editingDoingDraftKey.value = doing.draftKey
}
/** 关闭 `DoingEditor` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeDoingEditor() {
  editingDoingDraftKey.value = null
}
/** 执行 `mergeEventIntoDoing` 对应的局部业务逻辑。 @param doing 调用方传入的 `doing`。 @param event 调用方传入的 `event`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
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
/** 执行 `serializeDoing` 对应的局部业务逻辑。 @param doing 调用方传入的 `doing`。 @returns 计算、查找或构建后的结果。 */
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
/** 根据当前输入构建 `DoingFile` 结果。 @returns 计算、查找或构建后的结果。 */
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
/** 处理 `Save` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleSave() {
  pendingEditingIdAfterSync = editingDoing.value?.id ?? null
  emit("save", buildDoingFile())
}
/** 处理 `SaveDoingEvent` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleSaveDoingEvent(event: StoryOnceEventFile) {
  const target = editingDoing.value
  if (!target) {
    return
  }

  mergeEventIntoDoing(target, event)
  pendingEditingIdAfterSync = event.id
  emit("save", buildDoingFile())
}
/** 处理 `QuickCreateLocation` 用户交互。 @param payload 调用方传入的 `payload`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleQuickCreateLocation(payload: StoryQuickCreateLocationPayload) {
  emit("quickCreateLocation", payload)
}
/** 处理 `QuickCreateRole` 用户交互。 @param payload 调用方传入的 `payload`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

<style scoped src="./styles/StoryDoingDialog.css"></style>
