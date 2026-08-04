<script setup lang="ts">
import { toRefs } from "vue"
import StoryScriptTextarea from "./StoryScriptTextarea.vue"
import type { StoryDocument, StoryValsFile } from "@story-mgr/core"
import type { StoryPhoneEditorController } from "./useStoryPhoneEditor"

const props = defineProps<{
  editor: StoryPhoneEditorController
  story: StoryDocument
  vals: StoryValsFile
}>()

const {
  activeTab, draft, filteredContactProfiles, filteredFallbackReplies,
  filteredQuickMessages, quickMessageIdOptions, roleKeyOptions, sectionSearch
} = toRefs(props.editor)
const {
  addContactProfile, addContactProfileFromRole, addContactReply,
  addFallbackReply, addProactiveMessage, addQuickMessage, getRoleLabel,
  removeContactProfile, removeContactReply, removeFallbackReply,
  removeProactiveMessage, removeQuickMessage
} = props.editor
</script>
<template>
        <div v-if="activeTab === 'contacts'" class="phone-dialog__section">
          <div class="phone-dialog__section-head">
            <div>
              <h3 class="phone-dialog__section-title">联系人特配</h3>
              <p class="phone-dialog__section-note">维护每个具体 NPC 的主动消息、按标签回复、偏好标签和初始好感。</p>
            </div>
            <div class="phone-dialog__section-tools">
              <input
                v-model="sectionSearch.contacts"
                class="text-input phone-dialog__search"
                type="text"
                placeholder="搜索角色 / 消息 / 标签回复"
              />
              <span class="phone-dialog__result-count">
                {{ filteredContactProfiles.length }} / {{ draft.contactProfiles.length }}
              </span>
              <button class="btn-secondary phone-dialog__action" type="button" @click="addContactProfile()">
                新增联系人特配
              </button>
            </div>
          </div>

          <details v-if="roleKeyOptions.length" class="phone-dialog__helper-block">
            <summary class="phone-dialog__helper-summary">从角色快速新增联系人特配</summary>
            <div class="phone-dialog__chip-list">
              <button
                v-for="option in roleKeyOptions"
                :key="option.value"
                class="phone-dialog__chip"
                type="button"
                @click="addContactProfileFromRole(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </details>

          <div v-if="filteredContactProfiles.length" class="phone-dialog__stack">
            <article
              v-for="{ profile, index } in filteredContactProfiles"
              :key="profile.draftKey"
              class="phone-dialog__card"
            >
              <div class="phone-dialog__card-head">
                <div class="phone-dialog__card-title-wrap">
                  <strong class="phone-dialog__card-title">{{ getRoleLabel(profile.roleKey) || `contact_${index + 1}` }}</strong>
                  <span class="phone-dialog__card-note">
                    主动消息 {{ profile.proactiveMessages.length }} 条 · 标签回复 {{ profile.replyByTag.length }} 组
                  </span>
                </div>
                <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeContactProfile(index)">
                  删除特配
                </button>
              </div>

              <div class="phone-dialog__grid">
                <label class="phone-dialog__field phone-dialog__field--wide">
                  <span class="phone-dialog__label">联系人角色</span>
                  <select v-model="profile.roleKey" class="text-input phone-dialog__select">
                    <option value="">请选择角色</option>
                    <option v-for="option in roleKeyOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">初始好感</span>
                  <input v-model="profile.initialFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">偏好标签</span>
                  <input v-model="profile.preferredTagsText" class="text-input" type="text" placeholder="daily, work, care" />
                </label>
                <label class="phone-dialog__inline-check">
                  <input v-model="profile.enabled" type="checkbox" />
                  <span>启用联系人配置</span>
                </label>
                <label class="phone-dialog__inline-check">
                  <input v-model="profile.autoAdd" type="checkbox" />
                  <span>交互后自动加入联系人</span>
                </label>
              </div>

              <div class="phone-dialog__section-head phone-dialog__section-head--nested">
                <div>
                  <h4 class="phone-dialog__section-title phone-dialog__section-title--small">主动消息</h4>
                  <p class="phone-dialog__section-note">满足条件后 NPC 主动发来的消息，可推荐玩家快捷回复。</p>
                </div>
                <button class="btn-secondary phone-dialog__action" type="button" @click="addProactiveMessage(profile)">
                  新增主动消息
                </button>
              </div>

              <div v-if="profile.proactiveMessages.length" class="phone-dialog__stack phone-dialog__stack--compact">
                <article
                  v-for="(rule, ruleIndex) in profile.proactiveMessages"
                  :key="rule.draftKey"
                  class="phone-dialog__nested-card"
                >
                  <div class="phone-dialog__card-head">
                    <div class="phone-dialog__card-title-wrap">
                      <strong class="phone-dialog__card-title">{{ rule.id || `proactive_${ruleIndex + 1}` }}</strong>
                      <span class="phone-dialog__card-note">主动消息规则</span>
                    </div>
                    <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeProactiveMessage(profile, ruleIndex)">
                      删除
                    </button>
                  </div>

                  <div class="phone-dialog__grid">
                    <label class="phone-dialog__field">
                      <span class="phone-dialog__label">ID</span>
                      <input v-model="rule.id" class="text-input" type="text" placeholder="daytime_checkin" />
                    </label>
                    <label class="phone-dialog__field">
                      <span class="phone-dialog__label">冷却小时</span>
                      <input v-model="rule.cooldownHoursText" class="text-input" type="number" min="1" step="1" />
                    </label>
                    <label class="phone-dialog__field">
                      <span class="phone-dialog__label">好感变化</span>
                      <input v-model="rule.favorDeltaText" class="text-input" type="number" min="-100" max="100" step="1" />
                    </label>
                    <label class="phone-dialog__inline-check">
                      <input v-model="rule.enabled" type="checkbox" />
                      <span>启用</span>
                    </label>
                    <label class="phone-dialog__field phone-dialog__field--wide">
                      <span class="phone-dialog__label">触发条件</span>
                      <textarea
                        v-model="rule.triggerExpr"
                        class="text-input phone-dialog__textarea"
                        rows="2"
                        placeholder="${system.now_hour} >= 8"
                      />
                    </label>
                    <label class="phone-dialog__field phone-dialog__field--wide">
                      <span class="phone-dialog__label">消息列表</span>
                      <StoryScriptTextarea
                        v-model="rule.messagesText"
                        class="phone-dialog__script-textarea"
                        min-height="104px"
                        mode="template"
                        placeholder="一行一条 NPC 主动消息"
                        :story="props.story"
                        :vals="props.vals"
                      />
                    </label>
                  </div>

                  <div class="phone-dialog__subsection">
                    <span class="phone-dialog__label">推荐玩家快捷回复</span>
                    <div v-if="quickMessageIdOptions.length" class="phone-dialog__scope-checks">
                      <label
                        v-for="option in quickMessageIdOptions"
                        :key="option.value"
                        class="phone-dialog__chip-check"
                        :class="{ 'phone-dialog__chip-check--active': rule.replyQuickMessageIds.includes(option.value) }"
                      >
                        <input v-model="rule.replyQuickMessageIds" type="checkbox" :value="option.value" />
                        <span>{{ option.label }}</span>
                      </label>
                    </div>
                    <span v-else class="phone-dialog__hint">还没有玩家快捷消息，可以先到“玩家快捷消息”里新增。</span>
                  </div>
                </article>
              </div>
              <div v-else class="phone-dialog__empty phone-dialog__empty--compact">
                这个联系人还没有主动消息。
              </div>

              <div class="phone-dialog__section-head phone-dialog__section-head--nested">
                <div>
                  <h4 class="phone-dialog__section-title phone-dialog__section-title--small">按标签回复</h4>
                  <p class="phone-dialog__section-note">当玩家短句或动作带有对应 tag 时，优先使用这里的定制回复。</p>
                </div>
                <button class="btn-secondary phone-dialog__action" type="button" @click="addContactReply(profile)">
                  新增标签回复
                </button>
              </div>

              <div class="phone-dialog__table-wrap">
                <table class="phone-dialog__table phone-dialog__table--compact">
                  <thead>
                    <tr>
                      <th>标签</th>
                      <th>回复列表</th>
                      <th class="phone-dialog__actions-col">操作</th>
                    </tr>
                  </thead>
                  <tbody v-if="profile.replyByTag.length">
                    <tr v-for="(entry, replyIndex) in profile.replyByTag" :key="entry.draftKey">
                      <td>
                        <input v-model="entry.tag" class="text-input phone-dialog__cell-input" type="text" placeholder="pressure" />
                      </td>
                      <td>
                        <StoryScriptTextarea
                          v-model="entry.repliesText"
                          class="phone-dialog__script-textarea phone-dialog__script-textarea--cell"
                          min-height="90px"
                          mode="template"
                          placeholder="一行一条回复"
                          :story="props.story"
                          :vals="props.vals"
                        />
                      </td>
                      <td class="phone-dialog__actions-col">
                        <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeContactReply(profile, replyIndex)">
                          删除
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div v-if="!profile.replyByTag.length" class="phone-dialog__empty">
                  还没有标签回复。
                </div>
              </div>
            </article>
          </div>

          <div v-else class="phone-dialog__empty">
            {{ draft.contactProfiles.length ? "当前搜索没有命中联系人特配。" : "还没有联系人特配，先新增一条。" }}
          </div>
        </div>

        <div v-else-if="activeTab === 'quickMessages'" class="phone-dialog__section">
          <div class="phone-dialog__section-head">
            <div>
              <h3 class="phone-dialog__section-title">玩家快捷消息</h3>
              <p class="phone-dialog__section-note">联系人主动发消息后，可通过推荐 ID 展示这些预制回复；普通闲聊请维护“闲聊短句库”。</p>
            </div>
            <div class="phone-dialog__section-tools">
              <input
                v-model="sectionSearch.quickMessages"
                class="text-input phone-dialog__search"
                type="text"
                placeholder="搜索 ID / 文本 / 标签 / 角色"
              />
              <span class="phone-dialog__result-count">
                {{ filteredQuickMessages.length }} / {{ draft.quickMessages.length }}
              </span>
              <button class="btn-secondary phone-dialog__action" type="button" @click="addQuickMessage">
                新增快捷消息
              </button>
            </div>
          </div>

          <div class="phone-dialog__table-wrap">
            <table class="phone-dialog__table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>文本</th>
                  <th>标签</th>
                  <th>好感</th>
                  <th>冷却</th>
                  <th>推荐方式</th>
                  <th>可用角色</th>
                  <th class="phone-dialog__actions-col">操作</th>
                </tr>
              </thead>
              <tbody v-if="filteredQuickMessages.length">
                <tr v-for="{ message, index } in filteredQuickMessages" :key="message.draftKey">
                  <td>
                    <input v-model="message.id" class="text-input phone-dialog__cell-input" type="text" placeholder="talk_reply_ok" />
                  </td>
                  <td>
                    <textarea
                      v-model="message.text"
                      class="text-input phone-dialog__textarea phone-dialog__textarea--cell"
                      rows="2"
                      placeholder="好的，我知道了。"
                    />
                  </td>
                  <td>
                    <textarea
                      v-model="message.tagsText"
                      class="text-input phone-dialog__textarea phone-dialog__textarea--cell"
                      rows="2"
                      placeholder="daily, work"
                    />
                  </td>
                  <td>
                    <input v-model="message.baseFavorDeltaText" class="text-input phone-dialog__mini-input" type="number" min="0" max="100" step="1" />
                  </td>
                  <td>
                    <input v-model="message.cooldownHoursText" class="text-input phone-dialog__mini-input" type="number" min="0" step="1" />
                  </td>
                  <td>
                    <select v-model="message.visibility" class="text-input phone-dialog__select">
                      <option value="suggested-only">仅被推荐</option>
                      <option value="always">兼容旧值</option>
                    </select>
                  </td>
                  <td>
                    <textarea
                      v-model="message.availableRoleKeysText"
                      class="text-input phone-dialog__textarea phone-dialog__textarea--cell"
                      rows="2"
                      placeholder="important:zhuli, normal:start_suanming"
                    />
                  </td>
                  <td class="phone-dialog__actions-col">
                    <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeQuickMessage(index)">
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="!filteredQuickMessages.length" class="phone-dialog__empty">
              {{ draft.quickMessages.length ? "当前搜索没有命中快捷消息。" : "还没有玩家快捷消息，先加一条。" }}
            </div>
          </div>
        </div>

        <div v-else class="phone-dialog__section">
          <div class="phone-dialog__section-head">
            <div>
              <h3 class="phone-dialog__section-title">兜底回复</h3>
              <p class="phone-dialog__section-note">没有命中联系人特配或回复库时，按标签使用这里的兜底回复。</p>
            </div>
            <div class="phone-dialog__section-tools">
              <input
                v-model="sectionSearch.fallbackReplies"
                class="text-input phone-dialog__search"
                type="text"
                placeholder="搜索标签 / 回复"
              />
              <span class="phone-dialog__result-count">
                {{ filteredFallbackReplies.length }} / {{ draft.fallbackReplies.length }}
              </span>
              <button class="btn-secondary phone-dialog__action" type="button" @click="addFallbackReply">
                新增兜底回复
              </button>
            </div>
          </div>

          <div class="phone-dialog__table-wrap">
            <table class="phone-dialog__table phone-dialog__table--compact">
              <thead>
                <tr>
                  <th>标签</th>
                  <th>回复列表</th>
                  <th class="phone-dialog__actions-col">操作</th>
                </tr>
              </thead>
              <tbody v-if="filteredFallbackReplies.length">
                <tr v-for="{ entry, index } in filteredFallbackReplies" :key="entry.draftKey">
                  <td>
                    <input v-model="entry.tag" class="text-input phone-dialog__cell-input" type="text" placeholder="daily" />
                  </td>
                  <td>
                    <textarea
                      v-model="entry.repliesText"
                      class="text-input phone-dialog__textarea phone-dialog__textarea--cell"
                      rows="4"
                      placeholder="一行一条回复"
                    />
                  </td>
                  <td class="phone-dialog__actions-col">
                    <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeFallbackReply(index)">
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="!filteredFallbackReplies.length" class="phone-dialog__empty">
              {{ draft.fallbackReplies.length ? "当前搜索没有命中兜底回复。" : "还没有兜底回复，先加一组。" }}
            </div>
          </div>
        </div>
</template>

<style scoped src="./styles/StoryPhoneDialog.css"></style>
