/**
 * 剧情图的纯布局算法和视图契约。
 *
 * 输入是事件列表、方向和已测量高度，输出是节点坐标；不读取 DOM、相机或 Vue 状态。
 */
import type {
  StoryActionFile,
  StoryAnyEventFile,
  StoryEventFile,
  StoryEventTriggerMode
} from "@story-mgr/core"

export type GraphDirection = "horizontal" | "vertical"
export type GraphNodeKind = "event" | "action"

export interface GraphNodeView {
  color: string
  height: number
  id: string
  kind: GraphNodeKind
  nextCount: number
  title: string
  triggerMode: StoryEventTriggerMode | null
  x: number
  y: number
}

export interface GraphEdgeView {
  fromEventId: string
  id: string
  toEventId: string
  midX: number
  midY: number
  x1: number
  x2: number
  y1: number
  y2: number
}

export interface PanState {
  moved: boolean
  originX: number
  originY: number
  startClientX: number
  startClientY: number
}
export const GRID_SIZE = 28
export const EVENT_NODE_WIDTH = 240
export const ACTION_NODE_WIDTH = 196
export const EVENT_NODE_HEIGHT = 124
export const ACTION_NODE_HEIGHT = 98
export const MIN_CANVAS_SCALE = 0.5
export const MAX_CANVAS_SCALE = 2
export const ZOOM_STEP_FACTOR = 1.15
export const AUTO_LAYOUT_BRANCH_MARGIN = 16
export const AUTO_LAYOUT_FLOW_MARGIN = 36
export const AUTO_LAYOUT_START_X = 120
export const AUTO_LAYOUT_START_Y = 80
export const DEFAULT_DIRECTION: GraphDirection = "horizontal"

export const eventColorPalette = ["#ffb454", "#7ce3c3", "#c8e1ff", "#ff8b7b", "#ffd66b", "#87b7ff"]
export const actionColorPalette = ["#7dc4ff", "#9fe0b6", "#ffcf7a", "#f7a3d7"]

/** 判断 `isActionNode` 对应的条件是否成立。 @param event 调用方传入的 `event`。 @returns 布尔判断结果。 */
export function isActionNode(event: StoryAnyEventFile): event is StoryActionFile {
  return "exec_script" in event
}

/** 判断 `isEventNode` 对应的条件是否成立。 @param event 调用方传入的 `event`。 @returns 布尔判断结果。 */
export function isEventNode(event: StoryAnyEventFile): event is StoryEventFile {
  return "next" in event && !("exec_script" in event) && !("bgm" in event)
}

/** 读取或计算 `NodeKind`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
export function getNodeKind(event: StoryAnyEventFile): GraphNodeKind {
  return isActionNode(event) ? "action" : "event"
}

/** 读取或计算 `EventTriggerMode`。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
export function getEventTriggerMode(event: StoryAnyEventFile): StoryEventTriggerMode | null {
  return isEventNode(event) ? event.trigger_mode ?? "default" : null
}

/** 读取或计算 `NodeWidthByKind`。 @param kind 调用方传入的 `kind`。 @returns 计算、查找或构建后的结果。 */
export function getNodeWidthByKind(kind: GraphNodeKind) {
  return kind === "action" ? ACTION_NODE_WIDTH : EVENT_NODE_WIDTH
}

/** 读取或计算 `NodeWidthById`。 @param events 调用方传入的 `events`。 @param nodeId 调用方传入的 `nodeId`。 @returns 计算、查找或构建后的结果。 */
export function getNodeWidthById(events: StoryAnyEventFile[], nodeId: string) {
  const node = events.find((event) => event.id === nodeId)
  return getNodeWidthByKind(node ? getNodeKind(node) : "event")
}

/** 读取或计算 `GraphNodeHeight`。 @param events 调用方传入的 `events`。 @param nodeHeights 调用方传入的 `nodeHeights`。 @param eventId 调用方传入的 `eventId`。 @returns 计算、查找或构建后的结果。 */
export function getGraphNodeHeight(
  events: StoryAnyEventFile[],
  nodeHeights: Record<string, number>,
  eventId: string
) {
  const event = events.find((item) => item.id === eventId)
  const defaultHeight = event && isActionNode(event) ? ACTION_NODE_HEIGHT : EVENT_NODE_HEIGHT
  return nodeHeights[eventId] ?? defaultHeight
}

/** 创建一份新的 `DefaultPosition` 数据。 @param index 调用方传入的 `index`。 @param kind 调用方传入的 `kind`。 @param layoutDirection 调用方传入的 `layoutDirection`。 @returns 计算、查找或构建后的结果。 */
export function createDefaultPosition(index: number, kind: GraphNodeKind, layoutDirection: GraphDirection) {
  const nodeWidth = getNodeWidthByKind(kind)
  const nodeHeight = kind === "action" ? ACTION_NODE_HEIGHT : EVENT_NODE_HEIGHT
  const column = layoutDirection === "horizontal" ? Math.floor(index / 3) : index % 3
  const row = layoutDirection === "horizontal" ? index % 3 : Math.floor(index / 3)

  return layoutDirection === "horizontal"
    ? {
        x: AUTO_LAYOUT_START_X + column * (EVENT_NODE_WIDTH + AUTO_LAYOUT_FLOW_MARGIN),
        y: AUTO_LAYOUT_START_Y + row * (nodeHeight + AUTO_LAYOUT_BRANCH_MARGIN)
      }
    : {
        x: AUTO_LAYOUT_START_X + column * (nodeWidth + AUTO_LAYOUT_BRANCH_MARGIN),
        y: AUTO_LAYOUT_START_Y + row * (EVENT_NODE_HEIGHT + AUTO_LAYOUT_FLOW_MARGIN)
      }
}

/** 创建一份新的 `RootOrder` 数据。 @param events 调用方传入的 `events`。 @returns 计算、查找或构建后的结果。 */
export function createRootOrder(events: StoryAnyEventFile[]) {
  const eventIds = events.map((event) => event.id)
  const eventSet = new Set(eventIds)
  const incomingCount = new Map(eventIds.map((eventId) => [eventId, 0]))

  for (const event of events) {
    if (!("next" in event)) {
      continue
    }

    for (const nextId of event.next) {
      if (!eventSet.has(nextId)) {
        continue
      }

      incomingCount.set(nextId, (incomingCount.get(nextId) ?? 0) + 1)
    }
  }

  const rootIds: string[] = []

  for (const event of events) {
    if (getNodeKind(event) !== "event") {
      continue
    }

    if ((incomingCount.get(event.id) ?? 0) === 0 && !rootIds.includes(event.id)) {
      rootIds.push(event.id)
    }
  }

  for (const eventId of eventIds) {
    if (!rootIds.includes(eventId)) {
      rootIds.push(eventId)
    }
  }

  return rootIds
}

/** 根据当前输入构建 `AutoLayoutPositionMap` 结果。 @param events 调用方传入的 `events`。 @param layoutDirection 调用方传入的 `layoutDirection`。 @param nodeHeights 调用方传入的 `nodeHeights`。 @returns 计算、查找或构建后的结果。 */
export function buildAutoLayoutPositionMap(
  events: StoryAnyEventFile[],
  layoutDirection: GraphDirection,
  nodeHeights: Record<string, number>
) {
  const eventMap = new Map(events.map((event) => [event.id, event]))
  const treeChildren = new Map(events.map((event) => [event.id, [] as string[]]))
  const assignedParent = new Map<string, string | null>()
  const depthById = new Map<string, number>()
  const desiredBranchCenterById = new Map<string, number>()
  const visited = new Set<string>()

  /** 执行 `traverse` 对应的局部业务逻辑。 @param nodeId 调用方传入的 `nodeId`。 @param depth 调用方传入的 `depth`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
  function traverse(nodeId: string, depth: number) {
    if (visited.has(nodeId)) {
      return
    }

    visited.add(nodeId)
    depthById.set(nodeId, depth)

    const event = eventMap.get(nodeId)
    if (!event || !("next" in event)) {
      return
    }

    for (const nextId of event.next) {
      if (!eventMap.has(nextId) || assignedParent.has(nextId)) {
        continue
      }

      assignedParent.set(nextId, nodeId)
      treeChildren.get(nodeId)?.push(nextId)
      traverse(nextId, depth + 1)
    }
  }

  for (const rootId of createRootOrder(events)) {
    if (assignedParent.has(rootId)) {
      continue
    }

    assignedParent.set(rootId, null)
    traverse(rootId, 0)
  }

  const rootIds = [...assignedParent.entries()]
    .filter(([, parentId]) => parentId === null)
    .map(([eventId]) => eventId)

  let branchCursor =
    layoutDirection === "horizontal" ? AUTO_LAYOUT_START_Y : AUTO_LAYOUT_START_X

  /** 执行 `assignDesiredBranchCenter` 对应的局部业务逻辑。 @param nodeId 调用方传入的 `nodeId`。 @returns 计算、查找或构建后的结果。 */
  function assignDesiredBranchCenter(nodeId: string): number {
    const children = treeChildren.get(nodeId) ?? []
    const size =
      layoutDirection === "horizontal" ? getGraphNodeHeight(events, nodeHeights, nodeId) : getNodeWidthById(events, nodeId)

    if (!children.length) {
      const center = branchCursor + size / 2
      desiredBranchCenterById.set(nodeId, center)
      branchCursor += size + AUTO_LAYOUT_BRANCH_MARGIN
      return center
    }

    const childCenters = children.map((childId) => assignDesiredBranchCenter(childId))
    const center = Math.round((childCenters[0] + childCenters[childCenters.length - 1]) / 2)
    desiredBranchCenterById.set(nodeId, center)
    return center
  }

  for (const [index, rootId] of rootIds.entries()) {
    if (index > 0) {
      branchCursor += AUTO_LAYOUT_BRANCH_MARGIN * 2
    }

    assignDesiredBranchCenter(rootId)
  }

  const nodesByDepth = new Map<number, string[]>()

  for (const event of events) {
    const depth = depthById.get(event.id) ?? 0
    const nodes = nodesByDepth.get(depth) ?? []
    nodes.push(event.id)
    nodesByDepth.set(depth, nodes)
  }

  const positionMap = new Map<string, { x: number; y: number }>()

  if (layoutDirection === "horizontal") {
    const depths = [...nodesByDepth.keys()].sort((left, right) => left - right)

    for (const depth of depths) {
      const x = AUTO_LAYOUT_START_X + depth * (EVENT_NODE_WIDTH + AUTO_LAYOUT_FLOW_MARGIN)
      const nodeIds = [...(nodesByDepth.get(depth) ?? [])].sort((left, right) => {
        return (desiredBranchCenterById.get(left) ?? 0) - (desiredBranchCenterById.get(right) ?? 0)
      })

      let branchTopCursor = AUTO_LAYOUT_START_Y

      for (const nodeId of nodeIds) {
        const height = getGraphNodeHeight(events, nodeHeights, nodeId)
        const desiredTop = (desiredBranchCenterById.get(nodeId) ?? AUTO_LAYOUT_START_Y) - height / 2
        const y = Math.max(branchTopCursor, desiredTop)

        positionMap.set(nodeId, {
          x: Math.round(x),
          y: Math.round(y)
        })

        branchTopCursor = y + height + AUTO_LAYOUT_BRANCH_MARGIN
      }
    }
  } else {
    const depths = [...nodesByDepth.keys()].sort((left, right) => left - right)
    let flowTop = AUTO_LAYOUT_START_Y

    for (const depth of depths) {
      const nodeIds = [...(nodesByDepth.get(depth) ?? [])].sort((left, right) => {
        return (desiredBranchCenterById.get(left) ?? 0) - (desiredBranchCenterById.get(right) ?? 0)
      })

      let branchLeftCursor = AUTO_LAYOUT_START_X

      for (const nodeId of nodeIds) {
        const width = getNodeWidthById(events, nodeId)
        const desiredLeft =
          (desiredBranchCenterById.get(nodeId) ?? AUTO_LAYOUT_START_X) - width / 2
        const x = Math.max(branchLeftCursor, desiredLeft)

        positionMap.set(nodeId, {
          x: Math.round(x),
          y: Math.round(flowTop)
        })

        branchLeftCursor = x + width + AUTO_LAYOUT_BRANCH_MARGIN
      }

      const rowHeight = Math.max(...nodeIds.map((nodeId) => getGraphNodeHeight(events, nodeHeights, nodeId)), EVENT_NODE_HEIGHT)
      flowTop += rowHeight + AUTO_LAYOUT_FLOW_MARGIN
    }
  }

  for (const [index, event] of events.entries()) {
    if (!positionMap.has(event.id)) {
      positionMap.set(event.id, createDefaultPosition(index, getNodeKind(event), layoutDirection))
    }
  }

  return positionMap
}
