/**
 * 故事图片素材请求。
 *
 * 上传、生成和压缩会修改故事目录，所以经过修订号队列；读取元数据和拼接
 * 预览 URL 是只读操作。本模块不维护组件里的进度条或错误提示。
 */
import type {
  CompressItemImageRequest,
  CompressLocationImageRequest,
  CompressRoleImageRequest,
  CompressSceneBackgroundRequest,
  GenerateItemImageRequest,
  GenerateItemImageResponse,
  GenerateItemPromptRequest,
  GenerateItemPromptResponse,
  GenerateLocationImageRequest,
  GenerateLocationImageResponse,
  GenerateLocationPromptRequest,
  GenerateLocationPromptResponse,
  GenerateRoleImageRequest,
  GenerateRoleImageResponse,
  GenerateRolePromptRequest,
  GenerateRolePromptResponse,
  StoryAssetMetadata,
  StoryAssetResponse
} from "@story-mgr/shared"
import type { StoryApiContext } from "./context"

/** 创建素材领域 API。 */
export function createStoryAssetApi(context: StoryApiContext) {
  const { apiBase, runStoryMutation } = context

  /** 执行 `uploadStoryAsset` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param file 调用方传入的 `file`。 @returns 计算、查找或构建后的结果。 */
  async function uploadStoryAsset(storyId: string, file: File): Promise<StoryAssetMetadata> {
    const response = await runStoryMutation(storyId, (expectedRevision) => {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("expectedRevision", String(expectedRevision))
      return $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/assets/upload`, {
        method: "POST",
        body: formData
      })
    })
    return response.asset
  }

  /** 执行 `compressSceneAsset` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function compressSceneAsset(
    storyId: string,
    payload: Omit<CompressSceneBackgroundRequest, "expectedRevision">
  ): Promise<StoryAssetMetadata> {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/assets/compress`, {
        method: "POST",
        body: { ...payload, expectedRevision } satisfies CompressSceneBackgroundRequest
      })
    )
    return response.asset
  }

  /** 读取或计算 `StoryAssetMeta`。 @param storyId 调用方传入的 `storyId`。 @param assetPath 调用方传入的 `assetPath`。 @returns 计算、查找或构建后的结果。 */
  async function getStoryAssetMeta(storyId: string, assetPath: string) {
    const response = await $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/assets/meta`, {
      query: { path: assetPath }
    })
    return response.asset
  }

  /** 读取或计算 `StoryAssetUrl`。 @param storyId 调用方传入的 `storyId`。 @param assetPath 调用方传入的 `assetPath`。 @returns 计算、查找或构建后的结果。 */
  function getStoryAssetUrl(storyId: string, assetPath: string) {
    const searchParams = new URLSearchParams({ path: assetPath })
    return `${apiBase}/stories/${storyId}/assets/file?${searchParams.toString()}`
  }

  /** 执行 `generateLocationPrompt` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function generateLocationPrompt(storyId: string, payload: GenerateLocationPromptRequest) {
    const response = await $fetch<GenerateLocationPromptResponse>(
      `${apiBase}/stories/${storyId}/event-locations/prompt`,
      { method: "POST", body: payload }
    )
    return response.prompt
  }

  /** 执行 `generateItemPrompt` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function generateItemPrompt(storyId: string, payload: GenerateItemPromptRequest) {
    const response = await $fetch<GenerateItemPromptResponse>(
      `${apiBase}/stories/${storyId}/items/prompt`,
      { method: "POST", body: payload }
    )
    return response.prompt
  }

  /** 执行 `generateRolePrompt` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function generateRolePrompt(storyId: string, payload: GenerateRolePromptRequest) {
    const response = await $fetch<GenerateRolePromptResponse>(
      `${apiBase}/stories/${storyId}/roles/prompt`,
      { method: "POST", body: payload }
    )
    return response.prompt
  }

  /** 执行 `generateLocationImage` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function generateLocationImage(
    storyId: string,
    payload: Omit<GenerateLocationImageRequest, "expectedRevision">
  ) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<GenerateLocationImageResponse>(`${apiBase}/stories/${storyId}/event-locations/image`, {
        method: "POST",
        body: { ...payload, expectedRevision } satisfies GenerateLocationImageRequest
      })
    )
    return response.asset
  }

  /** 执行 `generateItemImage` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function generateItemImage(
    storyId: string,
    payload: Omit<GenerateItemImageRequest, "expectedRevision">
  ) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<GenerateItemImageResponse>(`${apiBase}/stories/${storyId}/items/image`, {
        method: "POST",
        body: { ...payload, expectedRevision } satisfies GenerateItemImageRequest
      })
    )
    return response.asset
  }

  /** 执行 `generateRoleImage` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function generateRoleImage(
    storyId: string,
    payload: Omit<GenerateRoleImageRequest, "expectedRevision">
  ) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<GenerateRoleImageResponse>(`${apiBase}/stories/${storyId}/roles/image`, {
        method: "POST",
        body: { ...payload, expectedRevision } satisfies GenerateRoleImageRequest
      })
    )
    return response.asset
  }

  /** 执行 `compressLocationImage` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function compressLocationImage(
    storyId: string,
    payload: Omit<CompressLocationImageRequest, "expectedRevision">
  ) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/event-locations/compress`, {
        method: "POST",
        body: { ...payload, expectedRevision } satisfies CompressLocationImageRequest
      })
    )
    return response.asset
  }

  /** 执行 `compressItemImage` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function compressItemImage(
    storyId: string,
    payload: Omit<CompressItemImageRequest, "expectedRevision">
  ) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/items/compress`, {
        method: "POST",
        body: { ...payload, expectedRevision } satisfies CompressItemImageRequest
      })
    )
    return response.asset
  }

  /** 执行 `compressRoleImage` 对应的局部业务逻辑。 @param storyId 调用方传入的 `storyId`。 @param payload 调用方传入的 `payload`。 @returns 计算、查找或构建后的结果。 */
  async function compressRoleImage(
    storyId: string,
    payload: Omit<CompressRoleImageRequest, "expectedRevision">
  ) {
    const response = await runStoryMutation(storyId, (expectedRevision) =>
      $fetch<StoryAssetResponse>(`${apiBase}/stories/${storyId}/roles/compress`, {
        method: "POST",
        body: { ...payload, expectedRevision } satisfies CompressRoleImageRequest
      })
    )
    return response.asset
  }

  return {
    compressItemImage,
    compressLocationImage,
    compressRoleImage,
    compressSceneAsset,
    generateItemImage,
    generateItemPrompt,
    generateLocationImage,
    generateLocationPrompt,
    generateRoleImage,
    generateRolePrompt,
    getStoryAssetMeta,
    getStoryAssetUrl,
    uploadStoryAsset
  }
}
