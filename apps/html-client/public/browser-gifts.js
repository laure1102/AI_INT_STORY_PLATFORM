/**
 * 背包赠礼界面：负责两个入口的临时选择、HTML 渲染和事件绑定。
 */
import {
  dom,
  getActivePhoneConversation,
  h,
  ui
} from "./browser-state.js"

/** @returns 玩家背包；没有玩家背包时返回空结构。 */
function getPlayerBag() {
  return (ui.data?.view?.bagSummary ?? []).find((bag) => bag.ownerId === "player") ?? {
    ownerId: "player",
    itemCount: 0,
    totalQuantity: 0,
    entries: []
  }
}

/** @param value 好感变化。 @returns 带正负号的展示文本。 */
function formatFavorDelta(value) {
  const delta = Number(value) || 0
  return `${delta >= 0 ? "+" : ""}${delta}`
}

/** @param contact 联系人视图。 @returns 当前入口下不可赠原因；可赠时为 null。 */
function getContactGiftDisabledReason(contact) {
  if (!contact?.canContact) {
    return contact?.lockMessage ?? "当前无法联系该好友。"
  }

  const conversation = getActivePhoneConversation()
  if (conversation?.roleKey === contact.roleKey && conversation.lockNormalChat) {
    return "该好友正在进行剧情手机对话，暂时不能赠礼。"
  }

  return null
}

/** @param itemId 物品 id。 @returns 已存在或新建的背包赠礼草稿。 */
function getBagGiftDraft(itemId) {
  if (!ui.bagGiftDrafts[itemId]) {
    ui.bagGiftDrafts[itemId] = {
      roleKey: "",
      search: "",
      quantity: 1
    }
  }
  return ui.bagGiftDrafts[itemId]
}

/** @param roleKey 当前好友。 @returns 已存在或新建的手机赠礼草稿。 */
function getPhoneGiftDraft(roleKey) {
  if (!ui.phoneGiftDrafts[roleKey]) {
    ui.phoneGiftDrafts[roleKey] = {
      itemId: "",
      search: "",
      quantity: 1
    }
  }
  return ui.phoneGiftDrafts[roleKey]
}

/** @param itemId 背包物品 id。 @param draft 赠礼草稿。 @returns 搜索联系人控件。 */
function renderBagContactPicker(itemId, draft) {
  const contacts = Array.isArray(ui.data?.phoneContacts) ? ui.data.phoneContacts : []
  const selectedContact = contacts.find((contact) => contact.roleKey === draft.roleKey) ?? null
  const query = selectedContact?.label ?? draft.search
  const normalizedQuery = String(query).trim().toLocaleLowerCase("zh-Hans-CN")
  let visibleCount = 0

  const options = contacts.map((contact) => {
    const disabledReason = getContactGiftDisabledReason(contact)
    const searchText = `${contact.label ?? ""} ${contact.roleKey ?? ""} ${contact.relationStageLabel ?? ""}`
    const hidden = normalizedQuery
      ? !searchText.toLocaleLowerCase("zh-Hans-CN").includes(normalizedQuery)
      : false
    if (!hidden) {
      visibleCount += 1
    }

    return `
      <button
        class="gift-option ${contact.roleKey === draft.roleKey ? "selected" : ""}"
        type="button"
        role="option"
        ${disabledReason ? "disabled" : ""}
        ${hidden ? "hidden" : ""}
        data-bag-gift-target="${h(itemId)}"
        data-bag-gift-role="${h(contact.roleKey)}"
        data-bag-gift-label="${h(contact.label ?? contact.roleKey)}"
        data-gift-search-text="${h(searchText)}"
      >
        <span class="item-title">${h(contact.label ?? contact.roleKey)}</span>
        <span class="item-meta">${h(contact.relationStageLabel ?? "好友")} · 好感 ${h(contact.favor ?? 0)}/100${disabledReason ? ` · ${h(disabledReason)}` : ""}</span>
      </button>
    `
  }).join("")

  return `
    <div class="gift-field">
      <label>赠送给</label>
      <div class="gift-combobox" data-gift-picker>
        <input
          type="search"
          value="${h(query)}"
          placeholder="选择或搜索好友"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          data-bag-gift-search="${h(itemId)}"
        >
        <div class="gift-options" role="listbox">
          ${options}
          <div class="gift-empty" ${visibleCount > 0 ? "hidden" : ""} data-gift-empty>没有匹配的好友</div>
        </div>
      </div>
    </div>
  `
}

/** @param item 背包物品视图。 @returns 玩家物品的展开赠礼表单。 */
function renderBagGiftForm(item) {
  const draft = getBagGiftDraft(item.itemId)
  const contacts = Array.isArray(ui.data?.phoneContacts) ? ui.data.phoneContacts : []
  const selectedContact = contacts.find((contact) => contact.roleKey === draft.roleKey) ?? null
  const selectedContactDisabledReason = selectedContact
    ? getContactGiftDisabledReason(selectedContact)
    : "请选择好友。"

  return `
    <div class="bag-gift-form" data-bag-gift-form="${h(item.itemId)}">
      ${renderBagContactPicker(item.itemId, draft)}
      <label class="gift-quantity">
        <span>数量</span>
        <input
          type="number"
          min="1"
          max="${h(item.quantity)}"
          step="1"
          value="${h(draft.quantity)}"
          data-bag-gift-quantity="${h(item.itemId)}"
        >
      </label>
      <button
        class="footer-command"
        type="button"
        ${selectedContactDisabledReason ? "disabled" : ""}
        data-bag-gift-confirm="${h(item.itemId)}"
      >确定</button>
    </div>
  `
}

/** @param bag 背包 owner 视图。 @returns owner 标题与结构化物品卡片。 */
function renderBagOwner(bag) {
  const canGift = bag.ownerId === "player"
  return `
    <section class="bag-owner">
      <div class="bag-owner-header">
        <strong>${h(bag.ownerId === "player" ? "玩家背包" : bag.ownerId)}</strong>
        <span class="item-meta">${h(bag.itemCount)} 类 · ${h(bag.totalQuantity)} 件</span>
      </div>
      <div class="bag-items">
        ${bag.entries.length === 0 ? `<div class="empty">背包为空。</div>` : bag.entries.map((item) => {
          const giftOpen = canGift && item.giftable && ui.bagGiftOpenItemId === item.itemId
          const giftMeta = item.giftable
            ? `单件好感 ${formatFavorDelta(item.giftFavorDelta)}${item.giftCooldownHours > 0 ? ` · 冷却 ${item.giftCooldownHours} 小时` : ""}`
            : item.giftDisabledReason ?? "该物品不可赠送。"

          return `
            <article class="bag-item-card ${item.giftable ? "" : "disabled"}">
              <div class="bag-item-main">
                <div>
                  <div class="item-title">${h(item.itemName ?? item.itemId)} <span class="bag-quantity">x${h(item.quantity)}</span></div>
                  <div class="item-meta">${h(item.itemId)}${item.bound ? " · 已绑定" : ""}</div>
                  ${canGift ? `<div class="item-meta">${h(giftMeta)}</div>` : ""}
                </div>
                ${canGift ? `
                  <button
                    class="footer-command ${giftOpen ? "active" : ""}"
                    type="button"
                    ${item.giftable ? "" : "disabled"}
                    title="${h(giftMeta)}"
                    aria-expanded="${giftOpen ? "true" : "false"}"
                    data-bag-gift-toggle="${h(item.itemId)}"
                  >赠礼</button>
                ` : ""}
              </div>
              ${giftOpen ? renderBagGiftForm(item) : ""}
            </article>
          `
        }).join("")}
      </div>
    </section>
  `
}

/** @returns 所有 owner 的结构化背包面板；只有玩家背包提供赠礼操作。 */
export function renderBagGiftPanel() {
  const bags = Array.isArray(ui.data?.view?.bagSummary) ? ui.data.view.bagSummary : []
  if (bags.length === 0) {
    return `<div class="empty">暂无背包。</div>`
  }

  return `<div class="bag-list">${bags.map(renderBagOwner).join("")}</div>`
}

/** @param roleKey 当前好友。 @param item 背包物品。 @returns 手机赠礼的已选物品表单。 */
function renderPhoneGiftSelection(roleKey, item) {
  const draft = getPhoneGiftDraft(roleKey)
  return `
    <div class="phone-gift-selection" data-phone-gift-selection>
      <div>
        <div class="item-title">${h(item.itemName ?? item.itemId)} · x${h(item.quantity)}</div>
        <div class="item-meta">单件好感 ${h(formatFavorDelta(item.giftFavorDelta))}${item.giftCooldownHours > 0 ? ` · 冷却 ${h(item.giftCooldownHours)} 小时` : ""}</div>
      </div>
      <label class="gift-quantity">
        <span>数量</span>
        <input
          type="number"
          min="1"
          max="${h(item.quantity)}"
          step="1"
          value="${h(draft.quantity)}"
          data-phone-gift-quantity="${h(roleKey)}"
        >
      </label>
      <button
        class="footer-command"
        type="button"
        data-phone-gift-confirm="${h(roleKey)}"
      >确定</button>
    </div>
  `
}

/** @param contact 当前好友。 @returns 手机聊天区的背包物品搜索和确认界面。 */
export function renderPhoneGiftPanel(contact) {
  const roleKey = contact.roleKey
  const draft = getPhoneGiftDraft(roleKey)
  const bag = getPlayerBag()
  const items = Array.isArray(bag.entries) ? bag.entries : []
  const selectedItem = items.find((item) => item.itemId === draft.itemId) ?? null
  const query = selectedItem?.itemName ?? draft.search
  const normalizedQuery = String(query).trim().toLocaleLowerCase("zh-Hans-CN")
  const contactDisabledReason = getContactGiftDisabledReason(contact)
  let visibleCount = 0

  const options = items.map((item) => {
    const searchText = `${item.itemName ?? ""} ${item.itemId ?? ""}`
    const hidden = normalizedQuery
      ? !searchText.toLocaleLowerCase("zh-Hans-CN").includes(normalizedQuery)
      : false
    if (!hidden) {
      visibleCount += 1
    }
    const disabledReason = item.giftDisabledReason ?? (!item.giftable ? "该物品不可赠送。" : null)

    return `
      <button
        class="gift-option ${item.itemId === draft.itemId ? "selected" : ""}"
        type="button"
        role="option"
        ${disabledReason ? "disabled" : ""}
        ${hidden ? "hidden" : ""}
        data-phone-gift-item="${h(roleKey)}"
        data-phone-gift-item-id="${h(item.itemId)}"
        data-phone-gift-item-label="${h(item.itemName ?? item.itemId)}"
        data-gift-search-text="${h(searchText)}"
      >
        <span class="item-title">${h(item.itemName ?? item.itemId)} · x${h(item.quantity)}</span>
        <span class="item-meta">${h(disabledReason ?? `单件好感 ${formatFavorDelta(item.giftFavorDelta)}${item.giftCooldownHours > 0 ? ` · 冷却 ${item.giftCooldownHours} 小时` : ""}`)}</span>
      </button>
    `
  }).join("")

  return `
    <div class="phone-gift-panel" data-phone-options-scroll="${h(`${roleKey}:gift`)}">
      ${contactDisabledReason ? `<div class="gift-error">${h(contactDisabledReason)}</div>` : ""}
      <div class="gift-field">
        <label>背包物品</label>
        <div class="gift-combobox" data-gift-picker>
          <input
            type="search"
            value="${h(query)}"
            placeholder="搜索并选择物品"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            data-phone-gift-search="${h(roleKey)}"
          >
          <div class="gift-options" role="listbox">
            ${options}
            <div class="gift-empty" ${visibleCount > 0 ? "hidden" : ""} data-gift-empty>${items.length === 0 ? "背包为空" : "没有匹配的物品"}</div>
          </div>
        </div>
      </div>
      ${selectedItem && !contactDisabledReason ? renderPhoneGiftSelection(roleKey, selectedItem) : ""}
    </div>
  `
}

/** @param input 当前搜索框。 @returns 无返回值；仅过滤同一选择器内的选项。 */
function filterGiftOptions(input) {
  const picker = input.closest("[data-gift-picker]")
  if (!picker) {
    return
  }

  const query = input.value.trim().toLocaleLowerCase("zh-Hans-CN")
  let visibleCount = 0
  picker.querySelectorAll("[data-gift-search-text]").forEach((option) => {
    const hidden = query
      ? !String(option.dataset.giftSearchText ?? "").toLocaleLowerCase("zh-Hans-CN").includes(query)
      : false
    option.hidden = hidden
    if (!hidden) {
      visibleCount += 1
    }
  })

  const empty = picker.querySelector("[data-gift-empty]")
  if (empty) {
    empty.hidden = visibleCount > 0
  }
}

/** @param result 动作 API 响应。 @returns 最后一个运行时通知文本。 */
function getLastRuntimeNotification(result) {
  const notifications = result?.notifications
  return Array.isArray(notifications) ? notifications.at(-1) : null
}

/**
 * 为当前渲染结果绑定背包和手机赠礼事件。
 * @param callbacks dispatchRuntimeAction、render 和 showToast 回调。 @returns 无返回值。
 */
export function bindGiftEvents(callbacks) {
  const { dispatchRuntimeAction, render, showToast } = callbacks

  dom.app.querySelectorAll("[data-bag-gift-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.bagGiftToggle
      const opening = ui.bagGiftOpenItemId !== itemId
      ui.bagGiftOpenItemId = opening ? itemId : null
      if (opening) {
        ui.bagGiftDrafts[itemId] = { roleKey: "", search: "", quantity: 1 }
      }
      render()
      if (opening) {
        dom.app.querySelector(`[data-bag-gift-search="${CSS.escape(itemId)}"]`)?.focus()
      }
    })
  })

  dom.app.querySelectorAll("[data-bag-gift-search]").forEach((input) => {
    input.addEventListener("input", () => {
      const itemId = input.dataset.bagGiftSearch
      const draft = getBagGiftDraft(itemId)
      draft.search = input.value
      draft.roleKey = ""
      input.closest("[data-bag-gift-form]")?.querySelector("[data-bag-gift-confirm]")?.setAttribute("disabled", "")
      filterGiftOptions(input)
    })
  })

  dom.app.querySelectorAll("[data-bag-gift-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.bagGiftTarget
      const draft = getBagGiftDraft(itemId)
      draft.roleKey = button.dataset.bagGiftRole
      draft.search = button.dataset.bagGiftLabel
      render()
    })
  })

  dom.app.querySelectorAll("[data-bag-gift-quantity]").forEach((input) => {
    input.addEventListener("input", () => {
      getBagGiftDraft(input.dataset.bagGiftQuantity).quantity = Number(input.value)
    })
  })

  dom.app.querySelectorAll("[data-bag-gift-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.dataset.bagGiftConfirm
      const draft = getBagGiftDraft(itemId)
      const result = await dispatchRuntimeAction({
        type: "bag-gift",
        itemId,
        roleKey: draft.roleKey,
        quantity: Number(draft.quantity)
      })
      if (result?.actionSucceeded === false) {
        showToast(getLastRuntimeNotification(result) ?? "赠礼失败。", "error")
        return
      }
      delete ui.bagGiftDrafts[itemId]
      ui.bagGiftOpenItemId = null
      showToast(getLastRuntimeNotification(result) ?? "赠礼成功。")
      render()
    })
  })

  dom.app.querySelectorAll("[data-phone-gift-search]").forEach((input) => {
    input.addEventListener("input", () => {
      const roleKey = input.dataset.phoneGiftSearch
      const draft = getPhoneGiftDraft(roleKey)
      draft.search = input.value
      draft.itemId = ""
      input.closest(".phone-gift-panel")?.querySelector("[data-phone-gift-selection]")?.setAttribute("hidden", "")
      filterGiftOptions(input)
    })
  })

  dom.app.querySelectorAll("[data-phone-gift-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const roleKey = button.dataset.phoneGiftItem
      ui.phoneGiftDrafts[roleKey] = {
        itemId: button.dataset.phoneGiftItemId,
        search: button.dataset.phoneGiftItemLabel,
        quantity: 1
      }
      render()
    })
  })

  dom.app.querySelectorAll("[data-phone-gift-quantity]").forEach((input) => {
    input.addEventListener("input", () => {
      getPhoneGiftDraft(input.dataset.phoneGiftQuantity).quantity = Number(input.value)
    })
  })

  dom.app.querySelectorAll("[data-phone-gift-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const roleKey = button.dataset.phoneGiftConfirm
      const draft = getPhoneGiftDraft(roleKey)
      const result = await dispatchRuntimeAction({
        type: "bag-gift",
        itemId: draft.itemId,
        roleKey,
        quantity: Number(draft.quantity)
      })
      if (result?.actionSucceeded === false) {
        showToast(getLastRuntimeNotification(result) ?? "赠礼失败。", "error")
        return
      }
      delete ui.phoneGiftDrafts[roleKey]
      showToast(getLastRuntimeNotification(result) ?? "赠礼成功。")
      render()
    })
  })
}
