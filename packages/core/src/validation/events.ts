/**
 * chain、pool、schedule 与 doing 的事件级验证规则。
 *
 * 共同的表现、对象、地点和脚本检查集中在 validatePlayableEvent，
 * 各事件类型只补充自己的结构差异。
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
export {
  validateStoryScriptInvokeReferences
} from "@story-mgr/storyscript"
import {
  buildChainActionScriptContext,
  buildInvokeScriptContext,
  buildValidationReadableContext,
  buildValidationScriptContext,
  isChainActionNode,
  isChainEventNode,
  pushIssue,
  validateStoryScriptContent,
  validateTextTemplateField,
  type EventValidationGroupKey,
  type PlayableValidationGroupKey,
  type StoryEventValidationShape,
  type StoryValidationIndexes
} from "./context"

/** @param presentation 事件表现配置。 @returns dialogue 类型的对白数组，其他类型返回空数组。 */
function getPresentationDialogues(presentation: StoryEventPresentation) {
  return presentation.type === "dialogue" ? presentation.dialogues : []
}

/**
 * 构造事件字段在 StoryDocument 中的错误路径。
 * @param eventGroupKey 事件集合或 doing。 @param eventIndex 集合索引。 @param segments 子字段。
 * @returns doing 自动插入 `doings` 层，其余直接从集合开始的 path。
 */
function buildEventValidationPath(
  eventGroupKey: EventValidationGroupKey,
  eventIndex: number,
  ...segments: string[]
) {
  if (eventGroupKey === "doing") {
    return ["doing", "doings", String(eventIndex), ...segments]
  }

  return [eventGroupKey, String(eventIndex), ...segments]
}

/**
 * 校验 message 或 dialogue 表现中的所有文本占位符。
 *
 * @param issues 共享问题数组。 @param eventGroupKey 所属集合。 @param eventIndex 事件索引。
 * @param eventId 用于错误消息的事件标签。 @param presentation 表现数据。
 * @returns 无返回值；每个模板问题都保留到具体 content 的路径。
 */
function validatePresentationTemplates(
  issues: ValidationIssue[],
  eventGroupKey: PlayableValidationGroupKey,
  eventIndex: number,
  eventId: string,
  presentation: StoryEventPresentation
) {
  if (presentation.type === "message") {
    for (const issue of validateStoryTextTemplate(presentation.message.content)) {
      pushIssue(
        issues,
        "error",
        `${eventGroupKey}.message-template-invalid`,
        `${eventId} message template is invalid at line ${issue.lineNumber}: ${issue.message}`,
        buildEventValidationPath(eventGroupKey, eventIndex, "presentation", "message", "content")
      )
    }
    return
  }

  const dialogues = getPresentationDialogues(presentation)
  for (const [dialogueIndex, dialogue] of dialogues.entries()) {
    for (const issue of validateStoryTextTemplate(dialogue.content)) {
      pushIssue(
        issues,
        "error",
        `${eventGroupKey}.dialogue-template-invalid`,
        `${eventId} dialogue template is invalid at line ${issue.lineNumber}: ${issue.message}`,
        buildEventValidationPath(
          eventGroupKey,
          eventIndex,
          "presentation",
          "dialogues",
          String(dialogueIndex),
          "content"
        )
      )
    }
  }
}

/**
 * 把集合名映射为稳定错误码前缀和显示标签。
 * @param eventGroupKey chain/pool/schedule/doing。 @returns `{ codePrefix, label }`。
 */
function getEventValidationMeta(eventGroupKey: EventValidationGroupKey) {
  if (eventGroupKey === "chainEvents") {
    return { codePrefix: "chain", label: "Chain event" }
  }

  if (eventGroupKey === "scheduleEvents") {
    return { codePrefix: "schedule", label: "Schedule event" }
  }

  if (eventGroupKey === "doing") {
    return { codePrefix: "doing", label: "Doing" }
  }

  return { codePrefix: "pool", label: "Pool event" }
}

/**
 * 检查 invoke 参数名是否是 StoryScript 可用标识符。
 * @param issues 共享问题数组。 @param eventGroupKey 集合。 @param eventIndex 事件索引。
 * @param event 待检查事件。 @returns 无返回值。
 */
function validateInvokeParamDefinitions(
  issues: ValidationIssue[],
  eventGroupKey: EventValidationGroupKey,
  eventIndex: number,
  event: StoryEventValidationShape
) {
  const { codePrefix, label } = getEventValidationMeta(eventGroupKey)

  for (const [paramIndex, param] of (event.invoke_params ?? []).entries()) {
    const trimmedName = param.name.trim()

    if (!trimmedName) {
      continue
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedName)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.invoke-param-invalid`,
        `${label} "${event.id}" invoke param "${param.name}" must be a valid identifier.`,
        buildEventValidationPath(eventGroupKey, eventIndex, "invoke_params", String(paramIndex), "name")
      )
    }
  }
}

/**
 * 验证 chain/pool/schedule/doing 共用的可播放事件字段。
 *
 * @param event 统一事件形状。 @param eventIndex 所属集合索引。 @param eventGroupKey 集合类型。
 * @param document 完整故事。 @param indexes 预构建引用和脚本上下文。 @param issues 共享问题数组。
 * @returns 无返回值。
 *
 * 顺序为触发条件 → 参数 → init/end 脚本及 invoke → 角色/地点 → speaker → 文本模板。invoke 事件使用
 * call 参数上下文，普通事件使用通用上下文；`player` 是合法内建对象，不要求出现在角色库。
 */
function validatePlayableEvent(
  event: StoryEventValidationShape,
  eventIndex: number,
  eventGroupKey: EventValidationGroupKey,
  document: StoryDocument,
  indexes: StoryValidationIndexes,
  issues: ValidationIssue[]
) {
  const locationNames = indexes.locations
  const allowedSpeakerKeys = new Set(["player", ...event.object_keys])
  const invokeTargets = indexes.invokeTargets
  const triggerMode = event.trigger_mode ?? "default"
  const scriptContext = triggerMode === "invoke"
    ? buildInvokeScriptContext(document, event)
    : indexes.scriptContext
  const scriptVals = indexes.scriptVals
  const { codePrefix, label } = getEventValidationMeta(eventGroupKey)

  if (triggerMode === "condition") {
    if (!event.trigger_expr.trim()) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.trigger-expr-required`,
        `${label} "${event.id}" trigger_expr is required when trigger_mode is condition.`,
        buildEventValidationPath(eventGroupKey, eventIndex, "trigger_expr")
      )
    }

    if (event.trigger_expr.trim()) {
      try {
        evaluateStoryBooleanExpression(
          scriptVals,
          event.trigger_expr,
          undefined,
          indexes.readableContext
        )
      } catch (error) {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.trigger-expr-invalid`,
          `${label} "${event.id}" trigger_expr is invalid: ${error instanceof Error ? error.message : "Validation failed."}`,
          buildEventValidationPath(eventGroupKey, eventIndex, "trigger_expr")
        )
      }
    }
  }

  if (triggerMode === "invoke" && event.trigger_expr.trim()) {
    pushIssue(
      issues,
      "error",
      `${codePrefix}.trigger-expr-not-allowed`,
      `${label} "${event.id}" trigger_expr must stay empty when trigger_mode is invoke.`,
      buildEventValidationPath(eventGroupKey, eventIndex, "trigger_expr")
    )
  }

  validateInvokeParamDefinitions(issues, eventGroupKey, eventIndex, event)

  for (const scriptField of [
    { key: "init_script", value: event.init_script, code: `${codePrefix}.init-script-invalid` },
    { key: "end_script", value: event.end_script, code: `${codePrefix}.end-script-invalid` }
  ] as const) {
    for (const issue of validateStoryScript(
      scriptVals,
      scriptField.value,
      undefined,
      scriptContext
    )) {
      pushIssue(
        issues,
        "error",
        scriptField.code,
        `${label} "${event.id}" ${scriptField.key} is invalid at line ${issue.lineNumber}: ${issue.message}`,
        buildEventValidationPath(eventGroupKey, eventIndex, scriptField.key)
      )
    }

    for (const issue of validateStoryScriptInvokeReferences(scriptField.value, invokeTargets)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.${scriptField.key === "init_script" ? "init" : "end"}-script-invoke-invalid`,
        `${label} "${event.id}" ${scriptField.key} invoke_once 引用无效，第 ${issue.lineNumber} 行: ${issue.message}`,
        buildEventValidationPath(eventGroupKey, eventIndex, scriptField.key)
      )
    }
  }

  for (const [objectIndex, objectKey] of event.object_keys.entries()) {
    if (objectKey !== "player" && !findStoryRoleReference(document.roles, objectKey)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.missing-object`,
        `${label} "${event.id}" references missing object "${objectKey}".`,
        buildEventValidationPath(eventGroupKey, eventIndex, "object_keys", String(objectIndex))
      )
    }
  }

  if (event.location && !locationNames.has(event.location)) {
    pushIssue(
      issues,
      "error",
      `${codePrefix}.missing-location`,
      `${label} "${event.id}" references missing location "${event.location}".`,
      buildEventValidationPath(eventGroupKey, eventIndex, "location")
    )
  }

  const dialogues = getPresentationDialogues(event.presentation)
  for (const [dialogueIndex, dialogue] of dialogues.entries()) {
    const roleNameInput = dialogue.role_name_input
    if (roleNameInput) {
      const roleNamePath = buildEventValidationPath(
        eventGroupKey,
        eventIndex,
        "presentation",
        "dialogues",
        String(dialogueIndex),
        "role_name_input"
      )
      const roleReference = findStoryRoleReference(document.roles, roleNameInput.role_key)
      if (!roleReference || roleReference.scope !== "important") {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.invalid-role-name-input-role`,
          `${label} "${event.id}" role_name_input must reference an existing important role.`,
          [...roleNamePath, "role_key"]
        )
      } else if (dialogue.speaker_type !== "object" || dialogue.speaker_key !== roleReference.key) {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.role-name-input-speaker-mismatch`,
          `${label} "${event.id}" role_name_input must be attached to the same important role dialogue speaker.`,
          roleNamePath
        )
      }

      if (!event.object_keys.includes(roleReference?.key ?? roleNameInput.role_key)) {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.role-name-input-missing-object`,
          `${label} "${event.id}" role_name_input role must be listed in event object_keys.`,
          [...roleNamePath, "role_key"]
        )
      }
    }

    if (dialogue.speaker_type === "player") {
      if (dialogue.speaker_key !== "player") {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.invalid-player-speaker`,
          `${label} "${event.id}" player dialogue must use speaker_key "player".`,
          buildEventValidationPath(
            eventGroupKey,
            eventIndex,
            "presentation",
            "dialogues",
            String(dialogueIndex),
            "speaker_key"
          )
        )
      }
      continue
    }

    if (!allowedSpeakerKeys.has(dialogue.speaker_key)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.invalid-object-speaker`,
        `${label} "${event.id}" dialogue speaker "${dialogue.speaker_key}" is not in the current event objects.`,
        buildEventValidationPath(
          eventGroupKey,
          eventIndex,
          "presentation",
          "dialogues",
          String(dialogueIndex),
          "speaker_key"
        )
      )
    }
  }

  validatePresentationTemplates(
    issues,
    eventGroupKey,
    eventIndex,
    `${label} "${event.id}"`,
    event.presentation
  )
}

/**
 * 验证一个 Doing 可见条件字段。
 * @param source 条件源码。 @param basePath 字段路径。 @param code 错误码。 @param label 显示标签。
 * @param scriptVals 变量。 @param readableContext 只读领域函数。 @param issues 问题数组。
 * @returns 无返回值；空条件直接通过。
 */
function validateDoingPredicateField(
  source: string,
  basePath: string[],
  code: string,
  label: string,
  scriptVals: StoryValsFile,
  readableContext: StoryScriptExecutionContext,
  issues: ValidationIssue[]
) {
  if (!source.trim()) {
    return
  }

  try {
    evaluateStoryBooleanExpression(
      scriptVals,
      source,
      undefined,
      readableContext
    )
  } catch (error) {
    pushIssue(
      issues,
      "error",
      code,
      `${label} is invalid: ${error instanceof Error ? error.message : "Validation failed."}`,
      basePath
    )
  }
}

/**
 * 验证行动菜单树、行动可见条件及行动自身的可播放字段。
 * @param document 完整故事。 @param indexes 菜单/引用/脚本索引。 @param issues 共享问题数组。
 * @returns 无返回值；不会自动修复父菜单或 menu_id。
 */
export function validateDoingConfig(
  document: StoryDocument,
  indexes: StoryValidationIndexes,
  issues: ValidationIssue[]
) {
  const scriptVals = indexes.scriptVals
  const readableContext = indexes.readableContext
  const menuIds = indexes.doingMenuIds

  for (const [menuIndex, menu] of document.doing.menus.entries()) {
    const basePath = ["doing", "menus", String(menuIndex)]

    if (menu.parent_id && !menuIds.has(menu.parent_id)) {
      pushIssue(
        issues,
        "error",
        "doing.menu.missing-parent",
        `Doing menu "${menu.id}" references missing parent menu "${menu.parent_id}".`,
        [...basePath, "parent_id"]
      )
    }

    if (menu.parent_id === menu.id) {
      pushIssue(
        issues,
        "error",
        "doing.menu.self-parent",
        `Doing menu "${menu.id}" cannot use itself as parent.`,
        [...basePath, "parent_id"]
      )
    }

    validateDoingPredicateField(
      menu.visible_expr,
      [...basePath, "visible_expr"],
      "doing.menu.visible-expr-invalid",
      `Doing menu "${menu.id}" visible_expr`,
      scriptVals,
      readableContext,
      issues
    )
  }

  for (const [doingIndex, doing] of document.doing.doings.entries()) {
    const basePath = ["doing", "doings", String(doingIndex)]

    if (!menuIds.has(doing.menu_id)) {
      pushIssue(
        issues,
        "error",
        "doing.missing-menu",
        `Doing "${doing.id}" references missing menu "${doing.menu_id}".`,
        [...basePath, "menu_id"]
      )
    }

    validateDoingPredicateField(
      doing.visible_expr,
      [...basePath, "visible_expr"],
      "doing.visible-expr-invalid",
      `Doing "${doing.id}" visible_expr`,
      scriptVals,
      readableContext,
      issues
    )

    validatePlayableEvent(
      {
        ...doing,
        trigger_mode: "default",
        trigger_expr: "",
        invoke_params: []
      },
      doingIndex,
      "doing",
      document,
      indexes,
      issues
    )
  }
}

/**
 * 验证单个 pool 事件的公共播放字段。
 * @param event pool 事件。 @param eventIndex 文件索引。 @param document 完整故事。
 * @param indexes 共享索引。 @param issues 问题数组。 @returns 无返回值。
 */
export function validatePoolEvent(
  event: StoryPoolEventFile,
  eventIndex: number,
  document: StoryDocument,
  indexes: StoryValidationIndexes,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "poolEvents", document, indexes, issues)
}

/**
 * 验证 schedule 事件以及循环时间、优先级和依赖引用。
 *
 * @param event schedule 事件。 @param eventIndex 文件索引。 @param document 完整故事。
 * @param indexes 共享索引。 @param issues 问题数组。 @returns 无返回值。
 *
 * 本函数检查单条依赖的存在性和自依赖；跨多个事件形成的环由 findScheduleDependencyCycle 统一检查。
 */
export function validateScheduleEvent(
  event: StoryScheduleEventFile,
  eventIndex: number,
  document: StoryDocument,
  indexes: StoryValidationIndexes,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "scheduleEvents", document, indexes, issues)

  const schedulePath = ["scheduleEvents", String(eventIndex), "loop"] as const

  if (event.loop.mode === "weekly" && !event.loop.weekday) {
    pushIssue(
      issues,
      "error",
      "schedule.weekday-missing",
      `Schedule event "${event.id}" requires weekday when mode is weekly.`,
      [...schedulePath, "weekday"]
    )
  }

  if (event.loop.mode === "monthly" && !event.loop.month_day) {
    pushIssue(
      issues,
      "error",
      "schedule.month-day-missing",
      `Schedule event "${event.id}" requires month_day when mode is monthly.`,
      [...schedulePath, "month_day"]
    )
  }

  if (event.loop.mode === "interval_days" && !event.loop.interval_days) {
    pushIssue(
      issues,
      "error",
      "schedule.interval-missing",
      `Schedule event "${event.id}" requires interval_days when mode is interval_days.`,
      [...schedulePath, "interval_days"]
    )
  }

  if (event.loop.at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.loop.at)) {
    pushIssue(
      issues,
      "error",
      "schedule.at-invalid",
      `Schedule event "${event.id}" has invalid loop.at. Expected HH:mm, for example 00:00.`,
      [...schedulePath, "at"]
    )
  }

  if (
    event.loop.priority !== undefined
    && (!Number.isFinite(event.loop.priority) || !Number.isInteger(event.loop.priority))
  ) {
    pushIssue(
      issues,
      "error",
      "schedule.priority-invalid",
      `Schedule event "${event.id}" loop.priority must be an integer.`,
      [...schedulePath, "priority"]
    )
  }

  const scheduleEventIds = indexes.scheduleEventIds
  for (const [field, dependencies] of [
    ["after", event.loop.after ?? []],
    ["before", event.loop.before ?? []]
  ] as const) {
    dependencies.forEach((dependencyId, dependencyIndex) => {
      if (dependencyId === event.id) {
        pushIssue(
          issues,
          "error",
          "schedule.dependency-self",
          `Schedule event "${event.id}" cannot depend on itself in loop.${field}.`,
          [...schedulePath, field, String(dependencyIndex)]
        )
        return
      }

      if (!scheduleEventIds.has(dependencyId)) {
        pushIssue(
          issues,
          "error",
          "schedule.dependency-missing",
          `Schedule event "${event.id}" references missing schedule event "${dependencyId}" in loop.${field}.`,
          [...schedulePath, field, String(dependencyIndex)]
        )
      }
    })
  }
}

/**
 * 验证单个 chain 事件的公共播放字段。
 * @param event chain 事件。 @param eventIndex 节点索引。 @param document 完整故事。
 * @param indexes 共享索引。 @param issues 问题数组。 @returns 无返回值。
 */
export function validateChainEvent(
  event: StoryEventFile,
  eventIndex: number,
  document: StoryDocument,
  indexes: StoryValidationIndexes,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "chainEvents", document, indexes, issues)
}

/**
 * 验证 chain 行动节点的图约束、分支变量与执行脚本。
 *
 * @param action 行动节点。 @param actionIndex chainNodes 索引。 @param document 完整故事。
 * @param issues 共享问题数组。 @param indexes 入边计数、节点 id 和脚本上下文。
 * @returns 无返回值。
 *
 * 行动最多一个事件父节点、不能由行动指向、最多一个后继事件。exec_script 在 branch 可写上下文中
 * 试运行，并额外验证 invoke_once 目标。
 */
export function validateChainAction(
  action: StoryActionFile,
  actionIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[],
  indexes: StoryValidationIndexes
) {
  const incomingChainEventCount = indexes.incomingChainEventCounts.get(action.id) ?? 0
  const incomingChainActionCount = indexes.incomingChainActionCounts.get(action.id) ?? 0
  const chainEventIds = indexes.chainEventIds
  const chainActionIds = indexes.chainActionIds
  const invokeTargets = indexes.invokeTargets

  if (incomingChainEventCount > 1) {
      pushIssue(
        issues,
        "error",
        "chain-action.multiple-parents",
        `Chain action "${action.id}" can only have one parent event.`,
        ["chainEvents", String(actionIndex), "id"]
      )
  }

  if (incomingChainActionCount > 0) {
      pushIssue(
        issues,
        "error",
        "chain-action.invalid-parent",
        `Chain action "${action.id}" cannot be linked from another action.`,
        ["chainEvents", String(actionIndex), "id"]
      )
  }

  if (action.next.length > 1) {
      pushIssue(
        issues,
        "error",
        "chain-action.multiple-next",
        `Chain action "${action.id}" can only point to one next event.`,
        ["chainEvents", String(actionIndex), "next"]
      )
  }

  for (const [nextIndex, nextId] of action.next.entries()) {
    if (chainActionIds.has(nextId)) {
        pushIssue(
          issues,
          "error",
          "chain-action.invalid-next-target",
          `Chain action "${action.id}" cannot point to another action "${nextId}".`,
          ["chainEvents", String(actionIndex), "next", String(nextIndex)]
        )
    }

    if (!chainEventIds.has(nextId) && !chainActionIds.has(nextId)) {
      continue
    }
  }

  for (const [varIndex, actionVar] of action.vars.entries()) {
    if (
      action.vars.findIndex((currentVar) => currentVar.name.trim() === actionVar.name.trim()) !== varIndex
    ) {
      pushIssue(
        issues,
        "error",
        "chain-action.duplicate-var",
        `Chain action "${action.id}" has duplicate variable "${actionVar.name}".`,
        ["chainEvents", String(actionIndex), "vars", String(varIndex), "name"]
      )
    }
  }

  for (const issue of validateStoryScript(
    indexes.scriptVals,
    action.exec_script,
    undefined,
    buildChainActionScriptContext(document, action)
  )) {
    pushIssue(
      issues,
      "error",
      "chain-action.exec-script-invalid",
      `Chain action "${action.id}" exec_script is invalid at line ${issue.lineNumber}: ${issue.message}`,
      ["chainEvents", String(actionIndex), "exec_script"]
    )
  }

  for (const issue of validateStoryScriptInvokeReferences(action.exec_script, invokeTargets)) {
    pushIssue(
      issues,
      "error",
      "chain-action.exec-script-invoke-invalid",
      `Chain action "${action.id}" exec_script invoke_once 引用无效，第 ${issue.lineNumber} 行: ${issue.message}`,
      ["chainEvents", String(actionIndex), "exec_script"]
    )
  }
}
