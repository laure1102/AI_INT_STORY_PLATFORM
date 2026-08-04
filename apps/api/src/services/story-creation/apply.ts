/**
 * AI 创作草稿的唯一正式应用入口。
 *
 * 这个模块把“模型建议”变成“用户明确选择后可保存的故事修改”，但不会边处理边写文件。所有选中
 * 内容先与当前故事合并成一个完整候选 `StoryDocument`，候选通过 Core 全量验证后，才交给 File
 * Store 作为一次事务提交。任何一步失败都不会留下只写了一半的角色、事件或变量文件。
 *
 * 数据流：未知草稿 → Zod 解析/规范化 → 按用户选择合并 → 过滤跨领域引用 → 全篇验证 →
 * `expectedRevision` 冲突检查 → 多文件事务提交。
 *
 * 本模块不调用 AI，也不替用户自动选择草稿内容。事务中的临时文件、回滚和崩溃恢复由 File Store
 * 负责；这里负责保证交给 File Store 的候选故事在业务层已经完整有效。
 */
import {
  validateStoryDocument,
  type StoryDocument,
  type StoryDoingFile,
  type StoryEventFile,
  type StoryEventLocationFile,
  type StoryItemsFile,
  type StoryLoopEventFile,
  type StoryPhoneConversationsFile,
  type StoryPhoneFile,
  type StoryOnceEventFile,
  type StoryRolesFile
} from "@story-mgr/core"
import { FileStoreError, type StoryFileStore } from "@story-mgr/file-store"
import type {
  ApplyStoryCreationDraftRequest,
  ApplyStoryCreationDraftResponse
} from "@story-mgr/shared"
import { collectAvailableRoleKeys, draftEventKey, filterPhoneActionCostItems, filterPhoneConversationInvokeForApply, filterPhoneInvokeForApply, filterPhoneScopeForApply, mergePhoneContactProfile, normalizeDoingForApply, normalizeDoingMenuForApply, normalizeShopProductForApply, parseDraftForApply, toEventLocationAssignment, toImportantRole, toNormalRole, toSelectionSet, toStoryItem, upsertById, upsertByKey } from "./apply-domain"
import { applyDraftVariable, cloneStoryValsFile, draftVariableKey, toStoryEvent } from "./apply-events"
import { draftRoleKey } from "./draft-normalize"

/**
 * 应用用户勾选的创作草稿，并返回提交后的故事和新修订号。
 *
 * @param store 故事文件门面，负责读取、版本检查和事务写入。
 * @param storyId 要修改的故事 id；路径安全由 File Store 统一检查。
 * @param request 包含未知草稿、各领域选择项和调用方读取时的 `expectedRevision`。
 * @returns 提交后的故事、验证结果、各领域实际应用数量、自动修正警告和新 revision。
 * @throws 草稿结构错误或候选故事有 validation error 时抛 400；revision 过期时由 File Store 抛 409；
 * 事务 I/O 失败时由 File Store 回滚并抛出存储错误。
 */
export async function applyStoryCreationDraft(
  store: StoryFileStore,
  storyId: string,
  request: ApplyStoryCreationDraftRequest
): Promise<ApplyStoryCreationDraftResponse> {
  // 第 1 步：重新解析草稿，并把前端数组变成去重 Set。
  // 请求可能来自历史任务或浏览器缓存，不能假定它仍符合服务端当前 Schema。选择项只决定“应用谁”，
  // 不会让未选中的草稿资产进入后续可用引用集合。
  const draft = parseDraftForApply(request.draft)
  const selectedLocationIds = toSelectionSet(request.selection.locationIds)
  const selectedRoleKeys = toSelectionSet(request.selection.roleKeys ?? [])
  const selectedLegacyRoleIds = toSelectionSet(request.selection.roleIds ?? [])
  const selectedItemIds = toSelectionSet(request.selection.itemIds ?? [])
  const selectedPhonePersonalityIds = toSelectionSet(request.selection.phonePersonalityIds ?? [])
  const selectedPhoneTalkIds = toSelectionSet(request.selection.phoneTalkIds ?? [])
  const selectedPhoneActionIds = toSelectionSet(request.selection.phoneActionIds ?? [])
  const selectedPhoneReplyIds = toSelectionSet(request.selection.phoneReplyIds ?? [])
  const selectedPhoneContactProfileKeys = toSelectionSet(request.selection.phoneContactProfileKeys ?? [])
  const selectedPhoneConversationIds = toSelectionSet(request.selection.phoneConversationIds ?? [])
  const selectedDoingMenuIds = toSelectionSet(request.selection.doingMenuIds ?? [])
  const selectedDoingIds = toSelectionSet(request.selection.doingIds ?? [])
  const selectedShopCategoryIds = toSelectionSet(request.selection.shopCategoryIds ?? [])
  const selectedShopProductIds = toSelectionSet(request.selection.shopProductIds ?? [])
  const selectedEventKeys = toSelectionSet(request.selection.eventKeys)
  const selectedVariableKeys = toSelectionSet([
    ...(request.selection.variableKeys ?? []),
    ...(request.selection.variables ?? [])
  ])

  // 第 2 步：读取当前最新版故事，并初始化统计与 warning。
  // draft 自带的 warnings 是 Agent 对不确定内容的说明；下面的过滤流程还会继续追加服务端修正记录。
  const story = await store.readStoryDocument(storyId)
  const warnings: string[] = [...draft.warnings]
  let appliedLocations = 0
  let appliedRoles = 0
  let appliedItems = 0
  let appliedVariables = 0
  let appliedPhonePersonalities = 0
  let appliedPhoneTalks = 0
  let appliedPhoneActions = 0
  let appliedPhoneReplies = 0
  let appliedPhoneContactProfiles = 0
  let appliedPhoneConversations = 0
  let appliedDoingMenus = 0
  let appliedDoings = 0
  let appliedShopCategories = 0
  let appliedShopProducts = 0

  // 第 3 步：先合并地点、角色和物品。
  // 后面的事件、手机、行动和商城都可能引用它们，所以必须先得到“本批选择应用后”的可用资产集合。
  const nextEventLocations: StoryEventLocationFile = {
    ...story.eventLocations,
    assignments: story.eventLocations.assignments
  }

  for (const location of draft.locations) {
    if (!selectedLocationIds.has(location.id)) {
      continue
    }

    const existingLocation = nextEventLocations.assignments.find((item) => item.id === location.id)
    nextEventLocations.assignments = upsertById(
      nextEventLocations.assignments,
      toEventLocationAssignment(location, existingLocation)
    )
    appliedLocations += 1
  }

  const nextRoles: StoryRolesFile = {
    normal: {
      ...story.roles.normal,
      roles: story.roles.normal.roles
    },
    important: {
      ...story.roles.important,
      roles: story.roles.important.roles
    }
  }

  for (const role of draft.roles) {
    if (!selectedRoleKeys.has(draftRoleKey(role)) && !selectedLegacyRoleIds.has(role.id)) {
      continue
    }

    if (role.important) {
      const existingRole = nextRoles.important.roles.find((item) => item.id === role.id)
      nextRoles.important.roles = upsertById(
        nextRoles.important.roles,
        toImportantRole(role, existingRole)
      )
    } else {
      const existingRole = nextRoles.normal.roles.find((item) => item.id === role.id)
      nextRoles.normal.roles = upsertById(
        nextRoles.normal.roles,
        toNormalRole(role, existingRole)
      )
    }

    appliedRoles += 1
  }

  const nextItems: StoryItemsFile = {
    ...story.items,
    categories: story.items.categories,
    items: story.items.items
  }
  const itemCategoryIds = new Set(nextItems.categories.map((category) => category.id))

  for (const item of draft.items) {
    if (!selectedItemIds.has(item.id)) {
      continue
    }

    if (!itemCategoryIds.has(item.category_id)) {
      warnings.push(`物品 ${item.id} 引用了不存在的分类 ${item.category_id}，未写入 items.json5。`)
      continue
    }

    const existingItem = nextItems.items.find((existing) => existing.id === item.id)
    nextItems.items = upsertById(
      nextItems.items,
      toStoryItem(item, existingItem)
    )
    appliedItems += 1
  }

  // 第 4 步：建立跨领域引用索引，并把选中事件转换成持久化结构。
  // 索引同时包含故事已有内容和本批已选内容，因此同批新事件可以连接同批新事件；未选内容不会被
  // 当成可用目标，避免保存出“草稿里有、实际文件里没有”的悬空引用。
  const selectedEvents = draft.events.filter((event) => selectedEventKeys.has(draftEventKey(event)))
  const availableChainIds = new Set([
    ...story.chainEvents.map((event) => event.id),
    ...selectedEvents
      .filter((event) => event.collectionType === "chain")
      .map((event) => event.id)
  ])
  const availableEventIdsByType = {
    chain: availableChainIds,
    pool: new Set([
      ...story.poolEvents.map((event) => event.id),
      ...selectedEvents
        .filter((event) => event.collectionType === "pool")
        .map((event) => event.id)
    ]),
    schedule: new Set([
      ...story.scheduleEvents.map((event) => event.id),
      ...selectedEvents
        .filter((event) => event.collectionType === "schedule")
        .map((event) => event.id)
    ])
  } satisfies Record<"chain" | "pool" | "schedule", Set<string>>
  const availableLocationIds = new Set(nextEventLocations.assignments.map((location) => location.id))
  const availableRoleKeys = collectAvailableRoleKeys(nextRoles)
  const availableItemIds = new Set(nextItems.items.map((item) => item.id))
  const eventsToWrite = selectedEvents.map((event) =>
    toStoryEvent(event, {
      availableChainIds,
      availableLocationIds,
      availableRoleKeys,
      warnings
    })
  )

  // 第 5 步：合并普通手机素材。
  // 顺序是性格 → 闲聊 → 动作 → 回复 → 联系人配置，因为后面的条目可能引用前面刚选中的性格、
  // 角色、物品或事件。无效的可选引用会被过滤并产生 warning，而不是隐式创建缺失资源。
  const nextPhone: StoryPhoneFile = {
    ...story.phone,
    personality_library: story.phone.personality_library,
    talk_library: story.phone.talk_library,
    action_library: story.phone.action_library,
    reply_library: story.phone.reply_library,
    player_quick_messages: story.phone.player_quick_messages,
    contact_profiles: story.phone.contact_profiles
  }
  const availablePhonePersonalityIds = new Set(nextPhone.personality_library.map((personality) => personality.id))

  for (const personality of draft.phone?.personality_library ?? []) {
    if (!selectedPhonePersonalityIds.has(personality.id)) {
      continue
    }

    nextPhone.personality_library = upsertById(nextPhone.personality_library, personality)
    availablePhonePersonalityIds.add(personality.id)
    appliedPhonePersonalities += 1
  }

  for (const entry of draft.phone?.talk_library ?? []) {
    if (!selectedPhoneTalkIds.has(entry.id)) {
      continue
    }

    const nextEntry = filterPhoneInvokeForApply(
      {
        ...entry,
        scope: filterPhoneScopeForApply(entry.scope, {
          availablePersonalityIds: availablePhonePersonalityIds,
          availableRoleKeys,
          label: `联系人闲聊 ${entry.id}`,
          warnings
        })
      },
      {
        availableEventIdsByType,
        label: `联系人闲聊 ${entry.id}`,
        warnings
      }
    )

    nextPhone.talk_library = upsertById(nextPhone.talk_library, nextEntry)
    appliedPhoneTalks += 1
  }

  for (const entry of draft.phone?.action_library ?? []) {
    if (!selectedPhoneActionIds.has(entry.id)) {
      continue
    }

    const nextEntry = filterPhoneInvokeForApply(
      filterPhoneActionCostItems(
        {
          ...entry,
          scope: filterPhoneScopeForApply(entry.scope, {
            availablePersonalityIds: availablePhonePersonalityIds,
            availableRoleKeys,
            label: `联系人动作 ${entry.id}`,
            warnings
          })
        },
        availableItemIds,
        warnings
      ),
      {
        availableEventIdsByType,
        label: `联系人动作 ${entry.id}`,
        warnings
      }
    )

    nextPhone.action_library = upsertById(nextPhone.action_library, nextEntry)
    appliedPhoneActions += 1
  }

  for (const entry of draft.phone?.reply_library ?? []) {
    if (!selectedPhoneReplyIds.has(entry.id)) {
      continue
    }

    const nextEntry = {
      ...entry,
      scope: filterPhoneScopeForApply(entry.scope, {
        availablePersonalityIds: availablePhonePersonalityIds,
        availableRoleKeys,
        label: `联系人回复 ${entry.id}`,
        warnings
      })
    }

    nextPhone.reply_library = upsertById(nextPhone.reply_library, nextEntry)
    appliedPhoneReplies += 1
  }

  for (const profile of draft.phone?.contact_profiles ?? []) {
    if (!selectedPhoneContactProfileKeys.has(profile.role_key)) {
      continue
    }

    if (!availableRoleKeys.has(profile.role_key) || profile.role_key === "player") {
      warnings.push(`联系人配置 ${profile.role_key} 引用了不存在或未应用的 NPC 角色，未写入 phone.json5。`)
      continue
    }

    const existingProfile = nextPhone.contact_profiles.find((item) => item.role_key === profile.role_key)
    nextPhone.contact_profiles = upsertByKey(
      nextPhone.contact_profiles,
      mergePhoneContactProfile(profile, existingProfile),
      (item) => item.role_key
    )
    appliedPhoneContactProfiles += 1
  }

  // 第 6 步：合并连续剧情手机对话。
  // 联系人必须是已存在或本批已选中的 NPC；节点末尾调用的事件也必须出现在可用事件索引中。
  const nextPhoneConversations: StoryPhoneConversationsFile = {
    conversations: story.phoneConversations.conversations
  }

  for (const conversation of draft.phoneConversations?.conversations ?? []) {
    if (!selectedPhoneConversationIds.has(conversation.id)) {
      continue
    }

    if (!availableRoleKeys.has(conversation.role_key) || conversation.role_key === "player") {
      warnings.push(`剧情手机对话 ${conversation.id} 引用了不存在或未应用的 NPC 角色 ${conversation.role_key}，未写入 phone_conversations.json5。`)
      continue
    }

    const nextConversation = filterPhoneConversationInvokeForApply(conversation, {
      availableEventIdsByType,
      warnings
    })

    nextPhoneConversations.conversations = upsertById(
      nextPhoneConversations.conversations,
      nextConversation
    )
    appliedPhoneConversations += 1
  }

  // 第 7 步：先合并行动菜单，再合并依赖菜单的行动。
  // 这样同批新增菜单可立即作为同批行动入口；如果行动的菜单最终不可用，整条行动会被跳过。
  const nextDoing: StoryDoingFile = {
    menus: story.doing.menus,
    doings: story.doing.doings
  }
  const availableDoingMenuIdsForMenus = new Set([
    ...story.doing.menus.map((menu) => menu.id),
    ...(draft.doing?.menus ?? [])
      .filter((menu) => selectedDoingMenuIds.has(menu.id))
      .map((menu) => menu.id)
  ])

  for (const menu of draft.doing?.menus ?? []) {
    if (!selectedDoingMenuIds.has(menu.id)) {
      continue
    }

    nextDoing.menus = upsertById(
      nextDoing.menus,
      normalizeDoingMenuForApply(menu, availableDoingMenuIdsForMenus, warnings)
    )
    appliedDoingMenus += 1
  }

  const availableDoingMenuIds = new Set(nextDoing.menus.map((menu) => menu.id))
  for (const doing of draft.doing?.doings ?? []) {
    if (!selectedDoingIds.has(doing.id)) {
      continue
    }

    const nextDoingDefinition = normalizeDoingForApply(doing, {
      availableLocationIds,
      availableMenuIds: availableDoingMenuIds,
      availableRoleKeys,
      warnings
    })

    if (!nextDoingDefinition) {
      continue
    }

    nextDoing.doings = upsertById(nextDoing.doings, nextDoingDefinition)
    appliedDoings += 1
  }

  // 第 8 步：先合并商城分类，再检查商品引用。
  // 商城是已有物品的货架，不拥有物品资产；商品引用的 item 必须来自原故事或本批已选物品。
  const nextShop = {
    ...story.shop,
    categories: story.shop.categories,
    products: story.shop.products
  }

  for (const category of draft.shop?.categories ?? []) {
    if (!selectedShopCategoryIds.has(category.id)) {
      continue
    }

    nextShop.categories = upsertById(nextShop.categories, category)
    appliedShopCategories += 1
  }

  const availableShopCategoryIds = new Set(nextShop.categories.map((category) => category.id))
  for (const product of draft.shop?.products ?? []) {
    if (!selectedShopProductIds.has(product.id)) {
      continue
    }

    const nextProduct = normalizeShopProductForApply(product, {
      availableItemIds,
      availableShopCategoryIds,
      warnings
    })

    if (!nextProduct) {
      continue
    }

    nextShop.products = upsertById(nextShop.products, nextProduct)
    appliedShopProducts += 1
  }

  // 第 9 步：变量采用“只新增、不覆盖”策略。
  // 只有确实选择了变量时才克隆 vals，既避免无意义复制，也确保验证失败不会改到原故事引用。
  let nextVals = story.vals
  if (selectedVariableKeys.size > 0) {
    nextVals = cloneStoryValsFile(story.vals)

    for (const variable of draft.variables) {
      if (!selectedVariableKeys.has(draftVariableKey(variable))) {
        continue
      }

      if (applyDraftVariable(nextVals, variable, warnings)) {
        appliedVariables += 1
      }
    }
  }

  let nextChainEvents = story.chainEvents
  let nextPoolEvents = story.poolEvents
  let nextScheduleEvents = story.scheduleEvents

  // 三类事件分别回写各自候选数组；upsert 会保持已有项的位置，新事件追加到末尾。
  for (const item of eventsToWrite) {
    if (item.collectionType === "pool") {
      nextPoolEvents = upsertById(nextPoolEvents, item.event as StoryOnceEventFile)
    } else if (item.collectionType === "schedule") {
      nextScheduleEvents = upsertById(nextScheduleEvents, item.event as StoryLoopEventFile)
    } else {
      nextChainEvents = upsertById(nextChainEvents, item.event as StoryEventFile)
    }
  }

  // 第 10 步：把所有领域候选一次性装配成完整 StoryDocument。
  // 到这里仍然只存在于内存中，磁盘上的任何 JSON5 文件都没有改变。
  const candidateStory: StoryDocument = {
    ...story,
    vals: nextVals,
    eventLocations: nextEventLocations,
    roles: nextRoles,
    items: nextItems,
    phone: nextPhone,
    phoneConversations: nextPhoneConversations,
    doing: nextDoing,
    shop: nextShop,
    chainEvents: nextChainEvents,
    poolEvents: nextPoolEvents,
    scheduleEvents: nextScheduleEvents
  }
  const validationResult = validateStoryDocument(candidateStory)
  const validationErrors = validationResult.issues.filter((issue) => issue.level === "error")

  // warning 表示可保存但需要作者注意；error 表示故事契约已破坏，必须在事务开始前整体拒绝。
  // 不能跳过这一步逐文件保存，否则可能先写入角色，随后才发现事件或 schedule 依赖无效。
  if (validationErrors.length > 0) {
    throw new FileStoreError(
      `The selected draft would make the story invalid (${validationErrors.length} errors).`,
      400,
      "story.validation-failed"
    )
  }

  // 第 11 步：让 File Store 执行乐观并发检查和多文件事务提交。
  // expectedRevision 防止旧弹窗、旧 AI 任务或两个并行请求用过期内容覆盖较新的编辑结果；不一致时
  // 返回 409。事务阶段若发生 I/O 故障，File Store 使用事务日志回滚或在下次启动时恢复。
  const committed = await store.commitStoryDocument(
    storyId,
    candidateStory,
    request.expectedRevision
  )

  return {
    story: committed.value,
    result: validationResult,
    applied: {
      events: eventsToWrite.length,
      locations: appliedLocations,
      roles: appliedRoles,
      items: appliedItems,
      variables: appliedVariables,
      phonePersonalities: appliedPhonePersonalities,
      phoneTalks: appliedPhoneTalks,
      phoneActions: appliedPhoneActions,
      phoneReplies: appliedPhoneReplies,
      phoneContactProfiles: appliedPhoneContactProfiles,
      phoneConversations: appliedPhoneConversations,
      doingMenus: appliedDoingMenus,
      doings: appliedDoings,
      shopCategories: appliedShopCategories,
      shopProducts: appliedShopProducts
    },
    warnings,
    revision: committed.revision
  }
}
