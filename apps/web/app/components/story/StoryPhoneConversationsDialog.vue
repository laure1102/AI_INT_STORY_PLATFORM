<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from "vue"
import type {
  StoryDocument,
  StoryPhoneConversationsFile,
  StoryRolesFile,
  StoryValsFile
} from "@story-mgr/core"
import StoryScriptTextarea from "./StoryScriptTextarea.vue"
import {
  type PhoneConversationDraft,
  type PhoneConversationNodeDraft,
  useStoryPhoneConversationsDraft
} from "./useStoryPhoneConversationsDraft"

type InvokeTargetType = "chain" | "pool" | "schedule"

interface InvokeEventOption {
  eventId: string
  label: string
  targetType: InvokeTargetType
}

const props = defineProps<{
  embedded?: boolean
  invokeEventOptions: InvokeEventOption[]
  phoneConversations: StoryPhoneConversationsFile
  roles: StoryRolesFile
  saveErrorMessage?: string | null
  saveSuccessMessage?: string | null
  saving: boolean
  story: StoryDocument
  vals: StoryValsFile
}>()

const emit = defineEmits<{
  close: []
  save: [phoneConversations: StoryPhoneConversationsFile]
}>()

const searchText = shallowRef("")
const isEditorOpen = shallowRef(false)
const activeConversationKey = shallowRef<string | null>(null)
const localErrorMessage = shallowRef<string | null>(null)
const activeNodeKey = reactive<Record<string, string | null>>({})

const {
  addConversation,
  addMessage,
  addNode,
  addOption,
  buildPhoneConversationsFile,
  draft,
  removeConversation,
  removeMessage,
  removeNode,
  removeOption,
  syncFromPhoneConversations
} = useStoryPhoneConversationsDraft(props.phoneConversations)

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

const roleLabelByKey = computed(() =>
  Object.fromEntries(roleKeyOptions.value.map((option) => [option.value, option.label]))
)

const invokeTargetLabels: Record<InvokeTargetType, string> = {
  chain: "链式剧情线",
  pool: "平面事件池",
  schedule: "定时规则事件"
}

const reminderIntervalOptions = [
  { label: "10 分钟", value: "10" },
  { label: "30 分钟", value: "30" },
  { label: "1 小时", value: "60" },
  { label: "2 小时", value: "120" },
  { label: "6 小时", value: "360" }
]

const filteredConversations = computed(() => {
  const query = searchText.value.trim().toLowerCase()
  return draft.conversations
    .map((conversation, index) => ({ conversation, index }))
    .filter(({ conversation }) => {
      if (!query) {
        return true
      }

      return [
        conversation.id,
        conversation.title,
        conversation.roleKey,
        getRoleLabel(conversation.roleKey),
        ...conversation.nodes.flatMap((node) => [
          node.id,
          node.endScript,
          ...node.contactMessages.map((message) => message.content),
          ...node.playerOptions.flatMap((option) => [option.id, option.text, option.script])
        ])
      ].some((field) => field.toLowerCase().includes(query))
    })
})

const activeConversation = computed(() => {
  if (!activeConversationKey.value) {
    return null
  }

  return draft.conversations.find((conversation) => conversation.draftKey === activeConversationKey.value) ?? null
})

const activeConversationIndex = computed(() => {
  if (!activeConversation.value) {
    return -1
  }

  return draft.conversations.findIndex((conversation) => conversation.draftKey === activeConversation.value?.draftKey)
})

const activeNode = computed(() => {
  const conversation = activeConversation.value
  if (!conversation) {
    return null
  }

  const nodeKey = activeNodeKey[conversation.draftKey]
  return conversation.nodes.find((node) => node.draftKey === nodeKey)
    ?? conversation.nodes[0]
    ?? null
})

const activeNodeIndex = computed(() => {
  const conversation = activeConversation.value
  const node = activeNode.value
  if (!conversation || !node) {
    return -1
  }

  return conversation.nodes.findIndex((candidate) => candidate.draftKey === node.draftKey)
})

/** 读取或计算 `RoleLabel`。 @param roleKey 调用方传入的 `roleKey`。 @returns 计算、查找或构建后的结果。 */
function getRoleLabel(roleKey: string) {
  return roleLabelByKey.value[roleKey] ?? roleKey
}

/** 读取或计算 `InvokeOptions`。 @param targetType 调用方传入的 `targetType`。 @returns 计算、查找或构建后的结果。 */
function getInvokeOptions(targetType: InvokeTargetType) {
  return props.invokeEventOptions.filter((option) => option.targetType === targetType)
}

/** 读取或计算 `ConversationTitle`。 @param conversation 调用方传入的 `conversation`。 @returns 计算、查找或构建后的结果。 */
function getConversationTitle(conversation: PhoneConversationDraft) {
  return conversation.title.trim() || conversation.id.trim() || "未命名手机剧情"
}

/** 执行 `summarizeTrigger` 对应的局部业务逻辑。 @param conversation 调用方传入的 `conversation`。 @returns 计算、查找或构建后的结果。 */
function summarizeTrigger(conversation: PhoneConversationDraft) {
  const triggerExpr = conversation.triggerExpr.trim()
  if (!triggerExpr) {
    return "脚本启动"
  }

  return triggerExpr.length <= 56 ? triggerExpr : `${triggerExpr.slice(0, 56)}...`
}

/** 执行 `summarizeConversationBody` 对应的局部业务逻辑。 @param conversation 调用方传入的 `conversation`。 @returns 计算、查找或构建后的结果。 */
function summarizeConversationBody(conversation: PhoneConversationDraft) {
  const messageCount = conversation.nodes.reduce((total, node) => total + node.contactMessages.length, 0)
  const optionCount = conversation.nodes.reduce((total, node) => total + node.playerOptions.length, 0)
  return `${conversation.nodes.length} 节点 · ${messageCount} 消息 · ${optionCount} 回复`
}

/** 执行 `summarizeEndingInvoke` 对应的局部业务逻辑。 @param conversation 调用方传入的 `conversation`。 @returns 计算、查找或构建后的结果。 */
function summarizeEndingInvoke(conversation: PhoneConversationDraft) {
  const invokeNode = conversation.nodes.find((node) => node.invoke.enabled && node.invoke.eventId.trim())
  if (!invokeNode) {
    return "未设置"
  }

  const delay = invokeNode.invoke.delayEnabled
    ? ` · 延迟 ${invokeNode.invoke.delayValueText || 0} ${getDelayUnitLabel(invokeNode.invoke.delayUnit)}`
    : ""
  return `${invokeTargetLabels[invokeNode.invoke.targetType]}:${invokeNode.invoke.eventId}${delay}`
}

/** 读取或计算 `DelayUnitLabel`。 @param unit 调用方传入的 `unit`。 @returns 计算、查找或构建后的结果。 */
function getDelayUnitLabel(unit: string) {
  if (unit === "days") {
    return "天"
  }
  if (unit === "months") {
    return "月"
  }
  if (unit === "years") {
    return "年"
  }
  return "小时"
}

/** 根据当前输入构建 `DraftValidationError` 结果。 @returns 计算、查找或构建后的结果。 */
function buildDraftValidationError() {
  for (const conversation of draft.conversations) {
    const conversationLabel = getConversationTitle(conversation)
    for (const node of conversation.nodes) {
      if (node.invoke.enabled && !node.end) {
        return `手机剧情“${conversationLabel}”的节点“${node.id || "未命名节点"}”配置了结束后调用事件，但该节点未勾选“结束节点”。`
      }
    }
  }

  return null
}

/** 执行 `selectConversation` 对应的局部业务逻辑。 @param conversation 调用方传入的 `conversation`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function selectConversation(conversation: PhoneConversationDraft) {
  activeConversationKey.value = conversation.draftKey
  if (!activeNodeKey[conversation.draftKey]) {
    activeNodeKey[conversation.draftKey] = conversation.nodes[0]?.draftKey ?? null
  }
}

/** 打开 `ConversationEditor` 界面并初始化临时状态。 @param conversation 调用方传入的 `conversation`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openConversationEditor(conversation: PhoneConversationDraft) {
  selectConversation(conversation)
  isEditorOpen.value = true
}

/** 关闭 `ConversationEditor` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function closeConversationEditor() {
  isEditorOpen.value = false
}

/** 执行 `selectNode` 对应的局部业务逻辑。 @param conversation 调用方传入的 `conversation`。 @param node 调用方传入的 `node`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function selectNode(conversation: PhoneConversationDraft, node: PhoneConversationNodeDraft) {
  activeNodeKey[conversation.draftKey] = node.draftKey
}

/** 处理 `AddConversation` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleAddConversation() {
  const conversation = addConversation()
  selectConversation(conversation)
  isEditorOpen.value = true
}

/** 处理 `RemoveConversation` 用户交互。 @param index 调用方传入的 `index`。 @param conversation 调用方传入的 `conversation`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleRemoveConversation(index: number, conversation: PhoneConversationDraft) {
  const label = getConversationTitle(conversation)
  const confirmed =
    typeof window === "undefined"
      ? true
      : window.confirm(`确认删除手机剧情“${label}”吗？\n\n删除后需要点击保存才会写入文件。`)

  if (!confirmed) {
    return
  }

  const removedKey = draft.conversations[index]?.draftKey ?? null
  removeConversation(index)
  if (removedKey && activeConversationKey.value === removedKey) {
    activeConversationKey.value = null
    isEditorOpen.value = false
  }
}

/** 处理 `AddNode` 用户交互。 @param conversation 调用方传入的 `conversation`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleAddNode(conversation: PhoneConversationDraft) {
  const node = addNode(conversation)
  selectNode(conversation, node)
}

/** 处理 `RemoveNode` 用户交互。 @param conversation 调用方传入的 `conversation`。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleRemoveNode(conversation: PhoneConversationDraft, index: number) {
  const removedKey = conversation.nodes[index]?.draftKey ?? null
  removeNode(conversation, index)
  if (removedKey && activeNodeKey[conversation.draftKey] === removedKey) {
    activeNodeKey[conversation.draftKey] = conversation.nodes[Math.max(0, index - 1)]?.draftKey ?? null
  }
}

/** 处理 `NodeEndChange` 用户交互。 @param node 调用方传入的 `node`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleNodeEndChange(node: PhoneConversationNodeDraft) {
  if (node.end) {
    return
  }

  node.invoke.enabled = false
}

/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function submitDraft() {
  const validationError = buildDraftValidationError()
  if (validationError) {
    localErrorMessage.value = validationError
    return
  }

  localErrorMessage.value = null
  emit("save", buildPhoneConversationsFile())
}

watch(
  () => props.phoneConversations,
  (phoneConversations) => {
    syncFromPhoneConversations(phoneConversations)
    activeConversationKey.value = null
    isEditorOpen.value = false
    localErrorMessage.value = null
  }
)

watch(
  () => draft.conversations.length,
  () => {
    if (activeConversationKey.value && !draft.conversations.some((conversation) => conversation.draftKey === activeConversationKey.value)) {
      activeConversationKey.value = null
      isEditorOpen.value = false
    }
  },
  { immediate: true }
)
</script>

<template>
  <section class="phone-conversations-board glass-panel" :class="{ 'phone-conversations-board--floating': !embedded }">
    <div class="phone-conversations-board__header">
      <div class="phone-conversations-board__copy">
        <span class="eyebrow">手机剧情</span>
        <h2 class="section-title">连续手机剧情对话</h2>
        <p class="phone-conversations-board__summary">
          管理像“债主催债”这样的连续手机对白：NPC 消息、玩家固定回复、节点跳转、结束脚本和结束调用事件。
        </p>
        <p v-if="localErrorMessage || saveErrorMessage" class="phone-conversations-board__error">
          {{ localErrorMessage || saveErrorMessage }}
        </p>
        <p v-if="saveSuccessMessage" class="phone-conversations-board__success">{{ saveSuccessMessage }}</p>
      </div>

      <div class="phone-conversations-board__actions">
        <span class="pill">{{ draft.conversations.length }} 条手机剧情</span>
        <input
          v-model="searchText"
          class="text-input phone-conversations-board__search"
          type="text"
          placeholder="搜索 ID / 标题 / 联系人 / 文本"
        />
        <button class="btn-secondary phone-conversations-board__button" type="button" @click="handleAddConversation">
          创建手机剧情
        </button>
        <button class="btn-primary phone-conversations-board__button" type="button" :disabled="saving" @click="submitDraft">
          {{ saving ? "保存中..." : "保存" }}
        </button>
        <button v-if="!embedded" class="btn-secondary phone-conversations-board__button" type="button" @click="emit('close')">
          关闭
        </button>
      </div>
    </div>

    <div v-if="filteredConversations.length" class="phone-conversations-board__grid">
      <article
        v-for="{ conversation, index } in filteredConversations"
        :key="conversation.draftKey"
        class="phone-conversation-card"
        :class="{ 'phone-conversation-card--active': activeConversation?.draftKey === conversation.draftKey }"
      >
        <span
          v-if="!conversation.enabled"
          class="phone-conversation-card__trigger-mark phone-conversation-card__trigger-mark--disabled"
          title="未启用"
          aria-label="未启用"
        />
        <span
          v-else-if="conversation.once"
          class="phone-conversation-card__trigger-mark phone-conversation-card__trigger-mark--once"
          title="一次性"
          aria-label="一次性"
        />
        <button class="phone-conversation-card__body" type="button" @click="openConversationEditor(conversation)">
          <div class="phone-conversation-card__meta">
            <span class="phone-conversation-card__kind">手机剧情</span>
            <span class="phone-conversation-card__tag">{{ conversation.enabled ? "启用" : "停用" }}</span>
            <span v-if="conversation.lockNormalChat" class="phone-conversation-card__tag">锁定普通聊天</span>
          </div>
          <strong class="phone-conversation-card__title">{{ getConversationTitle(conversation) }}</strong>
          <span class="phone-conversation-card__id">{{ conversation.id || "未填写 ID" }}</span>
          <div class="phone-conversation-card__facts">
            <span class="phone-conversation-card__fact">
              <strong>联系人</strong>
              <span>{{ getRoleLabel(conversation.roleKey) || "未选择" }}</span>
            </span>
            <span class="phone-conversation-card__fact">
              <strong>入口</strong>
              <span>{{ conversation.entryNodeId || "未设置" }}</span>
            </span>
            <span class="phone-conversation-card__fact">
              <strong>触发</strong>
              <span>{{ summarizeTrigger(conversation) }}</span>
            </span>
            <span class="phone-conversation-card__fact">
              <strong>内容</strong>
              <span>{{ summarizeConversationBody(conversation) }}</span>
            </span>
            <span class="phone-conversation-card__fact phone-conversation-card__fact--wide">
              <strong>结束调用</strong>
              <span>{{ summarizeEndingInvoke(conversation) }}</span>
            </span>
          </div>
        </button>

        <div class="phone-conversation-card__footer">
          <span class="phone-conversation-card__status">点击卡片编辑详情</span>
          <div class="phone-conversation-card__actions">
            <button class="btn-danger phone-conversation-card__delete" type="button" @click="handleRemoveConversation(index, conversation)">
              删除
            </button>
            <button class="btn-secondary phone-conversation-card__edit" type="button" @click="openConversationEditor(conversation)">
              编辑
            </button>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="phone-conversations-board__empty">
      <strong class="phone-conversations-board__empty-title">
        {{ draft.conversations.length ? "没有匹配的手机剧情" : "还没有手机剧情" }}
      </strong>
      <p class="phone-conversations-board__empty-copy">
        手机剧情用于强连续的手机对白，可以锁定普通聊天，并在结束后调用后续事件。
      </p>
      <button class="btn-primary" type="button" @click="handleAddConversation">创建手机剧情</button>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="isEditorOpen && activeConversation"
      class="phone-conversations-dialog"
      @click.self="closeConversationEditor"
    >
      <section class="phone-conversations-dialog__panel glass-panel">
        <header class="phone-conversations-dialog__header">
          <div class="phone-conversations-dialog__copy">
            <span class="eyebrow">手机剧情编辑</span>
            <h2 class="phone-conversations-dialog__title">{{ getConversationTitle(activeConversation) }}</h2>
            <p class="phone-conversations-dialog__subtitle">
              单条手机剧情配置。保存后会写回 `phone_conversations.json5`。
            </p>
            <p v-if="localErrorMessage || saveErrorMessage" class="phone-conversations-dialog__error">
              {{ localErrorMessage || saveErrorMessage }}
            </p>
            <p v-if="saveSuccessMessage" class="phone-conversations-dialog__success">{{ saveSuccessMessage }}</p>
          </div>

          <div class="phone-conversations-dialog__actions">
            <button class="btn-secondary phone-conversations-dialog__button" type="button" @click="closeConversationEditor">
              关闭
            </button>
            <button class="btn-primary phone-conversations-dialog__button" type="button" :disabled="saving" @click="submitDraft">
              {{ saving ? "保存中..." : "保存手机剧情" }}
            </button>
          </div>
        </header>

        <div class="phone-conversations-dialog__body">
          <main class="phone-conversations-dialog__editor">
            <section class="phone-conversations-dialog__card">
              <div class="phone-conversations-dialog__section-head">
                <div>
                  <h3 class="phone-conversations-dialog__section-title">基础信息</h3>
                  <p class="phone-conversations-dialog__section-note">
                    脚本通过 <code>phone_start_conversation("{{ activeConversation.id || "conversation_id" }}")</code> 启动。
                  </p>
                </div>
                <span class="phone-conversations-dialog__count">第 {{ activeConversationIndex + 1 }} 条</span>
              </div>

              <div class="phone-conversations-dialog__grid">
                <label class="phone-conversations-dialog__field">
                  <span class="phone-conversations-dialog__label">ID</span>
                  <input v-model="activeConversation.id" class="text-input" type="text" placeholder="debt_collect_phone" />
                </label>
                <label class="phone-conversations-dialog__field">
                  <span class="phone-conversations-dialog__label">标题</span>
                  <input v-model="activeConversation.title" class="text-input" type="text" placeholder="债主催债手机对话" />
                </label>
                <label class="phone-conversations-dialog__field">
                  <span class="phone-conversations-dialog__label">联系人</span>
                  <select v-model="activeConversation.roleKey" class="text-input">
                    <option value="">请选择联系人角色</option>
                    <option v-for="option in roleKeyOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="phone-conversations-dialog__field">
                  <span class="phone-conversations-dialog__label">入口节点</span>
                  <select v-model="activeConversation.entryNodeId" class="text-input">
                    <option v-for="node in activeConversation.nodes" :key="node.draftKey" :value="node.id">
                      {{ node.id || "未填写节点 ID" }}
                    </option>
                  </select>
                </label>
                <label class="phone-conversations-dialog__check">
                  <input v-model="activeConversation.enabled" type="checkbox" />
                  <span>启用</span>
                </label>
                <label class="phone-conversations-dialog__check">
                  <input v-model="activeConversation.once" type="checkbox" />
                  <span>一次性</span>
                </label>
                <label class="phone-conversations-dialog__check">
                  <input v-model="activeConversation.lockNormalChat" type="checkbox" />
                  <span>进行中锁定普通闲聊/动作</span>
                </label>
                <label class="phone-conversations-dialog__field phone-conversations-dialog__field--wide">
                  <span class="phone-conversations-dialog__label">触发条件</span>
                  <StoryScriptTextarea
                    v-model="activeConversation.triggerExpr"
                    min-height="76px"
                    mode="predicate"
                    placeholder="为空表示启动时无需额外条件"
                    :story="story"
                    :vals="vals"
                  />
                </label>
              </div>
            </section>

            <section class="phone-conversations-dialog__card">
              <div class="phone-conversations-dialog__section-head">
                <div>
                  <h3 class="phone-conversations-dialog__section-title">节点列表</h3>
                  <p class="phone-conversations-dialog__section-note">每个节点可以追加 NPC 消息，并提供若干玩家回复选项跳到下个节点。</p>
                </div>
                <button class="btn-secondary phone-conversations-dialog__button" type="button" @click="handleAddNode(activeConversation)">
                  新增节点
                </button>
              </div>

              <div class="phone-conversations-dialog__node-tabs">
                <button
                  v-for="(node, nodeIndex) in activeConversation.nodes"
                  :key="node.draftKey"
                  class="phone-conversations-dialog__node-tab"
                  :class="{ 'phone-conversations-dialog__node-tab--active': activeNode?.draftKey === node.draftKey }"
                  type="button"
                  @click="selectNode(activeConversation, node)"
                >
                  {{ node.id || `节点 ${nodeIndex + 1}` }}
                </button>
              </div>

              <article v-if="activeNode" class="phone-conversations-dialog__node-editor">
                <div class="phone-conversations-dialog__grid">
                  <label class="phone-conversations-dialog__field">
                    <span class="phone-conversations-dialog__label">节点 ID</span>
                    <input v-model="activeNode.id" class="text-input" type="text" placeholder="start" />
                  </label>
                  <label class="phone-conversations-dialog__check">
                    <input v-model="activeNode.end" type="checkbox" @change="handleNodeEndChange(activeNode)" />
                    <span>结束节点</span>
                  </label>
                  <label class="phone-conversations-dialog__check">
                    <input v-model="activeNode.reminder.enabled" type="checkbox" />
                    <span>未回复重复提醒</span>
                  </label>
                  <label class="phone-conversations-dialog__field" :class="{ 'phone-conversations-dialog__field--disabled': !activeNode.reminder.enabled }">
                    <span class="phone-conversations-dialog__label">提醒间隔</span>
                    <select v-model="activeNode.reminder.intervalMinutesText" class="text-input" :disabled="!activeNode.reminder.enabled">
                      <option
                        v-for="option in reminderIntervalOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <div class="phone-conversations-dialog__row-actions">
                    <span class="phone-conversations-dialog__count">节点 {{ activeNodeIndex + 1 }} / {{ activeConversation.nodes.length }}</span>
                    <button class="btn-secondary phone-conversations-dialog__button" type="button" @click="handleRemoveNode(activeConversation, activeNodeIndex)">
                      删除节点
                    </button>
                  </div>
                  <p class="phone-conversations-dialog__hint phone-conversations-dialog__field--wide">
                    开启后，如果玩家停留在当前节点没有回复，系统会按间隔重复发送该节点最后一条 NPC 消息。
                  </p>
                </div>

                <div class="phone-conversations-dialog__subsection">
                  <div class="phone-conversations-dialog__section-head phone-conversations-dialog__section-head--nested">
                    <h4 class="phone-conversations-dialog__section-title phone-conversations-dialog__section-title--small">NPC 消息</h4>
                    <button class="btn-secondary phone-conversations-dialog__button" type="button" @click="addMessage(activeNode)">
                      新增消息
                    </button>
                  </div>
                  <div v-if="activeNode.contactMessages.length" class="phone-conversations-dialog__stack">
                    <div
                      v-for="(message, messageIndex) in activeNode.contactMessages"
                      :key="message.draftKey"
                      class="phone-conversations-dialog__line-card"
                    >
                      <StoryScriptTextarea
                        v-model="message.content"
                        min-height="72px"
                        mode="template"
                        placeholder="NPC 发来的消息文本，可以使用 ${player.xxx} / ${term.xxx}"
                        :story="story"
                        :vals="vals"
                      />
                      <button class="btn-secondary phone-conversations-dialog__mini-button" type="button" @click="removeMessage(activeNode, messageIndex)">
                        删除
                      </button>
                    </div>
                  </div>
                  <p v-else class="phone-conversations-dialog__empty phone-conversations-dialog__empty--compact">
                    这个节点没有 NPC 消息，进入节点时不会追加来信。
                  </p>
                </div>

                <div class="phone-conversations-dialog__subsection">
                  <div class="phone-conversations-dialog__section-head phone-conversations-dialog__section-head--nested">
                    <h4 class="phone-conversations-dialog__section-title phone-conversations-dialog__section-title--small">玩家回复选项</h4>
                    <button class="btn-secondary phone-conversations-dialog__button" type="button" @click="addOption(activeNode)">
                      新增回复
                    </button>
                  </div>

                  <div v-if="activeNode.playerOptions.length" class="phone-conversations-dialog__stack">
                    <article
                      v-for="(option, optionIndex) in activeNode.playerOptions"
                      :key="option.draftKey"
                      class="phone-conversations-dialog__nested-card"
                    >
                      <div class="phone-conversations-dialog__grid">
                        <label class="phone-conversations-dialog__field">
                          <span class="phone-conversations-dialog__label">选项 ID</span>
                          <input v-model="option.id" class="text-input" type="text" placeholder="reply_ok" />
                        </label>
                        <label class="phone-conversations-dialog__field">
                          <span class="phone-conversations-dialog__label">下一节点</span>
                          <select v-model="option.nextNodeId" class="text-input">
                            <option value="">结束当前节点</option>
                            <option v-for="node in activeConversation.nodes" :key="node.draftKey" :value="node.id">
                              {{ node.id || "未填写节点 ID" }}
                            </option>
                          </select>
                        </label>
                        <div class="phone-conversations-dialog__row-actions">
                          <button class="btn-secondary phone-conversations-dialog__button" type="button" @click="removeOption(activeNode, optionIndex)">
                            删除回复
                          </button>
                        </div>
                        <label class="phone-conversations-dialog__field phone-conversations-dialog__field--wide">
                          <span class="phone-conversations-dialog__label">玩家回复文本</span>
                          <StoryScriptTextarea
                            v-model="option.text"
                            min-height="70px"
                            mode="template"
                            placeholder="我在汽车站等你。"
                            :story="story"
                            :vals="vals"
                          />
                        </label>
                        <label class="phone-conversations-dialog__field phone-conversations-dialog__field--wide">
                          <span class="phone-conversations-dialog__label">显示条件</span>
                          <StoryScriptTextarea
                            v-model="option.visibleExpr"
                            min-height="70px"
                            mode="predicate"
                            placeholder="为空表示总是显示"
                            :story="story"
                            :vals="vals"
                          />
                        </label>
                        <label class="phone-conversations-dialog__field phone-conversations-dialog__field--wide">
                          <span class="phone-conversations-dialog__label">回复后脚本</span>
                          <StoryScriptTextarea
                            v-model="option.script"
                            highlight
                            min-height="108px"
                            mode="procedure"
                            placeholder="// 玩家选择该回复后执行"
                            :story="story"
                            :vals="vals"
                          />
                        </label>
                      </div>
                    </article>
                  </div>
                  <p v-else class="phone-conversations-dialog__empty phone-conversations-dialog__empty--compact">
                    这个节点还没有玩家回复选项。
                  </p>
                </div>

                <div class="phone-conversations-dialog__subsection">
                  <h4 class="phone-conversations-dialog__section-title phone-conversations-dialog__section-title--small">结束处理</h4>
                  <div class="phone-conversations-dialog__grid">
                    <label class="phone-conversations-dialog__field phone-conversations-dialog__field--wide">
                      <span class="phone-conversations-dialog__label">结束脚本</span>
                      <StoryScriptTextarea
                        v-model="activeNode.endScript"
                        highlight
                        min-height="108px"
                        mode="procedure"
                        placeholder="// 进入结束节点时执行"
                        :story="story"
                        :vals="vals"
                      />
                    </label>
                    <label v-if="activeNode.end" class="phone-conversations-dialog__check">
                      <input v-model="activeNode.invoke.enabled" type="checkbox" />
                      <span>结束后调用事件</span>
                    </label>
                    <p v-else class="phone-conversations-dialog__hint phone-conversations-dialog__field--wide">
                      只有勾选“结束节点”后，才能配置结束后调用事件。
                    </p>
                    <template v-if="activeNode.end && activeNode.invoke.enabled">
                      <label class="phone-conversations-dialog__field">
                        <span class="phone-conversations-dialog__label">事件集合</span>
                        <select v-model="activeNode.invoke.targetType" class="text-input">
                          <option value="chain">{{ invokeTargetLabels.chain }}</option>
                          <option value="pool">{{ invokeTargetLabels.pool }}</option>
                          <option value="schedule">{{ invokeTargetLabels.schedule }}</option>
                        </select>
                      </label>
                      <label class="phone-conversations-dialog__field">
                        <span class="phone-conversations-dialog__label">被调用事件</span>
                        <select v-model="activeNode.invoke.eventId" class="text-input">
                          <option value="">请选择 trigger_mode=invoke 的事件</option>
                          <option
                            v-for="option in getInvokeOptions(activeNode.invoke.targetType)"
                            :key="`${option.targetType}:${option.eventId}`"
                            :value="option.eventId"
                          >
                            {{ option.label }}
                          </option>
                        </select>
                      </label>
                      <label class="phone-conversations-dialog__check">
                        <input v-model="activeNode.invoke.delayEnabled" type="checkbox" />
                        <span>延迟调用</span>
                      </label>
                      <template v-if="activeNode.invoke.delayEnabled">
                        <label class="phone-conversations-dialog__field">
                          <span class="phone-conversations-dialog__label">延迟单位</span>
                          <select v-model="activeNode.invoke.delayUnit" class="text-input">
                            <option value="hours">小时</option>
                            <option value="days">天</option>
                            <option value="months">月</option>
                            <option value="years">年</option>
                          </select>
                        </label>
                        <label class="phone-conversations-dialog__field">
                          <span class="phone-conversations-dialog__label">延迟数值</span>
                          <input v-model="activeNode.invoke.delayValueText" class="text-input" type="number" min="1" step="1" />
                        </label>
                      </template>
                    </template>
                  </div>
                </div>
              </article>
            </section>
          </main>
        </div>

        <footer class="phone-conversations-dialog__footer">
          <button class="btn-secondary phone-conversations-dialog__button" type="button" @click="closeConversationEditor">
            关闭
          </button>
          <button class="btn-primary phone-conversations-dialog__button" type="button" :disabled="saving" @click="submitDraft">
            {{ saving ? "保存中..." : "保存手机剧情" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./styles/StoryPhoneConversationsDialog.css"></style>
