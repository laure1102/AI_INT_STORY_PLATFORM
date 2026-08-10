/**
 * 连续联系人剧情（contact_conversations.json5）的验证规则。
 *
 * 本模块检查角色、触发条件、文本模板、节点脚本和 invoke 目标，只向 issues 追加问题，不修改故事。
 */
import type { StoryDocument, ValidationIssue } from "../types"
import {
  DEFAULT_MAX_CALC_NESTING_DEPTH,
  validateStoryScript,
  validateStoryScriptInvokeReferences
} from "@story-mgr/storyscript"
import {
  pushIssue,
  validateStoryScriptContent,
  validateTextTemplateField,
  type StoryValidationIndexes
} from "./context"

/**
 * 验证所有连续联系人剧情节点及其脚本引用。
 *
 * @param document 完整故事文档，输入数据来自 contactConversations。
 * @param indexes 全故事预构建索引和 StoryScript 校验上下文。
 * @param issues 共享问题数组；函数只追加，不清空已有问题。
 * @returns 无返回值。
 *
 * 执行顺序从会话到节点再到玩家选项，生成的 path 与 JSON 层级一致。条件用只读上下文，过程脚本用
 * 可写上下文；`invoke_once` 和结构化 `node.invoke` 分别校验，避免只覆盖其中一种调用方式。
 */
export function validateContactConversationsConfig(
  document: StoryDocument,
  indexes: StoryValidationIndexes,
  issues: ValidationIssue[]
) {
  const roleKeys = indexes.roleKeys
  const valsFile = indexes.scriptVals
  const readableContext = indexes.readableContext
  const scriptContext = indexes.scriptContext
  const invokeTargets = indexes.invokeTargets
  const invokeTargetKeys = indexes.invokeTargetKeys

  for (const [conversationIndex, conversation] of document.contactConversations.conversations.entries()) {
    const conversationPath = ["contactConversations", "conversations", String(conversationIndex)]

    if (!roleKeys.has(conversation.role_key)) {
      pushIssue(issues, "error", "contact-conversation.missing-role", `Contact conversation "${conversation.id}" references unknown role "${conversation.role_key}".`, [...conversationPath, "role_key"])
    }

    if (conversation.trigger_expr.trim()) {
      const triggerIssues = validateStoryScriptContent(
        valsFile,
        conversation.trigger_expr,
        "predicate",
        DEFAULT_MAX_CALC_NESTING_DEPTH,
        readableContext
      )
      for (const issue of triggerIssues) {
        pushIssue(issues, "error", "contact-conversation.trigger-invalid", `Contact conversation "${conversation.id}" trigger_expr is invalid at line ${issue.lineNumber}: ${issue.message}`, [...conversationPath, "trigger_expr"])
      }
    }

    for (const [nodeIndex, node] of conversation.nodes.entries()) {
      const nodePath = [...conversationPath, "nodes", String(nodeIndex)]

      for (const [messageIndex, message] of node.contact_messages.entries()) {
        validateTextTemplateField(
          issues,
          "contact-conversation.message-template-invalid",
          `Contact conversation "${conversation.id}/${node.id}" contact message`,
          message.content,
          [...nodePath, "contact_messages", String(messageIndex), "content"]
        )
      }

      if (node.end_script.trim()) {
        for (const issue of validateStoryScript(valsFile, node.end_script, undefined, scriptContext)) {
          pushIssue(issues, "error", "contact-conversation.end-script-invalid", `Contact conversation "${conversation.id}/${node.id}" end_script is invalid at line ${issue.lineNumber}: ${issue.message}`, [...nodePath, "end_script"])
        }
        for (const issue of validateStoryScriptInvokeReferences(node.end_script, invokeTargets)) {
          pushIssue(issues, "error", "contact-conversation.end-script-invoke-invalid", `Contact conversation "${conversation.id}/${node.id}" end_script invoke_once 引用无效，第 ${issue.lineNumber} 行: ${issue.message}`, [...nodePath, "end_script"])
        }
      }

      if (node.invoke && !invokeTargetKeys.has(`${node.invoke.target_type}:${node.invoke.event_id}`)) {
        pushIssue(issues, "error", "contact-conversation.invoke-missing-event", `Contact conversation "${conversation.id}/${node.id}" references missing invoke event "${node.invoke.target_type}:${node.invoke.event_id}".`, [...nodePath, "invoke", "event_id"])
      }

      for (const [optionIndex, option] of node.player_options.entries()) {
        const optionPath = [...nodePath, "player_options", String(optionIndex)]
        validateTextTemplateField(
          issues,
          "contact-conversation.option-template-invalid",
          `Contact conversation "${conversation.id}/${node.id}" option "${option.id}" text`,
          option.text,
          [...optionPath, "text"]
        )

        if (option.visible_expr.trim()) {
          const visibleIssues = validateStoryScriptContent(
            valsFile,
            option.visible_expr,
            "predicate",
            DEFAULT_MAX_CALC_NESTING_DEPTH,
            readableContext
          )
          for (const issue of visibleIssues) {
            pushIssue(issues, "error", "contact-conversation.option-visible-invalid", `Contact conversation "${conversation.id}/${node.id}" option "${option.id}" visible_expr is invalid at line ${issue.lineNumber}: ${issue.message}`, [...optionPath, "visible_expr"])
          }
        }

        if (option.script.trim()) {
          for (const issue of validateStoryScript(valsFile, option.script, undefined, scriptContext)) {
            pushIssue(issues, "error", "contact-conversation.option-script-invalid", `Contact conversation "${conversation.id}/${node.id}" option "${option.id}" script is invalid at line ${issue.lineNumber}: ${issue.message}`, [...optionPath, "script"])
          }
          for (const issue of validateStoryScriptInvokeReferences(option.script, invokeTargets)) {
            pushIssue(issues, "error", "contact-conversation.option-script-invoke-invalid", `Contact conversation "${conversation.id}/${node.id}" option "${option.id}" script invoke_once 引用无效，第 ${issue.lineNumber} 行: ${issue.message}`, [...optionPath, "script"])
          }
        }
      }
    }
  }
}
