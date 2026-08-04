<script setup lang="ts">
/** 手机资料和剧情手机对话预览；只维护草稿选择，不直接保存文件。 */
import type { StoryCreationWorkspaceController } from "./useStoryCreationWorkspace"
import type { ComputedRef } from "vue"

const { controller } = defineProps<{ controller: StoryCreationWorkspaceController }>()
const {
  draftPreview: nullableDraftPreview, getContactProfileSummary, getImpactClass, getPhoneActionImpact,
  getPhoneContactProfileImpact, getPhoneConversationImpact, getPhoneCostItemsText,
  getPhonePersonalityImpact, getPhoneRepliesText, getPhoneReplyImpact,
  getPhoneScopeText, getPhoneTalkImpact, getStringListText,
  handlePhoneActionSelectionChange, handlePhoneContactProfileSelectionChange,
  handlePhoneConversationSelectionChange, handlePhonePersonalitySelectionChange,
  handlePhoneReplySelectionChange, handlePhoneTalkSelectionChange,
  phoneConversationDraftCount, phoneDraftCount, selectedPhoneActionIds,
  selectedPhoneContactProfileKeys, selectedPhoneConversationIds,
  selectedPhonePersonalityIds, selectedPhoneReplyIds, selectedPhoneTalkIds,
  setPhoneActionTags, setPhoneContactPreferredTags, setPhonePersonalityTags,
  setPhoneRepliesText, setPhoneReplyTags, setPhoneTalkTags
} = controller
const draftPreview = nullableDraftPreview as ComputedRef<
  NonNullable<typeof nullableDraftPreview.value>
>
</script>

<template>
            <section class="creation-result__section">
              <h4 class="creation-result__section-title">手机联系人资产</h4>

              <template v-if="draftPreview.phone && phoneDraftCount > 0">
                <div v-if="draftPreview.phone.personality_library.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">性格库</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="personality in draftPreview.phone.personality_library"
                      :key="personality.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedPhonePersonalityIds.includes(personality.id)"
                          @change="handlePhonePersonalitySelectionChange(personality.id, $event)"
                        >
                      </label>
                      <strong>{{ personality.id }} · {{ personality.name }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getPhonePersonalityImpact(personality))"
                        :title="getPhonePersonalityImpact(personality).detail"
                      >
                        {{ getPhonePersonalityImpact(personality).label }}
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
                          @input="setPhonePersonalityTags(personality, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <label class="creation-edit-field">
                        <span>说明</span>
                        <textarea v-model="personality.descr" class="creation-edit-textarea" rows="2" />
                      </label>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.phone.talk_library.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">闲聊短句</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="entry in draftPreview.phone.talk_library"
                      :key="entry.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedPhoneTalkIds.includes(entry.id)"
                          @change="handlePhoneTalkSelectionChange(entry.id, $event)"
                        >
                      </label>
                      <strong>{{ entry.id }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getPhoneTalkImpact(entry))"
                        :title="getPhoneTalkImpact(entry).detail"
                      >
                        {{ getPhoneTalkImpact(entry).label }}
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
                          @input="setPhoneTalkTags(entry, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <small class="creation-result__muted">
                        {{ getPhoneScopeText(entry.scope) }} / 好感 {{ entry.base_favor_delta >= 0 ? "+" : "" }}{{ entry.base_favor_delta }} / 冷却 {{ entry.cooldown_hours }}h
                      </small>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.phone.action_library.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">联系人动作</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="entry in draftPreview.phone.action_library"
                      :key="entry.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedPhoneActionIds.includes(entry.id)"
                          @change="handlePhoneActionSelectionChange(entry.id, $event)"
                        >
                      </label>
                      <strong>{{ entry.id }} · {{ entry.label }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getPhoneActionImpact(entry))"
                        :title="getPhoneActionImpact(entry).detail"
                      >
                        {{ getPhoneActionImpact(entry).label }}
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
                          @input="setPhoneActionTags(entry, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <small class="creation-result__muted">
                        {{ getPhoneScopeText(entry.scope) }} / 金钱 {{ entry.cost_money }} / {{ getPhoneCostItemsText(entry) || "无物品消耗" }}
                      </small>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.phone.reply_library.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">NPC 回复</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="entry in draftPreview.phone.reply_library"
                      :key="entry.id"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedPhoneReplyIds.includes(entry.id)"
                          @change="handlePhoneReplySelectionChange(entry.id, $event)"
                        >
                      </label>
                      <strong>{{ entry.id }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getPhoneReplyImpact(entry))"
                        :title="getPhoneReplyImpact(entry).detail"
                      >
                        {{ getPhoneReplyImpact(entry).label }}
                      </span>
                      <label class="creation-edit-field">
                        <span>匹配标签</span>
                        <input
                          class="creation-edit-input"
                          :value="getStringListText(entry.tags)"
                          @input="setPhoneReplyTags(entry, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <label class="creation-edit-field">
                        <span>回复文本（用 / 分隔）</span>
                        <textarea
                          class="creation-edit-textarea"
                          rows="2"
                          :value="getPhoneRepliesText(entry)"
                          @input="setPhoneRepliesText(entry, ($event.target as HTMLTextAreaElement).value)"
                        />
                      </label>
                    </li>
                  </ul>
                </div>

                <div v-if="draftPreview.phone.contact_profiles.length" class="creation-draft-subgroup">
                  <strong class="creation-draft-subgroup__title">联系人特配</strong>
                  <ul class="creation-chip-list">
                    <li
                      v-for="profile in draftPreview.phone.contact_profiles"
                      :key="profile.role_key"
                      class="creation-chip-list__item"
                    >
                      <label class="creation-select">
                        <input
                          type="checkbox"
                          :checked="selectedPhoneContactProfileKeys.includes(profile.role_key)"
                          @change="handlePhoneContactProfileSelectionChange(profile.role_key, $event)"
                        >
                      </label>
                      <strong>{{ profile.role_key }}</strong>
                      <span
                        class="creation-impact"
                        :class="getImpactClass(getPhoneContactProfileImpact(profile))"
                        :title="getPhoneContactProfileImpact(profile).detail"
                      >
                        {{ getPhoneContactProfileImpact(profile).label }}
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
                        <span>初始好感</span>
                        <input v-model.number="profile.initial_favor" class="creation-edit-input" min="0" max="100" type="number">
                      </label>
                      <label class="creation-edit-field">
                        <span>偏好标签</span>
                        <input
                          class="creation-edit-input"
                          :value="getStringListText(profile.preferred_tags)"
                          @input="setPhoneContactPreferredTags(profile, ($event.target as HTMLInputElement).value)"
                        >
                      </label>
                      <small class="creation-result__muted">{{ getContactProfileSummary(profile) }}</small>
                    </li>
                  </ul>
                </div>
              </template>

              <p v-else class="creation-result__muted">未生成手机联系人资产。</p>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">剧情手机对话</h4>

              <template v-if="draftPreview.phoneConversations && phoneConversationDraftCount > 0">
                <ul class="creation-chip-list">
                  <li
                    v-for="conversation in draftPreview.phoneConversations.conversations"
                    :key="conversation.id"
                    class="creation-chip-list__item"
                  >
                    <label class="creation-select">
                      <input
                        type="checkbox"
                        :checked="selectedPhoneConversationIds.includes(conversation.id)"
                        @change="handlePhoneConversationSelectionChange(conversation.id, $event)"
                      >
                    </label>
                    <strong>{{ conversation.id }} · {{ conversation.title }}</strong>
                    <span
                      class="creation-impact"
                      :class="getImpactClass(getPhoneConversationImpact(conversation))"
                      :title="getPhoneConversationImpact(conversation).detail"
                    >
                      {{ getPhoneConversationImpact(conversation).label }}
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

              <p v-else class="creation-result__muted">未生成剧情手机对话。</p>
            </section>
</template>
<style scoped src="./styles/StoryCreationWorkspace.part1.css"></style>
<style scoped src="./styles/StoryCreationWorkspace.part2.css"></style>
