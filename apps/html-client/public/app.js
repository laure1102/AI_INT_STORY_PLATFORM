const dom = {
  app: document.querySelector("#app"),
  toast: document.querySelector("#toast")
}

const routeStorySegment = window.location.pathname.split("/").filter(Boolean)[0] ?? ""
const route = {
  storyId: decodeURIComponent(routeStorySegment),
  basePath: routeStorySegment ? `/${encodeURIComponent(routeStorySegment)}` : ""
}

const ui = {
  data: null,
  busy: false,
  screen: "auto",
  menuPanel: null,
  selectedDoingMenuId: null,
  menuPanelScrollTops: {},
  phoneThreadScrollTops: {},
  phoneOptionsScrollTops: {},
  phoneThreadLastMessageKeys: {},
  phoneThreadAutoScrollRoleKeys: {},
  createOpen: false,
  prompts: [],
  phoneOpen: false,
  phoneMode: "talk",
  selectedRoleKey: null,
  thread: null,
  tickInFlight: false,
  toastTimer: 0
}

function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function showToast(message, variant = "info") {
  clearTimeout(ui.toastTimer)
  dom.toast.textContent = message
  dom.toast.className = variant === "error" ? "toast error" : "toast"
  dom.toast.hidden = false
  ui.toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true
  }, 2600)
}

function setBusy(nextBusy) {
  ui.busy = nextBusy
  render()
}

function rememberMenuPanelScroll() {
  const body = dom.app.querySelector("[data-menu-panel-scroll]")
  const panel = body?.dataset.menuPanelScroll
  if (!body || !panel) {
    return
  }
  ui.menuPanelScrollTops[panel] = body.scrollTop
}

function restoreMenuPanelScroll() {
  const body = dom.app.querySelector("[data-menu-panel-scroll]")
  const panel = body?.dataset.menuPanelScroll
  if (!body || !panel) {
    return
  }

  const top = ui.menuPanelScrollTops[panel]
  if (!Number.isFinite(top)) {
    return
  }

  const apply = () => {
    body.scrollTop = top
  }
  apply()
  window.requestAnimationFrame(apply)
}

function rememberPhoneThreadScroll() {
  if (!ui.phoneOpen) {
    return
  }

  const body = dom.app.querySelector("[data-phone-thread-scroll]")
  const roleKey = body?.dataset.phoneThreadScroll
  if (!body || !roleKey) {
    return
  }

  ui.phoneThreadScrollTops[roleKey] = body.scrollTop
}

function restorePhoneThreadScroll() {
  if (!ui.phoneOpen) {
    return
  }

  const body = dom.app.querySelector("[data-phone-thread-scroll]")
  const roleKey = body?.dataset.phoneThreadScroll
  if (!body || !roleKey) {
    return
  }

  if (ui.phoneThreadAutoScrollRoleKeys[roleKey]) {
    delete ui.phoneThreadAutoScrollRoleKeys[roleKey]
    const applyBottom = () => {
      body.scrollTop = body.scrollHeight
      ui.phoneThreadScrollTops[roleKey] = body.scrollTop
    }
    applyBottom()
    window.requestAnimationFrame(applyBottom)
    return
  }

  const top = ui.phoneThreadScrollTops[roleKey]
  if (!Number.isFinite(top)) {
    return
  }

  const apply = () => {
    body.scrollTop = top
  }
  apply()
  window.requestAnimationFrame(apply)
}

function rememberPhoneOptionsScroll() {
  if (!ui.phoneOpen) {
    return
  }

  const body = dom.app.querySelector("[data-phone-options-scroll]")
  const key = body?.dataset.phoneOptionsScroll
  if (!body || !key) {
    return
  }

  ui.phoneOptionsScrollTops[key] = body.scrollTop
}

function restorePhoneOptionsScroll() {
  if (!ui.phoneOpen) {
    return
  }

  const body = dom.app.querySelector("[data-phone-options-scroll]")
  const key = body?.dataset.phoneOptionsScroll
  if (!body || !key) {
    return
  }

  const top = ui.phoneOptionsScrollTops[key]
  if (!Number.isFinite(top)) {
    return
  }

  const apply = () => {
    body.scrollTop = top
  }
  apply()
  window.requestAnimationFrame(apply)
}

function bindScrollMemory() {
  dom.app.querySelectorAll("[data-menu-panel-scroll]").forEach((element) => {
    element.addEventListener("scroll", () => {
      const panel = element.dataset.menuPanelScroll
      if (!panel) {
        return
      }
      ui.menuPanelScrollTops[panel] = element.scrollTop
    }, { passive: true })
  })

  dom.app.querySelectorAll("[data-phone-thread-scroll]").forEach((element) => {
    element.addEventListener("scroll", () => {
      const roleKey = element.dataset.phoneThreadScroll
      if (!roleKey) {
        return
      }
      ui.phoneThreadScrollTops[roleKey] = element.scrollTop
    }, { passive: true })
  })

  dom.app.querySelectorAll("[data-phone-options-scroll]").forEach((element) => {
    element.addEventListener("scroll", () => {
      const key = element.dataset.phoneOptionsScroll
      if (!key) {
        return
      }
      ui.phoneOptionsScrollTops[key] = element.scrollTop
    }, { passive: true })
  })
}

function getPhoneThreadMessageKey(thread) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : []
  const lastMessage = messages.at(-1)
  return `${messages.length}:${lastMessage?.id ?? ""}`
}

function updatePhoneThreadAutoScroll(roleKey, thread, { force = false } = {}) {
  if (!roleKey) {
    return
  }

  const nextKey = getPhoneThreadMessageKey(thread)
  const previousKey = ui.phoneThreadLastMessageKeys[roleKey]
  ui.phoneThreadLastMessageKeys[roleKey] = nextKey

  if (force || previousKey === undefined || previousKey !== nextKey) {
    ui.phoneThreadAutoScrollRoleKeys[roleKey] = true
  }
}

async function fetchPhoneThread(roleKey, options = {}) {
  const result = await api(`/api/phone/thread?roleKey=${encodeURIComponent(roleKey)}`, { method: "GET" })
  updatePhoneThreadAutoScroll(roleKey, result.thread, { force: Boolean(options.forceScroll) })
  ui.thread = result.thread
  return result.thread
}

async function refreshSelectedPhoneThread(options = {}) {
  if (!ui.phoneOpen || !ui.selectedRoleKey) {
    return null
  }

  return fetchPhoneThread(ui.selectedRoleKey, options)
}

function openMenuPanel(panel) {
  if (ui.menuPanel !== panel) {
    ui.menuPanelScrollTops[panel] = 0
  }
  ui.phoneOpen = false
  ui.menuPanel = panel
  render()
}

function getDoingView() {
  return ui.data?.view?.doing ?? { menus: [], doings: [] }
}

function getSelectedDoingMenu(menus) {
  if (menus.some((menu) => menu.id === ui.selectedDoingMenuId)) {
    return ui.selectedDoingMenuId
  }

  const firstMenuId = menus[0]?.id ?? null
  ui.selectedDoingMenuId = firstMenuId
  return firstMenuId
}

function returnToMainView() {
  ui.phoneOpen = false
  ui.menuPanel = null
  ui.selectedRoleKey = null
  ui.thread = null
  ui.createOpen = false
  ui.screen = "profiles"
  render()
}

async function api(path, options = {}) {
  const endpoint = path.startsWith("/api/")
    ? `${route.basePath}${path}`
    : path
  const response = await fetch(endpoint, {
    method: options.method ?? "POST",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `请求失败：${response.status}`)
  }
  return payload
}

async function runTask(label, handler) {
  setBusy(true)
  try {
    const result = await handler()
    if (result?.stage) {
      ui.data = result
    }
    showToast(label)
    return result
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error")
    throw error
  } finally {
    setBusy(false)
  }
}

async function refreshState() {
  const result = await api("/api/state", { method: "GET" })
  ui.data = result
  render()
}

async function bootstrap() {
  await runTask("客户端已启动", async () => {
    const result = await api("/api/bootstrap")
    ui.data = result
    ui.screen = "profiles"
    return result
  })
}

async function syncStoryBundle() {
  const result = await api("/api/sync-story-bundle")
  ui.data = result
  ui.prompts = []
  return result
}

async function loadPrompts({ force = false } = {}) {
  if (!force && ui.prompts.length > 0) {
    return
  }

  const result = await api("/api/player-prompts", { method: "GET" })
  ui.prompts = result.prompts ?? []
}

function profileMeta(profile) {
  return [
    profile.locationLabel,
    `${profile.customValueCount ?? 0} 个自定义变量`,
    profile.createdAt
  ].filter(Boolean).join(" · ")
}

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

function renderProfiles() {
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

function renderSaves() {
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

function renderMenuPanelBody(panelId) {
  const data = ui.data
  let body = ""

  if (panelId === "notifications") {
    const notifications = data?.notifications ?? []
    body = notifications.length === 0
      ? `<div class="empty">暂无通知。</div>`
      : `<div class="notification-list">${notifications.slice().reverse().map((item) => `<div class="notification-item">${h(item)}</div>`).join("")}</div>`
  } else if (panelId === "global") {
    body = `<pre class="pre-lines">${h((data?.globalValueLines ?? []).join("\n"))}</pre>`
  } else if (panelId === "system") {
    body = `<pre class="pre-lines">${h((data?.systemValueLines ?? []).join("\n"))}</pre>`
  } else if (panelId === "scheduler") {
    body = `<pre class="pre-lines">${h((data?.schedulerLines ?? []).join("\n"))}</pre>`
  } else if (panelId === "bag") {
    body = `<pre class="pre-lines">${h((data?.bagLines ?? []).join("\n"))}</pre>`
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

function renderGameHeader(summary, data, view) {
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

function renderGameFooter(summary, data) {
  const phoneClass = data?.phoneUnreadCount > 0 ? "footer-stat phone-unread" : "footer-stat"

  return `
    <footer class="game-footer">
      <div class="footer-status-row">
        <div class="footer-status-left">
          <span class="footer-stat strong">${h(summary.playerName || "未命名")}</span>
          <span class="footer-stat">资金 ${h(summary.moneyLabel)}</span>
          <button class="${phoneClass}" data-action="open-phone">手机 ${h(data?.phoneUnreadCount ?? 0)}</button>
        </div>
        <div class="footer-status-right">
          <button class="footer-command" data-menu-panel="doing">D 行动</button>
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

function renderGame() {
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
    ${renderPhoneDrawer()}
  `
}

function formatPhoneCost(action) {
  const parts = []
  if (action.costMoney > 0) {
    parts.push(`${action.costMoney}元`)
  }
  if (action.costItems?.length > 0) {
    parts.push(action.costItems.map((item) => `${item.itemName}x${item.quantity}`).join("、"))
  }
  return parts.length > 0 ? parts.join(" + ") : "无消耗"
}

function renderPhoneDrawer() {
  if (!ui.phoneOpen) {
    return ""
  }

  const contacts = ui.data?.phoneContacts ?? []
  const selected = contacts.find((contact) => contact.roleKey === ui.selectedRoleKey) ?? null
  const thread = ui.thread
  const messages = thread?.messages ?? []
  const options = ui.phoneMode === "talk" ? (thread?.talks ?? []) : (thread?.actions ?? [])

  return `
    <div class="drawer-backdrop" data-action="close-phone"></div>
    <aside class="phone-drawer">
      <div class="phone-header">
        <div>
          <strong>手机联系人</strong>
          <div class="item-meta">未读 ${h(ui.data?.phoneUnreadCount ?? 0)}</div>
        </div>
        <button data-action="close-phone">关闭</button>
      </div>
      <div class="phone-body">
        <div class="contacts-pane">
          <div class="list">
            ${contacts.length === 0 ? `<div class="empty">还没有联系人。</div>` : contacts.map((contact) => `
              <button class="list-item ${contact.roleKey === ui.selectedRoleKey ? "active" : ""}" data-phone-contact="${h(contact.roleKey)}">
                <span class="item-title">${h(contact.label)}${contact.unreadCount > 0 ? ` · 未读 ${contact.unreadCount}` : ""}</span>
                <span class="item-meta">${h(contact.relationStageLabel)} · 好感 ${h(contact.favor)}/100 · ${h(contact.personalityLabel)}${contact.canContact ? "" : ` · ${contact.lockMessage ?? "不可联系"}`}</span>
                ${contact.lastMessagePreview ? `<span class="item-meta">${h(contact.lastMessagePreview)}</span>` : ""}
              </button>
            `).join("")}
          </div>
        </div>
        <div class="thread-pane">
          <div class="message-list" data-phone-thread-scroll="${h(selected?.roleKey ?? "")}">
            ${selected ? `
              <div class="item-meta">${h(selected.label)} · ${h(selected.relationTrackLabel)} / ${h(selected.relationStageLabel)} · 好感 ${h(selected.favor)}/100</div>
              ${messages.length === 0 ? `<div class="empty">还没有往来消息。</div>` : messages.map((message) => `
                <div class="bubble ${h(message.sender)}">
                  <div class="bubble-meta">${h(message.senderLabel)} · ${h(message.gameMinuteLabel ?? message.gameMinute)}</div>
                  <div>${h(message.content)}</div>
                </div>
              `).join("")}
            ` : `<div class="empty">选择左侧联系人查看消息。</div>`}
          </div>
          <div class="phone-actions">
            ${selected ? `
              <div class="segment">
                <button class="${ui.phoneMode === "talk" ? "active" : ""}" data-phone-mode="talk">说话</button>
                <button class="${ui.phoneMode === "action" ? "active" : ""}" data-phone-mode="action">动作</button>
              </div>
              <div class="quick-grid" data-phone-options-scroll="${h(`${selected.roleKey}:${ui.phoneMode}`)}">
                ${thread?.canContact === false ? `<div class="empty">${h(thread.lockMessage ?? "对方现在不想理我。")}</div>` : ""}
                ${options.length === 0 ? `<div class="empty">当前没有可用${ui.phoneMode === "talk" ? "短句" : "动作"}。</div>` : options.map((option) => {
                  const disabled = ui.phoneMode === "action" && option.disabled
                  const meta = ui.phoneMode === "action"
                    ? `${formatPhoneCost(option)}${option.baseFavorDelta ? ` · 好感 +${option.baseFavorDelta}` : ""}${option.disabledReason ? ` · ${option.disabledReason}` : ""}`
                    : `${option.tags?.slice(0, 2).join("/") || "闲聊"}${option.baseFavorDelta ? ` · 好感 +${option.baseFavorDelta}` : ""}${option.suggested ? " · 推荐" : ""}`
                  return `
                    <button class="option-button" ${disabled ? "disabled" : ""} data-phone-${ui.phoneMode}="${h(option.id)}">
                      ${h(ui.phoneMode === "action" ? option.label : option.text)}
                      <span class="item-meta">${h(meta)}</span>
                    </button>
                  `
                }).join("")}
              </div>
            ` : `<div class="empty">先选择联系人。</div>`}
          </div>
        </div>
      </div>
    </aside>
  `
}

function render() {
  rememberMenuPanelScroll()
  rememberPhoneThreadScroll()
  rememberPhoneOptionsScroll()

  if (!ui.data) {
    dom.app.innerHTML = `
      <section class="center-state">
        <div class="loading-dot"></div>
        <p>正在启动 HTML 客户端...</p>
      </section>
    `
    return
  }

  if (ui.screen === "profiles" || !ui.data.profile) {
    dom.app.innerHTML = renderProfiles()
  } else if (ui.screen === "saves" || !ui.data.hasSession) {
    dom.app.innerHTML = renderSaves()
  } else {
    dom.app.innerHTML = renderGame()
  }

  bindEvents()
  bindScrollMemory()
  restoreMenuPanelScroll()
  restorePhoneThreadScroll()
  restorePhoneOptionsScroll()
}

async function dispatchRuntimeAction(action) {
  setBusy(true)
  try {
    const result = await api("/api/session/action", { body: { action } })
    ui.data = result
    if (ui.phoneOpen && ui.selectedRoleKey) {
      await loadPhoneThread(ui.selectedRoleKey)
    } else {
      render()
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error")
    throw error
  } finally {
    setBusy(false)
  }
}

async function loadPhoneThread(roleKey, options = {}) {
  await fetchPhoneThread(roleKey, options)
  render()
}

async function openPhoneThread(roleKey) {
  ui.selectedRoleKey = roleKey
  await api("/api/session/action", {
    body: {
      action: { type: "phone-mark-read", roleKey }
    }
  }).then((result) => {
    ui.data = result
  })
  await loadPhoneThread(roleKey, { forceScroll: true })
}

async function saveGame() {
  const defaultSlot = `slot-${(ui.data?.saveSlots?.length ?? 0) + 1}`
  const slotId = window.prompt("保存到哪个存档？", defaultSlot)
  if (slotId === null) {
    return
  }
  await runTask("进度已保存", async () => api("/api/session/save", { body: { slotId } }))
}

async function advanceDay() {
  await runTask("已推进到下一天", async () => {
    const result = await api("/api/session/advance-day")
    ui.data = result
    await refreshSelectedPhoneThread()
    return result
  })
}

async function selectInteractionOptionByNumber(key) {
  if (ui.phoneOpen || ui.menuPanel) {
    return false
  }

  if (!/^[1-9]$/.test(key)) {
    return false
  }

  const interaction = ui.data?.view?.interaction
  if (interaction?.kind !== "select") {
    return false
  }

  const option = interaction.options[Number(key) - 1]
  if (!option) {
    return false
  }

  await dispatchRuntimeAction({ type: "select-option", optionId: option.id })
  return true
}

async function tick() {
  if (!ui.data?.hasSession || ui.tickInFlight) {
    return
  }

  ui.tickInFlight = true
  try {
    const result = await api("/api/session/tick", { body: { deltaMs: 1000 } })
    ui.data = result
    await refreshSelectedPhoneThread()
    render()
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error")
  } finally {
    ui.tickInFlight = false
  }
}

function bindEvents() {
  dom.app.querySelectorAll("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.screen = button.dataset.screen
      render()
    })
  })

  dom.app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action
      if (action === "toggle-create") {
        ui.createOpen = !ui.createOpen
        if (ui.createOpen) {
          await runTask("建角字段已载入", async () => loadPrompts({ force: true }))
        }
        render()
      } else if (action === "new-game") {
        await runTask("新游戏已启动", async () => {
          await syncStoryBundle()
          return api("/api/session/new")
        })
        ui.screen = "game"
      } else if (action === "refresh-saves") {
        await runTask("存档列表已刷新", async () => api("/api/saves/list"))
      } else if (action === "toggle-pause") {
        await runTask("时间状态已更新", async () => api("/api/session/time", { body: { paused: !ui.data.summary.paused } }))
      } else if (action === "advance-day") {
        await advanceDay()
      } else if (action === "save-game") {
        await saveGame()
      } else if (action === "back-main") {
        returnToMainView()
      } else if (action === "open-phone") {
        ui.menuPanel = null
        ui.phoneOpen = true
        render()
      } else if (action === "close-phone") {
        ui.phoneOpen = false
        ui.selectedRoleKey = null
        ui.thread = null
        render()
      } else if (action === "close-menu") {
        ui.menuPanel = null
        render()
      }
    })
  })

  dom.app.querySelectorAll("[data-menu-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      openMenuPanel(button.dataset.menuPanel)
    })
  })

  dom.app.querySelectorAll("[data-doing-menu]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.selectedDoingMenuId = button.dataset.doingMenu
      render()
    })
  })

  dom.app.querySelectorAll("[data-doing-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      ui.menuPanel = null
      await dispatchRuntimeAction({ type: "start-doing", doingId: button.dataset.doingAction })
    })
  })

  dom.app.querySelectorAll("[data-select-profile]").forEach((button) => {
    button.addEventListener("click", async () => {
      await runTask("角色已载入", async () => api("/api/profiles/select", { body: { profileId: button.dataset.selectProfile } }))
      ui.screen = "saves"
    })
  })

  dom.app.querySelectorAll("[data-load-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      await runTask("存档已读取", async () => {
        await syncStoryBundle()
        return api("/api/session/load", { body: { slotId: button.dataset.loadSave } })
      })
      ui.screen = "game"
    })
  })

  dom.app.querySelectorAll("[data-runtime-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = JSON.parse(button.dataset.runtimeAction)
      await dispatchRuntimeAction(action)
    })
  })

  dom.app.querySelectorAll("[data-speed]").forEach((button) => {
    button.addEventListener("click", async () => {
      await runTask("时间倍率已更新", async () => api("/api/session/time", { body: { speed: Number(button.dataset.speed), paused: false } }))
    })
  })

  dom.app.querySelectorAll("[data-phone-contact]").forEach((button) => {
    button.addEventListener("click", async () => {
      rememberPhoneThreadScroll()
      rememberPhoneOptionsScroll()
      await openPhoneThread(button.dataset.phoneContact)
    })
  })

  dom.app.querySelectorAll("[data-phone-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      rememberPhoneThreadScroll()
      rememberPhoneOptionsScroll()
      ui.phoneMode = button.dataset.phoneMode
      render()
    })
  })

  dom.app.querySelectorAll("[data-phone-talk]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!ui.selectedRoleKey) return
      await dispatchRuntimeAction({ type: "phone-send-talk", roleKey: ui.selectedRoleKey, talkId: button.dataset.phoneTalk })
      await dispatchRuntimeAction({ type: "phone-mark-read", roleKey: ui.selectedRoleKey })
    })
  })

  dom.app.querySelectorAll("[data-phone-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!ui.selectedRoleKey) return
      await dispatchRuntimeAction({ type: "phone-send-action", roleKey: ui.selectedRoleKey, actionId: button.dataset.phoneAction })
      await dispatchRuntimeAction({ type: "phone-mark-read", roleKey: ui.selectedRoleKey })
    })
  })

  const createForm = dom.app.querySelector("#create-profile-form")
  if (createForm) {
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault()
      const formData = new FormData(createForm)
      const customValues = {}
      for (const prompt of ui.prompts) {
        customValues[prompt.varKey] = String(formData.get(prompt.varKey) ?? "")
      }
      const profileName = buildProfileNameFromCustomValues(customValues)
      await runTask("角色已创建", async () => api("/api/profiles/create", { body: { profileName, customValues } }))
      ui.createOpen = false
      ui.screen = "saves"
    })
  }

  const textForm = dom.app.querySelector("#text-interaction-form")
  if (textForm) {
    textForm.addEventListener("submit", async (event) => {
      event.preventDefault()
      const value = String(new FormData(textForm).get("value") ?? "")
      const interaction = ui.data?.view?.interaction
      if (interaction?.kind === "text-input") {
        await dispatchRuntimeAction({ type: "submit-text", field: interaction.field, value })
      }
    })
  }
}

document.addEventListener("keydown", async (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
    return
  }

  const key = event.key.toLowerCase()
  if (!ui.data?.hasSession) {
    return
  }

  if (await selectInteractionOptionByNumber(key)) {
    event.preventDefault()
    return
  }

  if (key === "escape") {
    returnToMainView()
  } else if (key === "p") {
    ui.menuPanel = null
    ui.phoneOpen = !ui.phoneOpen
    render()
  } else if (key === " ") {
    event.preventDefault()
    await runTask("时间状态已更新", async () => api("/api/session/time", { body: { paused: !ui.data.summary.paused } }))
  } else if (key === "n") {
    await advanceDay()
  } else if (key === "d") {
    openMenuPanel("doing")
  } else if (key === "l") {
    openMenuPanel("notifications")
  } else if (key === "i") {
    openMenuPanel("global")
  } else if (key === "o") {
    openMenuPanel("system")
  } else if (key === "t" || key === "e") {
    openMenuPanel("scheduler")
  } else if (key === "b") {
    openMenuPanel("bag")
  } else if (key === "s") {
    openMenuPanel("save")
  }
})

window.setInterval(() => {
  void tick()
}, 1000)

void bootstrap().catch((error) => {
  dom.app.innerHTML = `
    <section class="center-state">
      <p>启动失败</p>
      <pre class="pre-lines">${h(error instanceof Error ? error.message : String(error))}</pre>
      <button class="primary" onclick="location.reload()">重新加载</button>
    </section>
  `
  showToast(error instanceof Error ? error.message : String(error), "error")
})
