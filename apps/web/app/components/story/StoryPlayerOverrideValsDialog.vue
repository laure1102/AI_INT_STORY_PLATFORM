<script setup lang="ts">
import type {
  StoryPlayerOverrideValEntry,
  StoryPlayerOverrideValsFile,
  StoryValsFile
} from "@story-mgr/core"

interface PlayerOverrideRowDraft {
  draftKey: string
  varKey: string
  needPlayerOverride: boolean
  tips: string
  groupNoText: string
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

let draftKeySeed = 0

function createDraftKey() {
  draftKeySeed += 1
  return `player-override-${draftKeySeed}`
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function normalizeGroupNo(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1 ? String(value) : "1"
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
    groupNoText: "1"
  }
}

function cloneEntry(entry: StoryPlayerOverrideValEntry): PlayerOverrideRowDraft {
  return {
    draftKey: createDraftKey(),
    varKey: normalizeText(entry.var_key).trim(),
    needPlayerOverride: Boolean(entry.need_player_override),
    tips: normalizeText(entry.tips),
    groupNoText: normalizeGroupNo(entry.group_no)
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

function syncDraft(file: StoryPlayerOverrideValsFile) {
  draftRows.value = file.entries.map(cloneEntry)
}

function addRow() {
  draftRows.value.push(createEmptyRow())
}

function removeRow(index: number) {
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

function submitDraft() {
  emit("save", {
    entries: draftRows.value.map((row) => ({
      var_key: row.varKey.trim(),
      need_player_override: row.needPlayerOverride,
      tips: row.tips,
      group_no: Number.parseInt(sanitizeGroupNoInput(row.groupNoText), 10)
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
              :disabled="saving || hasInvalidDraft"
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
  min-width: 1120px;
  border-collapse: collapse;
}

.player-override-dialog__table th,
.player-override-dialog__table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.player-override-dialog__table th {
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
}
</style>
