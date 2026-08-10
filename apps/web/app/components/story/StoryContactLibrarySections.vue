<script setup lang="ts">
import { toRefs } from "vue"
import StoryScriptTextarea from "./StoryScriptTextarea.vue"
import type { StoryDocument, StoryValsFile } from "@story-mgr/core"
import type {
  InvokeTargetType,
  StoryContactEditorController
} from "./useStoryContactEditor"

const props = defineProps<{
  editor: StoryContactEditorController
  itemIds: string[]
  story: StoryDocument
  vals: StoryValsFile
}>()

const {
  activeTab, canAddTrack, contactTrackOptions, draft, filteredActions, filteredPersonalities,
  filteredReplies, filteredTalks, filteredTracks, personalityIdOptions,
  invokeTargetLabels, roleKeyOptions, sectionSearch
} = toRefs(props.editor)
const {
  addAction, addPersonality, addReply, addTalk, addTrack, addTrackStage,
  appendRoleKeyToScope, getInvokeOptions, removeAction, removePersonality, removeReply,
  removeTalk, removeTrack, removeTrackStage
} = props.editor
</script>
<template>
        <div v-if="activeTab === 'tracks'" class="contact-dialog__section">
          <div class="contact-dialog__section-head">
            <div>
              <h3 class="contact-dialog__section-title">关系轨道</h3>
              <p class="contact-dialog__section-note">定义不同联系人分类的好感阶段、锁定提示和动作解锁标签。</p>
            </div>
            <div class="contact-dialog__section-tools">
              <input
                v-model="sectionSearch.tracks"
                class="text-input contact-dialog__search"
                type="text"
                placeholder="搜索轨道 / 阶段 / 锁定提示"
              />
              <span class="contact-dialog__result-count">
                {{ filteredTracks.length }} / {{ draft.tracks.length }}
              </span>
              <button class="btn-secondary contact-dialog__action" type="button" :disabled="!canAddTrack" @click="addTrack">
                新增轨道
              </button>
            </div>
          </div>

          <div v-if="filteredTracks.length" class="contact-dialog__stack">
            <article
              v-for="{ track, index: trackIndex } in filteredTracks"
              :key="track.draftKey"
              class="contact-dialog__card"
            >
              <div class="contact-dialog__card-head">
                <div class="contact-dialog__card-title-wrap">
                  <strong class="contact-dialog__card-title">{{ track.id }}</strong>
                  <span class="contact-dialog__card-note">一条联系人关系主轨道</span>
                </div>
                <button class="btn-secondary contact-dialog__card-remove" type="button" @click="removeTrack(trackIndex)">
                  删除轨道
                </button>
              </div>

              <div class="contact-dialog__grid contact-dialog__grid--track">
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">轨道名称</span>
                  <input v-model="track.name" class="text-input" type="text" placeholder="恋爱关系" />
                </label>

                <label class="contact-dialog__field contact-dialog__field--wide">
                  <span class="contact-dialog__label">轨道说明</span>
                  <textarea
                    v-model="track.descr"
                    class="text-input contact-dialog__textarea"
                    rows="2"
                    placeholder="说明这条轨道代表什么关系。"
                  />
                </label>
              </div>

              <div class="contact-dialog__section-head contact-dialog__section-head--nested">
                <div>
                  <h4 class="contact-dialog__section-title contact-dialog__section-title--small">阶段列表</h4>
                  <p class="contact-dialog__section-note">阶段决定联系是否开放，以及会解锁哪些动作标签。</p>
                </div>
                <button class="btn-secondary contact-dialog__action" type="button" @click="addTrackStage(track)">
                  新增阶段
                </button>
              </div>

              <div class="contact-dialog__table-wrap">
                <table class="contact-dialog__table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>名称</th>
                      <th>好感范围</th>
                      <th>可联系</th>
                      <th>锁定提示</th>
                      <th>解锁动作标签</th>
                      <th>说明</th>
                      <th class="contact-dialog__actions-col">操作</th>
                    </tr>
                  </thead>
                  <tbody v-if="track.stages.length">
                    <tr v-for="(stage, stageIndex) in track.stages" :key="stage.draftKey">
                      <td>
                        <input v-model="stage.id" class="text-input contact-dialog__cell-input" type="text" placeholder="friend" />
                      </td>
                      <td>
                        <input v-model="stage.name" class="text-input contact-dialog__cell-input" type="text" placeholder="朋友" />
                      </td>
                      <td>
                        <div class="contact-dialog__range-inputs">
                          <input v-model="stage.minFavorText" class="text-input contact-dialog__mini-input" type="number" min="0" max="100" step="1" />
                          <span class="contact-dialog__range-sep">-</span>
                          <input v-model="stage.maxFavorText" class="text-input contact-dialog__mini-input" type="number" min="0" max="100" step="1" />
                        </div>
                      </td>
                      <td>
                        <label class="contact-dialog__inline-check">
                          <input v-model="stage.allowContact" type="checkbox" />
                          <span>{{ stage.allowContact ? "允许" : "锁定" }}</span>
                        </label>
                      </td>
                      <td>
                        <textarea
                          v-model="stage.lockMessage"
                          class="text-input contact-dialog__textarea contact-dialog__textarea--cell"
                          rows="2"
                          placeholder="她现在很讨厌我，肯定不会理我了。"
                        />
                      </td>
                      <td>
                        <textarea
                          v-model="stage.unlockActionTagsText"
                          class="text-input contact-dialog__textarea contact-dialog__textarea--cell"
                          rows="2"
                          placeholder="gift_basic, date"
                        />
                      </td>
                      <td>
                        <textarea
                          v-model="stage.descr"
                          class="text-input contact-dialog__textarea contact-dialog__textarea--cell"
                          rows="2"
                          placeholder="阶段说明"
                        />
                      </td>
                      <td class="contact-dialog__actions-col">
                        <button class="btn-secondary contact-dialog__card-remove" type="button" @click="removeTrackStage(track, stageIndex)">
                          删除
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div v-if="!track.stages.length" class="contact-dialog__empty">
                  这条轨道还没有阶段，先补一个阶段。
                </div>
              </div>
            </article>
          </div>

          <div v-else class="contact-dialog__empty">
            {{ draft.tracks.length ? "当前搜索没有命中关系轨道。" : "还没有关系轨道，先新增一条。" }}
          </div>
        </div>

        <div v-else-if="activeTab === 'personalities'" class="contact-dialog__section">
          <div class="contact-dialog__section-head">
            <div>
              <h3 class="contact-dialog__section-title">性格库</h3>
              <p class="contact-dialog__section-note">角色和联系人短句会复用这里的结构化性格标签。</p>
            </div>
            <div class="contact-dialog__section-tools">
              <input
                v-model="sectionSearch.personalities"
                class="text-input contact-dialog__search"
                type="text"
                placeholder="搜索性格 ID / 名称 / 风格标签"
              />
              <span class="contact-dialog__result-count">
                {{ filteredPersonalities.length }} / {{ draft.personalities.length }}
              </span>
              <button class="btn-secondary contact-dialog__action" type="button" @click="addPersonality">
                新增性格
              </button>
            </div>
          </div>

          <div class="contact-dialog__table-wrap">
            <table class="contact-dialog__table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>名称</th>
                  <th>风格标签</th>
                  <th>说明</th>
                  <th class="contact-dialog__actions-col">操作</th>
                </tr>
              </thead>
              <tbody v-if="filteredPersonalities.length">
                <tr
                  v-for="{ personality, index } in filteredPersonalities"
                  :key="personality.draftKey"
                >
                  <td>
                    <input v-model="personality.id" class="text-input contact-dialog__cell-input" type="text" placeholder="lively" />
                  </td>
                  <td>
                    <input v-model="personality.name" class="text-input contact-dialog__cell-input" type="text" placeholder="活泼开朗" />
                  </td>
                  <td>
                    <textarea
                      v-model="personality.styleTagsText"
                      class="text-input contact-dialog__textarea contact-dialog__textarea--cell"
                      rows="2"
                      placeholder="热情, 直接"
                    />
                  </td>
                  <td>
                    <textarea
                      v-model="personality.descr"
                      class="text-input contact-dialog__textarea contact-dialog__textarea--cell"
                      rows="2"
                      placeholder="说话外放，反馈很快。"
                    />
                  </td>
                  <td class="contact-dialog__actions-col">
                    <button class="btn-secondary contact-dialog__card-remove" type="button" @click="removePersonality(index)">
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="!filteredPersonalities.length" class="contact-dialog__empty">
              {{ draft.personalities.length ? "当前搜索没有命中性格定义。" : "还没有性格定义，先加一个。" }}
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'talks'" class="contact-dialog__section">
          <div class="contact-dialog__section-head">
            <div>
              <h3 class="contact-dialog__section-title">闲聊短句库</h3>
              <p class="contact-dialog__section-note">玩家主动发出的闲聊短句，支持作用域筛选和调用事件。</p>
            </div>
            <div class="contact-dialog__section-tools">
              <input
                v-model="sectionSearch.talks"
                class="text-input contact-dialog__search"
                type="text"
                placeholder="搜索 ID / 文本 / 标签 / 角色 / 性格"
              />
              <span class="contact-dialog__result-count">
                {{ filteredTalks.length }} / {{ draft.talks.length }}
              </span>
              <button class="btn-secondary contact-dialog__action" type="button" @click="addTalk">
                新增短句
              </button>
            </div>
          </div>

          <div v-if="filteredTalks.length" class="contact-dialog__stack">
            <article
              v-for="{ entry, index } in filteredTalks"
              :key="entry.draftKey"
              class="contact-dialog__card"
            >
              <div class="contact-dialog__card-head">
                <div class="contact-dialog__card-title-wrap">
                  <strong class="contact-dialog__card-title">{{ entry.id || `talk_${index + 1}` }}</strong>
                  <span class="contact-dialog__card-note">一条玩家主动发送的闲聊短句</span>
                </div>
                <button class="btn-secondary contact-dialog__card-remove" type="button" @click="removeTalk(index)">
                  删除
                </button>
              </div>

              <div class="contact-dialog__grid">
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">ID</span>
                  <input v-model="entry.id" class="text-input" type="text" placeholder="talk_greet_generic" />
                </label>
                <label class="contact-dialog__field contact-dialog__field--wide">
                  <span class="contact-dialog__label">短句内容</span>
                  <input v-model="entry.text" class="text-input" type="text" placeholder="在吗？" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">标签</span>
                  <input v-model="entry.tagsText" class="text-input" type="text" placeholder="daily, care" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">好感变化</span>
                  <input v-model="entry.baseFavorDeltaText" class="text-input" type="number" step="1" placeholder="1" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">冷却小时</span>
                  <input v-model="entry.cooldownHoursText" class="text-input" type="number" min="0" step="1" placeholder="6" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">角色范围</span>
                  <textarea
                    v-model="entry.scope.roleKeysText"
                    class="text-input contact-dialog__textarea"
                    rows="2"
                    placeholder="important:zhuli, normal:start_suanming"
                  />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">性格范围</span>
                  <div v-if="personalityIdOptions.length" class="contact-dialog__scope-checks contact-dialog__scope-checks--dense">
                    <label
                      v-for="option in personalityIdOptions"
                      :key="option.value"
                      class="contact-dialog__chip-check"
                      :class="{ 'contact-dialog__chip-check--active': entry.scope.personalityIds.includes(option.value) }"
                    >
                      <input v-model="entry.scope.personalityIds" type="checkbox" :value="option.value" />
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                  <span v-else class="contact-dialog__hint">还没有性格定义，当前视为不限性格。</span>
                  <span class="contact-dialog__hint">不选表示不限性格。</span>
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">最小好感</span>
                  <input v-model="entry.scope.minFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">最大好感</span>
                  <input v-model="entry.scope.maxFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
              </div>

              <div class="contact-dialog__subsection">
                <span class="contact-dialog__label">联系人分类</span>
                <div class="contact-dialog__scope-checks">
                  <label v-for="track in contactTrackOptions" :key="track.value" class="contact-dialog__inline-check">
                    <input v-model="entry.scope.contact_tracks" type="checkbox" :value="track.value" />
                    <span>{{ track.label }}</span>
                  </label>
                </div>
              </div>

              <details v-if="roleKeyOptions.length" class="contact-dialog__helper-block">
                <summary class="contact-dialog__helper-summary">作用域速填</summary>
                <div class="contact-dialog__helper-grid">
                  <div v-if="roleKeyOptions.length" class="contact-dialog__helper-group">
                    <span class="contact-dialog__helper-label">角色</span>
                    <div class="contact-dialog__chip-list">
                      <button
                        v-for="option in roleKeyOptions"
                        :key="option.value"
                        class="contact-dialog__chip"
                        type="button"
                        @click="appendRoleKeyToScope(entry.scope, option.value)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </details>

              <div class="contact-dialog__subsection">
                <label class="contact-dialog__inline-check">
                  <input v-model="entry.invoke.enabled" type="checkbox" />
                  <span>发送这条短句后调用事件</span>
                </label>

                <div v-if="entry.invoke.enabled" class="contact-dialog__grid contact-dialog__grid--invoke">
                  <label class="contact-dialog__field">
                    <span class="contact-dialog__label">目标类型</span>
                    <select v-model="entry.invoke.targetType" class="text-input contact-dialog__select">
                      <option v-for="track in Object.keys(invokeTargetLabels)" :key="track" :value="track">
                        {{ invokeTargetLabels[track as InvokeTargetType] }}
                      </option>
                    </select>
                  </label>
                  <label class="contact-dialog__field contact-dialog__field--wide">
                    <span class="contact-dialog__label">调用事件</span>
                    <select v-model="entry.invoke.eventId" class="text-input contact-dialog__select">
                      <option value="">请选择 invoke 事件</option>
                      <option v-for="option in getInvokeOptions(entry.invoke.targetType)" :key="`${option.targetType}:${option.eventId}`" :value="option.eventId">
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label class="contact-dialog__inline-check">
                    <input v-model="entry.invoke.delayEnabled" type="checkbox" />
                    <span>延迟调用</span>
                  </label>
                  <template v-if="entry.invoke.delayEnabled">
                    <label class="contact-dialog__field">
                      <span class="contact-dialog__label">延迟数值</span>
                      <input v-model="entry.invoke.delayValueText" class="text-input" type="number" min="1" step="1" />
                    </label>
                    <label class="contact-dialog__field">
                      <span class="contact-dialog__label">延迟单位</span>
                      <select v-model="entry.invoke.delayUnit" class="text-input contact-dialog__select">
                        <option value="hours">小时</option>
                        <option value="days">天</option>
                        <option value="months">月</option>
                        <option value="years">年</option>
                      </select>
                    </label>
                  </template>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="contact-dialog__empty">
            {{ draft.talks.length ? "当前搜索没有命中闲聊短句。" : "还没有闲聊短句，先加一条。" }}
          </div>
        </div>

        <div v-else-if="activeTab === 'actions'" class="contact-dialog__section">
          <div class="contact-dialog__section-head">
            <div>
              <h3 class="contact-dialog__section-title">动作库</h3>
              <p class="contact-dialog__section-note">发红包、送礼、约会等动作项，支持消耗和事件调用。</p>
            </div>
            <div class="contact-dialog__section-tools">
              <input
                v-model="sectionSearch.actions"
                class="text-input contact-dialog__search"
                type="text"
                placeholder="搜索 ID / 名称 / 标签 / 成本 / 角色"
              />
              <span class="contact-dialog__result-count">
                {{ filteredActions.length }} / {{ draft.actions.length }}
              </span>
              <button class="btn-secondary contact-dialog__action" type="button" @click="addAction">
                新增动作
              </button>
            </div>
          </div>

          <div v-if="filteredActions.length" class="contact-dialog__stack">
            <article
              v-for="{ entry, index } in filteredActions"
              :key="entry.draftKey"
              class="contact-dialog__card"
            >
              <div class="contact-dialog__card-head">
                <div class="contact-dialog__card-title-wrap">
                  <strong class="contact-dialog__card-title">{{ entry.id || `action_${index + 1}` }}</strong>
                  <span class="contact-dialog__card-note">一条玩家主动发起的联系人动作</span>
                </div>
                <button class="btn-secondary contact-dialog__card-remove" type="button" @click="removeAction(index)">
                  删除
                </button>
              </div>

              <div class="contact-dialog__grid">
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">ID</span>
                  <input v-model="entry.id" class="text-input" type="text" placeholder="action_send_red_packet_small" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">按钮名称</span>
                  <input v-model="entry.label" class="text-input" type="text" placeholder="发个红包" />
                </label>
                <label class="contact-dialog__field contact-dialog__field--wide">
                  <span class="contact-dialog__label">动作文本</span>
                  <input v-model="entry.text" class="text-input" type="text" placeholder="给你发个小红包。" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">标签</span>
                  <input v-model="entry.tagsText" class="text-input" type="text" placeholder="gift_basic, money" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">好感变化</span>
                  <input v-model="entry.baseFavorDeltaText" class="text-input" type="number" step="1" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">冷却小时</span>
                  <input v-model="entry.cooldownHoursText" class="text-input" type="number" min="0" step="1" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">金钱消耗</span>
                  <input v-model="entry.costMoneyText" class="text-input" type="number" min="0" step="100" />
                </label>
                <label class="contact-dialog__field contact-dialog__field--wide">
                  <span class="contact-dialog__label">物品消耗</span>
                  <textarea
                    v-model="entry.costItemsText"
                    class="text-input contact-dialog__textarea"
                    rows="2"
                    :placeholder="itemIds.length ? `item_id:quantity，例如\\n${itemIds[0]}:1` : 'item_id:quantity'"
                  />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">角色范围</span>
                  <textarea
                    v-model="entry.scope.roleKeysText"
                    class="text-input contact-dialog__textarea"
                    rows="2"
                    placeholder="important:chulian"
                  />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">性格范围</span>
                  <div v-if="personalityIdOptions.length" class="contact-dialog__scope-checks contact-dialog__scope-checks--dense">
                    <label
                      v-for="option in personalityIdOptions"
                      :key="option.value"
                      class="contact-dialog__chip-check"
                      :class="{ 'contact-dialog__chip-check--active': entry.scope.personalityIds.includes(option.value) }"
                    >
                      <input v-model="entry.scope.personalityIds" type="checkbox" :value="option.value" />
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                  <span v-else class="contact-dialog__hint">还没有性格定义，当前视为不限性格。</span>
                  <span class="contact-dialog__hint">不选表示不限性格。</span>
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">最小好感</span>
                  <input v-model="entry.scope.minFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">最大好感</span>
                  <input v-model="entry.scope.maxFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
              </div>

              <div class="contact-dialog__subsection">
                <span class="contact-dialog__label">联系人分类</span>
                <div class="contact-dialog__scope-checks">
                  <label v-for="track in contactTrackOptions" :key="track.value" class="contact-dialog__inline-check">
                    <input v-model="entry.scope.contact_tracks" type="checkbox" :value="track.value" />
                    <span>{{ track.label }}</span>
                  </label>
                </div>
              </div>

              <details v-if="roleKeyOptions.length" class="contact-dialog__helper-block">
                <summary class="contact-dialog__helper-summary">作用域速填</summary>
                <div class="contact-dialog__helper-grid">
                  <div v-if="roleKeyOptions.length" class="contact-dialog__helper-group">
                    <span class="contact-dialog__helper-label">角色</span>
                    <div class="contact-dialog__chip-list">
                      <button
                        v-for="option in roleKeyOptions"
                        :key="option.value"
                        class="contact-dialog__chip"
                        type="button"
                        @click="appendRoleKeyToScope(entry.scope, option.value)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </details>

              <div class="contact-dialog__subsection">
                <label class="contact-dialog__inline-check">
                  <input v-model="entry.invoke.enabled" type="checkbox" />
                  <span>执行动作后调用事件</span>
                </label>

                <div v-if="entry.invoke.enabled" class="contact-dialog__grid contact-dialog__grid--invoke">
                  <label class="contact-dialog__field">
                    <span class="contact-dialog__label">目标类型</span>
                    <select v-model="entry.invoke.targetType" class="text-input contact-dialog__select">
                      <option v-for="track in Object.keys(invokeTargetLabels)" :key="track" :value="track">
                        {{ invokeTargetLabels[track as InvokeTargetType] }}
                      </option>
                    </select>
                  </label>
                  <label class="contact-dialog__field contact-dialog__field--wide">
                    <span class="contact-dialog__label">调用事件</span>
                    <select v-model="entry.invoke.eventId" class="text-input contact-dialog__select">
                      <option value="">请选择 invoke 事件</option>
                      <option v-for="option in getInvokeOptions(entry.invoke.targetType)" :key="`${option.targetType}:${option.eventId}`" :value="option.eventId">
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label class="contact-dialog__inline-check">
                    <input v-model="entry.invoke.delayEnabled" type="checkbox" />
                    <span>延迟调用</span>
                  </label>
                  <template v-if="entry.invoke.delayEnabled">
                    <label class="contact-dialog__field">
                      <span class="contact-dialog__label">延迟数值</span>
                      <input v-model="entry.invoke.delayValueText" class="text-input" type="number" min="1" step="1" />
                    </label>
                    <label class="contact-dialog__field">
                      <span class="contact-dialog__label">延迟单位</span>
                      <select v-model="entry.invoke.delayUnit" class="text-input contact-dialog__select">
                        <option value="hours">小时</option>
                        <option value="days">天</option>
                        <option value="months">月</option>
                        <option value="years">年</option>
                      </select>
                    </label>
                  </template>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="contact-dialog__empty">
            {{ draft.actions.length ? "当前搜索没有命中动作项。" : "还没有动作项，先加一个。" }}
          </div>
        </div>

        <div v-else-if="activeTab === 'replies'" class="contact-dialog__section">
          <div class="contact-dialog__section-head">
            <div>
              <h3 class="contact-dialog__section-title">回复库</h3>
              <p class="contact-dialog__section-note">NPC 根据联系人分类、好感区间和性格，从这里挑选回复。</p>
            </div>
            <div class="contact-dialog__section-tools">
              <input
                v-model="sectionSearch.replies"
                class="text-input contact-dialog__search"
                type="text"
                placeholder="搜索 ID / 回复内容 / 标签 / 角色 / 性格"
              />
              <span class="contact-dialog__result-count">
                {{ filteredReplies.length }} / {{ draft.replies.length }}
              </span>
              <button class="btn-secondary contact-dialog__action" type="button" @click="addReply">
                新增回复
              </button>
            </div>
          </div>

          <div v-if="filteredReplies.length" class="contact-dialog__stack">
            <article
              v-for="{ entry, index } in filteredReplies"
              :key="entry.draftKey"
              class="contact-dialog__card"
            >
              <div class="contact-dialog__card-head">
                <div class="contact-dialog__card-title-wrap">
                  <strong class="contact-dialog__card-title">{{ entry.id || `reply_${index + 1}` }}</strong>
                  <span class="contact-dialog__card-note">一组可被 NPC 复用的回复文本</span>
                </div>
                <button class="btn-secondary contact-dialog__card-remove" type="button" @click="removeReply(index)">
                  删除
                </button>
              </div>

              <div class="contact-dialog__grid">
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">ID</span>
                  <input v-model="entry.id" class="text-input" type="text" placeholder="reply_romance_reserved_care" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">标签</span>
                  <input v-model="entry.tagsText" class="text-input" type="text" placeholder="care, daily" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">角色范围</span>
                  <textarea
                    v-model="entry.scope.roleKeysText"
                    class="text-input contact-dialog__textarea"
                    rows="2"
                    placeholder="important:chulian"
                  />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">性格范围</span>
                  <div v-if="personalityIdOptions.length" class="contact-dialog__scope-checks contact-dialog__scope-checks--dense">
                    <label
                      v-for="option in personalityIdOptions"
                      :key="option.value"
                      class="contact-dialog__chip-check"
                      :class="{ 'contact-dialog__chip-check--active': entry.scope.personalityIds.includes(option.value) }"
                    >
                      <input v-model="entry.scope.personalityIds" type="checkbox" :value="option.value" />
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                  <span v-else class="contact-dialog__hint">还没有性格定义，当前视为不限性格。</span>
                  <span class="contact-dialog__hint">不选表示不限性格。</span>
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">最小好感</span>
                  <input v-model="entry.scope.minFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
                <label class="contact-dialog__field">
                  <span class="contact-dialog__label">最大好感</span>
                  <input v-model="entry.scope.maxFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
                <label class="contact-dialog__field contact-dialog__field--wide">
                  <span class="contact-dialog__label">回复列表</span>
                  <textarea
                    v-model="entry.repliesText"
                    class="text-input contact-dialog__textarea"
                    rows="4"
                    placeholder="一行一条回复"
                  />
                </label>
              </div>

              <div class="contact-dialog__subsection">
                <span class="contact-dialog__label">联系人分类</span>
                <div class="contact-dialog__scope-checks">
                  <label v-for="track in contactTrackOptions" :key="track.value" class="contact-dialog__inline-check">
                    <input v-model="entry.scope.contact_tracks" type="checkbox" :value="track.value" />
                    <span>{{ track.label }}</span>
                  </label>
                </div>
              </div>

              <details v-if="roleKeyOptions.length" class="contact-dialog__helper-block">
                <summary class="contact-dialog__helper-summary">作用域速填</summary>
                <div class="contact-dialog__helper-grid">
                  <div v-if="roleKeyOptions.length" class="contact-dialog__helper-group">
                    <span class="contact-dialog__helper-label">角色</span>
                    <div class="contact-dialog__chip-list">
                      <button
                        v-for="option in roleKeyOptions"
                        :key="option.value"
                        class="contact-dialog__chip"
                        type="button"
                        @click="appendRoleKeyToScope(entry.scope, option.value)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </details>
            </article>
          </div>

          <div v-else-if="activeTab === 'replies'" class="contact-dialog__empty">
            {{ draft.replies.length ? "当前搜索没有命中回复条目。" : "还没有回复库条目，先加一组。" }}
          </div>
        </div>

</template>

<style scoped src="./styles/StoryContactDialog.css"></style>
