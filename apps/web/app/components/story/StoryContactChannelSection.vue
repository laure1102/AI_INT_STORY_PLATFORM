<script setup lang="ts">
import { toRefs } from "vue"
import type { StoryContactEditorController } from "./useStoryContactEditor"
import type { ContactChannelDraft } from "./useStoryContactDraft"

const props = defineProps<{
  editor: StoryContactEditorController
}>()

const { draft } = toRefs(props.editor)
const { addChannel, removeChannel, renameChannel } = props.editor

const presetOptions = [
  { label: "通用时间线", value: "generic" },
  { label: "手机气泡", value: "phone" },
  { label: "书信卡片", value: "letter" },
  { label: "传讯记录", value: "transmission" }
] as const

const labelFields = [
  { key: "message", label: "消息" },
  { key: "conversation", label: "会话" },
  { key: "talk", label: "闲聊" },
  { key: "action", label: "动作" },
  { key: "gift", label: "赠礼" },
  { key: "send", label: "发送" },
  { key: "reply", label: "回复" }
] as const

/** 在媒介 id 输入时同步默认媒介和联系人覆盖引用。 */
function handleChannelIdInput(channel: ContactChannelDraft, event: Event) {
  renameChannel(channel, (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="contact-dialog__section">
    <div class="contact-dialog__section-head">
      <div>
        <h3 class="contact-dialog__section-title">联系媒介</h3>
      </div>
      <button class="btn-secondary contact-dialog__action" type="button" @click="addChannel">
        新增媒介
      </button>
    </div>

    <label class="contact-dialog__field contact-dialog__field--wide">
      <span class="contact-dialog__label">故事默认媒介</span>
      <select v-model="draft.defaultChannelId" class="text-input contact-dialog__select">
        <option v-for="channel in draft.channels" :key="channel.draftKey" :value="channel.id">
          {{ channel.name || channel.id }} · {{ channel.id }}
        </option>
      </select>
    </label>

    <div v-if="draft.channels.length" class="contact-dialog__stack">
      <article v-for="(channel, index) in draft.channels" :key="channel.draftKey" class="contact-dialog__card">
        <div class="contact-dialog__card-head">
          <strong class="contact-dialog__card-title">{{ channel.name || channel.id || `媒介 ${index + 1}` }}</strong>
          <button
            class="btn-secondary contact-dialog__card-remove"
            type="button"
            :disabled="channel.id === draft.defaultChannelId"
            @click="removeChannel(index)"
          >
            删除
          </button>
        </div>

        <div class="contact-dialog__grid">
          <label class="contact-dialog__field">
            <span class="contact-dialog__label">ID</span>
            <input
              :value="channel.id"
              class="text-input"
              type="text"
              placeholder="letter"
              @input="handleChannelIdInput(channel, $event)"
            />
          </label>
          <label class="contact-dialog__field">
            <span class="contact-dialog__label">名称</span>
            <input v-model="channel.name" class="text-input" type="text" placeholder="书信" />
          </label>
          <label class="contact-dialog__field">
            <span class="contact-dialog__label">展示预设</span>
            <select v-model="channel.preset" class="text-input contact-dialog__select">
              <option v-for="option in presetOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>

        <div class="contact-dialog__subsection">
          <span class="contact-dialog__label">自定义文案</span>
          <div class="contact-dialog__grid">
            <label v-for="field in labelFields" :key="field.key" class="contact-dialog__field">
              <span class="contact-dialog__label">{{ field.label }}</span>
              <input
                v-model="channel.labels[field.key]"
                class="text-input"
                type="text"
                :placeholder="`使用${presetOptions.find((option) => option.value === channel.preset)?.label ?? '预设'}默认值`"
              />
            </label>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
