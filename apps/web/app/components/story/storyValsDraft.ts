/**
 * 变量编辑器的草稿类型与转换工具。
 *
 * 输入是 Core 中的变量定义，输出是适合文本框编辑的字符串草稿。
 * 草稿键由弹窗传入的工厂生成；本模块不持有 Vue 响应式状态。
 */
import { formatStoryValInput } from "@story-mgr/core"
import type { StoryValDefinition, StoryValValueType } from "@story-mgr/core"

export interface StoryValRowDraft {
  draftKey: string
  name: string
  description: string
  valueType: StoryValValueType
  valueText: string
  calcRule: string
}

export interface StoryValGroupDraft {
  draftKey: string
  name: string
  description: string
  vals: StoryValRowDraft[]
}

export interface CalcEvaluationResult {
  ok: boolean
  expression: string
  resultText: string
}

export interface CalcValueDisplay {
  ok: boolean
  text: string
  detail?: string
}

/** 将 `StoryValText` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function normalizeStoryValText(value: unknown) {
  return typeof value === "string" ? value : ""
}

/** 将 `StoryValValueType` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @returns 计算、查找或构建后的结果。 */
export function normalizeStoryValValueType(value: unknown): StoryValValueType {
  return value === "calc" ? "calc" : "value"
}

/** 创建一份新的 `EmptyStoryValRow` 数据。 @param nextDraftKey 调用方传入的 `nextDraftKey`。 @returns 计算、查找或构建后的结果。 */
export function createEmptyStoryValRow(nextDraftKey: (prefix: string) => string): StoryValRowDraft {
  return {
    draftKey: nextDraftKey("row"),
    name: "",
    description: "",
    valueType: "value",
    valueText: "",
    calcRule: ""
  }
}

/** 创建一份新的 `EmptyStoryValGroup` 数据。 @param index 调用方传入的 `index`。 @param nextDraftKey 调用方传入的 `nextDraftKey`。 @returns 计算、查找或构建后的结果。 */
export function createEmptyStoryValGroup(
  index: number,
  nextDraftKey: (prefix: string) => string
): StoryValGroupDraft {
  return {
    draftKey: nextDraftKey("group"),
    name: `变量组${index}`,
    description: "",
    vals: []
  }
}

/** 复制 `StoryValGroup`，避免共享可变引用。 @param group 调用方传入的 `group`。 @param nextDraftKey 调用方传入的 `nextDraftKey`。 @returns 计算、查找或构建后的结果。 */
export function cloneStoryValGroup(
  group: StoryValDefinition,
  nextDraftKey: (prefix: string) => string
): StoryValGroupDraft {
  return {
    draftKey: nextDraftKey("group"),
    name: normalizeStoryValText(group.name),
    description: normalizeStoryValText(group.description),
    vals: group.vals.map((row) => ({
      draftKey: nextDraftKey("row"),
      name: normalizeStoryValText(row.name),
      description: normalizeStoryValText(row.description),
      valueType: normalizeStoryValValueType(row.value_type),
      valueText: formatStoryValInput(row.value),
      calcRule: normalizeStoryValText(row.calc_rule)
    }))
  }
}
