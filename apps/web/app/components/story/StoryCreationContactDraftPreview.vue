<script setup lang="ts">
/** 联系人资料和剧情对话预览；只维护草稿选择，不直接保存文件。 */
import type { StoryCreationWorkspaceController } from "./useStoryCreationWorkspace"
import type { ComputedRef } from "vue"

const { controller } = defineProps<{ controller: StoryCreationWorkspaceController }>()
const {
  draftPreview: nullableDraftPreview, getContactProfileSummary, getImpactClass, getContactActionImpact,
  getContactChannelImpact,
  getContactProfileImpact, getContactConversationImpact, getContactCostItemsText,
  getContactPersonalityImpact, getContactRepliesText, getContactReplyImpact,
  getContactScopeText, getContactTalkImpact, getStringListText,
  handleContactActionSelectionChange, handleContactProfileSelectionChange,
  handleContactChannelSelectionChange,
  handleContactConversationSelectionChange, handleContactPersonalitySelectionChange,
  handleContactReplySelectionChange, handleContactTalkSelectionChange,
  contactConversationDraftCount, contactDraftCount, selectedContactActionIds,
  selectedContactChannelIds,
  selectedContactProfileKeys, selectedContactConversationIds,
  selectedContactPersonalityIds, selectedContactReplyIds, selectedContactTalkIds,
  setContactActionTags, setContactPreferredTags, setContactPersonalityTags,
  setContactRepliesText, setContactReplyTags, setContactTalkTags
} = controller
const draftPreview = nullableDraftPreview as ComputedRef<
  NonNullable<typeof nullableDraftPreview.value>
>
</script>

<template>
            <section class="creation-result__section">
              <h4 class="creation-result__section-title">联系人资产</h4>

              <template v-if="draftPreview.contact && contactDraftCount > 0">
                <div v-if="draftPreview.contact.channels.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">联系媒介</strong>
                  <ul class="creation-chip-list">
                    <li v-for="channel in draftPreview.contact.channels" :key="channel.id" class="creation-chip-list__item">
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedContactChannelIds.includes(channel.id)"
                          @change="handleContactChannelSelectionChange(channel.id, $event)"
                        >
                      </label>
                      <strong>{{ channel.id }} · {{ channel.name }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getContactChannelImpact(channel))"
                        :title="getContactChannelImpact(channel).detail"
                      >
                        {{ getContactChannelImpact(channel).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>名称</span>
                        <input v-model="channel.name" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>展示预设</span>
                        <select v-model="channel.preset" class="creation-edit-input">
                          <option value="generic">通用时间线</option>
                          <option value="phone">手机气泡</option>
                          <option value="letter">书信卡片</option>
                          <option value="transmission">传讯记录</option>
                        </select>
                      </label>
                    </li>
                  </ul>
                </div>
                <div v-if="draftPreview.contact.personality_library.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">性格库</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="personality in draftPreview.contact.personality_library"
                      :key="personality.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedContactPersonalityIds.includes(personality.id)"
                          @change="handleContactPersonalitySelectionChange(personality.id, $event)"
                        >
                      </label>
                      <strong>{{ personality.id }} · {{ personality.name }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getContactPersonalityImpact(personality))"
                        :title="getContactPersonalityImpact(personality).detail"
                      >
                        {{ getContactPersonalityImpact(personality).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>名称</span>
                        <input v-model="personality.name" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>风格标签</span>
                        <input
                          class="creation-edit-input"
                          :value="getStringListText(personality.style_tags)"
                          @input="setContactPersonalityTags(personality, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <label class="creation-edit-field">
                        <span>说明</span>
                        <textarea v-model="personality.descr" class="creation-edit-textarea" rows="2" />
                      </label>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.contact.talk_library.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">闲聊短句</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="entry in draftPreview.contact.talk_library"
                      :key="entry.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedContactTalkIds.includes(entry.id)"
                          @change="handleContactTalkSelectionChange(entry.id, $event)"
                        >
                      </label>
                      <strong>{{ entry.id }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getContactTalkImpact(entry))"
                        :title="getContactTalkImpact(entry).detail"
                      >
                        {{ getContactTalkImpact(entry).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>短句</span>
                        <input v-model="entry.text" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>标签</span>
                        <input
                          class="creation-edit-input"
                          :value="getStringListText(entry.tags)"
                          @input="setContactTalkTags(entry, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <small class="creation-result__muted">
                        {{ getContactScopeText(entry.scope) }} / 好感 {{ entry.base_favor_delta >= 0 ? "+" : "" }}{{ entry.base_favor_delta }} / 冷却 {{ entry.cooldown_hours }}h
                      </small>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.contact.action_library.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">联系人动作</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="entry in draftPreview.contact.action_library"
                      :key="entry.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedContactActionIds.includes(entry.id)"
                          @change="handleContactActionSelectionChange(entry.id, $event)"
                        >
                      </label>
                      <strong>{{ entry.id }} · {{ entry.label }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getContactActionImpact(entry))"
                        :title="getContactActionImpact(entry).detail"
                      >
                        {{ getContactActionImpact(entry).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>动作消息</span>
                        <input v-model="entry.text" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>标签</span>
                        <input
                          class="creation-edit-input"
                          :value="getStringListText(entry.tags)"
                          @input="setContactActionTags(entry, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <small class="creation-result__muted">
                        {{ getContactScopeText(entry.scope) }} / 金钱 {{ entry.cost_money }} / {{ getContactCostItemsText(entry) || "无物品消耗" }}
                      </small>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.contact.reply_library.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">NPC 回复</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="entry in draftPreview.contact.reply_library"
                      :key="entry.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedContactReplyIds.includes(entry.id)"
                          @change="handleContactReplySelectionChange(entry.id, $event)"
                        >
                      </label>
                      <strong>{{ entry.id }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getContactReplyImpact(entry))"
                        :title="getContactReplyImpact(entry).detail"
                      >
                        {{ getContactReplyImpact(entry).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>匹配标签</span>
                        <input
                          class="creation-edit-input"
                          :value="getStringListText(entry.tags)"
                          @input="setContactReplyTags(entry, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <label class="creation-edit-field">
                        <span>回复文本（用 / 分隔）</span>
                        <textarea
                          class="creation-edit-textarea"
                          rows="2"
                          :value="getContactRepliesText(entry)"
                          @input="setContactRepliesText(entry, ($event.target as HTMLTextAreaElement).value)"
                        />
                      </label>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.contact.contact_profiles.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">联系人特配</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="profile in draftPreview.contact.contact_profiles"
                      :key="profile.role_key"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedContactProfileKeys.includes(profile.role_key)"
                          @change="handleContactProfileSelectionChange(profile.role_key, $event)"
                        >
                      </label>
                      <strong>{{ profile.role_key }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getContactProfileImpact(profile))"
                        :title="getContactProfileImpact(profile).detail"
                      >
                        {{ getContactProfileImpact(profile).label }}
                      </span>
                      <div class="creation-item-flags">
                        <label class="creation-item-flags__check">
                          <input v-model="profile.enabled" type="checkbox">
                          启用
                        </label>
                        <label class="creation-item-flags__check">
                          <input v-model="profile.auto_add" type="checkbox">
                          自动加入
                        </label>
                      </div>
                      <label class="creation-edit-field">
                        <span>联系媒介 ID</span>
                        <input v-model="profile.channel_id" class="creation-edit-input" placeholder="留空继承默认媒介">
                      </label>
                      <label class="creation-edit-field">
                        <span>初始好感</span>
                        <input v-model.number="profile.initial_favor" class="creation-edit-input" min="0" max="100" type="number">
                      </label>
                      <label class="creation-edit-field">
                        <span>偏好标签</span>
                        <input
                          class="creation-edit-input"
                          :value="getStringListText(profile.preferred_tags)"
                          @input="setContactPreferredTags(profile, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <small class="creation-result__muted">{{ getContactProfileSummary(profile) }}</small>
                    </li>
                  </ul>
                </div>
              </template>

              <p v-else class="creation-result__muted">未生成联系人资产。</p>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">联系人剧情</h4>

              <template v-if="draftPreview.contactConversations && contactConversationDraftCount > 0">
                <ul class="creation-chip-list">
                  <li
                    v-for="conversation in draftPreview.contactConversations.conversations"
                    :key="conversation.id"
                    class="creation-chip-list__item"
                  >
                    <label class="creation-select">
                      <input
                        type="checkbox"
                        :checked="selectedContactConversationIds.includes(conversation.id)"
                        @change="handleContactConversationSelectionChange(conversation.id, $event)"
                      >
                    </label>
                    <strong>{{ conversation.id }} · {{ conversation.title }}</strong>
                    <span
                      class="creation-impact"
                      :class="getImpactClass(getContactConversationImpact(conversation))"
                      :title="getContactConversationImpact(conversation).detail"
                    >
                      {{ getContactConversationImpact(conversation).label }}
                    </span>
                    <div class="creation-item-flags">
                      <label class="creation-item-flags__check">
                        <input v-model="conversation.enabled" type="checkbox">
                        启用
                      </label>
                      <label class="creation-item-flags__check">
                        <input v-model="conversation.once" type="checkbox">
                        一次性
                      </label>
                      <label class="creation-item-flags__check">
                        <input v-model="conversation.lock_normal_chat" type="checkbox">
                        锁定闲聊
                      </label>
                    </div>
                    <div class="creation-event-edit-grid">
                      <label class="creation-edit-field">
                        <span>标题</span>
                        <input v-model="conversation.title" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>联系人角色</span>
                        <input v-model="conversation.role_key" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>入口节点</span>
                        <input v-model="conversation.entry_node_id" class="creation-edit-input">
                      </label>
                      <label class="creation-edit-field">
                        <span>自动触发条件</span>
                        <input v-model="conversation.trigger_expr" class="creation-edit-input">
                      </label>
                    </div>
                    <small class="creation-result__muted">
                      {{ conversation.nodes.length }} 个节点 / {{ conversation.nodes.reduce((sum, node) => sum + node.player_options.length, 0) }} 个回复选项
                    </small>
                  </li>
                </ul>
              </template>

              <p v-else class="creation-result__muted">未生成联系人剧情。</p>
            </section>
</template>
<style scoped src="./styles/StoryCreationWorkspace.part1.css"></style>
<style scoped src="./styles/StoryCreationWorkspace.part2.css"></style>
