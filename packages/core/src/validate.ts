/**
 * StoryDocument 完整验证的稳定入口。
 *
 * 聚合器负责固定验证顺序和最终 ok 状态；具体规则位于 validation/ 目录。
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
} from "./types"
import { findStoryRoleReference } from "./roles"
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
import type { StoryValsFile } from "./types"
export type { StoryScriptValidationIssue } from "@story-mgr/storyscript"
export type { StoryScriptValidationMode } from "./validation/context"
export {
  validateStoryScriptInvokeReferences
} from "@story-mgr/storyscript"
import {
  buildStoryValidationIndexes,
  collectGlobalValKeys,
  isChainActionNode,
  isChainEventNode,
  pushIssue,
  type EventValidationGroupKey
} from "./validation/context"
import {
  findScheduleDependencyCycle,
  validateContactConfig,
  validateShopConfig,
  validateVariableDefinitions
} from "./validation/domains"
import { validateContactConversationsConfig } from "./validation/contact-conversations"
import {
  validateChainAction,
  validateChainEvent,
  validateDoingConfig,
  validatePoolEvent,
  validateScheduleEvent
} from "./validation/events"

export {
  createStoryScriptValidationContext,
  validateStoryScriptContent
} from "./validation/context"

/**
 * 对一个已经通过持久化 Schema 的 StoryDocument 做跨文件语义校验。
 *
 * @param document 完整故事文档，包含变量、资产、三类事件、联系人、行动与商城数据。
 * @returns `{ ok, issues }`；只要存在 error，ok 就是 false，warning 不影响 ok。
 *
 * 关键顺序：先拆分 chain 事件/行动并一次构建共享索引，再检查事件图和各领域引用，最后校验 calc 与
 * 玩家覆盖字段。函数只读取 document，不自动修复数据，所有问题 path 都指向原文档位置。
 */
export function validateStoryDocument(document: StoryDocument): ValidationResult {
  const issues: ValidationIssue[] = []
  const chainNodes = document.chainEvents
  const chainEvents = chainNodes.filter(isChainEventNode)
  const chainActions = chainNodes.filter(isChainActionNode)
  const poolEvents = document.poolEvents
  const scheduleEvents = document.scheduleEvents
  const chainNodeMap = new Map(chainNodes.map((event) => [event.id, event]))
  const indexes = buildStoryValidationIndexes(document, chainEvents, chainActions)

  if (chainEvents.length === 0) {
    pushIssue(
      issues,
      "warning",
      "story.no-events",
      "The story does not contain any events yet.",
      ["chainEvents"]
    )
  }

  const eventGroups = [
    { key: "chainEvents", events: chainNodes },
    { key: "poolEvents", events: poolEvents },
    { key: "scheduleEvents", events: scheduleEvents }
  ] as const satisfies Array<{
    key: EventValidationGroupKey
    events: StoryAnyEventFile[]
  }>

  for (const group of eventGroups) {
    const seenGroupIds = new Set<string>()

    for (const [eventIndex, event] of group.events.entries()) {
      if (seenGroupIds.has(event.id)) {
        pushIssue(
          issues,
          "error",
          "event.duplicate-id",
          `Duplicate ${group.key} id "${event.id}" detected.`,
          [group.key, String(eventIndex), "id"]
        )
        continue
      }

      seenGroupIds.add(event.id)

      if ("next" in event) {
        for (const [nextIndex, nextId] of event.next.entries()) {
          if (!chainNodeMap.has(nextId)) {
            pushIssue(
              issues,
              "error",
              "event.missing-link",
              `Chain node "${event.id}" points to missing chain node "${nextId}".`,
              [group.key, String(eventIndex), "next", String(nextIndex)]
            )
          }
        }
      }

      if (group.key === "poolEvents") {
        validatePoolEvent(event as StoryPoolEventFile, eventIndex, document, indexes, issues)
      }

      if (group.key === "scheduleEvents") {
        validateScheduleEvent(event as StoryScheduleEventFile, eventIndex, document, indexes, issues)
      }

      if (group.key === "chainEvents" && isChainEventNode(event as StoryChainNodeFile)) {
        validateChainEvent(event as StoryEventFile, eventIndex, document, indexes, issues)
      }

      if (group.key === "chainEvents" && isChainActionNode(event as StoryChainNodeFile)) {
        validateChainAction(
          event as StoryActionFile,
          eventIndex,
          document,
          issues,
          indexes
        )
      }
    }
  }

  const itemIds = new Set(document.items.items.map((item) => item.id.trim()).filter(Boolean))
  for (const [ownerId, bag] of Object.entries(document.initialBags)) {
    for (const [entryIndex, entry] of bag.entries.entries()) {
      const normalizedItemId = entry.item_id.trim()
      if (!itemIds.has(normalizedItemId)) {
        pushIssue(
          issues,
          "error",
          "initial-bag.missing-item",
          `Initial bag "${ownerId}" references missing item "${normalizedItemId}".`,
          ["initialBags", ownerId, "entries", String(entryIndex), "item_id"]
        )
      }
    }
  }

  const scheduleDependencyCycle = findScheduleDependencyCycle(document)
  if (scheduleDependencyCycle) {
    pushIssue(
      issues,
      "error",
      "schedule.dependency-cycle",
      `Schedule event dependencies contain a cycle: ${scheduleDependencyCycle.join(" -> ")}.`,
      ["scheduleEvents"]
    )
  }

  validateVariableDefinitions(document, issues)

  validateContactConfig(document, indexes, issues)
  validateContactConversationsConfig(document, indexes, issues)
  validateDoingConfig(document, indexes, issues)
  validateShopConfig(document, indexes, issues)

  for (const calcIssue of validateStoryValsCalcRules(document.vals)) {
    pushIssue(
      issues,
      "error",
      "vals.calc-rule-invalid",
      `Variable "${calcIssue.groupName}" / "${calcIssue.rowName}" calc_rule is invalid: ${calcIssue.message}`,
      ["vals", String(calcIssue.groupIndex), String(calcIssue.rowIndex), "calc_rule"]
    )
  }

  for (const calcIssue of validateStoryValsCalcRules(document.systemVals)) {
    pushIssue(
      issues,
      "error",
      "system-vals.calc-rule-invalid",
      `System variable "${calcIssue.groupName}" / "${calcIssue.rowName}" calc_rule is invalid: ${calcIssue.message}`,
      ["systemVals", String(calcIssue.groupIndex), String(calcIssue.rowIndex), "calc_rule"]
    )
  }

  const availableGlobalValKeys = collectGlobalValKeys(document)
  const seenPlayerOverrideKeys = new Set<string>()

  for (const [entryIndex, entry] of document.playerOverrideVals.entries.entries()) {
    const normalizedVarKey = entry.var_key.trim()

    if (!availableGlobalValKeys.has(normalizedVarKey)) {
      pushIssue(
        issues,
        "error",
        "player-override.missing-global-var",
        `Player override variable "${normalizedVarKey}" does not exist in global vals.`,
        ["playerOverrideVals", "entries", String(entryIndex), "var_key"]
      )
    }

    if (seenPlayerOverrideKeys.has(normalizedVarKey)) {
      pushIssue(
        issues,
        "warning",
        "player-override.duplicate-var",
        `Player override variable "${normalizedVarKey}" appears more than once.`,
        ["playerOverrideVals", "entries", String(entryIndex), "var_key"]
      )
    } else {
      seenPlayerOverrideKeys.add(normalizedVarKey)
    }

    if (!Number.isInteger(entry.group_no) || entry.group_no < 1) {
      pushIssue(
        issues,
        "error",
        "player-override.invalid-group-no",
        `Player override variable "${normalizedVarKey}" has invalid group_no "${entry.group_no}".`,
        ["playerOverrideVals", "entries", String(entryIndex), "group_no"]
      )
    }

    if (entry.input_type === "select") {
      const seenOptionValues = new Set<string>()
      const usableOptions = entry.input_options.filter((option) => option.value.trim())

      if (usableOptions.length === 0) {
        pushIssue(
          issues,
          "error",
          "player-override.empty-select-options",
          `Player override variable "${normalizedVarKey}" uses select input but has no selectable options.`,
          ["playerOverrideVals", "entries", String(entryIndex), "input_options"]
        )
      }

      for (const [optionIndex, option] of entry.input_options.entries()) {
        const normalizedOptionValue = option.value.trim()

        if (!normalizedOptionValue) {
          pushIssue(
            issues,
            "error",
            "player-override.empty-select-option-value",
            `Player override variable "${normalizedVarKey}" has an empty select option value.`,
            ["playerOverrideVals", "entries", String(entryIndex), "input_options", String(optionIndex), "value"]
          )
          continue
        }

        if (seenOptionValues.has(normalizedOptionValue)) {
          pushIssue(
            issues,
            "error",
            "player-override.duplicate-select-option-value",
            `Player override variable "${normalizedVarKey}" has duplicated select option value "${normalizedOptionValue}".`,
            ["playerOverrideVals", "entries", String(entryIndex), "input_options", String(optionIndex), "value"]
          )
        } else {
          seenOptionValues.add(normalizedOptionValue)
        }
      }
    }
  }

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues
  }
}
