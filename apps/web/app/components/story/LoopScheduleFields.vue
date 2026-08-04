<script setup lang="ts">
/**
 * 定时事件规则区：编辑执行顺序、循环周期和同一时刻的前置依赖。
 *
 * 这里直接操作父面板的响应式草稿，因此选择结果会立即反映到保存数据中。
 * 它不负责判断依赖环；完整的依赖合法性仍由保存前校验和 Core Validator 保证。
 */
import type { LoopEventEditorController } from "./useLoopEventEditor"

const { controller } = defineProps<{ controller: LoopEventEditorController }>()
const {
  LOOP_WEEKDAY_OPTIONS,
  clearScheduleDependencies,
  closeScheduleDependencyDialog,
  draft,
  filteredScheduleDependencyOptions,
  isScheduleDependencyDialogOpen,
  loopModeOptions,
  openScheduleDependencyDialog,
  scheduleDependencyOptions,
  scheduleDependencySearch,
  scheduleDependencySummary
} = controller
</script>

<template>
  <div v-if="draft.triggerMode !== 'invoke'" class="field field--full">
    <span class="field-label">调度顺序</span>
    <div class="detail-panel__schedule-order">
      <label class="detail-panel__schedule-order-field">
        <span class="detail-panel__loop-config-label">执行时间</span>
        <input v-model="draft.scheduleAt" class="text-input" type="time" step="60" />
      </label>
      <label class="detail-panel__schedule-order-field">
        <span class="detail-panel__loop-config-label">优先级</span>
        <input v-model.number="draft.schedulePriority" class="text-input" type="number" step="1" />
      </label>
      <label class="detail-panel__schedule-order-field detail-panel__schedule-order-field--wide">
        <span class="detail-panel__loop-config-label">前置事件</span>
        <div class="detail-panel__dependency-picker-row">
          <button
            class="detail-panel__dependency-picker"
            type="button"
            :disabled="scheduleDependencyOptions.length === 0"
            @click="openScheduleDependencyDialog"
          >
            <span class="detail-panel__dependency-picker-summary">{{ scheduleDependencySummary }}</span>
            <span class="detail-panel__dependency-picker-hint">
              {{ scheduleDependencyOptions.length ? "点击搜索选择" : "暂无可选事件" }}
            </span>
          </button>
          <button
            v-if="draft.afterIds.length"
            class="btn-secondary detail-panel__dependency-clear"
            type="button"
            @click="clearScheduleDependencies"
          >
            清空
          </button>
        </div>
      </label>
    </div>
  </div>

  <div v-if="draft.triggerMode !== 'invoke'" class="field field--full">
    <span class="field-label">循环方式</span>
    <div class="detail-panel__loop-row">
      <select v-model="draft.loopMode" class="select-input detail-panel__loop-mode">
        <option v-for="option in loopModeOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <div v-if="draft.loopMode !== 'daily'" class="detail-panel__loop-config">
        <template v-if="draft.loopMode === 'interval_days'">
          <span class="detail-panel__loop-config-label">每多少天</span>
          <input v-model.number="draft.intervalDays" class="text-input detail-panel__loop-interval" type="number" min="1" step="1" />
        </template>
        <template v-else-if="draft.loopMode === 'weekly'">
          <span class="detail-panel__loop-config-label">每周日期</span>
          <div class="detail-panel__weekday-group" role="radiogroup" aria-label="每周日期">
            <label
              v-for="option in LOOP_WEEKDAY_OPTIONS"
              :key="option.value"
              class="detail-panel__weekday-option"
              :class="{ 'detail-panel__weekday-option--active': draft.weekday === option.value }"
            >
              <input v-model="draft.weekday" class="detail-panel__weekday-input" type="radio" name="loop-weekday" :value="option.value" />
              <span>{{ option.label }}</span>
            </label>
          </div>
        </template>
        <template v-else-if="draft.loopMode === 'monthly'">
          <span class="detail-panel__loop-config-label">每月日期</span>
          <div class="detail-panel__monthday-row">
            <span class="detail-panel__monthday-prefix">每月</span>
            <input v-model.number="draft.monthDay" class="text-input detail-panel__monthday-input" type="number" min="1" max="31" step="1" />
            <span class="detail-panel__monthday-suffix">日</span>
          </div>
        </template>
      </div>
    </div>
  </div>
  <div v-else class="field field--full">
    <span class="field-label">循环方式</span>
    <div class="detail-panel__param-empty">
      当前事件为“被调用”模式，不参与循环定时扫描；只有通过
      `invoke_once schedule {{ draft.id || "event_id" }}` 调用后才会进入事件队列。
    </div>
  </div>

  <div
    v-if="isScheduleDependencyDialogOpen"
    class="detail-panel__dependency-modal"
    @click.self="closeScheduleDependencyDialog"
  >
    <section class="detail-panel__dependency-modal-panel glass-panel">
      <div class="detail-panel__dependency-modal-head">
        <div>
          <h3 class="detail-panel__dialogue-modal-title">选择前置事件</h3>
          <p class="detail-panel__dependency-modal-summary">
            已选择 {{ draft.afterIds.length }} 个，同一时间到点时会先执行这些事件。
          </p>
        </div>
        <button class="btn-secondary" type="button" @click="closeScheduleDependencyDialog">完成</button>
      </div>
      <input v-model="scheduleDependencySearch" class="text-input" type="search" placeholder="搜索事件标题或 ID" />
      <div class="detail-panel__dependency-list">
        <label
          v-for="option in filteredScheduleDependencyOptions"
          :key="option.value"
          class="detail-panel__dependency-option"
          :class="{ 'detail-panel__dependency-option--active': draft.afterIds.includes(option.value) }"
        >
          <input v-model="draft.afterIds" class="detail-panel__dependency-checkbox" type="checkbox" :value="option.value" />
          <span class="detail-panel__dependency-option-text">{{ option.label }}</span>
        </label>
        <div v-if="filteredScheduleDependencyOptions.length === 0" class="detail-panel__dependency-empty">
          没有匹配的定时事件。
        </div>
      </div>
      <div class="detail-panel__dependency-modal-actions">
        <button class="btn-secondary" type="button" :disabled="draft.afterIds.length === 0" @click="clearScheduleDependencies">清空选择</button>
        <button class="btn-primary" type="button" @click="closeScheduleDependencyDialog">完成</button>
      </div>
    </section>
  </div>
</template>

<style scoped src="./styles/LoopEventDetailPanel.part1.css"></style>
<style scoped src="./styles/LoopEventDetailPanel.part2.css"></style>
