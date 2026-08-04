import { reactive } from "vue"
import type {
  StoryPhoneConversationDefinition,
  StoryPhoneConversationMessage,
  StoryPhoneConversationNode,
  StoryPhoneConversationOption,
  StoryPhoneConversationReminder,
  StoryPhoneConversationsFile,
  StoryPhoneEventInvocation
} from "@story-mgr/core"

type InvokeTargetType = "chain" | "pool" | "schedule"
type DelayUnit = "hours" | "days" | "months" | "years"

interface PhoneConversationInvokeDraft {
  delayEnabled: boolean
  delayUnit: DelayUnit
  delayValueText: string
  enabled: boolean
  eventId: string
  targetType: InvokeTargetType
}

export interface PhoneConversationMessageDraft {
  content: string
  draftKey: string
}

export interface PhoneConversationOptionDraft {
  draftKey: string
  id: string
  nextNodeId: string
  script: string
  text: string
  visibleExpr: string
}

export interface PhoneConversationNodeDraft {
  contactMessages: PhoneConversationMessageDraft[]
  draftKey: string
  end: boolean
  endScript: string
  id: string
  invoke: PhoneConversationInvokeDraft
  playerOptions: PhoneConversationOptionDraft[]
  reminder: {
    enabled: boolean
    intervalMinutesText: string
  }
}

export interface PhoneConversationDraft {
  draftKey: string
  enabled: boolean
  entryNodeId: string
  id: string
  lockNormalChat: boolean
  nodes: PhoneConversationNodeDraft[]
  once: boolean
  roleKey: string
  title: string
  triggerExpr: string
}

interface PhoneConversationsDraftState {
  conversations: PhoneConversationDraft[]
}

let draftKeySeed = 0

/** 创建一份新的 `DraftKey` 数据。 @param prefix 调用方传入的 `prefix`。 @returns 计算、查找或构建后的结果。 */
function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

/** 解析 `IntegerText` 输入，并为非法值提供安全结果。 @param value 调用方传入的 `value`。 @param fallback 调用方传入的 `fallback`。 @returns 计算、查找或构建后的结果。 */
function parseIntegerText(value: unknown, fallback: number) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : fallback
  }

  if (typeof value !== "string") {
    return fallback
  }

  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 创建一份新的 `InvokeDraft` 数据。 @param invoke 调用方传入的 `invoke`。 @returns 计算、查找或构建后的结果。 */
function createInvokeDraft(invoke?: Partial<StoryPhoneEventInvocation>): PhoneConversationInvokeDraft {
  return {
    delayEnabled: Boolean(invoke?.delay),
    delayUnit: invoke?.delay?.unit ?? "hours",
    delayValueText: invoke?.delay ? String(invoke.delay.value) : "1",
    enabled: Boolean(invoke),
    eventId: invoke?.event_id?.trim() ?? "",
    targetType: invoke?.target_type ?? "chain"
  }
}

/** 根据当前输入构建 `InvokePayload` 结果。 @param invoke 调用方传入的 `invoke`。 @returns 计算、查找或构建后的结果。 */
function buildInvokePayload(invoke: PhoneConversationInvokeDraft): StoryPhoneEventInvocation | undefined {
  if (!invoke.enabled || !invoke.eventId.trim()) {
    return undefined
  }

  const payload: StoryPhoneEventInvocation = {
    event_id: invoke.eventId.trim(),
    target_type: invoke.targetType
  }

  if (invoke.delayEnabled) {
    payload.delay = {
      unit: invoke.delayUnit,
      value: Math.max(1, parseIntegerText(invoke.delayValueText, 1))
    }
  }

  return payload
}

/** 创建一份新的 `MessageDraft` 数据。 @param message 调用方传入的 `message`。 @returns 计算、查找或构建后的结果。 */
function createMessageDraft(message?: Partial<StoryPhoneConversationMessage>): PhoneConversationMessageDraft {
  return {
    content: message?.content?.trim() ?? "",
    draftKey: createDraftKey("phone-conversation-message")
  }
}

/** 创建一份新的 `OptionDraft` 数据。 @param option 调用方传入的 `option`。 @returns 计算、查找或构建后的结果。 */
function createOptionDraft(option?: Partial<StoryPhoneConversationOption>): PhoneConversationOptionDraft {
  return {
    draftKey: createDraftKey("phone-conversation-option"),
    id: option?.id?.trim() ?? "",
    nextNodeId: option?.next_node_id?.trim() ?? "",
    script: option?.script ?? "",
    text: option?.text?.trim() ?? "",
    visibleExpr: option?.visible_expr?.trim() ?? ""
  }
}

/** 创建一份新的 `ReminderDraft` 数据。 @param reminder 调用方传入的 `reminder`。 @returns 计算、查找或构建后的结果。 */
function createReminderDraft(reminder?: Partial<StoryPhoneConversationReminder>) {
  return {
    enabled: reminder?.enabled ?? false,
    intervalMinutesText: String(Math.max(1, parseIntegerText(String(reminder?.interval_minutes ?? "60"), 60)))
  }
}

/** 创建一份新的 `NodeDraft` 数据。 @param node 调用方传入的 `node`。 @returns 计算、查找或构建后的结果。 */
function createNodeDraft(node?: Partial<StoryPhoneConversationNode>): PhoneConversationNodeDraft {
  return {
    contactMessages: (node?.contact_messages ?? []).map((message) => createMessageDraft(message)),
    draftKey: createDraftKey("phone-conversation-node"),
    end: node?.end ?? false,
    endScript: node?.end_script ?? "",
    id: node?.id?.trim() ?? "",
    invoke: createInvokeDraft(node?.invoke),
    playerOptions: (node?.player_options ?? []).map((option) => createOptionDraft(option)),
    reminder: createReminderDraft(node?.reminder)
  }
}

/** 创建一份新的 `ConversationDraft` 数据。 @param conversation 调用方传入的 `conversation`。 @returns 计算、查找或构建后的结果。 */
function createConversationDraft(
  conversation?: Partial<StoryPhoneConversationDefinition>
): PhoneConversationDraft {
  const nodes = (conversation?.nodes ?? []).map((node) => createNodeDraft(node))
  const fallbackEntryNodeId = nodes[0]?.id ?? "start"
  const draft: PhoneConversationDraft = {
    draftKey: createDraftKey("phone-conversation"),
    enabled: conversation?.enabled ?? true,
    entryNodeId: conversation?.entry_node_id?.trim() ?? fallbackEntryNodeId,
    id: conversation?.id?.trim() ?? "",
    lockNormalChat: conversation?.lock_normal_chat ?? true,
    nodes,
    once: conversation?.once ?? true,
    roleKey: conversation?.role_key?.trim() ?? "",
    title: conversation?.title?.trim() ?? "",
    triggerExpr: conversation?.trigger_expr?.trim() ?? ""
  }

  if (draft.nodes.length === 0) {
    draft.nodes.push(createNodeDraft({ id: "start" }))
    draft.entryNodeId = "start"
  }

  return draft
}

/** 根据当前输入构建 `MessagePayload` 结果。 @param message 调用方传入的 `message`。 @returns 计算、查找或构建后的结果。 */
function buildMessagePayload(message: PhoneConversationMessageDraft): StoryPhoneConversationMessage {
  return {
    content: message.content.trim()
  }
}

/** 根据当前输入构建 `OptionPayload` 结果。 @param option 调用方传入的 `option`。 @returns 计算、查找或构建后的结果。 */
function buildOptionPayload(option: PhoneConversationOptionDraft): StoryPhoneConversationOption {
  return {
    id: option.id.trim(),
    next_node_id: option.nextNodeId.trim(),
    script: option.script,
    text: option.text.trim(),
    visible_expr: option.visibleExpr.trim()
  }
}

/** 根据当前输入构建 `NodePayload` 结果。 @param node 调用方传入的 `node`。 @returns 计算、查找或构建后的结果。 */
function buildNodePayload(node: PhoneConversationNodeDraft): StoryPhoneConversationNode {
  const invoke = buildInvokePayload(node.invoke)
  return {
    contact_messages: node.contactMessages.map((message) => buildMessagePayload(message)),
    end: node.end,
    end_script: node.endScript,
    id: node.id.trim(),
    ...(invoke ? { invoke } : {}),
    reminder: {
      enabled: node.reminder.enabled,
      interval_minutes: Math.max(1, parseIntegerText(node.reminder.intervalMinutesText, 60))
    },
    player_options: node.playerOptions.map((option) => buildOptionPayload(option))
  }
}

/** 根据当前输入构建 `ConversationPayload` 结果。 @param conversation 调用方传入的 `conversation`。 @returns 计算、查找或构建后的结果。 */
function buildConversationPayload(conversation: PhoneConversationDraft): StoryPhoneConversationDefinition {
  return {
    enabled: conversation.enabled,
    entry_node_id: conversation.entryNodeId.trim(),
    id: conversation.id.trim(),
    lock_normal_chat: conversation.lockNormalChat,
    nodes: conversation.nodes.map((node) => buildNodePayload(node)),
    once: conversation.once,
    role_key: conversation.roleKey.trim(),
    title: conversation.title.trim(),
    trigger_expr: conversation.triggerExpr.trim()
  }
}

/** 创建一份新的 `EmptyDraftState` 数据。 @returns 计算、查找或构建后的结果。 */
function createEmptyDraftState(): PhoneConversationsDraftState {
  return {
    conversations: []
  }
}

/** 组合 `StoryPhoneConversationsDraft` 的响应式状态、派生值和操作方法。 @param source 调用方传入的 `source`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useStoryPhoneConversationsDraft(source: StoryPhoneConversationsFile) {
  const draft = reactive(createEmptyDraftState())

  /** 把外部或服务端数据同步到本地响应式状态。 @param phoneConversations 调用方传入的 `phoneConversations`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function syncFromPhoneConversations(phoneConversations: StoryPhoneConversationsFile) {
    draft.conversations = (phoneConversations.conversations ?? []).map((conversation) =>
      createConversationDraft(conversation)
    )
  }

  /** 根据当前输入构建 `PhoneConversationsFile` 结果。 @returns 计算、查找或构建后的结果。 */
  function buildPhoneConversationsFile(): StoryPhoneConversationsFile {
    return {
      conversations: draft.conversations.map((conversation) => buildConversationPayload(conversation))
    }
  }

  /** 新增一项 `Conversation` 草稿。 @param roleKey 调用方传入的 `roleKey`。 @returns 计算、查找或构建后的结果。 */
  function addConversation(roleKey = "") {
    const conversation = createConversationDraft({
      enabled: true,
      entry_node_id: "start",
      id: "",
      lock_normal_chat: true,
      once: true,
      role_key: roleKey,
      title: "",
      trigger_expr: "",
      nodes: [{
        contact_messages: [],
        end: false,
        end_script: "",
        id: "start",
        player_options: [],
        reminder: {
          enabled: false,
          interval_minutes: 60
        }
      }]
    })
    draft.conversations.push(conversation)
    return conversation
  }

  /** 移除指定的 `Conversation` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeConversation(index: number) {
    draft.conversations.splice(index, 1)
  }

  /** 新增一项 `Node` 草稿。 @param conversation 调用方传入的 `conversation`。 @returns 计算、查找或构建后的结果。 */
  function addNode(conversation: PhoneConversationDraft) {
    const node = createNodeDraft({
      id: `node_${conversation.nodes.length + 1}`
    })
    conversation.nodes.push(node)
    if (!conversation.entryNodeId) {
      conversation.entryNodeId = node.id
    }
    return node
  }

  /** 移除指定的 `Node` 数据。 @param conversation 调用方传入的 `conversation`。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeNode(conversation: PhoneConversationDraft, index: number) {
    const removedNodeId = conversation.nodes[index]?.id ?? ""
    conversation.nodes.splice(index, 1)
    for (const node of conversation.nodes) {
      for (const option of node.playerOptions) {
        if (option.nextNodeId === removedNodeId) {
          option.nextNodeId = ""
        }
      }
    }

    if (conversation.entryNodeId === removedNodeId) {
      conversation.entryNodeId = conversation.nodes[0]?.id ?? ""
    }
  }

  /** 新增一项 `Message` 草稿。 @param node 调用方传入的 `node`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addMessage(node: PhoneConversationNodeDraft) {
    node.contactMessages.push(createMessageDraft())
  }

  /** 移除指定的 `Message` 数据。 @param node 调用方传入的 `node`。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeMessage(node: PhoneConversationNodeDraft, index: number) {
    node.contactMessages.splice(index, 1)
  }

  /** 新增一项 `Option` 草稿。 @param node 调用方传入的 `node`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function addOption(node: PhoneConversationNodeDraft) {
    node.playerOptions.push(createOptionDraft())
  }

  /** 移除指定的 `Option` 数据。 @param node 调用方传入的 `node`。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function removeOption(node: PhoneConversationNodeDraft, index: number) {
    node.playerOptions.splice(index, 1)
  }

  syncFromPhoneConversations(source)

  return {
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
  }
}
