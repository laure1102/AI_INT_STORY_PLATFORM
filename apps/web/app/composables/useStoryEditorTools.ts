export type StoryEditorTool =
  | "vals"
  | "player-override-vals"
  | "system-vals"
  | "scenes"
  | "locations"
  | "items"
  | "shop"
  | "contact"
  | "refer"
  | "roles"
  | "settings"
  | "game-settings"

/** 组合 `StoryEditorTools` 的响应式状态、派生值和操作方法。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useStoryEditorTools() {
  const activeTool = shallowRef<StoryEditorTool | null>(null)

  /** 执行 `toolState` 对应的局部业务逻辑。 @param tool 调用方传入的 `tool`。 @returns 计算、查找或构建后的结果。 */
  function toolState(tool: StoryEditorTool) {
    return computed({
      get: () => activeTool.value === tool,
      set: (open: boolean) => {
        if (open) {
          activeTool.value = tool
        } else if (activeTool.value === tool) {
          activeTool.value = null
        }
      }
    })
  }

  /** 关闭 `AllTools` 界面并清理临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
  function closeAllTools() {
    activeTool.value = null
  }

  return {
    activeTool,
    closeAllTools,
    isValsDialogOpen: toolState("vals"),
    isPlayerOverrideValsDialogOpen: toolState("player-override-vals"),
    isSystemValsDialogOpen: toolState("system-vals"),
    isScenesDialogOpen: toolState("scenes"),
    isLocationsDialogOpen: toolState("locations"),
    isItemsDialogOpen: toolState("items"),
    isShopDialogOpen: toolState("shop"),
    isContactDialogOpen: toolState("contact"),
    isReferDialogOpen: toolState("refer"),
    isRolesDialogOpen: toolState("roles"),
    isSettingsDialogOpen: toolState("settings"),
    isGameSettingsDialogOpen: toolState("game-settings")
  }
}
