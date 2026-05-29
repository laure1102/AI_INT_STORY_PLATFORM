<script setup lang="ts">
interface RoleMultiSelectOption {
  key: string
  label: string
}

const props = withDefaults(defineProps<{
  importantOptions: RoleMultiSelectOption[]
  normalOptions: RoleMultiSelectOption[]
  placeholder?: string
}>(), {
  placeholder: "搜索并选择角色"
})

const model = defineModel<string[]>({ required: true })

const rootRef = useTemplateRef<HTMLDivElement>("root")
const searchInputRef = useTemplateRef<HTMLInputElement>("searchInput")
const isOpen = shallowRef(false)
const searchQuery = shallowRef("")

const allOptions = computed<RoleMultiSelectOption[]>(() => {
  return [...props.importantOptions, ...props.normalOptions]
})

const optionMap = computed(() => {
  return new Map(allOptions.value.map((option) => [option.key, option] satisfies [string, RoleMultiSelectOption]))
})

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase())
const selectedSet = computed(() => new Set(model.value))

const selectedOptions = computed(() => {
  return model.value.map((roleKey) => {
    return optionMap.value.get(roleKey) ?? { key: roleKey, label: roleKey }
  })
})

const filteredImportantOptions = computed(() => {
  if (!normalizedSearchQuery.value) {
    return props.importantOptions
  }

  return props.importantOptions.filter((option) => {
    return option.label.toLowerCase().includes(normalizedSearchQuery.value)
  })
})

const filteredNormalOptions = computed(() => {
  if (!normalizedSearchQuery.value) {
    return props.normalOptions
  }

  return props.normalOptions.filter((option) => {
    return option.label.toLowerCase().includes(normalizedSearchQuery.value)
  })
})

const hasMatches = computed(() => {
  return filteredImportantOptions.value.length > 0 || filteredNormalOptions.value.length > 0
})

function focusSearchInput() {
  void nextTick(() => {
    searchInputRef.value?.focus()
  })
}

function openPanel() {
  if (isOpen.value) {
    focusSearchInput()
    return
  }

  isOpen.value = true
  focusSearchInput()
}

function closePanel() {
  isOpen.value = false
  searchQuery.value = ""
}

function togglePanel() {
  if (isOpen.value) {
    closePanel()
    return
  }

  openPanel()
}

function toggleOption(roleKey: string) {
  if (selectedSet.value.has(roleKey)) {
    model.value = model.value.filter((currentRoleKey) => currentRoleKey !== roleKey)
  } else {
    model.value = [...model.value, roleKey]
  }

  searchQuery.value = ""
  openPanel()
}

function removeOption(roleKey: string) {
  model.value = model.value.filter((currentRoleKey) => currentRoleKey !== roleKey)
}

function clearSelection() {
  model.value = []
  searchQuery.value = ""
  openPanel()
}

function handleControlPointerDown(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest(".role-multi-select__chip-remove")) {
    return
  }

  event.preventDefault()
}

function handleControlClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest(".role-multi-select__chip-remove")) {
    return
  }

  openPanel()
}

function handleDocumentPointerDown(event: MouseEvent) {
  if (!isOpen.value) {
    return
  }

  const rootElement = rootRef.value
  const target = event.target as Node | null

  if (!rootElement || !target || rootElement.contains(target)) {
    return
  }

  closePanel()
}

onMounted(() => {
  document.addEventListener("mousedown", handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleDocumentPointerDown)
})
</script>

<template>
  <div ref="root" class="role-multi-select">
    <div
      class="role-multi-select__control"
      :class="{ 'role-multi-select__control--open': isOpen }"
      role="button"
      tabindex="0"
      @click="handleControlClick"
      @keydown.enter.prevent="togglePanel"
      @keydown.space.prevent="togglePanel"
      @mousedown="handleControlPointerDown"
    >
      <div v-if="selectedOptions.length" class="role-multi-select__chips">
        <div
          v-for="option in selectedOptions"
          :key="option.key"
          class="role-multi-select__chip"
        >
          <span class="role-multi-select__chip-label">{{ option.label }}</span>
          <button
            class="role-multi-select__chip-remove"
            type="button"
            aria-label="删除已选角色"
            @click.stop="removeOption(option.key)"
          >
            x
          </button>
        </div>
      </div>

      <span v-else class="role-multi-select__placeholder">
        {{ placeholder }}
      </span>

      <div class="role-multi-select__meta">
        <span class="role-multi-select__count">
          {{ model.length ? `已选 ${model.length}` : "未选择" }}
        </span>
        <span class="role-multi-select__caret" :class="{ 'role-multi-select__caret--open': isOpen }">
          v
        </span>
      </div>
    </div>

    <div v-if="isOpen" class="role-multi-select__panel">
      <div class="role-multi-select__toolbar">
        <input
          ref="searchInput"
          v-model="searchQuery"
          class="text-input role-multi-select__search"
          type="text"
          placeholder="搜索角色名或职业"
          @keydown.escape.stop.prevent="closePanel"
        />
        <button
          v-if="model.length"
          class="btn-secondary role-multi-select__clear"
          type="button"
          @click="clearSelection"
        >
          清空
        </button>
      </div>

      <div class="role-multi-select__results">
        <section v-if="filteredImportantOptions.length" class="role-multi-select__group">
          <header class="role-multi-select__group-title">重要角色</header>
          <label
            v-for="option in filteredImportantOptions"
            :key="option.key"
            class="role-multi-select__option"
          >
            <input
              :checked="selectedSet.has(option.key)"
              type="checkbox"
              @change="toggleOption(option.key)"
            />
            <span>{{ option.label }}</span>
          </label>
        </section>

        <section v-if="filteredNormalOptions.length" class="role-multi-select__group">
          <header class="role-multi-select__group-title">普通角色</header>
          <label
            v-for="option in filteredNormalOptions"
            :key="option.key"
            class="role-multi-select__option"
          >
            <input
              :checked="selectedSet.has(option.key)"
              type="checkbox"
              @change="toggleOption(option.key)"
            />
            <span>{{ option.label }}</span>
          </label>
        </section>

        <div v-if="!hasMatches" class="role-multi-select__empty">
          没有匹配的角色
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.role-multi-select {
  position: relative;
}

.role-multi-select__control {
  min-height: 52px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}

.role-multi-select__control--open {
  border-color: rgba(255, 180, 84, 0.65);
  box-shadow: 0 0 0 1px rgba(255, 180, 84, 0.2);
}

.role-multi-select__placeholder {
  color: var(--text-muted);
  line-height: 1.8;
}

.role-multi-select__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.role-multi-select__chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  max-width: 100%;
  padding: 0 8px 0 10px;
  border: 1px solid rgba(255, 180, 84, 0.24);
  border-radius: 999px;
  background: rgba(255, 180, 84, 0.1);
  color: var(--text);
  pointer-events: none;
}

.role-multi-select__chip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-multi-select__chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
  flex-shrink: 0;
}

.role-multi-select__chip-remove:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.role-multi-select__meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding-top: 4px;
}

.role-multi-select__count,
.role-multi-select__caret {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.role-multi-select__caret {
  transition: transform 0.2s ease;
}

.role-multi-select__caret--open {
  transform: rotate(180deg);
}

.role-multi-select__panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 20;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(10, 24, 37, 0.98);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(14px);
}

.role-multi-select__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.role-multi-select__search {
  min-width: 0;
}

.role-multi-select__clear {
  min-height: 38px;
  padding: 0 12px;
  white-space: nowrap;
}

.role-multi-select__results {
  max-height: 280px;
  overflow-y: auto;
  display: grid;
  gap: 12px;
  padding-right: 4px;
}

.role-multi-select__group {
  display: grid;
  gap: 8px;
}

.role-multi-select__group-title {
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.role-multi-select__option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
}

.role-multi-select__option span {
  min-width: 0;
  color: var(--text);
  line-height: 1.4;
  word-break: break-word;
}

.role-multi-select__empty {
  padding: 18px 12px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  color: var(--text-muted);
  text-align: center;
}

@media (max-width: 900px) {
  .role-multi-select__control,
  .role-multi-select__toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .role-multi-select__meta {
    justify-content: space-between;
    padding-top: 0;
  }
}
</style>
