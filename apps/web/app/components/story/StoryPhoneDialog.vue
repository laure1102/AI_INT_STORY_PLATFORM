<script setup lang="ts">
import type { StoryPhoneFile } from "@story-mgr/core"
import StoryPhoneContactSections from "./StoryPhoneContactSections.vue"
import StoryPhoneLibrarySections from "./StoryPhoneLibrarySections.vue"
import {
  useStoryPhoneEditor,
  type StoryPhoneEditorEmits,
  type StoryPhoneEditorProps
} from "./useStoryPhoneEditor"

const props = defineProps<StoryPhoneEditorProps>()
const emit = defineEmits<StoryPhoneEditorEmits>()
const editor = useStoryPhoneEditor(props, emit)
</script>

<template>
  <Teleport to="body">
    <div class="phone-dialog">
      <section class="phone-dialog__panel glass-panel">
        <div class="phone-dialog__header">
          <div class="phone-dialog__header-copy">
            <span class="eyebrow">手机联系人</span>
            <h2 class="phone-dialog__title">手机联系人配置</h2>
            <p class="phone-dialog__subtitle">
              当前弹窗优先编辑新的关系规则、性格、短句、动作和回复结构。现有运行时依赖的旧联系人配置会保留不动。
            </p>
            <p v-if="saveSuccessMessage" class="phone-dialog__success">{{ saveSuccessMessage }}</p>
          </div>

          <div class="phone-dialog__header-actions">
            <button class="btn-secondary phone-dialog__action" type="button" @click="emit('close')">
              关闭
            </button>
            <button class="btn-primary phone-dialog__action" type="button" :disabled="saving" @click="editor.submitDraft">
              {{ saving ? "保存中..." : "保存手机配置" }}
            </button>
          </div>
        </div>

        <div class="phone-dialog__body">
        <div class="phone-dialog__tabs">
          <button
            v-for="tab in editor.tabOptions"
            :key="tab.key"
            class="phone-dialog__tab"
            :class="{ 'phone-dialog__tab--active': editor.activeTab === tab.key }"
            type="button"
            @click="editor.activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <StoryPhoneLibrarySections
          v-if="['tracks', 'personalities', 'talks', 'actions', 'replies'].includes(editor.activeTab)"
          :editor="editor"
          :item-ids="props.itemIds"
          :story="props.story"
          :vals="props.vals"
        />
        <StoryPhoneContactSections
          v-else
          :editor="editor"
          :story="props.story"
          :vals="props.vals"
        />

        <div class="phone-dialog__footer">
          <button class="btn-secondary phone-dialog__action" type="button" @click="emit('close')">
            关闭
          </button>
          <button class="btn-primary phone-dialog__action" type="button" :disabled="saving" @click="editor.submitDraft">
            {{ saving ? "保存中..." : "保存手机配置" }}
          </button>
        </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./styles/StoryPhoneDialog.css"></style>
