/**
 * 浏览器渲染器：把服务端返回的数据转换为 HTML 字符串。
 * 用户操作仍由 app.js 统一绑定，避免模板函数直接发起网络请求。
 */
import {
  getActiveContactConversation,
  getDoingView,
  getSelectedDoingMenu,
  getSelectedShopCategory,
  getShopView,
  h,
  route,
  ui
} from "./browser-state.js"
import { renderBagGiftPanel, renderContactGiftPanel } from "./browser-gifts.js"

/** @param profile 档案摘要。 @returns 地点、自定义变量数和创建时间组成的单行说明。 */
function profileMeta(profile) {
  return [
    profile.locationLabel,
    `${profile.customValueCount ?? 0} 个自定义变量`,
    profile.createdAt
  ].filter(Boolean).join(" · ")
}

/** @param customValues 建角表单值。 @returns 优先姓+名，再常见完整姓名变量的档案显示名。 */
function buildProfileNameFromCustomValues(customValues) {
  const surname = String(customValues["player.name_xing"] ?? "").trim()
  const givenName = String(customValues["player.name_ming"] ?? "").trim()
  const fullName = `${surname}${givenName}`.trim()

  if (fullName) {
    return fullName
  }

  const fallbackKeys = [
    "player.name",
    "system.player_name",
    "system.role_name",
    "system.player_display_name"
  ]

  for (const key of fallbackKeys) {
    const value = String(customValues[key] ?? "").trim()
    if (value) {
      return value
    }
  }

  return ""
}

/** @param prompt 建角字段。 @returns value 非空且 label 已补齐的下拉选项数组。 */
function normalizePromptOptions(prompt) {
  if (!Array.isArray(prompt?.options)) {
    return []
  }

  return prompt.options
    .map((option) => {
      const value = String(option?.value ?? "").trim()
      const label = String(option?.label ?? "").trim() || value
      return value ? { label, value } : null
    })
    .filter(Boolean)
}

/** @param prompt 建角字段定义。 @returns 对应 text 或 select 控件的安全 HTML 字符串。 */
function renderCreatePromptField(prompt) {
  const fieldId = `prompt-${prompt.varKey}`
  const label = `${prompt.label}${prompt.required ? " *" : ""}`
  const inputType = prompt.inputType === "select" ? "select" : "text"

  if (inputType === "select") {
    const options = normalizePromptOptions(prompt)
    const optionHtml = options.map((option) => `
      <option value="${h(option.value)}">${h(option.label)}</option>
    `).join("")

    return `
      <div class="field">
        <label for="${h(fieldId)}">${h(label)}</label>
        <select id="${h(fieldId)}" name="${h(prompt.varKey)}" ${prompt.required ? "required" : ""}>
          <option value="">${h(prompt.tips || "请选择")}</option>
          ${optionHtml}
        </select>
      </div>
    `
  }

  return `
    <div class="field">
      <label for="${h(fieldId)}">${h(label)}</label>
      <input id="${h(fieldId)}" name="${h(prompt.varKey)}" placeholder="${h(prompt.tips || prompt.varKey)}" ${prompt.required ? "required" : ""}>
    </div>
  `
}

/** @returns 当前故事标题、档案和启动阶段组成的顶部栏 HTML。 */
function topbar() {
  const data = ui.data
  const title = data?.storyTitle ?? "Story HTML Client"
  const profile = data?.profile?.profile_name ? `角色：${data.profile.profile_name}` : "未选择角色"
  const stage = data?.stage ? `阶段：${data.stage}` : "正在初始化"

  return `
    <header class="topbar">
      <div class="brand">
        <h1>${h(title)}</h1>
        <div class="subline">${h(profile)} · ${h(stage)}${ui.busy ? " · 正在处理..." : ""}</div>
      </div>
    </header>
  `
}

/** @returns 档案列表、同步按钮和动态建角表单组成的档案页 HTML。 */
export function renderProfiles() {
  const profiles = ui.data?.profiles ?? []
  const createFields = ui.prompts.map(renderCreatePromptField).join("")

  return `
    ${topbar()}
    <main class="content">
      <div class="setup-layout">
        <section class="panel">
          <div class="panel-header">
            <h2 class="panel-title">选择角色</h2>
            <button class="primary" data-action="toggle-create">${ui.createOpen ? "收起创建" : "创建角色"}</button>
          </div>
          <div class="panel-body">
            <div class="list">
              ${profiles.length === 0 ? `<div class="empty">还没有本地角色档。</div>` : profiles.map((profile) => `
                <button class="list-item" data-select-profile="${h(profile.profileId)}">
                  <span class="item-title">${h(profile.profileName)} (${h(profile.profileId)})</span>
                  <span class="item-meta">${h(profileMeta(profile))}</span>
                </button>
              `).join("")}
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <h2 class="panel-title">${ui.createOpen ? "创建新角色" : "角色信息"}</h2>
          </div>
          <div class="panel-body">
            ${ui.createOpen ? `
              <form id="create-profile-form" class="form-grid">
                ${createFields || `<div class="empty">当前故事没有需要玩家创建时填写的变量。</div>`}
                <div class="button-row">
                  <button class="primary" type="submit">保存角色</button>
                  <button type="button" data-action="toggle-create">取消</button>
                </div>
              </form>
            ` : `
              <p class="hint">选择一个角色档继续，或者创建新角色。HTML 客户端会使用独立的 <code>.html-client</code> 运行目录，不会和 TUI 存档混在一起。</p>
            `}
          </div>
        </section>
      </div>
    </main>
  `
}

/** @returns 当前档案的存档列表、新游戏和返回操作组成的存档页 HTML。 */
export function renderSaves() {
  const saveSlots = ui.data?.saveSlots ?? []
  const profile = ui.data?.profile

  return `
    ${topbar()}
    <main class="content">
      <div class="setup-layout">
        <section class="panel">
          <div class="panel-header">
            <h2 class="panel-title">当前角色</h2>
          </div>
          <div class="panel-body">
            <div class="list-item">
              <span class="item-title">${h(profile?.profile_name ?? "未选择")}</span>
              <span class="item-meta">${h(profile?.player_setup ? `${profile.player_setup.province_name}/${profile.player_setup.city_name}/${profile.player_setup.county_name}` : "无角色设定")}</span>
            </div>
            <div class="button-row" style="margin-top: 12px;">
              <button class="primary" data-action="new-game">开始新游戏</button>
              <button data-screen="profiles">更换角色</button>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <h2 class="panel-title">读取存档</h2>
            <button data-action="refresh-saves">刷新</button>
          </div>
          <div class="panel-body">
            <div class="list">
              ${saveSlots.length === 0 ? `<div class="empty">这个角色还没有存档。</div>` : saveSlots.map((slot) => `
                <button class="list-item" data-load-save="${h(slot.slotId)}">
                  <span class="item-title">${h(slot.slotId)}</span>
                  <span class="item-meta">${h(slot.savedAt)} · 当前事件 ${h(slot.activeEventId ?? "无")}</span>
                </button>
              `).join("")}
            </div>
          </div>
        </section>
      </div>
    </main>
  `
}

/** @param view Runtime 视图。 @returns 当前对白、消息或等待提示的剧情表现 HTML。 */
function renderDialogue(view) {
  if (view?.currentDialogue) {
    const dialogue = view.currentDialogue
    return `
      <section class="dialogue-card">
        <div class="speaker">${h(dialogue.speakerLabel || dialogue.speakerKey || "旁白")} <span class="item-meta">${dialogue.index}/${dialogue.total}</span></div>
        <div class="dialogue-text">${h(dialogue.content)}</div>
      </section>
    `
  }

  if (view?.currentMessage) {
    const message = view.currentMessage
    return `
      <section class="message-card">
        <div class="message-text">${h(message.content)}</div>
        <div class="item-meta">剩余 ${h(message.remainingSeconds)} 秒</div>
      </section>
    `
  }

  return `<section class="dialogue-card"><div class="dialogue-text">当前没有正在展示的对白或提示消息。</div></section>`
}

/** @param view Runtime 视图。 @returns 继续、选项、文本输入或无操作提示的交互卡片 HTML。 */
function renderInteraction(view) {
  const interaction = view?.interaction
  if (!interaction) {
    return `
      <section class="interaction-card">
        <p class="interaction-title">操作</p>
        <button class="primary" data-runtime-action='${h(JSON.stringify({ type: "continue" }))}'>继续</button>
      </section>
    `
  }

  if (interaction.kind === "select") {
    return `
      <section class="interaction-card">
        <p class="interaction-title">${h(interaction.prompt)}</p>
        <div class="action-grid">
          ${interaction.options.map((option, index) => `
            <button class="primary option-button" data-runtime-action='${h(JSON.stringify({ type: "select-option", optionId: option.id }))}'>
              ${index + 1}. ${h(option.label)}
              ${option.description ? `<span class="option-desc">${h(option.description)}</span>` : ""}
            </button>
          `).join("")}
        </div>
      </section>
    `
  }

  if (interaction.kind === "text-input") {
    return `
      <section class="interaction-card">
        <form id="text-interaction-form" class="form-grid">
          <div class="field">
            <label>${h(interaction.prompt)}</label>
            <input name="value" value="${h(interaction.initialValue ?? "")}" placeholder="${h(interaction.placeholder ?? "")}" autofocus>
          </div>
          <button class="primary" type="submit">提交</button>
        </form>
      </section>
    `
  }

  if (interaction.kind === "role-name-input") {
    return `
      <section class="interaction-card">
        <form id="role-name-interaction-form" class="form-grid">
          <p class="interaction-title">${h(interaction.prompt)}（${h(interaction.roleLabel)}）</p>
          <div class="field"><label>姓</label><input name="surname" required value="${h(interaction.initialSurname ?? "")}" autofocus></div>
          <div class="field"><label>名</label><input name="givenName" required value="${h(interaction.initialGivenName ?? "")}"></div>
          <button class="primary" type="submit">确认姓名</button>
        </form>
      </section>
    `
  }

  if (interaction.kind === "confirm") {
    return `
      <section class="interaction-card">
        <p class="interaction-title">${h(interaction.prompt)}</p>
        <div class="button-row">
          <button class="primary" data-runtime-action='${h(JSON.stringify({ type: "continue" }))}'>${h(interaction.confirmLabel ?? "继续")}</button>
        </div>
      </section>
    `
  }

  return ""
}

/** @param view Runtime 视图。 @returns 可用分支和分支上下文摘要 HTML；均为空时返回空串。 */
function renderContext(view) {
  const branches = view?.availableBranches ?? []
  const context = view?.branchContextSummary ?? []

  if (branches.length === 0 && context.length === 0) {
    return ""
  }

  return `
    <section class="context-card">
      ${branches.length > 0 ? `
        <p class="interaction-title">可用分支</p>
        <div class="list">
          ${branches.map((branch) => `
            <div class="list-item">
              <span class="item-title">${h(branch.title)}</span>
              <span class="item-meta">下一事件：${h(branch.nextEventId ?? "无")}</span>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${context.length > 0 ? `
        <p class="interaction-title">分支上下文</p>
        <pre class="pre-lines">${h(context.map((item) => `${item.key}: ${item.value}`).join("\n"))}</pre>
      ` : ""}
    </section>
  `
}

/**
 * 渲染工具菜单中指定面板的主体。
 * @param panelId 通知、变量、调度、背包、行动或商店。 @returns 面板专用 HTML。
 * 行动/商店同时维护当前选中菜单或分类，数据更新导致选择失效时自动回到第一项。
 */
function renderMenuPanelBody(panelId) {
  const data = ui.data
  let body = ""

  if (panelId === "notifications") {
    const history = Array.isArray(data?.view?.history) ? data.view.history : []
    const filters = [["all", "全部"], ["operation", "操作"], ["story", "剧情"], ["system", "系统"]]
    const filteredHistory = ui.historyFilter === "all" ? history : history.filter((item) => item.category === ui.historyFilter)
    const sortedHistory = filteredHistory
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const minuteDiff = (Number(right.item.game_minute) || 0) - (Number(left.item.game_minute) || 0)
        if (minuteDiff !== 0) return minuteDiff
        const timestampDiff = String(right.item.timestamp ?? "").localeCompare(String(left.item.timestamp ?? ""))
        return timestampDiff !== 0 ? timestampDiff : right.index - left.index
      })
      .map(({ item }) => item)
    body = `<div class="history-filters">${filters.map(([id, label]) => `<button class="footer-command ${ui.historyFilter === id ? "active" : ""}" data-history-filter="${id}">${label}</button>`).join("")}</div>
      ${sortedHistory.length === 0 ? `<div class="empty">暂无历史记录。</div>` : `<div class="notification-list">${sortedHistory.map((item) => `<div class="notification-item"><div class="item-meta">${h(formatHistoryMinute(item.game_minute))} · ${h(formatHistoryCategory(item.category))} · ${h(item.title ?? "")}</div>${item.content ? `<div>${h(item.content)}</div>` : ""}</div>`).join("")}</div>`}`
  } else if (panelId === "global") {
    body = `<pre class="pre-lines">${h((data?.globalValueLines ?? []).join("\n"))}</pre>`
  } else if (panelId === "system") {
    body = `<pre class="pre-lines">${h((data?.systemValueLines ?? []).join("\n"))}</pre>`
  } else if (panelId === "scheduler") {
    body = `<pre class="pre-lines">${h((data?.schedulerLines ?? []).join("\n"))}</pre>`
  } else if (panelId === "bag") {
    body = renderBagGiftPanel()
  } else if (panelId === "doing") {
    const doing = getDoingView()
    const menus = Array.isArray(doing?.menus) ? doing.menus : []
    const items = Array.isArray(doing?.doings) ? doing.doings : []
    const selectedMenuId = getSelectedDoingMenu(menus)
    const selectedItems = selectedMenuId
      ? items.filter((item) => item.menuId === selectedMenuId)
      : []
    body = `
      <div class="doing-panel">
        <div class="doing-menu-tree">
          ${menus.length === 0 ? `<div class="empty">暂无行动菜单。</div>` : menus.map((menu) => `
            <button class="list-item ${menu.id === selectedMenuId ? "active" : ""}" data-doing-menu="${h(menu.id)}">
              <span class="item-title">${h(menu.title ?? menu.id)}</span>
              <span class="item-meta">${h(menu.descr ?? "")}</span>
            </button>
          `).join("")}
        </div>
        <div class="doing-list">
          ${menus.length === 0 ? `<div class="empty">暂无可执行行动。请先在故事编辑器中配置 doing.json5。</div>` : ""}
          ${menus.length > 0 && selectedItems.length === 0 ? `<div class="empty">当前菜单下暂无行动。</div>` : ""}
          ${selectedItems.map((item) => `
            <button class="option-button ${item.disabled ? "disabled" : ""}" ${item.disabled ? "disabled" : ""} data-doing-action="${h(item.id)}">
              ${h(item.title ?? item.id)}
              <span class="item-meta">${h([
                item.descr,
                item.once ? "一次性" : "",
                item.cooldownHours > 0 ? `冷却 ${item.cooldownHours} 小时` : "",
                item.usedCount > 0 ? `已执行 ${item.usedCount} 次` : "",
                item.disabledReason
              ].filter(Boolean).join(" · "))}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `
  } else if (panelId === "shop") {
    const shop = getShopView()
    const categories = Array.isArray(shop?.categories) ? shop.categories : []
    const products = Array.isArray(shop?.products) ? shop.products : []
    const selectedCategoryId = getSelectedShopCategory(categories)
    const selectedProducts = selectedCategoryId
      ? products.filter((product) => product.categoryId === selectedCategoryId)
      : []
    const contacts = Array.isArray(ui.data?.contacts) ? ui.data.contacts : []

    body = `
      <div class="shop-panel">
        <div class="shop-category-list">
          ${categories.length === 0 ? `<div class="empty">暂无商城分类。</div>` : categories.map((category) => `
            <button class="list-item ${category.id === selectedCategoryId ? "active" : ""}" data-shop-category="${h(category.id)}">
              <span class="item-title">${h(category.name ?? category.id)}</span>
              <span class="item-meta">${h(category.descr ?? "")}</span>
            </button>
          `).join("")}
        </div>
        <div class="shop-product-list">
          <div class="shop-currency">扣款变量：${h(shop.currencyValueKey ?? "player.money")}</div>
          ${categories.length === 0 ? `<div class="empty">请先在故事编辑器配置 shop.json5。</div>` : ""}
          ${categories.length > 0 && selectedProducts.length === 0 ? `<div class="empty">当前分类下暂无商品。</div>` : ""}
          ${selectedProducts.map((product) => {
            const buyMeta = [
              `价格 ${product.price}`,
              `数量 x${product.quantity}`,
              product.ownedQuantity > 0 ? `背包 ${product.ownedQuantity}` : "",
              product.purchaseCooldownHours > 0 ? `购买冷却 ${product.purchaseCooldownHours}小时` : "",
              product.disabledReason
            ].filter(Boolean).join(" · ")
            const giftMeta = [
              product.allowGift ? "可送礼" : "不可送礼",
              product.giftCooldownHours > 0 ? `送礼冷却 ${product.giftCooldownHours}小时` : ""
            ].filter(Boolean).join(" · ")
            const canOpenGift = product.allowGift && !product.disabled && contacts.length > 0
            const giftDisabledReason = !product.allowGift
              ? "该商品不可赠礼"
              : product.disabled
                ? product.disabledReason || "当前无法购买赠礼"
                : contacts.length === 0
                  ? "暂无可赠送联系人"
                  : "购买后直接赠送，不进入背包"
            const giftOpen = canOpenGift && ui.selectedShopGiftProductId === product.id
            const selectedGiftRoleKey = ui.shopGiftSelectedRoleKeys[product.id] ?? ""
            const selectedGiftContact = contacts.find((contact) => contact.roleKey === selectedGiftRoleKey) ?? null
            const giftQuery = selectedGiftContact?.label ?? String(ui.shopGiftSearchQueries[product.id] ?? "")
            const normalizedGiftQuery = giftQuery.trim().toLocaleLowerCase("zh-Hans-CN")
            let visibleGiftTargetCount = 0
            const giftOptions = contacts.map((contact) => {
              const searchText = `${contact.label ?? ""} ${contact.roleKey ?? ""} ${contact.relationStageLabel ?? ""}`
              const hidden = normalizedGiftQuery
                ? !searchText.toLocaleLowerCase("zh-Hans-CN").includes(normalizedGiftQuery)
                : false
              if (!hidden) {
                visibleGiftTargetCount += 1
              }

              return `
                <button
                  class="shop-gift-option ${contact.roleKey === selectedGiftRoleKey ? "selected" : ""}"
                  type="button"
                  role="option"
                  aria-selected="${contact.roleKey === selectedGiftRoleKey ? "true" : "false"}"
                  ${hidden ? "hidden" : ""}
                  data-shop-gift-target="${h(product.id)}"
                  data-shop-gift-role="${h(contact.roleKey)}"
                  data-shop-gift-label="${h(contact.label ?? contact.roleKey)}"
                  data-shop-gift-search-text="${h(searchText)}"
                >
                  <span class="item-title">${h(contact.label ?? contact.roleKey)}</span>
                  <span class="item-meta">${h(contact.relationStageLabel ?? "联系人")} · 好感 ${h(contact.favor ?? 0)}/100${product.giftEffectiveFavorDeltas?.[contact.roleKey] ? ` · 好感 ${product.giftEffectiveFavorDeltas[contact.roleKey] > 0 ? "+" : ""}${h(product.giftEffectiveFavorDeltas[contact.roleKey])}` : ""}</span>
                </button>
              `
            }).join("")
            const giftPickerId = `shop-gift-picker-${product.id}`
            const giftOptionsId = `shop-gift-options-${product.id}`

            return `
              <article class="shop-product">
                <div class="shop-product-main">
                  <div>
                    <div class="item-title">${h(product.itemName ?? product.itemId)}</div>
                    <div class="item-meta">${h(product.itemId)} · ${h(buyMeta)}</div>
                    <div class="item-meta">${h(giftMeta)}</div>
                  </div>
                  <div class="shop-product-actions">
                    <button class="footer-command" ${product.disabled ? "disabled" : ""} title="购买后直接进入自己的背包" data-shop-buy="${h(product.id)}">购买</button>
                    <button
                      class="footer-command ${giftOpen ? "active" : ""}"
                      ${canOpenGift ? "" : "disabled"}
                      title="${h(giftDisabledReason)}"
                      aria-expanded="${giftOpen ? "true" : "false"}"
                      aria-controls="${h(giftPickerId)}"
                      data-shop-gift-toggle="${h(product.id)}"
                    >赠礼</button>
                  </div>
                </div>
                ${giftOpen ? `
                  <div class="shop-gift-row" id="${h(giftPickerId)}" data-shop-gift-picker="${h(product.id)}">
                    <label for="shop-gift-search-${h(product.id)}">赠送给</label>
                    <div class="shop-gift-combobox">
                      <input
                        id="shop-gift-search-${h(product.id)}"
                        type="search"
                        value="${h(giftQuery)}"
                        placeholder="选择或搜索联系人"
                        autocomplete="off"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls="${h(giftOptionsId)}"
                        data-shop-gift-search="${h(product.id)}"
                      >
                      <div class="shop-gift-options" id="${h(giftOptionsId)}" role="listbox">
                        ${giftOptions}
                        <div class="shop-gift-empty" ${visibleGiftTargetCount > 0 ? "hidden" : ""} data-shop-gift-empty>没有匹配的联系人</div>
                      </div>
                    </div>
                    <button
                      class="footer-command shop-gift-confirm"
                      type="button"
                      ${selectedGiftContact ? "" : "disabled"}
                      data-shop-gift-confirm="${h(product.id)}"
                      data-shop-gift-role="${h(selectedGiftContact?.roleKey ?? "")}"
                    >确定</button>
                  </div>
                ` : ""}
              </article>
            `
          }).join("")}
        </div>
      </div>
    `
  } else if (panelId === "save") {
    body = `
      <div class="panel-menu-actions">
        <button class="primary" data-action="save-game">保存当前进度</button>
        <button data-screen="saves">读取存档</button>
        <button data-screen="profiles">更换角色</button>
      </div>
    `
  } else {
    body = `<pre class="pre-lines">${h(JSON.stringify(data?.view?.debugSummary ?? {}, null, 2))}</pre>`
  }

  return body
}

function formatHistoryMinute(gameMinute) {
  if (typeof gameMinute !== "number" || !Number.isFinite(gameMinute) || gameMinute < 0) return "未定"
  const minute = Math.trunc(gameMinute)
  const day = Math.floor(minute / 1440) + 1
  const time = minute % 1440
  return `第${day}天 ${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`
}

function formatHistoryCategory(category) {
  return category === "operation" ? "操作" : category === "story" ? "剧情" : "系统"
}

/** @returns 当前工具面板的抽屉 HTML；没有打开面板时返回空串。 */
function renderMenuPanel() {
  if (!ui.menuPanel) {
    return ""
  }

  const labels = {
    notifications: "消息",
    global: "全局变量",
    system: "系统变量",
    scheduler: "调度",
    bag: "背包",
    doing: "行动",
    shop: "商城",
    save: "存档",
    debug: "调试"
  }
  const label = labels[ui.menuPanel] ?? "菜单"

  return `
    <div class="menu-backdrop" data-action="close-menu"></div>
    <aside class="menu-panel">
      <div class="menu-panel-header">
        <strong>${h(label)}</strong>
        <button data-action="close-menu">关闭</button>
      </div>
      <div class="menu-panel-body" data-menu-panel-scroll="${h(ui.menuPanel)}">${renderMenuPanelBody(ui.menuPanel)}</div>
    </aside>
  `
}

/** @param summary 顶部摘要。 @param data 服务端客户端状态。 @param view Runtime 视图。 @returns 游戏头部 HTML。 */
export function renderGameHeader(summary, data, view) {
  return `
    <header class="game-header">
      <div class="game-header-main">
        <div class="game-header-title">${h(view?.activeEventTitle ?? "等待事件")}</div>
        <div class="game-header-meta">
          ${h(summary.countyLabel || "未知地点")} · ${h(summary.dayLabel || "")} ${h(summary.clock || "")} ${h(summary.shiduanLabel || "")} · ${summary.paused ? "暂停" : "运行中"} x${h(summary.speed || 0)}
        </div>
      </div>
    </header>
  `
}

/** @param summary 时间/状态摘要。 @param data 服务端状态。 @returns 含工具入口、存档和联系人未读提示的页脚 HTML。 */
export function renderGameFooter(summary, data) {
  const contactClass = data?.contactUnreadCount > 0 ? "footer-stat contact-unread" : "footer-stat"

  return `
    <footer class="game-footer">
      <div class="footer-status-row">
        <div class="footer-status-left">
          <span class="footer-stat strong">${h(summary.playerName || "未命名")}</span>
          <span class="footer-stat">资金 ${h(summary.moneyLabel)}</span>
          <button class="${contactClass}" data-action="open-contact">C 联系人 ${h(data?.contactUnreadCount ?? 0)}</button>
        </div>
        <div class="footer-status-right">
          <button class="footer-command" data-menu-panel="doing">D 行动</button>
          <button class="footer-command" data-menu-panel="shop">M 商城</button>
          <button class="footer-command footer-next-day" data-action="advance-day">N 下一天</button>
        </div>
      </div>
      <div class="footer-command-row">
        <button class="footer-command primary" data-action="back-main">Esc 返回主界面</button>
        <button class="footer-command" data-action="toggle-pause">${summary.paused ? "Space 继续" : "Space 暂停"}</button>
        <button class="footer-command" data-menu-panel="notifications">L 消息</button>
        <button class="footer-command" data-menu-panel="bag">B 背包</button>
        <button class="footer-command" data-menu-panel="global">I 全局</button>
        <button class="footer-command" data-menu-panel="system">O 系统</button>
        <button class="footer-command" data-menu-panel="scheduler">T 调度</button>
        <button class="footer-command" data-menu-panel="save">S 存档</button>
      </div>
    </footer>
  `
}

/** @returns 当前完整游戏页 HTML，包括头部、剧情、交互、上下文、菜单、联系人和页脚。 */
export function renderGame() {
  const data = ui.data
  const view = data?.view
  const summary = data?.summary ?? {}

  return `
    <main class="game-shell">
      ${renderGameHeader(summary, data, view)}
      <section class="game-stage">
        <div class="story-scroll">
            <div>
              <h2 class="event-title">${h(view?.activeEventTitle ?? "等待事件")}</h2>
              <div class="event-meta">事件：${h(view?.activeEventId ?? "无")} · 地点：${h(view?.currentLocationName ?? view?.currentLocationId ?? "未指定")}</div>
            </div>
            ${renderDialogue(view)}
            ${renderInteraction(view)}
            ${renderContext(view)}
        </div>
      </section>
      ${renderGameFooter(summary, data)}
    </main>
    ${renderMenuPanel()}
    ${renderContactDrawer()}
  `
}

/** @param action 联系人互动动作视图。 @returns 金钱和物品成本的短文本；无成本时为“免费”。 */
function formatContactCost(action) {
  const parts = []
  if (action.costMoney > 0) {
    parts.push(`${action.costMoney}元`)
  }
  if (action.costItems?.length > 0) {
    parts.push(action.costItems.map((item) => `${item.itemName}x${item.quantity}`).join("、"))
  }
  return parts.length > 0 ? parts.join(" + ") : "无消耗"
}

/** @param conversation 活动结构化联系人会话。 @param labels 当前媒介文案。 @returns 当前节点可见玩家回复按钮 HTML。 */
function renderContactConversationActions(conversation, labels) {
  const replies = (conversation?.replies ?? []).filter((reply) => reply.visible)

  return `
    <div class="contact-conversation-panel">
      <div class="contact-conversation-title">
        <strong>${h(conversation.title || labels.conversation)}</strong>
        <span class="item-meta">节点 ${h(conversation.nodeIndex)}/${h(conversation.nodeTotal)} · ${h(conversation.nodeTitle || conversation.nodeId)}</span>
      </div>
      <div class="quick-grid contact-conversation-replies" data-contact-options-scroll="${h(`${conversation.roleKey}:conversation:${conversation.nodeId}`)}">
        ${replies.length === 0 ? `<div class="empty">当前剧情对话没有可选回复。</div>` : replies.map((reply, index) => `
          <button class="option-button" data-contact-conversation-reply="${h(reply.id)}">
            ${index + 1}. ${h(reply.text)}
            <span class="item-meta">${h(labels.reply)}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `
}

/** @param messages 往来消息。 @param preset 展示预设。 @returns 对应媒介布局的消息 HTML。 */
function renderContactMessages(messages, preset) {
  return messages.map((message) => `
    <article class="contact-message contact-message--${preset} ${h(message.sender)}" data-contact-message="${h(message.id)}">
      <div class="bubble-meta">${h(message.senderLabel)} · ${h(message.gameMinuteLabel ?? message.gameMinute)}</div>
      <div class="contact-message__content">${h(message.content)}</div>
    </article>
  `).join("")
}

/**
 * 渲染联系人列表、消息线程和话题/动作选择组成的联系人抽屉。
 * @returns 联系人抽屉关闭时为空串，否则为完整 HTML；所有服务端文本在插入前经过 h 转义。
 */
function renderContactDrawer() {
  if (!ui.contactOpen) {
    return ""
  }

  const contacts = ui.data?.contacts ?? []
  const activeConversation = getActiveContactConversation()
  if (!ui.selectedRoleKey && activeConversation?.roleKey) {
    ui.selectedRoleKey = activeConversation.roleKey
  }
  const selected = contacts.find((contact) => contact.roleKey === ui.selectedRoleKey) ?? null
  const thread = ui.thread
  const messages = thread?.messages ?? []
  const options = ui.contactMode === "talk"
    ? (thread?.talks ?? [])
    : ui.contactMode === "action"
      ? (thread?.actions ?? [])
      : []
  const selectedConversation = selected && activeConversation?.roleKey === selected.roleKey
    ? activeConversation
    : null
  const presetValues = ["generic", "phone", "letter", "transmission"]
  const channelPreset = presetValues.includes(thread?.channelPreset)
    ? thread.channelPreset
    : presetValues.includes(selected?.channelPreset)
      ? selected.channelPreset
      : "generic"
  const channelLabels = thread?.channelLabels ?? selected?.channelLabels ?? {
    message: "消息",
    conversation: "联系人剧情",
    talk: "闲聊",
    action: "动作",
    gift: "赠礼",
    send: "发送",
    reply: "回复"
  }

  return `
    <div class="drawer-backdrop" data-action="close-contact"></div>
    <aside class="contact-drawer">
      <div class="contact-header">
        <div>
          <strong>联系人</strong>
          <div class="item-meta">未读 ${h(ui.data?.contactUnreadCount ?? 0)}</div>
        </div>
        <button data-action="close-contact">关闭</button>
      </div>
      <div class="contact-body">
        <div class="contacts-pane">
          <div class="list">
            ${contacts.length === 0 ? `<div class="empty">还没有联系人。</div>` : contacts.map((contact) => `
              <button class="list-item ${contact.roleKey === ui.selectedRoleKey ? "active" : ""}" data-contact-contact="${h(contact.roleKey)}">
                <span class="item-title">${h(contact.label)}${contact.unreadCount > 0 ? ` · 未读 ${contact.unreadCount}` : ""}${activeConversation?.roleKey === contact.roleKey ? " · 剧情中" : ""}</span>
                <span class="item-meta">${h(contact.channelName)} · ${h(contact.relationStageLabel)} · 好感 ${h(contact.favor)}/100 · ${h(contact.personalityLabel)}${contact.canContact ? "" : ` · ${contact.lockMessage ?? "不可联系"}`}</span>
                ${contact.lastMessagePreview ? `<span class="item-meta">${h(contact.lastMessagePreview)}</span>` : ""}
              </button>
            `).join("")}
          </div>
        </div>
        <div class="thread-pane">
          <div class="message-list contact-thread contact-thread--${channelPreset}" data-contact-thread-scroll="${h(selected?.roleKey ?? "")}" data-contact-preset="${channelPreset}">
            ${selected ? `
              <div class="contact-thread__heading">${h(selected.label)} · ${h(selected.channelName)} · ${h(selected.relationTrackLabel)} / ${h(selected.relationStageLabel)} · 好感 ${h(selected.favor)}/100</div>
              ${messages.length === 0 ? `<div class="empty">还没有${h(channelLabels.message)}。</div>` : renderContactMessages(messages, channelPreset)}
            ` : `<div class="empty">选择左侧联系人查看消息。</div>`}
          </div>
          <div class="contact-actions">
            ${selected ? `
              ${selectedConversation ? renderContactConversationActions(selectedConversation, channelLabels) : `
                <div class="segment">
                  <button class="${ui.contactMode === "talk" ? "active" : ""}" data-contact-mode="talk">${h(channelLabels.talk)}</button>
                  <button class="${ui.contactMode === "action" ? "active" : ""}" data-contact-mode="action">${h(channelLabels.action)}</button>
                  <button class="${ui.contactMode === "gift" ? "active" : ""}" data-contact-mode="gift">${h(channelLabels.gift)}</button>
                </div>
                ${ui.contactMode === "gift" ? renderContactGiftPanel(selected) : `<div class="quick-grid" data-contact-options-scroll="${h(`${selected.roleKey}:${ui.contactMode}`)}">
                  ${thread?.canContact === false ? `<div class="empty">${h(thread.lockMessage ?? "对方现在不想理我。")}</div>` : ""}
                  ${options.length === 0 ? `<div class="empty">当前没有可用${ui.contactMode === "talk" ? "短句" : "动作"}。</div>` : options.map((option) => {
                    const disabled = ui.contactMode === "action" && option.disabled
                    const effectiveFavorDelta = Number(option.effectiveFavorDelta) || 0
                    const favorMeta = effectiveFavorDelta !== 0
                      ? ` · 好感 ${effectiveFavorDelta > 0 ? "+" : ""}${effectiveFavorDelta}`
                      : ""
                    const meta = ui.contactMode === "action"
                      ? `${formatContactCost(option)}${favorMeta}${option.disabledReason ? ` · ${option.disabledReason}` : ""}`
                      : `${option.tags?.slice(0, 2).join("/") || "闲聊"}${favorMeta}${option.suggested ? " · 推荐" : ""}`
                    return `
                      <button class="option-button" ${disabled ? "disabled" : ""} data-contact-${ui.contactMode}="${h(option.id)}">
                        ${h(ui.contactMode === "action" ? option.label : option.text)}
                        <span class="item-meta">${h(channelLabels.send)} · ${h(meta)}</span>
                      </button>
                    `
                  }).join("")}
                </div>`}
              `}
            ` : `<div class="empty">先选择联系人。</div>`}
          </div>
        </div>
      </div>
    </aside>
  `
}
