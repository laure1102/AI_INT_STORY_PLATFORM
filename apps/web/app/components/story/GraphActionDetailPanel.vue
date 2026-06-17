<script setup lang="ts">
import type { StoryActionFile, StoryDocument, StoryValsFile } from "@story-mgr/core"
import {
  buildStoryScriptBuiltinAutocompleteItems,
  buildStoryScriptHighlightTokens,
  buildStoryReferAutocompleteItems,
  buildStoryScriptValAutocompleteItems,
  filterStoryScriptAutocompleteItems,
  mergeStoryScriptAutocompleteItems,
  normalizeStoryScriptAutocompleteText,
  openStoryScriptReferencePage,
  resolveStoryScriptAutocompletePlacement,
  type StoryScriptAutocompleteItem
} from "./storyScriptEditor"

interface ActionVarDraft {
  id: string
  name: string
  descr: string
  initialValue: string
}

interface ScriptAutocompleteState {
  open: boolean
  query: string
  replaceStart: number
  replaceEnd: number
  activeIndex: number
  placement: "top" | "bottom"
}

interface GraphNodeOption {
  id: string
  title: string
  type: "event" | "action"
}

const props = defineProps<{
  action: StoryActionFile | null
  graphNodeOptions: GraphNodeOption[]
  mode?: "create" | "edit"
  saving: boolean
  story?: StoryDocument | null
  vals: StoryValsFile
}>()

const emit = defineEmits<{
  close: []
  save: [action: StoryActionFile]
}>()

const activeTab = shallowRef<"basic" | "next">("basic")

const execScriptFieldRef = useTemplateRef<HTMLDivElement>("execScriptField")
const execScriptTextareaRef = useTemplateRef<HTMLTextAreaElement>("execScriptTextarea")
const autocompleteState = reactive<ScriptAutocompleteState>({
  open: false,
  query: "",
  replaceStart: 0,
  replaceEnd: 0,
  activeIndex: 0,
  placement: "bottom"
})

const draft = reactive({
  id: "",
  title: "",
  vars: [] as ActionVarDraft[],
  execScript: ""
})

let varIdSeed = 0

function createVarDraftId() {
  varIdSeed += 1
  return `action-var-${varIdSeed}`
}

function createVarDraft(value?: { descr?: string; initial_value?: string; name?: string }): ActionVarDraft {
  return {
    id: createVarDraftId(),
    name: value?.name ?? "",
    descr: value?.descr ?? "",
    initialValue: value?.initial_value ?? ""
  }
}

const globalAutocompleteCandidates = computed(() => {
  return mergeStoryScriptAutocompleteItems(
    buildStoryScriptBuiltinAutocompleteItems(),
    buildStoryScriptValAutocompleteItems(props.vals),
    buildStoryReferAutocompleteItems(props.story)
  )
})

const branchVarAutocompleteCandidates = computed<StoryScriptAutocompleteItem[]>(() => {
  const seen = new Set<string>()

  return draft.vars.flatMap((actionVar) => {
    const name = normalizeStoryScriptAutocompleteText(actionVar.name)

    if (!name || seen.has(name)) {
      return []
    }

    seen.add(name)

    return [{
      name: `branch.${name}`,
      description: normalizeStoryScriptAutocompleteText(actionVar.descr)
    }]
  })
})

const autocompleteItems = computed(() => {
  return filterStoryScriptAutocompleteItems(
    autocompleteState.query,
    mergeStoryScriptAutocompleteItems(
      branchVarAutocompleteCandidates.value,
      globalAutocompleteCandidates.value
    )
  )
})

const activeAutocompleteItem = computed(() => {
  if (!autocompleteState.open || autocompleteItems.value.length === 0) {
    return null
  }

  return autocompleteItems.value[autocompleteState.activeIndex % autocompleteItems.value.length]
})

const highlightedExecScriptTokens = computed(() => buildStoryScriptHighlightTokens(draft.execScript))

const panelTitle = computed(() => {
  if (draft.title.trim()) {
    return draft.title.trim()
  }

  return props.mode === "create" ? "未命名操作" : (props.action?.title ?? "操作节点")
})

const panelEyebrow = computed(() => {
  return props.mode === "create" ? "新操作节点" : "操作节点编辑"
})

const submitLabel = computed(() => {
  return props.saving ? "保存中..." : "保存"
})

const linkedNextNodes = computed(() => {
  const currentAction = props.action

  if (!currentAction) {
    return []
  }

  return currentAction.next.map((nodeId) => {
    const matchedNode = props.graphNodeOptions.find((node) => node.id === nodeId)
    return {
      id: nodeId,
      title: matchedNode?.title ?? nodeId,
      type: matchedNode?.type ?? "event"
    }
  })
})

function syncDraft(action: StoryActionFile | null) {
  draft.id = action?.id ?? ""
  draft.title = action?.title ?? ""
  draft.execScript = action?.exec_script ?? ""
  draft.vars = (action?.vars ?? []).map((actionVar) => createVarDraft(actionVar))
}

function addVarRow() {
  draft.vars.push(createVarDraft())
}

function removeVarRow(varId: string) {
  draft.vars = draft.vars.filter((item) => item.id !== varId)
}

function toggleExecScriptHelp() {
  openStoryScriptReferencePage()
}

function closeAutocomplete() {
  autocompleteState.open = false
  autocompleteState.query = ""
  autocompleteState.replaceStart = 0
  autocompleteState.replaceEnd = 0
  autocompleteState.activeIndex = 0
  autocompleteState.placement = "bottom"
}

function updateAutocompleteFromCaret() {
  const textarea = execScriptTextareaRef.value
  const fieldValue = draft.execScript

  if (!textarea) {
    closeAutocomplete()
    return
  }

  const caret = textarea.selectionStart ?? fieldValue.length
  const beforeCaret = fieldValue.slice(0, caret)
  const openPlaceholderIndex = beforeCaret.lastIndexOf("${")

  if (
    openPlaceholderIndex < 0 ||
    beforeCaret.slice(openPlaceholderIndex + 2).includes("}")
  ) {
    closeAutocomplete()
    return
  }

  autocompleteState.open = true
  autocompleteState.query = beforeCaret.slice(openPlaceholderIndex + 2)
  autocompleteState.replaceStart = openPlaceholderIndex
  autocompleteState.replaceEnd = caret
  autocompleteState.placement = resolveStoryScriptAutocompletePlacement(textarea)

  if (autocompleteItems.value.length === 0) {
    autocompleteState.activeIndex = 0
  } else if (autocompleteState.activeIndex >= autocompleteItems.value.length) {
    autocompleteState.activeIndex = 0
  }
}

function insertAutocompleteItem(itemName: string) {
  const replaceStart = autocompleteState.replaceStart
  draft.execScript =
    draft.execScript.slice(0, replaceStart + 2) +
    itemName +
    "}" +
    draft.execScript.slice(autocompleteState.replaceEnd)

  closeAutocomplete()

  requestAnimationFrame(() => {
    const nextCaret = replaceStart + itemName.length + 3
    execScriptTextareaRef.value?.focus()
    execScriptTextareaRef.value?.setSelectionRange(nextCaret, nextCaret)
  })
}

function onExecScriptInput() {
  updateAutocompleteFromCaret()
}

function onExecScriptKeydown(event: KeyboardEvent) {
  if (!autocompleteState.open) {
    if (event.key === "Escape") {
      closeAutocomplete()
    }
    return
  }

  if (event.key === "Escape") {
    event.preventDefault()
    closeAutocomplete()
    return
  }

  if (event.key === "ArrowDown") {
    event.preventDefault()
    const length = Math.max(autocompleteItems.value.length, 1)
    autocompleteState.activeIndex = (autocompleteState.activeIndex + 1) % length
    return
  }

  if (event.key === "ArrowUp") {
    event.preventDefault()
    const length = Math.max(autocompleteItems.value.length, 1)
    autocompleteState.activeIndex = (autocompleteState.activeIndex - 1 + length) % length
    return
  }

  if (event.key === "Enter" || event.key === "Tab") {
    const item = activeAutocompleteItem.value

    if (!item) {
      return
    }

    event.preventDefault()
    insertAutocompleteItem(item.name)
  }
}

function onExecScriptScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement | null
  const highlightElement = execScriptFieldRef.value?.querySelector<HTMLElement>("[data-script-highlight]")

  if (!textarea || !highlightElement) {
    return
  }

  highlightElement.scrollTop = textarea.scrollTop
  highlightElement.scrollLeft = textarea.scrollLeft
}

function submitDraft() {
  if (!props.action) {
    return
  }

  emit("save", {
    ...props.action,
    id: draft.id.trim(),
    title: draft.title.trim(),
    vars: draft.vars.map((item) => ({
      name: item.name.trim(),
      descr: item.descr.trim(),
      initial_value: item.initialValue.trim()
    })),
    exec_script: draft.execScript.trim(),
    next: props.action.next
  })
}

function removeNextNode(nextNodeId: string) {
  if (!props.action) {
    return
  }

  if (!window.confirm("确认删除这个后续节点连接吗？")) {
    return
  }

  emit("save", {
    ...props.action,
    next: props.action.next.filter((id) => id !== nextNodeId)
  })
}

watch(
  () => props.action,
  (action) => {
    syncDraft(action)
    closeAutocomplete()
    activeTab.value = "basic"
  },
  { immediate: true }
)

onMounted(() => {
  document.addEventListener("mousedown", handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleDocumentPointerDown)
})

function handleDocumentPointerDown(event: MouseEvent) {
  const target = event.target as Node | null

  if (!autocompleteState.open) {
    return
  }

  if (execScriptFieldRef.value && target && execScriptFieldRef.value.contains(target)) {
    return
  }

  closeAutocomplete()
}
</script>

<template>
  <section class="action-detail-panel glass-panel">
    <template v-if="action">
      <div class="action-detail-panel__header">
        <div class="action-detail-panel__header-copy">
          <span class="eyebrow">{{ panelEyebrow }}</span>
          <h2 class="action-detail-panel__title">{{ panelTitle }}</h2>
        </div>
      </div>

      <div class="action-detail-panel__tabs" role="tablist" aria-label="操作节点编辑标签">
        <button
          class="action-detail-panel__tab"
          :class="{ 'action-detail-panel__tab--active': activeTab === 'basic' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'basic'"
          @click="activeTab = 'basic'"
        >
          基础信息
        </button>
        <button
          class="action-detail-panel__tab"
          :class="{ 'action-detail-panel__tab--active': activeTab === 'next' }"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'next'"
          @click="activeTab = 'next'"
        >
          后续节点
        </button>
      </div>

      <div v-if="activeTab === 'basic'" class="action-detail-panel__body">
        <section class="action-detail-card">
          <h3 class="action-detail-card__title">基础信息</h3>
          <div class="action-detail-grid">
            <label class="field">
              <span class="field-label">操作 ID</span>
              <input
                v-model="draft.id"
                class="text-input"
                type="text"
                :readonly="props.mode !== 'create'"
              />
            </label>

            <label class="field">
              <span class="field-label">标题</span>
              <input v-model="draft.title" class="text-input" type="text" />
            </label>
          </div>
        </section>

        <section class="action-detail-card">
          <div class="action-detail-card__table-head">
            <h3 class="action-detail-card__title">连接变量</h3>
            <button class="btn-secondary" type="button" @click="addVarRow">新增变量</button>
          </div>

          <div class="action-vars">
            <table class="action-vars__table">
              <thead>
                <tr>
                  <th>名字</th>
                  <th>描述</th>
                  <th>初始值</th>
                  <th class="action-vars__actions">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="actionVar in draft.vars" :key="actionVar.id">
                  <td>
                    <input v-model="actionVar.name" class="text-input action-vars__input" type="text" />
                  </td>
                  <td>
                    <input v-model="actionVar.descr" class="text-input action-vars__input" type="text" />
                  </td>
                  <td>
                    <input
                      v-model="actionVar.initialValue"
                      class="text-input action-vars__input"
                      type="text"
                    />
                  </td>
                  <td class="action-vars__actions">
                    <button
                      class="btn-secondary action-vars__remove"
                      type="button"
                      @click="removeVarRow(actionVar.id)"
                    >
                      删除
                    </button>
                  </td>
                </tr>
                <tr v-if="draft.vars.length === 0">
                  <td colspan="4" class="action-vars__empty">还没有连接变量</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="action-detail-card">
          <div ref="execScriptField" class="field">
            <div class="action-detail-panel__label-row">
              <span class="field-label">执行脚本</span>
              <div class="action-detail-panel__help">
                <button
                  class="action-detail-panel__help-button"
                  type="button"
                  aria-label="查看执行脚本说明"
                  @click.stop="toggleExecScriptHelp"
                >
                  ?
                </button>
              </div>
            </div>

            <div class="action-detail-panel__script-wrap">
              <div class="action-detail-panel__script-editor">
                <pre class="action-detail-panel__script-highlight" data-script-highlight aria-hidden="true"><code><template
                      v-for="(token, index) in highlightedExecScriptTokens"
                      :key="`exec-${index}`"
                    ><span
                        :class="[
                          'action-detail-panel__script-token',
                          token.highlighted ? 'action-detail-panel__script-token--keyword' : ''
                        ]"
                        v-html="token.text"
                      /></template></code></pre>
                <textarea
                  ref="execScriptTextarea"
                  v-model="draft.execScript"
                  class="text-area action-detail-panel__script-textarea"
                  spellcheck="false"
                  placeholder="let nextMood = ${branch.mood}\nif (${county.level} > 3) {\n  nextMood = 'serious'\n}"
                  @input="onExecScriptInput"
                  @click="updateAutocompleteFromCaret"
                  @keyup="updateAutocompleteFromCaret"
                  @keydown="onExecScriptKeydown"
                  @scroll="onExecScriptScroll"
                />
              </div>

              <div
                v-if="autocompleteState.open"
                class="action-detail-panel__autocomplete"
                :class="{
                  'action-detail-panel__autocomplete--top': autocompleteState.placement === 'top'
                }"
              >
                <button
                  v-for="(item, index) in autocompleteItems"
                  :key="item.name"
                  class="action-detail-panel__autocomplete-item"
                  :class="{
                    'action-detail-panel__autocomplete-item--active':
                      index === autocompleteState.activeIndex
                  }"
                  type="button"
                  @mousedown.prevent="insertAutocompleteItem(item.name)"
                >
                  <span class="action-detail-panel__autocomplete-name">{{ item.name }}</span>
                  <span
                    v-if="item.description"
                    class="action-detail-panel__autocomplete-description"
                  >
                    {{ item.description }}
                  </span>
                </button>

                <div
                  v-if="!autocompleteItems.length"
                  class="action-detail-panel__autocomplete-empty"
                >
                  没有匹配的变量
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div v-else class="action-detail-panel__body">
        <section class="action-detail-card">
          <div class="action-detail-card__table-head">
            <div class="action-detail-panel__next-heading">
              <h3 class="action-detail-card__title">后续节点</h3>
              <span class="action-detail-panel__next-summary">这里维护这个操作当前连接到的事件</span>
            </div>
          </div>

          <div v-if="linkedNextNodes.length" class="action-next-list">
            <div v-for="node in linkedNextNodes" :key="node.id" class="action-next-list__item">
              <div class="action-next-list__copy">
                <div class="action-next-list__meta">
                  <span class="action-next-list__type">事件</span>
                  <span class="action-next-list__id">{{ node.id }}</span>
                </div>
                <strong>{{ node.title }}</strong>
              </div>
              <button class="action-next-list__remove" type="button" @click="removeNextNode(node.id)">
                删除
              </button>
            </div>
          </div>
          <div v-else class="action-vars__empty">当前还没有后续节点</div>
        </section>
      </div>

      <div class="action-detail-panel__footer">
        <button class="btn-secondary" type="button" :disabled="props.saving" @click="emit('close')">
          关闭
        </button>
        <button class="btn-primary" type="button" :disabled="props.saving" @click="submitDraft">
          {{ submitLabel }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.action-detail-panel {
  width: min(960px, calc(100vw - 48px));
  max-height: min(860px, calc(100dvh - 48px));
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
}

.action-detail-panel__header-copy {
  display: grid;
  gap: 6px;
}

.action-detail-panel__title {
  margin: 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.3rem;
}

.action-detail-panel__tabs {
  display: inline-flex;
  align-items: flex-end;
  gap: 0;
  padding: 4px 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.action-detail-panel__tab {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 12px 12px 0 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transform: translateY(1px);
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.action-detail-panel__tab--active {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(8, 15, 26, 0.92);
  color: var(--text-main);
  box-shadow: inset 0 2px 0 rgba(124, 227, 195, 0.5);
}

.action-detail-panel__tab:hover:not(.action-detail-panel__tab--active) {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-main);
}

.action-detail-panel__body {
  display: grid;
  gap: 14px;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.action-detail-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: rgba(8, 15, 26, 0.58);
}

.action-detail-card__title {
  margin: 0;
  font-size: 0.96rem;
}

.action-detail-card__table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.action-detail-panel__next-summary {
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

.action-detail-panel__next-heading {
  display: grid;
  gap: 4px;
}

.action-detail-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.action-vars {
  overflow-x: auto;
}

.action-vars__table {
  width: 100%;
  border-collapse: collapse;
}

.action-vars__table th,
.action-vars__table td {
  padding: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  text-align: left;
  vertical-align: top;
}

.action-vars__table th {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 600;
}

.action-vars__input {
  min-width: 160px;
}

.action-vars__actions {
  width: 88px;
  text-align: right;
}

.action-vars__remove {
  min-height: 30px;
  padding: 0 12px;
}

.action-vars__empty {
  color: var(--text-muted);
  text-align: center;
  padding: 18px 10px;
}

.action-next-list,
.action-next-picker {
  display: grid;
  gap: 8px;
}

.action-next-list__item,
.action-next-picker__item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
    rgba(7, 13, 23, 0.72);
}

.action-next-picker__item {
  width: 100%;
  text-align: left;
  color: var(--text-main);
  cursor: pointer;
}

.action-next-picker__item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-next-list__copy,
.action-next-picker__item {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.action-next-list__copy span,
.action-next-picker__item span {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.action-next-list__copy strong {
  font-size: 0.95rem;
  line-height: 1.35;
}

.action-next-list__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.action-next-list__type {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(124, 227, 195, 0.24);
  border-radius: 999px;
  background: rgba(124, 227, 195, 0.1);
  color: #c8fff0;
  font-size: 0.72rem;
  line-height: 1;
}

.action-next-list__id {
  color: var(--text-dim);
  font-size: 0.74rem;
  font-family: "IBM Plex Mono", "Fira Code", monospace;
  word-break: break-all;
}

.action-next-list__remove {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(255, 122, 122, 0.2);
  border-radius: 10px;
  background: rgba(255, 122, 122, 0.08);
  color: #ffd1d1;
  cursor: pointer;
}

.action-next-list__remove:hover {
  background: rgba(255, 122, 122, 0.14);
}

.action-detail-panel__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.action-detail-panel__help {
  position: relative;
}

.action-detail-panel__help-button {
  width: 24px;
  height: 24px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-main);
  cursor: pointer;
}

.action-detail-panel__script-wrap {
  position: relative;
}

.action-detail-panel__script-editor {
  position: relative;
  min-height: 240px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(5, 10, 18, 0.86);
  overflow: hidden;
}

.action-detail-panel__script-highlight,
.action-detail-panel__script-textarea {
  margin: 0;
  padding: 14px 16px;
  font-family: "IBM Plex Mono", "Fira Code", monospace;
  font-size: 0.86rem;
  line-height: 1.6;
  white-space: pre;
  overflow: auto;
}

.action-detail-panel__script-highlight {
  position: absolute;
  inset: 0;
  color: rgba(255, 255, 255, 0.92);
  pointer-events: none;
}

.action-detail-panel__script-textarea {
  position: relative;
  width: 100%;
  min-height: 240px;
  border: 0;
  background: transparent;
  color: transparent;
  caret-color: var(--text-main);
  resize: vertical;
}

.action-detail-panel__script-textarea::selection {
  background: rgba(124, 227, 195, 0.24);
}

.action-detail-panel__script-token--keyword {
  color: #79b7ff;
}

.action-detail-panel__autocomplete {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow: auto;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(6, 12, 20, 0.98);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.3);
  z-index: 12;
}

.action-detail-panel__autocomplete--top {
  top: auto;
  bottom: calc(100% + 8px);
}

.action-detail-panel__autocomplete-item {
  width: 100%;
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-main);
  text-align: left;
  cursor: pointer;
}

.action-detail-panel__autocomplete-item:hover,
.action-detail-panel__autocomplete-item--active {
  background: rgba(124, 227, 195, 0.12);
}

.action-detail-panel__autocomplete-name {
  font-family: "IBM Plex Mono", "Fira Code", monospace;
  font-size: 0.82rem;
}

.action-detail-panel__autocomplete-description,
.action-detail-panel__autocomplete-empty {
  color: var(--text-muted);
  font-size: 0.76rem;
}

.action-detail-panel__autocomplete-empty {
  padding: 10px 12px;
}

.action-detail-panel__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 900px) {
  .action-detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .action-detail-panel {
    width: min(100vw - 20px, 100%);
    max-height: calc(100dvh - 20px);
    padding: 16px;
  }

  .action-detail-card__table-head,
  .action-detail-panel__label-row,
  .action-detail-panel__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .action-vars__actions {
    width: 100px;
  }
}
</style>
