/**
 * 草稿 StoryScript 的确定性校验与保留规则。
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
  type StoryPhoneActionLibraryEntry,
  type StoryPhoneContactProfile,
  type StoryPhoneConversationDefinition,
  type StoryPhoneConversationsFile,
  type StoryPhoneFile,
  type StoryPhonePersonalityDefinition,
  type StoryPhoneReplyLibraryEntry,
  type StoryPhoneTalkLibraryEntry,
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
  StoryCreationDraftPhone,
  StoryCreationDraftPhoneConversations,
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
import { draftEventKey } from "./apply-domain"
import { instructionAllowsScriptRemoval } from "./contracts-draft"
import type { DraftStoryScriptValidationIssue } from "./script-validation-context"
import { buildDraftValidationVals, collectDraftValidationDoingIds, collectDraftValidationItemIds, collectDraftValidationPhoneConversationIds, collectDraftValidationRoleKeys, collectDraftValidationShopProductIds, createDraftEventValidationContext, createDraftGlobalValidationContext, getStoryReferTokens, pushDraftScriptValidationIssues } from "./script-validation-context"

/**
 * 校验事件 message/dialogue 中的 StoryScript 模板占位符。
 * @param vals 合并现有故事和草稿后的临时变量表。
 * @param event 当前草稿事件。
 * @param issues 统一问题列表，会被追加。
 * @param context 领域引用索引。
 * @returns 无返回值；silent 无模板会直接跳过。
 */
export function validateDraftEventPresentationTemplates(
  vals: StoryValsFile,
  event: StoryCreationDraftEvent,
  issues: DraftStoryScriptValidationIssue[],
  context: {
    itemIds: string[]
    roleKeys: string[]
    doingIds: string[]
    shopProductIds: string[]
    phoneConversationIds: string[]
    referTokens: Record<string, null>
  }
) {
  if (event.presentation.type === "message") {
    pushDraftScriptValidationIssues(
      issues,
      event,
      "presentation.message.content",
      validateStoryScriptContent(
        vals,
        event.presentation.message.content,
        "template",
        undefined,
        createDraftEventValidationContext(event, context, "write")
      )
    )
    return
  }

  if (event.presentation.type !== "dialogue") {
    return
  }

  event.presentation.dialogues.forEach((dialogue, index) => {
    pushDraftScriptValidationIssues(
      issues,
      event,
      `presentation.dialogues[${index}].content`,
      validateStoryScriptContent(
        vals,
        dialogue.content,
        "template",
        undefined,
        createDraftEventValidationContext(event, context, "write")
      )
    )
  })
}

/**
 * 校验手机剧情对话中的触发条件、消息模板、选项条件、过程脚本和结束脚本。
 * @param vals 临时变量表。
 * @param draft 完整草稿。
 * @param issues 目标问题数组。
 * @param context 领域引用索引。
 * @returns 无返回值；字段路径会精确到 conversation/node/option 下标。
 */
export function validateDraftPhoneConversationScripts(
  vals: StoryValsFile,
  draft: StoryCreationDraft,
  issues: DraftStoryScriptValidationIssue[],
  context: {
    itemIds: string[]
    roleKeys: string[]
    doingIds: string[]
    shopProductIds: string[]
    phoneConversationIds: string[]
    referTokens: Record<string, null>
  }
) {
  for (const conversation of draft.phoneConversations?.conversations ?? []) {
    const target = {
      collectionType: "pool" as const,
      id: `phone.conversation:${conversation.id}`
    }

    if (conversation.trigger_expr.trim()) {
      pushDraftScriptValidationIssues(
        issues,
        target,
        "trigger_expr",
        validateStoryScriptContent(
          vals,
          conversation.trigger_expr,
          "predicate",
          undefined,
          createDraftGlobalValidationContext(context, "read")
        )
      )
    }

    conversation.nodes.forEach((node, nodeIndex) => {
      node.contact_messages.forEach((message, messageIndex) => {
        pushDraftScriptValidationIssues(
          issues,
          target,
          `nodes[${nodeIndex}].contact_messages[${messageIndex}].content`,
          validateStoryScriptContent(
            vals,
            message.content,
            "template",
            undefined,
            createDraftGlobalValidationContext(context, "write")
          )
        )
      })

      node.player_options.forEach((option, optionIndex) => {
        pushDraftScriptValidationIssues(
          issues,
          target,
          `nodes[${nodeIndex}].player_options[${optionIndex}].text`,
          validateStoryScriptContent(
            vals,
            option.text,
            "template",
            undefined,
            createDraftGlobalValidationContext(context, "write")
          )
        )

        if (option.visible_expr.trim()) {
          pushDraftScriptValidationIssues(
            issues,
            target,
            `nodes[${nodeIndex}].player_options[${optionIndex}].visible_expr`,
            validateStoryScriptContent(
              vals,
              option.visible_expr,
              "predicate",
              undefined,
              createDraftGlobalValidationContext(context, "read")
            )
          )
        }

        pushDraftScriptValidationIssues(
          issues,
          target,
          `nodes[${nodeIndex}].player_options[${optionIndex}].script`,
          validateStoryScriptContent(
            vals,
            option.script,
            "procedure",
            undefined,
            createDraftGlobalValidationContext(context, "write")
          )
        )
      })

      pushDraftScriptValidationIssues(
        issues,
        target,
        `nodes[${nodeIndex}].end_script`,
        validateStoryScriptContent(
          vals,
          node.end_script,
          "procedure",
          undefined,
          createDraftGlobalValidationContext(context, "write")
        )
      )
    })
  }
}

/**
 * 收集整份 AI 草稿中的全部 StoryScript 静态问题。
 * @param story 当前正式故事，为草稿提供已有变量和资产。
 * @param draft 待检查草稿。
 * @returns 带集合、业务 id、字段路径和消息的问题数组。
 *
 * 校验范围包括事件、行动、联系人主动消息、手机剧情和商城。predicate 使用只读上下文；procedure
 * 使用可写上下文。这样同一语法解析器同时阻止条件表达式写变量和过程脚本调用不存在资产。
 */
export function collectDraftStoryScriptValidationIssues(
  story: StoryDocument,
  draft: StoryCreationDraft
) {
  const vals = buildDraftValidationVals(story, draft)
  const validationContext = {
    itemIds: collectDraftValidationItemIds(story, draft),
    roleKeys: collectDraftValidationRoleKeys(story, draft),
    doingIds: collectDraftValidationDoingIds(story, draft),
    shopProductIds: collectDraftValidationShopProductIds(story, draft),
    phoneConversationIds: collectDraftValidationPhoneConversationIds(story, draft),
    referTokens: getStoryReferTokens(story)
  }
  const issues: DraftStoryScriptValidationIssue[] = []

  for (const event of draft.events) {
    if (event.trigger_mode === "condition") {
      if (!event.trigger_expr.trim()) {
        issues.push({
          collectionType: event.collectionType,
          eventId: event.id,
          field: "trigger_expr",
          message: "条件触发事件必须填写 trigger_expr。"
        })
      } else {
        pushDraftScriptValidationIssues(
          issues,
          event,
          "trigger_expr",
          validateStoryScriptContent(
            vals,
            event.trigger_expr,
            "predicate",
            undefined,
            createDraftEventValidationContext(event, validationContext, "read")
          )
        )
      }
    }

    pushDraftScriptValidationIssues(
      issues,
      event,
      "init_script",
      validateStoryScriptContent(
        vals,
        event.init_script,
        "procedure",
        undefined,
        createDraftEventValidationContext(event, validationContext, "write")
      )
    )

    pushDraftScriptValidationIssues(
      issues,
      event,
      "end_script",
      validateStoryScriptContent(
        vals,
        event.end_script,
        "procedure",
        undefined,
        createDraftEventValidationContext(event, validationContext, "write")
      )
    )

    validateDraftEventPresentationTemplates(vals, event, issues, validationContext)
  }

  for (const doing of draft.doing?.menus ?? []) {
    if (!doing.visible_expr.trim()) {
      continue
    }

    pushDraftScriptValidationIssues(
      issues,
      {
        collectionType: "pool",
        id: `doing.menu:${doing.id}`
      },
      "visible_expr",
      validateStoryScriptContent(
        vals,
        doing.visible_expr,
        "predicate",
        undefined,
        createDraftGlobalValidationContext(validationContext, "read")
      )
    )
  }

  for (const doing of draft.doing?.doings ?? []) {
    const target = {
      collectionType: "pool" as const,
      id: `doing:${doing.id}`
    }

    if (doing.visible_expr.trim()) {
      pushDraftScriptValidationIssues(
        issues,
        target,
        "visible_expr",
        validateStoryScriptContent(
          vals,
          doing.visible_expr,
          "predicate",
          undefined,
          createDraftGlobalValidationContext(validationContext, "read")
        )
      )
    }

    pushDraftScriptValidationIssues(
      issues,
      target,
      "init_script",
      validateStoryScriptContent(
        vals,
        doing.init_script,
        "procedure",
        undefined,
        createDraftGlobalValidationContext(validationContext, "write")
      )
    )

    pushDraftScriptValidationIssues(
      issues,
      target,
      "end_script",
      validateStoryScriptContent(
        vals,
        doing.end_script,
        "procedure",
        undefined,
        createDraftGlobalValidationContext(validationContext, "write")
      )
    )
  }

  for (const profile of draft.phone?.contact_profiles ?? []) {
    for (const rule of profile.proactive_messages) {
      pushDraftScriptValidationIssues(
        issues,
        {
          collectionType: "pool",
          id: `phone:${profile.role_key}:${rule.id}`
        },
        "proactive_messages.trigger_expr",
        validateStoryScriptContent(
          vals,
          rule.trigger_expr,
          "predicate",
          undefined,
          createDraftGlobalValidationContext(validationContext, "read")
        )
      )
    }
  }

  validateDraftPhoneConversationScripts(vals, draft, issues, validationContext)

  for (const category of draft.shop?.categories ?? []) {
    if (!category.visible_expr.trim()) {
      continue
    }

    pushDraftScriptValidationIssues(
      issues,
      {
        collectionType: "pool",
        id: `shop.category:${category.id}`
      },
      "visible_expr",
      validateStoryScriptContent(
        vals,
        category.visible_expr,
        "predicate",
        undefined,
        createDraftGlobalValidationContext(validationContext, "read")
      )
    )
  }

  for (const product of draft.shop?.products ?? []) {
    if (!product.available_expr.trim()) {
      continue
    }

    pushDraftScriptValidationIssues(
      issues,
      {
        collectionType: "pool",
        id: `shop.product:${product.id}`
      },
      "available_expr",
      validateStoryScriptContent(
        vals,
        product.available_expr,
        "predicate",
        undefined,
        createDraftGlobalValidationContext(validationContext, "read")
      )
    )
  }

  return issues
}

/**
 * 把草稿脚本问题排成可直接放进“脚本修复 Agent”提示词的编号文本。
 * @param issues 结构化问题数组。
 * @returns 每行包含序号、集合/id、字段和错误消息；空数组返回空字符串。
 */
export function formatDraftStoryScriptValidationIssues(issues: DraftStoryScriptValidationIssue[]) {
  return issues
    .map((issue, index) => {
      return [
        `${index + 1}.`,
        `${issue.collectionType}/${issue.eventId}`,
        issue.field,
        issue.message
      ].join(" ")
    })
    .join("\n")
}

/**
 * 防止反馈优化时模型无意清空旧草稿中的非空脚本。
 * @param baseDraft 用户上一轮草稿；新创作时为 null。
 * @param draft 本轮模型返回草稿。
 * @param instruction 用户反馈，用来判断是否明确要求删除脚本。
 * @returns `{ draft, messages }`：必要时恢复旧脚本后的新草稿，以及每次恢复的说明。
 *
 * 只有同集合同 id 的事件参与保护；逐项比较 init_script/end_script。若旧值非空而新值为空，就恢复
 * 旧值。用户明确写了删除/清空脚本时完全尊重其意图，不执行保护。
 */
export function preserveBaseDraftScripts(
  baseDraft: StoryCreationDraft | null,
  draft: StoryCreationDraft,
  instruction: string
): { draft: StoryCreationDraft; messages: string[] } {
  if (!baseDraft || instructionAllowsScriptRemoval(instruction)) {
    return {
      draft,
      messages: []
    }
  }

  const baseEvents = new Map(
    baseDraft.events.map((event) => [draftEventKey(event), event] as const)
  )
  const messages: string[] = []
  let hasChanges = false

  const events = draft.events.map((event) => {
    const baseEvent = baseEvents.get(draftEventKey(event))

    if (!baseEvent) {
      return event
    }

    let nextEvent = event

    for (const field of ["init_script", "end_script"] as const) {
      const baseScript = baseEvent[field].trim()
      const nextScript = nextEvent[field].trim()

      if (!baseScript || nextScript) {
        continue
      }

      nextEvent = {
        ...nextEvent,
        [field]: baseEvent[field]
      }
      hasChanges = true
      messages.push(
        `已恢复 ${event.collectionType}/${event.id} 的 ${field}：本次反馈未明确要求删脚本，不能把已有非空脚本静默清空。`
      )
    }

    return nextEvent
  })

  return hasChanges
    ? {
        draft: {
          ...draft,
          events
        },
        messages
      }
    : {
        draft,
        messages
      }
}
