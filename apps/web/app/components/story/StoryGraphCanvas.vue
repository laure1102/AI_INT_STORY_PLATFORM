<script setup lang="ts">
/** 剧情图组件：模板只渲染节点，交互和布局分别由两个模块提供。 */
import { toRefs } from "vue"
import {
  useStoryGraphCanvas,
  type StoryGraphCanvasEmits,
  type StoryGraphCanvasProps
} from "./useStoryGraphCanvas"

const props = defineProps<StoryGraphCanvasProps>()
const emit = defineEmits<StoryGraphCanvasEmits>()
const editor = useStoryGraphCanvas(props, emit)
const {
  canvasBackgroundStyle, edges, isAtDefaultZoom, isAtMaximumZoom,
  isAtMinimumZoom, isHorizontalDirection, linkSourceId, localNodes, panState,
  previewEdge, viewportViewBox, zoomPercentageLabel
} = toRefs(editor)
const {
  centerGraph, createEdgePath, getConnectorStyle, getNodeFrameStyle, getNodeStyle,
  handleConnectorClick, handleNodeCreate, handleNodeCreateAction, handleNodeDelete,
  handleNodeEdit, handleNodeKeydown, handleNodeSelect, handleViewportClick,
  handleViewportPointerDown, handleViewportPointerMove, handleViewportWheel,
  isNodeActive, isNodeDropTarget, isNodeLinkSource, resetZoom, setNodeCardElement,
  switchDirection, zoomIn, zoomOut
} = editor
</script>

<template>
  <section class="graph-panel glass-panel">
    <div class="graph-panel__header">
      <div class="graph-panel__header-left">
        <div class="graph-panel__headline">
          <span class="eyebrow">图谱画布</span>
          <h2 class="section-title">自动布局剧情画布</h2>
        </div>

        <button
          class="btn-secondary graph-panel__button"
          type="button"
          @click="emit('createRoot')"
        >
          创建根事件
        </button>
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
            'graph-canvas__edge--active': edge.fromEventId === selectedEventId || edge.toEventId === selectedEventId,
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
          :key="node.id"
          class="graph-node"
          :class="{
            'graph-node--active': isNodeActive(node.id),
            'graph-node--horizontal': isHorizontalDirection,
            'graph-node--link-source': isNodeLinkSource(node.id),
            'graph-node--drop-target': isNodeDropTarget(node.id),
            'graph-node--action': node.kind === 'action',
            'graph-node--invoke': node.triggerMode === 'invoke',
            'graph-node--condition': node.triggerMode === 'condition'
          }"
          :data-graph-node-id="node.id"
          :style="getNodeStyle(node)"
        >
          <div class="graph-node__frame" :style="getNodeFrameStyle(node)">
            <div
              class="graph-node__card"
              :ref="(element) => setNodeCardElement(node.id, element)"
              role="button"
              tabindex="0"
              @click.stop="handleNodeSelect(node.id)"
              @keydown="handleNodeKeydown($event, node.id)"
            >
              <div
                class="graph-node__accent"
                :style="{ background: `linear-gradient(135deg, ${node.color}, rgba(255,255,255,0.15))` }"
              />
              <span
                v-if="node.triggerMode === 'invoke'"
                class="graph-node__trigger-mark graph-node__trigger-mark--invoke"
                title="被调用"
                aria-label="被调用"
              />
              <span
                v-else-if="node.triggerMode === 'condition'"
                class="graph-node__trigger-mark graph-node__trigger-mark--condition"
                title="条件触发"
                aria-label="条件触发"
              >
                ★
              </span>

              <div class="graph-node__header">
                <strong class="graph-node__title graph-node__title--header">{{ node.title }}</strong>

                <div class="graph-node__tools">
                  <button
                    class="graph-node__tool"
                    type="button"
                    title="编辑节点"
                    aria-label="编辑节点"
                    @click.stop="handleNodeEdit(node.id)"
                  >
                    <svg class="graph-node__edit-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.99-1.66Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>

                  <button
                    class="graph-node__tool graph-node__tool--danger"
                    type="button"
                    title="删除节点"
                    aria-label="删除节点"
                    @click.stop="handleNodeDelete(node.id)"
                  >
                    <svg class="graph-node__edit-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Zm-1 11h12a2 2 0 0 0 2-2V8H4v10a2 2 0 0 0 2 2Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <span class="graph-node__id">{{ node.id }}</span>

              <div class="graph-node__footer">
                <span v-if="node.kind === 'event'" class="graph-node__count">
                  {{ node.nextCount }} 条出线
                </span>
                <span v-else class="graph-node__count graph-node__count--empty" aria-hidden="true" />
                <div class="graph-node__actions">
                  <button
                    v-if="node.kind === 'event'"
                    class="graph-node__add graph-node__add--action"
                    type="button"
                    title="新增操作"
                    aria-label="新增操作"
                    @click.stop="handleNodeCreateAction(node.id)"
                  >
                    <svg class="graph-node__add-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M6 5.75A2.75 2.75 0 1 1 6 11.25a2.75 2.75 0 0 1 0-5.5Zm0 1.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm12 5.5a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5Zm0 1.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM6 14.75a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5Zm0 1.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm2.1-8.56 6.98 4.03-.76 1.31-6.98-4.03.76-1.31Zm-.76 8.62 6.98-4.03.76 1.31-6.98 4.03-.76-1.31Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                  <button
                    class="graph-node__add"
                    type="button"
                    title="新增事件"
                    aria-label="新增事件"
                    @click.stop="handleNodeCreate(node.id)"
                  >
                    <svg class="graph-node__add-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M11 5h2v14h-2zM5 11h14v2H5z" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button
            class="graph-node__connector graph-node__connector--input"
            :style="getConnectorStyle(node.kind, 'input')"
            type="button"
            tabindex="-1"
            aria-hidden="true"
          />

          <button
            class="graph-node__connector graph-node__connector--output"
            :class="{ 'graph-node__connector--active': isNodeLinkSource(node.id) }"
            :style="getConnectorStyle(node.kind, 'output')"
            type="button"
            :title="isNodeLinkSource(node.id) ? '取消连线' : '开始连线'"
            @click.stop="handleConnectorClick(node.id)"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="./styles/StoryGraphCanvas.css"></style>
