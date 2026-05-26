<script setup lang="ts">
import type { CSSProperties, ComponentPublicInstance } from "vue"
import type { StoryEventFile } from "@story-mgr/core"

type GraphDirection = "horizontal" | "vertical"

interface GraphNodeView {
  color: string
  eventId: string
  height: number
  nextCount: number
  title: string
  x: number
  y: number
}

interface GraphEdgeView {
  fromEventId: string
  id: string
  toEventId: string
  x1: number
  x2: number
  y1: number
  y2: number
}

interface PanState {
  moved: boolean
  originX: number
  originY: number
  startClientX: number
  startClientY: number
}

const props = defineProps<{
  entryEventId?: string | null
  events: StoryEventFile[]
  selectedEventId: string | null
}>()

const emit = defineEmits<{
  select: [eventId: string]
  edit: [eventId: string]
  create: [eventId: string]
  toggleLink: [payload: { sourceEventId: string; targetEventId: string }]
}>()

const viewportRef = useTemplateRef<HTMLDivElement>("viewport")

const GRID_SIZE = 28
const NODE_WIDTH = 240
const NODE_HEIGHT = 124
const MIN_CANVAS_SCALE = 0.5
const MAX_CANVAS_SCALE = 2
const ZOOM_STEP_FACTOR = 1.15
const AUTO_LAYOUT_BRANCH_MARGIN = 16
const AUTO_LAYOUT_FLOW_MARGIN = 36
const AUTO_LAYOUT_START_X = 120
const AUTO_LAYOUT_START_Y = 80
const DEFAULT_DIRECTION: GraphDirection = "horizontal"

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
const suppressClickBefore = shallowRef(0)
const canvasScale = shallowRef(1)
const nodeHeights = reactive<Record<string, number>>({})
const direction = shallowRef<GraphDirection>(DEFAULT_DIRECTION)

const colorPalette = ["#ffb454", "#7ce3c3", "#c8e1ff", "#ff8b7b", "#ffd66b", "#87b7ff"]

let viewportObserver: ResizeObserver | null = null
let nodeCardObserver: ResizeObserver | null = null
const nodeCardElements = new Map<string, HTMLElement>()

const isHorizontalDirection = computed(() => direction.value === "horizontal")

function getNodeHeight(eventId: string) {
  return nodeHeights[eventId] ?? NODE_HEIGHT
}

function createDefaultPosition(index: number, layoutDirection = direction.value) {
  const column = layoutDirection === "horizontal" ? Math.floor(index / 3) : index % 3
  const row = layoutDirection === "horizontal" ? index % 3 : Math.floor(index / 3)

  return layoutDirection === "horizontal"
    ? {
        x: AUTO_LAYOUT_START_X + column * (NODE_WIDTH + AUTO_LAYOUT_FLOW_MARGIN),
        y: AUTO_LAYOUT_START_Y + row * (NODE_HEIGHT + AUTO_LAYOUT_BRANCH_MARGIN)
      }
    : {
        x: AUTO_LAYOUT_START_X + column * (NODE_WIDTH + AUTO_LAYOUT_BRANCH_MARGIN),
        y: AUTO_LAYOUT_START_Y + row * (NODE_HEIGHT + AUTO_LAYOUT_FLOW_MARGIN)
      }
}

function createRootOrder(events: StoryEventFile[], entryEventId?: string | null) {
  const eventIds = events.map((event) => event.id)
  const eventSet = new Set(eventIds)
  const incomingCount = new Map(eventIds.map((eventId) => [eventId, 0]))

  for (const event of events) {
    for (const nextId of event.next) {
      if (!eventSet.has(nextId)) {
        continue
      }

      incomingCount.set(nextId, (incomingCount.get(nextId) ?? 0) + 1)
    }
  }

  const rootIds: string[] = []

  if (entryEventId && eventSet.has(entryEventId)) {
    rootIds.push(entryEventId)
  }

  for (const eventId of eventIds) {
    if ((incomingCount.get(eventId) ?? 0) === 0 && !rootIds.includes(eventId)) {
      rootIds.push(eventId)
    }
  }

  for (const eventId of eventIds) {
    if (!rootIds.includes(eventId)) {
      rootIds.push(eventId)
    }
  }

  return rootIds
}

function buildAutoLayoutPositionMap(
  events: StoryEventFile[],
  entryEventId?: string | null,
  layoutDirection: GraphDirection = direction.value
) {
  const eventMap = new Map(events.map((event) => [event.id, event]))
  const treeChildren = new Map(events.map((event) => [event.id, [] as string[]]))
  const assignedParent = new Map<string, string | null>()
  const depthById = new Map<string, number>()
  const desiredBranchCenterById = new Map<string, number>()
  const visited = new Set<string>()

  function traverse(nodeId: string, depth: number) {
    if (visited.has(nodeId)) {
      return
    }

    visited.add(nodeId)
    depthById.set(nodeId, depth)

    const event = eventMap.get(nodeId)
    if (!event) {
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

  for (const rootId of createRootOrder(events, entryEventId)) {
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

  function assignDesiredBranchCenter(nodeId: string): number {
    const children = treeChildren.get(nodeId) ?? []
    const size = layoutDirection === "horizontal" ? getNodeHeight(nodeId) : NODE_WIDTH

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
      const x = AUTO_LAYOUT_START_X + depth * (NODE_WIDTH + AUTO_LAYOUT_FLOW_MARGIN)
      const nodeIds = [...(nodesByDepth.get(depth) ?? [])].sort((left, right) => {
        return (desiredBranchCenterById.get(left) ?? 0) - (desiredBranchCenterById.get(right) ?? 0)
      })

      let branchTopCursor = AUTO_LAYOUT_START_Y

      for (const nodeId of nodeIds) {
        const height = getNodeHeight(nodeId)
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
        const desiredLeft =
          (desiredBranchCenterById.get(nodeId) ?? AUTO_LAYOUT_START_X) - NODE_WIDTH / 2
        const x = Math.max(branchLeftCursor, desiredLeft)

        positionMap.set(nodeId, {
          x: Math.round(x),
          y: Math.round(flowTop)
        })

        branchLeftCursor = x + NODE_WIDTH + AUTO_LAYOUT_BRANCH_MARGIN
      }

      const rowHeight = Math.max(...nodeIds.map((nodeId) => getNodeHeight(nodeId)), NODE_HEIGHT)
      flowTop += rowHeight + AUTO_LAYOUT_FLOW_MARGIN
    }
  }

  for (const [index, event] of events.entries()) {
    if (!positionMap.has(event.id)) {
      positionMap.set(event.id, createDefaultPosition(index, layoutDirection))
    }
  }

  return positionMap
}

const localNodes = computed<GraphNodeView[]>(() => {
  const positionMap = buildAutoLayoutPositionMap(props.events, props.entryEventId, direction.value)

  return props.events.map((event, index) => {
    const position = positionMap.get(event.id) ?? createDefaultPosition(index, direction.value)

    return {
      color: colorPalette[index % colorPalette.length] ?? "#87b7ff",
      eventId: event.id,
      height: nodeHeights[event.id] ?? NODE_HEIGHT,
      nextCount: event.next.length,
      title: event.title,
      x: Math.round(position.x),
      y: Math.round(position.y)
    }
  })
})

const nodeMap = computed(() => {
  return new Map(localNodes.value.map((node) => [node.eventId, node]))
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
    const sourceNode = nodeMap.value.get(event.id)
    if (!sourceNode) {
      continue
    }

    for (const nextId of event.next) {
      const targetNode = nodeMap.value.get(nextId)
      if (!targetNode) {
        continue
      }

      graphEdges.push({
        fromEventId: event.id,
        id: `${event.id}->${nextId}`,
        toEventId: nextId,
        x1: isHorizontalDirection.value
          ? toScreenX(sourceNode.x) + NODE_WIDTH * canvasScale.value
          : toScreenX(sourceNode.x) + (NODE_WIDTH * canvasScale.value) / 2,
        x2: isHorizontalDirection.value
          ? toScreenX(targetNode.x)
          : toScreenX(targetNode.x) + (NODE_WIDTH * canvasScale.value) / 2,
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

  return {
    fromEventId: sourceNode.eventId,
    id: `${sourceNode.eventId}->preview`,
    toEventId: "preview",
    x1: isHorizontalDirection.value
      ? toScreenX(sourceNode.x) + NODE_WIDTH * canvasScale.value
      : toScreenX(sourceNode.x) + (NODE_WIDTH * canvasScale.value) / 2,
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

function normalizeGridOffset(value: number, gridSize: number) {
  const remainder = value % gridSize
  return remainder >= 0 ? remainder : remainder + gridSize
}

function toScreenX(worldX: number) {
  return worldX * canvasScale.value + camera.x
}

function toScreenY(worldY: number) {
  return worldY * canvasScale.value + camera.y
}

function getViewportCenter() {
  return {
    x: viewportSize.width / 2,
    y: viewportSize.height / 2
  }
}

function clampCanvasScale(nextScale: number) {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, nextScale))
}

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

function zoomIn() {
  zoomTo(canvasScale.value * ZOOM_STEP_FACTOR)
}

function zoomOut() {
  zoomTo(canvasScale.value / ZOOM_STEP_FACTOR)
}

function resetZoom() {
  zoomTo(1)
}

function updateViewportMetrics() {
  const rect = viewportRef.value?.getBoundingClientRect()
  if (!rect) {
    return
  }

  viewportSize.width = Math.max(Math.round(rect.width), 1)
  viewportSize.height = Math.max(Math.round(rect.height), 1)
}

function updatePointerPosition(event: PointerEvent | MouseEvent) {
  const rect = viewportRef.value?.getBoundingClientRect()
  if (!rect) {
    return
  }

  pointerPosition.x = event.clientX - rect.left
  pointerPosition.y = event.clientY - rect.top
}

function setNodeCardElement(eventId: string, element: Element | ComponentPublicInstance | null) {
  const previousElement = nodeCardElements.get(eventId)

  if (previousElement && previousElement !== element) {
    nodeCardObserver?.unobserve(previousElement)
  }

  if (element instanceof HTMLElement) {
    nodeCardElements.set(eventId, element)
    nodeCardObserver?.observe(element)
    const measuredHeight = Math.max(NODE_HEIGHT, element.offsetHeight)
    if (nodeHeights[eventId] !== measuredHeight) {
      nodeHeights[eventId] = measuredHeight
    }
    return
  }

  nodeCardElements.delete(eventId)
}

function measureNodeHeights() {
  for (const [eventId, element] of nodeCardElements.entries()) {
    const measuredHeight = Math.max(NODE_HEIGHT, element.offsetHeight)
    if (nodeHeights[eventId] !== measuredHeight) {
      nodeHeights[eventId] = measuredHeight
    }
  }
}

function addWindowInteractionListeners() {
  window.addEventListener("pointermove", handleWindowPointerMove)
  window.addEventListener("pointerup", handleWindowPointerUp)
}

function removeWindowInteractionListeners() {
  window.removeEventListener("pointermove", handleWindowPointerMove)
  window.removeEventListener("pointerup", handleWindowPointerUp)
}

function finishWindowInteraction() {
  const activePan = panState.value

  removeWindowInteractionListeners()
  panState.value = null

  if (activePan?.moved) {
    suppressClickBefore.value = Date.now() + 120
  }
}

function centerGraph() {
  if (!localNodes.value.length) {
    return
  }

  const minX = Math.min(...localNodes.value.map((node) => node.x))
  const maxX = Math.max(...localNodes.value.map((node) => node.x + NODE_WIDTH))
  const minY = Math.min(...localNodes.value.map((node) => node.y))
  const maxY = Math.max(...localNodes.value.map((node) => node.y + node.height))

  camera.x = Math.round(viewportSize.width / 2 - ((minX + maxX) * canvasScale.value) / 2)
  camera.y = Math.round(viewportSize.height / 2 - ((minY + maxY) * canvasScale.value) / 2)
}

function handleWindowPointerMove(event: PointerEvent) {
  updatePointerPosition(event)

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

function handleWindowPointerUp() {
  finishWindowInteraction()
}

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

function handleNodeSelect(eventId: string) {
  if (Date.now() < suppressClickBefore.value) {
    return
  }

  const sourceId = linkSourceId.value

  if (sourceId && sourceId !== eventId) {
    emit("toggleLink", {
      sourceEventId: sourceId,
      targetEventId: eventId
    })
    linkSourceId.value = null
  } else if (sourceId === eventId) {
    linkSourceId.value = null
  }

  emit("select", eventId)
}

function handleNodeEdit(eventId: string) {
  emit("select", eventId)
  emit("edit", eventId)
}

function handleNodeCreate(eventId: string) {
  emit("select", eventId)
  emit("create", eventId)
}

function handleNodeKeydown(event: KeyboardEvent, eventId: string) {
  if (event.key !== "Enter" && event.key !== " ") {
    return
  }

  event.preventDefault()
  handleNodeSelect(eventId)
}

function handleConnectorClick(eventId: string) {
  emit("select", eventId)
  linkSourceId.value = linkSourceId.value === eventId ? null : eventId
}

function getConnectorStyle(kind: "input" | "output"): CSSProperties {
  if (isHorizontalDirection.value) {
    return kind === "input"
      ? {
          left: "0",
          top: "calc(50% - 2.5px)",
          transform: "translateX(-50%)"
        }
      : {
          left: "auto",
          right: "0",
          top: "calc(50% - 2.5px)",
          transform: "translateX(50%)"
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

function handleViewportPointerMove(event: PointerEvent) {
  updatePointerPosition(event)
}

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

function handleViewportClick() {
  if (Date.now() < suppressClickBefore.value) {
    return
  }

  linkSourceId.value = null
}

function switchDirection(nextDirection: GraphDirection) {
  if (nextDirection === direction.value) {
    return
  }

  direction.value = nextDirection
  linkSourceId.value = null

  void nextTick().then(() => {
    measureNodeHeights()
    centerGraph()
  })
}

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

function getNodeStyle(node: GraphNodeView) {
  return {
    height: `${node.height * canvasScale.value}px`,
    left: `${toScreenX(node.x)}px`,
    top: `${toScreenY(node.y)}px`,
    width: `${NODE_WIDTH * canvasScale.value}px`
  }
}

function getNodeFrameStyle(node: GraphNodeView) {
  return {
    height: `${node.height}px`,
    transform: `scale(${canvasScale.value})`,
    width: `${NODE_WIDTH}px`
  }
}

function isNodeActive(eventId: string) {
  return props.selectedEventId === eventId
}

function isNodeLinkSource(eventId: string) {
  return linkSourceId.value === eventId
}

watch(
  () => [props.events, direction.value] as const,
  () => {
    linkSourceId.value = null
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
</script>

<template>
  <section class="graph-panel glass-panel">
    <div class="graph-panel__header">
      <div class="graph-panel__headline">
        <span class="eyebrow">图谱画布</span>
        <h2 class="section-title">自动布局剧情画布</h2>
      </div>

      <div class="graph-panel__meta">
        <span class="pill">{{ events.length }} 个节点</span>
        <span class="pill">{{ edges.length }} 条连线</span>
        <div class="graph-panel__zoom">
          <button
            class="btn-secondary graph-panel__zoom-button"
            type="button"
            aria-label="缩小"
            :disabled="isAtMinimumZoom"
            @click="zoomOut"
          >
            -
          </button>
          <span class="pill graph-panel__zoom-value">{{ zoomPercentageLabel }}</span>
          <button
            class="btn-secondary graph-panel__zoom-button"
            type="button"
            aria-label="放大"
            :disabled="isAtMaximumZoom"
            @click="zoomIn"
          >
            +
          </button>
          <button
            class="btn-secondary graph-panel__button"
            type="button"
            aria-label="重置缩放"
            :disabled="isAtDefaultZoom"
            @click="resetZoom"
          >
            100%
          </button>
        </div>
        <button
          class="btn-secondary graph-panel__direction-button"
          :class="{ 'graph-panel__direction-button--active': isHorizontalDirection }"
          type="button"
          @click="switchDirection('horizontal')"
        >
          横向
        </button>
        <button
          class="btn-secondary graph-panel__direction-button"
          :class="{ 'graph-panel__direction-button--active': !isHorizontalDirection }"
          type="button"
          @click="switchDirection('vertical')"
        >
          纵向
        </button>
        <button class="btn-secondary graph-panel__button" type="button" @click="centerGraph">
          视图居中
        </button>
      </div>
    </div>

    <div
      ref="viewport"
      class="graph-canvas__viewport"
      :class="{ 'graph-canvas__viewport--panning': !!panState }"
      :style="canvasBackgroundStyle"
      @click="handleViewportClick"
      @pointerdown="handleViewportPointerDown"
      @pointermove="handleViewportPointerMove"
      @wheel.prevent="handleViewportWheel"
    >
      <svg class="graph-canvas__edges" :viewBox="viewportViewBox" preserveAspectRatio="none">
        <defs>
          <marker
            id="graph-arrow"
            markerWidth="3.5"
            markerHeight="3.5"
            refX="2.75"
            refY="1.75"
            orient="auto"
          >
            <path d="M 0 0 L 3.5 1.75 L 0 3.5 z" fill="#9ec8ff" />
          </marker>
          <marker
            id="graph-arrow-preview"
            markerWidth="3.5"
            markerHeight="3.5"
            refX="2.75"
            refY="1.75"
            orient="auto"
          >
            <path d="M 0 0 L 3.5 1.75 L 0 3.5 z" fill="#ffb454" />
          </marker>
        </defs>

        <path
          v-for="edge in edges"
          :key="edge.id"
          class="graph-canvas__edge"
          :class="{
            'graph-canvas__edge--active':
              edge.fromEventId === selectedEventId || edge.toEventId === selectedEventId,
            'graph-canvas__edge--link-source': edge.fromEventId === linkSourceId
          }"
          :d="createEdgePath(edge)"
          marker-end="url(#graph-arrow)"
        />

        <path
          v-if="previewEdge"
          class="graph-canvas__edge graph-canvas__edge--preview"
          :d="createEdgePath(previewEdge)"
          marker-end="url(#graph-arrow-preview)"
        />
      </svg>

      <div class="graph-canvas__stage">
        <div
          v-for="node in localNodes"
          :key="node.eventId"
          class="graph-node"
          :class="{
            'graph-node--active': isNodeActive(node.eventId),
            'graph-node--horizontal': isHorizontalDirection,
            'graph-node--link-source': isNodeLinkSource(node.eventId)
          }"
          :style="getNodeStyle(node)"
        >
          <div class="graph-node__frame" :style="getNodeFrameStyle(node)">
            <div
              class="graph-node__card"
              :ref="(element) => setNodeCardElement(node.eventId, element)"
              role="button"
              tabindex="0"
              @click.stop="handleNodeSelect(node.eventId)"
              @keydown="handleNodeKeydown($event, node.eventId)"
            >
              <div
                class="graph-node__accent"
                :style="{ background: `linear-gradient(135deg, ${node.color}, rgba(255,255,255,0.15))` }"
              />

              <div class="graph-node__header">
                <span class="graph-node__spacer" aria-hidden="true" />

                <button
                  class="graph-node__edit"
                  type="button"
                  title="编辑节点"
                  aria-label="编辑节点"
                  @click.stop="handleNodeEdit(node.eventId)"
                >
                  <svg class="graph-node__edit-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.99-1.66Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>

              <strong class="graph-node__title">{{ node.title }}</strong>
              <span class="graph-node__id">{{ node.eventId }}</span>

              <div class="graph-node__footer">
                <span class="graph-node__count">{{ node.nextCount }} 条出线</span>
                <button
                  class="graph-node__add"
                  type="button"
                  title="新增节点"
                  aria-label="新增节点"
                  @click.stop="handleNodeCreate(node.eventId)"
                >
                  <svg class="graph-node__add-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M11 5h2v14h-2zM5 11h14v2H5z" fill="currentColor" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <button
            class="graph-node__connector graph-node__connector--input"
            :style="getConnectorStyle('input')"
            type="button"
            tabindex="-1"
            aria-hidden="true"
          />

          <button
            class="graph-node__connector graph-node__connector--output"
            :class="{ 'graph-node__connector--active': isNodeLinkSource(node.eventId) }"
            :style="getConnectorStyle('output')"
            type="button"
            :title="isNodeLinkSource(node.eventId) ? '取消连线' : '开始连线'"
            @click.stop="handleConnectorClick(node.eventId)"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.graph-panel {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 10px 10px 0;
  display: flex;
  flex-direction: column;
}

.graph-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.graph-panel__headline {
  display: grid;
  gap: 4px;
}

.graph-panel__meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
}

.graph-panel__meta :deep(.pill) {
  min-height: 26px;
  padding: 0 9px;
  font-size: 0.76rem;
}

.graph-panel__meta :deep(.btn-secondary) {
  min-height: 28px;
  padding: 0 10px;
  border-radius: 10px;
  font-size: 0.8rem;
}

.graph-panel__button,
.graph-panel__direction-button {
  min-height: 28px;
}

.graph-panel__direction-button--active {
  border-color: rgba(255, 180, 84, 0.65);
  background: rgba(255, 180, 84, 0.14);
}

.graph-panel .section-title {
  font-size: 0.98rem;
}

.graph-panel .eyebrow {
  gap: 6px;
  font-size: 0.72rem;
}

.graph-panel .eyebrow::before {
  width: 24px;
}

.graph-panel__zoom {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.graph-panel__zoom-button {
  min-width: 28px;
  padding: 0;
}

.graph-panel__zoom-value {
  min-width: 52px;
  justify-content: center;
}

.graph-canvas__viewport {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 16px;
  background:
    radial-gradient(circle at top left, rgba(255, 180, 84, 0.08), transparent 26%),
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    rgba(0, 0, 0, 0.14);
  background-size:
    auto,
    28px 28px,
    28px 28px,
    auto;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.graph-canvas__viewport--panning {
  cursor: grabbing;
}

.graph-canvas__edges {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.graph-canvas__stage {
  position: absolute;
  inset: 0;
}

.graph-canvas__edge {
  fill: none;
  stroke: rgba(158, 200, 255, 0.6);
  stroke-width: 0.75;
  transition:
    stroke 160ms ease,
    stroke-width 160ms ease,
    opacity 160ms ease;
}

.graph-canvas__edge--active {
  stroke: rgba(255, 180, 84, 0.88);
  stroke-width: 1;
}

.graph-canvas__edge--link-source {
  stroke: rgba(124, 227, 195, 0.92);
}

.graph-canvas__edge--preview {
  stroke: rgba(255, 180, 84, 0.95);
  stroke-dasharray: 5 4;
}

.graph-node {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  overflow: visible;
}

.graph-node__frame {
  position: absolute;
  inset: 0;
  width: 240px;
  height: 124px;
  transform-origin: top left;
  will-change: transform;
}

.graph-node__card {
  position: relative;
  display: grid;
  gap: 10px;
  width: 100%;
  min-height: 124px;
  padding: 16px 18px 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(8, 18, 29, 0.9);
  color: inherit;
  cursor: pointer;
  text-align: left;
  box-shadow: 0 18px 32px rgba(0, 0, 0, 0.22);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.graph-node__card:hover {
  transform: translateY(-2px);
  border-color: var(--line-strong);
}

.graph-node__card:focus-visible {
  outline: 2px solid rgba(255, 180, 84, 0.72);
  outline-offset: 3px;
}

.graph-node--active .graph-node__card {
  border-color: rgba(255, 180, 84, 0.72);
  box-shadow:
    0 0 0 1px rgba(255, 180, 84, 0.3),
    0 18px 32px rgba(0, 0, 0, 0.22);
}

.graph-node--link-source .graph-node__card {
  border-color: rgba(124, 227, 195, 0.78);
  box-shadow:
    0 0 0 1px rgba(124, 227, 195, 0.3),
    0 18px 32px rgba(0, 0, 0, 0.22);
}

.graph-node__accent {
  position: absolute;
  inset: 0 auto 0 0;
  width: 6px;
  border-radius: 18px 0 0 18px;
}

.graph-node__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-left: 6px;
}

.graph-node__spacer {
  display: inline-block;
  width: 22px;
  height: 22px;
}

.graph-node__id,
.graph-node__count {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.graph-node__edit {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.graph-node__edit:hover {
  background: rgba(255, 255, 255, 0.05);
}

.graph-node__edit:focus-visible {
  outline: 2px solid rgba(255, 180, 84, 0.72);
  outline-offset: 2px;
}

.graph-node__edit-icon {
  width: 12px;
  height: 12px;
}

.graph-node__title {
  display: block;
  padding-left: 6px;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.06rem;
  line-height: 1.3;
}

.graph-node__id {
  padding-left: 6px;
}

.graph-node__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-left: 6px;
}

.graph-node__add {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.graph-node__add:hover {
  background: rgba(255, 255, 255, 0.05);
}

.graph-node__add:focus-visible {
  outline: 2px solid rgba(255, 180, 84, 0.72);
  outline-offset: 2px;
}

.graph-node__add-icon {
  width: 12px;
  height: 12px;
}

.graph-node__connector {
  position: absolute;
  width: 5px;
  height: 5px;
  border: 0.5px solid rgba(186, 220, 255, 0.45);
  border-radius: 999px;
  background: #08131e;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}

.graph-node__connector--input {
  pointer-events: none;
}

.graph-node__connector--output:hover,
.graph-node__connector--active {
  border-color: rgba(255, 180, 84, 0.95);
  background: rgba(255, 180, 84, 0.16);
  transform: scale(1.08);
}

.graph-node--horizontal .graph-node__connector--input {
  left: 0;
  top: calc(50% - 2.5px);
  transform: translateX(-50%);
}

.graph-node--horizontal .graph-node__connector--output {
  left: auto;
  right: 0;
  top: calc(50% - 2.5px);
  bottom: auto;
  transform: translateX(50%);
}

.graph-node:not(.graph-node--horizontal) .graph-node__connector--input {
  left: calc(50% - 2.5px);
  top: 0;
  transform: translateY(-50%);
}

.graph-node:not(.graph-node--horizontal) .graph-node__connector--output {
  left: calc(50% - 2.5px);
  bottom: 0;
  top: auto;
  transform: translateY(50%);
}

@media (max-width: 900px) {
  .graph-panel {
    padding: 8px 8px 0;
  }

  .graph-panel__header {
    flex-direction: column;
    align-items: stretch;
  }

  .graph-panel__meta {
    justify-content: flex-start;
  }
}
</style>
