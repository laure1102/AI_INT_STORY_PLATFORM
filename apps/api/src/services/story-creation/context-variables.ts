/**
 * 为创作 Agent 检索并格式化故事变量。
 *
 * 输入是当前 `StoryDocument`、用户指令和可选的上一步草稿；输出是提示词文本，不是新的变量文件。
 * 模块会同时提供“完整紧凑索引”和“少量高相关详情”：前者用于确认变量是否存在，后者用于让
 * 模型理解最相关变量的说明、初始值和写权限。这里不会创建、修改或持久化任何变量。
 */
import type {
  StoryDocument,
  StoryValDefinition,
  StoryValEntryDefinition
} from "@story-mgr/core"
import type { StoryCreationDraft } from "@story-mgr/shared"
import { RELEVANT_VARIABLE_DETAIL_LIMIT } from "./contracts-draft"
import {
  buildStorySearchCorpus,
  collectSearchTerms,
  formatValuePreview,
  formatVariables
} from "./context-shared"
import { formatJson, truncateText } from "./model"

/**
 * 生成变量检索使用的语料。
 *
 * 保留这个领域名称明确的入口，调用方不需要知道公共语料如何拼装；变量和物品检索因此可以
 * 独立调整，而不会改变提示词模块的调用方式。
 */
export function buildVariableSearchCorpus(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  return buildStorySearchCorpus(story, instruction, baseDraft)
}

/**
 * 把一个变量的所有可检索字段拼成小写文本。
 *
 * 除变量 key 外还包含说明、计算规则和当前值，因为用户可能只记得“人口结算”这类业务描述，
 * 不知道真实 key 是 `county.population`。
 */
export function buildVariableSearchText(
  sourceLabel: string,
  group: StoryValDefinition,
  entry: StoryValEntryDefinition
) {
  return [
    sourceLabel,
    group.name,
    group.description ?? "",
    entry.name,
    entry.description ?? "",
    entry.value_type,
    entry.calc_rule,
    formatValuePreview(entry.value)
  ].join("\n").toLowerCase()
}

/**
 * 计算一个变量与当前创作需求的相关性分数。
 *
 * 分数只用于本次结果排序，没有业务含义，也不会写入故事数据。完全匹配变量 key 的权重最高；
 * 变量组、说明和计算规则的权重依次降低。较长关键词通常更有区分度，因此部分匹配时得分更高。
 */
export function scoreRelevantVariable(
  sourceLabel: string,
  group: StoryValDefinition,
  entry: StoryValEntryDefinition,
  terms: Set<string>
) {
  if (terms.size === 0) {
    return 0
  }

  const fullKey = `${sourceLabel}.${group.name}.${entry.name}`.toLowerCase()
  const shortKey = `${group.name}.${entry.name}`.toLowerCase()
  const groupName = group.name.toLowerCase()
  const groupDescription = (group.description ?? "").toLowerCase()
  const entryName = entry.name.toLowerCase()
  const entryDescription = (entry.description ?? "").toLowerCase()
  const calcRule = entry.calc_rule.toLowerCase()
  const valuePreview = formatValuePreview(entry.value).toLowerCase()
  const searchText = buildVariableSearchText(sourceLabel, group, entry)
  let score = 0

  for (const term of terms) {
    // 精确命中变量名或完整 key，基本可以确定用户指的就是这个变量。
    if (fullKey === term || shortKey === term || entryName === term) {
      score += 50
      continue
    }

    // 变量组命中比普通正文命中更可靠，但仍可能对应组内多个变量。
    if (groupName === term || groupDescription === term) {
      score += 18
      continue
    }

    if (entryDescription === term) {
      score += 16
      continue
    }

    if (calcRule.includes(term)) {
      score += term.length >= 4 ? 8 : 4
      continue
    }

    if (valuePreview.includes(term)) {
      score += term.length >= 4 ? 8 : 4
      continue
    }

    if (fullKey.includes(term) || shortKey.includes(term) || entryName.includes(term)) {
      score += term.length >= 4 ? 12 : 7
      continue
    }

    if (searchText.includes(term)) {
      score += term.length >= 4 ? 5 : 2
    }
  }

  return score
}

/**
 * 选出最值得放进提示词详细区的变量。
 *
 * 数据流是“提取搜索词 → 扫描 global/system 两类变量 → 评分 → 稳定排序 → 截取固定数量 →
 * 转成 Agent 易读对象”。同分时保持全局变量优先和原文件顺序，保证相同输入得到稳定结果。
 * 返回空数组只代表没有关键词命中，不代表故事里没有变量；完整存在性检查应使用变量索引。
 */
export function selectRelevantVariableDetails(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  const terms = collectSearchTerms(buildVariableSearchCorpus(story, instruction, baseDraft))
  const searchableVariables = [
    ...story.vals.variables.flatMap((group, groupIndex) =>
      group.vals.map((entry, entryIndex) => ({
        source: "global" as const,
        group,
        groupIndex,
        entry,
        entryIndex
      }))
    ),
    ...story.systemVals.variables.flatMap((group, groupIndex) =>
      group.vals.map((entry, entryIndex) => ({
        source: "system" as const,
        group,
        groupIndex,
        entry,
        entryIndex
      }))
    )
  ]

  return searchableVariables
    .map((item) => ({
      ...item,
      score: scoreRelevantVariable(item.source, item.group, item.entry, terms)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      const sourceOrder = left.source === right.source
        ? 0
        : left.source === "global"
          ? -1
          : 1

      return right.score - left.score
        || sourceOrder
        || left.groupIndex - right.groupIndex
        || left.entryIndex - right.entryIndex
    })
    .slice(0, RELEVANT_VARIABLE_DETAIL_LIMIT)
    .map(({ source, group, entry, score }) => ({
      source,
      group: group.name,
      group_description: group.description ?? "",
      key: `${source}.${group.name}.${entry.name}`,
      name: entry.name,
      description: entry.description ?? "",
      value_type: entry.value_type,
      write_permission: getVariableWritePermission(source, entry),
      value: entry.value ?? null,
      calc_rule: entry.calc_rule,
      relevance_score: score
    }))
}

/**
 * 把变量来源和类型翻译成 Agent 可遵守的写权限提示。
 *
 * `system` 变量由运行时维护，`calc` 变量由公式推导，两者都不能在脚本里直接赋值；只有普通
 * global value 变量可写。这里返回的是提示文本，最终安全性仍由 StoryScript 校验器负责。
 */
export function getVariableWritePermission(
  sourceLabel: string,
  entry: Pick<StoryValEntryDefinition, "value_type">
) {
  if (sourceLabel === "system") {
    return "read_only: system"
  }

  if (entry.value_type === "calc") {
    return "read_only: calc"
  }

  return "writable: value"
}

/**
 * 将一类变量压缩成“一行一个变量”的完整索引。
 *
 * 索引故意保留所有变量，但每个值最多展示 120 个字符。这样 Agent 能确认某个 key 是否已经
 * 存在，又不会因为完整对象过大而挤占主要创作指令。
 */
export function formatVariableIndexSection(sourceLabel: string, groups: StoryValDefinition[]) {
  if (groups.length === 0) {
    return `${sourceLabel}: (empty)`
  }

  const lines: string[] = [`${sourceLabel}:`]

  for (const group of groups) {
    for (const entry of group.vals) {
      const preview = entry.value_type === "calc"
        ? truncateText(entry.calc_rule, 120)
        : truncateText(formatValuePreview(entry.value), 120)

      lines.push([
        `${group.name}.${entry.name}`,
        entry.description ?? "",
        entry.value_type,
        getVariableWritePermission(sourceLabel, entry),
        preview || "-"
      ].join(" | "))
    }
  }

  return lines.join("\n")
}

/** 组合全局变量与系统变量的完整紧凑索引。 */
export function formatVariableIndex(story: StoryDocument) {
  return [
    formatVariableIndexSection("global", story.vals.variables),
    "",
    formatVariableIndexSection("system", story.systemVals.variables)
  ].join("\n")
}

/**
 * 生成最终放入 Agent prompt 的变量上下文。
 *
 * 输出按“原始 JSON → 完整索引 → 写入规则 → 高相关详情”排列。即使高相关详情因关键词不足为空，
 * Agent 仍可从完整索引检查现有变量，从而减少重复创建和误写系统变量。
 */
export function formatExistingVariables(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null,
  compact = false
) {
  return [
    formatVariables(story),
    "",
    "variableIndexAll: all existing variables, compact format `group.name | description | value_type | write_permission | value/calc_rule`. Global and system variables are the first place to look before creating new ones.",
    formatVariableIndex(story),
    "",
    "StoryScript write rules: global value variables are writable in init_script/end_script/action.exec_script; global calc variables are read-only derived rules; system.* and call.* are read-only. If a calc aggregate must change, write one or more writable value variables used by its calc_rule.",
    "",
    `relevantVariableDetails: top ${RELEVANT_VARIABLE_DETAIL_LIMIT} local keyword matches with richer fields. Empty does not mean the variable library is empty; use variableIndexAll for full existence checks.`,
    formatJson(selectRelevantVariableDetails(story, instruction, baseDraft), compact ? 8000 : 14000)
  ].join("\n")
}
