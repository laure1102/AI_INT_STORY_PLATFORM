<script setup lang="ts">
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

interface ShopCategoryDraft extends StoryShopCategory {
  draftKey: string
  sortOrderText: string
}

interface ShopProductDraft extends StoryShopProduct {
  draftKey: string
  priceText: string
  quantityText: string
  sortOrderText: string
  giftFavorDeltaText: string
  purchaseCooldownHoursText: string
  giftCooldownHoursText: string
}

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

function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function normalizeNumberText(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback)
}

function sanitizeIdInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function parseIntegerInput(value: unknown, fallback = 0) {
  const parsed = Number(String(value ?? "").trim())
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function parseNonNegativeNumberInput(value: unknown, fallback = 0) {
  const parsed = Number(String(value ?? "").trim())
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

function parsePositiveIntegerInput(value: unknown, fallback = 1) {
  const parsed = parseIntegerInput(value, fallback)
  return Math.max(1, parsed)
}

function getValidationState(key: string) {
  return validationState[key] ?? EMPTY_VALIDATION_STATE
}

function ensureValidationState(key: string) {
  validationState[key] ??= {
    status: "idle",
    issues: []
  }
  return validationState[key]
}

function resetValidationState(key: string) {
  delete validationState[key]
}

function clearValidationStates() {
  for (const key of Object.keys(validationState)) {
    delete validationState[key]
  }
}

function getValidationButtonLabel(key: string) {
  return getValidationState(key).status === "checking" ? "校验中" : "校验"
}

function getValidationClass(key: string) {
  return `shop-dialog__validation--${getValidationState(key).status}`
}

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

function syncDraft(shop: StoryShopFile) {
  draft.currencyValueKey = normalizeText(shop.currency_value_key) || "player.money"
  draft.categories = shop.categories.map(cloneCategory)
  draft.products = shop.products.map(cloneProduct)
  clearValidationStates()
}

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

function removeProduct(index: number) {
  draft.products.splice(index, 1)
}

function getCategoryUsageCount(category: ShopCategoryDraft) {
  const categoryId = sanitizeIdInput(category.id)
  return draft.products.filter((product) => sanitizeIdInput(product.category_id) === categoryId).length
}

function getValidationKey(kind: "category" | "product", draftKey: string, field: PredicateField) {
  return `${kind}:${draftKey}:${field}`
}

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

function validateCategoryVisible(category: ShopCategoryDraft) {
  return validatePredicateField(
    getValidationKey("category", category.draftKey, "visible_expr"),
    category.visible_expr,
    "空条件：分类始终显示。",
    "显示条件可以执行。"
  )
}

function validateProductAvailable(product: ShopProductDraft) {
  return validatePredicateField(
    getValidationKey("product", product.draftKey, "available_expr"),
    product.available_expr,
    "空条件：商品始终可买。",
    "展示条件可以执行。"
  )
}

function getItemLabel(itemId: string) {
  const item = itemById.value.get(itemId.trim())
  return item?.label ?? (itemId.trim() || "未选择物品")
}

function getItemDescr(itemId: string) {
  return itemById.value.get(itemId.trim())?.descr ?? ""
}

function openStoryScriptHelp() {
  openStoryScriptReferencePage()
}

function serializeCategory(category: ShopCategoryDraft): StoryShopCategory {
  return {
    id: sanitizeIdInput(category.id),
    name: category.name.trim(),
    sort_order: parseIntegerInput(category.sortOrderText, 0),
    visible_expr: category.visible_expr.trim(),
    descr: category.descr.trim()
  }
}

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

function buildShopFile(): StoryShopFile {
  return {
    currency_value_key: draft.currencyValueKey.trim() || "player.money",
    categories: draft.categories.map(serializeCategory),
    products: draft.products.map(serializeProduct)
  }
}

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

<style scoped>
.shop-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(2, 8, 16, 0.72);
}

.shop-dialog__panel {
  width: min(1680px, calc(100vw - 28px));
  max-height: calc(100dvh - 28px);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  padding: 18px;
  overflow: hidden;
  border-radius: 22px;
}

.shop-dialog__header,
.shop-dialog__section-head,
.shop-dialog__actions,
.shop-dialog__tabs,
.shop-dialog__field-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.shop-dialog__actions,
.shop-dialog__tabs,
.shop-dialog__field-actions {
  align-items: center;
  flex-wrap: wrap;
}

.shop-dialog__title,
.shop-dialog__section-title {
  margin: 8px 0 0;
  color: var(--text);
  font-family: "Space Grotesk", sans-serif;
  line-height: 1.1;
}

.shop-dialog__title {
  font-size: 1.4rem;
}

.shop-dialog__section-title {
  font-size: 1.04rem;
}

.shop-dialog__subtitle,
.shop-dialog__section-note,
.shop-dialog__label,
.shop-dialog__item-descr,
.shop-dialog__usage {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.shop-dialog__success {
  color: var(--accent);
  font-size: 0.84rem;
}

.shop-dialog__warning {
  color: var(--warning);
  font-size: 0.82rem;
}

.shop-dialog__config {
  display: grid;
  grid-template-columns: minmax(240px, 360px) minmax(0, 1fr);
  gap: 12px;
  align-items: end;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.shop-dialog__field,
.shop-dialog__mini-field,
.shop-dialog__cell-stack,
.shop-dialog__script-field {
  display: grid;
  gap: 6px;
}

.shop-dialog__mini-field span {
  color: var(--text-muted);
  font-size: 0.74rem;
}

.shop-dialog__tab {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
}

.shop-dialog__tab--active {
  color: #06121f;
  border-color: transparent;
  background: var(--accent);
}

.shop-dialog__section {
  min-height: 0;
  display: grid;
  gap: 12px;
  overflow: auto;
  padding-right: 4px;
}

.shop-dialog__table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.shop-dialog__table {
  width: 100%;
  border-collapse: collapse;
}

.shop-dialog__table--categories {
  min-width: 1180px;
}

.shop-dialog__table--products {
  min-width: 1480px;
}

.shop-dialog__table th,
.shop-dialog__table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.shop-dialog__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(9, 19, 30, 0.92);
  color: var(--text-muted);
  font-size: 0.82rem;
}

.shop-dialog__cell-input,
.shop-dialog__select,
.shop-dialog__mini-input {
  width: 100%;
  min-width: 0;
}

.shop-dialog__mini-input {
  max-width: 92px;
}

.shop-dialog__mini-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.shop-dialog__textarea {
  min-height: 58px;
  resize: vertical;
}

.shop-dialog__inline-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.shop-dialog__help-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 180, 84, 0.32);
  border-radius: 999px;
  background: rgba(255, 180, 84, 0.1);
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
}

.shop-dialog__validate-button {
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid rgba(124, 227, 195, 0.24);
  border-radius: 999px;
  color: var(--accent);
  background: rgba(124, 227, 195, 0.08);
  font-size: 0.74rem;
  white-space: nowrap;
}

.shop-dialog__validate-button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.shop-dialog__validation {
  display: grid;
  gap: 4px;
  padding: 7px 9px;
  border: 1px solid rgba(186, 220, 255, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  font-size: 0.78rem;
  line-height: 1.4;
}

.shop-dialog__validation--passed {
  border-color: rgba(124, 227, 195, 0.3);
  color: var(--accent);
  background: rgba(124, 227, 195, 0.08);
}

.shop-dialog__validation--failed {
  border-color: rgba(255, 139, 123, 0.36);
  color: #ffb4a9;
  background: rgba(255, 139, 123, 0.08);
}

.shop-dialog__validation--checking {
  color: var(--text-muted);
}

.shop-dialog__validation-message {
  overflow-wrap: anywhere;
}

.shop-dialog__row-button {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 0.8rem;
}

.shop-dialog__empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

@media (max-width: 900px) {
  .shop-dialog__header,
  .shop-dialog__section-head,
  .shop-dialog__actions,
  .shop-dialog__config,
  .shop-dialog__mini-grid {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
