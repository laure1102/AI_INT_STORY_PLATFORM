<script setup lang="ts">
import type { StoryContactFile } from "@story-mgr/core"
import StoryContactChannelSection from "./StoryContactChannelSection.vue"
import StoryContactLibrarySections from "./StoryContactLibrarySections.vue"
import StoryContactProfileSections from "./StoryContactProfileSections.vue"
import {
  useStoryContactEditor,
  type StoryContactEditorEmits,
  type StoryContactEditorProps
} from "./useStoryContactEditor"

const props = defineProps<StoryContactEditorProps>()
const emit = defineEmits<StoryContactEditorEmits>()
const editor = useStoryContactEditor(props, emit)
</script>

<template>
  <Teleport to="body">
    <div class="contact-dialog">
      <section class="contact-dialog__panel glass-panel">
        <div class="contact-dialog__header">
          <div class="contact-dialog__header-copy">
            <span class="eyebrow">联系人</span>
            <h2 class="contact-dialog__title">联系人配置</h2>
            <p class="contact-dialog__subtitle">
              配置联系媒介、关系规则、性格、短句、动作、回复和联系人特配。
            </p>
            <p v-if="saveSuccessMessage" class="contact-dialog__success">{{ saveSuccessMessage }}</p>
          </div>

          <div class="contact-dialog__header-actions">
            <button class="btn-secondary contact-dialog__action" type="button" @click="emit('close')">
              关闭
            </button>
            <button class="btn-primary contact-dialog__action" type="button" :disabled="saving" @click="editor.submitDraft">
              {{ saving ? "保存中..." : "保存联系人配置" }}
            </button>
          </div>
        </div>

        <div class="contact-dialog__body">
        <div class="contact-dialog__tabs">
          <button
            v-for="tab in editor.tabOptions"
            :key="tab.key"
            class="contact-dialog__tab"
            :class="{ 'contact-dialog__tab--active': editor.activeTab === tab.key }"
            type="button"
            @click="editor.activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <StoryContactChannelSection
          v-if="editor.activeTab === 'channels'"
          :editor="editor"
        />
        <StoryContactLibrarySections
          v-else-if="['tracks', 'personalities', 'talks', 'actions', 'replies'].includes(editor.activeTab)"
          :editor="editor"
          :item-ids="props.itemIds"
          :story="props.story"
          :vals="props.vals"
        />
        <StoryContactProfileSections
          v-else
          :editor="editor"
          :story="props.story"
          :vals="props.vals"
        />

        <div class="contact-dialog__footer">
          <button class="btn-secondary contact-dialog__action" type="button" @click="emit('close')">
            关闭
          </button>
          <button class="btn-primary contact-dialog__action" type="button" :disabled="saving" @click="editor.submitDraft">
            {{ saving ? "保存中..." : "保存联系人配置" }}
          </button>
        </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./styles/StoryContactDialog.css"></style>
