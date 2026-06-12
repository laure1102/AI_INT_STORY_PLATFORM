<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from "vue"
import type {
  StoryPhoneContactTrackId,
  StoryPhoneFile,
  StoryRolesFile
} from "@story-mgr/core"
import { useStoryPhoneDraft } from "./useStoryPhoneDraft"

type PhoneTab = "tracks" | "personalities" | "talks" | "actions" | "replies"
type InvokeTargetType = "chain" | "pool" | "schedule"

interface InvokeEventOption {
  eventId: string
  label: string
  targetType: InvokeTargetType
}

const props = defineProps<{
  itemIds: string[]
  invokeEventOptions: InvokeEventOption[]
  phone: StoryPhoneFile
  roles: StoryRolesFile
  saveSuccessMessage?: string | null
  saving: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [phone: StoryPhoneFile]
}>()

const activeTab = shallowRef<PhoneTab>("tracks")
const sectionSearch = reactive<Record<PhoneTab, string>>({
  actions: "",
  personalities: "",
  replies: "",
  talks: "",
  tracks: ""
})

const tabOptions: Array<{ key: PhoneTab; label: string }> = [
  { key: "tracks", label: "关系规则" },
  { key: "personalities", label: "性格库" },
  { key: "talks", label: "闲聊短句" },
  { key: "actions", label: "动作库" },
  { key: "replies", label: "回复库" }
]

const contactTrackOptions: Array<{ value: StoryPhoneContactTrackId; label: string }> = [
  { value: "romance", label: "恋爱" },
  { value: "official", label: "政务" },
  { value: "social", label: "社交" }
]

const {
  addAction,
  addPersonality,
  addReply,
  addTalk,
  addTrack,
  addTrackStage,
  buildPhoneFile,
  draft,
  removeAction,
  removePersonality,
  removeReply,
  removeTalk,
  removeTrack,
  removeTrackStage,
  syncFromPhone
} = useStoryPhoneDraft(props.phone)

const roleKeyOptions = computed(() => [
  ...props.roles.important.roles.map((role) => ({
    label: `important:${role.id} · ${role.name || role.id}`,
    value: `important:${role.id}`
  })),
  ...props.roles.normal.roles.map((role) => ({
    label: `normal:${role.id} · ${role.name || role.id}`,
    value: `normal:${role.id}`
  }))
])

const personalityIdOptions = computed(() =>
  draft.personalities
    .map((personality) => ({
      label: personality.name.trim() || personality.id.trim() || "未命名性格",
      value: personality.id.trim()
    }))
    .filter((option) => option.value)
)

const canAddTrack = computed(() => draft.tracks.length < contactTrackOptions.length)

const invokeTargetLabels: Record<InvokeTargetType, string> = {
  chain: "链式剧情线",
  pool: "平面事件池",
  schedule: "定时规则事件"
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
}

function matchesSearch(searchText: string, fields: unknown[]) {
  const normalizedSearchText = normalizeSearchText(searchText)
  if (!normalizedSearchText) {
    return true
  }

  return fields.some((field) => normalizeSearchText(field).includes(normalizedSearchText))
}

function appendCsvToken(currentText: string, token: string) {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    return currentText
  }

  const parts = currentText
    .split(/[,\n，、]/g)
    .map((part) => part.trim())
    .filter(Boolean)

  if (!parts.includes(normalizedToken)) {
    parts.push(normalizedToken)
  }

  return parts.join(", ")
}

function appendRoleKeyToScope(scope: { roleKeysText: string }, roleKey: string) {
  scope.roleKeysText = appendCsvToken(scope.roleKeysText, roleKey)
}

const filteredTracks = computed(() =>
  draft.tracks
    .map((track, index) => ({ index, track }))
    .filter(({ track }) =>
      matchesSearch(sectionSearch.tracks, [
        track.id,
        track.name,
        track.descr,
        ...track.stages.flatMap((stage) => [
          stage.id,
          stage.name,
          stage.descr,
          stage.lockMessage,
          stage.unlockActionTagsText
        ])
      ])
    )
)

const filteredPersonalities = computed(() =>
  draft.personalities
    .map((personality, index) => ({ index, personality }))
    .filter(({ personality }) =>
      matchesSearch(sectionSearch.personalities, [
        personality.id,
        personality.name,
        personality.descr,
        personality.styleTagsText
      ])
    )
)

const filteredTalks = computed(() =>
  draft.talks
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      matchesSearch(sectionSearch.talks, [
        entry.id,
        entry.text,
        entry.tagsText,
        entry.scope.roleKeysText,
        entry.scope.personalityIds.join(", ")
      ])
    )
)

const filteredActions = computed(() =>
  draft.actions
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      matchesSearch(sectionSearch.actions, [
        entry.id,
        entry.label,
        entry.text,
        entry.tagsText,
        entry.costItemsText,
        entry.scope.roleKeysText,
        entry.scope.personalityIds.join(", ")
      ])
    )
)

const filteredReplies = computed(() =>
  draft.replies
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      matchesSearch(sectionSearch.replies, [
        entry.id,
        entry.tagsText,
        entry.repliesText,
        entry.scope.roleKeysText,
        entry.scope.personalityIds.join(", ")
      ])
    )
)

function getInvokeOptions(targetType: InvokeTargetType) {
  return props.invokeEventOptions.filter((option) => option.targetType === targetType)
}

function submitDraft() {
  emit("save", buildPhoneFile())
}

watch(
  () => props.phone,
  (phone) => {
    syncFromPhone(phone)
  }
)
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
            <button class="btn-primary phone-dialog__action" type="button" :disabled="saving" @click="submitDraft">
              {{ saving ? "保存中..." : "保存手机配置" }}
            </button>
          </div>
        </div>

        <div class="phone-dialog__tabs">
          <button
            v-for="tab in tabOptions"
            :key="tab.key"
            class="phone-dialog__tab"
            :class="{ 'phone-dialog__tab--active': activeTab === tab.key }"
            type="button"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <div v-if="activeTab === 'tracks'" class="phone-dialog__section">
          <div class="phone-dialog__section-head">
            <div>
              <h3 class="phone-dialog__section-title">关系轨道</h3>
              <p class="phone-dialog__section-note">定义不同联系人分类的好感阶段、锁定提示和动作解锁标签。</p>
            </div>
            <div class="phone-dialog__section-tools">
              <input
                v-model="sectionSearch.tracks"
                class="text-input phone-dialog__search"
                type="text"
                placeholder="搜索轨道 / 阶段 / 锁定提示"
              />
              <span class="phone-dialog__result-count">
                {{ filteredTracks.length }} / {{ draft.tracks.length }}
              </span>
              <button class="btn-secondary phone-dialog__action" type="button" :disabled="!canAddTrack" @click="addTrack">
                新增轨道
              </button>
            </div>
          </div>

          <div v-if="filteredTracks.length" class="phone-dialog__stack">
            <article
              v-for="{ track, index: trackIndex } in filteredTracks"
              :key="track.draftKey"
              class="phone-dialog__card"
            >
              <div class="phone-dialog__card-head">
                <div class="phone-dialog__card-title-wrap">
                  <strong class="phone-dialog__card-title">{{ track.id }}</strong>
                  <span class="phone-dialog__card-note">一条联系人关系主轨道</span>
                </div>
                <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeTrack(trackIndex)">
                  删除轨道
                </button>
              </div>

              <div class="phone-dialog__grid phone-dialog__grid--track">
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">轨道名称</span>
                  <input v-model="track.name" class="text-input" type="text" placeholder="恋爱关系" />
                </label>

                <label class="phone-dialog__field phone-dialog__field--wide">
                  <span class="phone-dialog__label">轨道说明</span>
                  <textarea
                    v-model="track.descr"
                    class="text-input phone-dialog__textarea"
                    rows="2"
                    placeholder="说明这条轨道代表什么关系。"
                  />
                </label>
              </div>

              <div class="phone-dialog__section-head phone-dialog__section-head--nested">
                <div>
                  <h4 class="phone-dialog__section-title phone-dialog__section-title--small">阶段列表</h4>
                  <p class="phone-dialog__section-note">阶段决定联系是否开放，以及会解锁哪些动作标签。</p>
                </div>
                <button class="btn-secondary phone-dialog__action" type="button" @click="addTrackStage(track)">
                  新增阶段
                </button>
              </div>

              <div class="phone-dialog__table-wrap">
                <table class="phone-dialog__table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>名称</th>
                      <th>好感范围</th>
                      <th>可联系</th>
                      <th>锁定提示</th>
                      <th>解锁动作标签</th>
                      <th>说明</th>
                      <th class="phone-dialog__actions-col">操作</th>
                    </tr>
                  </thead>
                  <tbody v-if="track.stages.length">
                    <tr v-for="(stage, stageIndex) in track.stages" :key="stage.draftKey">
                      <td>
                        <input v-model="stage.id" class="text-input phone-dialog__cell-input" type="text" placeholder="friend" />
                      </td>
                      <td>
                        <input v-model="stage.name" class="text-input phone-dialog__cell-input" type="text" placeholder="朋友" />
                      </td>
                      <td>
                        <div class="phone-dialog__range-inputs">
                          <input v-model="stage.minFavorText" class="text-input phone-dialog__mini-input" type="number" min="0" max="100" step="1" />
                          <span class="phone-dialog__range-sep">-</span>
                          <input v-model="stage.maxFavorText" class="text-input phone-dialog__mini-input" type="number" min="0" max="100" step="1" />
                        </div>
                      </td>
                      <td>
                        <label class="phone-dialog__inline-check">
                          <input v-model="stage.allowContact" type="checkbox" />
                          <span>{{ stage.allowContact ? "允许" : "锁定" }}</span>
                        </label>
                      </td>
                      <td>
                        <textarea
                          v-model="stage.lockMessage"
                          class="text-input phone-dialog__textarea phone-dialog__textarea--cell"
                          rows="2"
                          placeholder="她现在很讨厌我，肯定不会理我了。"
                        />
                      </td>
                      <td>
                        <textarea
                          v-model="stage.unlockActionTagsText"
                          class="text-input phone-dialog__textarea phone-dialog__textarea--cell"
                          rows="2"
                          placeholder="gift_basic, date"
                        />
                      </td>
                      <td>
                        <textarea
                          v-model="stage.descr"
                          class="text-input phone-dialog__textarea phone-dialog__textarea--cell"
                          rows="2"
                          placeholder="阶段说明"
                        />
                      </td>
                      <td class="phone-dialog__actions-col">
                        <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeTrackStage(track, stageIndex)">
                          删除
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div v-if="!track.stages.length" class="phone-dialog__empty">
                  这条轨道还没有阶段，先补一个阶段。
                </div>
              </div>
            </article>
          </div>

          <div v-else class="phone-dialog__empty">
            {{ draft.tracks.length ? "当前搜索没有命中关系轨道。" : "还没有关系轨道，先新增一条。" }}
          </div>
        </div>

        <div v-else-if="activeTab === 'personalities'" class="phone-dialog__section">
          <div class="phone-dialog__section-head">
            <div>
              <h3 class="phone-dialog__section-title">性格库</h3>
              <p class="phone-dialog__section-note">角色和联系人短句会复用这里的结构化性格标签。</p>
            </div>
            <div class="phone-dialog__section-tools">
              <input
                v-model="sectionSearch.personalities"
                class="text-input phone-dialog__search"
                type="text"
                placeholder="搜索性格 ID / 名称 / 风格标签"
              />
              <span class="phone-dialog__result-count">
                {{ filteredPersonalities.length }} / {{ draft.personalities.length }}
              </span>
              <button class="btn-secondary phone-dialog__action" type="button" @click="addPersonality">
                新增性格
              </button>
            </div>
          </div>

          <div class="phone-dialog__table-wrap">
            <table class="phone-dialog__table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>名称</th>
                  <th>风格标签</th>
                  <th>说明</th>
                  <th class="phone-dialog__actions-col">操作</th>
                </tr>
              </thead>
              <tbody v-if="filteredPersonalities.length">
                <tr
                  v-for="{ personality, index } in filteredPersonalities"
                  :key="personality.draftKey"
                >
                  <td>
                    <input v-model="personality.id" class="text-input phone-dialog__cell-input" type="text" placeholder="lively" />
                  </td>
                  <td>
                    <input v-model="personality.name" class="text-input phone-dialog__cell-input" type="text" placeholder="活泼开朗" />
                  </td>
                  <td>
                    <textarea
                      v-model="personality.styleTagsText"
                      class="text-input phone-dialog__textarea phone-dialog__textarea--cell"
                      rows="2"
                      placeholder="热情, 直接"
                    />
                  </td>
                  <td>
                    <textarea
                      v-model="personality.descr"
                      class="text-input phone-dialog__textarea phone-dialog__textarea--cell"
                      rows="2"
                      placeholder="说话外放，反馈很快。"
                    />
                  </td>
                  <td class="phone-dialog__actions-col">
                    <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removePersonality(index)">
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="!filteredPersonalities.length" class="phone-dialog__empty">
              {{ draft.personalities.length ? "当前搜索没有命中性格定义。" : "还没有性格定义，先加一个。" }}
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'talks'" class="phone-dialog__section">
          <div class="phone-dialog__section-head">
            <div>
              <h3 class="phone-dialog__section-title">闲聊短句库</h3>
              <p class="phone-dialog__section-note">玩家主动发出的闲聊短句，支持作用域筛选和调用事件。</p>
            </div>
            <div class="phone-dialog__section-tools">
              <input
                v-model="sectionSearch.talks"
                class="text-input phone-dialog__search"
                type="text"
                placeholder="搜索 ID / 文本 / 标签 / 角色 / 性格"
              />
              <span class="phone-dialog__result-count">
                {{ filteredTalks.length }} / {{ draft.talks.length }}
              </span>
              <button class="btn-secondary phone-dialog__action" type="button" @click="addTalk">
                新增短句
              </button>
            </div>
          </div>

          <div v-if="filteredTalks.length" class="phone-dialog__stack">
            <article
              v-for="{ entry, index } in filteredTalks"
              :key="entry.draftKey"
              class="phone-dialog__card"
            >
              <div class="phone-dialog__card-head">
                <div class="phone-dialog__card-title-wrap">
                  <strong class="phone-dialog__card-title">{{ entry.id || `talk_${index + 1}` }}</strong>
                  <span class="phone-dialog__card-note">一条玩家主动发送的闲聊短句</span>
                </div>
                <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeTalk(index)">
                  删除
                </button>
              </div>

              <div class="phone-dialog__grid">
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">ID</span>
                  <input v-model="entry.id" class="text-input" type="text" placeholder="talk_greet_generic" />
                </label>
                <label class="phone-dialog__field phone-dialog__field--wide">
                  <span class="phone-dialog__label">短句内容</span>
                  <input v-model="entry.text" class="text-input" type="text" placeholder="在吗？" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">标签</span>
                  <input v-model="entry.tagsText" class="text-input" type="text" placeholder="daily, care" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">好感变化</span>
                  <input v-model="entry.baseFavorDeltaText" class="text-input" type="number" step="1" placeholder="1" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">冷却小时</span>
                  <input v-model="entry.cooldownHoursText" class="text-input" type="number" min="0" step="1" placeholder="6" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">角色范围</span>
                  <textarea
                    v-model="entry.scope.roleKeysText"
                    class="text-input phone-dialog__textarea"
                    rows="2"
                    placeholder="important:zhuli, normal:start_suanming"
                  />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">性格范围</span>
                  <div v-if="personalityIdOptions.length" class="phone-dialog__scope-checks phone-dialog__scope-checks--dense">
                    <label
                      v-for="option in personalityIdOptions"
                      :key="option.value"
                      class="phone-dialog__chip-check"
                      :class="{ 'phone-dialog__chip-check--active': entry.scope.personalityIds.includes(option.value) }"
                    >
                      <input v-model="entry.scope.personalityIds" type="checkbox" :value="option.value" />
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                  <span v-else class="phone-dialog__hint">还没有性格定义，当前视为不限性格。</span>
                  <span class="phone-dialog__hint">不选表示不限性格。</span>
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">最小好感</span>
                  <input v-model="entry.scope.minFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">最大好感</span>
                  <input v-model="entry.scope.maxFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
              </div>

              <div class="phone-dialog__subsection">
                <span class="phone-dialog__label">联系人分类</span>
                <div class="phone-dialog__scope-checks">
                  <label v-for="track in contactTrackOptions" :key="track.value" class="phone-dialog__inline-check">
                    <input v-model="entry.scope.contact_tracks" type="checkbox" :value="track.value" />
                    <span>{{ track.label }}</span>
                  </label>
                </div>
              </div>

              <details v-if="roleKeyOptions.length" class="phone-dialog__helper-block">
                <summary class="phone-dialog__helper-summary">作用域速填</summary>
                <div class="phone-dialog__helper-grid">
                  <div v-if="roleKeyOptions.length" class="phone-dialog__helper-group">
                    <span class="phone-dialog__helper-label">角色</span>
                    <div class="phone-dialog__chip-list">
                      <button
                        v-for="option in roleKeyOptions"
                        :key="option.value"
                        class="phone-dialog__chip"
                        type="button"
                        @click="appendRoleKeyToScope(entry.scope, option.value)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </details>

              <div class="phone-dialog__subsection">
                <label class="phone-dialog__inline-check">
                  <input v-model="entry.invoke.enabled" type="checkbox" />
                  <span>发送这条短句后调用事件</span>
                </label>

                <div v-if="entry.invoke.enabled" class="phone-dialog__grid phone-dialog__grid--invoke">
                  <label class="phone-dialog__field">
                    <span class="phone-dialog__label">目标类型</span>
                    <select v-model="entry.invoke.targetType" class="text-input phone-dialog__select">
                      <option v-for="track in Object.keys(invokeTargetLabels)" :key="track" :value="track">
                        {{ invokeTargetLabels[track as InvokeTargetType] }}
                      </option>
                    </select>
                  </label>
                  <label class="phone-dialog__field phone-dialog__field--wide">
                    <span class="phone-dialog__label">调用事件</span>
                    <select v-model="entry.invoke.eventId" class="text-input phone-dialog__select">
                      <option value="">请选择 invoke 事件</option>
                      <option v-for="option in getInvokeOptions(entry.invoke.targetType)" :key="`${option.targetType}:${option.eventId}`" :value="option.eventId">
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label class="phone-dialog__inline-check">
                    <input v-model="entry.invoke.delayEnabled" type="checkbox" />
                    <span>延迟调用</span>
                  </label>
                  <template v-if="entry.invoke.delayEnabled">
                    <label class="phone-dialog__field">
                      <span class="phone-dialog__label">延迟数值</span>
                      <input v-model="entry.invoke.delayValueText" class="text-input" type="number" min="1" step="1" />
                    </label>
                    <label class="phone-dialog__field">
                      <span class="phone-dialog__label">延迟单位</span>
                      <select v-model="entry.invoke.delayUnit" class="text-input phone-dialog__select">
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

          <div v-else class="phone-dialog__empty">
            {{ draft.talks.length ? "当前搜索没有命中闲聊短句。" : "还没有闲聊短句，先加一条。" }}
          </div>
        </div>

        <div v-else-if="activeTab === 'actions'" class="phone-dialog__section">
          <div class="phone-dialog__section-head">
            <div>
              <h3 class="phone-dialog__section-title">动作库</h3>
              <p class="phone-dialog__section-note">发红包、送礼、约会等动作项，支持消耗和事件调用。</p>
            </div>
            <div class="phone-dialog__section-tools">
              <input
                v-model="sectionSearch.actions"
                class="text-input phone-dialog__search"
                type="text"
                placeholder="搜索 ID / 名称 / 标签 / 成本 / 角色"
              />
              <span class="phone-dialog__result-count">
                {{ filteredActions.length }} / {{ draft.actions.length }}
              </span>
              <button class="btn-secondary phone-dialog__action" type="button" @click="addAction">
                新增动作
              </button>
            </div>
          </div>

          <div v-if="filteredActions.length" class="phone-dialog__stack">
            <article
              v-for="{ entry, index } in filteredActions"
              :key="entry.draftKey"
              class="phone-dialog__card"
            >
              <div class="phone-dialog__card-head">
                <div class="phone-dialog__card-title-wrap">
                  <strong class="phone-dialog__card-title">{{ entry.id || `action_${index + 1}` }}</strong>
                  <span class="phone-dialog__card-note">一条玩家主动发起的联系人动作</span>
                </div>
                <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeAction(index)">
                  删除
                </button>
              </div>

              <div class="phone-dialog__grid">
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">ID</span>
                  <input v-model="entry.id" class="text-input" type="text" placeholder="action_send_red_packet_small" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">按钮名称</span>
                  <input v-model="entry.label" class="text-input" type="text" placeholder="发个红包" />
                </label>
                <label class="phone-dialog__field phone-dialog__field--wide">
                  <span class="phone-dialog__label">动作文本</span>
                  <input v-model="entry.text" class="text-input" type="text" placeholder="给你发个小红包。" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">标签</span>
                  <input v-model="entry.tagsText" class="text-input" type="text" placeholder="gift_basic, money" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">好感变化</span>
                  <input v-model="entry.baseFavorDeltaText" class="text-input" type="number" step="1" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">冷却小时</span>
                  <input v-model="entry.cooldownHoursText" class="text-input" type="number" min="0" step="1" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">金钱消耗</span>
                  <input v-model="entry.costMoneyText" class="text-input" type="number" min="0" step="100" />
                </label>
                <label class="phone-dialog__field phone-dialog__field--wide">
                  <span class="phone-dialog__label">物品消耗</span>
                  <textarea
                    v-model="entry.costItemsText"
                    class="text-input phone-dialog__textarea"
                    rows="2"
                    :placeholder="itemIds.length ? `item_id:quantity，例如\\n${itemIds[0]}:1` : 'item_id:quantity'"
                  />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">角色范围</span>
                  <textarea
                    v-model="entry.scope.roleKeysText"
                    class="text-input phone-dialog__textarea"
                    rows="2"
                    placeholder="important:chulian"
                  />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">性格范围</span>
                  <div v-if="personalityIdOptions.length" class="phone-dialog__scope-checks phone-dialog__scope-checks--dense">
                    <label
                      v-for="option in personalityIdOptions"
                      :key="option.value"
                      class="phone-dialog__chip-check"
                      :class="{ 'phone-dialog__chip-check--active': entry.scope.personalityIds.includes(option.value) }"
                    >
                      <input v-model="entry.scope.personalityIds" type="checkbox" :value="option.value" />
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                  <span v-else class="phone-dialog__hint">还没有性格定义，当前视为不限性格。</span>
                  <span class="phone-dialog__hint">不选表示不限性格。</span>
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">最小好感</span>
                  <input v-model="entry.scope.minFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">最大好感</span>
                  <input v-model="entry.scope.maxFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
              </div>

              <div class="phone-dialog__subsection">
                <span class="phone-dialog__label">联系人分类</span>
                <div class="phone-dialog__scope-checks">
                  <label v-for="track in contactTrackOptions" :key="track.value" class="phone-dialog__inline-check">
                    <input v-model="entry.scope.contact_tracks" type="checkbox" :value="track.value" />
                    <span>{{ track.label }}</span>
                  </label>
                </div>
              </div>

              <details v-if="roleKeyOptions.length" class="phone-dialog__helper-block">
                <summary class="phone-dialog__helper-summary">作用域速填</summary>
                <div class="phone-dialog__helper-grid">
                  <div v-if="roleKeyOptions.length" class="phone-dialog__helper-group">
                    <span class="phone-dialog__helper-label">角色</span>
                    <div class="phone-dialog__chip-list">
                      <button
                        v-for="option in roleKeyOptions"
                        :key="option.value"
                        class="phone-dialog__chip"
                        type="button"
                        @click="appendRoleKeyToScope(entry.scope, option.value)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </details>

              <div class="phone-dialog__subsection">
                <label class="phone-dialog__inline-check">
                  <input v-model="entry.invoke.enabled" type="checkbox" />
                  <span>执行动作后调用事件</span>
                </label>

                <div v-if="entry.invoke.enabled" class="phone-dialog__grid phone-dialog__grid--invoke">
                  <label class="phone-dialog__field">
                    <span class="phone-dialog__label">目标类型</span>
                    <select v-model="entry.invoke.targetType" class="text-input phone-dialog__select">
                      <option v-for="track in Object.keys(invokeTargetLabels)" :key="track" :value="track">
                        {{ invokeTargetLabels[track as InvokeTargetType] }}
                      </option>
                    </select>
                  </label>
                  <label class="phone-dialog__field phone-dialog__field--wide">
                    <span class="phone-dialog__label">调用事件</span>
                    <select v-model="entry.invoke.eventId" class="text-input phone-dialog__select">
                      <option value="">请选择 invoke 事件</option>
                      <option v-for="option in getInvokeOptions(entry.invoke.targetType)" :key="`${option.targetType}:${option.eventId}`" :value="option.eventId">
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label class="phone-dialog__inline-check">
                    <input v-model="entry.invoke.delayEnabled" type="checkbox" />
                    <span>延迟调用</span>
                  </label>
                  <template v-if="entry.invoke.delayEnabled">
                    <label class="phone-dialog__field">
                      <span class="phone-dialog__label">延迟数值</span>
                      <input v-model="entry.invoke.delayValueText" class="text-input" type="number" min="1" step="1" />
                    </label>
                    <label class="phone-dialog__field">
                      <span class="phone-dialog__label">延迟单位</span>
                      <select v-model="entry.invoke.delayUnit" class="text-input phone-dialog__select">
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

          <div v-else class="phone-dialog__empty">
            {{ draft.actions.length ? "当前搜索没有命中动作项。" : "还没有动作项，先加一个。" }}
          </div>
        </div>

        <div v-else class="phone-dialog__section">
          <div class="phone-dialog__section-head">
            <div>
              <h3 class="phone-dialog__section-title">回复库</h3>
              <p class="phone-dialog__section-note">NPC 根据联系人分类、好感区间和性格，从这里挑选回复。</p>
            </div>
            <div class="phone-dialog__section-tools">
              <input
                v-model="sectionSearch.replies"
                class="text-input phone-dialog__search"
                type="text"
                placeholder="搜索 ID / 回复内容 / 标签 / 角色 / 性格"
              />
              <span class="phone-dialog__result-count">
                {{ filteredReplies.length }} / {{ draft.replies.length }}
              </span>
              <button class="btn-secondary phone-dialog__action" type="button" @click="addReply">
                新增回复
              </button>
            </div>
          </div>

          <div v-if="filteredReplies.length" class="phone-dialog__stack">
            <article
              v-for="{ entry, index } in filteredReplies"
              :key="entry.draftKey"
              class="phone-dialog__card"
            >
              <div class="phone-dialog__card-head">
                <div class="phone-dialog__card-title-wrap">
                  <strong class="phone-dialog__card-title">{{ entry.id || `reply_${index + 1}` }}</strong>
                  <span class="phone-dialog__card-note">一组可被 NPC 复用的回复文本</span>
                </div>
                <button class="btn-secondary phone-dialog__card-remove" type="button" @click="removeReply(index)">
                  删除
                </button>
              </div>

              <div class="phone-dialog__grid">
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">ID</span>
                  <input v-model="entry.id" class="text-input" type="text" placeholder="reply_romance_reserved_care" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">标签</span>
                  <input v-model="entry.tagsText" class="text-input" type="text" placeholder="care, daily" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">角色范围</span>
                  <textarea
                    v-model="entry.scope.roleKeysText"
                    class="text-input phone-dialog__textarea"
                    rows="2"
                    placeholder="important:chulian"
                  />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">性格范围</span>
                  <div v-if="personalityIdOptions.length" class="phone-dialog__scope-checks phone-dialog__scope-checks--dense">
                    <label
                      v-for="option in personalityIdOptions"
                      :key="option.value"
                      class="phone-dialog__chip-check"
                      :class="{ 'phone-dialog__chip-check--active': entry.scope.personalityIds.includes(option.value) }"
                    >
                      <input v-model="entry.scope.personalityIds" type="checkbox" :value="option.value" />
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                  <span v-else class="phone-dialog__hint">还没有性格定义，当前视为不限性格。</span>
                  <span class="phone-dialog__hint">不选表示不限性格。</span>
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">最小好感</span>
                  <input v-model="entry.scope.minFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
                <label class="phone-dialog__field">
                  <span class="phone-dialog__label">最大好感</span>
                  <input v-model="entry.scope.maxFavorText" class="text-input" type="number" min="0" max="100" step="1" />
                </label>
                <label class="phone-dialog__field phone-dialog__field--wide">
                  <span class="phone-dialog__label">回复列表</span>
                  <textarea
                    v-model="entry.repliesText"
                    class="text-input phone-dialog__textarea"
                    rows="4"
                    placeholder="一行一条回复"
                  />
                </label>
              </div>

              <div class="phone-dialog__subsection">
                <span class="phone-dialog__label">联系人分类</span>
                <div class="phone-dialog__scope-checks">
                  <label v-for="track in contactTrackOptions" :key="track.value" class="phone-dialog__inline-check">
                    <input v-model="entry.scope.contact_tracks" type="checkbox" :value="track.value" />
                    <span>{{ track.label }}</span>
                  </label>
                </div>
              </div>

              <details v-if="roleKeyOptions.length" class="phone-dialog__helper-block">
                <summary class="phone-dialog__helper-summary">作用域速填</summary>
                <div class="phone-dialog__helper-grid">
                  <div v-if="roleKeyOptions.length" class="phone-dialog__helper-group">
                    <span class="phone-dialog__helper-label">角色</span>
                    <div class="phone-dialog__chip-list">
                      <button
                        v-for="option in roleKeyOptions"
                        :key="option.value"
                        class="phone-dialog__chip"
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

          <div v-else-if="activeTab === 'replies'" class="phone-dialog__empty">
            {{ draft.replies.length ? "当前搜索没有命中回复条目。" : "还没有回复库条目，先加一组。" }}
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.phone-dialog {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.82);
}

.phone-dialog__panel {
  width: min(1420px, calc(100vw - 36px));
  max-height: calc(100vh - 36px);
  padding: 18px;
  overflow: auto;
  border-radius: 24px;
}

.phone-dialog__header,
.phone-dialog__section-head,
.phone-dialog__card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.phone-dialog__header-copy,
.phone-dialog__card-title-wrap {
  display: grid;
  gap: 6px;
}

.phone-dialog__title,
.phone-dialog__section-title,
.phone-dialog__card-title {
  margin: 0;
  font-family: "Space Grotesk", sans-serif;
}

.phone-dialog__title {
  font-size: 1.35rem;
}

.phone-dialog__section-title {
  font-size: 1rem;
}

.phone-dialog__section-title--small {
  font-size: 0.92rem;
}

.phone-dialog__subtitle,
.phone-dialog__section-note,
.phone-dialog__card-note,
.phone-dialog__success {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.phone-dialog__success {
  color: var(--accent);
}

.phone-dialog__header-actions,
.phone-dialog__tabs,
.phone-dialog__scope-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.phone-dialog__scope-checks--dense {
  gap: 8px;
}

.phone-dialog__section-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.phone-dialog__tabs {
  margin-top: 18px;
}

.phone-dialog__tab,
.phone-dialog__action,
.phone-dialog__card-remove {
  min-height: 34px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: 0.84rem;
}

.phone-dialog__tab {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-muted);
}

.phone-dialog__tab--active {
  border-color: rgba(125, 211, 252, 0.35);
  background: rgba(125, 211, 252, 0.12);
  color: var(--text-main);
}

.phone-dialog__section {
  display: grid;
  gap: 16px;
  margin-top: 18px;
}

.phone-dialog__stack {
  display: grid;
  gap: 14px;
}

.phone-dialog__card,
.phone-dialog__table-wrap {
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
}

.phone-dialog__card {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.phone-dialog__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.phone-dialog__grid--track,
.phone-dialog__grid--invoke {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.phone-dialog__field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.phone-dialog__field--wide {
  grid-column: span 2;
}

.phone-dialog__label {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.phone-dialog__textarea {
  min-height: 72px;
  resize: vertical;
}

.phone-dialog__textarea--cell {
  min-height: 54px;
}

.phone-dialog__search {
  width: min(360px, 100%);
}

.phone-dialog__result-count {
  color: var(--text-muted);
  font-size: 0.78rem;
  white-space: nowrap;
}

.phone-dialog__subsection {
  display: grid;
  gap: 8px;
}

.phone-dialog__hint {
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.4;
}

.phone-dialog__helper-block {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border: 1px dashed rgba(186, 220, 255, 0.2);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
}

.phone-dialog__helper-summary {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.phone-dialog__helper-grid,
.phone-dialog__helper-group {
  display: grid;
  gap: 8px;
}

.phone-dialog__helper-label {
  color: var(--text-muted);
  font-size: 0.76rem;
}

.phone-dialog__chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.phone-dialog__chip {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(186, 220, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  font-size: 0.76rem;
  text-align: left;
}

.phone-dialog__chip:hover {
  color: var(--text-main);
  border-color: rgba(125, 211, 252, 0.28);
  background: rgba(125, 211, 252, 0.08);
}

.phone-dialog__inline-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.phone-dialog__chip-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(186, 220, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  font-size: 0.76rem;
  cursor: pointer;
}

.phone-dialog__chip-check input {
  margin: 0;
}

.phone-dialog__chip-check--active {
  color: var(--text-main);
  border-color: rgba(125, 211, 252, 0.28);
  background: rgba(125, 211, 252, 0.1);
}

.phone-dialog__table-wrap {
  overflow: auto;
}

.phone-dialog__table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
}

.phone-dialog__table th,
.phone-dialog__table td {
  padding: 10px 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.phone-dialog__table th {
  position: sticky;
  top: 0;
  background: rgba(9, 19, 30, 0.92);
  color: var(--text-muted);
  font-size: 0.8rem;
}

.phone-dialog__cell-input,
.phone-dialog__select,
.phone-dialog__mini-input {
  min-width: 0;
}

.phone-dialog__range-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.phone-dialog__mini-input {
  width: 82px;
}

.phone-dialog__range-sep {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.phone-dialog__actions-col {
  width: 88px;
}

.phone-dialog__empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

@media (max-width: 1080px) {
  .phone-dialog__header,
  .phone-dialog__section-head,
  .phone-dialog__card-head,
  .phone-dialog__header-actions,
  .phone-dialog__section-tools {
    flex-direction: column;
    align-items: stretch;
  }

  .phone-dialog__grid,
  .phone-dialog__grid--track,
  .phone-dialog__grid--invoke {
    grid-template-columns: 1fr;
  }

  .phone-dialog__field--wide {
    grid-column: span 1;
  }
}
</style>
