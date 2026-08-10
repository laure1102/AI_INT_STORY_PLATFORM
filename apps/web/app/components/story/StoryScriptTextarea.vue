<script setup lang="ts">
import type {
  StoryDocument,
  StoryValsFile
} from "@story-mgr/core"
import StoryScriptAutocompletePanel from "./StoryScriptAutocompletePanel.vue"
import {
  buildStoryScriptBuiltinAutocompleteItems,
  buildStoryScriptHighlightTokens,
  buildStoryScriptInvokeAutocompleteContext,
  buildStoryContactConversationAutocompleteItems,
  buildStoryReferAutocompleteItems,
  buildStoryScriptValAutocompleteItems,
  filterStoryScriptAutocompleteItems,
  mergeStoryScriptAutocompleteItems,
  resolveStoryScriptCommandAutocomplete,
  resolveStoryScriptAutocompletePlacement,
  type StoryScriptAutocompleteItem
} from "./storyScriptEditor"

const props = withDefaults(defineProps<{
  highlight?: boolean
  minHeight?: string
  mode: "predicate" | "procedure" | "template"
  placeholder?: string
  story?: StoryDocument | null
  vals: StoryValsFile
}>(), {
  highlight: false,
  minHeight: "96px",
  placeholder: "",
  story: null
})

const model = defineModel<string>({ required: true })

const textareaRef = useTemplateRef<HTMLTextAreaElement>("textarea")
const highlightRef = useTemplateRef<HTMLElement>("highlight")
const autocompleteState = reactive({
  open: false,
  query: "",
  replaceStart: 0,
  replaceEnd: 0,
  activeIndex: 0,
  placement: "bottom" as "top" | "bottom",
  mode: "placeholder" as "placeholder" | "invoke_once",
  commandItems: [] as StoryScriptAutocompleteItem[]
})

const autocompleteCandidates = computed(() =>
  props.mode === "template"
    ? mergeStoryScriptAutocompleteItems(
        buildStoryScriptValAutocompleteItems(props.vals),
        buildStoryReferAutocompleteItems(props.story)
      )
    : mergeStoryScriptAutocompleteItems(
        buildStoryScriptBuiltinAutocompleteItems(),
        buildStoryScriptValAutocompleteItems(props.vals),
        buildStoryReferAutocompleteItems(props.story),
        buildStoryContactConversationAutocompleteItems(props.story)
      )
)

const invokeAutocompleteContext = computed(() =>
  buildStoryScriptInvokeAutocompleteContext(props.story)
)

const autocompleteItems = computed(() => {
  const sourceItems = autocompleteState.mode === "invoke_once"
    ? autocompleteState.commandItems
    : autocompleteCandidates.value

  return filterStoryScriptAutocompleteItems(autocompleteState.query, sourceItems)
})

const highlightedTokens = computed(() => buildStoryScriptHighlightTokens(model.value))

const textareaStyle = computed(() => ({
  minHeight: props.minHeight,
  maxHeight: props.minHeight
}))

/** 关闭 `Autocomplete` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeAutocomplete() {
  autocompleteState.open = false
  autocompleteState.query = ""
  autocompleteState.replaceStart = 0
  autocompleteState.replaceEnd = 0
  autocompleteState.activeIndex = 0
  autocompleteState.placement = "bottom"
  autocompleteState.mode = "placeholder"
  autocompleteState.commandItems = []
}

/** 执行 `updateAutocompleteFromCaret` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function updateAutocompleteFromCaret() {
  const textarea = textareaRef.value
  if (!textarea) {
    closeAutocomplete()
    return
  }

  const caret = textarea.selectionStart ?? model.value.length
  const autocomplete = resolveStoryScriptCommandAutocomplete(model.value, caret, {
    invokeContext: props.mode === "procedure" ? invokeAutocompleteContext.value : undefined
  })

  if (!autocomplete) {
    closeAutocomplete()
    return
  }

  autocompleteState.open = autocomplete.state.open
  autocompleteState.query = autocomplete.state.query
  autocompleteState.replaceStart = autocomplete.state.replaceStart
  autocompleteState.replaceEnd = autocomplete.state.replaceEnd
  autocompleteState.placement = resolveStoryScriptAutocompletePlacement(textarea)
  autocompleteState.mode = autocomplete.state.mode
  autocompleteState.commandItems = autocomplete.state.mode === "invoke_once" ? autocomplete.items : []

  if (!autocompleteItems.value.length || autocompleteState.activeIndex >= autocompleteItems.value.length) {
    autocompleteState.activeIndex = 0
  }
}

/** 执行 `insertAutocompleteItem` 对应的局部业务逻辑。 @param itemName 调用方传入的 `itemName`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function insertAutocompleteItem(itemName: string) {
  const textarea = textareaRef.value
  const replaceStart = autocompleteState.replaceStart
  const isPlaceholderMode = model.value.slice(replaceStart, replaceStart + 2) === "${"
  const nextValue = isPlaceholderMode
    ? model.value.slice(0, replaceStart + 2) + itemName + "}" + model.value.slice(autocompleteState.replaceEnd)
    : model.value.slice(0, replaceStart) + itemName + model.value.slice(autocompleteState.replaceEnd)

  model.value = nextValue
  closeAutocomplete()

  requestAnimationFrame(() => {
    const nextCaret = isPlaceholderMode
      ? replaceStart + itemName.length + 3
      : replaceStart + itemName.length
    textarea?.focus()
    textarea?.setSelectionRange(nextCaret, nextCaret)
  })
}

/** 处理 `Input` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleInput() {
  updateAutocompleteFromCaret()
}

/** 处理 `Keydown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleKeydown(event: KeyboardEvent) {
  if (!autocompleteState.open) {
    if (event.key === "{") {
      requestAnimationFrame(updateAutocompleteFromCaret)
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
    autocompleteState.activeIndex = (autocompleteState.activeIndex + 1) % Math.max(autocompleteItems.value.length, 1)
    return
  }

  if (event.key === "ArrowUp") {
    event.preventDefault()
    const length = Math.max(autocompleteItems.value.length, 1)
    autocompleteState.activeIndex = (autocompleteState.activeIndex - 1 + length) % length
    return
  }

  if (event.key === "Enter" || event.key === "Tab") {
    const activeItem = autocompleteItems.value[autocompleteState.activeIndex % autocompleteItems.value.length]
    if (!activeItem) {
      return
    }

    event.preventDefault()
    insertAutocompleteItem(activeItem.name)
  }
}

/** 处理 `Scroll` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement | null
  const highlightElement = highlightRef.value

  if (!textarea || !highlightElement) {
    return
  }

  highlightElement.scrollTop = textarea.scrollTop
  highlightElement.scrollLeft = textarea.scrollLeft
}
</script>

<template>
  <div class="story-script-textarea">
    <div class="story-script-textarea__editor">
      <pre
        v-if="highlight"
        ref="highlight"
        class="story-script-textarea__highlight"
        :style="textareaStyle"
        aria-hidden="true"
      ><code><template
          v-for="(token, index) in highlightedTokens"
          :key="index"
        ><span
            :class="[
              'story-script-textarea__token',
              token.highlighted ? 'story-script-textarea__token--keyword' : ''
            ]"
            v-html="token.text || '&nbsp;'"
          /></template></code></pre>
      <textarea
        ref="textarea"
        v-model="model"
        class="text-area story-script-textarea__input"
        :class="{ 'story-script-textarea__input--overlay': highlight }"
        :placeholder="placeholder"
        :style="textareaStyle"
        spellcheck="false"
        @click="updateAutocompleteFromCaret"
        @input="handleInput"
        @keydown="handleKeydown"
        @keyup="updateAutocompleteFromCaret"
        @scroll="handleScroll"
      />
    </div>

    <StoryScriptAutocompletePanel
      v-if="autocompleteState.open"
      :active-index="autocompleteState.activeIndex"
      :items="autocompleteItems"
      :placement="autocompleteState.placement"
      @select="insertAutocompleteItem"
    />
  </div>
</template>

<style scoped>
.story-script-textarea {
  position: relative;
}

.story-script-textarea__editor {
  position: relative;
}

.story-script-textarea__highlight,
.story-script-textarea__input {
  width: 100%;
  margin: 0;
  overflow: auto;
  font: inherit;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  tab-size: 2;
}

.story-script-textarea__highlight {
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.86);
  pointer-events: none;
}

.story-script-textarea__highlight code {
  font: inherit;
}

.story-script-textarea__token--keyword {
  color: #63a9ff;
}

.story-script-textarea__input {
  resize: vertical;
}

.story-script-textarea__input--overlay {
  position: absolute;
  inset: 0;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
}

.story-script-textarea__input--overlay::selection {
  background: rgba(99, 169, 255, 0.28);
}
</style>
