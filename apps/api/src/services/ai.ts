/**
 * 地点、角色和物品的 AI 提示词与图片生成入口。
 *
 * 调用方只需要提供应用设置和领域参数，不需要了解具体上游协议。
 */
import type { AppSettingsFile } from "@story-mgr/core"
import { FileStoreError } from "@story-mgr/file-store"
import { Agent, fetch as undiciFetch } from "undici"
import type {
  GeneratedImageResult,
  ItemPromptInput,
  LocationPromptInput,
  OpenAiChatCompletionResponse,
  OpenAiImageGenerationResponse,
  RolePromptInput
} from "./ai-provider"
import {
  buildCompatibleUrl,
  downloadBinary,
  extractTextContent,
  generateMidjourneyImage,
  isDoubaoSeedreamModel,
  isMidjourneyImagineModel,
  postJson,
  requireImageProvider,
  requireTextProvider
} from "./ai-provider"

/**
 * 根据地点资料生成英文绘图提示词。
 *
 * @param settings 应用设置，函数从中读取文本模型 baseUrl、apiKey 和 model。
 * @param input 地点名称、中文描述和可选故事标题。
 * @returns 模型返回并去除首尾空白的英文提示词。
 * @throws 描述为空时抛 400；模型配置缺失时抛 400；上游请求失败或返回空文本时抛 502。
 *
 * 系统提示词限定模型只返回最终绘图文本，用户提示词再提供故事语境。网络响应必须经过
 * `extractTextContent`，兼容字符串和多段 content 两种 OpenAI 风格格式。
 */
export async function generateLocationPrompt(
  settings: AppSettingsFile,
  input: LocationPromptInput
): Promise<string> {
  const ai = requireTextProvider(settings)

  if (!input.descr.trim()) {
    throw new FileStoreError("Location description is required.", 400, "location.descr-required")
  }

  const systemPrompt = [
    "You are a game environment concept prompt designer.",
    "Return only the final English image prompt.",
    "Focus on environment, material, lighting, camera language, mood, and composition.",
    "Keep it suitable for a game background or establishing shot.",
    "Do not add explanation or markdown."
  ].join("\n")

  const userPrompt = [
    `Story title: ${input.storyTitle?.trim() || "Not provided"}`,
    `Location name: ${input.locationName.trim()}`,
    `Location description: ${input.descr.trim()}`
  ].join("\n")

  const payload = await postJson<OpenAiChatCompletionResponse>(
    buildCompatibleUrl(ai.baseUrl, "/chat/completions"),
    ai.apiKey,
    {
      model: ai.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    },
    "ai.text-generation-failed",
    "Failed to generate location prompt"
  )

  const prompt = extractTextContent(payload.choices?.[0]?.message?.content)

  if (!prompt) {
    throw new FileStoreError("AI returned an empty location prompt.", 502, "ai.empty-prompt")
  }

  return prompt
}

/**
 * 根据物品资料生成适合图标或单体资产的英文绘图提示词。
 *
 * @param settings 应用级 AI 设置。
 * @param input 物品名称、分类、描述和可选故事标题。
 * @returns 清理后的英文提示词字符串。
 * @throws 物品描述为空时抛 400；文本模型配置或上游响应异常时抛对应 FileStoreError。
 *
 * 与地点提示词不同，这里的系统要求强调“单个、居中、无手和人物”，避免生成难以裁成游戏资产的图。
 */
export async function generateItemPrompt(
  settings: AppSettingsFile,
  input: ItemPromptInput
): Promise<string> {
  const ai = requireTextProvider(settings)

  if (!input.descr.trim()) {
    throw new FileStoreError("Item description is required.", 400, "item.descr-required")
  }

  const systemPrompt = [
    "You are a game item asset prompt designer.",
    "Return only the final English image prompt.",
    "The prompt should describe a single recognizable game item asset or icon.",
    "Focus on shape, material, color, detail, lighting, and clean presentation.",
    "Keep the item centered, isolated, readable at small size, and without characters or hands.",
    "Do not add explanation or markdown."
  ].join("\n")

  const userPrompt = [
    `Story title: ${input.storyTitle?.trim() || "Not provided"}`,
    `Item name: ${input.itemName.trim()}`,
    `Item category: ${input.categoryName.trim() || "Not provided"}`,
    `Item description: ${input.descr.trim()}`
  ].join("\n")

  const payload = await postJson<OpenAiChatCompletionResponse>(
    buildCompatibleUrl(ai.baseUrl, "/chat/completions"),
    ai.apiKey,
    {
      model: ai.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    },
    "ai.item-text-generation-failed",
    "Failed to generate item prompt"
  )

  const prompt = extractTextContent(payload.choices?.[0]?.message?.content)

  if (!prompt) {
    throw new FileStoreError("AI returned an empty item prompt.", 502, "ai.empty-item-prompt")
  }

  return prompt
}

/**
 * 根据角色资料生成角色设定图或肖像提示词。
 *
 * @param settings 应用级 AI 设置。
 * @param input 角色名、描述、性格、性别策略、重要性和可选故事标题。
 * @returns 模型输出的英文角色提示词。
 * @throws 描述为空时抛 400；模型配置、网络或空响应问题抛 400/502。
 *
 * gender 和 important 会作为明确文字写入用户提示，让模型分别控制性别表现与角色辨识度；函数只
 * 生成文字，不生成或保存图片。
 */
export async function generateRolePrompt(
  settings: AppSettingsFile,
  input: RolePromptInput
): Promise<string> {
  const ai = requireTextProvider(settings)

  if (!input.descr.trim()) {
    throw new FileStoreError("Role description is required.", 400, "role.descr-required")
  }

  const systemPrompt = [
    "You are a game character concept prompt designer.",
    "Return only the final English image prompt.",
    "The prompt should be suitable for a character design sheet or portrait generation.",
    "Describe clothing, age impression, silhouette, facial features, pose tendency, material, and lighting style.",
    "If gender is male or female, explicitly reflect that gender presentation in the prompt.",
    "If gender is common, keep the prompt gender-neutral.",
    "If the role is important, strengthen recognizability and memorable signature traits.",
    "Do not add explanation or markdown."
  ].join("\n")

  const userPrompt = [
    `Story title: ${input.storyTitle?.trim() || "Not provided"}`,
    `Role name: ${input.roleName.trim()}`,
    `Role description: ${input.descr.trim()}`,
    `Role personality: ${input.xingge?.trim() || "Not provided"}`,
    `Generation gender: ${input.gender}`,
    `Important role: ${input.important ? "yes" : "no"}`,
    `Split by gender: ${input.qufenXingbie ? "yes" : "no"}`
  ].join("\n")

  const payload = await postJson<OpenAiChatCompletionResponse>(
    buildCompatibleUrl(ai.baseUrl, "/chat/completions"),
    ai.apiKey,
    {
      model: ai.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    },
    "ai.role-text-generation-failed",
    "Failed to generate role prompt"
  )

  const prompt = extractTextContent(payload.choices?.[0]?.message?.content)

  if (!prompt) {
    throw new FileStoreError("AI returned an empty role prompt.", 502, "ai.empty-role-prompt")
  }

  return prompt
}

/**
 * 调用配置的图片模型生成地点/通用图片二进制。
 *
 * @param settings 应用级图片模型设置。
 * @param prompt 当前资产的主要提示词。
 * @param globalPrompt 编辑器设置的全局画风提示词。
 * @param width 期望宽度，至少按 1 处理。
 * @param height 期望高度，至少按 1 处理。
 * @returns `{ buffer, mimeType }`，由路由交给 File Store 验证并写盘。
 * @throws 提示词为空时抛 400；上游生成、下载或空结果时抛 502。
 *
 * 关键分支：`mj_imagine` 走提交任务再轮询的 Midjourney 协议；其他模型走 OpenAI 兼容图片接口。
 * 豆包返回 URL，因此需要二次下载；常规兼容模型优先读取 base64。这里不信任扩展名，最终图片能否
 * 解码仍由 File Store 中的 Sharp 检查。
 */
export async function generateLocationImage(
  settings: AppSettingsFile,
  prompt: string,
  globalPrompt: string,
  width: number,
  height: number
): Promise<GeneratedImageResult> {
  const ai = requireImageProvider(settings)

  if (!prompt.trim()) {
    throw new FileStoreError("Location prompt is required.", 400, "location.prompt-required")
  }

  if (isMidjourneyImagineModel(ai.model)) {
    return generateMidjourneyImage(settings, prompt, globalPrompt, width, height)
  }

  const finalPrompt = [globalPrompt.trim(), prompt.trim()].filter(Boolean).join("\n")
  const size = `${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`
  const isDoubaoSeedream = isDoubaoSeedreamModel(ai.model)

  const payload = await postJson<OpenAiImageGenerationResponse>(
    buildCompatibleUrl(ai.baseUrl, "/images/generations"),
    ai.apiKey,
    isDoubaoSeedream
      ? {
          model: ai.model,
          prompt: finalPrompt,
          response_format: "url",
          sequential_image_generation: "disabled",
          size,
          stream: false,
          watermark: true
        }
      : {
          model: ai.model,
          prompt: finalPrompt,
          size,
          response_format: "b64_json"
        },
    "ai.image-generation-failed",
    "Failed to generate image"
  )

  const base64 = payload.data?.[0]?.b64_json
  const imageUrl = payload.data?.[0]?.url?.trim()

  if (!base64) {
    if (imageUrl) {
      return downloadBinary(
        imageUrl,
        "ai.image-download-failed",
        "Failed to download generated image"
      )
    }

    throw new FileStoreError("AI returned an empty image.", 502, "ai.empty-image")
  }

  return {
    buffer: Buffer.from(base64, "base64"),
    mimeType: "image/png"
  }
}

/**
 * 生成角色图片，并把性别约束追加到主要提示词。
 *
 * @param settings 应用级图片模型设置。
 * @param prompt 角色自己的提示词。
 * @param globalPrompt 全局画风提示词。
 * @param width 目标宽度。
 * @param height 目标高度。
 * @param gender common 表示不额外限定，male/female 会加入明确的成年性别表现描述。
 * @returns 与通用图片生成相同的二进制结果。
 * @throws 沿用 `generateLocationImage` 的配置、网络和空结果错误。
 *
 * 本函数只负责组装角色特有提示词，具体供应商分流和下载逻辑统一复用通用入口，避免三套实现漂移。
 */
export async function generateRoleImage(
  settings: AppSettingsFile,
  prompt: string,
  globalPrompt: string,
  width: number,
  height: number,
  gender: "common" | "male" | "female"
): Promise<GeneratedImageResult> {
  const genderPromptSuffix =
    gender === "male"
      ? "male character design, masculine traits, adult male presentation"
      : gender === "female"
        ? "female character design, feminine traits, adult female presentation"
        : "full character design"

  return generateLocationImage(
    settings,
    `${prompt.trim()}\n${genderPromptSuffix}`,
    globalPrompt,
    width,
    height
  )
}

/**
 * 生成物品图片，并追加适合游戏物品资产的构图约束。
 *
 * @param settings 应用级图片模型设置。
 * @param prompt 物品主要提示词。
 * @param globalPrompt 全局画风提示词。
 * @param width 目标宽度。
 * @param height 目标高度。
 * @returns 图片 Buffer 和 MIME 类型。
 * @throws 提示词为空时抛 400；其他错误沿用通用图片生成入口。
 *
 * 附加的“居中、孤立、无人和手”约束能让生成结果更容易作为背包图标使用。
 */
export async function generateItemImage(
  settings: AppSettingsFile,
  prompt: string,
  globalPrompt: string,
  width: number,
  height: number
): Promise<GeneratedImageResult> {
  if (!prompt.trim()) {
    throw new FileStoreError("Item prompt is required.", 400, "item.prompt-required")
  }

  return generateLocationImage(
    settings,
    `${prompt.trim()}\nsingle game item asset, centered object, isolated, no people, no hands`,
    globalPrompt,
    width,
    height
  )
}
