import type {
  StoryActionFile,
  StoryAnyEventFile,
  StoryDocument,
  StoryEventCollectionType,
  StoryEventFile,
  StoryEventTriggerMode,
  StoryLoopEventFile,
  StoryOnceEventFile
} from "@story-mgr/core"
import type { ShallowRef } from "vue"

export type EventCanvasTab = Extract<StoryEventCollectionType, "chain" | "pool" | "schedule">
export type EventWorkbenchTab = EventCanvasTab | "doing" | "phone-conversations"
export type EventTriggerFilter = "all" | "normal" | "invoke"

/** 组合 `StoryEventWorkbench` 的响应式状态、派生值和操作方法。 @param storyDocument 调用方传入的 `storyDocument`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useStoryEventWorkbench(storyDocument: ShallowRef<StoryDocument | null>) {
  const activeEventTab = shallowRef<EventWorkbenchTab>("chain")
  const eventTriggerFilter = shallowRef<EventTriggerFilter>("all")
  const eventTabOptions: Array<{ key: EventWorkbenchTab; label: string }> = [
    { key: "chain", label: "链式剧情线" },
    { key: "pool", label: "平面事件池" },
    { key: "schedule", label: "定时规则事件" },
    { key: "doing", label: "行动" },
    { key: "phone-conversations", label: "手机剧情" }
  ]
  const eventTriggerFilterOptions: Array<{ key: EventTriggerFilter; label: string }> = [
    { key: "all", label: "全部" },
    { key: "normal", label: "普通" },
    { key: "invoke", label: "被调用" }
  ]

  /** 判断 `isEventCanvasTab` 对应的条件是否成立。 @param tab 调用方传入的 `tab`。 @returns 布尔判断结果。 */
  function isEventCanvasTab(tab: EventWorkbenchTab): tab is EventCanvasTab {
    return tab === "chain" || tab === "pool" || tab === "schedule"
  }

  /** 读取或计算 `EventsByCollectionType`。 @param collectionType 调用方传入的 `collectionType`。 @returns 计算、查找或构建后的结果。 */
  function getEventsByCollectionType(collectionType: EventCanvasTab) {
    if (!storyDocument.value) return []
    if (collectionType === "pool") return storyDocument.value.poolEvents
    if (collectionType === "schedule") return storyDocument.value.scheduleEvents
    return storyDocument.value.chainEvents
  }

  /** 读取或计算 `GraphNodes`。 @returns 计算、查找或构建后的结果。 */
  function getGraphNodes() {
    return storyDocument.value?.chainEvents ?? []
  }

  /** 判断 `isGraphActionNode` 对应的条件是否成立。 @param event 调用方传入的 `event`。 @returns 布尔判断结果。 */
  function isGraphActionNode(event: StoryAnyEventFile): event is StoryActionFile {
    return "exec_script" in event
  }

  /** 判断 `isGraphEventNode` 对应的条件是否成立。 @param event 调用方传入的 `event`。 @returns 布尔判断结果。 */
  function isGraphEventNode(event: StoryAnyEventFile): event is StoryEventFile {
    return "next" in event && !("exec_script" in event) && !("bgm" in event)
  }

  /** 将 `EventTriggerMode` 输入清洗为内部统一格式。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
  function normalizeEventTriggerMode(
    event: StoryEventFile | StoryOnceEventFile | StoryLoopEventFile
  ): StoryEventTriggerMode {
    return event.trigger_mode ?? "default"
  }

  /** 判断 `matchesEventTriggerFilter` 对应的条件是否成立。 @param event 调用方传入的 `event`。 @returns 布尔判断结果。 */
  function matchesEventTriggerFilter(
    event: StoryEventFile | StoryOnceEventFile | StoryLoopEventFile
  ) {
    if (eventTriggerFilter.value === "all") return true
    const triggerMode = normalizeEventTriggerMode(event)
    return eventTriggerFilter.value === "invoke"
      ? triggerMode === "invoke"
      : triggerMode !== "invoke"
  }

  const activeEvents = computed<StoryAnyEventFile[]>(() => {
    if (!isEventCanvasTab(activeEventTab.value)) return []
    return activeEventTab.value === "chain"
      ? getGraphNodes()
      : getEventsByCollectionType(activeEventTab.value)
  })
  const activeGraphEvents = computed<StoryEventFile[]>(() =>
    activeEventTab.value === "chain"
      ? getEventsByCollectionType("chain") as StoryEventFile[]
      : []
  )
  const activeOnceEvents = computed<StoryOnceEventFile[]>(() =>
    activeEventTab.value === "pool"
      ? getEventsByCollectionType("pool") as StoryOnceEventFile[]
      : []
  )
  const activeLoopEvents = computed<StoryLoopEventFile[]>(() =>
    activeEventTab.value === "schedule"
      ? getEventsByCollectionType("schedule") as StoryLoopEventFile[]
      : []
  )

  const filteredGraphCanvasEvents = computed<StoryAnyEventFile[]>(() => {
    const graphNodes = getGraphNodes()
    if (eventTriggerFilter.value === "all") return graphNodes
    const visibleEventIds = new Set(
      graphNodes.filter(isGraphEventNode).filter(matchesEventTriggerFilter).map((event) => event.id)
    )
    const visibleActionIds = new Set<string>()
    for (const node of graphNodes) {
      if (isGraphEventNode(node) && visibleEventIds.has(node.id)) {
        for (const nextId of node.next) {
          const nextNode = graphNodes.find((candidate) => candidate.id === nextId)
          if (nextNode && isGraphActionNode(nextNode)) visibleActionIds.add(nextNode.id)
        }
      }
      if (isGraphActionNode(node) && node.next.some((nextId) => visibleEventIds.has(nextId))) {
        visibleActionIds.add(node.id)
      }
    }
    return graphNodes.filter((node) =>
      isGraphEventNode(node) ? visibleEventIds.has(node.id) : visibleActionIds.has(node.id)
    )
  })
  const filteredOnceCanvasEvents = computed(() =>
    activeOnceEvents.value.filter(matchesEventTriggerFilter)
  )
  const filteredLoopCanvasEvents = computed(() =>
    activeLoopEvents.value.filter(matchesEventTriggerFilter)
  )
  const activeEventTabLabel = computed(() =>
    eventTabOptions.find((option) => option.key === activeEventTab.value)?.label ?? "普通剧情推进事件"
  )

  return {
    activeEventTab,
    activeEventTabLabel,
    activeEvents,
    activeGraphEvents,
    activeLoopEvents,
    activeOnceEvents,
    eventTabOptions,
    eventTriggerFilter,
    eventTriggerFilterOptions,
    filteredGraphCanvasEvents,
    filteredLoopCanvasEvents,
    filteredOnceCanvasEvents,
    getEventsByCollectionType,
    getGraphNodes,
    isEventCanvasTab,
    isGraphActionNode,
    isGraphEventNode,
    normalizeEventTriggerMode
  }
}
