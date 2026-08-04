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

/** 创建一份新的 `DraftKey` 数据。 @returns 计算、查找或构建后的结果。 */
function createDraftKey() {
  draftKeySeed += 1
  return `player-override-${draftKeySeed}`
}

/** 创建一份新的 `OptionDraftKey` 数据。 @returns 计算、查找或构建后的结果。 */
function createOptionDraftKey() {
  draftKeySeed += 1
  return `player-override-option-${draftKeySeed}`
}

/** 将 `Text` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

/** 将 `InputType` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeInputType(value: unknown): StoryPlayerOverrideInputType {
  return value === "select" ? "select" : "text"
}

/** 将 `GroupNo` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeGroupNo(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1 ? String(value) : "1"
}

/** 创建一份新的 `OptionDraft` 数据。 @param option 调用方传入的 `option`。 @returns 计算、查找或构建后的结果。 */
function createOptionDraft(option?: Partial<StoryPlayerOverrideInputOption>): PlayerOverrideOptionDraft {
  return {
    draftKey: createOptionDraftKey(),
    label: normalizeText(option?.label),
    value: normalizeText(option?.value)
  }
}

/** 复制 `Options`，避免共享可变引用。 @param options 调用方传入的 `options`。 @returns 计算、查找或构建后的结果。 */
function cloneOptions(options: StoryPlayerOverrideInputOption[] | undefined): PlayerOverrideOptionDraft[] {
  if (!Array.isArray(options)) {
    return []
  }

  return options.map((option) => createOptionDraft(option))
}

/** 清理 `GroupNoInput` 输入中的非法字符或范围。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function sanitizeGroupNoInput(value: string) {
  const digitsOnly = value.replace(/[^\d]/g, "")
  if (!digitsOnly) {
    return "1"
  }

  const parsedValue = Number.parseInt(digitsOnly, 10)
  return String(parsedValue >= 1 ? parsedValue : 1)
}

/** 创建一份新的 `EmptyRow` 数据。 @returns 计算、查找或构建后的结果。 */
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

/** 复制 `Entry`，避免共享可变引用。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
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

/** 读取或计算 `NormalizedOptionValues`。 @param row 调用方传入的 `row`。 @returns 计算、查找或构建后的结果。 */
function getNormalizedOptionValues(row: PlayerOverrideRowDraft) {
  return row.options.map((option) => option.value.trim()).filter(Boolean)
}

/** 判断 `hasDuplicateOptionValues` 对应的条件是否成立。 @param row 调用方传入的 `row`。 @returns 布尔判断结果。 */
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

/** 判断 `isOptionValueDuplicated` 对应的条件是否成立。 @param row 调用方传入的 `row`。 @param value 调用方传入的 `value`。 @returns 布尔判断结果。 */
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

/** 把外部或服务端数据同步到本地响应式状态。 @param file 调用方传入的 `file`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(file: StoryPlayerOverrideValsFile) {
  draftRows.value = file.entries.map(cloneEntry)
  editingOptionsRowKey.value = null
}

/** 新增一项 `Row` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addRow() {
  draftRows.value.push(createEmptyRow())
}

/** 移除指定的 `Row` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeRow(index: number) {
  if (draftRows.value[index]?.draftKey === editingOptionsRowKey.value) {
    editingOptionsRowKey.value = null
  }

  draftRows.value.splice(index, 1)
}

/** 调整 `RowUp` 在列表中的顺序。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function moveRowUp(index: number) {
  if (index <= 0) {
    return
  }

  const nextRows = [...draftRows.value]
  const [targetRow] = nextRows.splice(index, 1)
  nextRows.splice(index - 1, 0, targetRow!)
  draftRows.value = nextRows
}

/** 调整 `RowDown` 在列表中的顺序。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function moveRowDown(index: number) {
  if (index >= draftRows.value.length - 1) {
    return
  }

  const nextRows = [...draftRows.value]
  const [targetRow] = nextRows.splice(index, 1)
  nextRows.splice(index + 1, 0, targetRow!)
  draftRows.value = nextRows
}

/** 根据当前输入构建 `SelectOptions` 结果。 @param rowDraft 调用方传入的 `rowDraft`。 @returns 计算、查找或构建后的结果。 */
function buildSelectOptions(rowDraft: PlayerOverrideRowDraft) {
  return globalValOptions.value.filter((option) => {
    return option.value === rowDraft.varKey || !selectedVarKeySet.value.has(option.value)
  })
}

/** 执行 `updateGroupNo` 对应的局部业务逻辑。 @param row 调用方传入的 `row`。 @param value 调用方传入的 `value`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function updateGroupNo(row: PlayerOverrideRowDraft, value: string) {
  row.groupNoText = sanitizeGroupNoInput(value)
}

/** 处理 `GroupNoInput` 用户交互。 @param row 调用方传入的 `row`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleGroupNoInput(row: PlayerOverrideRowDraft, event: Event) {
  const target = event.target
  const nextValue = target instanceof HTMLInputElement ? target.value : "1"
  updateGroupNo(row, nextValue)
}

/** 处理 `InputTypeChange` 用户交互。 @param row 调用方传入的 `row`。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleInputTypeChange(row: PlayerOverrideRowDraft, event: Event) {
  const target = event.target
  row.inputType = normalizeInputType(target instanceof HTMLSelectElement ? target.value : "text")

  if (row.inputType === "select" && row.options.length === 0) {
    row.options.push(createOptionDraft())
  }
}

/** 打开 `OptionsEditor` 界面并初始化临时状态。 @param row 调用方传入的 `row`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openOptionsEditor(row: PlayerOverrideRowDraft) {
  if (row.inputType === "select" && row.options.length === 0) {
    row.options.push(createOptionDraft())
  }

  editingOptionsRowKey.value = row.draftKey
}

/** 关闭 `OptionsEditor` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeOptionsEditor() {
  editingOptionsRowKey.value = null
}

/** 新增一项 `Option` 草稿。 @param row 调用方传入的 `row`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addOption(row: PlayerOverrideRowDraft) {
  row.options.push(createOptionDraft())
}

/** 移除指定的 `Option` 数据。 @param row 调用方传入的 `row`。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeOption(row: PlayerOverrideRowDraft, index: number) {
  row.options.splice(index, 1)
}

/** 调整 `OptionUp` 在列表中的顺序。 @param row 调用方传入的 `row`。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function moveOptionUp(row: PlayerOverrideRowDraft, index: number) {
  if (index <= 0) {
    return
  }

  const [targetOption] = row.options.splice(index, 1)
  row.options.splice(index - 1, 0, targetOption!)
}

/** 调整 `OptionDown` 在列表中的顺序。 @param row 调用方传入的 `row`。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function moveOptionDown(row: PlayerOverrideRowDraft, index: number) {
  if (index >= row.options.length - 1) {
    return
  }

  const [targetOption] = row.options.splice(index, 1)
  row.options.splice(index + 1, 0, targetOption!)
}

/** 将 `OutputOptions` 输入清洗为内部统一格式。 @param row 调用方传入的 `row`。 @returns 计算、查找或构建后的结果。 */
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

/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
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

<style scoped src="./styles/StoryPlayerOverrideValsDialog.css"></style>
