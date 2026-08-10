/**
 * 变量、商城、联系人以及 schedule 依赖的领域验证规则。
 *
 * 每个函数只向 issues 追加问题，不修改 StoryDocument，方便聚合器按固定顺序调用。
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
  buildValidationReadableContext,
  buildValidationScriptContext,
  pushIssue,
  validateStoryScriptContent,
  validateTextTemplateField,
  type StoryValidationIndexes
} from "./context"

/**
 * 检查普通/系统变量组、变量名重复以及跨文件命名冲突。
 *
 * @param document 完整故事变量数据。
 * @param issues 共享问题数组。
 * @returns 无返回值；每个冲突追加 error。
 */
export function validateVariableDefinitions(document: StoryDocument, issues: ValidationIssue[]) {
  /**
   * 校验单个变量文件并收集完整 key。
   * @param valsFile 普通或系统变量文件。 @param rootKey 文档根路径。
   * @param codePrefix 错误码前缀。 @param label 消息标签。 @returns `组.变量` Set。
   */
  function validateFile(
    valsFile: StoryValsFile,
    rootKey: "vals" | "systemVals",
    codePrefix: "vals" | "system-vals",
    label: string
  ) {
    const seenGroups = new Set<string>()
    const keys = new Set<string>()

    for (const [groupIndex, group] of valsFile.variables.entries()) {
      const groupName = group.name.trim()

      if (seenGroups.has(groupName)) {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.duplicate-group`,
          `${label} variable group "${groupName}" appears more than once.`,
          [rootKey, "variables", String(groupIndex), "name"]
        )
      } else {
        seenGroups.add(groupName)
      }

      const seenRows = new Set<string>()
      for (const [rowIndex, row] of group.vals.entries()) {
        const rowName = row.name.trim()

        if (seenRows.has(rowName)) {
          pushIssue(
            issues,
            "error",
            `${codePrefix}.duplicate-variable`,
            `${label} variable "${groupName}.${rowName}" appears more than once in the same group.`,
            [rootKey, "variables", String(groupIndex), "vals", String(rowIndex), "name"]
          )
        } else {
          seenRows.add(rowName)
        }

        if (groupName && rowName) {
          keys.add(`${groupName}.${rowName}`)
        }
      }
    }

    return keys
  }

  const globalKeys = validateFile(document.vals, "vals", "vals", "Global")
  const systemKeys = validateFile(document.systemVals, "systemVals", "system-vals", "System")

  for (const conflictingKey of globalKeys) {
    if (!systemKeys.has(conflictingKey)) {
      continue
    }

    pushIssue(
      issues,
      "error",
      "vals.system-name-conflict",
      `Variable "${conflictingKey}" is declared in both vals.json5 and system_vals.json5.`,
      ["systemVals", "variables"]
    )
  }
}

/**
 * 用深度优先搜索查找 schedule 的 after/before 依赖环。
 *
 * @param document 完整故事，仅读取 scheduleEvents。
 * @returns 首个环的事件 id 路径（首尾相同），无环返回 null。
 *
 * 先把 after 转成“依赖项 → 当前项”的有向边，before 转成“当前项 → 依赖项”。activeIndexes 表示
 * 当前 DFS 栈；再次遇到栈内节点即可从 path 切出完整环，visited 则避免重复搜索已确认无环的分支。
 */
export function findScheduleDependencyCycle(document: StoryDocument): string[] | null {
  const scheduleIds = new Set(document.scheduleEvents.map((event) => event.id))
  const edges = new Map<string, Set<string>>(
    document.scheduleEvents.map((event) => [event.id, new Set<string>()])
  )

  for (const event of document.scheduleEvents) {
    for (const dependencyId of event.loop.after ?? []) {
      if (dependencyId !== event.id && scheduleIds.has(dependencyId)) {
        edges.get(dependencyId)?.add(event.id)
      }
    }

    for (const dependencyId of event.loop.before ?? []) {
      if (dependencyId !== event.id && scheduleIds.has(dependencyId)) {
        edges.get(event.id)?.add(dependencyId)
      }
    }
  }

  const visited = new Set<string>()
  const activeIndexes = new Map<string, number>()
  const path: string[] = []

  /** @param eventId 当前 DFS 节点。 @returns 从此节点发现的环路径，或 null。 */
  function visit(eventId: string): string[] | null {
    const activeIndex = activeIndexes.get(eventId)
    if (activeIndex !== undefined) {
      return [...path.slice(activeIndex), eventId]
    }

    if (visited.has(eventId)) {
      return null
    }

    activeIndexes.set(eventId, path.length)
    path.push(eventId)

    for (const nextId of edges.get(eventId) ?? []) {
      const cycle = visit(nextId)
      if (cycle) {
        return cycle
      }
    }

    path.pop()
    activeIndexes.delete(eventId)
    visited.add(eventId)
    return null
  }

  for (const eventId of scheduleIds) {
    const cycle = visit(eventId)
    if (cycle) {
      return cycle
    }
  }

  return null
}

/**
 * 验证商城货币、分类、商品引用和所有显示条件脚本。
 *
 * @param document 完整故事商城与物品数据。
 * @param indexes 预构建物品、变量和只读脚本上下文。
 * @param issues 共享问题数组。
 * @returns 无返回值；不会调整价格或删除非法商品。
 */
export function validateShopConfig(
  document: StoryDocument,
  indexes: StoryValidationIndexes,
  issues: ValidationIssue[]
) {
  const itemIds = indexes.itemIds
  const valsFile = indexes.scriptVals
  const readableContext = indexes.readableContext
  const writableValKeys = indexes.writableGlobalValKeys
  const currencyKey = document.shop.currency_value_key.trim()
  const giftProductIdsByItemId = new Map<string, string>()

  if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(currencyKey)) {
    pushIssue(
      issues,
      "error",
      "shop.currency-key-invalid",
      `Shop currency_value_key "${currencyKey}" must use group.name format.`,
      ["shop", "currency_value_key"]
    )
  } else if (!writableValKeys.has(currencyKey)) {
    pushIssue(
      issues,
      "error",
      "shop.currency-key-missing",
      `Shop currency_value_key "${currencyKey}" must reference an existing writable value variable in vals.json5.`,
      ["shop", "currency_value_key"]
    )
  }

  for (const [categoryIndex, category] of document.shop.categories.entries()) {
    if (!category.visible_expr.trim()) {
      continue
    }

    const visibleIssues = validateStoryScriptContent(
      valsFile,
      category.visible_expr,
      "predicate",
      DEFAULT_MAX_CALC_NESTING_DEPTH,
      readableContext
    )

    for (const issue of visibleIssues) {
      pushIssue(
        issues,
        "error",
        "shop.category.visible-invalid",
        `Shop category "${category.id}" visible_expr is invalid at line ${issue.lineNumber}: ${issue.message}`,
        ["shop", "categories", String(categoryIndex), "visible_expr"]
      )
    }
  }

  for (const [productIndex, product] of document.shop.products.entries()) {
    if (!itemIds.has(product.item_id)) {
      pushIssue(
        issues,
        "error",
        "shop.product.missing-item",
        `Shop product "${product.id}" references missing item "${product.item_id}".`,
        ["shop", "products", String(productIndex), "item_id"]
      )
    }

    if (product.allow_gift) {
      const existingProductId = giftProductIdsByItemId.get(product.item_id)
      if (existingProductId) {
        pushIssue(
          issues,
          "error",
          "shop.product.duplicate-gift-item",
          `Shop products "${existingProductId}" and "${product.id}" both define gift behavior for item "${product.item_id}".`,
          ["shop", "products", String(productIndex), "item_id"]
        )
      } else {
        giftProductIdsByItemId.set(product.item_id, product.id)
      }
    }

    if (!product.available_expr.trim()) {
      continue
    }

    const availableIssues = validateStoryScriptContent(
      valsFile,
      product.available_expr,
      "predicate",
      DEFAULT_MAX_CALC_NESTING_DEPTH,
      readableContext
    )

    for (const issue of availableIssues) {
      pushIssue(
        issues,
        "error",
        "shop.product.available-invalid",
        `Shop product "${product.id}" available_expr is invalid at line ${issue.lineNumber}: ${issue.message}`,
        ["shop", "products", String(productIndex), "available_expr"]
      )
    }
  }
}

/**
 * 验证联系人配置中的角色、作用域、invoke 和文本模板。
 *
 * @param document 完整故事及 contact.json5 数据。
 * @param indexes 角色、物品、调用目标和脚本索引。
 * @param issues 共享问题数组。
 * @returns 无返回值；按原字段 path 追加 error。
 */
export function validateContactConfig(
  document: StoryDocument,
  indexes: StoryValidationIndexes,
  issues: ValidationIssue[]
) {
  const roleKeys = indexes.roleKeys
  const relationshipTrackIds = new Set<string>(
    document.contact.relationship_tracks.map((track) => track.id).filter((trackId) => trackId !== "none")
  )
  const personalityIds = new Set(
    document.contact.personality_library.map((personality) => personality.id)
  )
  const quickMessageIds = new Set(document.contact.player_quick_messages.map((message) => message.id))
  const talkSuggestionIds = new Set(document.contact.talk_library.map((entry) => entry.id))
  const proactiveSuggestionIds = new Set([...quickMessageIds, ...talkSuggestionIds])
  const itemIds = indexes.itemIds
  const invokeTargetKeys = indexes.invokeTargetKeys
  const readableContext = indexes.readableContext
  const valsFile = indexes.scriptVals

  /**
   * 检查一条联系人话术/行动的 scope 中角色和物品引用。
   * @param scope 条目的可选作用域。 @param basePath 条目文档路径。 @param label 消息名称。
   * @returns 无返回值；缺失引用追加到 issues。
   */
  function validateContactScope(
    scope: {
      role_keys: string[]
      contact_tracks: string[]
      personality_ids: string[]
    },
    basePath: string[],
    label: string
  ) {
    for (const [roleKeyIndex, roleKey] of scope.role_keys.entries()) {
      if (!roleKeys.has(roleKey)) {
        pushIssue(
          issues,
          "error",
          "contact.scope.missing-role",
          `${label} references unknown role "${roleKey}".`,
          [...basePath, "role_keys", String(roleKeyIndex)]
        )
      }
    }

    for (const [trackIndex, trackId] of scope.contact_tracks.entries()) {
      if (trackId === "none") {
        continue
      }

      if (!relationshipTrackIds.has(trackId)) {
        pushIssue(
          issues,
          "error",
          "contact.scope.missing-track",
          `${label} references unknown contact track "${trackId}".`,
          [...basePath, "contact_tracks", String(trackIndex)]
        )
      }
    }

    for (const [personalityIndex, personalityId] of scope.personality_ids.entries()) {
      if (!personalityIds.has(personalityId)) {
        pushIssue(
          issues,
          "error",
          "contact.scope.missing-personality",
          `${label} references unknown personality "${personalityId}".`,
          [...basePath, "personality_ids", String(personalityIndex)]
        )
      }
    }
  }

  /**
   * 检查联系人条目配置的结构化事件调用目标。
   * @param invoke 可选调用配置。 @param basePath 条目路径。 @param label 消息名称。
   * @returns 无返回值；目标未声明为 invoke 事件时追加 error。
   */
  function validateContactInvoke(
    invoke: { target_type: string; event_id: string } | undefined,
    basePath: string[],
    label: string
  ) {
    if (!invoke) {
      return
    }

    if (!invokeTargetKeys.has(`${invoke.target_type}:${invoke.event_id}`)) {
      pushIssue(
        issues,
        "error",
        "contact.invoke.missing-event",
        `${label} references missing invoke event "${invoke.target_type}:${invoke.event_id}".`,
        [...basePath, "event_id"]
      )
    }
  }

  for (const [roleIndex, role] of document.roles.normal.roles.entries()) {
    if (role.contact_track !== "none" && !relationshipTrackIds.has(role.contact_track)) {
      pushIssue(
        issues,
        "error",
        "contact.role.missing-track",
        `Normal role "${role.id}" references unknown contact track "${role.contact_track}".`,
        ["roles", "normal", "roles", String(roleIndex), "contact_track"]
      )
    }

    if (role.xingge_id && !personalityIds.has(role.xingge_id)) {
      pushIssue(
        issues,
        "error",
        "contact.role.missing-personality",
        `Normal role "${role.id}" references unknown personality "${role.xingge_id}".`,
        ["roles", "normal", "roles", String(roleIndex), "xingge_id"]
      )
    }
  }

  for (const [roleIndex, role] of document.roles.important.roles.entries()) {
    if (role.contact_track !== "none" && !relationshipTrackIds.has(role.contact_track)) {
      pushIssue(
        issues,
        "error",
        "contact.role.missing-track",
        `Important role "${role.id}" references unknown contact track "${role.contact_track}".`,
        ["roles", "important", "roles", String(roleIndex), "contact_track"]
      )
    }

    if (role.xingge_id && !personalityIds.has(role.xingge_id)) {
      pushIssue(
        issues,
        "error",
        "contact.role.missing-personality",
        `Important role "${role.id}" references unknown personality "${role.xingge_id}".`,
        ["roles", "important", "roles", String(roleIndex), "xingge_id"]
      )
    }
  }

  for (const [messageIndex, message] of document.contact.player_quick_messages.entries()) {
    validateTextTemplateField(
      issues,
      "contact.quick-message.template-invalid",
      `Contact quick message "${message.id}" text`,
      message.text,
      ["contact", "player_quick_messages", String(messageIndex), "text"]
    )

    for (const [roleKeyIndex, roleKey] of message.available_role_keys.entries()) {
      if (!roleKeys.has(roleKey)) {
        pushIssue(
          issues,
          "error",
          "contact.quick-message.missing-role",
          `Contact quick message "${message.id}" references unknown role "${roleKey}".`,
          ["contact", "player_quick_messages", String(messageIndex), "available_role_keys", String(roleKeyIndex)]
        )
      }
    }
  }

  for (const [entryIndex, entry] of document.contact.talk_library.entries()) {
    validateTextTemplateField(
      issues,
      "contact.talk.template-invalid",
      `Contact talk "${entry.id}" text`,
      entry.text,
      ["contact", "talk_library", String(entryIndex), "text"]
    )

    validateContactScope(
      entry.scope,
      ["contact", "talk_library", String(entryIndex), "scope"],
      `Contact talk "${entry.id}"`
    )
    validateContactInvoke(
      entry.invoke,
      ["contact", "talk_library", String(entryIndex), "invoke"],
      `Contact talk "${entry.id}"`
    )
  }

  for (const [entryIndex, entry] of document.contact.action_library.entries()) {
    validateTextTemplateField(
      issues,
      "contact.action.label-template-invalid",
      `Contact action "${entry.id}" label`,
      entry.label,
      ["contact", "action_library", String(entryIndex), "label"]
    )
    validateTextTemplateField(
      issues,
      "contact.action.text-template-invalid",
      `Contact action "${entry.id}" text`,
      entry.text,
      ["contact", "action_library", String(entryIndex), "text"]
    )

    validateContactScope(
      entry.scope,
      ["contact", "action_library", String(entryIndex), "scope"],
      `Contact action "${entry.id}"`
    )
    validateContactInvoke(
      entry.invoke,
      ["contact", "action_library", String(entryIndex), "invoke"],
      `Contact action "${entry.id}"`
    )

    for (const [costIndex, costItem] of entry.cost_items.entries()) {
      if (!itemIds.has(costItem.item_id)) {
        pushIssue(
          issues,
          "error",
          "contact.action.missing-item",
          `Contact action "${entry.id}" references missing item "${costItem.item_id}".`,
          ["contact", "action_library", String(entryIndex), "cost_items", String(costIndex), "item_id"]
        )
      }
    }
  }

  for (const [entryIndex, entry] of document.contact.reply_library.entries()) {
    for (const [replyIndex, reply] of entry.replies.entries()) {
      validateTextTemplateField(
        issues,
        "contact.reply.template-invalid",
        `Contact reply "${entry.id}" reply`,
        reply,
        ["contact", "reply_library", String(entryIndex), "replies", String(replyIndex)]
      )
    }

    validateContactScope(
      entry.scope,
      ["contact", "reply_library", String(entryIndex), "scope"],
      `Contact reply "${entry.id}"`
    )
  }

  for (const [profileIndex, profile] of document.contact.contact_profiles.entries()) {
    if (!roleKeys.has(profile.role_key)) {
      pushIssue(
        issues,
        "error",
        "contact.contact-profile.missing-role",
        `Contact contact profile "${profile.role_key}" does not exist in roles library.`,
        ["contact", "contact_profiles", String(profileIndex), "role_key"]
      )
    }

    for (const [tag, replies] of Object.entries(profile.reply_by_tag)) {
      for (const [replyIndex, reply] of replies.entries()) {
        validateTextTemplateField(
          issues,
          "contact.contact-profile.reply-template-invalid",
          `Contact contact profile "${profile.role_key}" reply "${tag}"`,
          reply,
          [
            "contact",
            "contact_profiles",
            String(profileIndex),
            "reply_by_tag",
            tag,
            String(replyIndex)
          ]
        )
      }
    }

    for (const [ruleIndex, rule] of profile.proactive_messages.entries()) {
      for (const [messageIndex, message] of rule.messages.entries()) {
        validateTextTemplateField(
          issues,
          "contact.proactive-rule.message-template-invalid",
          `Contact proactive rule "${profile.role_key}/${rule.id}" message`,
          message,
          [
            "contact",
            "contact_profiles",
            String(profileIndex),
            "proactive_messages",
            String(ruleIndex),
            "messages",
            String(messageIndex)
          ]
        )
      }

      const triggerIssues = validateStoryScriptContent(
        valsFile,
        rule.trigger_expr,
        "predicate",
        DEFAULT_MAX_CALC_NESTING_DEPTH,
        readableContext
      )

      for (const triggerIssue of triggerIssues) {
        pushIssue(
          issues,
          "error",
          "contact.proactive-rule.trigger-invalid",
          `Contact proactive rule "${profile.role_key}/${rule.id}" trigger_expr is invalid at line ${triggerIssue.lineNumber}: ${triggerIssue.message}`,
          [
            "contact",
            "contact_profiles",
            String(profileIndex),
            "proactive_messages",
            String(ruleIndex),
            "trigger_expr"
          ]
        )
      }

      for (const [replyIndex, quickMessageId] of rule.reply_quick_message_ids.entries()) {
        if (!proactiveSuggestionIds.has(quickMessageId)) {
          pushIssue(
            issues,
            "error",
            "contact.proactive-rule.missing-quick-message",
            `Contact proactive rule "${profile.role_key}/${rule.id}" references missing reply suggestion "${quickMessageId}".`,
            [
              "contact",
              "contact_profiles",
              String(profileIndex),
              "proactive_messages",
              String(ruleIndex),
              "reply_quick_message_ids",
              String(replyIndex)
            ]
          )
        }
      }
    }
  }

  for (const [tag, replies] of Object.entries(document.contact.fallback_replies)) {
    for (const [replyIndex, reply] of replies.entries()) {
      validateTextTemplateField(
        issues,
        "contact.fallback-reply.template-invalid",
        `Contact fallback reply "${tag}"`,
        reply,
        ["contact", "fallback_replies", tag, String(replyIndex)]
      )
    }
  }
}
