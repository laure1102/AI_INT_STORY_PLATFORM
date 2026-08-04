/**
 * AI 创作上下文的公共预处理工具。
 *
 * 输入来自三处：用户本次创作指令、当前故事文档，以及上一阶段 Agent 生成的草稿。
 * 输出都是普通字符串或搜索词集合，交给变量检索、物品检索和提示词组装模块继续使用。
 * 本模块只负责“把资料变得适合检索和阅读”，不会调用模型、修改草稿，也不会写入故事文件。
 */
import type { StoryDocument } from "@story-mgr/core"
import type { StoryCreationDraft } from "@story-mgr/shared"
import { MAX_ITEM_SEARCH_TERMS } from "./contracts-draft"
import { formatJson, toAgentVisibleDraft } from "./model"

/**
 * 把草稿转换成可以安全放进 Agent 提示词的 JSON 文本。
 *
 * `toAgentVisibleDraft` 会先去掉模型不需要理解的内部字段，`formatJson` 再执行字符数限制。
 * 这里的截断只影响提示词预览，不会修改原始草稿对象。
 *
 * @param draft 上一个 Agent 或前端传入的创作草稿。
 * @param maxChars 允许放入提示词的最大字符数，用于控制上下文体积。
 * @returns 适合直接拼入 prompt 的 JSON 字符串。
 */
export function formatDraftForAgent(draft: StoryCreationDraft, maxChars: number) {
  return formatJson(toAgentVisibleDraft(draft), maxChars)
}

/**
 * 把故事圣经整理成人类和模型都容易阅读的分段文本。
 *
 * 字段名称会被翻译成中文标签，但字段值保持原样。返回值只用于 AI 创作上下文；
 * Runtime 和 Compiler 都不会读取这段格式化文本。
 */
export function formatStoryBible(story: StoryDocument) {
  const bible = story.storyBible
  return [
    `故事背景: ${bible.background}`,
    `金手指: ${bible.golden_finger}`,
    `主角设定: ${bible.protagonist}`,
    `世界规则: ${bible.world_rules}`,
    `故事大纲: ${bible.outline}`,
    `当前篇章: ${bible.current_arc}`,
    `玩法设计: ${bible.gameplay_design}`,
    `文风口味: ${bible.style_guide}`,
    `约束禁忌: ${bible.constraints}`
  ].join("\n")
}

/**
 * 生成变量文件的完整 JSON 预览。
 *
 * 这个预览让 Agent 看见全局变量、玩家覆盖设置和系统变量的原始结构；后续模块还会补一份
 * 更紧凑的索引和少量高相关详情，避免模型只能依赖被截断的 JSON。
 */
export function formatVariables(story: StoryDocument) {
  return formatJson({
    global: story.vals.variables,
    playerOverride: story.playerOverrideVals.entries,
    system: story.systemVals.variables
  }, 9000)
}

/**
 * 把任意变量初始值转换成可参与关键词检索的短文本。
 *
 * 字符串、数字和布尔值直接转换；对象和数组尝试序列化。即使遇到循环引用等异常值，
 * 也只退回普通字符串，不让一次预览失败中断整条 Agent 工作流。
 */
export function formatValuePreview(value: unknown) {
  if (value === undefined) {
    return ""
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

/**
 * 不适合作为本地检索关键词的常见词。
 *
 * 例如“故事”“新增”几乎会命中所有资料，保留它们只会挤掉真正有区分度的关键词。
 * 这不是自然语言停用词全集，只收录当前创作场景中最容易制造噪声的词。
 */
export const COMMON_ITEM_SEARCH_TERMS = new Set([
  "一个",
  "不会",
  "之前",
  "之后",
  "什么",
  "他们",
  "任务",
  "优化",
  "修改",
  "全部",
  "可以",
  "反馈",
  "已有",
  "当前",
  "我们",
  "故事",
  "新增",
  "方式",
  "是否",
  "玩家",
  "生成",
  "用户",
  "角色",
  "规则",
  "设置",
  "这个",
  "进行",
  "选择",
  "通过",
  "需要",
  "剧情",
  "地点",
  "物品",
  "事件",
  "agent",
  "and",
  "for",
  "the",
  "with"
])

/**
 * 规范化并收集一个候选搜索词。
 *
 * 搜索词统一转小写，长度不足两位或属于常见噪声词时会被忽略。使用 `Set` 是为了天然去重，
 * 避免同一个词在长指令中重复出现后被重复计分。
 */
export function appendSearchTerm(terms: Set<string>, rawTerm: string) {
  const term = rawTerm.trim().toLowerCase()

  if (term.length < 2 || COMMON_ITEM_SEARCH_TERMS.has(term)) {
    return
  }

  terms.add(term)
}

/**
 * 从中英文混合文本中提取用于本地相关性排序的关键词。
 *
 * 处理顺序如下：
 * 1. 英文、数字和标识符按连续片段提取，例如 `player_money`。
 * 2. 连续中文除了保留原词，还切出 2～4 字片段，便于“人口统计”匹配“人口”。
 * 3. 每个词经过长度、停用词和去重过滤。
 * 4. 达到上限后停止，防止超长故事大纲让检索时间和评分噪声无限增长。
 *
 * 这只是轻量本地检索，不负责中文分词、向量检索或语义理解。
 */
export function collectSearchTerms(rawText: string) {
  const terms = new Set<string>()
  const normalizedText = rawText.toLowerCase()
  const matches = normalizedText.match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []

  for (const match of matches) {
    appendSearchTerm(terms, match)

    if (/^[\u4e00-\u9fff]+$/.test(match)) {
      for (const size of [2, 3, 4]) {
        for (let index = 0; index <= match.length - size; index += 1) {
          appendSearchTerm(terms, match.slice(index, index + size))
        }
      }
    }

    if (terms.size >= MAX_ITEM_SEARCH_TERMS) {
      break
    }
  }

  return terms
}

/**
 * 汇总一次相关性检索真正关心的创作语料。
 *
 * 用户指令权重最高，但标题、故事圣经和上一阶段草稿也可能包含关键名称。这里故意不加入完整
 * 事件和资产 JSON：那些内容过大，而且会让每个已有名称都变成搜索词，降低相关性排序质量。
 */
export function buildStorySearchCorpus(
  story: StoryDocument,
  instruction: string,
  baseDraft: StoryCreationDraft | null
) {
  const bible = story.storyBible
  return [
    instruction,
    story.story.title,
    story.story.description ?? "",
    ...(story.story.tags ?? []),
    bible.background,
    bible.golden_finger,
    bible.protagonist,
    bible.world_rules,
    bible.outline,
    bible.current_arc,
    bible.gameplay_design,
    bible.style_guide,
    bible.constraints,
    baseDraft ? formatDraftForAgent(baseDraft, 4000) : ""
  ].join("\n")
}
