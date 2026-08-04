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

/** 创建一份新的 `VarDraftId` 数据。 @returns 计算、查找或构建后的结果。 */
function createVarDraftId() {
  varIdSeed += 1
  return `action-var-${varIdSeed}`
}

/** 创建一份新的 `VarDraft` 数据。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
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

/** 把外部或服务端数据同步到本地响应式状态。 @param action 调用方传入的 `action`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(action: StoryActionFile | null) {
  draft.id = action?.id ?? ""
  draft.title = action?.title ?? ""
  draft.execScript = action?.exec_script ?? ""
  draft.vars = (action?.vars ?? []).map((actionVar) => createVarDraft(actionVar))
}

/** 新增一项 `VarRow` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addVarRow() {
  draft.vars.push(createVarDraft())
}

/** 移除指定的 `VarRow` 数据。 @param varId 调用方传入的 `varId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeVarRow(varId: string) {
  draft.vars = draft.vars.filter((item) => item.id !== varId)
}

/** 切换 `ExecScriptHelp` 的当前状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function toggleExecScriptHelp() {
  openStoryScriptReferencePage()
}

/** 关闭 `Autocomplete` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeAutocomplete() {
  autocompleteState.open = false
  autocompleteState.query = ""
  autocompleteState.replaceStart = 0
  autocompleteState.replaceEnd = 0
  autocompleteState.activeIndex = 0
  autocompleteState.placement = "bottom"
}

/** 执行 `updateAutocompleteFromCaret` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
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

/** 执行 `insertAutocompleteItem` 对应的局部业务逻辑。 @param itemName 调用方传入的 `itemName`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
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

/** 处理 `ExecScriptInput` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function onExecScriptInput() {
  updateAutocompleteFromCaret()
}

/** 处理 `ExecScriptKeydown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 处理 `ExecScriptScroll` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function onExecScriptScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement | null
  const highlightElement = execScriptFieldRef.value?.querySelector<HTMLElement>("[data-script-highlight]")

  if (!textarea || !highlightElement) {
    return
  }

  highlightElement.scrollTop = textarea.scrollTop
  highlightElement.scrollLeft = textarea.scrollLeft
}

/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 移除指定的 `NextNode` 数据。 @param nextNodeId 调用方传入的 `nextNodeId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

/** 处理 `DocumentPointerDown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

<style scoped src="./styles/GraphActionDetailPanel.css"></style>
