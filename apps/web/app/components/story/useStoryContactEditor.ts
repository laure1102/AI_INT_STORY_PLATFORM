/**
 * 联系人配置编辑器的共享响应式状态。
 *
 * 输入来自父弹窗的故事、角色和联系人配置；输出给展示子组件。
 * 它只维护尚未保存的草稿，不直接发送 HTTP 请求。
 */
import { computed, reactive, shallowRef, watch } from "vue"
import type {
  StoryDocument,
  StoryContactTrackId,
  StoryContactFile,
  StoryRolesFile,
  StoryValsFile
} from "@story-mgr/core"
import { useStoryContactDraft } from "./useStoryContactDraft"

type ContactTab =
  | "channels"
  | "tracks"
  | "personalities"
  | "talks"
  | "actions"
  | "replies"
  | "contacts"
  | "quickMessages"
  | "fallbackReplies"
export type InvokeTargetType = "chain" | "pool" | "schedule"

interface InvokeEventOption {
  eventId: string
  label: string
  targetType: InvokeTargetType
}

export interface StoryContactEditorProps {
  itemIds: string[]
  invokeEventOptions: InvokeEventOption[]
  contact: StoryContactFile
  roles: StoryRolesFile
  saveSuccessMessage?: string | null
  saving: boolean
  story: StoryDocument
  vals: StoryValsFile
}

export interface StoryContactEditorEmits {
  close: []
  save: [contact: StoryContactFile]
}

export type StoryContactEditorEmit = <EventName extends keyof StoryContactEditorEmits>(
  event: EventName,
  ...args: StoryContactEditorEmits[EventName]
) => void

/** 组合 `StoryContactEditor` 的响应式状态、派生值和操作方法。 @param props 调用方传入的 `props`。 @param emit 调用方传入的 `emit`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useStoryContactEditor(
  props: Readonly<StoryContactEditorProps>,
  emit: StoryContactEditorEmit
) {
  const activeTab = shallowRef<ContactTab>("channels")
const sectionSearch = reactive<Record<ContactTab, string>>({
  actions: "",
  channels: "",
  contacts: "",
  fallbackReplies: "",
  personalities: "",
  quickMessages: "",
  replies: "",
  talks: "",
  tracks: ""
})

const tabOptions: Array<{ key: ContactTab; label: string }> = [
  { key: "channels", label: "联系媒介" },
  { key: "tracks", label: "关系规则" },
  { key: "personalities", label: "性格库" },
  { key: "talks", label: "闲聊短句" },
  { key: "actions", label: "动作库" },
  { key: "replies", label: "回复库" },
  { key: "contacts", label: "联系人特配" },
  { key: "quickMessages", label: "玩家快捷消息" },
  { key: "fallbackReplies", label: "兜底回复" }
]

const contactTrackOptions: Array<{ value: StoryContactTrackId; label: string }> = [
  { value: "romance", label: "恋爱" },
  { value: "official", label: "政务" },
  { value: "social", label: "社交" }
]

const {
  addAction,
  addChannel,
  addContactProfile,
  addContactReply,
  addFallbackReply,
  addPersonality,
  addProactiveMessage,
  addQuickMessage,
  addReply,
  addTalk,
  addTrack,
  addTrackStage,
  buildContactFile,
  draft,
  removeAction,
  removeChannel,
  removeContactProfile,
  removeContactReply,
  removeFallbackReply,
  removePersonality,
  removeProactiveMessage,
  removeQuickMessage,
  renameChannel,
  removeReply,
  removeTalk,
  removeTrack,
  removeTrackStage,
  syncFromContact
} = useStoryContactDraft(props.contact)

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

const channelOptions = computed(() => draft.channels
  .map((channel) => ({
    label: `${channel.name.trim() || channel.id.trim() || "未命名媒介"} · ${channel.id.trim()}`,
    value: channel.id.trim()
  }))
  .filter((option) => option.value)
)

const roleLabelByKey = computed(() =>
  Object.fromEntries(roleKeyOptions.value.map((option) => [option.value, option.label]))
)

const personalityIdOptions = computed(() =>
  draft.personalities
    .map((personality) => ({
      label: personality.name.trim() || personality.id.trim() || "未命名性格",
      value: personality.id.trim()
    }))
    .filter((option) => option.value)
)

const quickMessageIdOptions = computed(() =>
  draft.quickMessages
    .map((message) => ({
      label: `${message.id.trim() || "未命名快捷消息"} · ${message.text.trim() || "未填写文本"}`,
      value: message.id.trim()
    }))
    .filter((option) => option.value)
)

const canAddTrack = computed(() => draft.tracks.length < contactTrackOptions.length)

const invokeTargetLabels: Record<InvokeTargetType, string> = {
  chain: "链式剧情线",
  pool: "平面事件池",
  schedule: "定时规则事件"
}

/** 将 `SearchText` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
}

/** 判断 `matchesSearch` 对应的条件是否成立。 @param searchText 调用方传入的 `searchText`。 @param fields 调用方传入的 `fields`。 @returns 布尔判断结果。 */
function matchesSearch(searchText: string, fields: unknown[]) {
  const normalizedSearchText = normalizeSearchText(searchText)
  if (!normalizedSearchText) {
    return true
  }

  return fields.some((field) => normalizeSearchText(field).includes(normalizedSearchText))
}

/** 执行 `appendCsvToken` 对应的局部业务逻辑。 @param currentText 调用方传入的 `currentText`。 @param token 调用方传入的 `token`。 @returns 计算、查找或构建后的结果。 */
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

/** 执行 `appendRoleKeyToScope` 对应的局部业务逻辑。 @param scope 调用方传入的 `scope`。 @param roleKey 调用方传入的 `roleKey`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function appendRoleKeyToScope(scope: { roleKeysText: string }, roleKey: string) {
  scope.roleKeysText = appendCsvToken(scope.roleKeysText, roleKey)
}

/** 读取或计算 `RoleLabel`。 @param roleKey 调用方传入的 `roleKey`。 @returns 计算、查找或构建后的结果。 */
function getRoleLabel(roleKey: string) {
  return roleLabelByKey.value[roleKey] ?? roleKey
}

/** 新增一项 `ContactProfileFromRole` 草稿。 @param roleKey 调用方传入的 `roleKey`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addContactProfileFromRole(roleKey: string) {
  addContactProfile(roleKey)
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

const filteredContactProfiles = computed(() =>
  draft.contactProfiles
    .map((profile, index) => ({ index, profile }))
    .filter(({ profile }) =>
      matchesSearch(sectionSearch.contacts, [
        profile.roleKey,
        getRoleLabel(profile.roleKey),
        profile.preferredTagsText,
        ...profile.proactiveMessages.flatMap((rule) => [
          rule.id,
          rule.triggerExpr,
          rule.messagesText,
          rule.replyQuickMessageIds.join(", ")
        ]),
        ...profile.replyByTag.flatMap((entry) => [entry.tag, entry.repliesText])
      ])
    )
)

const filteredQuickMessages = computed(() =>
  draft.quickMessages
    .map((message, index) => ({ index, message }))
    .filter(({ message }) =>
      matchesSearch(sectionSearch.quickMessages, [
        message.id,
        message.text,
        message.tagsText,
        message.availableRoleKeysText
      ])
    )
)

const filteredFallbackReplies = computed(() =>
  draft.fallbackReplies
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      matchesSearch(sectionSearch.fallbackReplies, [
        entry.tag,
        entry.repliesText
      ])
    )
)

/** 读取或计算 `InvokeOptions`。 @param targetType 调用方传入的 `targetType`。 @returns 计算、查找或构建后的结果。 */
function getInvokeOptions(targetType: InvokeTargetType) {
  return props.invokeEventOptions.filter((option) => option.targetType === targetType)
}

/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function submitDraft() {
  emit("save", buildContactFile())
}

watch(
  () => props.contact,
  (contact) => {
    syncFromContact(contact)
  }
)

  return reactive({
    activeTab,
    sectionSearch,
    tabOptions,
    contactTrackOptions,
    addAction,
    addChannel,
    addContactProfile,
    addContactReply,
    addFallbackReply,
    addPersonality,
    addProactiveMessage,
    addQuickMessage,
    addReply,
    addTalk,
    addTrack,
    addTrackStage,
    draft,
    removeAction,
    removeChannel,
    removeContactProfile,
    removeContactReply,
    removeFallbackReply,
    removePersonality,
    removeProactiveMessage,
    removeQuickMessage,
    renameChannel,
    removeReply,
    removeTalk,
    removeTrack,
    removeTrackStage,
    roleKeyOptions,
    channelOptions,
    personalityIdOptions,
    quickMessageIdOptions,
    canAddTrack,
    invokeTargetLabels,
    appendRoleKeyToScope,
    getRoleLabel,
    addContactProfileFromRole,
    filteredTracks,
    filteredPersonalities,
    filteredTalks,
    filteredActions,
    filteredReplies,
    filteredContactProfiles,
    filteredQuickMessages,
    filteredFallbackReplies,
    getInvokeOptions,
    submitDraft,
  })
}

/** 两个展示子组件共用的、已自动解包的编辑器控制器。 */
export type StoryContactEditorController = ReturnType<typeof useStoryContactEditor>
