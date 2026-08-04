<script setup lang="ts">
/** 地点、角色、物品和变量草稿预览；勾选与编辑会直接更新父控制器。 */
import type { StoryDocument } from "@story-mgr/core"
import type { ComputedRef } from "vue"
import type { StoryCreationWorkspaceController } from "./useStoryCreationWorkspace"

const { controller } = defineProps<{ controller: StoryCreationWorkspaceController; story: StoryDocument }>()
const {
  draftPreview: nullableDraftPreview, existingItemCategoryIds, getImpactClass,
  getItemCategoryName, getItemImpact, getRoleKey, getVariableKey,
  getItemTagsText, getLocationImpact, getRoleImpact, getVariableImpact,
  handleItemSelectionChange, handleLocationSelectionChange, handleRoleSelectionChange,
  handleVariableSelectionChange, selectedItemIds, selectedLocationIds, selectedRoleKeys,
  selectedVariableKeys, setItemMaxStackFromInput, setItemTagsText,
  setVariableValueFromInput, variableValueLabel
} = controller
const draftPreview = nullableDraftPreview as ComputedRef<
  NonNullable<typeof nullableDraftPreview.value>
>
</script>

<template>
            <section class="creation-result__section">
              <h4 class="creation-result__section-title">地点</h4>
              <ul v-if="draftPreview.locations.length" class="creation-chip-list">
                <li
                  v-for="location in draftPreview.locations"
                  :key="location.id"
                  class="creation-chip-list__item"
                >
                  <label class="creation-select">
                    <input
                      type="checkbox"
                      :checked="selectedLocationIds.includes(location.id)"
                      @change="handleLocationSelectionChange(location.id, $event)"
                    >
                  </label>
                  <strong>{{ location.id }}</strong>
                  <span
                    class="creation-impact"
                    :class="getImpactClass(getLocationImpact(location))"
                    :title="getLocationImpact(location).detail"
                  >
                    {{ getLocationImpact(location).label }}
                  </span>
                  <label class="creation-edit-field">
                    <span>说明</span>
                    <input v-model="location.descr" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>提示词</span>
                    <textarea v-model="location.prompt" class="creation-edit-textarea" rows="2" />
                  </label>
                </li>
              </ul>
              <p v-else class="creation-result__muted">未生成地点草稿。</p>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">角色</h4>
              <ul v-if="draftPreview.roles.length" class="creation-chip-list">
                <li
                  v-for="role in draftPreview.roles"
                  :key="getRoleKey(role)"
                  class="creation-chip-list__item"
                >
                  <label class="creation-select">
                    <input
                      type="checkbox"
                      :checked="selectedRoleKeys.includes(getRoleKey(role))"
                      @change="handleRoleSelectionChange(role, $event)"
                    >
                  </label>
                  <strong>{{ role.important ? "important" : "normal" }}:{{ role.id }}</strong>
                  <span
                    class="creation-impact"
                    :class="getImpactClass(getRoleImpact(role))"
                    :title="getRoleImpact(role).detail"
                  >
                    {{ getRoleImpact(role).label }}
                  </span>
                  <label class="creation-edit-field">
                    <span>名称</span>
                    <input v-model="role.name" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>身份</span>
                    <input v-model="role.zhiye" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>设定</span>
                    <textarea v-model="role.descr" class="creation-edit-textarea" rows="2" />
                  </label>
                  <label class="creation-edit-field">
                    <span>提示词</span>
                    <textarea v-model="role.prompt" class="creation-edit-textarea" rows="2" />
                  </label>
                </li>
              </ul>
              <p v-else class="creation-result__muted">未生成角色草稿。</p>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">物品</h4>
              <ul v-if="draftPreview.items.length" class="creation-chip-list">
                <li
                  v-for="item in draftPreview.items"
                  :key="item.id"
                  class="creation-chip-list__item"
                >
                  <label class="creation-select">
                    <input
                      type="checkbox"
                      :checked="selectedItemIds.includes(item.id)"
                      @change="handleItemSelectionChange(item.id, $event)"
                    >
                  </label>
                  <strong>{{ item.id }}</strong>
                  <span
                    class="creation-impact"
                    :class="getImpactClass(getItemImpact(item))"
                    :title="getItemImpact(item).detail"
                  >
                    {{ getItemImpact(item).label }}
                  </span>
                  <label class="creation-edit-field">
                    <span>名称</span>
                    <input v-model="item.name" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>分类</span>
                    <select v-model="item.category_id" class="creation-edit-input">
                      <option
                        v-if="item.category_id && !existingItemCategoryIds.has(item.category_id)"
                        :value="item.category_id"
                      >
                        缺失：{{ item.category_id }}
                      </option>
                      <option
                        v-for="category in story.items.categories"
                        :key="category.id"
                        :value="category.id"
                      >
                        {{ category.name || category.id }}
                      </option>
                    </select>
                  </label>
                  <div class="creation-item-flags">
                    <label class="creation-item-flags__check">
                      <input v-model="item.stackable" type="checkbox">
                      可堆叠
                    </label>
                    <label class="creation-item-flags__check">
                      <input v-model="item.usable" type="checkbox">
                      可使用
                    </label>
                  </div>
                  <label class="creation-edit-field">
                    <span>稀有度</span>
                    <input v-model="item.rarity" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>最大堆叠</span>
                    <input
                      class="creation-edit-input"
                      min="1"
                      type="number"
                      :value="item.max_stack"
                      @input="setItemMaxStackFromInput(item, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                  <label class="creation-edit-field">
                    <span>标签</span>
                    <input
                      class="creation-edit-input"
                      :value="getItemTagsText(item)"
                      @input="setItemTagsText(item, ($event.target as HTMLInputElement).value)"
                    >
                  </label>
                  <label class="creation-edit-field">
                    <span>说明</span>
                    <textarea v-model="item.descr" class="creation-edit-textarea" rows="2" />
                  </label>
                  <label class="creation-edit-field">
                    <span>提示词</span>
                    <textarea v-model="item.prompt" class="creation-edit-textarea" rows="2" />
                  </label>
                  <small class="creation-result__muted">
                    分类：{{ getItemCategoryName(item.category_id) }}
                  </small>
                </li>
              </ul>
              <p v-else class="creation-result__muted">未生成物品草稿。</p>
            </section>

            <section class="creation-result__section">
              <h4 class="creation-result__section-title">变量建议</h4>
              <ul v-if="draftPreview.variables.length" class="creation-chip-list">
                <li
                  v-for="variable in draftPreview.variables"
                  :key="getVariableKey(variable)"
                  class="creation-chip-list__item"
                >
                  <label class="creation-select">
                    <input
                      type="checkbox"
                      :checked="selectedVariableKeys.includes(getVariableKey(variable))"
                      @change="handleVariableSelectionChange(variable, $event)"
                    >
                  </label>
                  <strong>{{ getVariableKey(variable) }}</strong>
                  <span
                    class="creation-impact"
                    :class="getImpactClass(getVariableImpact(variable))"
                    :title="getVariableImpact(variable).detail"
                  >
                    {{ getVariableImpact(variable).label }}
                  </span>
                  <label class="creation-edit-field">
                    <span>描述</span>
                    <input v-model="variable.description" class="creation-edit-input">
                  </label>
                  <label class="creation-edit-field">
                    <span>{{ variable.value_type === "calc" ? "计算式" : "初始值" }}</span>
                    <input
                      v-if="variable.value_type !== 'calc'"
                      class="creation-edit-input"
                      :value="variableValueLabel(variable) === '空值' ? '' : variableValueLabel(variable)"
                      @input="setVariableValueFromInput(variable, ($event.target as HTMLInputElement).value)"
                    >
                    <input
                      v-else
                      v-model="variable.calc_rule"
                      class="creation-edit-input"
                    >
                  </label>
                </li>
              </ul>
              <p v-else class="creation-result__muted">未生成变量建议。</p>
            </section>
</template>
<style scoped src="./styles/StoryCreationWorkspace.part1.css"></style>
<style scoped src="./styles/StoryCreationWorkspace.part2.css"></style>
