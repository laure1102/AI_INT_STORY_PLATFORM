<script setup lang="ts">
/** 商城配置弹窗：管理货架分类和商品草稿，保存动作由父组件执行。 */
import { computed, reactive, shallowRef, watch } from "vue"
import type {
  StoryDocument,
  StoryItemsFile,
  StoryShopCategory,
  StoryShopFile,
  StoryShopProduct,
  StoryValsFile
} from "@story-mgr/core"
import StoryScriptTextarea from "./StoryScriptTextarea.vue"
import { openStoryScriptReferencePage } from "./storyScriptEditor"
import {
  formatStoryScriptValidationIssue,
  validateStoryScriptField
} from "./storyScriptValidation"
import {
  normalizeNumberText,
  normalizeText,
  parseIntegerInput,
  parseNonNegativeNumberInput,
  parsePositiveIntegerInput,
  sanitizeIdInput,
  type ShopCategoryDraft,
  type ShopProductDraft
} from "./storyShopDraft"

type PredicateField = "visible_expr" | "available_expr"
type ValidationStatus = "idle" | "checking" | "passed" | "failed"

interface ValidationState {
  status: ValidationStatus
  issues: string[]
}

const props = defineProps<{
  items: StoryItemsFile
  saveSuccessMessage?: string | null
  saving: boolean
  shop: StoryShopFile
  story?: StoryDocument | null
  vals?: StoryValsFile
}>()

const emit = defineEmits<{
  close: []
  save: [shop: StoryShopFile]
}>()

const activeTab = shallowRef<"categories" | "products">("products")
const draft = reactive({
  currencyValueKey: "player.money",
  categories: [] as ShopCategoryDraft[],
  products: [] as ShopProductDraft[]
})
const validationState = reactive<Record<string, ValidationState>>({})

const EMPTY_VALIDATION_STATE: ValidationState = {
  status: "idle",
  issues: []
}

let draftKeySeed = 0
/** 创建一份新的 `DraftKey` 数据。 @param prefix 调用方传入的 `prefix`。 @returns 计算、查找或构建后的结果。 */
function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}
/** 读取或计算 `ValidationState`。 @param key 调用方传入的 `key`。 @returns 计算、查找或构建后的结果。 */
function getValidationState(key: string) {
  return validationState[key] ?? EMPTY_VALIDATION_STATE
}
/** 执行 `ensureValidationState` 对应的局部业务逻辑。 @param key 调用方传入的 `key`。 @returns 计算、查找或构建后的结果。 */
function ensureValidationState(key: string) {
  validationState[key] ??= {
    status: "idle",
    issues: []
  }
  return validationState[key]
}
/** 重置或清理 `resetValidationState` 对应的临时状态。 @param key 调用方传入的 `key`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function resetValidationState(key: string) {
  delete validationState[key]
}
/** 重置或清理 `clearValidationStates` 对应的临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function clearValidationStates() {
  for (const key of Object.keys(validationState)) {
    delete validationState[key]
  }
}
/** 读取或计算 `ValidationButtonLabel`。 @param key 调用方传入的 `key`。 @returns 计算、查找或构建后的结果。 */
function getValidationButtonLabel(key: string) {
  return getValidationState(key).status === "checking" ? "校验中" : "校验"
}
/** 读取或计算 `ValidationClass`。 @param key 调用方传入的 `key`。 @returns 计算、查找或构建后的结果。 */
function getValidationClass(key: string) {
  return `shop-dialog__validation--${getValidationState(key).status}`
}
/** 读取或计算 `ValidationMessages`。 @param key 调用方传入的 `key`。 @param emptyMessage 调用方传入的 `emptyMessage`。 @param passedMessage 调用方传入的 `passedMessage`。 @returns 计算、查找或构建后的结果。 */
function getValidationMessages(key: string, emptyMessage: string, passedMessage: string) {
  const state = getValidationState(key)

  if (state.status === "idle") {
    return []
  }

  if (state.status === "checking") {
    return ["校验中..."]
  }

  if (state.status === "passed") {
    return [state.issues[0] ?? (sourceIsEmptyMessage(emptyMessage, passedMessage))]
  }

  return state.issues
}
/** 执行 `sourceIsEmptyMessage` 对应的局部业务逻辑。 @param emptyMessage 调用方传入的 `emptyMessage`。 @param passedMessage 调用方传入的 `passedMessage`。 @returns 计算、查找或构建后的结果。 */
function sourceIsEmptyMessage(emptyMessage: string, passedMessage: string) {
  return passedMessage || emptyMessage
}

const validationVals = computed<StoryValsFile>(() => {
  if (props.vals) {
    return props.vals
  }

  return {
    variables: [
      ...(props.story?.vals.variables ?? []),
      ...(props.story?.systemVals.variables ?? [])
    ]
  }
})

const itemOptions = computed(() =>
  props.items.items
    .map((item) => ({
      id: item.id.trim(),
      label: `${item.name.trim() || item.id.trim()} (${item.id.trim()})`,
      name: item.name.trim(),
      descr: item.descr.trim(),
      categoryId: item.category_id.trim()
    }))
    .filter((item) => item.id)
    .sort((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN"))
)

const itemById = computed(() => new Map(itemOptions.value.map((item) => [item.id, item])))

const categoryOptions = computed(() =>
  draft.categories
    .map((category) => ({
      value: category.id.trim(),
      label: `${category.name.trim() || category.id.trim()} (${category.id.trim()})`
    }))
    .filter((category) => category.value)
)

const productIds = computed(() =>
  draft.products.map((product) => product.id.trim()).filter(Boolean)
)

const storyForEditor = computed<StoryDocument | null>(() => {
  if (!props.story) {
    return null
  }

  return {
    ...props.story,
    shop: buildShopFile()
  }
})

const duplicateCategoryIds = computed(() => {
  const counts = new Map<string, number>()

  for (const category of draft.categories) {
    const id = sanitizeIdInput(category.id)
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([id]) => id)
  )
})

const duplicateProductIds = computed(() => {
  const counts = new Map<string, number>()

  for (const product of draft.products) {
    const id = sanitizeIdInput(product.id)
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([id]) => id)
  )
})

const categoryIdSet = computed(() =>
  new Set(draft.categories.map((category) => sanitizeIdInput(category.id)).filter(Boolean))
)

const itemIdSet = computed(() =>
  new Set(itemOptions.value.map((item) => item.id))
)

const hasInvalidDraft = computed(() => {
  if (!draft.currencyValueKey.trim()) return true
  if (duplicateCategoryIds.value.size > 0 || duplicateProductIds.value.size > 0) return true

  return draft.categories.some((category) => !sanitizeIdInput(category.id))
    || draft.products.some((product) =>
      !sanitizeIdInput(product.id)
      || !categoryIdSet.value.has(sanitizeIdInput(product.category_id))
      || !itemIdSet.value.has(product.item_id.trim())
      || parsePositiveIntegerInput(product.quantityText, 1) < 1
      || parseNonNegativeNumberInput(product.priceText, 0) < 0
    )
})
/** 复制 `Category`，避免共享可变引用。 @param category 调用方传入的 `category`。 @returns 计算、查找或构建后的结果。 */
function cloneCategory(category: StoryShopCategory): ShopCategoryDraft {
  return {
    draftKey: createDraftKey("category"),
    id: normalizeText(category.id),
    name: normalizeText(category.name),
    sort_order: Number.isInteger(category.sort_order) ? category.sort_order : 0,
    sortOrderText: normalizeNumberText(category.sort_order),
    visible_expr: normalizeText(category.visible_expr),
    descr: normalizeText(category.descr)
  }
}
/** 复制 `Product`，避免共享可变引用。 @param product 调用方传入的 `product`。 @returns 计算、查找或构建后的结果。 */
function cloneProduct(product: StoryShopProduct): ShopProductDraft {
  return {
    draftKey: createDraftKey("product"),
    id: normalizeText(product.id),
    category_id: normalizeText(product.category_id),
    item_id: normalizeText(product.item_id),
    price: Number.isFinite(product.price) ? product.price : 0,
    priceText: normalizeNumberText(product.price),
    quantity: Number.isInteger(product.quantity) && product.quantity > 0 ? product.quantity : 1,
    quantityText: normalizeNumberText(product.quantity, 1),
    sort_order: Number.isInteger(product.sort_order) ? product.sort_order : 0,
    sortOrderText: normalizeNumberText(product.sort_order),
    enabled: Boolean(product.enabled),
    available_expr: normalizeText(product.available_expr),
    unavailable_reason: normalizeText(product.unavailable_reason),
    allow_gift: Boolean(product.allow_gift),
    gift_favor_delta: Number.isInteger(product.gift_favor_delta) ? product.gift_favor_delta : 0,
    giftFavorDeltaText: normalizeNumberText(product.gift_favor_delta),
    purchase_cooldown_hours: Number.isInteger(product.purchase_cooldown_hours) ? product.purchase_cooldown_hours : 0,
    purchaseCooldownHoursText: normalizeNumberText(product.purchase_cooldown_hours),
    gift_cooldown_hours: Number.isInteger(product.gift_cooldown_hours) ? product.gift_cooldown_hours : 0,
    giftCooldownHoursText: normalizeNumberText(product.gift_cooldown_hours)
  }
}
/** 把外部或服务端数据同步到本地响应式状态。 @param shop 调用方传入的 `shop`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function syncDraft(shop: StoryShopFile) {
  draft.currencyValueKey = normalizeText(shop.currency_value_key) || "player.money"
  draft.categories = shop.categories.map(cloneCategory)
  draft.products = shop.products.map(cloneProduct)
  clearValidationStates()
}
/** 读取或计算 `NextDefaultCategoryId`。 @returns 计算、查找或构建后的结果。 */
function getNextDefaultCategoryId() {
  const usedIds = new Set(draft.categories.map((category) => sanitizeIdInput(category.id)).filter(Boolean))
  let index = draft.categories.length + 1
  let candidate = `shop_category_${index}`

  while (usedIds.has(candidate)) {
    index += 1
    candidate = `shop_category_${index}`
  }

  return candidate
}
/** 读取或计算 `NextDefaultProductId`。 @param itemId 调用方传入的 `itemId`。 @returns 计算、查找或构建后的结果。 */
function getNextDefaultProductId(itemId = "") {
  const usedIds = new Set(draft.products.map((product) => sanitizeIdInput(product.id)).filter(Boolean))
  const base = sanitizeIdInput(itemId) ? `shop_${sanitizeIdInput(itemId)}` : `shop_product_${draft.products.length + 1}`
  let candidate = base
  let index = 2

  while (usedIds.has(candidate)) {
    candidate = `${base}_${index}`
    index += 1
  }

  return candidate
}
/** 新增一项 `Category` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addCategory() {
  const sortOrder = draft.categories.length > 0
    ? Math.max(...draft.categories.map((category) => parseIntegerInput(category.sortOrderText, 0))) + 10
    : 10

  draft.categories.push({
    draftKey: createDraftKey("category"),
    id: getNextDefaultCategoryId(),
    name: "新分类",
    sort_order: sortOrder,
    sortOrderText: String(sortOrder),
    visible_expr: "",
    descr: ""
  })
  activeTab.value = "categories"
}
/** 移除指定的 `Category` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeCategory(index: number) {
  const category = draft.categories[index]
  if (!category) return

  const usedByProducts = draft.products.some((product) => product.category_id === category.id)
  if (usedByProducts && !window.confirm("这个商城分类仍被商品引用，删除后相关商品分类会被清空。继续删除吗？")) {
    return
  }

  draft.categories.splice(index, 1)
  for (const product of draft.products) {
    if (product.category_id === category.id) {
      product.category_id = ""
    }
  }
}
/** 新增一项 `Product` 草稿。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function addProduct() {
  if (draft.categories.length === 0) {
    addCategory()
  }

  const itemId = itemOptions.value[0]?.id ?? ""
  draft.products.push({
    draftKey: createDraftKey("product"),
    id: getNextDefaultProductId(itemId),
    category_id: draft.categories[0]?.id ?? "",
    item_id: itemId,
    price: 0,
    priceText: "0",
    quantity: 1,
    quantityText: "1",
    sort_order: draft.products.length * 10 + 10,
    sortOrderText: String(draft.products.length * 10 + 10),
    enabled: true,
    available_expr: "",
    unavailable_reason: "",
    allow_gift: true,
    gift_favor_delta: 0,
    giftFavorDeltaText: "0",
    purchase_cooldown_hours: 0,
    purchaseCooldownHoursText: "0",
    gift_cooldown_hours: 0,
    giftCooldownHoursText: "0"
  })
  activeTab.value = "products"
}
/** 移除指定的 `Product` 数据。 @param index 调用方传入的 `index`。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function removeProduct(index: number) {
  draft.products.splice(index, 1)
}
/** 读取或计算 `CategoryUsageCount`。 @param category 调用方传入的 `category`。 @returns 计算、查找或构建后的结果。 */
function getCategoryUsageCount(category: ShopCategoryDraft) {
  const categoryId = sanitizeIdInput(category.id)
  return draft.products.filter((product) => sanitizeIdInput(product.category_id) === categoryId).length
}
/** 读取或计算 `ValidationKey`。 @param kind 调用方传入的 `kind`。 @param draftKey 调用方传入的 `draftKey`。 @param field 调用方传入的 `field`。 @returns 计算、查找或构建后的结果。 */
function getValidationKey(kind: "category" | "product", draftKey: string, field: PredicateField) {
  return `${kind}:${draftKey}:${field}`
}
/** 校验 `PredicateField` 并整理错误信息。 @param key 调用方传入的 `key`。 @param source 调用方传入的 `source`。 @param emptyMessage 调用方传入的 `emptyMessage`。 @param passedMessage 调用方传入的 `passedMessage`。 @returns 无返回值；函数通过响应式状态或副作用完成工作。 */
async function validatePredicateField(
  key: string,
  source: string,
  emptyMessage: string,
  passedMessage: string
) {
  const state = ensureValidationState(key)
  state.status = "checking"
  state.issues = []
  await Promise.resolve()

  const result = validateStoryScriptField({
    vals: validationVals.value,
    source,
    mode: "predicate",
    story: storyForEditor.value,
    shopProductIds: productIds.value,
    bagMode: "read",
    phoneMode: "read",
    doingMode: "read",
    shopMode: "read"
  })

  state.status = result.ok ? "passed" : "failed"
  state.issues = result.ok
    ? [source.trim() ? passedMessage : emptyMessage]
    : result.issues.map((issue) => formatStoryScriptValidationIssue(issue))
}
/** 校验 `CategoryVisible` 并整理错误信息。 @param category 调用方传入的 `category`。 @returns 计算、查找或构建后的结果。 */
function validateCategoryVisible(category: ShopCategoryDraft) {
  return validatePredicateField(
    getValidationKey("category", category.draftKey, "visible_expr"),
    category.visible_expr,
    "空条件：分类始终显示。",
    "显示条件可以执行。"
  )
}
/** 校验 `ProductAvailable` 并整理错误信息。 @param product 调用方传入的 `product`。 @returns 计算、查找或构建后的结果。 */
function validateProductAvailable(product: ShopProductDraft) {
  return validatePredicateField(
    getValidationKey("product", product.draftKey, "available_expr"),
    product.available_expr,
    "空条件：商品始终可买。",
    "展示条件可以执行。"
  )
}
/** 读取或计算 `ItemLabel`。 @param itemId 调用方传入的 `itemId`。 @returns 计算、查找或构建后的结果。 */
function getItemLabel(itemId: string) {
  const item = itemById.value.get(itemId.trim())
  return item?.label ?? (itemId.trim() || "未选择物品")
}
/** 读取或计算 `ItemDescr`。 @param itemId 调用方传入的 `itemId`。 @returns 计算、查找或构建后的结果。 */
function getItemDescr(itemId: string) {
  return itemById.value.get(itemId.trim())?.descr ?? ""
}
/** 打开 `StoryScriptHelp` 界面并初始化临时状态。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function openStoryScriptHelp() {
  openStoryScriptReferencePage()
}
/** 执行 `serializeCategory` 对应的局部业务逻辑。 @param category 调用方传入的 `category`。 @returns 计算、查找或构建后的结果。 */
function serializeCategory(category: ShopCategoryDraft): StoryShopCategory {
  return {
    id: sanitizeIdInput(category.id),
    name: category.name.trim(),
    sort_order: parseIntegerInput(category.sortOrderText, 0),
    visible_expr: category.visible_expr.trim(),
    descr: category.descr.trim()
  }
}
/** 执行 `serializeProduct` 对应的局部业务逻辑。 @param product 调用方传入的 `product`。 @returns 计算、查找或构建后的结果。 */
function serializeProduct(product: ShopProductDraft): StoryShopProduct {
  return {
    id: sanitizeIdInput(product.id),
    category_id: sanitizeIdInput(product.category_id),
    item_id: product.item_id.trim(),
    price: parseNonNegativeNumberInput(product.priceText, 0),
    quantity: parsePositiveIntegerInput(product.quantityText, 1),
    sort_order: parseIntegerInput(product.sortOrderText, 0),
    enabled: product.enabled,
    available_expr: product.available_expr.trim(),
    unavailable_reason: product.unavailable_reason.trim(),
    allow_gift: product.allow_gift,
    gift_favor_delta: Math.max(-100, Math.min(100, parseIntegerInput(product.giftFavorDeltaText, 0))),
    purchase_cooldown_hours: Math.max(0, parseIntegerInput(product.purchaseCooldownHoursText, 0)),
    gift_cooldown_hours: Math.max(0, parseIntegerInput(product.giftCooldownHoursText, 0))
  }
}
/** 根据当前输入构建 `ShopFile` 结果。 @returns 计算、查找或构建后的结果。 */
function buildShopFile(): StoryShopFile {
  return {
    currency_value_key: draft.currencyValueKey.trim() || "player.money",
    categories: draft.categories.map(serializeCategory),
    products: draft.products.map(serializeProduct)
  }
}
/** 校验当前草稿并提交给父组件或 API。 @returns 无返回值；通过响应式状态、emit 或副作用体现结果。 */
function submitDraft() {
  emit("save", buildShopFile())
}

watch(
  () => props.shop,
  (shop) => {
    syncDraft(shop)
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <Teleport to="body">
    <div class="shop-dialog">
      <section class="shop-dialog__panel glass-panel">
        <header class="shop-dialog__header">
          <div>
            <span class="eyebrow">Shop</span>
            <h2 class="shop-dialog__title">商城</h2>
            <p class="shop-dialog__subtitle">商城只引用物品库资产，负责价格、展示条件、送礼好感和冷却配置。</p>
          </div>
          <div class="shop-dialog__actions">
            <span v-if="saveSuccessMessage" class="shop-dialog__success">{{ saveSuccessMessage }}</span>
            <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
            <button
              class="btn-primary"
              type="button"
              :disabled="saving || hasInvalidDraft"
              @click="submitDraft"
            >
              {{ saving ? "保存中..." : "保存商城" }}
            </button>
          </div>
        </header>

        <div class="shop-dialog__config">
          <label class="shop-dialog__field">
            <span class="shop-dialog__label">扣款变量 currency_value_key</span>
            <input v-model="draft.currencyValueKey" class="text-input" type="text" placeholder="player.money">
          </label>
          <div class="shop-dialog__tabs" role="tablist" aria-label="商城配置标签">
            <button
              class="shop-dialog__tab"
              :class="{ 'shop-dialog__tab--active': activeTab === 'products' }"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'products'"
              @click="activeTab = 'products'"
            >
              商品货架
            </button>
            <button
              class="shop-dialog__tab"
              :class="{ 'shop-dialog__tab--active': activeTab === 'categories' }"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'categories'"
              @click="activeTab = 'categories'"
            >
              商城分类
            </button>
          </div>
        </div>

        <section v-if="activeTab === 'categories'" class="shop-dialog__section">
          <div class="shop-dialog__section-head">
            <div>
              <h3 class="shop-dialog__section-title">商城分类</h3>
              <p class="shop-dialog__section-note">分类可用显示条件控制整体入口。</p>
            </div>
            <button class="btn-secondary" type="button" @click="addCategory">添加分类</button>
          </div>

          <div v-if="duplicateCategoryIds.size" class="shop-dialog__warning">分类 ID 不能重复。</div>

          <div class="shop-dialog__table-wrap">
            <table class="shop-dialog__table shop-dialog__table--categories">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>名称</th>
                  <th>排序</th>
                  <th>显示条件</th>
                  <th>说明</th>
                  <th>商品数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody v-if="draft.categories.length">
                <tr v-for="(category, index) in draft.categories" :key="category.draftKey">
                  <td><input v-model="category.id" class="text-input shop-dialog__cell-input" type="text"></td>
                  <td><input v-model="category.name" class="text-input shop-dialog__cell-input" type="text"></td>
                  <td><input v-model="category.sortOrderText" class="text-input shop-dialog__mini-input" type="text"></td>
                  <td>
                    <div class="shop-dialog__script-field">
                      <StoryScriptTextarea
                        v-model="category.visible_expr"
                        min-height="58px"
                        mode="predicate"
                        :story="storyForEditor"
                        :vals="validationVals"
                        @update:model-value="resetValidationState(getValidationKey('category', category.draftKey, 'visible_expr'))"
                      />
                      <div class="shop-dialog__field-actions">
                        <button class="shop-dialog__help-button" type="button" @click.stop="openStoryScriptHelp">?</button>
                        <button
                          class="shop-dialog__validate-button"
                          type="button"
                          :disabled="getValidationState(getValidationKey('category', category.draftKey, 'visible_expr')).status === 'checking'"
                          @click="validateCategoryVisible(category)"
                        >
                          {{ getValidationButtonLabel(getValidationKey('category', category.draftKey, 'visible_expr')) }}
                        </button>
                      </div>
                      <div
                        v-if="getValidationState(getValidationKey('category', category.draftKey, 'visible_expr')).status !== 'idle'"
                        class="shop-dialog__validation"
                        :class="getValidationClass(getValidationKey('category', category.draftKey, 'visible_expr'))"
                      >
                        <span
                          v-for="message in getValidationMessages(getValidationKey('category', category.draftKey, 'visible_expr'), '空条件：分类始终显示。', '显示条件可以执行。')"
                          :key="message"
                          class="shop-dialog__validation-message"
                        >
                          {{ message }}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td><textarea v-model="category.descr" class="text-input shop-dialog__textarea" /></td>
                  <td class="shop-dialog__usage">{{ getCategoryUsageCount(category) }}</td>
                  <td>
                    <button class="btn-secondary shop-dialog__row-button" type="button" @click="removeCategory(index)">
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!draft.categories.length" class="shop-dialog__empty">还没有商城分类。</div>
          </div>
        </section>

        <section v-else class="shop-dialog__section">
          <div class="shop-dialog__section-head">
            <div>
              <h3 class="shop-dialog__section-title">商品货架</h3>
              <p class="shop-dialog__section-note">商品必须从物品库中选择；不在这里创建新物品资产。</p>
            </div>
            <button class="btn-secondary" type="button" :disabled="itemOptions.length === 0" @click="addProduct">
              添加商品
            </button>
          </div>

          <div v-if="duplicateProductIds.size" class="shop-dialog__warning">商品 ID 不能重复。</div>
          <div v-if="itemOptions.length === 0" class="shop-dialog__warning">物品库为空，请先在“物品”里添加资产。</div>

          <div class="shop-dialog__table-wrap">
            <table class="shop-dialog__table shop-dialog__table--products">
              <thead>
                <tr>
                  <th>ID / 状态</th>
                  <th>分类 / 物品</th>
                  <th>价格 / 数量 / 排序</th>
                  <th>展示条件</th>
                  <th>送礼</th>
                  <th>冷却</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody v-if="draft.products.length">
                <tr v-for="(product, index) in draft.products" :key="product.draftKey">
                  <td>
                    <div class="shop-dialog__cell-stack">
                      <input v-model="product.id" class="text-input shop-dialog__cell-input" type="text">
                      <label class="shop-dialog__inline-check">
                        <input v-model="product.enabled" type="checkbox">
                        启用
                      </label>
                    </div>
                  </td>
                  <td>
                    <div class="shop-dialog__cell-stack">
                      <select v-model="product.category_id" class="text-input shop-dialog__select">
                        <option value="">未选择分类</option>
                        <option v-for="option in categoryOptions" :key="option.value" :value="option.value">
                          {{ option.label }}
                        </option>
                      </select>
                      <select v-model="product.item_id" class="text-input shop-dialog__select">
                        <option value="">未选择物品</option>
                        <option v-for="item in itemOptions" :key="item.id" :value="item.id">
                          {{ item.label }}
                        </option>
                      </select>
                      <span class="shop-dialog__item-descr">{{ getItemDescr(product.item_id) || getItemLabel(product.item_id) }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="shop-dialog__mini-grid">
                      <label class="shop-dialog__mini-field">
                        <span>价格</span>
                        <input v-model="product.priceText" class="text-input" type="text">
                      </label>
                      <label class="shop-dialog__mini-field">
                        <span>数量</span>
                        <input v-model="product.quantityText" class="text-input" type="text">
                      </label>
                      <label class="shop-dialog__mini-field">
                        <span>排序</span>
                        <input v-model="product.sortOrderText" class="text-input" type="text">
                      </label>
                    </div>
                  </td>
                  <td>
                    <div class="shop-dialog__script-field">
                      <StoryScriptTextarea
                        v-model="product.available_expr"
                        min-height="74px"
                        mode="predicate"
                        :story="storyForEditor"
                        :vals="validationVals"
                        @update:model-value="resetValidationState(getValidationKey('product', product.draftKey, 'available_expr'))"
                      />
                      <input
                        v-model="product.unavailable_reason"
                        class="text-input shop-dialog__cell-input"
                        type="text"
                        placeholder="条件不满足时显示的原因"
                      >
                      <div class="shop-dialog__field-actions">
                        <button class="shop-dialog__help-button" type="button" @click.stop="openStoryScriptHelp">?</button>
                        <button
                          class="shop-dialog__validate-button"
                          type="button"
                          :disabled="getValidationState(getValidationKey('product', product.draftKey, 'available_expr')).status === 'checking'"
                          @click="validateProductAvailable(product)"
                        >
                          {{ getValidationButtonLabel(getValidationKey('product', product.draftKey, 'available_expr')) }}
                        </button>
                      </div>
                      <div
                        v-if="getValidationState(getValidationKey('product', product.draftKey, 'available_expr')).status !== 'idle'"
                        class="shop-dialog__validation"
                        :class="getValidationClass(getValidationKey('product', product.draftKey, 'available_expr'))"
                      >
                        <span
                          v-for="message in getValidationMessages(getValidationKey('product', product.draftKey, 'available_expr'), '空条件：商品始终可买。', '展示条件可以执行。')"
                          :key="message"
                          class="shop-dialog__validation-message"
                        >
                          {{ message }}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div class="shop-dialog__cell-stack">
                      <label class="shop-dialog__inline-check">
                        <input v-model="product.allow_gift" type="checkbox">
                        可送人
                      </label>
                      <label class="shop-dialog__mini-field">
                        <span>好感变化</span>
                        <input v-model="product.giftFavorDeltaText" class="text-input" type="text">
                      </label>
                    </div>
                  </td>
                  <td>
                    <div class="shop-dialog__mini-grid">
                      <label class="shop-dialog__mini-field">
                        <span>购买CD(小时)</span>
                        <input v-model="product.purchaseCooldownHoursText" class="text-input" type="text">
                      </label>
                      <label class="shop-dialog__mini-field">
                        <span>送礼CD(小时)</span>
                        <input v-model="product.giftCooldownHoursText" class="text-input" type="text">
                      </label>
                    </div>
                  </td>
                  <td>
                    <button class="btn-secondary shop-dialog__row-button" type="button" @click="removeProduct(index)">
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!draft.products.length" class="shop-dialog__empty">还没有商品，先从物品库添加一件。</div>
          </div>
        </section>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./styles/StoryShopDialog.css"></style>
