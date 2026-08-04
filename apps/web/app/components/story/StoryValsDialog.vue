<script setup lang="ts">
/** 变量配置弹窗：维护变量组，并在保存前预览 calc 表达式。 */
import type {
  StoryValDefinition,
  StoryValEntryDefinition,
  StoryValsFile
} from "@story-mgr/core"
import {
  DEFAULT_MAX_CALC_NESTING_DEPTH,
  evaluateStoryValCalcRule,
  formatStoryValInput,
  parseStoryValInput
} from "@story-mgr/core"
import {
  cloneStoryValGroup,
  createEmptyStoryValGroup,
  createEmptyStoryValRow,
  normalizeStoryValText as normalizeText,
  normalizeStoryValValueType as normalizeValueType,
  type CalcEvaluationResult,
  type CalcValueDisplay,
  type StoryValGroupDraft,
  type StoryValRowDraft
} from "./storyValsDraft"

const props = withDefaults(defineProps<{
  eyebrow?: string
  title?: string
  vals: StoryValsFile
  saving: boolean
}>(), {
  eyebrow: "\u5168\u5c40\u53d8\u91cf",
  title: "\u5168\u5c40\u53d8\u91cf\u8bbe\u7f6e"
})

const emit = defineEmits<{
  close: []
  save: [vals: StoryValsFile]
}>()

const activeTabIndex = shallowRef(0)
const draft = reactive<{
  variables: StoryValGroupDraft[]
}>({
  variables: []
})
const calcEditorState = reactive({
  groupKey: "",
  rowKey: ""
})
const calcRuleTextarea = useTemplateRef<HTMLTextAreaElement>("calcRuleTextarea")
const MAX_CALC_NESTING_DEPTH = DEFAULT_MAX_CALC_NESTING_DEPTH
const calcAutocompleteState = reactive({
  open: false,
  query: "",
  replaceStart: 0,
  replaceEnd: 0,
  activeIndex: 0
})

const activeGroup = computed(() => draft.variables[activeTabIndex.value] ?? null)
/** 将 `RowName` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeRowName(value: unknown) {
  return normalizeText(value).trim()
}
/** 将 `GroupName` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeGroupName(value: unknown) {
  return normalizeText(value).trim()
}

const editingCalcGroup = computed(() => {
  return draft.variables.find((group) => group.draftKey === calcEditorState.groupKey) ?? null
})

const editingCalcRow = computed(() => {
  return editingCalcGroup.value?.vals.find((row) => row.draftKey === calcEditorState.rowKey) ?? null
})

const isCalcEditorOpen = computed(() => !!editingCalcRow.value)
const activeGroupVariableCount = computed(() => activeGroup.value?.vals.length ?? 0)
const calcAutocompleteItems = computed(() => {
  if (!editingCalcGroup.value || !editingCalcRow.value) {
    return []
  }

  const currentRowName = normalizeRowName(editingCalcRow.value.name)
  const seen = new Set<string>()
  const candidates = draft.variables.flatMap((group) => {
    const groupName = normalizeGroupName(group.name)

    return group.vals
      .map((row) => {
        const rowName = normalizeRowName(row.name)

        if (!rowName) {
          return null
        }

        const isCurrentGroup = group.draftKey === editingCalcGroup.value?.draftKey
        const isCurrentRow = isCurrentGroup && rowName === currentRowName

        if (isCurrentRow) {
          return null
        }

        return {
          name: isCurrentGroup ? rowName : `${groupName}.${rowName}`,
          description: isCurrentGroup
            ? normalizeText(row.description)
            : [groupName, normalizeText(row.description)].filter(Boolean).join(" / ")
        }
      })
      .filter((item): item is { name: string; description: string } => {
        return !!item?.name && (!!groupName || group.draftKey === editingCalcGroup.value?.draftKey)
      })
  }).filter((item) => {
    if (seen.has(item.name)) {
      return false
    }

    seen.add(item.name)
    return true
  })

  const query = calcAutocompleteState.query.trim().toLowerCase()

  if (!query) {
    return candidates
  }

  return candidates.filter((item) => {
    return (
      item.name.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    )
  })
})
const isCalcAutocompleteOpen = computed(() => {
  return calcAutocompleteState.open && !!editingCalcRow.value
})
const activeCalcAutocompleteItem = computed(() => {
  if (!isCalcAutocompleteOpen.value || calcAutocompleteItems.value.length === 0) {
    return null
  }

  return calcAutocompleteItems.value[
    calcAutocompleteState.activeIndex % calcAutocompleteItems.value.length
  ]
})

const hasInvalidDraft = computed(() => {
  return draft.variables.some(
    (group) =>
      !normalizeText(group.name).trim() ||
      group.vals.some(
        (row) =>
          !normalizeText(row.name).trim() ||
          (normalizeValueType(row.valueType) === "calc" && !normalizeText(row.calcRule).trim())
      )
  )
})

let draftKeySeed = 0
/** 创建一份新的 `DraftKey` 数据。 @param prefix 调用方传入的 `prefix`。 @returns 计算、查找或构建后的结果。 */
function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}
/** 创建一份新的 `EmptyRow` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyRow(): StoryValRowDraft {
  return createEmptyStoryValRow(createDraftKey)
}
/** 创建一份新的 `EmptyGroup` 数据。 @param index 调用方传入的 `index`。 @returns 计算、查找或构建后的结果。 */
function createEmptyGroup(index: number): StoryValGroupDraft {
  return createEmptyStoryValGroup(index, createDraftKey)
}
/** 复制 `Group`，避免共享可变引用。 @param group 调用方传入的 `group`。 @returns 计算、查找或构建后的结果。 */
function cloneGroup(group: StoryValDefinition): StoryValGroupDraft {
  return cloneStoryValGroup(group, createDraftKey)
}
/** 执行 `ensureGroupExists` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function ensureGroupExists() {
  if (draft.variables.length === 0) {
    draft.variables.push(createEmptyGroup(1))
  }

  if (activeTabIndex.value >= draft.variables.length) {
    activeTabIndex.value = draft.variables.length - 1
  }
}
/** 把外部或服务端数据同步到本地响应式状态。 @param vals 调用方传入的 `vals`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(vals: StoryValsFile) {
  draft.variables = vals.variables.map(cloneGroup)
  activeTabIndex.value = 0
  ensureGroupExists()
}
/** 更新 `ActiveTab` 对应的响应式值。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setActiveTab(index: number) {
  activeTabIndex.value = index
}
/** 新增一项 `Group` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addGroup() {
  draft.variables.push(createEmptyGroup(draft.variables.length + 1))
  activeTabIndex.value = draft.variables.length - 1
}
/** 移除指定的 `Group` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeGroup(index: number) {
  const group = draft.variables[index]

  if (!group) {
    return
  }

  const groupLabel = getGroupLabel(group, index)
  const variableCount = group.vals.length
  const confirmed =
    typeof window === "undefined"
      ? true
      : window.confirm(
          `确认删除分组“${groupLabel}”吗？\n\n该分组下共有 ${variableCount} 个变量，删除后无法撤销。`
        )

  if (!confirmed) {
    return
  }

  draft.variables.splice(index, 1)
  ensureGroupExists()
}
/** 新增一项 `Row` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addRow() {
  activeGroup.value?.vals.push(createEmptyRow())
}
/** 移除指定的 `Row` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeRow(index: number) {
  activeGroup.value?.vals.splice(index, 1)
}
/** 读取或计算 `GroupLabel`。 @param group 调用方传入的 `group`。 @param index 调用方传入的 `index`。 @returns 计算、查找或构建后的结果。 */
function getGroupLabel(group: StoryValGroupDraft, index: number) {
  return normalizeText(group.name).trim() || `\u672a\u547d\u540d\u5206\u7ec4 ${index + 1}`
}
/** 判断 `isValueMode` 对应的条件是否成立。 @param row 调用方传入的 `row`。 @returns 布尔判断结果。 */
function isValueMode(row: StoryValRowDraft) {
  return normalizeValueType(row.valueType) === "value"
}
/** 打开 `CalcEditor` 界面并初始化临时状态。 @param group 调用方传入的 `group`。 @param row 调用方传入的 `row`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openCalcEditor(group: StoryValGroupDraft, row: StoryValRowDraft) {
  if (isValueMode(row)) {
    return
  }

  closeCalcAutocomplete()
  calcEditorState.groupKey = group.draftKey
  calcEditorState.rowKey = row.draftKey
}
/** 关闭 `CalcEditor` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeCalcEditor() {
  calcEditorState.groupKey = ""
  calcEditorState.rowKey = ""
  closeCalcAutocomplete()
}
/** 关闭 `CalcAutocomplete` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeCalcAutocomplete() {
  calcAutocompleteState.open = false
  calcAutocompleteState.query = ""
  calcAutocompleteState.replaceStart = 0
  calcAutocompleteState.replaceEnd = 0
  calcAutocompleteState.activeIndex = 0
}
/** 读取或计算 `CalcRuleTextareaValue`。 @returns 计算、查找或构建后的结果。 */
function getCalcRuleTextareaValue() {
  return editingCalcRow.value?.calcRule ?? ""
}
/** 更新 `CalcRuleTextareaValue` 对应的响应式值。 @param value 调用方传入的 `value`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setCalcRuleTextareaValue(value: string) {
  if (editingCalcRow.value) {
    editingCalcRow.value.calcRule = value
  }
}
/** 执行 `updateCalcAutocompleteFromCaret` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function updateCalcAutocompleteFromCaret() {
  const textarea = calcRuleTextarea.value
  const calcRule = getCalcRuleTextareaValue()

  if (!textarea) {
    closeCalcAutocomplete()
    return
  }

  const caret = textarea.selectionStart ?? calcRule.length
  const beforeCaret = calcRule.slice(0, caret)
  const openBraceIndex = beforeCaret.lastIndexOf("{")

  if (openBraceIndex < 0 || beforeCaret.slice(openBraceIndex + 1).includes("}")) {
    closeCalcAutocomplete()
    return
  }

  const query = beforeCaret.slice(openBraceIndex + 1)

  calcAutocompleteState.open = true
  calcAutocompleteState.query = query
  calcAutocompleteState.replaceStart = openBraceIndex
  calcAutocompleteState.replaceEnd = caret

  if (calcAutocompleteItems.value.length === 0) {
    calcAutocompleteState.activeIndex = 0
  } else if (calcAutocompleteState.activeIndex >= calcAutocompleteItems.value.length) {
    calcAutocompleteState.activeIndex = 0
  }
}
/** 执行 `insertCalcAutocompleteItem` 对应的局部业务逻辑。 @param itemName 调用方传入的 `itemName`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function insertCalcAutocompleteItem(itemName: string) {
  const textarea = calcRuleTextarea.value
  const calcRule = getCalcRuleTextareaValue()
  const replaceStart = calcAutocompleteState.replaceStart
  const nextValue =
    calcRule.slice(0, replaceStart + 1) +
    itemName +
    "}" +
    calcRule.slice(calcAutocompleteState.replaceEnd)

  setCalcRuleTextareaValue(nextValue)
  closeCalcAutocomplete()

  requestAnimationFrame(() => {
    const nextCaret = replaceStart + itemName.length + 2
    textarea?.focus()
    textarea?.setSelectionRange(nextCaret, nextCaret)
  })
}
/** 处理 `CalcRuleInput` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function onCalcRuleInput() {
  updateCalcAutocompleteFromCaret()
}
/** 处理 `CalcRuleKeydown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function onCalcRuleKeydown(event: KeyboardEvent) {
  if (!isCalcAutocompleteOpen.value) {
    if (event.key === "{") {
      requestAnimationFrame(updateCalcAutocompleteFromCaret)
    }
    return
  }

  if (event.key === "Escape") {
    event.preventDefault()
    closeCalcAutocomplete()
    return
  }

  if (event.key === "ArrowDown") {
    event.preventDefault()
    calcAutocompleteState.activeIndex =
      (calcAutocompleteState.activeIndex + 1) % Math.max(calcAutocompleteItems.value.length, 1)
    return
  }

  if (event.key === "ArrowUp") {
    event.preventDefault()
    const length = Math.max(calcAutocompleteItems.value.length, 1)
    calcAutocompleteState.activeIndex =
      (calcAutocompleteState.activeIndex - 1 + length) % length
    return
  }

  if (event.key === "Enter" || event.key === "Tab") {
    const item = activeCalcAutocompleteItem.value
    if (!item) {
      return
    }

    event.preventDefault()
    insertCalcAutocompleteItem(item.name)
  }
}
/** 根据当前输入构建 `CoreGroup` 结果。 @param group 调用方传入的 `group`。 @returns 计算、查找或构建后的结果。 */
function buildCoreGroup(group: StoryValGroupDraft): StoryValDefinition {
  return {
    name: normalizeText(group.name).trim(),
    description: normalizeText(group.description).trim() || undefined,
    vals: group.vals.map((row) => buildCoreRow(row))
  }
}
/** 根据当前输入构建 `CoreRow` 结果。 @param row 调用方传入的 `row`。 @returns 计算、查找或构建后的结果。 */
function buildCoreRow(row: StoryValRowDraft): StoryValEntryDefinition {
  return {
    name: normalizeText(row.name).trim(),
    description: normalizeText(row.description).trim() || undefined,
    value_type: normalizeValueType(row.valueType),
    value: isValueMode(row) ? parseStoryValInput(row.valueText) : undefined,
    calc_rule: normalizeText(row.calcRule).trim()
  }
}
/** 根据当前输入构建 `CoreValsFile` 结果。 @returns 计算、查找或构建后的结果。 */
function buildCoreValsFile(): StoryValsFile {
  return {
    variables: draft.variables.map((group) => buildCoreGroup(group))
  }
}

const calcPreview = computed<CalcEvaluationResult>(() => {
  if (!editingCalcGroup.value || !editingCalcRow.value) {
    return {
      ok: false,
      expression: "",
      resultText: ""
    }
  }

  const calcRule = normalizeText(editingCalcRow.value.calcRule).trim()

  if (!calcRule) {
    return {
      ok: false,
      expression: "",
      resultText: "\u8bf7\u8f93\u5165 calc_rule"
    }
  }

  const rowName = normalizeRowName(editingCalcRow.value.name)
  const groupName = normalizeGroupName(editingCalcGroup.value.name)
  const visited = new Set<string>()
  const fullVals = buildCoreValsFile()

  if (rowName) {
    visited.add(groupName ? `${groupName}.${rowName}` : rowName)
  }

  try {
    const preview = evaluateStoryValCalcRule(buildCoreGroup(editingCalcGroup.value), calcRule, {
      visited,
      depth: 1,
      maxDepth: MAX_CALC_NESTING_DEPTH,
      valsFile: fullVals
    })

    return {
      ok: true,
      expression: preview.expression,
      resultText: String(preview.result)
    }
  } catch (error) {
    return {
      ok: false,
      expression: "",
      resultText: error instanceof Error ? error.message : "\u8ba1\u7b97\u9884\u89c8\u5931\u8d25"
    }
  }
})
/** 读取或计算 `RowCalcDisplay`。 @param group 调用方传入的 `group`。 @param row 调用方传入的 `row`。 @returns 计算、查找或构建后的结果。 */
function getRowCalcDisplay(group: StoryValGroupDraft, row: StoryValRowDraft): CalcValueDisplay {
  const calcRule = normalizeText(row.calcRule).trim()
  const rowName = normalizeRowName(row.name)
  const groupName = normalizeGroupName(group.name)
  const visited = new Set<string>()
  const fullVals = buildCoreValsFile()

  if (rowName) {
    visited.add(groupName ? `${groupName}.${rowName}` : rowName)
  }

  try {
    const preview = evaluateStoryValCalcRule(buildCoreGroup(group), calcRule, {
      visited,
      depth: 1,
      maxDepth: MAX_CALC_NESTING_DEPTH,
      valsFile: fullVals
    })

    return {
      ok: true,
      text: String(preview.result),
      detail: preview.expression
    }
  } catch (error) {
    return {
      ok: false,
      text: "error",
      detail: error instanceof Error ? error.message : "\u8ba1\u7b97\u5931\u8d25"
    }
  }
}
/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function submitDraft() {
  emit("save", {
    variables: draft.variables.map((group) => ({
      name: normalizeText(group.name).trim(),
      description: normalizeText(group.description).trim() || undefined,
      vals: group.vals.map((row) => ({
        name: normalizeText(row.name).trim(),
        description: normalizeText(row.description).trim() || undefined,
        value_type: normalizeValueType(row.valueType),
        value: isValueMode(row) ? parseStoryValInput(row.valueText) : undefined,
        calc_rule: normalizeText(row.calcRule).trim()
      }))
    }))
  })
}

watch(
  () => props.vals,
  (vals) => {
    syncDraft(vals)
    closeCalcEditor()
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <div class="vals-dialog">
      <section class="vals-dialog__panel glass-panel">
        <div class="vals-dialog__header">
          <div>
            <span class="eyebrow">{{ props.eyebrow }}</span>
            <h2 class="vals-dialog__title">{{ props.title }}</h2>
          </div>

          <div class="vals-dialog__actions">
            <button class="btn-secondary" type="button" @click="emit('close')">
              &#x5173;&#x95ed;
            </button>
            <button
              class="btn-primary"
              type="button"
              :disabled="saving || hasInvalidDraft"
              @click="submitDraft"
            >
              {{ saving ? "\u4fdd\u5b58\u4e2d..." : "\u4fdd\u5b58" }}
            </button>
          </div>
        </div>

        <p class="vals-dialog__hint">
          &#x4e00;&#x7ea7;&#x662f;&#x53d8;&#x91cf;&#x5206;&#x7ec4;&#xff0c;&#x4e8c;&#x7ea7;&#x662f;&#x5206;&#x7ec4;&#x5185;&#x53d8;&#x91cf;&#x8868;&#x3002;
        </p>
        <p class="vals-dialog__hint">
          `calc_rule` &#x652f;&#x6301; `{a}` &#x5f15;&#x7528;&#x5f53;&#x524d;&#x5206;&#x7ec4;&#x53d8;&#x91cf;&#xff0c;&#x4e5f;&#x652f;&#x6301; `{group.row}` &#x8de8;&#x5206;&#x7ec4;&#x5f15;&#x7528;&#xff0c;&#x4f8b;&#x5982;&#xff1a;`{a}+{other.score}`&#x3002;
        </p>
        <p class="vals-dialog__hint">
          StoryScript &#x5b57;&#x6bb5;&#xff08;&#x5982; `trigger_expr`&#x3001;&#x521d;&#x59cb;&#x5316;&#x811a;&#x672c;&#x3001;&#x7ed3;&#x675f;&#x811a;&#x672c;&#x3001;&#x5bf9;&#x767d;&#x63d2;&#x503c;&#xff09;&#x4e0d;&#x4f7f;&#x7528; `calc_rule` &#x8fd9;&#x5957;&#x5199;&#x6cd5;&#xff0c;&#x8bf7;&#x7edf;&#x4e00;&#x4f7f;&#x7528; `${group.row}`&#x3002;
        </p>
        <p v-if="hasInvalidDraft" class="vals-dialog__warning">
          &#x5206;&#x7ec4;&#x540d;&#x79f0;&#x3001;&#x53d8;&#x91cf;&#x540d;&#x79f0;&#x4e0d;&#x80fd;&#x4e3a;&#x7a7a;&#xff0c;`calc` &#x6a21;&#x5f0f;&#x5fc5;&#x987b;&#x586b;&#x5199; `calc_rule`&#x3002;
        </p>

        <div class="vals-dialog__tabs">
          <div
            v-for="(group, index) in draft.variables"
            :key="group.draftKey"
            class="vals-dialog__tab"
            :class="{ 'vals-dialog__tab--active': index === activeTabIndex }"
          >
            <button class="vals-dialog__tab-button" type="button" @click="setActiveTab(index)">
              {{ getGroupLabel(group, index) }}
            </button>
            <button
              class="vals-dialog__tab-remove"
              type="button"
              :aria-label="'\u5220\u9664\u5206\u7ec4'"
              :title="'\u5220\u9664\u5206\u7ec4'"
              @click.stop="removeGroup(index)"
            >
              &times;
            </button>
          </div>

          <button class="btn-secondary vals-dialog__add-tab" type="button" @click="addGroup">
            + &#x6dfb;&#x52a0;&#x5206;&#x7ec4;
          </button>
        </div>

        <div v-if="activeGroup" class="vals-dialog__body">
          <div class="vals-dialog__group-count">
            当前分组变量：{{ activeGroupVariableCount }} 个
          </div>

          <div class="vals-dialog__group-meta">
            <label class="field">
              <span class="field-label">&#x5206;&#x7ec4;&#x540d;&#x79f0;</span>
              <input v-model="activeGroup.name" class="text-input" type="text" />
            </label>

            <label class="field">
              <span class="field-label">&#x5206;&#x7ec4;&#x8bf4;&#x660e;</span>
              <input v-model="activeGroup.description" class="text-input" type="text" />
            </label>
          </div>

          <div class="vals-dialog__table-wrap">
            <table class="vals-dialog__table">
              <thead>
                <tr>
                  <th>&#x540d;&#x79f0;</th>
                  <th>&#x8bf4;&#x660e;</th>
                  <th>&#x503c;&#x7c7b;&#x578b;</th>
                  <th>&#x503c;</th>
                  <th class="vals-dialog__actions-col">&#x64cd;&#x4f5c;</th>
                </tr>
              </thead>
              <tbody v-if="activeGroup.vals.length">
                <tr v-for="(row, index) in activeGroup.vals" :key="row.draftKey">
                  <td>
                    <input v-model="row.name" class="text-input vals-dialog__cell-input" type="text" />
                  </td>
                  <td>
                    <input
                      v-model="row.description"
                      class="text-input vals-dialog__cell-input"
                      type="text"
                    />
                  </td>
                  <td>
                    <select v-model="row.valueType" class="text-input vals-dialog__cell-input">
                      <option value="value">value</option>
                      <option value="calc">calc</option>
                    </select>
                  </td>
                  <td>
                    <input
                      v-if="isValueMode(row)"
                      v-model="row.valueText"
                      class="text-input vals-dialog__cell-input"
                      type="text"
                    />
                    <div
                      v-else
                      class="vals-dialog__calc-value-link"
                      :class="{
                        'vals-dialog__calc-value-link--error': !getRowCalcDisplay(activeGroup, row).ok
                      }"
                      :title="getRowCalcDisplay(activeGroup, row).detail"
                      role="button"
                      tabindex="0"
                      @click="openCalcEditor(activeGroup, row)"
                      @keydown.enter.prevent="openCalcEditor(activeGroup, row)"
                      @keydown.space.prevent="openCalcEditor(activeGroup, row)"
                    >
                      {{ getRowCalcDisplay(activeGroup, row).text }}
                    </div>
                  </td>
                  <td class="vals-dialog__actions-col">
                    <button
                      class="btn-secondary vals-dialog__row-button"
                      type="button"
                      @click="removeRow(index)"
                    >
                      &#x5220;&#x9664;
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="!activeGroup.vals.length" class="vals-dialog__empty">
              &#x5f53;&#x524d;&#x5206;&#x7ec4;&#x8fd8;&#x6ca1;&#x6709;&#x53d8;&#x91cf;&#xff0c;&#x5148;&#x6dfb;&#x52a0;&#x4e00;&#x884c;&#x3002;
            </div>
          </div>

          <div class="vals-dialog__footer">
            <button class="btn-secondary vals-dialog__row-add" type="button" @click="addRow">
              + &#x6dfb;&#x52a0;&#x53d8;&#x91cf;
            </button>
          </div>
        </div>

        <div class="vals-dialog__actions vals-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="emit('close')">
            &#x5173;&#x95ed;
          </button>
          <button
            class="btn-primary"
            type="button"
            :disabled="saving || hasInvalidDraft"
            @click="submitDraft"
          >
            {{ saving ? "\u4fdd\u5b58\u4e2d..." : "\u4fdd\u5b58" }}
          </button>
        </div>
      </section>

      <div v-if="isCalcEditorOpen && editingCalcRow" class="vals-dialog__calc-editor" @click.self="closeCalcEditor">
        <section class="vals-dialog__calc-editor-panel glass-panel">
          <div class="vals-dialog__calc-editor-head">
            <div>
              <h3 class="vals-dialog__calc-editor-title">calc_rule</h3>
              <p class="vals-dialog__calc-editor-subtitle">
                {{ normalizeRowName(editingCalcRow.name) || "\u672a\u547d\u540d\u53d8\u91cf" }}
              </p>
            </div>
            <button class="btn-secondary vals-dialog__calc-editor-close" type="button" @click="closeCalcEditor">
              &#x5173;&#x95ed;
            </button>
          </div>

          <label class="field">
            <span class="field-label">calc_rule</span>
            <div class="vals-dialog__calc-editor-input-wrap">
              <textarea
                ref="calcRuleTextarea"
                v-model="editingCalcRow.calcRule"
                class="text-area vals-dialog__calc-editor-area"
                placeholder="{a}+{other.score}"
                @input="onCalcRuleInput"
                @click="updateCalcAutocompleteFromCaret"
                @keyup="updateCalcAutocompleteFromCaret"
                @keydown="onCalcRuleKeydown"
              />

              <div v-if="isCalcAutocompleteOpen" class="vals-dialog__calc-autocomplete">
                <button
                  v-for="(item, index) in calcAutocompleteItems"
                  :key="item.name"
                  class="vals-dialog__calc-autocomplete-item"
                  :class="{
                    'vals-dialog__calc-autocomplete-item--active':
                      index === calcAutocompleteState.activeIndex
                  }"
                  type="button"
                  @mousedown.prevent="insertCalcAutocompleteItem(item.name)"
                >
                  <span class="vals-dialog__calc-autocomplete-name">{{ item.name }}</span>
                  <span v-if="item.description" class="vals-dialog__calc-autocomplete-description">
                    {{ item.description }}
                  </span>
                </button>

                <div
                  v-if="!calcAutocompleteItems.length"
                  class="vals-dialog__calc-autocomplete-empty"
                >
                  没有匹配的变量
                </div>
              </div>
            </div>
          </label>

          <div class="vals-dialog__calc-preview">
            <div class="vals-dialog__calc-preview-head">
              <span class="field-label">&#x5b9e;&#x65f6;&#x9884;&#x89c8;</span>
              <span
                class="vals-dialog__calc-preview-badge"
                :class="{
                  'vals-dialog__calc-preview-badge--ok': calcPreview.ok,
                  'vals-dialog__calc-preview-badge--error': !calcPreview.ok
                }"
              >
                {{ calcPreview.ok ? "\u53ef\u8ba1\u7b97" : "\u9700\u4fee\u6b63" }}
              </span>
            </div>

            <p class="vals-dialog__calc-preview-tip">
              &#x4f7f;&#x7528; `{a}` &#x5f15;&#x7528;&#x5f53;&#x524d;&#x5206;&#x7ec4;&#x7684;&#x5176;&#x4ed6;&#x53d8;&#x91cf;&#xff0c;&#x4f7f;&#x7528; `{group.row}` &#x8de8;&#x5206;&#x7ec4;&#x5f15;&#x7528;&#x3002;
            </p>
            <p class="vals-dialog__calc-preview-tip">
              &#x652f;&#x6301; `Math.floor`、`Math.min`、`Math.max` &#x7b49;&#x5e38;&#x7528;&#x6570;&#x5b66;&#x51fd;&#x6570;&#x3002;
            </p>

            <template v-if="calcPreview.ok">
              <label class="field">
                <span class="field-label">&#x5c55;&#x5f00;&#x8868;&#x8fbe;&#x5f0f;</span>
                <div class="vals-dialog__calc-preview-box">
                  {{ calcPreview.expression }}
                </div>
              </label>
              <label class="field">
                <span class="field-label">&#x8ba1;&#x7b97;&#x7ed3;&#x679c;</span>
                <div class="vals-dialog__calc-preview-box vals-dialog__calc-preview-box--result">
                  {{ calcPreview.resultText }}
                </div>
              </label>
            </template>

            <template v-else>
              <label class="field">
                <span class="field-label">&#x9519;&#x8bef;&#x63d0;&#x793a;</span>
                <div class="vals-dialog__calc-preview-box vals-dialog__calc-preview-box--error">
                  {{ calcPreview.resultText }}
                </div>
              </label>
            </template>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped src="./styles/StoryValsDialog.css"></style>
