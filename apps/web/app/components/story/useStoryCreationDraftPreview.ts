/**
 * 为 AI 草稿预览提供纯格式化、输入转换和“应用影响”说明。
 *
 * 输入是父级只读故事 props，以及 `useStoryCreationState` 中唯一的 editableDraft/索引。输出给预览
 * 子组件显示“新建、更新、跳过”、可读摘要和字段 setter。setter 只修改内存草稿，既不 emit apply，
 * 也不请求 API；用户最后勾选并确认时，父级才把草稿和 selection 交给服务端事务应用。
 */
import type {
  StoryCreationDraftDoing,
  StoryCreationDraftEvent,
  StoryCreationDraftContact,
  StoryCreationDraftContactConversations,
  StoryCreationDraftItem,
  StoryCreationDraftLoopRule,
  StoryCreationDraftRole,
  StoryCreationDraftShop,
  StoryCreationDraftVariable
} from "@story-mgr/shared"
import type { StoryCreationWorkspaceProps } from "./useStoryCreationWorkspace"
import type { StoryCreationStateController } from "./useStoryCreationState"

type DraftImpactKind = "create" | "update" | "skip"

interface DraftImpact {
  kind: DraftImpactKind
  label: string
  detail: string
}

/**
 * 在共享创作 State 上增加预览层工具。
 *
 * props 只用于读取当前故事的显示名称；是否可引用则使用 State 已计算好的可用 Set，保持规则一致。
 */
export function useStoryCreationDraftPreview(
  props: Readonly<StoryCreationWorkspaceProps>,
  state: StoryCreationStateController
) {
  const {
    availableChainIdsForApply, availableDoingMenuIdsForApply,
    availableItemIdsForApply, availableLocationIdsForApply,
    availableRoleKeysForApply, availableShopCategoryIdsForApply,
    draftPreview, editableDraft, existingDoingIds, existingDoingMenuIds,
    existingEventKeys, existingItemCategoryIds, existingItemIds,
    existingLocationIds, existingContactActionIds, existingContactProfileKeys,
    existingContactChannelIds, existingContactConversationIds, existingContactPersonalityIds, existingContactReplyIds,
    existingContactTalkIds, existingRoleKeys, existingShopCategoryIds,
    existingShopProductIds, existingVariableKeys, getEventKey, getRoleKey,
    getVariableKey, selectedDraftChainIds
  } = state

/** 把普通变量值或 calc 规则转换成列表中的短文本，不改变变量。 */
function variableValueLabel(variable: StoryCreationDraftVariable) {
  if (variable.value_type === "calc") {
    return variable.calc_rule || "calc"
  }

  if (variable.value === null || typeof variable.value === "undefined") {
    return "空值"
  }

  return String(variable.value)
}

/**
 * 将文本输入还原成草稿变量值。
 *
 * 空文本变 null，精确 true/false 变布尔值，合法数字变 number，其余保留字符串。calc 的真实值来自
 * 公式，禁止在普通值输入框覆盖。
 */
function setVariableValueFromInput(variable: StoryCreationDraftVariable, rawValue: string) {
  if (variable.value_type === "calc") {
    return
  }

  if (rawValue === "") {
    variable.value = null
    return
  }

  if (rawValue === "true") {
    variable.value = true
    return
  }

  if (rawValue === "false") {
    variable.value = false
    return
  }

  const numericValue = Number(rawValue)
  variable.value = Number.isFinite(numericValue) && rawValue.trim() !== "" ? numericValue : rawValue
}

/** 创建统一影响提示；kind 决定颜色，label/detail 负责向用户解释原因。 */
function createImpact(kind: DraftImpactKind, label: string, detail: string): DraftImpact {
  return {
    kind,
    label,
    detail
  }
}

// 各领域 impact 只做“预演说明”，不会替代服务端校验：
// - create：当前故事没有同 key 内容，预计新增；
// - update：同 key 已存在，预计按领域合并/覆盖；
// - skip：引用在“现有 + 本批已选”集合中不可用，服务端预计过滤或跳过。
/** 读取或计算 `LocationImpact`。 @param location 调用方传入的 `location`。 @returns 计算、查找或构建后的结果。 */
function getLocationImpact(location: { id: string }): DraftImpact {
  return existingLocationIds.value.has(location.id)
    ? createImpact("update", "覆盖", "同 id 地点已存在，应用后会更新说明和提示词，并保留已有图片。")
    : createImpact("create", "新增", "应用后会新增地点。")
}

/** 读取或计算 `RoleImpact`。 @param role 调用方传入的 `role`。 @returns 计算、查找或构建后的结果。 */
function getRoleImpact(role: StoryCreationDraftRole): DraftImpact {
  return existingRoleKeys.value.has(getRoleKey(role))
    ? createImpact("update", "覆盖", "同 key 角色已存在，应用后会更新文字设定，并保留已有图片。")
    : createImpact("create", "新增", "应用后会新增角色。")
}

/** 读取或计算 `ItemImpact`。 @param item 调用方传入的 `item`。 @returns 计算、查找或构建后的结果。 */
function getItemImpact(item: StoryCreationDraftItem): DraftImpact {
  if (!existingItemCategoryIds.value.has(item.category_id)) {
    return createImpact("skip", "跳过", "物品分类不存在，应用时不会写入。")
  }

  return existingItemIds.value.has(item.id)
    ? createImpact("update", "覆盖", "同 id 物品已存在，应用后会更新文字设定，并保留已有图片。")
    : createImpact("create", "新增", "应用后会写入 items.json5。")
}

/** 读取或计算 `VariableImpact`。 @param variable 调用方传入的 `variable`。 @returns 计算、查找或构建后的结果。 */
function getVariableImpact(variable: StoryCreationDraftVariable): DraftImpact {
  const key = getVariableKey(variable)

  if (variable.group === "system") {
    return createImpact("skip", "跳过", "system 变量由运行时管理，不会自动写入。")
  }

  return existingVariableKeys.value.has(key)
    ? createImpact("skip", "已存在", "同名变量已存在，应用时不会覆盖原值。")
    : createImpact("create", "新增", "应用后会写入 vals.json5。")
}

/** 读取或计算 `EventImpact`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function getEventImpact(event: StoryCreationDraftEvent): DraftImpact {
  return existingEventKeys.value.has(getEventKey(event))
    ? createImpact("update", "覆盖", "同集合同 id 事件已存在，应用后会替换事件内容。")
    : createImpact("create", "新增", "应用后会新增事件。")
}

/** 读取或计算 `ContactPersonalityImpact`。 @param personality 调用方传入的 `personality`。 @returns 计算、查找或构建后的结果。 */
function getContactPersonalityImpact(personality: StoryCreationDraftContact["personality_library"][number]): DraftImpact {
  return existingContactPersonalityIds.value.has(personality.id)
    ? createImpact("update", "覆盖", "同 id 性格已存在，应用后会更新性格说明和风格标签。")
    : createImpact("create", "新增", "应用后会写入 contact.json5 的性格库。")
}

/** 判断联系媒介应用后会新增还是覆盖。 */
function getContactChannelImpact(channel: StoryCreationDraftContact["channels"][number]): DraftImpact {
  return existingContactChannelIds.value.has(channel.id)
    ? createImpact("update", "覆盖", "同 id 联系媒介已存在，应用后会更新名称、预设和文案。")
    : createImpact("create", "新增", "应用后会写入 contact.json5 的联系媒介。")
}

/** 读取或计算 `ContactTalkImpact`。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function getContactTalkImpact(entry: StoryCreationDraftContact["talk_library"][number]): DraftImpact {
  return existingContactTalkIds.value.has(entry.id)
    ? createImpact("update", "覆盖", "同 id 闲聊短句已存在，应用后会更新短句、作用域和好感变化。")
    : createImpact("create", "新增", "应用后会写入 contact.json5 的闲聊短句库。")
}

/** 读取或计算 `ContactActionImpact`。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function getContactActionImpact(entry: StoryCreationDraftContact["action_library"][number]): DraftImpact {
  return existingContactActionIds.value.has(entry.id)
    ? createImpact("update", "覆盖", "同 id 联系人动作已存在，应用后会更新动作规则。")
    : createImpact("create", "新增", "应用后会写入 contact.json5 的动作库。")
}

/** 读取或计算 `ContactReplyImpact`。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function getContactReplyImpact(entry: StoryCreationDraftContact["reply_library"][number]): DraftImpact {
  return existingContactReplyIds.value.has(entry.id)
    ? createImpact("update", "覆盖", "同 id NPC 回复已存在，应用后会更新回复规则。")
    : createImpact("create", "新增", "应用后会写入 contact.json5 的回复库。")
}

/** 读取或计算 `ContactProfileImpact`。 @param profile 调用方传入的 `profile`。 @returns 计算、查找或构建后的结果。 */
function getContactProfileImpact(profile: StoryCreationDraftContact["contact_profiles"][number]): DraftImpact {
  if (!availableRoleKeysForApply.value.has(profile.role_key) || profile.role_key === "player") {
    return createImpact("skip", "跳过", "联系人配置必须引用已存在或本次选中的 NPC 角色。")
  }

  return existingContactProfileKeys.value.has(profile.role_key)
    ? createImpact("update", "覆盖", "同角色联系人配置已存在，应用后会合并主动消息和偏好设置。")
    : createImpact("create", "新增", "应用后会写入 contact.json5 的联系人特配。")
}

/** 读取或计算 `ContactConversationImpact`。 @param conversation 调用方传入的 `conversation`。 @returns 计算、查找或构建后的结果。 */
function getContactConversationImpact(
  conversation: StoryCreationDraftContactConversations["conversations"][number]
): DraftImpact {
  if (!availableRoleKeysForApply.value.has(conversation.role_key) || conversation.role_key === "player") {
    return createImpact("skip", "跳过", "联系人剧情必须引用已存在或本次选中的 NPC 角色。")
  }

  return existingContactConversationIds.value.has(conversation.id)
    ? createImpact("update", "覆盖", "同 id 联系人剧情已存在，应用后会替换对话节点。")
    : createImpact("create", "新增", "应用后会写入 contact_conversations.json5。")
}

/** 读取或计算 `DoingMenuImpact`。 @param menu 调用方传入的 `menu`。 @returns 计算、查找或构建后的结果。 */
function getDoingMenuImpact(menu: StoryCreationDraftDoing["menus"][number]): DraftImpact {
  if (menu.parent_id && !availableDoingMenuIdsForApply.value.has(menu.parent_id)) {
    return createImpact("skip", "跳过", "父级菜单未选中且不存在，应用后会降级为根菜单。")
  }

  return existingDoingMenuIds.value.has(menu.id)
    ? createImpact("update", "覆盖", "同 id 行动菜单已存在，应用后会更新菜单信息。")
    : createImpact("create", "新增", "应用后会写入 doing.json5 的菜单树。")
}

/** 读取或计算 `DoingImpact`。 @param doing 调用方传入的 `doing`。 @returns 计算、查找或构建后的结果。 */
function getDoingImpact(doing: StoryCreationDraftDoing["doings"][number]): DraftImpact {
  if (!availableDoingMenuIdsForApply.value.has(doing.menu_id)) {
    return createImpact("skip", "跳过", "所属菜单未选中且不存在，应用时不会写入该行动。")
  }

  return existingDoingIds.value.has(doing.id)
    ? createImpact("update", "覆盖", "同 id 行动已存在，应用后会替换行动内容。")
    : createImpact("create", "新增", "应用后会写入 doing.json5。")
}

/** 读取或计算 `ShopCategoryImpact`。 @param category 调用方传入的 `category`。 @returns 计算、查找或构建后的结果。 */
function getShopCategoryImpact(category: StoryCreationDraftShop["categories"][number]): DraftImpact {
  return existingShopCategoryIds.value.has(category.id)
    ? createImpact("update", "覆盖", "同 id 商城分类已存在，应用后会更新分类信息。")
    : createImpact("create", "新增", "应用后会写入 shop.json5 的商城分类。")
}

/** 读取或计算 `ShopProductImpact`。 @param product 调用方传入的 `product`。 @returns 计算、查找或构建后的结果。 */
function getShopProductImpact(product: StoryCreationDraftShop["products"][number]): DraftImpact {
  if (!availableShopCategoryIdsForApply.value.has(product.category_id)) {
    return createImpact("skip", "跳过", "所属商城分类未选中且不存在，应用时不会写入该商品。")
  }

  if (!availableItemIdsForApply.value.has(product.item_id)) {
    return createImpact("skip", "跳过", "商品引用的物品未选中且不存在，应用时不会写入该商品。")
  }

  return existingShopProductIds.value.has(product.id)
    ? createImpact("update", "覆盖", "同 id 商城商品已存在，应用后会替换货架配置。")
    : createImpact("create", "新增", "应用后会写入 shop.json5 的商品货架。")
}

/** 统一读取事件的对白数组；silent/message 返回空数组，模板无需重复判断 presentation.type。 */
function getDraftPresentationDialogues(event: StoryCreationDraftEvent) {
  return event.presentation.type === "dialogue" ? event.presentation.dialogues : []
}

/** 读取或计算 `PresentationLabel`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function getPresentationLabel(event: StoryCreationDraftEvent) {
  if (event.presentation.type === "silent") {
    return "静默执行"
  }

  if (event.presentation.type === "message") {
    return "消息提示"
  }

  return `对白 ${event.presentation.dialogues.length} 条`
}

/** 读取或计算 `ImpactClass`。 @param impact 调用方传入的 `impact`。 @returns 计算、查找或构建后的结果。 */
function getImpactClass(impact: DraftImpact) {
  return `creation-impact--${impact.kind}`
}

// 以下文本 getter/setter 是表单适配器：领域模型使用 string[]/对象数组，textarea 使用普通字符串。
// 转换统一放在 composable，预览子组件只接 typed props/emits，不在模板中解析逗号或换行。
/** 读取或计算 `ItemCategoryName`。 @param categoryId 调用方传入的 `categoryId`。 @returns 计算、查找或构建后的结果。 */
function getItemCategoryName(categoryId: string) {
  const category = props.story.items.categories.find((item) => item.id === categoryId)
  return category?.name || categoryId
}

/** 读取或计算 `DraftOrExistingItemName`。 @param itemId 调用方传入的 `itemId`。 @returns 计算、查找或构建后的结果。 */
function getDraftOrExistingItemName(itemId: string) {
  const draftItem = draftPreview.value?.items.find((item) => item.id === itemId)
  const existingItem = props.story.items.items.find((item) => item.id === itemId)
  return draftItem?.name || existingItem?.name || itemId
}

/** 读取或计算 `DraftOrExistingShopCategoryName`。 @param categoryId 调用方传入的 `categoryId`。 @returns 计算、查找或构建后的结果。 */
function getDraftOrExistingShopCategoryName(categoryId: string) {
  const draftCategory = draftPreview.value?.shop?.categories.find((category) => category.id === categoryId)
  const existingCategory = props.story.shop.categories.find((category) => category.id === categoryId)
  return draftCategory?.name || existingCategory?.name || categoryId
}

/** 读取或计算 `ItemTagsText`。 @param item 调用方传入的 `item`。 @returns 计算、查找或构建后的结果。 */
function getItemTagsText(item: StoryCreationDraftItem) {
  return item.tags.join(", ")
}

/** 执行 `splitListInput` 对应的局部业务逻辑。 @param rawValue 调用方传入的 `rawValue`。 @returns 计算、查找或构建后的结果。 */
function splitListInput(rawValue: string) {
  return rawValue
    .split(/[,\n，、]/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 更新 `ItemTagsText` 对应的响应式值。 @param item 调用方传入的 `item`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setItemTagsText(item: StoryCreationDraftItem, rawValue: string) {
  item.tags = splitListInput(rawValue)
}

/** 读取或计算 `ContactScopeText`。 @param scope 调用方传入的 `scope`。 @returns 计算、查找或构建后的结果。 */
function getContactScopeText(scope: StoryCreationDraftContact["talk_library"][number]["scope"]) {
  const tracks = scope.contact_tracks.length ? scope.contact_tracks.join(", ") : "不限关系"
  const personalities = scope.personality_ids.length ? scope.personality_ids.join(", ") : "不限性格"
  const roles = scope.role_keys.length ? scope.role_keys.join(", ") : "不限角色"
  return `${scope.min_favor}-${scope.max_favor} / ${tracks} / ${personalities} / ${roles}`
}

/** 读取或计算 `StringListText`。 @param values 调用方传入的 `values`。 @returns 计算、查找或构建后的结果。 */
function getStringListText(values: string[] | undefined) {
  return (values ?? []).join(", ")
}

/** 更新 `StringListText` 对应的响应式值。 @param target 调用方传入的 `target`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setStringListText(target: { value: string[] }, rawValue: string) {
  target.value = splitListInput(rawValue)
}

/** 更新 `ContactPersonalityTags` 对应的响应式值。 @param personality 调用方传入的 `personality`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactPersonalityTags(
  personality: StoryCreationDraftContact["personality_library"][number],
  rawValue: string
) {
  personality.style_tags = splitListInput(rawValue)
}

/** 更新 `ContactTalkTags` 对应的响应式值。 @param entry 调用方传入的 `entry`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactTalkTags(entry: StoryCreationDraftContact["talk_library"][number], rawValue: string) {
  entry.tags = splitListInput(rawValue)
}

/** 更新 `ContactActionTags` 对应的响应式值。 @param entry 调用方传入的 `entry`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactActionTags(entry: StoryCreationDraftContact["action_library"][number], rawValue: string) {
  entry.tags = splitListInput(rawValue)
}

/** 更新 `ContactReplyTags` 对应的响应式值。 @param entry 调用方传入的 `entry`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactReplyTags(entry: StoryCreationDraftContact["reply_library"][number], rawValue: string) {
  entry.tags = splitListInput(rawValue)
}

/** 更新 `ContactPreferredTags` 对应的响应式值。 @param profile 调用方传入的 `profile`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactPreferredTags(
  profile: StoryCreationDraftContact["contact_profiles"][number],
  rawValue: string
) {
  profile.preferred_tags = splitListInput(rawValue)
}

/** 读取或计算 `ContactCostItemsText`。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function getContactCostItemsText(entry: StoryCreationDraftContact["action_library"][number]) {
  return entry.cost_items.map((item) => `${item.item_id} x${item.quantity}`).join(", ")
}

/** 读取或计算 `ContactRepliesText`。 @param entry 调用方传入的 `entry`。 @returns 计算、查找或构建后的结果。 */
function getContactRepliesText(entry: StoryCreationDraftContact["reply_library"][number]) {
  return entry.replies.join(" / ")
}

/** 更新 `ContactRepliesText` 对应的响应式值。 @param entry 调用方传入的 `entry`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setContactRepliesText(entry: StoryCreationDraftContact["reply_library"][number], rawValue: string) {
  entry.replies = rawValue
    .split(/[\/\n]/g)
    .map((reply) => reply.trim())
    .filter(Boolean)
}

/** 读取或计算 `ContactProfileSummary`。 @param profile 调用方传入的 `profile`。 @returns 计算、查找或构建后的结果。 */
function getContactProfileSummary(profile: StoryCreationDraftContact["contact_profiles"][number]) {
  const messages = profile.proactive_messages.length
  const preferredTags = profile.preferred_tags.length ? profile.preferred_tags.join(", ") : "无偏好标签"
  return `${profile.auto_add ? "自动加入" : "手动加入"} / 初始好感 ${profile.initial_favor} / ${preferredTags} / 主动消息 ${messages} 条`
}

/** 读取或计算 `DoingPresentationSummary`。 @param doing 调用方传入的 `doing`。 @returns 计算、查找或构建后的结果。 */
function getDoingPresentationSummary(doing: StoryCreationDraftDoing["doings"][number]) {
  if (doing.presentation.type === "dialogue") {
    return `对白 ${doing.presentation.dialogues.length} 条`
  }

  if (doing.presentation.type === "message") {
    return `消息：${doing.presentation.message.content}`
  }

  return "静默执行"
}

/** 更新 `ItemMaxStackFromInput` 对应的响应式值。 @param item 调用方传入的 `item`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setItemMaxStackFromInput(item: StoryCreationDraftItem, rawValue: string) {
  const parsed = Number(rawValue)
  item.max_stack = Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

/**
 * 确保 schedule 草稿拥有可编辑的完整 loop 对象。
 *
 * Agent 可能给非 schedule 事件或旧草稿留下 null；用户进入定时字段时使用稳定默认值补齐内存草稿，
 * 但只有最终应用请求才会写入故事。
 */
function ensureScheduleLoop(event: StoryCreationDraftEvent): StoryCreationDraftLoopRule {
  if (!event.loop) {
    event.loop = {
      mode: "daily",
      at: "00:00",
      priority: 100,
      after: [],
      before: []
    }
  }

  return event.loop
}

// schedule 输入都通过 ensureScheduleLoop 后再修改，避免模板里出现大量可选链和“字段改了但 loop
// 仍是 null”的情况。after 文本会去空、去重，服务端最终还会检查目标存在和依赖环。
/** 读取或计算 `ScheduleAt`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function getScheduleAt(event: StoryCreationDraftEvent) {
  return event.loop?.at ?? "00:00"
}

/** 更新 `ScheduleAt` 对应的响应式值。 @param event 调用方传入的 `event`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setScheduleAt(event: StoryCreationDraftEvent, rawValue: string) {
  ensureScheduleLoop(event).at = rawValue.trim() || "00:00"
}

/** 读取或计算 `SchedulePriority`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function getSchedulePriority(event: StoryCreationDraftEvent) {
  return event.loop?.priority ?? 100
}

/** 更新 `SchedulePriority` 对应的响应式值。 @param event 调用方传入的 `event`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setSchedulePriority(event: StoryCreationDraftEvent, rawValue: string) {
  const parsed = Number(rawValue)
  ensureScheduleLoop(event).priority = Number.isFinite(parsed) ? Math.trunc(parsed) : 100
}

/** 读取或计算 `ScheduleAfterText`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function getScheduleAfterText(event: StoryCreationDraftEvent) {
  return (event.loop?.after ?? []).join(", ")
}

/** 更新 `ScheduleAfterText` 对应的响应式值。 @param event 调用方传入的 `event`。 @param rawValue 调用方传入的 `rawValue`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setScheduleAfterText(event: StoryCreationDraftEvent, rawValue: string) {
  ensureScheduleLoop(event).after = Array.from(
    new Set(
      rawValue
        .split(/[,\n，、]/g)
        .map((id) => id.trim())
        .filter((id) => id && id !== event.id)
    )
  )
}

/**
 * 解释某个事件在真正应用时可能被自动调整的原因。
 *
 * 这里只基于前端现有/已选索引做即时提示，例如地点、角色、next 不可用；权威结果仍是服务端返回
 * 的 warnings 和 Core validation，前端不会自行删除这些草稿字段。
 */
function getEventApplyWarnings(event: StoryCreationDraftEvent) {
  const warnings: string[] = []
  const missingRoleKeys = new Set<string>()

  if (event.location && !availableLocationIdsForApply.value.has(event.location)) {
    warnings.push(`地点 ${event.location} 未选中且不存在，应用时会清空地点。`)
  }

  for (const objectKey of event.object_keys) {
    if (objectKey !== "player" && !availableRoleKeysForApply.value.has(objectKey)) {
      missingRoleKeys.add(objectKey)
    }
  }

  for (const dialogue of getDraftPresentationDialogues(event)) {
    if (
      dialogue.speaker_type === "object"
      && dialogue.speaker_key !== "player"
      && !availableRoleKeysForApply.value.has(dialogue.speaker_key)
    ) {
      missingRoleKeys.add(dialogue.speaker_key)
    }
  }

  if (missingRoleKeys.size > 0) {
    warnings.push(`角色 ${Array.from(missingRoleKeys).join(", ")} 未选中且不存在，应用时会降级对白说话人。`)
  }

  if (event.collectionType === "chain") {
    const missingNextIds = event.next.filter((nextId) => !availableChainIdsForApply.value.has(nextId))

    if (missingNextIds.length > 0) {
      warnings.push(`后续 ${missingNextIds.join(", ")} 未选中且不存在，应用时会移除连接。`)
    }
  }

  if (event.trigger_mode === "condition" && !event.trigger_expr.trim()) {
    warnings.push("条件触发缺少表达式，应用时会降级为默认触发。")
  }

  if (event.collectionType === "schedule" && !event.loop) {
    warnings.push("定时事件缺少 loop，应用时会使用 daily。")
  }

  if (event.collectionType === "schedule" && event.loop?.at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.loop.at)) {
    warnings.push("定时事件执行时间应使用 HH:mm 格式，例如 00:00。")
  }

  return warnings
}

/** 收集 `ionTypeLabel` 所需的数据。 @param collectionType 调用方传入的 `collectionType`。 @returns 计算、查找或构建后的结果。 */
function collectionTypeLabel(collectionType: StoryCreationDraftEvent["collectionType"]) {
  if (collectionType === "pool") {
    return "事件池"
  }

  if (collectionType === "schedule") {
    return "定时"
  }

  return "链式"
}

/** 执行 `triggerModeLabel` 对应的局部业务逻辑。 @param triggerMode 调用方传入的 `triggerMode`。 @returns 计算、查找或构建后的结果。 */
function triggerModeLabel(triggerMode: StoryCreationDraftEvent["trigger_mode"]) {
  if (triggerMode === "condition") {
    return "条件"
  }

  if (triggerMode === "invoke") {
    return "调用"
  }

  return "默认"
}

  return {
    variableValueLabel, setVariableValueFromInput, createImpact, getLocationImpact,
    getRoleImpact, getItemImpact, getVariableImpact, getEventImpact,
    getContactChannelImpact, getContactPersonalityImpact, getContactTalkImpact, getContactActionImpact, getContactReplyImpact,
    getContactProfileImpact, getContactConversationImpact, getDoingMenuImpact, getDoingImpact,
    getShopCategoryImpact, getShopProductImpact, getDraftPresentationDialogues, getPresentationLabel,
    getImpactClass, getItemCategoryName, getDraftOrExistingItemName, getDraftOrExistingShopCategoryName,
    getItemTagsText, splitListInput, setItemTagsText, getContactScopeText,
    getStringListText, setStringListText, setContactPersonalityTags, setContactTalkTags,
    setContactActionTags, setContactReplyTags, setContactPreferredTags, getContactCostItemsText,
    getContactRepliesText, setContactRepliesText, getContactProfileSummary, getDoingPresentationSummary,
    setItemMaxStackFromInput, ensureScheduleLoop, getScheduleAt, setScheduleAt,
    getSchedulePriority, setSchedulePriority, getScheduleAfterText, setScheduleAfterText,
    getEventApplyWarnings, collectionTypeLabel, triggerModeLabel
  }
}

export type StoryCreationDraftPreviewController = ReturnType<typeof useStoryCreationDraftPreview>
