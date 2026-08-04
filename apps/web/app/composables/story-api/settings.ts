/** 应用级设置请求；它们不属于某个故事，因此不使用故事修订号。 */
import type { AppSettingsFile } from "@story-mgr/core"
import type {
  AppSettingsResponse,
  SaveAppSettingsRequest
} from "@story-mgr/shared"
import type { StoryApiContext } from "./context"

/** 创建应用设置 API。 */
export function createStorySettingsApi({ apiBase }: StoryApiContext) {
  /** 读取或计算 `AppSettings`。 @returns 计算、查找或构建后的结果。 */
  async function getAppSettings(): Promise<AppSettingsFile> {
    const response = await $fetch<AppSettingsResponse>(`${apiBase}/settings`)
    return response.settings
  }

  /** 保存 `AppSettings` 数据并同步界面状态。 @param settings 调用方传入的 `settings`。 @returns 同步或异步处理结果；失败时由异常或错误状态交给调用方处理。 */
  async function saveAppSettings(settings: AppSettingsFile): Promise<AppSettingsFile> {
    const response = await $fetch<AppSettingsResponse>(`${apiBase}/settings`, {
      method: "PUT",
      body: { settings } satisfies SaveAppSettingsRequest
    })
    return response.settings
  }

  return { getAppSettings, saveAppSettings }
}
