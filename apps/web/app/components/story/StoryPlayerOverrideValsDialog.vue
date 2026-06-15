<script setup lang="ts">
import type {
  StoryPlayerOverrideInputOption,
  StoryPlayerOverrideInputType,
  StoryPlayerOverrideValEntry,
  StoryPlayerOverrideValsFile,
  StoryValsFile
} from "@story-mgr/core"

interface PlayerOverrideOptionDraft {
  draftKey: string
  label: string
  value: string
}

interface PlayerOverrideRowDraft {
  draftKey: string
  varKey: string
  needPlayerOverride: boolean
  tips: string
  groupNoText: string
  inputType: StoryPlayerOverrideInputType
  options: PlayerOverrideOptionDraft[]
}

const props = defineProps<{
  playerOverrideVals: StoryPlayerOverrideValsFile
  saving: boolean
  vals: StoryValsFile
}>()

const emit = defineEmits<{
  close: []
  save: [playerOverrideVals: StoryPlayerOverrideValsFile]
}>()

const draftRows = ref<PlayerOverrideRowDraft[]>([])
const showingGroupTip = ref(false)
const editingOptionsRowKey = ref<string | null>(null)

let draftKeySeed = 0

function createDraftKey() {
  draftKeySeed += 1
  return `player-override-${draftKeySeed}`
}

function createOptionDraftKey() {
  draftKeySeed += 1
  return `player-override-option-${draftKeySeed}`
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function normalizeInputType(value: unknown): StoryPlayerOverrideInputType {
  return value === "select" ? "select" : "text"
}

function normalizeGroupNo(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1 ? String(value) : "1"
}

function createOptionDraft(option?: Partial<StoryPlayerOverrideInputOption>): PlayerOverrideOptionDraft {
  return {
    draftKey: createOptionDraftKey(),
    label: normalizeText(option?.label),
    value: normalizeText(option?.value)
  }
}

function cloneOptions(options: StoryPlayerOverrideInputOption[] | undefined): PlayerOverrideOptionDraft[] {
  if (!Array.isArray(options)) {
    return []
  }

  return options.map((option) => createOptionDraft(option))
}

function sanitizeGroupNoInput(value: string) {
  const digitsOnly = value.replace(/[^\d]/g, "")
  if (!digitsOnly) {
    return "1"
  }

  const parsedValue = Number.parseInt(digitsOnly, 10)
  return String(parsedValue >= 1 ? parsedValue : 1)
}

function createEmptyRow(): PlayerOverrideRowDraft {
  return {
    draftKey: createDraftKey(),
    varKey: "",
    needPlayerOverride: true,
    tips: "",
    groupNoText: "1",
    inputType: "text",
    options: []
  }
}

function cloneEntry(entry: StoryPlayerOverrideValEntry): PlayerOverrideRowDraft {
  return {
    draftKey: createDraftKey(),
    varKey: normalizeText(entry.var_key).trim(),
    needPlayerOverride: Boolean(entry.need_player_override),
    tips: normalizeText(entry.tips),
    groupNoText: normalizeGroupNo(entry.group_no),
    inputType: normalizeInputType(entry.input_type),
    options: cloneOptions(entry.input_options)
  }
}

const globalValOptions = computed(() => {
  return props.vals.variables.flatMap((group) => {
    const groupName = group.name.trim()

    return group.vals.map((row) => {
      const rowName = row.name.trim()
      const varKey = `${groupName}.${rowName}`
      const description = normalizeText(row.description).trim()

      return {
        value: varKey,
        label: description ? `${varKey} - ${description}` : varKey
      }
    })
  })
})

const selectedVarKeySet = computed(() => {
  return new Set(
    draftRows.value
      .map((row) => row.varKey.trim())
      .filter(Boolean)
  )
})

const hasInvalidDraft = computed(() => {
  return draftRows.value.some((row) => !row.varKey.trim())
})

const hasDuplicateVarKey = computed(() => {
  const seen = new Set<string>()

  for (const row of draftRows.value) {
    const normalizedVarKey = row.varKey.trim()

    if (!normalizedVarKey) {
      continue
    }

    if (seen.has(normalizedVarKey)) {
      return true
    }

    seen.add(normalizedVarKey)
  }

  return false
})

function getNormalizedOptionValues(row: PlayerOverrideRowDraft) {
  return row.options.map((option) => option.value.trim()).filter(Boolean)
}

function hasDuplicateOptionValues(row: PlayerOverrideRowDraft) {
  const seen = new Set<string>()

  for (const value of getNormalizedOptionValues(row)) {
    if (seen.has(value)) {
      return true
    }

    seen.add(value)
  }

  return false
}

function isOptionValueDuplicated(row: PlayerOverrideRowDraft, value: string) {
  const normalizedValue = value.trim()
  if (!normalizedValue) {
    return false
  }

  return getNormalizedOptionValues(row).filter((optionValue) => optionValue === normalizedValue).length > 1
}

const hasInvalidSelectDraft = computed(() => {
  return draftRows.value.some((row) => {
    if (row.inputType !== "select") {
      return false
    }

    return row.options.length === 0
      || row.options.some((option) => !option.value.trim())
      || hasDuplicateOptionValues(row)
  })
})

const editingOptionsRow = computed(() => {
  return draftRows.value.find((row) => row.draftKey === editingOptionsRowKey.value) ?? null
})

function syncDraft(file: StoryPlayerOverrideValsFile) {
  draftRows.value = file.entries.map(cloneEntry)
  editingOptionsRowKey.value = null
}

function addRow() {
  draftRows.value.push(createEmptyRow())
}

function removeRow(index: number) {
  if (draftRows.value[index]?.draftKey === editingOptionsRowKey.value) {
    editingOptionsRowKey.value = null
  }

  draftRows.value.splice(index, 1)
}

function moveRowUp(index: number) {
  if (index <= 0) {
    return
  }

  const nextRows = [...draftRows.value]
  const [targetRow] = nextRows.splice(index, 1)
  nextRows.splice(index - 1, 0, targetRow!)
  draftRows.value = nextRows
}

function moveRowDown(index: number) {
  if (index >= draftRows.value.length - 1) {
    return
  }

  const nextRows = [...draftRows.value]
  const [targetRow] = nextRows.splice(index, 1)
  nextRows.splice(index + 1, 0, targetRow!)
  draftRows.value = nextRows
}

function buildSelectOptions(rowDraft: PlayerOverrideRowDraft) {
  return globalValOptions.value.filter((option) => {
    return option.value === rowDraft.varKey || !selectedVarKeySet.value.has(option.value)
  })
}

function updateGroupNo(row: PlayerOverrideRowDraft, value: string) {
  row.groupNoText = sanitizeGroupNoInput(value)
}

function handleGroupNoInput(row: PlayerOverrideRowDraft, event: Event) {
  const target = event.target
  const nextValue = target instanceof HTMLInputElement ? target.value : "1"
  updateGroupNo(row, nextValue)
}

function handleInputTypeChange(row: PlayerOverrideRowDraft, event: Event) {
  const target = event.target
  row.inputType = normalizeInputType(target instanceof HTMLSelectElement ? target.value : "text")

  if (row.inputType === "select" && row.options.length === 0) {
    row.options.push(createOptionDraft())
  }
}

function openOptionsEditor(row: PlayerOverrideRowDraft) {
  if (row.inputType === "select" && row.options.length === 0) {
    row.options.push(createOptionDraft())
  }

  editingOptionsRowKey.value = row.draftKey
}

function closeOptionsEditor() {
  editingOptionsRowKey.value = null
}

function addOption(row: PlayerOverrideRowDraft) {
  row.options.push(createOptionDraft())
}

function removeOption(row: PlayerOverrideRowDraft, index: number) {
  row.options.splice(index, 1)
}

function moveOptionUp(row: PlayerOverrideRowDraft, index: number) {
  if (index <= 0) {
    return
  }

  const [targetOption] = row.options.splice(index, 1)
  row.options.splice(index - 1, 0, targetOption!)
}

function moveOptionDown(row: PlayerOverrideRowDraft, index: number) {
  if (index >= row.options.length - 1) {
    return
  }

  const [targetOption] = row.options.splice(index, 1)
  row.options.splice(index + 1, 0, targetOption!)
}

function normalizeOutputOptions(row: PlayerOverrideRowDraft): StoryPlayerOverrideInputOption[] {
  if (row.inputType !== "select") {
    return []
  }

  return row.options.map((option) => {
    const value = option.value.trim()
    const label = option.label.trim() || value

    return {
      label,
      value
    }
  })
}

function submitDraft() {
  emit("save", {
    entries: draftRows.value.map((row) => ({
      var_key: row.varKey.trim(),
      need_player_override: row.needPlayerOverride,
      tips: row.tips,
      group_no: Number.parseInt(sanitizeGroupNoInput(row.groupNoText), 10),
      input_type: row.inputType,
      input_options: normalizeOutputOptions(row)
    }))
  })
}

watch(
  () => props.playerOverrideVals,
  (file) => {
    syncDraft(file)
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <div class="player-override-dialog">
      <section class="player-override-dialog__panel glass-panel">
        <div class="player-override-dialog__header">
          <div>
            <span class="eyebrow">玩家覆盖变量</span>
            <h2 class="player-override-dialog__title">玩家创建角色字段</h2>
          </div>

          <div class="player-override-dialog__actions">
            <button class="btn-secondary" type="button" @click="emit('close')">
              关闭
            </button>
            <button
              class="btn-primary"
              type="button"
              :disabled="saving || hasInvalidDraft || hasInvalidSelectDraft"
              @click="submitDraft"
            >
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>

        <p class="player-override-dialog__hint">
          这里只能选择全局变量。客户端创建角色时，会按这里的行顺序，逐项询问勾选了“需要玩家覆盖”的字段。
        </p>
        <p v-if="hasInvalidDraft" class="player-override-dialog__warning">
          每一行都必须选择一个全局变量。
        </p>
        <p v-else-if="hasInvalidSelectDraft" class="player-override-dialog__warning">
          下拉选项至少要有一个选项，并且选项值不能为空、不能重复。
        </p>
        <p v-else-if="hasDuplicateVarKey" class="player-override-dialog__warning">
          当前存在重复变量，客户端会按顺序重复询问，建议检查一下。
        </p>

        <div class="player-override-dialog__table-wrap">
          <table class="player-override-dialog__table">
            <thead>
              <tr>
                <th class="player-override-dialog__order-col">顺序</th>
                <th>全局变量</th>
                <th class="player-override-dialog__checkbox-col">需要玩家覆盖</th>
                <th class="player-override-dialog__input-type-col">输入方式</th>
                <th class="player-override-dialog__group-col">
                  <span class="player-override-dialog__group-label">
                    分组编号
                    <button
                      class="player-override-dialog__help-button"
                      type="button"
                      @click="showingGroupTip = !showingGroupTip"
                    >
                      ?
                    </button>
                  </span>
                  <span v-if="showingGroupTip" class="player-override-dialog__help-popover">
                    输入数字，同数字在同一个界面输入
                  </span>
                </th>
                <th>说明 &amp; 提示</th>
                <th class="player-override-dialog__action-col">操作</th>
              </tr>
            </thead>
            <tbody v-if="draftRows.length">
              <tr v-for="(row, index) in draftRows" :key="row.draftKey">
                <td class="player-override-dialog__order-cell">
                  <div class="player-override-dialog__order-buttons">
                    <button
                      class="btn-secondary player-override-dialog__icon-button"
                      type="button"
                      :disabled="index === 0"
                      @click="moveRowUp(index)"
                    >
                      ↑
                    </button>
                    <button
                      class="btn-secondary player-override-dialog__icon-button"
                      type="button"
                      :disabled="index === draftRows.length - 1"
                      @click="moveRowDown(index)"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td>
                  <select v-model="row.varKey" class="text-input player-override-dialog__cell-input">
                    <option value="">请选择全局变量</option>
                    <option
                      v-for="option in buildSelectOptions(row)"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </td>
                <td class="player-override-dialog__checkbox-cell">
                  <label class="player-override-dialog__checkbox-label">
                    <input v-model="row.needPlayerOverride" type="checkbox" />
                    <span>是</span>
                  </label>
                </td>
                <td>
                  <div class="player-override-dialog__input-type-field">
                    <select
                      :value="row.inputType"
                      class="text-input player-override-dialog__cell-input"
                      @change="handleInputTypeChange(row, $event)"
                    >
                      <option value="text">文本框</option>
                      <option value="select">下拉选项</option>
                    </select>
                    <button
                      v-if="row.inputType === 'select'"
                      class="btn-secondary player-override-dialog__options-button"
                      type="button"
                      @click="openOptionsEditor(row)"
                    >
                      选项 {{ row.options.length }}
                    </button>
                  </div>
                </td>
                <td>
                  <input
                    :value="row.groupNoText"
                    class="text-input player-override-dialog__group-input"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    @input="handleGroupNoInput(row, $event)"
                  />
                </td>
                <td>
                  <textarea
                    v-model="row.tips"
                    class="text-area player-override-dialog__tips-input"
                    placeholder="例如：请输入主角的姓"
                  />
                </td>
                <td class="player-override-dialog__action-cell">
                  <button
                    class="btn-secondary player-override-dialog__row-delete"
                    type="button"
                    @click="removeRow(index)"
                  >
                    删除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <div v-if="!draftRows.length" class="player-override-dialog__empty">
            还没有配置玩家覆盖字段，先添加一行。
          </div>
        </div>

        <div class="player-override-dialog__footer">
          <button class="btn-secondary" type="button" @click="addRow">
            + 添加字段
          </button>
        </div>
      </section>

      <section v-if="editingOptionsRow" class="player-override-dialog__option-panel glass-panel">
        <div class="player-override-dialog__header">
          <div>
            <span class="eyebrow">下拉选项</span>
            <h2 class="player-override-dialog__title">
              {{ editingOptionsRow.varKey || "未选择变量" }}
            </h2>
          </div>

          <div class="player-override-dialog__actions">
            <button class="btn-secondary" type="button" @click="closeOptionsEditor">
              完成
            </button>
          </div>
        </div>

        <p class="player-override-dialog__hint">
          “显示文本”是玩家看到的内容，“写入值”会保存到对应变量。
        </p>

        <div class="player-override-dialog__option-table-wrap">
          <table class="player-override-dialog__option-table">
            <thead>
              <tr>
                <th class="player-override-dialog__order-col">顺序</th>
                <th>显示文本</th>
                <th>写入值</th>
                <th class="player-override-dialog__action-col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(option, optionIndex) in editingOptionsRow.options" :key="option.draftKey">
                <td class="player-override-dialog__order-cell">
                  <div class="player-override-dialog__order-buttons">
                    <button
                      class="btn-secondary player-override-dialog__icon-button"
                      type="button"
                      :disabled="optionIndex === 0"
                      @click="moveOptionUp(editingOptionsRow, optionIndex)"
                    >
                      ↑
                    </button>
                    <button
                      class="btn-secondary player-override-dialog__icon-button"
                      type="button"
                      :disabled="optionIndex === editingOptionsRow.options.length - 1"
                      @click="moveOptionDown(editingOptionsRow, optionIndex)"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td>
                  <input
                    v-model="option.label"
                    class="text-input player-override-dialog__cell-input"
                    placeholder="例如：男"
                  />
                </td>
                <td>
                  <input
                    v-model="option.value"
                    class="text-input player-override-dialog__cell-input"
                    :class="{
                      'player-override-dialog__cell-input--invalid':
                        !option.value.trim() || isOptionValueDuplicated(editingOptionsRow, option.value)
                    }"
                    placeholder="例如：男"
                  />
                </td>
                <td class="player-override-dialog__action-cell">
                  <button
                    class="btn-secondary player-override-dialog__row-delete"
                    type="button"
                    @click="removeOption(editingOptionsRow, optionIndex)"
                  >
                    删除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <div v-if="!editingOptionsRow.options.length" class="player-override-dialog__empty">
            还没有下拉选项，先添加一项。
          </div>
        </div>

        <div class="player-override-dialog__footer">
          <button class="btn-secondary" type="button" @click="addOption(editingOptionsRow)">
            + 添加选项
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.player-override-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
  backdrop-filter: blur(10px);
}

.player-override-dialog__panel {
  width: min(1280px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: auto;
  border-radius: 22px;
}

.player-override-dialog__option-panel {
  position: fixed;
  inset: auto 20px 20px auto;
  z-index: 1;
  width: min(720px, calc(100vw - 40px));
  max-height: min(620px, calc(100vh - 40px));
  padding: 18px;
  overflow: auto;
  border-radius: 20px;
  box-shadow: 0 22px 80px rgba(0, 0, 0, 0.42);
}

.player-override-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.player-override-dialog__title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
  line-height: 1.1;
}

.player-override-dialog__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.player-override-dialog__hint,
.player-override-dialog__warning {
  margin: 10px 0 0;
  font-size: 0.86rem;
  color: var(--text-muted);
}

.player-override-dialog__warning {
  color: var(--warning);
}

.player-override-dialog__table-wrap {
  margin-top: 16px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.player-override-dialog__table {
  width: 100%;
  min-width: 1260px;
  border-collapse: collapse;
}

.player-override-dialog__option-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
}

.player-override-dialog__table th,
.player-override-dialog__table td,
.player-override-dialog__option-table th,
.player-override-dialog__option-table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.player-override-dialog__table th,
.player-override-dialog__option-table th {
  position: sticky;
  top: 0;
  background: rgba(9, 19, 30, 0.92);
  font-size: 0.82rem;
  color: var(--text-muted);
}

.player-override-dialog__order-col {
  width: 76px;
}

.player-override-dialog__checkbox-col {
  width: 132px;
}

.player-override-dialog__input-type-col {
  width: 150px;
}

.player-override-dialog__group-col {
  width: 124px;
}

.player-override-dialog__action-col {
  width: 96px;
}

.player-override-dialog__order-cell,
.player-override-dialog__checkbox-cell,
.player-override-dialog__action-cell {
  white-space: nowrap;
}

.player-override-dialog__order-buttons {
  display: flex;
  gap: 6px;
}

.player-override-dialog__icon-button {
  width: 32px;
  min-width: 32px;
  min-height: 32px;
  padding: 0;
  border-radius: 10px;
}

.player-override-dialog__cell-input,
.player-override-dialog__group-input {
  min-width: 0;
  width: 100%;
}

.player-override-dialog__cell-input--invalid {
  border-color: var(--warning);
}

.player-override-dialog__input-type-field {
  display: grid;
  gap: 8px;
}

.player-override-dialog__options-button {
  min-height: 32px;
  padding: 0 10px;
  border-radius: 10px;
}

.player-override-dialog__checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
}

.player-override-dialog__tips-input {
  min-height: 72px;
}

.player-override-dialog__row-delete {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 10px;
}

.player-override-dialog__group-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.player-override-dialog__help-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid rgba(186, 220, 255, 0.3);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  cursor: pointer;
}

.player-override-dialog__help-popover {
  display: block;
  margin-top: 6px;
  font-size: 0.76rem;
  line-height: 1.4;
  color: var(--text-main);
  font-weight: 400;
}

.player-override-dialog__empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.player-override-dialog__option-table-wrap {
  margin-top: 16px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.player-override-dialog__footer {
  display: flex;
  justify-content: flex-start;
  margin-top: 16px;
}

@media (max-width: 900px) {
  .player-override-dialog__header,
  .player-override-dialog__actions {
    flex-direction: column;
    align-items: stretch;
  }

  .player-override-dialog__option-panel {
    inset: auto 12px 12px;
    width: calc(100vw - 24px);
  }
}
</style>
