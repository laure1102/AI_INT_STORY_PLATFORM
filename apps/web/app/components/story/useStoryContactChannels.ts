import type { ContactChannelDraft, ContactDraftState } from "./useStoryContactDraft"

/** 创建联系媒介的增删改操作，并同步默认媒介和联系人覆盖引用。 */
export function createStoryContactChannelActions(
  draft: ContactDraftState,
  createDraftKey: (prefix: string) => string
) {
  /** 新增一个 id 唯一的通用联系媒介。 */
  function addChannel() {
    const usedIds = new Set(draft.channels.map((channel) => channel.id))
    let sequence = draft.channels.length + 1
    let id = `channel-${sequence}`
    while (usedIds.has(id)) {
      sequence += 1
      id = `channel-${sequence}`
    }

    draft.channels.push({
      draftKey: createDraftKey("channel"),
      id,
      labels: { message: "", conversation: "", talk: "", action: "", gift: "", send: "", reply: "" },
      name: "新媒介",
      preset: "generic"
    })
    if (!draft.defaultChannelId) {
      draft.defaultChannelId = id
    }
  }

  /** 删除非默认媒介，并清空使用该媒介的联系人覆盖。 */
  function removeChannel(index: number) {
    const channel = draft.channels[index]
    if (!channel || channel.id === draft.defaultChannelId) {
      return
    }

    draft.channels.splice(index, 1)
    for (const profile of draft.contactProfiles) {
      if (profile.channelId === channel.id) {
        profile.channelId = ""
      }
    }
  }

  /** 重命名媒介，并同步默认媒介和联系人覆盖。 */
  function renameChannel(channel: ContactChannelDraft, nextId: string) {
    const previousId = channel.id
    channel.id = nextId
    if (draft.defaultChannelId === previousId) {
      draft.defaultChannelId = nextId
    }
    for (const profile of draft.contactProfiles) {
      if (profile.channelId === previousId) {
        profile.channelId = nextId
      }
    }
  }

  return { addChannel, removeChannel, renameChannel }
}
