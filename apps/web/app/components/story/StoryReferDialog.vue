<script setup lang="ts">
import type { StoryReferFile } from "@story-mgr/core"

interface ReferTermDraft {
  id: string
  label: string
  male: string
  female: string
  fallback: string
}

const props = defineProps<{
  refer: StoryReferFile
  saving: boolean
  saveSuccessMessage?: string | null
}>()

const emit = defineEmits<{
  close: []
  save: [refer: StoryReferFile]
}>()

const genderValueKey = shallowRef("player.gender")
const maleAliasesText = shallowRef("男, male, m")
const femaleAliasesText = shallowRef("女, female, f")
const terms = ref<ReferTermDraft[]>([])

/** 解析 `AliasText` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
function parseAliasText(value: string, fallback: string[]) {
  const aliases = Array.from(
    new Set(
      value
        .split(/[,，\s]+/g)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )

  return aliases.length > 0 ? aliases : fallback
}

/** 复制 `Term`，避免共享可变引用。 @param term 调用方传入的 `term`。 @returns 计算、查找或构建后的结果。 */
function cloneTerm(term: StoryReferFile["terms"][number]): ReferTermDraft {
  return {
    id: term.id.trim(),
    label: term.label.trim(),
    male: term.male.trim(),
    female: term.female.trim(),
    fallback: term.fallback.trim()
  }
}

/** 把外部或服务端数据同步到本地响应式状态。 @param refer 调用方传入的 `refer`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(refer: StoryReferFile) {
  genderValueKey.value = refer.gender_value_key?.trim() || "player.gender"
  maleAliasesText.value = (refer.gender_aliases?.male?.length ? refer.gender_aliases.male : ["男", "male", "m"]).join(", ")
  femaleAliasesText.value = (refer.gender_aliases?.female?.length ? refer.gender_aliases.female : ["女", "female", "f"]).join(", ")
  terms.value = (refer.terms ?? []).map(cloneTerm)
}

/** 创建一份新的 `EmptyTerm` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyTerm(): ReferTermDraft {
  const index = terms.value.length + 1
  return {
    id: `player.term_${index}`,
    label: "",
    male: "",
    female: "",
    fallback: ""
  }
}

/** 新增一项 `Term` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addTerm() {
  terms.value = [...terms.value, createEmptyTerm()]
}

/** 移除指定的 `Term` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeTerm(index: number) {
  terms.value = terms.value.filter((_term, currentIndex) => currentIndex !== index)
}

/** 把 `TermToken` 转换成界面可读文本。 @param termId 调用方传入的 `termId`。 @returns 计算、查找或构建后的结果。 */
function formatTermToken(termId: string) {
  const normalizedId = termId.trim().replace(/^term\./, "")
  return normalizedId ? `\${term.${normalizedId}}` : "${term.xxx}"
}

/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function submitDraft() {
  emit("save", {
    gender_value_key: genderValueKey.value.trim() || "player.gender",
    gender_aliases: {
      male: parseAliasText(maleAliasesText.value, ["男", "male", "m"]),
      female: parseAliasText(femaleAliasesText.value, ["女", "female", "f"])
    },
    terms: terms.value
      .map((term) => ({
        id: term.id.trim().replace(/^term\./, ""),
        label: term.label.trim(),
        male: term.male.trim(),
        female: term.female.trim(),
        fallback: term.fallback.trim()
      }))
      .filter((term) => term.id)
  })
}

watch(
  () => props.refer,
  (refer) => {
    syncDraft(refer)
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <div class="refer-dialog">
      <section class="refer-dialog__panel glass-panel">
        <div class="refer-dialog__header">
          <div>
            <span class="eyebrow">Refer</span>
            <h2 class="refer-dialog__title">称谓库</h2>
            <p class="refer-dialog__subtitle">
              在对白、消息和联系人短句里使用 <code>${term.player.respect}</code> 这类占位符，运行时会根据玩家性别自动替换。
            </p>
          </div>

          <div class="refer-dialog__header-actions">
            <span v-if="saveSuccessMessage" class="refer-dialog__success">{{ saveSuccessMessage }}</span>
            <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
            <button class="btn-primary" type="button" :disabled="saving" @click="submitDraft">
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>

        <div class="refer-dialog__config">
          <label class="refer-dialog__field">
            <span class="refer-dialog__label">性别变量</span>
            <input v-model="genderValueKey" class="text-input" type="text" placeholder="player.gender" />
          </label>

          <label class="refer-dialog__field">
            <span class="refer-dialog__label">男性值</span>
            <input v-model="maleAliasesText" class="text-input" type="text" placeholder="男, male, m" />
          </label>

          <label class="refer-dialog__field">
            <span class="refer-dialog__label">女性值</span>
            <input v-model="femaleAliasesText" class="text-input" type="text" placeholder="女, female, f" />
          </label>
        </div>

        <div class="refer-dialog__section-head">
          <div>
            <h3 class="refer-dialog__section-title">称谓条目</h3>
            <p class="refer-dialog__section-note">ID 不需要写 term. 前缀，保存后模板里使用右侧显示的占位符。</p>
          </div>
          <button class="btn-secondary refer-dialog__action" type="button" @click="addTerm">新增称谓</button>
        </div>

        <div class="refer-dialog__table-wrap">
          <table class="refer-dialog__table">
            <thead>
              <tr>
                <th>ID</th>
                <th>用途</th>
                <th>男</th>
                <th>女</th>
                <th>兜底</th>
                <th>占位符</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(term, index) in terms" :key="`${term.id}:${index}`">
                <td>
                  <input v-model="term.id" class="text-input refer-dialog__cell-input" type="text" />
                </td>
                <td>
                  <input v-model="term.label" class="text-input refer-dialog__cell-input" type="text" />
                </td>
                <td>
                  <input v-model="term.male" class="text-input refer-dialog__cell-input" type="text" />
                </td>
                <td>
                  <input v-model="term.female" class="text-input refer-dialog__cell-input" type="text" />
                </td>
                <td>
                  <input v-model="term.fallback" class="text-input refer-dialog__cell-input" type="text" />
                </td>
                <td>
                  <code class="refer-dialog__token">{{ formatTermToken(term.id) }}</code>
                </td>
                <td>
                  <button class="btn-secondary refer-dialog__remove" type="button" @click="removeTerm(index)">
                    删除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <p v-if="terms.length === 0" class="refer-dialog__empty">
            还没有称谓条目，可以先新增一个。
          </p>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.refer-dialog {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(2, 8, 16, 0.72);
}

.refer-dialog__panel {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 16px;
  width: min(1200px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: hidden;
  border-radius: 22px;
}

.refer-dialog__header,
.refer-dialog__section-head,
.refer-dialog__header-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.refer-dialog__header-actions {
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.refer-dialog__title,
.refer-dialog__section-title {
  margin: 8px 0 0;
  font-family: "Space Grotesk", sans-serif;
  color: var(--text);
}

.refer-dialog__title {
  font-size: 1.5rem;
}

.refer-dialog__section-title {
  font-size: 1.05rem;
}

.refer-dialog__subtitle,
.refer-dialog__section-note,
.refer-dialog__success {
  margin: 8px 0 0;
  color: var(--text-muted);
  line-height: 1.6;
}

.refer-dialog__success {
  color: var(--success);
}

.refer-dialog__config {
  display: grid;
  grid-template-columns: minmax(220px, 1.2fr) repeat(2, minmax(180px, 1fr));
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.refer-dialog__field {
  display: grid;
  gap: 6px;
}

.refer-dialog__label {
  color: var(--text-muted);
  font-size: 0.86rem;
}

.refer-dialog__action,
.refer-dialog__remove {
  min-height: 36px;
  padding: 0 12px;
  border-radius: 12px;
}

.refer-dialog__table-wrap {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
}

.refer-dialog__table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
}

.refer-dialog__table th,
.refer-dialog__table td {
  padding: 10px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}

.refer-dialog__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(10, 20, 30, 0.96);
  color: var(--text-muted);
  font-size: 0.82rem;
}

.refer-dialog__cell-input {
  min-width: 120px;
  padding: 10px 12px;
}

.refer-dialog__token {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  white-space: nowrap;
  color: var(--text);
}

.refer-dialog__empty {
  margin: 0;
  padding: 18px;
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .refer-dialog__header,
  .refer-dialog__section-head {
    flex-direction: column;
  }

  .refer-dialog__config {
    grid-template-columns: 1fr;
  }

  .refer-dialog__header-actions {
    justify-content: flex-start;
  }
}
</style>
