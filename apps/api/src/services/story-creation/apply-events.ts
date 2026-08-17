/**
 * 把 AI 草稿中的变量和事件转换为 Core 定义的持久化结构。
 *
 * AI 生成的名称、触发方式、角色引用和定时规则可能“看起来合理”却不满足运行时契约。本模块在
 * 纯内存中执行确定性规范化：同一输入永远得到同一输出，并把自动修正写入 warnings。
 *
 * 输入来源：已经通过草稿 Schema 的变量/事件，以及主应用流程建立的可用 id 集合。
 * 输出去向：`apply.ts` 的候选 StoryDocument。
 * 不负责：读取故事、判断用户选中了什么、最终整篇校验、事务写入。
 */
import {
  type StoryEventCollectionType,
  type StoryEventFile,
  type StoryEventTriggerMode,
  type StoryLoopEventFile,
  type StoryLoopRule,
  type StoryOnceEventFile,
  type StoryValEntryDefinition,
  type StoryValsFile
} from "@story-mgr/core"
import type {
  StoryCreationDraftEvent,
  StoryCreationDraftVariable
} from "@story-mgr/shared"
import { getDraftPresentationDialogues, makeLooseId } from "./draft-normalize"
import { normalizeScheduleAt, normalizeScheduleDependencyIds, normalizeSchedulePriority } from "./structured-normalize"

/** 生成变量选择和 warning 使用的稳定 key，格式为 `组名.变量名`。 */
export function draftVariableKey(variable: StoryCreationDraftVariable) {
  return `${variable.group}.${variable.name}`
}

/**
 * 深拷贝可被本流程修改的变量层级。
 *
 * 应用变量时会替换组内 `vals` 数组，因此不能直接操作从 File Store 读取的原对象。只复制本流程
 * 会触碰的 group/entry 层级，既隔离修改，也避免对整篇故事做昂贵的 JSON 序列化克隆。
 */
export function cloneStoryValsFile(vals: StoryValsFile): StoryValsFile {
  return {
    variables: vals.variables.map((group) => ({
      ...group,
      vals: group.vals.map((entry) => ({
        ...entry
      }))
    }))
  }
}

/**
 * 把草稿变量收敛为持久化变量条目。
 *
 * calc 变量必须有计算规则；缺失时无法安全推导值，所以退回普通空值变量并给出 warning。
 * 普通变量则清空 `calc_rule`，避免旧字段残留造成“类型说 value、内容却像 calc”的歧义。
 */
export function toStoryValEntry(
  variable: StoryCreationDraftVariable,
  warnings: string[]
): StoryValEntryDefinition {
  if (variable.value_type === "calc") {
    const calcRule = variable.calc_rule.trim()

    if (!calcRule) {
      warnings.push(`变量 ${draftVariableKey(variable)} 缺少计算规则，已按普通变量写入空值。`)
      return {
        name: variable.name,
        description: variable.description,
        value_type: "value",
        value: null,
        calc_rule: ""
      }
    }

    return {
      name: variable.name,
      description: variable.description,
      value_type: "calc",
      calc_rule: calcRule
    }
  }

  return {
    name: variable.name,
    description: variable.description,
    value_type: "value",
    value: variable.value ?? null,
    calc_rule: ""
  }
}

/**
 * 将一个被选中的草稿变量加入候选 `vals.json5`。
 *
 * system 组由运行时维护，禁止 AI 写入；已有变量也不自动覆盖，避免一份旧草稿抹掉用户当前值。
 * 返回值表示是否真正新增，供 API 统计应用数量。函数只修改传入的候选副本。
 */
export function applyDraftVariable(
  vals: StoryValsFile,
  variable: StoryCreationDraftVariable,
  warnings: string[]
) {
  const key = draftVariableKey(variable)

  if (variable.group === "system") {
    warnings.push(`变量 ${key} 属于 system 组，未自动写入 vals.json5。`)
    return false
  }

  const existingGroup = vals.variables.find((group) => group.name === variable.group)

  if (existingGroup?.vals.some((entry) => entry.name === variable.name)) {
    warnings.push(`变量 ${key} 已存在，未覆盖原值。`)
    return false
  }

  if (existingGroup) {
    existingGroup.vals = [
      ...existingGroup.vals,
      toStoryValEntry(variable, warnings)
    ]
    return true
  }

  vals.variables = [
    ...vals.variables,
    {
      name: variable.group,
      description: "",
      vals: [toStoryValEntry(variable, warnings)]
    }
  ]
  return true
}

/**
 * 把模型生成的自由文本转换为合法 StoryScript 标识符。
 *
 * 非字母数字字符被换成下划线，重复下划线会折叠；若首字符仍不合法则补 `param_`。fallback 保证
 * 空名称也能得到稳定结果，而不是每次随机生成不同参数名。
 */
export function makeIdentifier(rawName: string, fallback: string) {
  const normalizedName = rawName
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
  const withFallback = normalizedName || fallback

  return /^[A-Za-z_]/.test(withFallback) ? withFallback : `param_${withFallback}`
}

/**
 * 规范化 invoke 事件的调用参数，并在单个事件内去重。
 *
 * 名称冲突按 `_2`、`_3` 顺序追加后缀，保证结果稳定。所有重命名都会写入 warnings，方便作者
 * 同步修改调用方脚本；空参数名会被忽略。
 */
export function normalizeInvokeParams(
  event: StoryCreationDraftEvent,
  warnings: string[]
) {
  const usedNames = new Set<string>()

  return (event.invoke_params ?? []).flatMap((param, index) => {
    const originalName = param.name.trim()
    if (!originalName) {
      return []
    }

    const baseName = makeIdentifier(originalName, `arg_${index + 1}`)
    let name = baseName
    let suffix = 2

    while (usedNames.has(name)) {
      name = `${baseName}_${suffix}`
      suffix += 1
    }

    usedNames.add(name)

    if (name !== originalName) {
      warnings.push(`事件 ${event.id} 的调用参数 ${originalName} 已规范为 ${name}。`)
    }

    return [{
      name,
      descr: param.descr
    }]
  })
}

/**
 * 收敛事件触发方式。
 *
 * condition 没有表达式时永远无法按预期判断，因此退回 default 并警告。`invokeParams` 保留在签名中
 * 以兼容现有调用和后续 invoke 规则扩展；当前规则不会因为参数为空而改变 invoke 模式。
 */
export function normalizeTriggerMode(
  event: StoryCreationDraftEvent,
  invokeParams: Array<{ name: string; descr?: string }>,
  warnings: string[]
): StoryEventTriggerMode {
  if (event.trigger_mode === "condition" && !event.trigger_expr.trim()) {
    warnings.push(`事件 ${event.id} 缺少条件表达式，已按默认触发应用。`)
    return "default"
  }

  return event.trigger_mode
}

/**
 * 规范化事件对象引用。
 *
 * `player` 是内建 key；普通/重要角色的 id 使用与草稿其他位置相同的宽松 id 规则。未知命名空间
 * 暂时原样返回，随后由可用角色集合过滤并产生更具体的 warning。
 */
export function normalizeObjectKey(rawKey: string) {
  const trimmedKey = rawKey.trim()

  if (!trimmedKey || trimmedKey === "player") {
    return trimmedKey ? "player" : ""
  }

  const [namespace, rawId] = trimmedKey.split(":")
  if ((namespace === "normal" || namespace === "important") && rawId) {
    const normalizedId = makeLooseId(rawId)
    return normalizedId ? `${namespace}:${normalizedId}` : ""
  }

  return trimmedKey
}

/**
 * 统一事件对象列表与对白说话人。
 *
 * 流程先合并显式 `object_keys` 和对白中实际出现的对象，再过滤不存在的角色。对白说话人若无法
 * 解析，会退回 player，避免运行时播放到该句时找不到显示对象。返回新表现对象，不修改草稿。
 */
export function normalizeEventPeople(
  event: StoryCreationDraftEvent,
  availableRoleKeys: Set<string>,
  warnings: string[]
) {
  const objectKeys = new Set(
    event.object_keys.map(normalizeObjectKey).filter(Boolean)
  )

  for (const dialogue of getDraftPresentationDialogues(event.presentation)) {
    if (dialogue.speaker_type === "object") {
      const speakerKey = normalizeObjectKey(dialogue.speaker_key)
      if (speakerKey) {
        objectKeys.add(speakerKey)
      }
    }
  }

  const filteredObjectKeys = Array.from(objectKeys).filter((objectKey) => {
    if (objectKey === "player" || availableRoleKeys.has(objectKey)) {
      return true
    }

    warnings.push(`事件 ${event.id} 引用了未应用或不存在的角色 ${objectKey}，已从对象列表移除。`)
    return false
  })
  const objectKeySet = new Set(filteredObjectKeys)

  if (event.presentation.type !== "dialogue") {
    return {
      objectKeys: filteredObjectKeys,
      presentation: event.presentation
    }
  }

  const dialogues = event.presentation.dialogues.map((dialogue) => {
    if (dialogue.speaker_type === "player") {
      const { role_name_input: _roleNameInput, ...playerDialogue } = dialogue
      return {
        ...playerDialogue,
        speaker_key: "player" as const
      }
    }

    const speakerKey = normalizeObjectKey(dialogue.speaker_key)
    if (speakerKey && objectKeySet.has(speakerKey)) {
      const rawRoleNameInput = dialogue.role_name_input
      const roleNameInput = rawRoleNameInput
        && speakerKey === normalizeObjectKey(rawRoleNameInput.role_key)
        && speakerKey.startsWith("important:")
        && objectKeySet.has(speakerKey)
        && availableRoleKeys.has(speakerKey)
        ? {
            role_key: speakerKey,
            ...(rawRoleNameInput.prompt?.trim() ? { prompt: rawRoleNameInput.prompt.trim() } : {})
          }
        : undefined
      if (rawRoleNameInput && !roleNameInput) {
        warnings.push(`事件 ${event.id} 的 role_name_input 只能附着在当前对白说话人的 important 角色上，已移除。`)
      }
      return {
        ...dialogue,
        speaker_key: speakerKey,
        ...(roleNameInput ? { role_name_input: roleNameInput } : {})
      }
    }

    warnings.push(`事件 ${event.id} 的对白说话人 ${dialogue.speaker_key} 不可用，已改为 player。`)
    const { role_name_input: _roleNameInput, ...fallbackDialogue } = dialogue
    return {
      ...fallbackDialogue,
      speaker_type: "player" as const,
      speaker_key: "player"
    }
  })

  return {
    objectKeys: filteredObjectKeys,
    presentation: {
      type: "dialogue" as const,
      dialogues
    }
  }
}

/**
 * 把 schedule 草稿规则规范成运行时可调度的完整结构。
 *
 * 缺失 loop 时使用每天 00:00、优先级 100 的保守默认值；不同模式只保留自己需要的日期字段。
 * 同时去重依赖并移除事件对自己的 before/after 引用。跨事件依赖环不在这里猜测修复，而由最终
 * 文档验证明确拒绝。
 */
export function normalizeLoopRule(
  event: StoryCreationDraftEvent,
  warnings: string[]
): StoryLoopRule {
  const loop = event.loop

  if (!loop) {
    warnings.push(`定时事件 ${event.id} 缺少 loop 规则，已使用 daily。`)
    return {
      mode: "daily",
      at: "00:00",
      priority: 100,
      after: [],
      before: []
    }
  }

  const orderFields = {
    at: normalizeScheduleAt(loop.at),
    priority: normalizeSchedulePriority(loop.priority),
    after: normalizeScheduleDependencyIds(loop.after).filter((id) => id !== event.id),
    before: normalizeScheduleDependencyIds(loop.before).filter((id) => id !== event.id)
  }

  if (loop.mode === "weekly") {
    return {
      mode: "weekly",
      ...orderFields,
      weekday: loop.weekday ?? 1
    }
  }

  if (loop.mode === "monthly") {
    return {
      mode: "monthly",
      ...orderFields,
      month_day: loop.month_day ?? 1
    }
  }

  if (loop.mode === "interval_days") {
    return {
      mode: "interval_days",
      ...orderFields,
      interval_days: loop.interval_days ?? 1
    }
  }

  return {
    mode: "daily",
    ...orderFields
  }
}

/**
 * 将一个草稿事件转换为 chain、pool 或 schedule 的持久化事件。
 *
 * 转换顺序：规范参数和触发方式 → 统一对象/对白 → 过滤地点 → 构造三类共用字段 → 补领域字段。
 * chain 会过滤不可用的 `next`；schedule 会补完整 loop；pool/schedule 才写 bgm。所有可恢复问题
 * 进入 warnings，不可恢复的整体结构问题留给候选 StoryDocument 验证。
 */
export function toStoryEvent(
  event: StoryCreationDraftEvent,
  options: {
    availableChainIds: Set<string>
    availableLocationIds: Set<string>
    availableRoleKeys: Set<string>
    warnings: string[]
  }
): {
  collectionType: StoryEventCollectionType
  event: StoryEventFile | StoryOnceEventFile | StoryLoopEventFile
} {
  const invokeParams = normalizeInvokeParams(event, options.warnings)
  const triggerMode = normalizeTriggerMode(event, invokeParams, options.warnings)
  const people = normalizeEventPeople(event, options.availableRoleKeys, options.warnings)
  const location = event.location.trim()

  let normalizedLocation = location
  if (location && !options.availableLocationIds.has(location)) {
    options.warnings.push(`事件 ${event.id} 引用了未应用或不存在的地点 ${location}，已清空地点。`)
    normalizedLocation = ""
  }

  const baseEvent = {
    id: event.id,
    title: event.title,
    trigger_mode: triggerMode,
    trigger_expr: triggerMode === "condition" ? event.trigger_expr : "",
    invoke_params: triggerMode === "invoke" ? invokeParams : [],
    init_script: event.init_script,
    object_keys: people.objectKeys,
    presentation: people.presentation,
    location: normalizedLocation,
    end_script: event.end_script
  }

  if (event.collectionType === "chain") {
    const next = event.next.filter((nextId) => {
      if (options.availableChainIds.has(nextId)) {
        return true
      }

      options.warnings.push(`链式事件 ${event.id} 的后续 ${nextId} 未应用或不存在，已移除该连接。`)
      return false
    })

    return {
      collectionType: "chain",
      event: {
        node_type: "event",
        ...baseEvent,
        next
      }
    }
  }

  if (event.collectionType === "schedule") {
    return {
      collectionType: "schedule",
      event: {
        ...baseEvent,
        bgm: event.bgm ?? "",
        loop: normalizeLoopRule(event, options.warnings)
      }
    }
  }

  return {
    collectionType: "pool",
    event: {
      ...baseEvent,
      bgm: event.bgm ?? ""
    }
  }
}
