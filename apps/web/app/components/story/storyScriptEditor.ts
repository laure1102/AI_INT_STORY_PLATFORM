import type {
  StoryDocument,
  StoryEventFile,
  StoryLoopEventFile,
  StoryOnceEventFile,
  StoryReferFile,
  StoryValsFile
} from "@story-mgr/core"

export interface StoryScriptAutocompleteItem {
  name: string
  description: string
  detailTitle?: string
  detailLines?: string[]
}

export interface StoryScriptHighlightToken {
  text: string
  highlighted: boolean
}

export interface StoryScriptCommandAutocompleteState {
  open: boolean
  query: string
  replaceStart: number
  replaceEnd: number
  mode: "placeholder" | "invoke_once"
}

export interface StoryScriptInvokeTargetOption {
  type: "chain" | "pool" | "schedule"
  eventId: string
  title: string
  params: Array<{
    name: string
    description: string
  }>
}

export interface StoryScriptInvokeAutocompleteContext {
  targets: StoryScriptInvokeTargetOption[]
}

export interface StoryScriptCommandAutocompleteResult {
  items: StoryScriptAutocompleteItem[]
  state: StoryScriptCommandAutocompleteState
}

const STORY_SCRIPT_INVOKE_TARGET_TYPE_ITEMS: StoryScriptAutocompleteItem[] = [
  {
    name: "chain",
    description: "调用链式剧情线中的被调用事件。",
    detailTitle: "invoke_once chain",
    detailLines: [
      "格式：invoke_once chain event_id 业务参数=表达式。",
      "目标必须是链式剧情线里 trigger_mode=invoke 的事件。",
      "选定目标事件后，可继续填写业务参数，或追加一个 delay_* 延迟元参数。"
    ]
  },
  {
    name: "pool",
    description: "调用平面事件池中的被调用事件。",
    detailTitle: "invoke_once pool",
    detailLines: [
      "格式：invoke_once pool event_id 业务参数=表达式。",
      "目标必须是平面事件池里 trigger_mode=invoke 的事件。",
      "选定目标事件后，可继续填写业务参数，或追加一个 delay_* 延迟元参数。"
    ]
  },
  {
    name: "schedule",
    description: "调用定时事件集合中的被调用事件。",
    detailTitle: "invoke_once schedule",
    detailLines: [
      "格式：invoke_once schedule event_id 业务参数=表达式。",
      "目标必须是定时事件集合里 trigger_mode=invoke 的事件。",
      "被调用的 schedule 事件会按 invoke 队列入队，不走默认的循环时间扫描。"
    ]
  }
]

const STORY_SCRIPT_BUILTIN_AUTOCOMPLETE_ITEMS: StoryScriptAutocompleteItem[] = [
  { name: "Number", description: "将输入转成 number。" },
  { name: "String", description: "将输入转成 string。" },
  { name: "Boolean", description: "将输入转成 boolean。" },
  { name: "parseInt", description: "解析整数，建议显式传入进制。" },
  { name: "parseFloat", description: "解析浮点数。" },
  { name: "isNaN", description: "按 Number 转换后的结果判断是否 NaN。" },
  { name: "isFinite", description: "按 Number 转换后的结果判断是否为有限数。" },
  { name: "trim", description: "去掉字符串首尾空白。" },
  { name: "includes", description: "判断字符串是否包含目标文本。" },
  { name: "startsWith", description: "判断字符串是否以目标文本开头。" },
  { name: "endsWith", description: "判断字符串是否以目标文本结尾。" },
  { name: "slice", description: "按 start/end 截取字符串。" },
  { name: "toLowerCase", description: "把文本转成小写。" },
  { name: "toUpperCase", description: "把文本转成大写。" },
  { name: "toFixed", description: "按指定小数位格式化数字，返回字符串；支持函数形式和 number.toFixed(...) 别名。" },
  { name: "formatWan", description: "把数值格式化为中文“万”显示文本。" },
  { name: "bag_count", description: "读取背包中物品数量。" },
  { name: "bag_has", description: "检查背包中是否有足够数量的物品。" },
  { name: "bag_add", description: "向背包添加物品。" },
  { name: "bag_remove", description: "从背包扣除物品。" },
  { name: "doing_has", description: "检查指定行动是否已解锁且未锁定。" },
  { name: "doing_used_count", description: "读取指定行动累计完成次数。" },
  { name: "doing_cooldown_left", description: "读取指定行动剩余冷却小时数。" },
  { name: "doing_unlock", description: "解锁 doing.json5 中已预设的行动。" },
  { name: "doing_lock", description: "锁定 doing.json5 中已预设的行动。" },
  { name: "doing_set_cooldown", description: "为指定行动设置游戏小时冷却。" },
  { name: "shop_can_buy", description: "检查指定商城商品当前是否可购买。" },
  { name: "shop_buy", description: "购买指定商城商品，扣钱并加入玩家背包。" },
  { name: "shop_purchase_cooldown_left", description: "读取指定商品购买剩余冷却小时数。" },
  { name: "shop_gift", description: "购买指定商城商品并直接送给联系人，不进入背包，同时增加好感度。" },
  { name: "shop_gift_cooldown_left", description: "读取指定商品送给指定联系人的剩余冷却小时数。" },
  { name: "contact_start_conversation", description: "启动 contact_conversations.json5 中预设的连续联系人剧情。" }
]

const STORY_SCRIPT_HIGHLIGHT_PATTERN =
  /\b(let|if|else|switch|case|default|for|while|break|continue|return|invoke_once|true|false|null)\b|\b(?:Math|Number|String|Boolean|parseInt|parseFloat|isNaN|isFinite|trim|includes|startsWith|endsWith|slice|toLowerCase|toUpperCase|toFixed|formatWan|bag_count|bag_has|bag_add|bag_remove|doing_has|doing_used_count|doing_cooldown_left|doing_unlock|doing_lock|doing_set_cooldown|shop_can_buy|shop_buy|shop_purchase_cooldown_left|shop_gift|shop_gift_cooldown_left|contact_start_conversation)\b|\b(?:abs|acos|asin|atan2|atan|ceil|clamp|cos|exp|floor|log10|log2|log|max|min|pow|random|round|sign|sin|sqrt|tan|trunc)\b(?=\s*\()/g

export const STORY_SCRIPT_TEMPLATE_PLACEHOLDER =
  "例如：今天是第 ${system.now_day} 天，账上还有 ${player.money}。"

/** 打开 `StoryScriptReferencePage` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
export function openStoryScriptReferencePage() {
  if (typeof document === "undefined") {
    return
  }

  const link = document.createElement("a")
  link.href = "/story-script"
  link.target = "_blank"
  link.rel = "noopener noreferrer"
  link.style.display = "none"

  document.body.append(link)
  link.click()
  link.remove()
}

/** 将 `StoryScriptAutocompleteText` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function normalizeStoryScriptAutocompleteText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

/** 将 `StoryScriptAutocompleteDetailLines` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function normalizeStoryScriptAutocompleteDetailLines(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeStoryScriptAutocompleteText(item))
    .filter(Boolean)
}

/** 根据当前输入构建 `StoryScriptValAutocompleteItems` 结果。 @param vals 调用方传入的 `vals`。 @returns 计算、查找或构建后的结果。 */
export function buildStoryScriptValAutocompleteItems(vals: StoryValsFile) {
  const seen = new Set<string>()

  return vals.variables.flatMap((group) => {
    const groupName = normalizeStoryScriptAutocompleteText(group.name)
    const groupDescription = normalizeStoryScriptAutocompleteText(group.description)

    if (!groupName) {
      return []
    }

    return group.vals.flatMap((row) => {
      const rowName = normalizeStoryScriptAutocompleteText(row.name)

      if (!rowName) {
        return []
      }

      const name = `${groupName}.${rowName}`

      if (seen.has(name)) {
        return []
      }

      seen.add(name)

      return [{
        name,
        description: [groupDescription, normalizeStoryScriptAutocompleteText(row.description)]
          .filter(Boolean)
          .join(" / ")
      }]
    })
  })
}

/** 根据当前输入构建 `StoryReferAutocompleteItems` 结果。 @param storyOrRefer 调用方传入的 `storyOrRefer`。 @returns 计算、查找或构建后的结果。 */
export function buildStoryReferAutocompleteItems(
  storyOrRefer: Pick<StoryDocument, "refer"> | StoryReferFile | null | undefined
) {
  const refer = storyOrRefer && "terms" in storyOrRefer
    ? storyOrRefer
    : storyOrRefer?.refer
  const seen = new Set<string>()

  return (refer?.terms ?? []).flatMap((term) => {
    const rawId = normalizeStoryScriptAutocompleteText(term.id).replace(/^term\./, "")
    if (!rawId || seen.has(rawId)) {
      return []
    }

    seen.add(rawId)

    const label = normalizeStoryScriptAutocompleteText(term.label)
    const fallback = normalizeStoryScriptAutocompleteText(term.fallback)
    const male = normalizeStoryScriptAutocompleteText(term.male)
    const female = normalizeStoryScriptAutocompleteText(term.female)

    return [{
      name: `term.${rawId}`,
      description: label || "称谓库占位符",
      detailTitle: `term.${rawId}`,
      detailLines: [
        label ? `用途：${label}` : "",
        male ? `男：${male}` : "",
        female ? `女：${female}` : "",
        fallback ? `兜底：${fallback}` : ""
      ].filter(Boolean)
    }]
  })
}

/** 根据当前输入构建 `StoryContactConversationAutocompleteItems` 结果。 @param story 调用方传入的 `story`。 @returns 计算、查找或构建后的结果。 */
export function buildStoryContactConversationAutocompleteItems(
  story: Pick<StoryDocument, "contactConversations"> | null | undefined
) {
  const seen = new Set<string>()

  return (story?.contactConversations?.conversations ?? []).flatMap((conversation) => {
    const conversationId = normalizeStoryScriptAutocompleteText(conversation.id)
    if (!conversationId || seen.has(conversationId)) {
      return []
    }

    seen.add(conversationId)
    const title = normalizeStoryScriptAutocompleteText(conversation.title)
    const roleKey = normalizeStoryScriptAutocompleteText(conversation.role_key)
    return [{
      name: conversationId,
      description: title ? `联系人剧情：${title}` : "联系人剧情 ID",
      detailTitle: `contact_start_conversation("${conversationId}")`,
      detailLines: [
        title ? `标题：${title}` : "",
        roleKey ? `联系人：${roleKey}` : "",
        "用于 contact_start_conversation(...)，同一时间只允许一段联系人剧情进行中。"
      ].filter(Boolean)
    }]
  })
}

/** 根据当前输入构建 `StoryScriptBuiltinAutocompleteItems` 结果。 @returns 计算、查找或构建后的结果。 */
export function buildStoryScriptBuiltinAutocompleteItems() {
  return STORY_SCRIPT_BUILTIN_AUTOCOMPLETE_ITEMS.map((item) => ({ ...item }))
}

/** 根据当前输入构建 `InvokeTargetParams` 结果。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function buildInvokeTargetParams(
  event: Pick<StoryEventFile | StoryOnceEventFile | StoryLoopEventFile, "invoke_params">
) {
  return (event.invoke_params ?? [])
    .map((param) => ({
      name: normalizeStoryScriptAutocompleteText(param.name),
      description: normalizeStoryScriptAutocompleteText(param.descr) || "被调用时传入的参数"
    }))
    .filter((param) => param.name)
}

/** 根据当前输入构建 `InvokeTargetOption` 结果。 @param type 调用方传入的 `type`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function buildInvokeTargetOption(
  type: "chain" | "pool" | "schedule",
  event: Pick<StoryEventFile | StoryOnceEventFile | StoryLoopEventFile, "id" | "title" | "invoke_params">
): StoryScriptInvokeTargetOption {
  return {
    type,
    eventId: normalizeStoryScriptAutocompleteText(event.id),
    title: normalizeStoryScriptAutocompleteText(event.title),
    params: buildInvokeTargetParams(event)
  }
}

/** 根据当前输入构建 `StoryScriptInvokeAutocompleteContext` 结果。 @param story 调用方传入的 `story`。 @returns 计算、查找或构建后的结果。 */
export function buildStoryScriptInvokeAutocompleteContext(
  story: StoryDocument | null | undefined
): StoryScriptInvokeAutocompleteContext {
  if (!story) {
    return {
      targets: []
    }
  }

  const chainTargets = story.chainEvents
    .filter((event): event is StoryEventFile => {
      return !("exec_script" in event) && (event.trigger_mode ?? "default") === "invoke"
    })
    .map((event) => buildInvokeTargetOption("chain", event))

  const poolTargets = story.poolEvents
    .filter((event) => (event.trigger_mode ?? "default") === "invoke")
    .map((event) => buildInvokeTargetOption("pool", event))

  const scheduleTargets = story.scheduleEvents
    .filter((event) => (event.trigger_mode ?? "default") === "invoke")
    .map((event) => buildInvokeTargetOption("schedule", event))

  return {
    targets: [...chainTargets, ...poolTargets, ...scheduleTargets]
  }
}

/** 执行 `mergeStoryScriptAutocompleteItems` 对应的局部业务逻辑。 @param itemGroups 调用方传入的 `itemGroups`。 @returns 计算、查找或构建后的结果。 */
export function mergeStoryScriptAutocompleteItems(
  ...itemGroups: Array<StoryScriptAutocompleteItem[] | undefined>
) {
  const mergedItems: StoryScriptAutocompleteItem[] = []
  const itemMap = new Map<string, number>()

  for (const group of itemGroups) {
    for (const item of group ?? []) {
      const name = normalizeStoryScriptAutocompleteText(item.name)

      if (!name) {
        continue
      }

      const description = normalizeStoryScriptAutocompleteText(item.description)
      const detailTitle = normalizeStoryScriptAutocompleteText(item.detailTitle)
      const detailLines = normalizeStoryScriptAutocompleteDetailLines(item.detailLines)
      const existingIndex = itemMap.get(name)

      if (existingIndex === undefined) {
        itemMap.set(name, mergedItems.length)
        mergedItems.push({
          name,
          description,
          detailTitle,
          detailLines
        })
        continue
      }

      const existingItem = mergedItems[existingIndex]

      if (
        (!existingItem?.description && description) ||
        (!existingItem?.detailTitle && detailTitle) ||
        (!existingItem?.detailLines?.length && detailLines.length > 0)
      ) {
        mergedItems[existingIndex] = {
          ...existingItem,
          description: existingItem?.description || description,
          detailTitle: existingItem?.detailTitle || detailTitle,
          detailLines: existingItem?.detailLines?.length ? existingItem.detailLines : detailLines
        }
      }
    }
  }

  return mergedItems
}

/** 执行 `filterStoryScriptAutocompleteItems` 对应的局部业务逻辑。 @param queryText 调用方传入的 `queryText`。 @param sourceItems 调用方传入的 `sourceItems`。 @returns 计算、查找或构建后的结果。 */
export function filterStoryScriptAutocompleteItems(
  queryText: string,
  sourceItems: StoryScriptAutocompleteItem[]
) {
  const query = queryText.trim().toLowerCase()

  if (!query) {
    return sourceItems
  }

  return sourceItems.filter((item) => {
    const detailTitle = item.detailTitle?.toLowerCase() ?? ""
    const detailText = (item.detailLines ?? []).join(" ").toLowerCase()
    return (
      item.name.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      detailTitle.includes(query) ||
      detailText.includes(query)
    )
  })
}

/** 查找 `StoryScriptPlaceholderAutocompleteState` 对应的数据。 @param source 调用方传入的 `source`。 @param caret 调用方传入的 `caret`。 @returns 计算、查找或构建后的结果。 */
function findStoryScriptPlaceholderAutocompleteState(source: string, caret: number): StoryScriptCommandAutocompleteState | null {
  const beforeCaret = source.slice(0, caret)
  const openPlaceholderIndex = beforeCaret.lastIndexOf("${")

  if (
    openPlaceholderIndex < 0 ||
    beforeCaret.slice(openPlaceholderIndex + 2).includes("}")
  ) {
    return null
  }

  return {
    open: true,
    query: beforeCaret.slice(openPlaceholderIndex + 2),
    replaceStart: openPlaceholderIndex,
    replaceEnd: caret,
    mode: "placeholder"
  }
}

/** 根据当前输入构建 `InvokeTargetAutocompleteItems` 结果。 @param context 调用方传入的 `context`。 @param targetType 调用方传入的 `targetType`。 @returns 计算、查找或构建后的结果。 */
function buildInvokeTargetAutocompleteItems(
  context: StoryScriptInvokeAutocompleteContext,
  targetType: string
) {
  return context.targets
    .filter((target) => target.type === targetType)
    .map((target) => ({
      name: target.eventId,
      description: target.title
        ? `${target.title}${target.params.length ? ` / 参数: ${target.params.map((param) => param.name).join(", ")}` : ""}`
        : (target.params.length ? `参数: ${target.params.map((param) => param.name).join(", ")}` : "被调用事件"),
      detailTitle: `${target.type}.${target.eventId}`,
      detailLines: [
        target.title ? `事件标题：${target.title}` : `事件 ID：${target.eventId}`,
        target.params.length
          ? `必填业务参数：${target.params.map((param) => param.name).join("、")}`
          : "这个事件没有必填业务参数。",
        ...target.params.map((param) => `参数 ${param.name}：${param.description}`),
        "还可以追加一个 delay_hours / delay_days / delay_months / delay_years 作为延迟元参数。",
        "delay_* 只影响调度时间，不会进入目标事件的 ${call.xxx}。"
      ]
    }))
}

/** 根据当前输入构建 `InvokeDelayAutocompleteItems` 结果。 @param targetType 调用方传入的 `targetType`。 @param eventId 调用方传入的 `eventId`。 @returns 计算、查找或构建后的结果。 */
function buildInvokeDelayAutocompleteItems(
  targetType: string,
  eventId: string
): StoryScriptAutocompleteItem[] {
  const invokePrefix = `invoke_once ${targetType} ${eventId}`

  return [
    {
      name: "delay_hours=",
      description: "按游戏内小时延迟调用。",
      detailTitle: `${invokePrefix} delay_hours=...`,
      detailLines: [
        "这是调度元参数，只控制何时入队，不会写入目标事件的 ${call.xxx}。",
        "表达式结果必须是大于等于 0 的整数；delay_hours=0 等同立即入队。",
        "一条 invoke_once 只能写一个 delay_* 字段。"
      ]
    },
    {
      name: "delay_days=",
      description: "按游戏内天数延迟调用。",
      detailTitle: `${invokePrefix} delay_days=...`,
      detailLines: [
        "这是调度元参数，只控制何时入队，不会写入目标事件的 ${call.xxx}。",
        "表达式结果必须是大于等于 0 的整数；按游戏内天数直接换算。",
        "一条 invoke_once 只能写一个 delay_* 字段。"
      ]
    },
    {
      name: "delay_months=",
      description: "按游戏内月份延迟调用。",
      detailTitle: `${invokePrefix} delay_months=...`,
      detailLines: [
        "这是调度元参数，只控制何时入队，不会写入目标事件的 ${call.xxx}。",
        "表达式结果必须是大于等于 0 的整数；按游戏内日历月份计算，并保留当前时分。",
        "如果目标月份没有当前日期，会自动截到该月最后一天。"
      ]
    },
    {
      name: "delay_years=",
      description: "按游戏内年份延迟调用。",
      detailTitle: `${invokePrefix} delay_years=...`,
      detailLines: [
        "这是调度元参数，只控制何时入队，不会写入目标事件的 ${call.xxx}。",
        "表达式结果必须是大于等于 0 的整数；按游戏内日历年份计算，并保留当前时分。",
        "如果目标年份没有当前日期，会自动截到该年的有效日期。"
      ]
    }
  ]
}

/** 根据当前输入构建 `InvokeArgumentAutocompleteItems` 结果。 @param context 调用方传入的 `context`。 @param targetType 调用方传入的 `targetType`。 @param eventId 调用方传入的 `eventId`。 @returns 计算、查找或构建后的结果。 */
function buildInvokeArgumentAutocompleteItems(
  context: StoryScriptInvokeAutocompleteContext,
  targetType: string,
  eventId: string
) {
  const matchedTarget = context.targets.find((target) => {
    return target.type === targetType && target.eventId === eventId
  })

  const paramItems = (matchedTarget?.params ?? []).map((param) => ({
    name: `${param.name}=`,
    description: param.description,
    detailTitle: `${matchedTarget?.type ?? targetType}.${eventId} -> ${param.name}`,
    detailLines: [
      param.description || "这是目标事件要求的业务参数。",
      `目标事件内部可通过 \${call.${param.name}} 读取这个值。`,
      "这是业务参数，会进入调用上下文，不属于调度元参数。"
    ]
  }))

  return mergeStoryScriptAutocompleteItems(
    buildInvokeDelayAutocompleteItems(targetType, eventId),
    paramItems
  )
}

/** 查找 `StoryScriptInvokeAutocompleteState` 对应的数据。 @param source 调用方传入的 `source`。 @param caret 调用方传入的 `caret`。 @param context 调用方传入的 `context`。 @returns 计算、查找或构建后的结果。 */
function findStoryScriptInvokeAutocompleteState(
  source: string,
  caret: number,
  context: StoryScriptInvokeAutocompleteContext
): StoryScriptCommandAutocompleteResult | null {
  const beforeCaret = source.slice(0, caret)
  const lineStart = beforeCaret.lastIndexOf("\n") + 1
  const currentLinePrefix = beforeCaret.slice(lineStart)
  const match = currentLinePrefix.match(/^(\s*)invoke_once(?:\s+([^\s]+))?(?:\s+([^\s]+))?(?:\s+(.*))?$/)

  if (!match) {
    return null
  }

  const targetType = normalizeStoryScriptAutocompleteText(match[2])
  const eventId = normalizeStoryScriptAutocompleteText(match[3])
  const argsPrefix = match[4] ?? ""

  if (!targetType) {
    return {
      items: STORY_SCRIPT_INVOKE_TARGET_TYPE_ITEMS,
      state: {
        open: true,
        query: "",
        replaceStart: caret,
        replaceEnd: caret,
        mode: "invoke_once"
      }
    }
  }

  if (!["chain", "pool", "schedule"].includes(targetType) && !eventId) {
    return {
      items: STORY_SCRIPT_INVOKE_TARGET_TYPE_ITEMS,
      state: {
        open: true,
        query: targetType,
        replaceStart: caret - targetType.length,
        replaceEnd: caret,
        mode: "invoke_once"
      }
    }
  }

  if (!eventId) {
    const itemQuery = currentLinePrefix.split(/\s+/).at(-1) ?? ""
    return {
      items: buildInvokeTargetAutocompleteItems(context, targetType),
      state: {
        open: true,
        query: itemQuery === "invoke_once" || itemQuery === targetType ? "" : itemQuery,
        replaceStart: caret - itemQuery.length,
        replaceEnd: caret,
        mode: "invoke_once"
      }
    }
  }

  const trailingQueryMatch = argsPrefix.match(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*=?[^\s]*)?$/)
  const trailingQuery = trailingQueryMatch?.[1] ?? ""

  return {
    items: buildInvokeArgumentAutocompleteItems(context, targetType, eventId),
    state: {
      open: true,
      query: trailingQuery,
      replaceStart: caret - trailingQuery.length,
      replaceEnd: caret,
      mode: "invoke_once"
    }
  }
}

/** 根据当前上下文解析 `StoryScriptCommandAutocomplete`。 @param source 调用方传入的 `source`。 @param caret 调用方传入的 `caret`。 @param options 调用方传入的 `options`。 @returns 计算、查找或构建后的结果。 */
export function resolveStoryScriptCommandAutocomplete(
  source: string,
  caret: number,
  options?: {
    invokeContext?: StoryScriptInvokeAutocompleteContext
  }
): StoryScriptCommandAutocompleteResult | null {
  const placeholderState = findStoryScriptPlaceholderAutocompleteState(source, caret)
  if (placeholderState) {
    return {
      items: [],
      state: placeholderState
    }
  }

  const invokeContext = options?.invokeContext
  if (!invokeContext) {
    return null
  }

  return findStoryScriptInvokeAutocompleteState(source, caret, invokeContext)
}

/** 执行 `escapeStoryScriptHighlightHtml` 对应的局部业务逻辑。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
function escapeStoryScriptHighlightHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

/** 执行 `pushStoryScriptPlainHighlightToken` 对应的局部业务逻辑。 @param tokens 调用方传入的 `tokens`。 @param text 调用方传入的 `text`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function pushStoryScriptPlainHighlightToken(
  tokens: StoryScriptHighlightToken[],
  text: string
) {
  if (!text) {
    return
  }

  tokens.push({
    text: escapeStoryScriptHighlightHtml(text),
    highlighted: false
  })
}

/** 执行 `pushStoryScriptCodeHighlightTokens` 对应的局部业务逻辑。 @param tokens 调用方传入的 `tokens`。 @param text 调用方传入的 `text`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function pushStoryScriptCodeHighlightTokens(
  tokens: StoryScriptHighlightToken[],
  text: string
) {
  if (!text) {
    return
  }

  let lastIndex = 0

  for (const match of text.matchAll(STORY_SCRIPT_HIGHLIGHT_PATTERN)) {
    const matchIndex = match.index ?? 0
    const matchedText = match[0] ?? ""

    pushStoryScriptPlainHighlightToken(tokens, text.slice(lastIndex, matchIndex))

    tokens.push({
      text: escapeStoryScriptHighlightHtml(matchedText),
      highlighted: true
    })

    lastIndex = matchIndex + matchedText.length
  }

  pushStoryScriptPlainHighlightToken(tokens, text.slice(lastIndex))
}

/** 根据当前输入构建 `StoryScriptHighlightTokens` 结果。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function buildStoryScriptHighlightTokens(value: string): StoryScriptHighlightToken[] {
  const tokens: StoryScriptHighlightToken[] = []
  let segmentStart = 0
  let index = 0
  let activeQuote: "'" | "\"" | "`" | null = null
  let escaping = false

  while (index < value.length) {
    const char = value[index] ?? ""
    const nextChar = value[index + 1] ?? ""

    if (activeQuote) {
      if (escaping) {
        escaping = false
        index += 1
        continue
      }

      if (char === "\\") {
        escaping = true
        index += 1
        continue
      }

      if (char === activeQuote) {
        activeQuote = null
      }

      index += 1
      continue
    }

    if (char === "'" || char === "\"" || char === "`") {
      activeQuote = char
      index += 1
      continue
    }

    if (char === "/" && nextChar === "/") {
      pushStoryScriptCodeHighlightTokens(tokens, value.slice(segmentStart, index))
      const commentStart = index
      index += 2

      while (index < value.length) {
        const commentChar = value[index] ?? ""
        index += 1
        if (commentChar === "\r" || commentChar === "\n") {
          break
        }
      }

      pushStoryScriptPlainHighlightToken(tokens, value.slice(commentStart, index))
      segmentStart = index
      continue
    }

    if (char === "/" && nextChar === "*") {
      pushStoryScriptCodeHighlightTokens(tokens, value.slice(segmentStart, index))
      const commentStart = index
      index += 2

      while (index < value.length) {
        const commentChar = value[index] ?? ""
        const commentNextChar = value[index + 1] ?? ""

        if (commentChar === "*" && commentNextChar === "/") {
          index += 2
          break
        }

        index += 1
      }

      pushStoryScriptPlainHighlightToken(tokens, value.slice(commentStart, index))
      segmentStart = index
      continue
    }

    index += 1
  }

  pushStoryScriptCodeHighlightTokens(tokens, value.slice(segmentStart))

  if (tokens.length === 0) {
    tokens.push({
      text: "",
      highlighted: false
    })
  }

  return tokens
}

/** 根据当前上下文解析 `StoryScriptAutocompletePlacement`。 @param element 调用方传入的 `element`。 @returns 计算、查找或构建后的结果。 */
export function resolveStoryScriptAutocompletePlacement(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") {
    return "bottom" as const
  }

  const rect = element.getBoundingClientRect()
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
  const spaceBelow = viewportHeight - rect.bottom
  const spaceAbove = rect.top

  return spaceBelow < 260 && spaceAbove > spaceBelow ? "top" : "bottom"
}
