<script setup lang="ts">
import type { StoryValDefinition, StoryValValueType, StoryValsFile } from "@story-mgr/core"

interface StoryValRowDraft {
  draftKey: string
  name: string
  description: string
  valueType: StoryValValueType
  valueText: string
  calcRule: string
}

interface StoryValGroupDraft {
  draftKey: string
  name: string
  description: string
  vals: StoryValRowDraft[]
}

const props = defineProps<{
  vals: StoryValsFile
  saving: boolean
}>()

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
const MAX_CALC_NESTING_DEPTH = 5

const activeGroup = computed(() => draft.variables[activeTabIndex.value] ?? null)

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function normalizeValueType(value: unknown): StoryValValueType {
  return value === "calc" ? "calc" : "value"
}

function normalizeRowName(value: unknown) {
  return normalizeText(value).trim()
}

const editingCalcGroup = computed(() => {
  return draft.variables.find((group) => group.draftKey === calcEditorState.groupKey) ?? null
})

const editingCalcRow = computed(() => {
  return editingCalcGroup.value?.vals.find((row) => row.draftKey === calcEditorState.rowKey) ?? null
})

const isCalcEditorOpen = computed(() => !!editingCalcRow.value)

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

function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

function formatValueInput(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === undefined) {
    return ""
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseValueInput(valueText: string): unknown {
  const trimmed = valueText.trim()

  if (trimmed === "") {
    return ""
  }

  if (trimmed === "true") {
    return true
  }

  if (trimmed === "false") {
    return false
  }

  if (trimmed === "null") {
    return null
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  const maybeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))

  if (maybeJson) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return valueText
    }
  }

  return valueText
}

function createEmptyRow(): StoryValRowDraft {
  return {
    draftKey: createDraftKey("row"),
    name: "",
    description: "",
    valueType: "value",
    valueText: "",
    calcRule: ""
  }
}

function createEmptyGroup(index: number): StoryValGroupDraft {
  return {
    draftKey: createDraftKey("group"),
    name: `\u53d8\u91cf\u7ec4${index}`,
    description: "",
    vals: []
  }
}

function cloneGroup(group: StoryValDefinition): StoryValGroupDraft {
  return {
    draftKey: createDraftKey("group"),
    name: normalizeText(group.name),
    description: normalizeText(group.description),
    vals: group.vals.map((row) => ({
      draftKey: createDraftKey("row"),
      name: normalizeText(row.name),
      description: normalizeText(row.description),
      valueType: normalizeValueType(row.value_type),
      valueText: formatValueInput(row.value),
      calcRule: normalizeText(row.calc_rule)
    }))
  }
}

function ensureGroupExists() {
  if (draft.variables.length === 0) {
    draft.variables.push(createEmptyGroup(1))
  }

  if (activeTabIndex.value >= draft.variables.length) {
    activeTabIndex.value = draft.variables.length - 1
  }
}

function syncDraft(vals: StoryValsFile) {
  draft.variables = vals.variables.map(cloneGroup)
  activeTabIndex.value = 0
  ensureGroupExists()
}

function setActiveTab(index: number) {
  activeTabIndex.value = index
}

function addGroup() {
  draft.variables.push(createEmptyGroup(draft.variables.length + 1))
  activeTabIndex.value = draft.variables.length - 1
}

function removeGroup(index: number) {
  draft.variables.splice(index, 1)
  ensureGroupExists()
}

function addRow() {
  activeGroup.value?.vals.push(createEmptyRow())
}

function removeRow(index: number) {
  activeGroup.value?.vals.splice(index, 1)
}

function getGroupLabel(group: StoryValGroupDraft, index: number) {
  return normalizeText(group.name).trim() || `\u672a\u547d\u540d\u5206\u7ec4 ${index + 1}`
}

function isValueMode(row: StoryValRowDraft) {
  return normalizeValueType(row.valueType) === "value"
}

function openCalcEditor(group: StoryValGroupDraft, row: StoryValRowDraft) {
  if (isValueMode(row)) {
    return
  }

  calcEditorState.groupKey = group.draftKey
  calcEditorState.rowKey = row.draftKey
}

function closeCalcEditor() {
  calcEditorState.groupKey = ""
  calcEditorState.rowKey = ""
}

function toNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

interface CalcEvaluationResult {
  ok: boolean
  expression: string
  resultText: string
}

interface CalcValueDisplay {
  ok: boolean
  text: string
  detail?: string
}

function evaluateExpression(expression: string) {
  if (!/^[\d+\-*/().\s]+$/.test(expression)) {
    throw new Error("\u89c4\u5219\u4e2d\u5305\u542b\u4e0d\u652f\u6301\u7684\u5b57\u7b26")
  }

  // Only arithmetic characters are allowed after placeholder substitution.
  const result = Function(`"use strict"; return (${expression})`)() as unknown

  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("\u8ba1\u7b97\u7ed3\u679c\u4e0d\u662f\u6709\u6548\u6570\u503c")
  }

  return result
}

function resolveCalcRowValue(
  group: StoryValGroupDraft,
  rowName: string,
  visited: Set<string>,
  depth: number
): number {
  if (depth > MAX_CALC_NESTING_DEPTH) {
    throw new Error(`最多只支持 ${MAX_CALC_NESTING_DEPTH} 层嵌套计算`)
  }

  if (visited.has(rowName)) {
    throw new Error(`\u68c0\u6d4b\u5230\u5faa\u73af\u5f15\u7528\uff1a${[...visited, rowName].join(" -> ")}`)
  }

  const row = group.vals.find((item) => normalizeRowName(item.name) === rowName)

  if (!row) {
    throw new Error(`\u672a\u627e\u5230\u53d8\u91cf {${rowName}}`)
  }

  if (isValueMode(row)) {
    const numericValue = toNumericValue(parseValueInput(normalizeText(row.valueText)))

    if (numericValue === null) {
      throw new Error(`\u53d8\u91cf {${rowName}} \u4e0d\u662f\u6570\u503c`)
    }

    return numericValue
  }

  const nextVisited = new Set(visited)
  nextVisited.add(rowName)
  const nestedRule = normalizeText(row.calcRule).trim()

  if (!nestedRule) {
    throw new Error(`\u53d8\u91cf {${rowName}} \u7f3a\u5c11 calc_rule`)
  }

  return evaluateCalcRuleExpression(group, nestedRule, nextVisited, depth + 1).result
}

function evaluateCalcRuleExpression(
  group: StoryValGroupDraft,
  calcRule: string,
  visited: Set<string>,
  depth: number
): { expression: string; result: number } {
  if (depth > MAX_CALC_NESTING_DEPTH) {
    throw new Error(`最多只支持 ${MAX_CALC_NESTING_DEPTH} 层嵌套计算`)
  }

  const trimmedRule = calcRule.trim()

  if (!trimmedRule) {
    throw new Error("\u8bf7\u5148\u8f93\u5165 calc_rule")
  }

  const expression = trimmedRule.replace(/\{([^{}]+)\}/g, (_match, token: string) => {
    const rowName = token.trim()

    if (!rowName) {
      throw new Error("\u5f15\u7528\u5360\u4f4d\u7b26\u4e0d\u80fd\u4e3a\u7a7a")
    }

    return String(resolveCalcRowValue(group, rowName, visited, depth))
  })

  return {
    expression,
    result: evaluateExpression(expression)
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
  const visited = new Set<string>()

  if (rowName) {
    visited.add(rowName)
  }

  try {
    const preview = evaluateCalcRuleExpression(editingCalcGroup.value, calcRule, visited, 1)

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

function getRowCalcDisplay(group: StoryValGroupDraft, row: StoryValRowDraft): CalcValueDisplay {
  const calcRule = normalizeText(row.calcRule).trim()
  const rowName = normalizeRowName(row.name)
  const visited = new Set<string>()

  if (rowName) {
    visited.add(rowName)
  }

  try {
    const preview = evaluateCalcRuleExpression(group, calcRule, visited, 1)

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

function submitDraft() {
  emit("save", {
    variables: draft.variables.map((group) => ({
      name: normalizeText(group.name).trim(),
      description: normalizeText(group.description).trim() || undefined,
      vals: group.vals.map((row) => ({
        name: normalizeText(row.name).trim(),
        description: normalizeText(row.description).trim() || undefined,
        value_type: normalizeValueType(row.valueType),
        value: isValueMode(row) ? parseValueInput(row.valueText) : undefined,
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
    <div class="vals-dialog" @click.self="emit('close')">
      <section class="vals-dialog__panel glass-panel">
        <div class="vals-dialog__header">
          <div>
            <span class="eyebrow">&#x5168;&#x5c40;&#x53d8;&#x91cf;</span>
            <h2 class="vals-dialog__title">&#x5168;&#x5c40;&#x53d8;&#x91cf;&#x8bbe;&#x7f6e;</h2>
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
          `calc_rule` &#x4f7f;&#x7528; `{a}` &#x8fd9;&#x79cd;&#x5199;&#x6cd5;&#x5f15;&#x7528;&#x5f53;&#x524d;&#x4e00;&#x7ea7;&#x5206;&#x7ec4;&#x5185;&#x7684;&#x4e8c;&#x7ea7;&#x53d8;&#x91cf;&#xff0c;&#x4f8b;&#x5982;&#xff1a;`{a}+{b}+{c}`&#x3002;
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
            <textarea
              v-model="editingCalcRow.calcRule"
              class="text-area vals-dialog__calc-editor-area"
              placeholder="{a}+{b}+{c}"
            />
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
              &#x4f7f;&#x7528; `{a}` &#x5f15;&#x7528;&#x5f53;&#x524d;&#x5206;&#x7ec4;&#x5185;&#x7684;&#x5176;&#x4ed6;&#x53d8;&#x91cf;&#x3002;
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

<style scoped>
.vals-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
  backdrop-filter: blur(10px);
}

.vals-dialog__panel {
  width: min(1200px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: auto;
  border-radius: 22px;
}

.vals-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.vals-dialog__title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
  line-height: 1.1;
}

.vals-dialog__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.vals-dialog__hint,
.vals-dialog__warning {
  margin: 10px 0 0;
  font-size: 0.86rem;
  color: var(--text-muted);
}

.vals-dialog__warning {
  color: var(--warning);
}

.vals-dialog__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.vals-dialog__tab {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.vals-dialog__tab--active {
  border-color: rgba(255, 180, 84, 0.5);
  background: rgba(255, 180, 84, 0.12);
}

.vals-dialog__tab-button,
.vals-dialog__tab-remove {
  min-height: 30px;
  padding: 0 10px;
  background: transparent;
  color: inherit;
}

.vals-dialog__tab-button {
  font-size: 0.82rem;
}

.vals-dialog__tab-remove {
  padding-left: 0;
  font-size: 1rem;
  line-height: 1;
  color: var(--text-muted);
}

.vals-dialog__add-tab,
.vals-dialog__row-add,
.vals-dialog__row-button {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 0.8rem;
}

.vals-dialog__body {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.vals-dialog__group-meta {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
  gap: 10px;
}

.vals-dialog__table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.vals-dialog__table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
}

.vals-dialog__table th,
.vals-dialog__table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.vals-dialog__table th {
  position: sticky;
  top: 0;
  background: rgba(9, 19, 30, 0.92);
  font-size: 0.82rem;
  color: var(--text-muted);
}

.vals-dialog__cell-input {
  min-width: 0;
  padding: 8px 10px;
}

.vals-dialog__cell-input:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.vals-dialog__calc-value-link {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid rgba(124, 227, 195, 0.24);
  border-radius: 12px;
  background: rgba(124, 227, 195, 0.08);
  color: var(--success);
  font-family: "Space Grotesk", sans-serif;
  line-height: 1.25;
  text-decoration: underline;
  text-underline-offset: 3px;
  word-break: break-word;
  cursor: pointer;
}

.vals-dialog__calc-value-link--error {
  border-color: rgba(255, 139, 123, 0.28);
  background: rgba(255, 139, 123, 0.08);
  color: var(--warning);
}

.vals-dialog__calc-editor {
  position: fixed;
  inset: 0;
  z-index: 61;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 10, 18, 0.48);
}

.vals-dialog__calc-editor-panel {
  width: min(720px, calc(100vw - 48px));
  padding: 18px;
  border-radius: 18px;
}

.vals-dialog__calc-editor-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.vals-dialog__calc-editor-title {
  margin: 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.05rem;
}

.vals-dialog__calc-editor-subtitle {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.vals-dialog__calc-editor-close {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 0.8rem;
}

.vals-dialog__calc-editor-area {
  min-height: 136px;
}

.vals-dialog__calc-preview {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(186, 220, 255, 0.12);
}

.vals-dialog__calc-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.vals-dialog__calc-preview-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  border: 1px solid rgba(186, 220, 255, 0.2);
}

.vals-dialog__calc-preview-badge--ok {
  border-color: rgba(124, 227, 195, 0.4);
  color: var(--success);
}

.vals-dialog__calc-preview-badge--error {
  border-color: rgba(255, 139, 123, 0.4);
  color: var(--warning);
}

.vals-dialog__calc-preview-tip {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.vals-dialog__calc-preview-box {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font-family: "Space Grotesk", sans-serif;
  line-height: 1.45;
  word-break: break-word;
}

.vals-dialog__calc-preview-box--result {
  border-color: rgba(124, 227, 195, 0.35);
}

.vals-dialog__calc-preview-box--error {
  border-color: rgba(255, 139, 123, 0.35);
  color: var(--warning);
}

.vals-dialog__actions-col {
  width: 96px;
}

.vals-dialog__empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.vals-dialog__footer {
  display: flex;
  justify-content: flex-start;
}

@media (max-width: 900px) {
  .vals-dialog__header,
  .vals-dialog__actions,
  .vals-dialog__group-meta,
  .vals-dialog__calc-editor-head,
  .vals-dialog__calc-preview-head {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
