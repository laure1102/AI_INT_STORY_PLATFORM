import type {
  StoryAnyEventFile,
  StoryActionFile,
  StoryChainNodeFile,
  StoryDocument,
  StoryEventFile,
  StoryEventPresentation,
  StoryPoolEventFile,
  StoryScheduleEventFile,
  ValidationIssue,
  ValidationResult
} from "./types"
import { findStoryRoleReference } from "./roles"
import {
  DEFAULT_MAX_CALC_NESTING_DEPTH,
  evaluateStoryBooleanExpression,
  validateStoryScript,
  validateStoryScriptInvokeReferences,
  validateStoryTextTemplate,
  validateStoryValsCalcRules
} from "@story-mgr/runtime"
import type {
  StoryScriptExecutionContext,
  StoryScriptValidationIssue
} from "@story-mgr/runtime"
import type { StoryValsFile } from "./types"
export type { StoryScriptValidationIssue } from "@story-mgr/runtime"
export {
  validateStoryScriptInvokeReferences
} from "@story-mgr/runtime"

type EventValidationGroupKey = "chainEvents" | "poolEvents" | "scheduleEvents" | "doing"
type PlayableValidationGroupKey = EventValidationGroupKey

function normalizeStoryScriptText(value: unknown) {
  return typeof value === "string" ? value : ""
}

interface StoryEventValidationShape {
  id: string
  trigger_mode?: "default" | "condition" | "invoke"
  trigger_expr: string
  invoke_params?: Array<{
    name: string
    descr?: string
  }>
  init_script: string
  end_script: string
  object_keys: string[]
  presentation: StoryEventPresentation
  location: string
}

function buildCombinedStoryScriptVals(document: StoryDocument): StoryValsFile {
  return {
    variables: [
      ...document.vals.variables,
      ...document.systemVals.variables
    ]
  }
}

function collectValidationRoleKeys(document: StoryDocument) {
  const keys = new Set<string>()

  for (const role of document.roles.normal.roles) {
    const roleId = role.id.trim()
    if (roleId) {
      keys.add(`normal:${roleId}`)
    }
  }

  for (const role of document.roles.important.roles) {
    const roleId = role.id.trim()
    if (roleId) {
      keys.add(`important:${roleId}`)
    }
  }

  return keys
}

function collectValidationItemIds(document: StoryDocument) {
  return document.items.items.map((item) => item.id)
}

function collectItemIds(document: StoryDocument) {
  return new Set(collectValidationItemIds(document))
}

function collectValidationDoingIds(document: StoryDocument) {
  return document.doing.doings.map((doing) => doing.id)
}

function collectValidationShopProductIds(document: StoryDocument) {
  return document.shop.products.map((product) => product.id)
}

function collectValidationPhoneConversationIds(document: StoryDocument) {
  return document.phoneConversations.conversations.map((conversation) => conversation.id)
}

function collectValidationReferValues(document: StoryDocument) {
  const values: Record<string, unknown> = {}

  for (const term of document.refer.terms) {
    const rawTermId = term.id.trim()
    const termId = rawTermId.startsWith("term.") ? rawTermId.slice("term.".length) : rawTermId
    if (!termId) {
      continue
    }

    values[`term.${termId}`] = term.fallback || term.male || term.female || ""
  }

  return values
}

function buildValidationScriptContext(
  document: StoryDocument,
  context?: StoryScriptExecutionContext
): StoryScriptExecutionContext {
  return createStoryScriptValidationContext({
    values: {
      ...collectValidationReferValues(document),
      ...(context?.values ?? {})
    },
    assignableValues: {
      ...(context?.assignableValues ?? {})
    },
    functions: {
      ...(context?.functions ?? {})
    },
    itemIds: collectValidationItemIds(document),
    roleKeys: collectValidationRoleKeys(document),
    doingIds: collectValidationDoingIds(document),
    shopProductIds: collectValidationShopProductIds(document),
    phoneConversationIds: collectValidationPhoneConversationIds(document),
    bagMode: "write",
    phoneMode: "write",
    doingMode: "write",
    shopMode: "write"
  })
}

function buildValidationReadableContext(document: StoryDocument): StoryScriptExecutionContext {
  return createStoryScriptValidationContext({
    values: collectValidationReferValues(document),
    itemIds: collectValidationItemIds(document),
    roleKeys: collectValidationRoleKeys(document),
    doingIds: collectValidationDoingIds(document),
    shopProductIds: collectValidationShopProductIds(document),
    phoneConversationIds: collectValidationPhoneConversationIds(document),
    bagMode: "read",
    phoneMode: "read",
    doingMode: "read",
    shopMode: "read"
  })
}

export type StoryScriptValidationMode = "predicate" | "procedure" | "template"

export type StoryScriptValidationBagMode = "read" | "write"
export type StoryScriptValidationPhoneMode = "read" | "write"
export type StoryScriptValidationDoingMode = "read" | "write"
export type StoryScriptValidationShopMode = "read" | "write"

export interface StoryScriptValidationContextOptions {
  values?: Record<string, unknown>
  assignableValues?: Record<string, unknown>
  functions?: Record<string, (...args: unknown[]) => unknown>
  itemIds?: Iterable<string>
  roleKeys?: Iterable<string>
  doingIds?: Iterable<string>
  shopProductIds?: Iterable<string>
  phoneConversationIds?: Iterable<string>
  bagMode?: StoryScriptValidationBagMode
  phoneMode?: StoryScriptValidationPhoneMode
  doingMode?: StoryScriptValidationDoingMode
  shopMode?: StoryScriptValidationShopMode
}

function buildValidationBagReadableFunctionsFromIds(itemIds: Iterable<string>) {
  const itemIdSet = new Set(
    Array.from(itemIds, (itemId) => normalizeStoryScriptText(itemId).trim()).filter(Boolean)
  )

  const assertItemId = (itemId: unknown) => {
    if (typeof itemId !== "string") {
      throw new Error("bag item id is required.")
    }

    const normalizedItemId = itemId.trim()
    if (!normalizedItemId) {
      throw new Error("bag item id is required.")
    }

    if (!itemIdSet.has(normalizedItemId)) {
      throw new Error(`bag item "${normalizedItemId}" does not exist in item library.`)
    }
  }

  return {
    bag_count(_ownerId: unknown, itemId: unknown) {
      assertItemId(itemId)
      return 0
    },
    bag_has(_ownerId: unknown, itemId: unknown) {
      assertItemId(itemId)
      return false
    }
  }
}

function buildValidationBagScriptFunctionsFromIds(
  itemIds: Iterable<string>,
  bagMode: StoryScriptValidationBagMode
) {
  const readableFunctions = buildValidationBagReadableFunctionsFromIds(itemIds)

  if (bagMode === "read") {
    return readableFunctions
  }

  return {
    bag_add(_ownerId: unknown, itemId: unknown, quantity?: unknown) {
      readableFunctions.bag_count(_ownerId, itemId)
      return typeof quantity === "number" && Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 1
    },
    ...readableFunctions,
    bag_remove(_ownerId: unknown, itemId: unknown) {
      readableFunctions.bag_count(_ownerId, itemId)
      return false
    }
  }
}

function buildValidationPhoneReadableFunctionsFromRoleKeys(roleKeys: Iterable<string>) {
  const roleKeySet = new Set(
    Array.from(roleKeys, (roleKey) => normalizeStoryScriptText(roleKey).trim()).filter(Boolean)
  )

  const assertRoleKey = (roleKey: unknown) => {
    if (typeof roleKey !== "string") {
      throw new Error("phone role key is required.")
    }

    const normalizedRoleKey = roleKey.trim()
    if (!normalizedRoleKey) {
      throw new Error("phone role key is required.")
    }

    if (!roleKeySet.has(normalizedRoleKey)) {
      throw new Error(`phone role "${normalizedRoleKey}" does not exist in role library.`)
    }

    return normalizedRoleKey
  }

  return {
    phone_has_contact(roleKey: unknown) {
      assertRoleKey(roleKey)
      return false
    },
    phone_favor(roleKey: unknown) {
      assertRoleKey(roleKey)
      return 0
    },
    phone_unread_count(roleKey: unknown) {
      assertRoleKey(roleKey)
      return 0
    }
  }
}

function buildValidationPhoneScriptFunctionsFromRoleKeys(
  roleKeys: Iterable<string>,
  phoneConversationIds: Iterable<string>,
  phoneMode: StoryScriptValidationPhoneMode
) {
  const readableFunctions = buildValidationPhoneReadableFunctionsFromRoleKeys(roleKeys)
  const phoneConversationIdSet = new Set(
    Array.from(phoneConversationIds, (conversationId) => normalizeStoryScriptText(conversationId).trim()).filter(Boolean)
  )

  if (phoneMode === "read") {
    return readableFunctions
  }

  return {
    phone_add_contact(roleKey: unknown) {
      readableFunctions.phone_has_contact(roleKey)
      return true
    },
    phone_remove_contact(roleKey: unknown) {
      readableFunctions.phone_has_contact(roleKey)
      return false
    },
    phone_set_favor(roleKey: unknown, favor?: unknown) {
      readableFunctions.phone_has_contact(roleKey)
      return typeof favor === "number" && Number.isFinite(favor)
        ? Math.max(0, Math.min(100, Math.trunc(favor)))
        : 0
    },
    phone_add_favor(roleKey: unknown, delta?: unknown) {
      readableFunctions.phone_has_contact(roleKey)
      return typeof delta === "number" && Number.isFinite(delta)
        ? Math.max(0, Math.min(100, Math.trunc(delta)))
        : 0
    },
    phone_send_from_contact(roleKey: unknown, content?: unknown) {
      readableFunctions.phone_has_contact(roleKey)
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("phone message content is required.")
      }
      return content.trim()
    },
    phone_send_to_contact(roleKey: unknown, content?: unknown) {
      readableFunctions.phone_has_contact(roleKey)
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("phone message content is required.")
      }
      return content.trim()
    },
    phone_mark_read(roleKey: unknown) {
      readableFunctions.phone_has_contact(roleKey)
      return 0
    },
    phone_start_conversation(conversationId: unknown) {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("phone conversation id is required.")
      }

      const normalizedConversationId = conversationId.trim()
      if (!phoneConversationIdSet.has(normalizedConversationId)) {
        throw new Error(`phone conversation "${normalizedConversationId}" does not exist in phone conversation library.`)
      }

      return true
    },
    ...readableFunctions
  }
}

function buildValidationDoingReadableFunctionsFromIds(doingIds: Iterable<string>) {
  const doingIdSet = new Set(
    Array.from(doingIds, (doingId) => normalizeStoryScriptText(doingId).trim()).filter(Boolean)
  )

  const assertDoingId = (doingId: unknown) => {
    if (typeof doingId !== "string") {
      throw new Error("doing id is required.")
    }

    const normalizedDoingId = doingId.trim()
    if (!normalizedDoingId) {
      throw new Error("doing id is required.")
    }

    if (!doingIdSet.has(normalizedDoingId)) {
      throw new Error(`doing "${normalizedDoingId}" does not exist in doing library.`)
    }

    return normalizedDoingId
  }

  return {
    doing_has(doingId: unknown) {
      assertDoingId(doingId)
      return false
    },
    doing_used_count(doingId: unknown) {
      assertDoingId(doingId)
      return 0
    },
    doing_cooldown_left(doingId: unknown) {
      assertDoingId(doingId)
      return 0
    }
  }
}

function buildValidationDoingScriptFunctionsFromIds(
  doingIds: Iterable<string>,
  doingMode: StoryScriptValidationDoingMode
) {
  const readableFunctions = buildValidationDoingReadableFunctionsFromIds(doingIds)

  if (doingMode === "read") {
    return readableFunctions
  }

  return {
    doing_unlock(doingId: unknown) {
      readableFunctions.doing_has(doingId)
      return true
    },
    doing_lock(doingId: unknown) {
      readableFunctions.doing_has(doingId)
      return false
    },
    doing_set_cooldown(doingId: unknown, hours?: unknown) {
      readableFunctions.doing_has(doingId)
      return typeof hours === "number" && Number.isFinite(hours)
        ? Math.max(0, Math.trunc(hours))
        : 0
    },
    ...readableFunctions
  }
}

function buildValidationShopReadableFunctionsFromIds(productIds: Iterable<string>) {
  const productIdSet = new Set(
    Array.from(productIds, (productId) => normalizeStoryScriptText(productId).trim()).filter(Boolean)
  )

  const assertProductId = (productId: unknown) => {
    if (typeof productId !== "string") {
      throw new Error("shop product id is required.")
    }

    const normalizedProductId = productId.trim()
    if (!normalizedProductId) {
      throw new Error("shop product id is required.")
    }

    if (!productIdSet.has(normalizedProductId)) {
      throw new Error(`shop product "${normalizedProductId}" does not exist in shop library.`)
    }

    return normalizedProductId
  }

  return {
    shop_can_buy(productId: unknown) {
      assertProductId(productId)
      return false
    },
    shop_purchase_cooldown_left(productId: unknown) {
      assertProductId(productId)
      return 0
    },
    shop_gift_cooldown_left(productId: unknown, roleKey: unknown) {
      assertProductId(productId)
      if (typeof roleKey !== "string" || !roleKey.trim()) {
        throw new Error("shop gift role key is required.")
      }
      return 0
    }
  }
}

function buildValidationShopScriptFunctionsFromIds(
  productIds: Iterable<string>,
  shopMode: StoryScriptValidationShopMode
) {
  const readableFunctions = buildValidationShopReadableFunctionsFromIds(productIds)

  if (shopMode === "read") {
    return readableFunctions
  }

  return {
    shop_buy(productId: unknown) {
      readableFunctions.shop_can_buy(productId)
      return false
    },
    shop_gift(productId: unknown, roleKey: unknown) {
      readableFunctions.shop_gift_cooldown_left(productId, roleKey)
      return false
    },
    ...readableFunctions
  }
}

export function createStoryScriptValidationContext(
  options: StoryScriptValidationContextOptions = {}
): StoryScriptExecutionContext {
  const bagMode = options.bagMode ?? "write"
  const phoneMode = options.phoneMode ?? "write"
  const doingMode = options.doingMode ?? "write"
  const shopMode = options.shopMode ?? "write"

  return {
    values: {
      ...(options.values ?? {})
    },
    assignableValues: {
      ...(options.assignableValues ?? {})
    },
    functions: {
      ...buildValidationBagScriptFunctionsFromIds(options.itemIds ?? [], bagMode),
      ...buildValidationPhoneScriptFunctionsFromRoleKeys(
        options.roleKeys ?? [],
        options.phoneConversationIds ?? [],
        phoneMode
      ),
      ...buildValidationDoingScriptFunctionsFromIds(options.doingIds ?? [], doingMode),
      ...buildValidationShopScriptFunctionsFromIds(options.shopProductIds ?? [], shopMode),
      ...(options.functions ?? {})
    }
  }
}

function createStoryScriptValidationIssueFromError(error: unknown): StoryScriptValidationIssue {
  if (
    error &&
    typeof error === "object" &&
    "lineNumber" in error &&
    typeof (error as { lineNumber?: unknown }).lineNumber === "number"
  ) {
    return {
      lineNumber: (error as { lineNumber: number }).lineNumber,
      message: error instanceof Error ? error.message : "Script validation failed."
    }
  }

  return {
    lineNumber: 0,
    message: error instanceof Error ? error.message : "Script validation failed."
  }
}

export function validateStoryScriptContent(
  valsFile: StoryValsFile,
  source: string,
  mode: StoryScriptValidationMode,
  maxDepth = DEFAULT_MAX_CALC_NESTING_DEPTH,
  context?: StoryScriptExecutionContext
): StoryScriptValidationIssue[] {
  const trimmedSource = normalizeStoryScriptText(source).trim()

  if (!trimmedSource) {
    return []
  }

  if (mode === "template") {
    return validateStoryTextTemplate(source)
  }

  if (mode === "procedure") {
    return validateStoryScript(valsFile, source, maxDepth, context)
  }

  try {
    evaluateStoryBooleanExpression(valsFile, source, maxDepth, context)
    return []
  } catch (error) {
    return [createStoryScriptValidationIssueFromError(error)]
  }
}

function buildInvokeScriptContext(
  document: StoryDocument,
  event: StoryEventValidationShape
) {
  const values = Object.fromEntries(
    (event.invoke_params ?? [])
      .map((param) => param.name.trim())
      .filter(Boolean)
      .map((name) => [`call.${name}`, null] as const)
  )

  return buildValidationScriptContext(document, {
    values,
    assignableValues: {}
  })
}

function buildStoryInvokeValidationTargets(document: StoryDocument) {
  const chainTargets = document.chainEvents
    .filter((event): event is StoryEventFile => isChainEventNode(event) && (event.trigger_mode ?? "default") === "invoke")
    .map((event) => ({
      type: "chain" as const,
      eventId: event.id,
      paramNames: (event.invoke_params ?? []).map((param) => param.name)
    }))

  const poolTargets = document.poolEvents
    .filter((event) => (event.trigger_mode ?? "default") === "invoke")
    .map((event) => ({
      type: "pool" as const,
      eventId: event.id,
      paramNames: (event.invoke_params ?? []).map((param) => param.name)
    }))

  const scheduleTargets = document.scheduleEvents
    .filter((event) => (event.trigger_mode ?? "default") === "invoke")
    .map((event) => ({
      type: "schedule" as const,
      eventId: event.id,
      paramNames: (event.invoke_params ?? []).map((param) => param.name)
    }))

  return [...chainTargets, ...poolTargets, ...scheduleTargets]
}

function buildChainActionScriptContext(
  document: StoryDocument,
  action: StoryActionFile
) {
  const values = Object.fromEntries(
    (action.vars ?? [])
      .map((actionVar) => actionVar.name.trim())
      .filter(Boolean)
      .map((name) => [`branch.${name}`, null] as const)
  )
  const assignableValues = { ...values }

  return buildValidationScriptContext(document, {
    values,
    assignableValues
  })
}

function pushIssue(
  issues: ValidationIssue[],
  level: ValidationIssue["level"],
  code: string,
  message: string,
  path: string[]
) {
  issues.push({ level, code, message, path })
}

function validateTextTemplateField(
  issues: ValidationIssue[],
  code: string,
  label: string,
  value: string,
  path: string[]
) {
  for (const issue of validateStoryTextTemplate(value)) {
    pushIssue(
      issues,
      "error",
      code,
      `${label} template is invalid at line ${issue.lineNumber}: ${issue.message}`,
      path
    )
  }
}

function isChainActionNode(event: StoryChainNodeFile): event is StoryActionFile {
  return "exec_script" in event
}

function isChainEventNode(event: StoryChainNodeFile): event is StoryEventFile {
  return "next" in event && !("exec_script" in event)
}

function collectLocationNames(document: StoryDocument) {
  return new Set(document.eventLocations.assignments.map((assignment) => assignment.id))
}

function collectGlobalValKeys(document: StoryDocument) {
  const keys = new Set<string>()

  for (const group of document.vals.variables) {
    const groupName = group.name.trim()

    for (const row of group.vals) {
      const rowName = row.name.trim()

      if (!groupName || !rowName) {
        continue
      }

      keys.add(`${groupName}.${rowName}`)
    }
  }

  return keys
}

function collectWritableGlobalValKeys(document: StoryDocument) {
  const keys = new Set<string>()

  for (const group of document.vals.variables) {
    const groupName = group.name.trim()

    for (const row of group.vals) {
      const rowName = row.name.trim()

      if (!groupName || !rowName || row.value_type !== "value") {
        continue
      }

      keys.add(`${groupName}.${rowName}`)
    }
  }

  return keys
}

function validateShopConfig(document: StoryDocument, issues: ValidationIssue[]) {
  const itemIds = collectItemIds(document)
  const valsFile = buildCombinedStoryScriptVals(document)
  const readableContext = buildValidationReadableContext(document)
  const writableValKeys = collectWritableGlobalValKeys(document)
  const currencyKey = document.shop.currency_value_key.trim()

  if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(currencyKey)) {
    pushIssue(
      issues,
      "error",
      "shop.currency-key-invalid",
      `Shop currency_value_key "${currencyKey}" must use group.name format.`,
      ["shop", "currency_value_key"]
    )
  } else if (!writableValKeys.has(currencyKey)) {
    pushIssue(
      issues,
      "error",
      "shop.currency-key-missing",
      `Shop currency_value_key "${currencyKey}" must reference an existing writable value variable in vals.json5.`,
      ["shop", "currency_value_key"]
    )
  }

  for (const [categoryIndex, category] of document.shop.categories.entries()) {
    if (!category.visible_expr.trim()) {
      continue
    }

    const visibleIssues = validateStoryScriptContent(
      valsFile,
      category.visible_expr,
      "predicate",
      DEFAULT_MAX_CALC_NESTING_DEPTH,
      readableContext
    )

    for (const issue of visibleIssues) {
      pushIssue(
        issues,
        "error",
        "shop.category.visible-invalid",
        `Shop category "${category.id}" visible_expr is invalid at line ${issue.lineNumber}: ${issue.message}`,
        ["shop", "categories", String(categoryIndex), "visible_expr"]
      )
    }
  }

  for (const [productIndex, product] of document.shop.products.entries()) {
    if (!itemIds.has(product.item_id)) {
      pushIssue(
        issues,
        "error",
        "shop.product.missing-item",
        `Shop product "${product.id}" references missing item "${product.item_id}".`,
        ["shop", "products", String(productIndex), "item_id"]
      )
    }

    if (!product.available_expr.trim()) {
      continue
    }

    const availableIssues = validateStoryScriptContent(
      valsFile,
      product.available_expr,
      "predicate",
      DEFAULT_MAX_CALC_NESTING_DEPTH,
      readableContext
    )

    for (const issue of availableIssues) {
      pushIssue(
        issues,
        "error",
        "shop.product.available-invalid",
        `Shop product "${product.id}" available_expr is invalid at line ${issue.lineNumber}: ${issue.message}`,
        ["shop", "products", String(productIndex), "available_expr"]
      )
    }
  }
}

function validatePhoneConfig(document: StoryDocument, issues: ValidationIssue[]) {
  const roleKeys = collectValidationRoleKeys(document)
  const relationshipTrackIds = new Set<string>(
    document.phone.relationship_tracks.map((track) => track.id).filter((trackId) => trackId !== "none")
  )
  const personalityIds = new Set(
    document.phone.personality_library.map((personality) => personality.id)
  )
  const quickMessageIds = new Set(document.phone.player_quick_messages.map((message) => message.id))
  const talkSuggestionIds = new Set(document.phone.talk_library.map((entry) => entry.id))
  const proactiveSuggestionIds = new Set([...quickMessageIds, ...talkSuggestionIds])
  const itemIds = new Set(collectValidationItemIds(document))
  const invokeTargetKeys = new Set(
    buildStoryInvokeValidationTargets(document).map((target) => `${target.type}:${target.eventId}`)
  )
  const readableContext = buildValidationReadableContext(document)
  const valsFile = buildCombinedStoryScriptVals(document)

  const validatePhoneScope = (
    scope: {
      role_keys: string[]
      contact_tracks: string[]
      personality_ids: string[]
    },
    basePath: string[],
    label: string
  ) => {
    for (const [roleKeyIndex, roleKey] of scope.role_keys.entries()) {
      if (!roleKeys.has(roleKey)) {
        pushIssue(
          issues,
          "error",
          "phone.scope.missing-role",
          `${label} references unknown role "${roleKey}".`,
          [...basePath, "role_keys", String(roleKeyIndex)]
        )
      }
    }

    for (const [trackIndex, trackId] of scope.contact_tracks.entries()) {
      if (trackId === "none") {
        continue
      }

      if (!relationshipTrackIds.has(trackId)) {
        pushIssue(
          issues,
          "error",
          "phone.scope.missing-track",
          `${label} references unknown contact track "${trackId}".`,
          [...basePath, "contact_tracks", String(trackIndex)]
        )
      }
    }

    for (const [personalityIndex, personalityId] of scope.personality_ids.entries()) {
      if (!personalityIds.has(personalityId)) {
        pushIssue(
          issues,
          "error",
          "phone.scope.missing-personality",
          `${label} references unknown personality "${personalityId}".`,
          [...basePath, "personality_ids", String(personalityIndex)]
        )
      }
    }
  }

  const validatePhoneInvoke = (
    invoke: { target_type: string; event_id: string } | undefined,
    basePath: string[],
    label: string
  ) => {
    if (!invoke) {
      return
    }

    if (!invokeTargetKeys.has(`${invoke.target_type}:${invoke.event_id}`)) {
      pushIssue(
        issues,
        "error",
        "phone.invoke.missing-event",
        `${label} references missing invoke event "${invoke.target_type}:${invoke.event_id}".`,
        [...basePath, "event_id"]
      )
    }
  }

  for (const [roleIndex, role] of document.roles.normal.roles.entries()) {
    if (role.contact_track !== "none" && !relationshipTrackIds.has(role.contact_track)) {
      pushIssue(
        issues,
        "error",
        "phone.role.missing-track",
        `Normal role "${role.id}" references unknown contact track "${role.contact_track}".`,
        ["roles", "normal", "roles", String(roleIndex), "contact_track"]
      )
    }

    if (role.xingge_id && !personalityIds.has(role.xingge_id)) {
      pushIssue(
        issues,
        "error",
        "phone.role.missing-personality",
        `Normal role "${role.id}" references unknown personality "${role.xingge_id}".`,
        ["roles", "normal", "roles", String(roleIndex), "xingge_id"]
      )
    }
  }

  for (const [roleIndex, role] of document.roles.important.roles.entries()) {
    if (role.contact_track !== "none" && !relationshipTrackIds.has(role.contact_track)) {
      pushIssue(
        issues,
        "error",
        "phone.role.missing-track",
        `Important role "${role.id}" references unknown contact track "${role.contact_track}".`,
        ["roles", "important", "roles", String(roleIndex), "contact_track"]
      )
    }

    if (role.xingge_id && !personalityIds.has(role.xingge_id)) {
      pushIssue(
        issues,
        "error",
        "phone.role.missing-personality",
        `Important role "${role.id}" references unknown personality "${role.xingge_id}".`,
        ["roles", "important", "roles", String(roleIndex), "xingge_id"]
      )
    }
  }

  for (const [messageIndex, message] of document.phone.player_quick_messages.entries()) {
    validateTextTemplateField(
      issues,
      "phone.quick-message.template-invalid",
      `Phone quick message "${message.id}" text`,
      message.text,
      ["phone", "player_quick_messages", String(messageIndex), "text"]
    )

    for (const [roleKeyIndex, roleKey] of message.available_role_keys.entries()) {
      if (!roleKeys.has(roleKey)) {
        pushIssue(
          issues,
          "error",
          "phone.quick-message.missing-role",
          `Phone quick message "${message.id}" references unknown role "${roleKey}".`,
          ["phone", "player_quick_messages", String(messageIndex), "available_role_keys", String(roleKeyIndex)]
        )
      }
    }
  }

  for (const [entryIndex, entry] of document.phone.talk_library.entries()) {
    validateTextTemplateField(
      issues,
      "phone.talk.template-invalid",
      `Phone talk "${entry.id}" text`,
      entry.text,
      ["phone", "talk_library", String(entryIndex), "text"]
    )

    validatePhoneScope(
      entry.scope,
      ["phone", "talk_library", String(entryIndex), "scope"],
      `Phone talk "${entry.id}"`
    )
    validatePhoneInvoke(
      entry.invoke,
      ["phone", "talk_library", String(entryIndex), "invoke"],
      `Phone talk "${entry.id}"`
    )
  }

  for (const [entryIndex, entry] of document.phone.action_library.entries()) {
    validateTextTemplateField(
      issues,
      "phone.action.label-template-invalid",
      `Phone action "${entry.id}" label`,
      entry.label,
      ["phone", "action_library", String(entryIndex), "label"]
    )
    validateTextTemplateField(
      issues,
      "phone.action.text-template-invalid",
      `Phone action "${entry.id}" text`,
      entry.text,
      ["phone", "action_library", String(entryIndex), "text"]
    )

    validatePhoneScope(
      entry.scope,
      ["phone", "action_library", String(entryIndex), "scope"],
      `Phone action "${entry.id}"`
    )
    validatePhoneInvoke(
      entry.invoke,
      ["phone", "action_library", String(entryIndex), "invoke"],
      `Phone action "${entry.id}"`
    )

    for (const [costIndex, costItem] of entry.cost_items.entries()) {
      if (!itemIds.has(costItem.item_id)) {
        pushIssue(
          issues,
          "error",
          "phone.action.missing-item",
          `Phone action "${entry.id}" references missing item "${costItem.item_id}".`,
          ["phone", "action_library", String(entryIndex), "cost_items", String(costIndex), "item_id"]
        )
      }
    }
  }

  for (const [entryIndex, entry] of document.phone.reply_library.entries()) {
    for (const [replyIndex, reply] of entry.replies.entries()) {
      validateTextTemplateField(
        issues,
        "phone.reply.template-invalid",
        `Phone reply "${entry.id}" reply`,
        reply,
        ["phone", "reply_library", String(entryIndex), "replies", String(replyIndex)]
      )
    }

    validatePhoneScope(
      entry.scope,
      ["phone", "reply_library", String(entryIndex), "scope"],
      `Phone reply "${entry.id}"`
    )
  }

  for (const [profileIndex, profile] of document.phone.contact_profiles.entries()) {
    if (!roleKeys.has(profile.role_key)) {
      pushIssue(
        issues,
        "error",
        "phone.contact-profile.missing-role",
        `Phone contact profile "${profile.role_key}" does not exist in roles library.`,
        ["phone", "contact_profiles", String(profileIndex), "role_key"]
      )
    }

    for (const [tag, replies] of Object.entries(profile.reply_by_tag)) {
      for (const [replyIndex, reply] of replies.entries()) {
        validateTextTemplateField(
          issues,
          "phone.contact-profile.reply-template-invalid",
          `Phone contact profile "${profile.role_key}" reply "${tag}"`,
          reply,
          [
            "phone",
            "contact_profiles",
            String(profileIndex),
            "reply_by_tag",
            tag,
            String(replyIndex)
          ]
        )
      }
    }

    for (const [ruleIndex, rule] of profile.proactive_messages.entries()) {
      for (const [messageIndex, message] of rule.messages.entries()) {
        validateTextTemplateField(
          issues,
          "phone.proactive-rule.message-template-invalid",
          `Phone proactive rule "${profile.role_key}/${rule.id}" message`,
          message,
          [
            "phone",
            "contact_profiles",
            String(profileIndex),
            "proactive_messages",
            String(ruleIndex),
            "messages",
            String(messageIndex)
          ]
        )
      }

      const triggerIssues = validateStoryScriptContent(
        valsFile,
        rule.trigger_expr,
        "predicate",
        DEFAULT_MAX_CALC_NESTING_DEPTH,
        readableContext
      )

      for (const triggerIssue of triggerIssues) {
        pushIssue(
          issues,
          "error",
          "phone.proactive-rule.trigger-invalid",
          `Phone proactive rule "${profile.role_key}/${rule.id}" trigger_expr is invalid at line ${triggerIssue.lineNumber}: ${triggerIssue.message}`,
          [
            "phone",
            "contact_profiles",
            String(profileIndex),
            "proactive_messages",
            String(ruleIndex),
            "trigger_expr"
          ]
        )
      }

      for (const [replyIndex, quickMessageId] of rule.reply_quick_message_ids.entries()) {
        if (!proactiveSuggestionIds.has(quickMessageId)) {
          pushIssue(
            issues,
            "error",
            "phone.proactive-rule.missing-quick-message",
            `Phone proactive rule "${profile.role_key}/${rule.id}" references missing reply suggestion "${quickMessageId}".`,
            [
              "phone",
              "contact_profiles",
              String(profileIndex),
              "proactive_messages",
              String(ruleIndex),
              "reply_quick_message_ids",
              String(replyIndex)
            ]
          )
        }
      }
    }
  }

  for (const [tag, replies] of Object.entries(document.phone.fallback_replies)) {
    for (const [replyIndex, reply] of replies.entries()) {
      validateTextTemplateField(
        issues,
        "phone.fallback-reply.template-invalid",
        `Phone fallback reply "${tag}"`,
        reply,
        ["phone", "fallback_replies", tag, String(replyIndex)]
      )
    }
  }
}

function validatePhoneConversationsConfig(document: StoryDocument, issues: ValidationIssue[]) {
  const roleKeys = collectValidationRoleKeys(document)
  const valsFile = buildCombinedStoryScriptVals(document)
  const readableContext = buildValidationReadableContext(document)
  const scriptContext = buildValidationScriptContext(document)
  const invokeTargets = buildStoryInvokeValidationTargets(document)
  const invokeTargetKeys = new Set(
    invokeTargets.map((target) => `${target.type}:${target.eventId}`)
  )

  for (const [conversationIndex, conversation] of document.phoneConversations.conversations.entries()) {
    const conversationPath = ["phoneConversations", "conversations", String(conversationIndex)]

    if (!roleKeys.has(conversation.role_key)) {
      pushIssue(
        issues,
        "error",
        "phone-conversation.missing-role",
        `Phone conversation "${conversation.id}" references unknown role "${conversation.role_key}".`,
        [...conversationPath, "role_key"]
      )
    }

    if (conversation.trigger_expr.trim()) {
      const triggerIssues = validateStoryScriptContent(
        valsFile,
        conversation.trigger_expr,
        "predicate",
        DEFAULT_MAX_CALC_NESTING_DEPTH,
        readableContext
      )

      for (const issue of triggerIssues) {
        pushIssue(
          issues,
          "error",
          "phone-conversation.trigger-invalid",
          `Phone conversation "${conversation.id}" trigger_expr is invalid at line ${issue.lineNumber}: ${issue.message}`,
          [...conversationPath, "trigger_expr"]
        )
      }
    }

    for (const [nodeIndex, node] of conversation.nodes.entries()) {
      const nodePath = [...conversationPath, "nodes", String(nodeIndex)]

      for (const [messageIndex, message] of node.contact_messages.entries()) {
        validateTextTemplateField(
          issues,
          "phone-conversation.message-template-invalid",
          `Phone conversation "${conversation.id}/${node.id}" contact message`,
          message.content,
          [...nodePath, "contact_messages", String(messageIndex), "content"]
        )
      }

      if (node.end_script.trim()) {
        for (const issue of validateStoryScript(
          valsFile,
          node.end_script,
          undefined,
          scriptContext
        )) {
          pushIssue(
            issues,
            "error",
            "phone-conversation.end-script-invalid",
            `Phone conversation "${conversation.id}/${node.id}" end_script is invalid at line ${issue.lineNumber}: ${issue.message}`,
            [...nodePath, "end_script"]
          )
        }

        for (const issue of validateStoryScriptInvokeReferences(node.end_script, invokeTargets)) {
          pushIssue(
            issues,
            "error",
            "phone-conversation.end-script-invoke-invalid",
            `Phone conversation "${conversation.id}/${node.id}" end_script invoke_once 引用无效，第 ${issue.lineNumber} 行: ${issue.message}`,
            [...nodePath, "end_script"]
          )
        }
      }

      if (node.invoke && !invokeTargetKeys.has(`${node.invoke.target_type}:${node.invoke.event_id}`)) {
        pushIssue(
          issues,
          "error",
          "phone-conversation.invoke-missing-event",
          `Phone conversation "${conversation.id}/${node.id}" references missing invoke event "${node.invoke.target_type}:${node.invoke.event_id}".`,
          [...nodePath, "invoke", "event_id"]
        )
      }

      for (const [optionIndex, option] of node.player_options.entries()) {
        const optionPath = [...nodePath, "player_options", String(optionIndex)]

        validateTextTemplateField(
          issues,
          "phone-conversation.option-template-invalid",
          `Phone conversation "${conversation.id}/${node.id}" option "${option.id}" text`,
          option.text,
          [...optionPath, "text"]
        )

        if (option.visible_expr.trim()) {
          const visibleIssues = validateStoryScriptContent(
            valsFile,
            option.visible_expr,
            "predicate",
            DEFAULT_MAX_CALC_NESTING_DEPTH,
            readableContext
          )

          for (const issue of visibleIssues) {
            pushIssue(
              issues,
              "error",
              "phone-conversation.option-visible-invalid",
              `Phone conversation "${conversation.id}/${node.id}" option "${option.id}" visible_expr is invalid at line ${issue.lineNumber}: ${issue.message}`,
              [...optionPath, "visible_expr"]
            )
          }
        }

        if (option.script.trim()) {
          for (const issue of validateStoryScript(
            valsFile,
            option.script,
            undefined,
            scriptContext
          )) {
            pushIssue(
              issues,
              "error",
              "phone-conversation.option-script-invalid",
              `Phone conversation "${conversation.id}/${node.id}" option "${option.id}" script is invalid at line ${issue.lineNumber}: ${issue.message}`,
              [...optionPath, "script"]
            )
          }

          for (const issue of validateStoryScriptInvokeReferences(option.script, invokeTargets)) {
            pushIssue(
              issues,
              "error",
              "phone-conversation.option-script-invoke-invalid",
              `Phone conversation "${conversation.id}/${node.id}" option "${option.id}" script invoke_once 引用无效，第 ${issue.lineNumber} 行: ${issue.message}`,
              [...optionPath, "script"]
            )
          }
        }
      }
    }
  }
}

function getPresentationDialogues(presentation: StoryEventPresentation) {
  return presentation.type === "dialogue" ? presentation.dialogues : []
}

function buildEventValidationPath(
  eventGroupKey: EventValidationGroupKey,
  eventIndex: number,
  ...segments: string[]
) {
  if (eventGroupKey === "doing") {
    return ["doing", "doings", String(eventIndex), ...segments]
  }

  return [eventGroupKey, String(eventIndex), ...segments]
}

function validatePresentationTemplates(
  issues: ValidationIssue[],
  eventGroupKey: PlayableValidationGroupKey,
  eventIndex: number,
  eventId: string,
  presentation: StoryEventPresentation
) {
  if (presentation.type === "message") {
    for (const issue of validateStoryTextTemplate(presentation.message.content)) {
      pushIssue(
        issues,
        "error",
        `${eventGroupKey}.message-template-invalid`,
        `${eventId} message template is invalid at line ${issue.lineNumber}: ${issue.message}`,
        buildEventValidationPath(eventGroupKey, eventIndex, "presentation", "message", "content")
      )
    }
    return
  }

  const dialogues = getPresentationDialogues(presentation)
  for (const [dialogueIndex, dialogue] of dialogues.entries()) {
    for (const issue of validateStoryTextTemplate(dialogue.content)) {
      pushIssue(
        issues,
        "error",
        `${eventGroupKey}.dialogue-template-invalid`,
        `${eventId} dialogue template is invalid at line ${issue.lineNumber}: ${issue.message}`,
        buildEventValidationPath(
          eventGroupKey,
          eventIndex,
          "presentation",
          "dialogues",
          String(dialogueIndex),
          "content"
        )
      )
    }
  }
}

function getEventValidationMeta(eventGroupKey: EventValidationGroupKey) {
  if (eventGroupKey === "chainEvents") {
    return { codePrefix: "chain", label: "Chain event" }
  }

  if (eventGroupKey === "scheduleEvents") {
    return { codePrefix: "schedule", label: "Schedule event" }
  }

  if (eventGroupKey === "doing") {
    return { codePrefix: "doing", label: "Doing" }
  }

  return { codePrefix: "pool", label: "Pool event" }
}

function validateInvokeParamDefinitions(
  issues: ValidationIssue[],
  eventGroupKey: EventValidationGroupKey,
  eventIndex: number,
  event: StoryEventValidationShape
) {
  const { codePrefix, label } = getEventValidationMeta(eventGroupKey)

  for (const [paramIndex, param] of (event.invoke_params ?? []).entries()) {
    const trimmedName = param.name.trim()

    if (!trimmedName) {
      continue
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedName)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.invoke-param-invalid`,
        `${label} "${event.id}" invoke param "${param.name}" must be a valid identifier.`,
        buildEventValidationPath(eventGroupKey, eventIndex, "invoke_params", String(paramIndex), "name")
      )
    }
  }
}

function validatePlayableEvent(
  event: StoryEventValidationShape,
  eventIndex: number,
  eventGroupKey: EventValidationGroupKey,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  const locationNames = collectLocationNames(document)
  const allowedSpeakerKeys = new Set(["player", ...event.object_keys])
  const invokeTargets = buildStoryInvokeValidationTargets(document)
  const triggerMode = event.trigger_mode ?? "default"
  const scriptContext = triggerMode === "invoke"
    ? buildInvokeScriptContext(document, event)
    : buildValidationScriptContext(document)
  const scriptVals = buildCombinedStoryScriptVals(document)
  const { codePrefix, label } = getEventValidationMeta(eventGroupKey)

  if (triggerMode === "condition") {
    if (!event.trigger_expr.trim()) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.trigger-expr-required`,
        `${label} "${event.id}" trigger_expr is required when trigger_mode is condition.`,
        buildEventValidationPath(eventGroupKey, eventIndex, "trigger_expr")
      )
    }

    if (event.trigger_expr.trim()) {
      try {
        evaluateStoryBooleanExpression(
          scriptVals,
          event.trigger_expr,
          undefined,
          buildValidationReadableContext(document)
        )
      } catch (error) {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.trigger-expr-invalid`,
          `${label} "${event.id}" trigger_expr is invalid: ${error instanceof Error ? error.message : "Validation failed."}`,
          buildEventValidationPath(eventGroupKey, eventIndex, "trigger_expr")
        )
      }
    }
  }

  if (triggerMode === "invoke" && event.trigger_expr.trim()) {
    pushIssue(
      issues,
      "error",
      `${codePrefix}.trigger-expr-not-allowed`,
      `${label} "${event.id}" trigger_expr must stay empty when trigger_mode is invoke.`,
      buildEventValidationPath(eventGroupKey, eventIndex, "trigger_expr")
    )
  }

  validateInvokeParamDefinitions(issues, eventGroupKey, eventIndex, event)

  for (const scriptField of [
    { key: "init_script", value: event.init_script, code: `${codePrefix}.init-script-invalid` },
    { key: "end_script", value: event.end_script, code: `${codePrefix}.end-script-invalid` }
  ] as const) {
    for (const issue of validateStoryScript(
      scriptVals,
      scriptField.value,
      undefined,
      scriptContext
    )) {
      pushIssue(
        issues,
        "error",
        scriptField.code,
        `${label} "${event.id}" ${scriptField.key} is invalid at line ${issue.lineNumber}: ${issue.message}`,
        buildEventValidationPath(eventGroupKey, eventIndex, scriptField.key)
      )
    }

    for (const issue of validateStoryScriptInvokeReferences(scriptField.value, invokeTargets)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.${scriptField.key === "init_script" ? "init" : "end"}-script-invoke-invalid`,
        `${label} "${event.id}" ${scriptField.key} invoke_once 引用无效，第 ${issue.lineNumber} 行: ${issue.message}`,
        buildEventValidationPath(eventGroupKey, eventIndex, scriptField.key)
      )
    }
  }

  for (const [objectIndex, objectKey] of event.object_keys.entries()) {
    if (!findStoryRoleReference(document.roles, objectKey)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.missing-object`,
        `${label} "${event.id}" references missing object "${objectKey}".`,
        buildEventValidationPath(eventGroupKey, eventIndex, "object_keys", String(objectIndex))
      )
    }
  }

  if (event.location && !locationNames.has(event.location)) {
    pushIssue(
      issues,
      "error",
      `${codePrefix}.missing-location`,
      `${label} "${event.id}" references missing location "${event.location}".`,
      buildEventValidationPath(eventGroupKey, eventIndex, "location")
    )
  }

  const dialogues = getPresentationDialogues(event.presentation)
  for (const [dialogueIndex, dialogue] of dialogues.entries()) {
    if (dialogue.speaker_type === "player") {
      if (dialogue.speaker_key !== "player") {
        pushIssue(
          issues,
          "error",
          `${codePrefix}.invalid-player-speaker`,
          `${label} "${event.id}" player dialogue must use speaker_key "player".`,
          buildEventValidationPath(
            eventGroupKey,
            eventIndex,
            "presentation",
            "dialogues",
            String(dialogueIndex),
            "speaker_key"
          )
        )
      }
      continue
    }

    if (!allowedSpeakerKeys.has(dialogue.speaker_key)) {
      pushIssue(
        issues,
        "error",
        `${codePrefix}.invalid-object-speaker`,
        `${label} "${event.id}" dialogue speaker "${dialogue.speaker_key}" is not in the current event objects.`,
        buildEventValidationPath(
          eventGroupKey,
          eventIndex,
          "presentation",
          "dialogues",
          String(dialogueIndex),
          "speaker_key"
        )
      )
    }
  }

  validatePresentationTemplates(
    issues,
    eventGroupKey,
    eventIndex,
    `${label} "${event.id}"`,
    event.presentation
  )
}

function validateDoingPredicateField(
  source: string,
  basePath: string[],
  code: string,
  label: string,
  scriptVals: StoryValsFile,
  readableContext: StoryScriptExecutionContext,
  issues: ValidationIssue[]
) {
  if (!source.trim()) {
    return
  }

  try {
    evaluateStoryBooleanExpression(
      scriptVals,
      source,
      undefined,
      readableContext
    )
  } catch (error) {
    pushIssue(
      issues,
      "error",
      code,
      `${label} is invalid: ${error instanceof Error ? error.message : "Validation failed."}`,
      basePath
    )
  }
}

function validateDoingConfig(document: StoryDocument, issues: ValidationIssue[]) {
  const scriptVals = buildCombinedStoryScriptVals(document)
  const readableContext = buildValidationReadableContext(document)
  const menuIds = new Set(document.doing.menus.map((menu) => menu.id))

  for (const [menuIndex, menu] of document.doing.menus.entries()) {
    const basePath = ["doing", "menus", String(menuIndex)]

    if (menu.parent_id && !menuIds.has(menu.parent_id)) {
      pushIssue(
        issues,
        "error",
        "doing.menu.missing-parent",
        `Doing menu "${menu.id}" references missing parent menu "${menu.parent_id}".`,
        [...basePath, "parent_id"]
      )
    }

    if (menu.parent_id === menu.id) {
      pushIssue(
        issues,
        "error",
        "doing.menu.self-parent",
        `Doing menu "${menu.id}" cannot use itself as parent.`,
        [...basePath, "parent_id"]
      )
    }

    validateDoingPredicateField(
      menu.visible_expr,
      [...basePath, "visible_expr"],
      "doing.menu.visible-expr-invalid",
      `Doing menu "${menu.id}" visible_expr`,
      scriptVals,
      readableContext,
      issues
    )
  }

  for (const [doingIndex, doing] of document.doing.doings.entries()) {
    const basePath = ["doing", "doings", String(doingIndex)]

    if (!menuIds.has(doing.menu_id)) {
      pushIssue(
        issues,
        "error",
        "doing.missing-menu",
        `Doing "${doing.id}" references missing menu "${doing.menu_id}".`,
        [...basePath, "menu_id"]
      )
    }

    validateDoingPredicateField(
      doing.visible_expr,
      [...basePath, "visible_expr"],
      "doing.visible-expr-invalid",
      `Doing "${doing.id}" visible_expr`,
      scriptVals,
      readableContext,
      issues
    )

    validatePlayableEvent(
      {
        ...doing,
        trigger_mode: "default",
        trigger_expr: "",
        invoke_params: []
      },
      doingIndex,
      "doing",
      document,
      issues
    )
  }
}

function validatePoolEvent(
  event: StoryPoolEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "poolEvents", document, issues)
}

function validateScheduleEvent(
  event: StoryScheduleEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "scheduleEvents", document, issues)

  const schedulePath = ["scheduleEvents", String(eventIndex), "loop"] as const

  if (event.loop.mode === "weekly" && !event.loop.weekday) {
    pushIssue(
      issues,
      "error",
      "schedule.weekday-missing",
      `Schedule event "${event.id}" requires weekday when mode is weekly.`,
      [...schedulePath, "weekday"]
    )
  }

  if (event.loop.mode === "monthly" && !event.loop.month_day) {
    pushIssue(
      issues,
      "error",
      "schedule.month-day-missing",
      `Schedule event "${event.id}" requires month_day when mode is monthly.`,
      [...schedulePath, "month_day"]
    )
  }

  if (event.loop.mode === "interval_days" && !event.loop.interval_days) {
    pushIssue(
      issues,
      "error",
      "schedule.interval-missing",
      `Schedule event "${event.id}" requires interval_days when mode is interval_days.`,
      [...schedulePath, "interval_days"]
    )
  }

  if (event.loop.at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.loop.at)) {
    pushIssue(
      issues,
      "error",
      "schedule.at-invalid",
      `Schedule event "${event.id}" has invalid loop.at. Expected HH:mm, for example 00:00.`,
      [...schedulePath, "at"]
    )
  }

  if (
    event.loop.priority !== undefined
    && (!Number.isFinite(event.loop.priority) || !Number.isInteger(event.loop.priority))
  ) {
    pushIssue(
      issues,
      "error",
      "schedule.priority-invalid",
      `Schedule event "${event.id}" loop.priority must be an integer.`,
      [...schedulePath, "priority"]
    )
  }

  const scheduleEventIds = new Set(document.scheduleEvents.map((scheduleEvent) => scheduleEvent.id))
  for (const [field, dependencies] of [
    ["after", event.loop.after ?? []],
    ["before", event.loop.before ?? []]
  ] as const) {
    dependencies.forEach((dependencyId, dependencyIndex) => {
      if (dependencyId === event.id) {
        pushIssue(
          issues,
          "error",
          "schedule.dependency-self",
          `Schedule event "${event.id}" cannot depend on itself in loop.${field}.`,
          [...schedulePath, field, String(dependencyIndex)]
        )
        return
      }

      if (!scheduleEventIds.has(dependencyId)) {
        pushIssue(
          issues,
          "error",
          "schedule.dependency-missing",
          `Schedule event "${event.id}" references missing schedule event "${dependencyId}" in loop.${field}.`,
          [...schedulePath, field, String(dependencyIndex)]
        )
      }
    })
  }
}

function validateChainEvent(
  event: StoryEventFile,
  eventIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[]
) {
  validatePlayableEvent(event, eventIndex, "chainEvents", document, issues)
}

function validateChainAction(
  action: StoryActionFile,
  actionIndex: number,
  document: StoryDocument,
  issues: ValidationIssue[],
  chainEvents: StoryEventFile[],
  chainActions: StoryActionFile[]
) {
  const incomingChainEvents = chainEvents.filter((event) => event.next.includes(action.id))
  const incomingChainActions = chainActions.filter((event) => event.next.includes(action.id))
  const chainEventIds = new Set(chainEvents.map((event) => event.id))
  const chainActionIds = new Set(chainActions.map((event) => event.id))
  const invokeTargets = buildStoryInvokeValidationTargets(document)

  if (incomingChainEvents.length > 1) {
      pushIssue(
        issues,
        "error",
        "chain-action.multiple-parents",
        `Chain action "${action.id}" can only have one parent event.`,
        ["chainEvents", String(actionIndex), "id"]
      )
  }

  if (incomingChainActions.length > 0) {
      pushIssue(
        issues,
        "error",
        "chain-action.invalid-parent",
        `Chain action "${action.id}" cannot be linked from another action.`,
        ["chainEvents", String(actionIndex), "id"]
      )
  }

  if (action.next.length > 1) {
      pushIssue(
        issues,
        "error",
        "chain-action.multiple-next",
        `Chain action "${action.id}" can only point to one next event.`,
        ["chainEvents", String(actionIndex), "next"]
      )
  }

  for (const [nextIndex, nextId] of action.next.entries()) {
    if (chainActionIds.has(nextId)) {
        pushIssue(
          issues,
          "error",
          "chain-action.invalid-next-target",
          `Chain action "${action.id}" cannot point to another action "${nextId}".`,
          ["chainEvents", String(actionIndex), "next", String(nextIndex)]
        )
    }

    if (!chainEventIds.has(nextId) && !chainActionIds.has(nextId)) {
      continue
    }
  }

  for (const [varIndex, actionVar] of action.vars.entries()) {
    if (
      action.vars.findIndex((currentVar) => currentVar.name.trim() === actionVar.name.trim()) !== varIndex
    ) {
      pushIssue(
        issues,
        "error",
        "chain-action.duplicate-var",
        `Chain action "${action.id}" has duplicate variable "${actionVar.name}".`,
        ["chainEvents", String(actionIndex), "vars", String(varIndex), "name"]
      )
    }
  }

  for (const issue of validateStoryScript(
    buildCombinedStoryScriptVals(document),
    action.exec_script,
    undefined,
    buildChainActionScriptContext(document, action)
  )) {
    pushIssue(
      issues,
      "error",
      "chain-action.exec-script-invalid",
      `Chain action "${action.id}" exec_script is invalid at line ${issue.lineNumber}: ${issue.message}`,
      ["chainEvents", String(actionIndex), "exec_script"]
    )
  }

  for (const issue of validateStoryScriptInvokeReferences(action.exec_script, invokeTargets)) {
    pushIssue(
      issues,
      "error",
      "chain-action.exec-script-invoke-invalid",
      `Chain action "${action.id}" exec_script invoke_once 引用无效，第 ${issue.lineNumber} 行: ${issue.message}`,
      ["chainEvents", String(actionIndex), "exec_script"]
    )
  }
}

export function validateStoryDocument(document: StoryDocument): ValidationResult {
  const issues: ValidationIssue[] = []
  const chainNodes = document.chainEvents
  const chainEvents = chainNodes.filter(isChainEventNode)
  const chainActions = chainNodes.filter(isChainActionNode)
  const poolEvents = document.poolEvents
  const scheduleEvents = document.scheduleEvents
  const chainNodeMap = new Map(chainNodes.map((event) => [event.id, event]))

  if (chainEvents.length === 0) {
    pushIssue(
      issues,
      "warning",
      "story.no-events",
      "The story does not contain any events yet.",
      ["chainEvents"]
    )
  }

  const eventGroups = [
    { key: "chainEvents", events: chainNodes },
    { key: "poolEvents", events: poolEvents },
    { key: "scheduleEvents", events: scheduleEvents }
  ] as const satisfies Array<{
    key: EventValidationGroupKey
    events: StoryAnyEventFile[]
  }>

  for (const group of eventGroups) {
    const seenGroupIds = new Set<string>()

    for (const [eventIndex, event] of group.events.entries()) {
      if (seenGroupIds.has(event.id)) {
        pushIssue(
          issues,
          "error",
          "event.duplicate-id",
          `Duplicate ${group.key} id "${event.id}" detected.`,
          [group.key, String(eventIndex), "id"]
        )
        continue
      }

      seenGroupIds.add(event.id)

      if ("next" in event) {
        for (const [nextIndex, nextId] of event.next.entries()) {
          if (!chainNodeMap.has(nextId)) {
            pushIssue(
              issues,
              "error",
              "event.missing-link",
              `Chain node "${event.id}" points to missing chain node "${nextId}".`,
              [group.key, String(eventIndex), "next", String(nextIndex)]
            )
          }
        }
      }

      if (group.key === "poolEvents") {
        validatePoolEvent(event as StoryPoolEventFile, eventIndex, document, issues)
      }

      if (group.key === "scheduleEvents") {
        validateScheduleEvent(event as StoryScheduleEventFile, eventIndex, document, issues)
      }

      if (group.key === "chainEvents" && isChainEventNode(event as StoryChainNodeFile)) {
        validateChainEvent(event as StoryEventFile, eventIndex, document, issues)
      }

      if (group.key === "chainEvents" && isChainActionNode(event as StoryChainNodeFile)) {
        validateChainAction(
          event as StoryActionFile,
          eventIndex,
          document,
          issues,
          chainEvents,
          chainActions
        )
      }
    }
  }

  const itemIds = new Set(document.items.items.map((item) => item.id.trim()).filter(Boolean))
  for (const [ownerId, bag] of Object.entries(document.initialBags)) {
    for (const [entryIndex, entry] of bag.entries.entries()) {
      const normalizedItemId = entry.item_id.trim()
      if (!itemIds.has(normalizedItemId)) {
        pushIssue(
          issues,
          "error",
          "initial-bag.missing-item",
          `Initial bag "${ownerId}" references missing item "${normalizedItemId}".`,
          ["initialBags", ownerId, "entries", String(entryIndex), "item_id"]
        )
      }
    }
  }

  validatePhoneConfig(document, issues)
  validatePhoneConversationsConfig(document, issues)
  validateDoingConfig(document, issues)
  validateShopConfig(document, issues)

  for (const calcIssue of validateStoryValsCalcRules(document.vals)) {
    pushIssue(
      issues,
      "error",
      "vals.calc-rule-invalid",
      `Variable "${calcIssue.groupName}" / "${calcIssue.rowName}" calc_rule is invalid: ${calcIssue.message}`,
      ["vals", String(calcIssue.groupIndex), String(calcIssue.rowIndex), "calc_rule"]
    )
  }

  for (const calcIssue of validateStoryValsCalcRules(document.systemVals)) {
    pushIssue(
      issues,
      "error",
      "system-vals.calc-rule-invalid",
      `System variable "${calcIssue.groupName}" / "${calcIssue.rowName}" calc_rule is invalid: ${calcIssue.message}`,
      ["systemVals", String(calcIssue.groupIndex), String(calcIssue.rowIndex), "calc_rule"]
    )
  }

  const availableGlobalValKeys = collectGlobalValKeys(document)
  const seenPlayerOverrideKeys = new Set<string>()

  for (const [entryIndex, entry] of document.playerOverrideVals.entries.entries()) {
    const normalizedVarKey = entry.var_key.trim()

    if (!availableGlobalValKeys.has(normalizedVarKey)) {
      pushIssue(
        issues,
        "error",
        "player-override.missing-global-var",
        `Player override variable "${normalizedVarKey}" does not exist in global vals.`,
        ["playerOverrideVals", "entries", String(entryIndex), "var_key"]
      )
    }

    if (seenPlayerOverrideKeys.has(normalizedVarKey)) {
      pushIssue(
        issues,
        "warning",
        "player-override.duplicate-var",
        `Player override variable "${normalizedVarKey}" appears more than once.`,
        ["playerOverrideVals", "entries", String(entryIndex), "var_key"]
      )
    } else {
      seenPlayerOverrideKeys.add(normalizedVarKey)
    }

    if (!Number.isInteger(entry.group_no) || entry.group_no < 1) {
      pushIssue(
        issues,
        "error",
        "player-override.invalid-group-no",
        `Player override variable "${normalizedVarKey}" has invalid group_no "${entry.group_no}".`,
        ["playerOverrideVals", "entries", String(entryIndex), "group_no"]
      )
    }

    if (entry.input_type === "select") {
      const seenOptionValues = new Set<string>()
      const usableOptions = entry.input_options.filter((option) => option.value.trim())

      if (usableOptions.length === 0) {
        pushIssue(
          issues,
          "error",
          "player-override.empty-select-options",
          `Player override variable "${normalizedVarKey}" uses select input but has no selectable options.`,
          ["playerOverrideVals", "entries", String(entryIndex), "input_options"]
        )
      }

      for (const [optionIndex, option] of entry.input_options.entries()) {
        const normalizedOptionValue = option.value.trim()

        if (!normalizedOptionValue) {
          pushIssue(
            issues,
            "error",
            "player-override.empty-select-option-value",
            `Player override variable "${normalizedVarKey}" has an empty select option value.`,
            ["playerOverrideVals", "entries", String(entryIndex), "input_options", String(optionIndex), "value"]
          )
          continue
        }

        if (seenOptionValues.has(normalizedOptionValue)) {
          pushIssue(
            issues,
            "error",
            "player-override.duplicate-select-option-value",
            `Player override variable "${normalizedVarKey}" has duplicated select option value "${normalizedOptionValue}".`,
            ["playerOverrideVals", "entries", String(entryIndex), "input_options", String(optionIndex), "value"]
          )
        } else {
          seenOptionValues.add(normalizedOptionValue)
        }
      }
    }
  }

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues
  }
}
