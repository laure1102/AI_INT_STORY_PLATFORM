/**
 * 完整故事验证共用的 StoryScript 上下文与引用索引。
 *
 * 验证开始时只构建一次角色、物品、变量和调用目标索引，后续领域规则复用它，
 * 避免每个事件重新扫描整个故事。
 */
import type {
  StoryAnyEventFile,
  StoryActionFile,
  StoryChainNodeFile,
  StoryDocument,
  StoryEventFile,
  StoryEventPresentation,
  StoryPoolEventFile,
  StoryScheduleEventFile,
  ValidationIssue,
  ValidationResult
} from "../types"
import { findStoryRoleReference } from "../roles"
import {
  DEFAULT_MAX_CALC_NESTING_DEPTH,
  evaluateStoryBooleanExpression,
  validateStoryScript,
  validateStoryScriptInvokeReferences,
  validateStoryTextTemplate,
  validateStoryValsCalcRules
} from "@story-mgr/storyscript"
import type {
  StoryScriptExecutionContext,
  StoryScriptValidationIssue
} from "@story-mgr/storyscript"
import type { StoryValsFile } from "../types"
import { createStoryScriptValidationContext } from "./script-domain-context"
export { createStoryScriptValidationContext } from "./script-domain-context"
export type {
  StoryScriptValidationBagMode,
  StoryScriptValidationContextOptions,
  StoryScriptValidationDoingMode,
  StoryScriptValidationContactMode,
  StoryScriptValidationShopMode
} from "./script-domain-context"
export type { StoryScriptValidationIssue } from "@story-mgr/storyscript"
export {
  validateStoryScriptInvokeReferences
} from "@story-mgr/storyscript"

export type EventValidationGroupKey = "chainEvents" | "poolEvents" | "scheduleEvents" | "doing"
export type PlayableValidationGroupKey = EventValidationGroupKey

/** @param value 未知脚本字段。 @returns 字符串原值，非字符串返回空串。 */
function normalizeStoryScriptText(value: unknown) {
  return typeof value === "string" ? value : ""
}

export interface StoryEventValidationShape {
  id: string
  trigger_mode?: "default" | "condition" | "invoke"
  trigger_expr: string
  invoke_params?: Array<{
    name: string
    descr?: string
  }>
  init_script: string
  end_script: string
  object_keys: string[]
  presentation: StoryEventPresentation
  location: string
}

/**
 * 合并普通变量和系统变量，供 StoryScript 一次读取。
 * @param document 完整故事。 @returns 新的 variables 数组，不修改两个源文件。
 */
function buildCombinedStoryScriptVals(document: StoryDocument): StoryValsFile {
  return {
    variables: [
      ...document.vals.variables,
      ...document.systemVals.variables
    ]
  }
}

/**
 * 收集可在脚本和联系人模块中引用的规范角色 key。
 * @param document 完整故事。 @returns 去空白、忽略空 id 的 Set。
 */
function collectValidationRoleKeys(document: StoryDocument) {
  const keys = new Set<string>()

  for (const role of document.roles.normal.roles) {
    const roleId = role.id.trim()
    if (roleId) {
      keys.add(`normal:${roleId}`)
    }
  }

  for (const role of document.roles.important.roles) {
    const roleId = role.id.trim()
    if (roleId) {
      keys.add(`important:${roleId}`)
    }
  }

  return keys
}

/** @param document 完整故事。 @returns 物品库 id 数组，供领域函数校验引用。 */
function collectValidationItemIds(document: StoryDocument) {
  return document.items.items.map((item) => item.id)
}

/** @param document 完整故事。 @returns 便于 O(1) 查询的物品 id Set。 */
function collectItemIds(document: StoryDocument) {
  return new Set(collectValidationItemIds(document))
}

/** @param document 完整故事。 @returns 玩家行动 id 数组。 */
function collectValidationDoingIds(document: StoryDocument) {
  return document.doing.doings.map((doing) => doing.id)
}

/** @param document 完整故事。 @returns 商城商品 id 数组。 */
function collectValidationShopProductIds(document: StoryDocument) {
  return document.shop.products.map((product) => product.id)
}

/** @param document 完整故事。 @returns 连续联系人剧情 id 数组。 */
function collectValidationContactConversationIds(document: StoryDocument) {
  return document.contactConversations.conversations.map((conversation) => conversation.id)
}

/**
 * 为 `${term.xxx}` 构造校验期占位值。
 *
 * @param document 完整故事。
 * @returns term key 到示例文字的对象；优先 fallback，再选 male/female。
 *
 * 校验只需证明引用存在，不知道玩家性别，因此选择任一可用变体即可。
 */
function collectValidationReferValues(document: StoryDocument) {
  const values: Record<string, unknown> = {}

  for (const term of document.refer.terms) {
    const rawTermId = term.id.trim()
    const termId = rawTermId.startsWith("term.") ? rawTermId.slice("term.".length) : rawTermId
    if (!termId) {
      continue
    }

    values[`term.${termId}`] = term.fallback || term.male || term.female || ""
  }

  return values
}

/**
 * 创建过程脚本的可写校验上下文。
 *
 * @param document 完整故事，提供所有合法领域 id 和 term 值。
 * @param context 调用方额外的 values、assignableValues 和函数。
 * @returns 可试运行 init/end/action 脚本的 StoryScriptExecutionContext。
 */
export function buildValidationScriptContext(
  document: StoryDocument,
  context?: StoryScriptExecutionContext
): StoryScriptExecutionContext {
  return createStoryScriptValidationContext({
    values: {
      ...collectValidationReferValues(document),
      ...(context?.values ?? {})
    },
    assignableValues: {
      ...(context?.assignableValues ?? {})
    },
    functions: {
      ...(context?.functions ?? {})
    },
    itemIds: collectValidationItemIds(document),
    roleKeys: collectValidationRoleKeys(document),
    doingIds: collectValidationDoingIds(document),
    shopProductIds: collectValidationShopProductIds(document),
    contactConversationIds: collectValidationContactConversationIds(document),
    bagMode: "write",
    contactMode: "write",
    doingMode: "write",
    shopMode: "write"
  })
}

/**
 * 创建触发条件和 visible_expr 使用的只读上下文。
 *
 * @param document 完整故事。
 * @returns 只含查询领域函数的上下文；在条件中调用写函数会被解释器判为未知函数。
 */
export function buildValidationReadableContext(document: StoryDocument): StoryScriptExecutionContext {
  return createStoryScriptValidationContext({
    values: collectValidationReferValues(document),
    itemIds: collectValidationItemIds(document),
    roleKeys: collectValidationRoleKeys(document),
    doingIds: collectValidationDoingIds(document),
    shopProductIds: collectValidationShopProductIds(document),
    contactConversationIds: collectValidationContactConversationIds(document),
    bagMode: "read",
    contactMode: "read",
    doingMode: "read",
    shopMode: "read"
  })
}

export type StoryScriptValidationMode = "predicate" | "procedure" | "template"



/**
 * 把解释器抛出的未知错误整理成统一校验问题。
 * @param error catch 捕获的任意值。 @returns 始终包含 lineNumber 和 message 的问题。
 */
function createStoryScriptValidationIssueFromError(error: unknown): StoryScriptValidationIssue {
  if (
    error &&
    typeof error === "object" &&
    "lineNumber" in error &&
    typeof (error as { lineNumber?: unknown }).lineNumber === "number"
  ) {
    return {
      lineNumber: (error as { lineNumber: number }).lineNumber,
      message: error instanceof Error ? error.message : "Script validation failed."
    }
  }

  return {
    lineNumber: 0,
    message: error instanceof Error ? error.message : "Script validation failed."
  }
}

/**
 * 按字段用途选择模板、条件或过程脚本校验器。
 *
 * @param valsFile 合并后的变量文件。
 * @param source 待校验文本。
 * @param mode template/predicate/procedure 三种语义。
 * @param maxDepth calc 最大递归深度。
 * @param context 领域模拟函数与外部值。
 * @returns 问题数组；空白字段直接通过，异常被转换而不会逃逸。
 */
export function validateStoryScriptContent(
  valsFile: StoryValsFile,
  source: string,
  mode: StoryScriptValidationMode,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryScriptExecutionContext
): StoryScriptValidationIssue[] {
  const trimmedSource = normalizeStoryScriptText(source).trim()

  if (!trimmedSource) {
    return []
  }

  if (mode === "template") {
    return validateStoryTextTemplate(source)
  }

  if (mode === "procedure") {
    return validateStoryScript(valsFile, source, maxDepth, context)
  }

  try {
    evaluateStoryBooleanExpression(valsFile, source, maxDepth, context)
    return []
  } catch (error) {
    return [createStoryScriptValidationIssueFromError(error)]
  }
}

/**
 * 为 trigger_mode=invoke 的事件声明 `call.xxx` 只读参数。
 *
 * @param document 完整故事。
 * @param event 当前被调用事件及其 invoke_params。
 * @returns 过程脚本上下文；每个参数先用 null 占位，且不可赋值。
 */
export function buildInvokeScriptContext(
  document: StoryDocument,
  event: StoryEventValidationShape
) {
  const values = Object.fromEntries(
    (event.invoke_params ?? [])
      .map((param) => param.name.trim())
      .filter(Boolean)
      .map((name) => [`call.${name}`, null] as const)
  )

  return buildValidationScriptContext(document, {
    values,
    assignableValues: {}
  })
}

/**
 * 收集三类事件中允许被 invoke_once 调用的目标。
 *
 * @param document 完整故事。
 * @returns 规范 type、eventId 和参数名组成的数组，仅包含 trigger_mode=invoke 的事件。
 */
function buildStoryInvokeValidationTargets(document: StoryDocument) {
  const chainTargets = document.chainEvents
    .filter((event): event is StoryEventFile => isChainEventNode(event) && (event.trigger_mode ?? "default") === "invoke")
    .map((event) => ({
      type: "chain" as const,
      eventId: event.id,
      paramNames: (event.invoke_params ?? []).map((param) => param.name)
    }))

  const poolTargets = document.poolEvents
    .filter((event) => (event.trigger_mode ?? "default") === "invoke")
    .map((event) => ({
      type: "pool" as const,
      eventId: event.id,
      paramNames: (event.invoke_params ?? []).map((param) => param.name)
    }))

  const scheduleTargets = document.scheduleEvents
    .filter((event) => (event.trigger_mode ?? "default") === "invoke")
    .map((event) => ({
      type: "schedule" as const,
      eventId: event.id,
      paramNames: (event.invoke_params ?? []).map((param) => param.name)
    }))

  return [...chainTargets, ...poolTargets, ...scheduleTargets]
}

/**
 * 为 chain action 的 branch 变量建立可读写上下文。
 *
 * @param document 完整故事。
 * @param action 当前行动节点。
 * @returns 含 `branch.变量名` 占位值的过程脚本上下文。
 */
export function buildChainActionScriptContext(
  document: StoryDocument,
  action: StoryActionFile
) {
  const values = Object.fromEntries(
    (action.vars ?? [])
      .map((actionVar) => actionVar.name.trim())
      .filter(Boolean)
      .map((name) => [`branch.${name}`, null] as const)
  )
  const assignableValues = { ...values }

  return buildValidationScriptContext(document, {
    values,
    assignableValues
  })
}

/**
 * 向共享列表追加一条结构统一的验证问题。
 *
 * @param issues 目标问题数组。 @param level error 或 warning。 @param code 稳定错误码。
 * @param message 面向作者的说明。 @param path 在 StoryDocument 中的字段路径。
 * @returns 无返回值；唯一副作用是数组 push。
 */
export function pushIssue(
  issues: ValidationIssue[],
  level: ValidationIssue["level"],
  code: string,
  message: string,
  path: string[]
) {
  issues.push({ level, code, message, path })
}

/**
 * 校验一个显示文本字段，并把 StoryScript 问题改写成 Core ValidationIssue。
 *
 * @param issues 共享问题数组。 @param code 领域错误码。 @param label 用于消息的人类可读字段名。
 * @param value 模板文本。 @param path 原文档字段路径。
 * @returns 无返回值；每个非法占位符追加一条 error。
 */
export function validateTextTemplateField(
  issues: ValidationIssue[],
  code: string,
  label: string,
  value: string,
  path: string[]
) {
  for (const issue of validateStoryTextTemplate(value)) {
    pushIssue(
      issues,
      "error",
      code,
      `${label} template is invalid at line ${issue.lineNumber}: ${issue.message}`,
      path
    )
  }
}

/** @param event chain 节点。 @returns 存在 exec_script 时收窄为 StoryActionFile。 */
export function isChainActionNode(event: StoryChainNodeFile): event is StoryActionFile {
  return "exec_script" in event
}

/** @param event chain 节点。 @returns 有 next 且不是 action 时收窄为 StoryEventFile。 */
export function isChainEventNode(event: StoryChainNodeFile): event is StoryEventFile {
  return "next" in event && !("exec_script" in event)
}

/** @param document 完整故事。 @returns 所有地点 assignment id 的 Set。 */
function collectLocationNames(document: StoryDocument) {
  return new Set(document.eventLocations.assignments.map((assignment) => assignment.id))
}

/**
 * 收集 vals.json5 中全部可引用变量 key。
 * @param document 完整故事。 @returns `组.变量` Set；空名称不加入。
 */
export function collectGlobalValKeys(document: StoryDocument) {
  const keys = new Set<string>()

  for (const group of document.vals.variables) {
    const groupName = group.name.trim()

    for (const row of group.vals) {
      const rowName = row.name.trim()

      if (!groupName || !rowName) {
        continue
      }

      keys.add(`${groupName}.${rowName}`)
    }
  }

  return keys
}

/**
 * 收集可以被脚本直接写入的普通变量 key。
 * @param document 完整故事。 @returns 仅含 value 类型、排除 calc 和 system 的 Set。
 */
function collectWritableGlobalValKeys(document: StoryDocument) {
  const keys = new Set<string>()

  for (const group of document.vals.variables) {
    const groupName = group.name.trim()

    for (const row of group.vals) {
      const rowName = row.name.trim()

      if (!groupName || !rowName || row.value_type !== "value") {
        continue
      }

      keys.add(`${groupName}.${rowName}`)
    }
  }

  return keys
}

export interface StoryValidationIndexes {
  locations: Set<string>
  roleKeys: Set<string>
  itemIds: Set<string>
  scheduleEventIds: Set<string>
  chainEventIds: Set<string>
  chainActionIds: Set<string>
  incomingChainEventCounts: Map<string, number>
  incomingChainActionCounts: Map<string, number>
  invokeTargets: ReturnType<typeof buildStoryInvokeValidationTargets>
  invokeTargetKeys: Set<string>
  scriptVals: StoryValsFile
  readableContext: StoryScriptExecutionContext
  scriptContext: StoryScriptExecutionContext
  writableGlobalValKeys: Set<string>
  doingMenuIds: Set<string>
}

/**
 * 一次性构建完整故事验证所需的共享索引。
 *
 * @param document 完整故事。
 * @param chainEvents 已从 chainNodes 中收窄出的事件节点。
 * @param chainActions 已收窄出的行动节点。
 * @returns 地点/角色/物品/事件 Set、入边计数、invoke 目标和脚本上下文。
 *
 * 先扫描 next 建入边计数，再组合所有 Set。后续每个事件用 O(1) 查询引用，不再为每条对白反复遍历
 * 整个故事；返回对象只含派生数据，不会修改 document。
 */
export function buildStoryValidationIndexes(
  document: StoryDocument,
  chainEvents: StoryEventFile[],
  chainActions: StoryActionFile[]
): StoryValidationIndexes {
  const invokeTargets = buildStoryInvokeValidationTargets(document)
  const incomingChainEventCounts = new Map<string, number>()
  const incomingChainActionCounts = new Map<string, number>()

  for (const event of chainEvents) {
    for (const nextId of event.next) {
      incomingChainEventCounts.set(nextId, (incomingChainEventCounts.get(nextId) ?? 0) + 1)
    }
  }
  for (const action of chainActions) {
    for (const nextId of action.next) {
      incomingChainActionCounts.set(nextId, (incomingChainActionCounts.get(nextId) ?? 0) + 1)
    }
  }

  return {
    locations: collectLocationNames(document),
    roleKeys: collectValidationRoleKeys(document),
    itemIds: collectItemIds(document),
    scheduleEventIds: new Set(document.scheduleEvents.map((event) => event.id)),
    chainEventIds: new Set(chainEvents.map((event) => event.id)),
    chainActionIds: new Set(chainActions.map((event) => event.id)),
    incomingChainEventCounts,
    incomingChainActionCounts,
    invokeTargets,
    invokeTargetKeys: new Set(invokeTargets.map((target) => `${target.type}:${target.eventId}`)),
    scriptVals: buildCombinedStoryScriptVals(document),
    readableContext: buildValidationReadableContext(document),
    scriptContext: buildValidationScriptContext(document),
    writableGlobalValKeys: collectWritableGlobalValKeys(document),
    doingMenuIds: new Set(document.doing.menus.map((menu) => menu.id))
  }
}
