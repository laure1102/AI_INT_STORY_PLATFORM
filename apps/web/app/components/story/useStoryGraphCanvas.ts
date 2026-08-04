/**
 * 剧情图画布的视口、缩放、拖拽和连线交互。
 *
 * 输入是事件节点与当前选中 ID，输出为模板视图和类型化操作。
 * 节点排版算法位于 storyGraphLayout，本模块不保存故事文件。
 */
import type { CSSProperties, ComponentPublicInstance } from "vue"
import type {
  StoryActionFile,
  StoryAnyEventFile,
  StoryEventFile,
  StoryEventTriggerMode
} from "@story-mgr/core"

import {
  DEFAULT_DIRECTION, GRID_SIZE, MAX_CANVAS_SCALE, MIN_CANVAS_SCALE, ZOOM_STEP_FACTOR,
  actionColorPalette, buildAutoLayoutPositionMap, createDefaultPosition, eventColorPalette,
  getEventTriggerMode, getGraphNodeHeight, getNodeKind, getNodeWidthByKind, isActionNode,
  type GraphDirection, type GraphEdgeView, type GraphNodeKind, type GraphNodeView, type PanState
} from "./storyGraphLayout"


export interface StoryGraphCanvasProps {
  events: StoryAnyEventFile[]
  selectedEventId: string | null
}

export interface StoryGraphCanvasEmits {
  select: [eventId: string]
  edit: [eventId: string]
  delete: [eventId: string]
  create: [eventId: string]
  createAction: [eventId: string]
  createRoot: []
  toggleLink: [payload: { sourceEventId: string; targetEventId: string }]
}

export type StoryGraphCanvasEmit = <EventName extends keyof StoryGraphCanvasEmits>(
  event: EventName,
  ...args: StoryGraphCanvasEmits[EventName]
) => void

/** 组合 `StoryGraphCanvas` 的响应式状态、派生值和操作方法。 @param props 调用方传入的 `props`。 @param emit 调用方传入的 `emit`。 @returns 响应式状态、派生值和操作函数组成的 API 对象。 */
export function useStoryGraphCanvas(
  props: Readonly<StoryGraphCanvasProps>,
  emit: StoryGraphCanvasEmit
) {
  const viewportRef = useTemplateRef<HTMLDivElement>("viewport")


const camera = reactive({
  x: 0,
  y: 0
})

const pointerPosition = reactive({
  x: 0,
  y: 0
})

const viewportSize = reactive({
  width: 1,
  height: 560
})

const panState = shallowRef<PanState | null>(null)
const linkSourceId = shallowRef<string | null>(null)
const hoveredDropTargetId = shallowRef<string | null>(null)
const suppressClickBefore = shallowRef(0)
const canvasScale = shallowRef(1)
const nodeHeights = reactive<Record<string, number>>({})
const direction = shallowRef<GraphDirection>(DEFAULT_DIRECTION)


let viewportObserver: ResizeObserver | null = null
let nodeCardObserver: ResizeObserver | null = null
const nodeCardElements = new Map<string, HTMLElement>()

const isHorizontalDirection = computed(() => direction.value === "horizontal")

/** 读取或计算 `NodeHeight`。 @param eventId 调用方传入的 `eventId`。 @returns 计算、查找或构建后的结果。 */
function getNodeHeight(eventId: string) {
  return getGraphNodeHeight(props.events, nodeHeights, eventId)
}


const localNodes = computed<GraphNodeView[]>(() => {
  const positionMap = buildAutoLayoutPositionMap(props.events, direction.value, nodeHeights)
  let eventIndex = 0
  let actionIndex = 0

  return props.events.map((event, index) => {
    const kind = getNodeKind(event)
    const position = positionMap.get(event.id) ?? createDefaultPosition(index, kind, direction.value)
    const palette =
      kind === "action"
        ? actionColorPalette[actionIndex++ % actionColorPalette.length]
        : eventColorPalette[eventIndex++ % eventColorPalette.length]

    return {
      color: palette ?? "#87b7ff",
      height: getNodeHeight(event.id),
      id: event.id,
      kind,
      nextCount: "next" in event ? event.next.length : 0,
      title: event.title,
      triggerMode: getEventTriggerMode(event),
      x: Math.round(position.x),
      y: Math.round(position.y)
    }
  })
})

const nodeMap = computed(() => {
  return new Map(localNodes.value.map((node) => [node.id, node]))
})

const viewportViewBox = computed(() => {
  return `0 0 ${Math.max(viewportSize.width, 1)} ${Math.max(viewportSize.height, 1)}`
})

const zoomPercentageLabel = computed(() => `${Math.round(canvasScale.value * 100)}%`)
const isAtMinimumZoom = computed(() => canvasScale.value <= MIN_CANVAS_SCALE + 0.001)
const isAtMaximumZoom = computed(() => canvasScale.value >= MAX_CANVAS_SCALE - 0.001)
const isAtDefaultZoom = computed(() => Math.abs(canvasScale.value - 1) < 0.001)

const edges = computed<GraphEdgeView[]>(() => {
  const graphEdges: GraphEdgeView[] = []

  for (const event of props.events) {
    if (!("next" in event)) {
      continue
    }

    const sourceNode = nodeMap.value.get(event.id)
    if (!sourceNode) {
      continue
    }

    for (const nextId of event.next) {
      const targetNode = nodeMap.value.get(nextId)
      if (!targetNode) {
        continue
      }

      const sourceWidth = getNodeWidthByKind(sourceNode.kind)
      const targetWidth = getNodeWidthByKind(targetNode.kind)

      graphEdges.push({
        fromEventId: event.id,
        id: `${event.id}->${nextId}`,
        midX: Math.round(((
          (isHorizontalDirection.value
            ? toScreenX(sourceNode.x) + sourceWidth * canvasScale.value
            : toScreenX(sourceNode.x) + (sourceWidth * canvasScale.value) / 2) +
          (isHorizontalDirection.value
            ? toScreenX(targetNode.x)
            : toScreenX(targetNode.x) + (targetWidth * canvasScale.value) / 2)
        ) / 2)),
        midY: Math.round(((
          (isHorizontalDirection.value
            ? toScreenY(sourceNode.y) + (sourceNode.height * canvasScale.value) / 2
            : toScreenY(sourceNode.y) + sourceNode.height * canvasScale.value) +
          (isHorizontalDirection.value
            ? toScreenY(targetNode.y) + (targetNode.height * canvasScale.value) / 2
            : toScreenY(targetNode.y))
        ) / 2)),
        toEventId: nextId,
        x1: isHorizontalDirection.value
          ? toScreenX(sourceNode.x) + sourceWidth * canvasScale.value
          : toScreenX(sourceNode.x) + (sourceWidth * canvasScale.value) / 2,
        x2: isHorizontalDirection.value
          ? toScreenX(targetNode.x)
          : toScreenX(targetNode.x) + (targetWidth * canvasScale.value) / 2,
        y1: isHorizontalDirection.value
          ? toScreenY(sourceNode.y) + (sourceNode.height * canvasScale.value) / 2
          : toScreenY(sourceNode.y) + sourceNode.height * canvasScale.value,
        y2: isHorizontalDirection.value
          ? toScreenY(targetNode.y) + (targetNode.height * canvasScale.value) / 2
          : toScreenY(targetNode.y)
      })
    }
  }

  return graphEdges
})

const previewEdge = computed<GraphEdgeView | null>(() => {
  if (!linkSourceId.value) {
    return null
  }

  const sourceNode = nodeMap.value.get(linkSourceId.value)
  if (!sourceNode) {
    return null
  }

  const sourceWidth = getNodeWidthByKind(sourceNode.kind)

  return {
    fromEventId: sourceNode.id,
    id: `${sourceNode.id}->preview`,
    midX: Math.round(((
      (isHorizontalDirection.value
        ? toScreenX(sourceNode.x) + sourceWidth * canvasScale.value
        : toScreenX(sourceNode.x) + (sourceWidth * canvasScale.value) / 2) +
      pointerPosition.x
    ) / 2)),
    midY: Math.round(((
      (isHorizontalDirection.value
        ? toScreenY(sourceNode.y) + (sourceNode.height * canvasScale.value) / 2
        : toScreenY(sourceNode.y) + sourceNode.height * canvasScale.value) +
      pointerPosition.y
    ) / 2)),
    toEventId: "preview",
    x1: isHorizontalDirection.value
      ? toScreenX(sourceNode.x) + sourceWidth * canvasScale.value
      : toScreenX(sourceNode.x) + (sourceWidth * canvasScale.value) / 2,
    x2: pointerPosition.x,
    y1: isHorizontalDirection.value
      ? toScreenY(sourceNode.y) + (sourceNode.height * canvasScale.value) / 2
      : toScreenY(sourceNode.y) + sourceNode.height * canvasScale.value,
    y2: pointerPosition.y
  }
})

const canvasBackgroundStyle = computed(() => {
  const scaledGrid = GRID_SIZE * canvasScale.value
  const offsetX = normalizeGridOffset(camera.x, scaledGrid)
  const offsetY = normalizeGridOffset(camera.y, scaledGrid)

  return {
    backgroundPosition: `0 0, ${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px, 0 0`,
    backgroundSize: `auto, ${scaledGrid}px ${scaledGrid}px, ${scaledGrid}px ${scaledGrid}px, auto`
  }
})

/** 将 `GridOffset` 输入清洗为内部统一格式。 @param value 调用方传入的 `value`。 @param gridSize 调用方传入的 `gridSize`。 @returns 计算、查找或构建后的结果。 */
function normalizeGridOffset(value: number, gridSize: number) {
  const remainder = value % gridSize
  return remainder >= 0 ? remainder : remainder + gridSize
}

/** 执行 `toScreenX` 对应的局部业务逻辑。 @param worldX 调用方传入的 `worldX`。 @returns 计算、查找或构建后的结果。 */
function toScreenX(worldX: number) {
  return worldX * canvasScale.value + camera.x
}

/** 执行 `toScreenY` 对应的局部业务逻辑。 @param worldY 调用方传入的 `worldY`。 @returns 计算、查找或构建后的结果。 */
function toScreenY(worldY: number) {
  return worldY * canvasScale.value + camera.y
}

/** 读取或计算 `ViewportCenter`。 @returns 计算、查找或构建后的结果。 */
function getViewportCenter() {
  return {
    x: viewportSize.width / 2,
    y: viewportSize.height / 2
  }
}

/** 执行 `clampCanvasScale` 对应的局部业务逻辑。 @param nextScale 调用方传入的 `nextScale`。 @returns 计算、查找或构建后的结果。 */
function clampCanvasScale(nextScale: number) {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, nextScale))
}

/** 执行 `zoomTo` 对应的局部业务逻辑。 @param nextScale 调用方传入的 `nextScale`。 @param focusPoint 调用方传入的 `focusPoint`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function zoomTo(nextScale: number, focusPoint = getViewportCenter()) {
  const resolvedScale = clampCanvasScale(nextScale)
  const currentScale = canvasScale.value

  if (Math.abs(resolvedScale - currentScale) < 0.001) {
    return
  }

  const worldX = (focusPoint.x - camera.x) / currentScale
  const worldY = (focusPoint.y - camera.y) / currentScale

  canvasScale.value = resolvedScale
  camera.x = focusPoint.x - worldX * resolvedScale
  camera.y = focusPoint.y - worldY * resolvedScale
}

/** 执行 `zoomIn` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function zoomIn() {
  zoomTo(canvasScale.value * ZOOM_STEP_FACTOR)
}

/** 执行 `zoomOut` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function zoomOut() {
  zoomTo(canvasScale.value / ZOOM_STEP_FACTOR)
}

/** 重置或清理 `resetZoom` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function resetZoom() {
  zoomTo(1)
}

/** 执行 `updateViewportMetrics` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function updateViewportMetrics() {
  const rect = viewportRef.value?.getBoundingClientRect()
  if (!rect) {
    return
  }

  viewportSize.width = Math.max(Math.round(rect.width), 1)
  viewportSize.height = Math.max(Math.round(rect.height), 1)
}

/** 执行 `updatePointerPosition` 对应的局部业务逻辑。 @param event 调用方传入的 `event`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function updatePointerPosition(event: PointerEvent | MouseEvent) {
  const rect = viewportRef.value?.getBoundingClientRect()
  if (!rect) {
    return
  }

  pointerPosition.x = event.clientX - rect.left
  pointerPosition.y = event.clientY - rect.top
}

/** 更新 `NodeCardElement` 对应的响应式值。 @param eventId 调用方传入的 `eventId`。 @param element 调用方传入的 `element`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function setNodeCardElement(eventId: string, element: Element | ComponentPublicInstance | null) {
  const previousElement = nodeCardElements.get(eventId)

  if (previousElement && previousElement !== element) {
    nodeCardObserver?.unobserve(previousElement)
  }

  if (element instanceof HTMLElement) {
    nodeCardElements.set(eventId, element)
    nodeCardObserver?.observe(element)
    const measuredHeight = Math.max(getNodeHeight(eventId), element.offsetHeight)
    if (nodeHeights[eventId] !== measuredHeight) {
      nodeHeights[eventId] = measuredHeight
    }
    return
  }

  nodeCardElements.delete(eventId)
}

/** 执行 `measureNodeHeights` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function measureNodeHeights() {
  for (const [eventId, element] of nodeCardElements.entries()) {
    const defaultHeight = getNodeHeight(eventId)
    const measuredHeight = Math.max(defaultHeight, element.offsetHeight)
    if (nodeHeights[eventId] !== measuredHeight) {
      nodeHeights[eventId] = measuredHeight
    }
  }
}

/** 新增一项 `WindowInteractionListeners` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addWindowInteractionListeners() {
  window.addEventListener("pointermove", handleWindowPointerMove)
  window.addEventListener("pointerup", handleWindowPointerUp)
}

/** 移除指定的 `WindowInteractionListeners` 数据。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeWindowInteractionListeners() {
  window.removeEventListener("pointermove", handleWindowPointerMove)
  window.removeEventListener("pointerup", handleWindowPointerUp)
}

/** 执行 `finishWindowInteraction` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function finishWindowInteraction() {
  const activePan = panState.value

  removeWindowInteractionListeners()
  panState.value = null

  if (activePan?.moved) {
    suppressClickBefore.value = Date.now() + 120
  }
}

/** 执行 `centerGraph` 对应的局部业务逻辑。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function centerGraph() {
  if (!localNodes.value.length) {
    return
  }

  const minX = Math.min(...localNodes.value.map((node) => node.x))
  const maxX = Math.max(...localNodes.value.map((node) => node.x + getNodeWidthByKind(node.kind)))
  const minY = Math.min(...localNodes.value.map((node) => node.y))
  const maxY = Math.max(...localNodes.value.map((node) => node.y + node.height))

  camera.x = Math.round(viewportSize.width / 2 - ((minX + maxX) * canvasScale.value) / 2)
  camera.y = Math.round(viewportSize.height / 2 - ((minY + maxY) * canvasScale.value) / 2)
}

/** 处理 `WindowPointerMove` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleWindowPointerMove(event: PointerEvent) {
  updatePointerPosition(event)

  const dropTargetId = findDropTargetId(event)
  hoveredDropTargetId.value =
    linkSourceId.value && dropTargetId !== linkSourceId.value ? dropTargetId : null

  const activePan = panState.value
  if (!activePan) {
    return
  }

  const deltaX = event.clientX - activePan.startClientX
  const deltaY = event.clientY - activePan.startClientY

  if (!activePan.moved && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
    activePan.moved = true
  }

  camera.x = Math.round(activePan.originX + deltaX)
  camera.y = Math.round(activePan.originY + deltaY)
}

/** 处理 `WindowPointerUp` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleWindowPointerUp() {
  if (linkSourceId.value && hoveredDropTargetId.value) {
    const sourceId = linkSourceId.value
    const targetId = hoveredDropTargetId.value

    if (canLinkNodes(sourceId, targetId)) {
      emit("toggleLink", {
        sourceEventId: sourceId,
        targetEventId: targetId
      })
    }
  }

  linkSourceId.value = null
  hoveredDropTargetId.value = null
  finishWindowInteraction()
}

/** 处理 `ViewportPointerDown` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleViewportPointerDown(event: PointerEvent) {
  if (event.button !== 0) {
    return
  }

  if (event.target instanceof Element && event.target.closest(".graph-node")) {
    return
  }

  event.preventDefault()
  updatePointerPosition(event)
  finishWindowInteraction()

  panState.value = {
    moved: false,
    originX: camera.x,
    originY: camera.y,
    startClientX: event.clientX,
    startClientY: event.clientY
  }

  addWindowInteractionListeners()
}

/** 读取或计算 `NodeById`。 @param eventId 调用方传入的 `eventId`。 @returns 计算、查找或构建后的结果。 */
function getNodeById(eventId: string) {
  return props.events.find((event) => event.id === eventId) ?? null
}

/** 判断 `canLinkNodes` 对应的条件是否成立。 @param sourceId 调用方传入的 `sourceId`。 @param targetId 调用方传入的 `targetId`。 @returns 布尔判断结果。 */
function canLinkNodes(sourceId: string, targetId: string) {
  const sourceNode = getNodeById(sourceId)
  const targetNode = getNodeById(targetId)

  if (!sourceNode || !targetNode || sourceId === targetId) {
    return false
  }

  const sourceKind = getNodeKind(sourceNode)
  const targetKind = getNodeKind(targetNode)

  if (sourceKind === "action" && targetKind === "action") {
    return false
  }

  return true
}

/** 处理 `NodeSelect` 用户交互。 @param eventId 调用方传入的 `eventId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleNodeSelect(eventId: string) {
  if (Date.now() < suppressClickBefore.value) {
    return
  }

  emit("select", eventId)
}

/** 处理 `NodeEdit` 用户交互。 @param eventId 调用方传入的 `eventId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleNodeEdit(eventId: string) {
  emit("select", eventId)
  emit("edit", eventId)
}

/** 处理 `NodeCreate` 用户交互。 @param eventId 调用方传入的 `eventId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleNodeCreate(eventId: string) {
  emit("select", eventId)
  emit("create", eventId)
}

/** 处理 `NodeCreateAction` 用户交互。 @param eventId 调用方传入的 `eventId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleNodeCreateAction(eventId: string) {
  emit("select", eventId)
  emit("createAction", eventId)
}

/** 处理 `NodeDelete` 用户交互。 @param eventId 调用方传入的 `eventId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleNodeDelete(eventId: string) {
  emit("select", eventId)
  emit("delete", eventId)
}

/** 处理 `NodeKeydown` 用户交互。 @param event 调用方传入的 `event`。 @param eventId 调用方传入的 `eventId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleNodeKeydown(event: KeyboardEvent, eventId: string) {
  if (event.key !== "Enter" && event.key !== " ") {
    return
  }

  event.preventDefault()
  handleNodeSelect(eventId)
}

/** 处理 `ConnectorClick` 用户交互。 @param eventId 调用方传入的 `eventId`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleConnectorClick(eventId: string) {
  emit("select", eventId)
  if (linkSourceId.value === eventId) {
    linkSourceId.value = null
    hoveredDropTargetId.value = null
    finishWindowInteraction()
    return
  }

  finishWindowInteraction()
  linkSourceId.value = eventId
  hoveredDropTargetId.value = null
  addWindowInteractionListeners()
}

/** 读取或计算 `ConnectorStyle`。 @param nodeKind 调用方传入的 `nodeKind`。 @param kind 调用方传入的 `kind`。 @returns 计算、查找或构建后的结果。 */
function getConnectorStyle(nodeKind: GraphNodeKind, kind: "input" | "output"): CSSProperties {
  const scaledNodeWidth = getNodeWidthByKind(nodeKind) * canvasScale.value

  if (isHorizontalDirection.value) {
    return kind === "input"
      ? {
          left: "0",
          top: "calc(50% - 2.5px)",
          transform: "translateX(-50%)"
        }
      : {
          left: `${scaledNodeWidth}px`,
          top: "calc(50% - 2.5px)",
          transform: "translateX(-50%)"
        }
  }

  return kind === "input"
    ? {
        left: "calc(50% - 2.5px)",
        top: "0",
        transform: "translateY(-50%)"
      }
    : {
        left: "calc(50% - 2.5px)",
        bottom: "0",
        transform: "translateY(50%)"
      }
}

/** 处理 `ViewportPointerMove` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleViewportPointerMove(event: PointerEvent) {
  updatePointerPosition(event)
}

/** 处理 `ViewportWheel` 用户交互。 @param event 调用方传入的 `event`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleViewportWheel(event: WheelEvent) {
  if (panState.value) {
    return
  }

  const rect = viewportRef.value?.getBoundingClientRect()
  if (!rect) {
    return
  }

  const zoomIntensity = event.deltaMode === 1 ? 0.12 : 0.0016
  const nextScale = canvasScale.value * Math.exp(-event.deltaY * zoomIntensity)

  zoomTo(nextScale, {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  })
}

/** 处理 `ViewportClick` 用户交互。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function handleViewportClick() {
  if (Date.now() < suppressClickBefore.value) {
    return
  }

  linkSourceId.value = null
  hoveredDropTargetId.value = null
  finishWindowInteraction()
}

/** 执行 `switchDirection` 对应的局部业务逻辑。 @param nextDirection 调用方传入的 `nextDirection`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
function switchDirection(nextDirection: GraphDirection) {
  if (nextDirection === direction.value) {
    return
  }

  direction.value = nextDirection
  linkSourceId.value = null
  hoveredDropTargetId.value = null

  void nextTick().then(() => {
    measureNodeHeights()
    centerGraph()
  })
}

/** 创建一份新的 `EdgePath` 数据。 @param edge 调用方传入的 `edge`。 @returns 计算、查找或构建后的结果。 */
function createEdgePath(edge: GraphEdgeView) {
  if (isHorizontalDirection.value) {
    const horizontalDirection = edge.x2 >= edge.x1 ? 1 : -1
    const curve = Math.max(90 * canvasScale.value, Math.abs(edge.x2 - edge.x1) * 0.45)

    return [
      `M ${edge.x1} ${edge.y1}`,
      `C ${edge.x1 + curve * horizontalDirection} ${edge.y1},`,
      `${edge.x2 - curve * horizontalDirection} ${edge.y2},`,
      `${edge.x2} ${edge.y2}`
    ].join(" ")
  }

  const verticalDirection = edge.y2 >= edge.y1 ? 1 : -1
  const curve = Math.max(90 * canvasScale.value, Math.abs(edge.y2 - edge.y1) * 0.45)

  return [
    `M ${edge.x1} ${edge.y1}`,
    `C ${edge.x1} ${edge.y1 + curve * verticalDirection},`,
    `${edge.x2} ${edge.y2 - curve * verticalDirection},`,
    `${edge.x2} ${edge.y2}`
  ].join(" ")
}

/** 读取或计算 `NodeStyle`。 @param node 调用方传入的 `node`。 @returns 计算、查找或构建后的结果。 */
function getNodeStyle(node: GraphNodeView) {
  return {
    height: `${node.height * canvasScale.value}px`,
    left: `${toScreenX(node.x)}px`,
    top: `${toScreenY(node.y)}px`,
    width: `${getNodeWidthByKind(node.kind) * canvasScale.value}px`
  }
}

/** 判断 `isNodeDropTarget` 对应的条件是否成立。 @param nodeId 调用方传入的 `nodeId`。 @returns 布尔判断结果。 */
function isNodeDropTarget(nodeId: string) {
  return hoveredDropTargetId.value === nodeId
}

/** 查找 `DropTargetId` 对应的数据。 @param event 调用方传入的 `event`。 @returns 计算、查找或构建后的结果。 */
function findDropTargetId(event: PointerEvent | MouseEvent) {
  const target = event.target as Element | null
  const nodeElement = target?.closest<HTMLElement>("[data-graph-node-id]")
  return nodeElement?.dataset.graphNodeId ?? null
}

/** 读取或计算 `NodeFrameStyle`。 @param node 调用方传入的 `node`。 @returns 计算、查找或构建后的结果。 */
function getNodeFrameStyle(node: GraphNodeView) {
  return {
    height: `${node.height}px`,
    transform: `scale(${canvasScale.value})`,
    width: `${getNodeWidthByKind(node.kind)}px`
  }
}

/** 判断 `isNodeActive` 对应的条件是否成立。 @param eventId 调用方传入的 `eventId`。 @returns 布尔判断结果。 */
function isNodeActive(eventId: string) {
  return props.selectedEventId === eventId
}

/** 判断 `isNodeLinkSource` 对应的条件是否成立。 @param eventId 调用方传入的 `eventId`。 @returns 布尔判断结果。 */
function isNodeLinkSource(eventId: string) {
  return linkSourceId.value === eventId
}

watch(
  () => [props.events, direction.value] as const,
  () => {
    linkSourceId.value = null
    hoveredDropTargetId.value = null
    void nextTick().then(() => {
      measureNodeHeights()
      centerGraph()
    })
  },
  {
    deep: true,
    immediate: true
  }
)

onMounted(() => {
  updateViewportMetrics()

  nodeCardObserver = new ResizeObserver(() => {
    measureNodeHeights()
  })

  if (viewportRef.value) {
    viewportObserver = new ResizeObserver(() => {
      updateViewportMetrics()
    })
    viewportObserver.observe(viewportRef.value)
  }

  void nextTick().then(() => {
    measureNodeHeights()
    centerGraph()
  })
})

onUnmounted(() => {
  finishWindowInteraction()
  nodeCardObserver?.disconnect()
  nodeCardElements.clear()
  viewportObserver?.disconnect()
})

  return reactive({
    camera,
    panState,
    linkSourceId,
    hoveredDropTargetId,
    canvasScale,
    direction,
    isHorizontalDirection,
    localNodes,
    viewportViewBox,
    zoomPercentageLabel,
    isAtMinimumZoom,
    isAtMaximumZoom,
    isAtDefaultZoom,
    edges,
    previewEdge,
    canvasBackgroundStyle,
    zoomIn,
    zoomOut,
    resetZoom,
    setNodeCardElement,
    centerGraph,
    handleViewportPointerDown,
    handleNodeSelect,
    handleNodeEdit,
    handleNodeCreate,
    handleNodeCreateAction,
    handleNodeDelete,
    handleNodeKeydown,
    handleConnectorClick,
    getConnectorStyle,
    handleViewportPointerMove,
    handleViewportWheel,
    handleViewportClick,
    switchDirection,
    createEdgePath,
    getNodeStyle,
    isNodeDropTarget,
    getNodeFrameStyle,
    isNodeActive,
    isNodeLinkSource,
  })
}

/** 画布模板使用的响应式控制器。 */
export type StoryGraphCanvasController = ReturnType<typeof useStoryGraphCanvas>
