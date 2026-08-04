import type {
  AppSettingsFile,
  StoryDocument,
  ValidationResult
} from "@story-mgr/core"

/** 组合 `StoryEditorDocument` 的响应式状态、派生值和操作方法。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useStoryEditorDocument() {
  const storyDocument = shallowRef<StoryDocument | null>(null)
  const appSettings = shallowRef<AppSettingsFile | null>(null)
  const validation = shallowRef<ValidationResult | null>(null)
  const exportPath = shallowRef<string | null>(null)
  const isLoading = shallowRef(true)
  const isSaving = shallowRef(false)
  const isExporting = shallowRef(false)
  const errorMessage = shallowRef<string | null>(null)
  const issueSummary = computed(() => {
    const issues = validation.value?.issues ?? []
    return {
      errorCount: issues.filter((issue) => issue.level === "error").length,
      warningCount: issues.filter((issue) => issue.level === "warning").length
    }
  })

  return {
    appSettings,
    errorMessage,
    exportPath,
    isExporting,
    isLoading,
    isSaving,
    issueSummary,
    storyDocument,
    validation
  }
}
