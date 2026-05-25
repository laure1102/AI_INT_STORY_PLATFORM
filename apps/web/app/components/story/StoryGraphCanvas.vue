<script setup lang="ts">
import type { ComponentPublicInstance } from "vue"
import type { StoryEventFile, StoryViewFile, StoryViewNode } from "@story-mgr/core"

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

interface DragState {
  eventId: string
  moved: boolean
  originX: number
  originY: number
  startClientX: number
  startClientY: number
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
  view: StoryViewFile | null
}>()

const emit = defineEmits<{
  saveView: [view: StoryViewFile]
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
const AUTO_LAYOUT_COLUMN_GAP = 320
const AUTO_LAYOUT_ROW_GAP = 240
const AUTO_LAYOUT_START_X = 120
const AUTO_LAYOUT_START_Y = 80
const STORY_GRAPH_LAYOUT_VERSION = 2

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

const dragState = shallowRef<DragState | null>(null)
const panState = shallowRef<PanState | null>(null)
const linkSourceId = shallowRef<string | null>(null)
const suppressClickBefore = shallowRef(0)
const canvasScale = shallowRef(1)
const localNodes = ref<GraphNodeView[]>([])

const colorPalette = [
  "#ffb454",
  "#7ce3c3",
  "#c8e1ff",
  "#ff8b7b",
  "#ffd66b",
  "#87b7ff"
]

const nodeCardElements = new Map<string, HTMLDivElement>()
let nodeCardObserver: ResizeObserver | null = null
let viewportObserver: ResizeObserver | null = null

function createDefaultPosition(index: number) {
  const column = index % 3
  const row = Math.floor(index / 3)

  return {
    x: AUTO_LAYOUT_START_X + column * AUTO_LAYOUT_COLUMN_GAP,
    y: AUTO_LAYOUT_START_Y + row * AUTO_LAYOUT_ROW_GAP
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
  entryEventId?: string | null
) {
  const eventMap = new Map(events.map((event) => [event.id, event]))
  const treeChildren = new Map(events.map((event) => [event.id, [] as string[]]))
  const assignedParent = new Map<string, string | null>()
  const depthById = new Map<string, number>()
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

  const positionMap = new Map<string, { x: number; y: number }>()
  let nextLeafColumn = 0

  function layoutNode(nodeId: string): number {
    const children = treeChildren.get(nodeId) ?? []
    const depth = depthById.get(nodeId) ?? 0
    const y = AUTO_LAYOUT_START_Y + depth * AUTO_LAYOUT_ROW_GAP

    if (!children.length) {
      const x = AUTO_LAYOUT_START_X + nextLeafColumn * AUTO_LAYOUT_COLUMN_GAP
      nextLeafColumn += 1
      positionMap.set(nodeId, { x, y })
      return x
    }

    const childColumns = children.map((childId) => layoutNode(childId))
    const x = Math.round((childColumns[0] + childColumns[childColumns.length - 1]) / 2)
    positionMap.set(nodeId, { x, y })
    return x
  }

  for (const rootId of rootIds) {
    if (nextLeafColumn > 0) {
      nextLeafColumn += 1
    }

    layoutNode(rootId)
  }

  for (const [index, event] of events.entries()) {
    if (!positionMap.has(event.id)) {
      positionMap.set(event.id, createDefaultPosition(index))
    }
  }

  return positionMap
}

function createNodeMap(view: StoryViewFile | null) {
  return new Map<string, StoryViewNode>(view?.nodes.map((node) => [node.eventId, node]) ?? [])
}

function buildNodeViews(
  events: StoryEventFile[],
  view: StoryViewFile | null,
  previousHeights: Map<string, number>
): GraphNodeView[] {
  const viewNodes = createNodeMap(view)
  const autoLayoutPositions = buildAutoLayoutPositionMap(events, props.entryEventId)
  const preferAutoLayout = (view?.layoutVersion ?? 0) < STORY_GRAPH_LAYOUT_VERSION

  return events.map((event, index) => {
    const layoutNode = viewNodes.get(event.id)
    const fallbackPosition = autoLayoutPositions.get(event.id) ?? createDefaultPosition(index)
    const resolvedX = preferAutoLayout ? fallbackPosition.x : (layoutNode?.x ?? fallbackPosition.x)
    const resolvedY = preferAutoLayout ? fallbackPosition.y : (layoutNode?.y ?? fallbackPosition.y)

    return {
      color: layoutNode?.color ?? colorPalette[index % colorPalette.length] ?? "#87b7ff",
      eventId: event.id,
      height: previousHeights.get(event.id) ?? NODE_HEIGHT,
      nextCount: event.next.length,
      title: event.title,
      x: Math.round(resolvedX),
      y: Math.round(resolvedY)
    }
  })
}

const nodeMap = computed(() => {
  return new Map(localNodes.value.map((node) => [node.eventId, node]))
})

const viewportViewBox = computed(() => {
  return `0 0 ${Math.max(viewportSize.width, 1)} ${Math.max(viewportSize.height, 1)}`
})

const zoomPercentageLabel = computed(() => {
  return `${Math.round(canvasScale.value * 100)}%`
})

const isAtMinimumZoom = computed(() => {
  return canvasScale.value <= MIN_CANVAS_SCALE + 0.001
})

const isAtMaximumZoom = computed(() => {
  return canvasScale.value >= MAX_CANVAS_SCALE - 0.001
})

const isAtDefaultZoom = computed(() => {
  return Math.abs(canvasScale.value - 1) < 0.001
})

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
        x1: toScreenX(sourceNode.x) + (NODE_WIDTH * canvasScale.value) / 2,
        x2: toScreenX(targetNode.x) + (NODE_WIDTH * canvasScale.value) / 2,
        y1: toScreenY(sourceNode.y) + sourceNode.height * canvasScale.value,
        y2: toScreenY(targetNode.y)
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
    x1: toScreenX(sourceNode.x) + (NODE_WIDTH * canvasScale.value) / 2,
    x2: pointerPosition.x,
    y1: toScreenY(sourceNode.y) + sourceNode.height * canvasScale.value,
    y2: pointerPosition.y
  }
})

const linkModeLabel = computed(() => {
  if (!linkSourceId.value) {
    return "剧情沿纵轴自上而下展开。滚轮可缩放，拖动画布空白区域可平移，点击节点底部连接点即可选择下一个事件。"
  }

  const sourceNode = nodeMap.value.get(linkSourceId.value)
  if (!sourceNode) {
    return "当前已开启连线模式。"
  }

  return `连线模式：${sourceNode.title}。可滚轮缩放或拖动画布查看，再点击目标节点以新增或移除向下连接。`
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

function syncNodeViews() {
  const previousHeights = new Map(localNodes.value.map((node) => [node.eventId, node.height]))

  localNodes.value = buildNodeViews(props.events, props.view, previousHeights)
  void nextTick().then(() => {
    measureNodeHeights()
  })
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

function updateNodePosition(eventId: string, x: number, y: number) {
  localNodes.value = localNodes.value.map((node) => {
    if (node.eventId !== eventId) {
      return node
    }

    return {
      ...node,
      x: Math.round(x),
      y: Math.round(y)
    }
  })
}

function setNodeCardElement(eventId: string, element: Element | ComponentPublicInstance | null) {
  const previousElement = nodeCardElements.get(eventId)

  if (previousElement && previousElement !== element) {
    nodeCardObserver?.unobserve(previousElement)
  }

  if (element instanceof HTMLDivElement) {
    nodeCardElements.set(eventId, element)
    nodeCardObserver?.observe(element)
    return
  }

  nodeCardElements.delete(eventId)
}

function measureNodeHeights() {
  let hasChanges = false

  const nextNodes = localNodes.value.map((node) => {
    const cardElement = nodeCardElements.get(node.eventId)
    if (!cardElement) {
      return node
    }

    const measuredHeight = Math.max(NODE_HEIGHT, cardElement.offsetHeight)
    if (measuredHeight === node.height) {
      return node
    }

    hasChanges = true

    return {
      ...node,
      height: measuredHeight
    }
  })

  if (hasChanges) {
    localNodes.value = nextNodes
  }
}

function buildViewPayload(): StoryViewFile {
  return {
    id: props.view?.id ?? "main",
    layoutVersion: STORY_GRAPH_LAYOUT_VERSION,
    name: props.view?.name ?? "主画布",
    nodes: localNodes.value.map((node) => ({
      color: node.color,
      eventId: node.eventId,
      x: node.x,
      y: node.y
    }))
  }
}

function applyAutoLayout() {
  const positionMap = buildAutoLayoutPositionMap(props.events, props.entryEventId)

  localNodes.value = localNodes.value.map((node) => {
    const nextPosition = positionMap.get(node.eventId)
    if (!nextPosition) {
      return node
    }

    return {
      ...node,
      x: nextPosition.x,
      y: nextPosition.y
    }
  })

  linkSourceId.value = null
  centerGraph()
  emit("saveView", buildViewPayload())
}

function addWindowInteractionListeners() {
  window.addEventListener("pointermove", handleWindowPointerMove)
  window.addEventListener("pointerup", handleWindowPointerUp)
}

function removeWindowInteractionListeners() {
  window.removeEventListener("pointermove", handleWindowPointerMove)
  window.removeEventListener("pointerup", handleWindowPointerUp)
}

function finishWindowInteraction(shouldSaveView: boolean) {
  const activeDrag = dragState.value
  const activePan = panState.value

  removeWindowInteractionListeners()
  dragState.value = null
  panState.value = null

  if (activeDrag?.moved) {
    suppressClickBefore.value = Date.now() + 120

    if (shouldSaveView) {
      emit("saveView", buildViewPayload())
    }
  }

  if (activePan?.moved) {
    suppressClickBefore.value = Date.now() + 120
  }
}

function handleWindowPointerMove(event: PointerEvent) {
  updatePointerPosition(event)

  const activeDrag = dragState.value
  if (activeDrag) {
    const deltaX = (event.clientX - activeDrag.startClientX) / canvasScale.value
    const deltaY = (event.clientY - activeDrag.startClientY) / canvasScale.value

    if (!activeDrag.moved && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
      activeDrag.moved = true
    }

    updateNodePosition(activeDrag.eventId, activeDrag.originX + deltaX, activeDrag.originY + deltaY)
    return
  }

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
  finishWindowInteraction(true)
}

function handleNodeDragStart(event: PointerEvent, eventId: string) {
  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const node = nodeMap.value.get(eventId)
  if (!node) {
    return
  }

  emit("select", eventId)
  updatePointerPosition(event)
  finishWindowInteraction(false)

  dragState.value = {
    eventId,
    moved: false,
    originX: node.x,
    originY: node.y,
    startClientX: event.clientX,
    startClientY: event.clientY
  }

  addWindowInteractionListeners()
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
  finishWindowInteraction(false)

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

function handleViewportPointerMove(event: PointerEvent) {
  updatePointerPosition(event)
}

function handleViewportWheel(event: WheelEvent) {
  if (dragState.value || panState.value) {
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

function createEdgePath(edge: GraphEdgeView) {
  const direction = edge.y2 >= edge.y1 ? 1 : -1
  const curve = Math.max(90 * canvasScale.value, Math.abs(edge.y2 - edge.y1) * 0.45)

  return [
    `M ${edge.x1} ${edge.y1}`,
    `C ${edge.x1} ${edge.y1 + curve * direction},`,
    `${edge.x2} ${edge.y2 - curve * direction},`,
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

function isNodeActive(eventId: string) {
  return props.selectedEventId === eventId
}

function isNodeLinkSource(eventId: string) {
  return linkSourceId.value === eventId
}

watch(
  () => [props.events, props.view] as const,
  () => {
    syncNodeViews()
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

  for (const cardElement of nodeCardElements.values()) {
    nodeCardObserver.observe(cardElement)
  }

  void nextTick().then(() => {
    measureNodeHeights()
  })
})

watch(
  () => props.view?.layoutVersion ?? 0,
  (layoutVersion) => {
    if (layoutVersion >= STORY_GRAPH_LAYOUT_VERSION || !props.events.length) {
      return
    }

    applyAutoLayout()
  },
  { immediate: true }
)

onUnmounted(() => {
  finishWindowInteraction(false)
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
        <h2 class="section-title">无限剧情画布</h2>
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
        <button class="btn-secondary graph-panel__button" type="button" @click="applyAutoLayout">
          自动布局
        </button>
        <button class="btn-secondary graph-panel__button" type="button" @click="centerGraph">
          视图居中
        </button>
      </div>
    </div>

    <p class="graph-panel__instructions muted">
      {{ linkModeLabel }}
    </p>

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
      <svg
        class="graph-canvas__edges"
        :viewBox="viewportViewBox"
        preserveAspectRatio="none"
      >
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
                <button
                  class="graph-node__drag"
                  type="button"
                  title="拖动节点"
                  aria-label="拖动节点"
                  @click.stop
                  @pointerdown="handleNodeDragStart($event, node.eventId)"
                >
                  <span class="graph-node__drag-icon" aria-hidden="true" />
                </button>

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
            type="button"
            tabindex="-1"
            aria-hidden="true"
          />

          <button
            class="graph-node__connector graph-node__connector--output"
            :class="{ 'graph-node__connector--active': isNodeLinkSource(node.eventId) }"
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
  padding: 22px;
}

.graph-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.graph-panel__headline {
  display: grid;
  gap: 10px;
}

.graph-panel__meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
}

.graph-panel__button {
  min-height: 40px;
}

.graph-panel__instructions {
  margin: 16px 0 18px;
  line-height: 1.7;
}

.graph-canvas__viewport {
  position: relative;
  overflow: hidden;
  max-width: 100%;
  height: 3000px;
  border: 1px solid var(--line);
  border-radius: 22px;
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
  stroke-width: 1.5;
  transition:
    stroke 160ms ease,
    stroke-width 160ms ease,
    opacity 160ms ease;
}

.graph-canvas__edge--active {
  stroke: rgba(255, 180, 84, 0.88);
  stroke-width: 2;
}

.graph-canvas__edge--link-source {
  stroke: rgba(124, 227, 195, 0.92);
}

.graph-canvas__edge--preview {
  stroke: rgba(255, 180, 84, 0.95);
  stroke-dasharray: 10 8;
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

.graph-node__id,
.graph-node__count {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.graph-node__drag {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: grab;
  touch-action: none;
}

.graph-node__drag-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  background:
    radial-gradient(circle, currentColor 1.2px, transparent 1.25px) 0 0 / 5px 5px,
    radial-gradient(circle, currentColor 1.2px, transparent 1.25px) 2.5px 2.5px / 5px 5px;
  opacity: 0.9;
}

.graph-node__drag:hover {
  background: rgba(255, 255, 255, 0.05);
}

.graph-node__drag:focus-visible {
  outline: 2px solid rgba(255, 180, 84, 0.72);
  outline-offset: 2px;
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

.graph-node__drag:active {
  cursor: grabbing;
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
  left: calc(50% - 10px);
  width: 20px;
  height: 20px;
  border: 2px solid rgba(186, 220, 255, 0.45);
  border-radius: 999px;
  background: #08131e;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}

.graph-node__connector--input {
  top: 0;
  transform: translateY(-50%);
  pointer-events: none;
}

.graph-node__connector--output {
  bottom: 0;
  transform: translateY(50%);
}

.graph-node__connector--output:hover,
.graph-node__connector--active {
  border-color: rgba(255, 180, 84, 0.95);
  background: rgba(255, 180, 84, 0.16);
  transform: scale(1.08);
}

@media (max-width: 900px) {
  .graph-panel {
    padding: 18px;
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
