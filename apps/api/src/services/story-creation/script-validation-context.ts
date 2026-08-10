/**
 * 草稿脚本校验所需的变量与引用上下文。
 *
 * 本模块从原创作服务按顶层依赖拆出；不会单独写故事文件。
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Annotation, END, START, StateGraph } from "@langchain/langgraph"
import { ChatOpenAI } from "@langchain/openai"
import {
  createStoryScriptValidationContext,
  findStoryRoleReference,
  validateStoryDocument,
  validateStoryScriptContent,
  type AppAiAgentSettings,
  type AppSettingsFile,
  type StoryDocument,
  type StoryDoingDefinition,
  type StoryDoingFile,
  type StoryDoingMenu,
  type StoryEventCollectionType,
  type StoryEventFile,
  type StoryEventLocationAssignment,
  type StoryEventLocationFile,
  type StoryEventTriggerMode,
  type StoryImportantRoleDefinition,
  type StoryItemDefinition,
  type StoryItemsFile,
  type StoryLoopEventFile,
  type StoryLoopRule,
  type StoryNormalRoleDefinition,
  type StoryContactActionLibraryEntry,
  type StoryContactProfile,
  type StoryContactConversationDefinition,
  type StoryContactConversationsFile,
  type StoryContactFile,
  type StoryContactPersonalityDefinition,
  type StoryContactReplyLibraryEntry,
  type StoryContactTalkLibraryEntry,
  type StoryShopProduct,
  type StoryScriptValidationIssue,
  type StoryOnceDialogueDefinition,
  type StoryOnceEventFile,
  type StoryRolesFile,
  type StoryValDefinition,
  type StoryValEntryDefinition,
  type StoryValsFile
} from "@story-mgr/core"
import { FileStoreError, type StoryFileStore } from "@story-mgr/file-store"
import type {
  ApplyStoryCreationDraftRequest,
  ApplyStoryCreationDraftResponse,
  GenerateStoryDialogueRequest,
  GenerateStoryDialogueResponse,
  RunStoryCreationAgentResponse,
  StoryCreationAgentLog,
  StoryCreationAgentRole,
  StoryCreationDraft,
  StoryCreationDraftDoing,
  StoryCreationDraftEvent,
  StoryCreationDraftItem,
  StoryCreationDraftContact,
  StoryCreationDraftContactConversations,
  StoryCreationDraftPresentation,
  StoryCreationDraftRole,
  StoryCreationDraftShop,
  StoryCreationDraftVariable
} from "@story-mgr/shared"
import { z } from "zod"
import {
  createStoryCreationModelConfig,
  type StoryCreationWorkflowObserver,
  type StoryCreationWorkflowOptions
} from "../story-creation-workflow"
import { draftRoleKey, makeLooseId } from "./draft-normalize"

export interface DraftStoryScriptValidationIssue {
  collectionType: StoryCreationDraftEvent["collectionType"]
  eventId: string
  field: string
  message: string
}

export interface DraftScriptValidationTarget {
  collectionType: StoryCreationDraftEvent["collectionType"]
  id: string
}

/**
 * 深拷贝一个变量组，避免临时校验修改正式故事对象。
 * @param group 现有普通/系统变量组。
 * @returns 组和每个变量行的新对象；字段值保持不变。
 */
export function cloneStoryValGroup(group: StoryValDefinition): StoryValDefinition {
  return {
    name: group.name,
    description: group.description,
    vals: group.vals.map((entry) => ({
      name: entry.name,
      description: entry.description,
      value_type: entry.value_type,
      value: entry.value,
      calc_rule: entry.calc_rule
    }))
  }
}

/**
 * 把一个变量组按名称合并进临时校验 Map。
 * @param groups 以小写组名索引的目标 Map，会被本函数更新。
 * @param sourceGroup 待合并组。
 * @returns 无返回值；空组名和同组同名变量会忽略，避免制造重复定义。
 */
export function appendValidationValGroup(
  groups: Map<string, StoryValDefinition>,
  sourceGroup: StoryValDefinition
) {
  const groupName = sourceGroup.name.trim()

  if (!groupName) {
    return
  }

  const groupKey = groupName.toLowerCase()
  const targetGroup = groups.get(groupKey)

  if (!targetGroup) {
    groups.set(groupKey, cloneStoryValGroup(sourceGroup))
    return
  }

  const existingRows = new Set(targetGroup.vals.map((entry) => entry.name.trim().toLowerCase()))
  for (const entry of sourceGroup.vals) {
    const rowName = entry.name.trim()

    if (!rowName || existingRows.has(rowName.toLowerCase())) {
      continue
    }

    targetGroup.vals.push({
      name: entry.name,
      description: entry.description,
      value_type: entry.value_type,
      value: entry.value,
      calc_rule: entry.calc_rule
    })
    existingRows.add(rowName.toLowerCase())
  }
}

/**
 * 建立“当前故事 + 本次草稿变量”的 StoryScript 临时变量表。
 * @param story 当前故事普通变量和系统变量。
 * @param draft AI 草稿变量。
 * @returns 只用于静态校验的 StoryValsFile，不写回任何源文件。
 */
export function buildDraftValidationVals(story: StoryDocument, draft: StoryCreationDraft): StoryValsFile {
  const groups = new Map<string, StoryValDefinition>()

  for (const group of story.vals.variables) {
    appendValidationValGroup(groups, group)
  }

  for (const group of story.systemVals.variables) {
    appendValidationValGroup(groups, group)
  }

  for (const variable of draft.variables) {
    appendValidationValGroup(groups, {
      name: variable.group,
      vals: [{
        name: variable.name,
        description: variable.description,
        value_type: variable.value_type,
        value: variable.value_type === "value" ? variable.value : undefined,
        calc_rule: variable.calc_rule
      }]
    })
  }

  return {
    variables: Array.from(groups.values())
  }
}

/**
 * 收集脚本可引用的全部物品 id。
 * @param story 当前故事。
 * @param draft 待验证草稿。
 * @returns 去重数组，同时包含草稿原 id 和宽松规范 id，支持规范化前校验。
 */
export function collectDraftValidationItemIds(story: StoryDocument, draft: StoryCreationDraft) {
  const itemIds = new Set<string>()

  for (const item of story.items.items) {
    const itemId = item.id.trim()
    if (itemId) {
      itemIds.add(itemId)
    }
  }

  for (const item of draft.items) {
    const itemId = item.id.trim()
    if (!itemId) {
      continue
    }

    itemIds.add(itemId)
    itemIds.add(makeLooseId(itemId))
  }

  return Array.from(itemIds)
}

/**
 * 收集脚本可引用的全部角色 key。
 * @param story 当前普通/重要角色库。
 * @param draft 本次新增角色。
 * @returns `normal:id`/`important:id` 去重数组。
 */
export function collectDraftValidationRoleKeys(story: StoryDocument, draft: StoryCreationDraft) {
  const roleKeys = new Set<string>()

  for (const role of story.roles.normal.roles) {
    const roleId = role.id.trim()
    if (roleId) {
      roleKeys.add(`normal:${roleId}`)
    }
  }

  for (const role of story.roles.important.roles) {
    const roleId = role.id.trim()
    if (roleId) {
      roleKeys.add(`important:${roleId}`)
    }
  }

  for (const role of draft.roles) {
    roleKeys.add(draftRoleKey(role))
  }

  return Array.from(roleKeys)
}

/** @param story 当前故事。@param draft 草稿。@returns 现有与草稿行动 id 的去重数组。 */
export function collectDraftValidationDoingIds(story: StoryDocument, draft: StoryCreationDraft) {
  const doingIds = new Set<string>()

  for (const doing of story.doing.doings) {
    const doingId = doing.id.trim()
    if (doingId) {
      doingIds.add(doingId)
    }
  }

  for (const doing of draft.doing?.doings ?? []) {
    const doingId = doing.id.trim()
    if (!doingId) {
      continue
    }

    doingIds.add(doingId)
    doingIds.add(makeLooseId(doingId))
  }

  return Array.from(doingIds)
}

/** @param story 当前故事。@param draft 草稿。@returns 现有与草稿商城商品 id 的去重数组。 */
export function collectDraftValidationShopProductIds(story: StoryDocument, draft: StoryCreationDraft) {
  const productIds = new Set<string>()

  for (const product of story.shop.products) {
    const productId = product.id.trim()
    if (productId) {
      productIds.add(productId)
    }
  }

  for (const product of draft.shop?.products ?? []) {
    const productId = product.id.trim()
    if (!productId) {
      continue
    }

    productIds.add(productId)
    productIds.add(makeLooseId(productId))
  }

  return Array.from(productIds)
}

/** @param story 当前故事。@param draft 草稿。@returns 现有与草稿联系人剧情 id 的去重数组。 */
export function collectDraftValidationContactConversationIds(story: StoryDocument, draft: StoryCreationDraft) {
  const conversationIds = new Set<string>()

  for (const conversation of story.contactConversations.conversations) {
    const conversationId = conversation.id.trim()
    if (conversationId) {
      conversationIds.add(conversationId)
    }
  }

  for (const conversation of draft.contactConversations?.conversations ?? []) {
    const conversationId = conversation.id.trim()
    if (!conversationId) {
      continue
    }

    conversationIds.add(conversationId)
    conversationIds.add(makeLooseId(conversationId))
  }

  return Array.from(conversationIds)
}

/**
 * 把 StoryScript 底层错误改成给 Agent 阅读的中文位置文本。
 * @param issue 单条脚本校验问题。
 * @returns 有行号时添加“第 N 行”，否则只返回消息。
 */
export function formatStoryScriptIssue(issue: StoryScriptValidationIssue) {
  return issue.lineNumber > 0
    ? `第 ${issue.lineNumber} 行: ${issue.message}`
    : issue.message
}

/**
 * 把底层脚本问题追加到带草稿字段位置的统一列表。
 * @param issues 目标问题数组，会被原地追加。
 * @param target 所属事件集合和 id。
 * @param field 出错字段路径。
 * @param scriptIssues StoryScript 校验器返回的问题。
 * @returns 无返回值。
 */
export function pushDraftScriptValidationIssues(
  issues: DraftStoryScriptValidationIssue[],
  target: DraftScriptValidationTarget,
  field: string,
  scriptIssues: StoryScriptValidationIssue[]
) {
  for (const issue of scriptIssues) {
    issues.push({
      collectionType: target.collectionType,
      eventId: target.id,
      field,
      message: formatStoryScriptIssue(issue)
    })
  }
}

/**
 * 为 invoke 事件建立可读的 `${call.xxx}` 临时变量。
 * @param event 草稿事件。
 * @returns 以 `call.参数名` 为 key、null 为占位值的对象。
 */
export function getDraftEventCallTokens(event: StoryCreationDraftEvent) {
  return Object.fromEntries(
    (event.invoke_params ?? [])
      .map((param) => param.name.trim())
      .filter(Boolean)
      .map((name) => [`call.${name}`, null] as const)
  )
}

/**
 * 为模板校验建立可读的 `${term.xxx}` 称谓 token。
 * @param story 当前故事称谓库。
 * @returns 去掉重复 term 前缀后的 token 占位对象。
 */
export function getStoryReferTokens(story: StoryDocument) {
  return Object.fromEntries(
    story.refer.terms
      .map((term) => term.id.trim().replace(/^term\./, ""))
      .filter(Boolean)
      .map((termId) => [`term.${termId}`, null] as const)
  )
}

/**
 * 创建单事件脚本校验上下文。
 * @param event 当前事件，write 模式会额外开放其 call 参数。
 * @param context 已收集的物品、角色、行动、商品、对话和称谓索引。
 * @param mode read 用于条件表达式，write 用于过程脚本/模板副作用能力。
 * @returns Core StoryScript 校验器可直接使用的上下文。
 */
export function createDraftEventValidationContext(
  event: StoryCreationDraftEvent,
  context: {
    itemIds: string[]
    roleKeys: string[]
    doingIds: string[]
    shopProductIds: string[]
    contactConversationIds: string[]
    referTokens: Record<string, null>
  },
  mode: "read" | "write"
) {
  return createStoryScriptValidationContext({
    values: {
      ...context.referTokens,
      ...(mode === "write" ? getDraftEventCallTokens(event) : {})
    },
    assignableValues: {},
    itemIds: context.itemIds,
    roleKeys: context.roleKeys,
    doingIds: context.doingIds,
    shopProductIds: context.shopProductIds,
    contactConversationIds: context.contactConversationIds,
    bagMode: mode,
    contactMode: mode,
    doingMode: mode,
    shopMode: mode
  })
}

/**
 * 创建不属于具体事件的全局脚本校验上下文。
 * @param context 已收集领域索引和称谓 token。
 * @param mode read 或 write 权限模式。
 * @returns 不包含 `${call.xxx}` 的 Core 校验上下文。
 */
export function createDraftGlobalValidationContext(
  context: {
    itemIds: string[]
    roleKeys: string[]
    doingIds: string[]
    shopProductIds: string[]
    contactConversationIds: string[]
    referTokens: Record<string, null>
  },
  mode: "read" | "write"
) {
  return createStoryScriptValidationContext({
    values: context.referTokens,
    itemIds: context.itemIds,
    roleKeys: context.roleKeys,
    doingIds: context.doingIds,
    shopProductIds: context.shopProductIds,
    contactConversationIds: context.contactConversationIds,
    bagMode: mode,
    contactMode: mode,
    doingMode: mode,
    shopMode: mode
  })
}
