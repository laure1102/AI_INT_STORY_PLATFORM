import {
  dom,
  getActiveContactConversation,
  h,
  route,
  ui
} from "./browser-state.js"
import { renderGame, renderProfiles, renderSaves } from "./browser-render.js"
import { filterShopGiftTargetOptions } from "./browser-shop.js"
import { bindGiftEvents } from "./browser-gifts.js"

/** @param message 提示文本。 @param variant info 或 error 样式。 @returns 无返回值；显示 2.6 秒后自动隐藏的 toast。 */
function showToast(message, variant = "info") {
  clearTimeout(ui.toastTimer)
  dom.toast.textContent = message
  dom.toast.className = variant === "error" ? "toast error" : "toast"
  dom.toast.hidden = false
  ui.toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true
  }, 2600)
}

/** @param nextBusy 是否正在执行异步任务。 @returns 无返回值；更新状态并重绘按钮禁用效果。 */
function setBusy(nextBusy) {
  ui.busy = nextBusy
  render()
}

/** @returns 无返回值；把当前工具面板滚动位置按 panel id 保存到临时 UI 状态。 */
function rememberMenuPanelScroll() {
  const body = dom.app.querySelector("[data-menu-panel-scroll]")
  const panel = body?.dataset.menuPanelScroll
  if (!body || !panel) {
    return
  }
  ui.menuPanelScrollTops[panel] = body.scrollTop
}

/** @returns 无返回值；重绘后恢复当前工具面板滚动位置。 */
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

  /** @returns 无返回值；把已记录位置写回当前面板元素。 */
  const apply = () => {
    body.scrollTop = top
  }
  apply()
  window.requestAnimationFrame(apply)
}

/** @returns 无返回值；按联系人记住消息线程滚动位置。 */
function rememberContactThreadScroll() {
  if (!ui.contactOpen) {
    return
  }

  const body = dom.app.querySelector("[data-contact-thread-scroll]")
  const roleKey = body?.dataset.contactThreadScroll
  if (!body || !roleKey) {
    return
  }

  ui.contactThreadScrollTops[roleKey] = body.scrollTop
}

/** @returns 无返回值；新消息时滚到底部，否则恢复联系人之前的阅读位置。 */
function restoreContactThreadScroll() {
  if (!ui.contactOpen) {
    return
  }

  const body = dom.app.querySelector("[data-contact-thread-scroll]")
  const roleKey = body?.dataset.contactThreadScroll
  if (!body || !roleKey) {
    return
  }

  if (ui.contactThreadAutoScrollRoleKeys[roleKey]) {
    delete ui.contactThreadAutoScrollRoleKeys[roleKey]
    /** @returns 无返回值；滚动到消息末尾并保存最终 scrollTop。 */
    const applyBottom = () => {
      body.scrollTop = body.scrollHeight
      ui.contactThreadScrollTops[roleKey] = body.scrollTop
    }
    applyBottom()
    window.requestAnimationFrame(applyBottom)
    return
  }

  const top = ui.contactThreadScrollTops[roleKey]
  if (!Number.isFinite(top)) {
    return
  }

  /** @returns 无返回值；恢复该联系人的历史滚动位置。 */
  const apply = () => {
    body.scrollTop = top
  }
  apply()
  window.requestAnimationFrame(apply)
}

/** @returns 无返回值；按联系人和互动模式记住选项区域滚动位置。 */
function rememberContactOptionsScroll() {
  if (!ui.contactOpen) {
    return
  }

  const body = dom.app.querySelector("[data-contact-options-scroll]")
  const key = body?.dataset.contactOptionsScroll
  if (!body || !key) {
    return
  }

  ui.contactOptionsScrollTops[key] = body.scrollTop
}

/** @returns 无返回值；重绘后恢复联系人话题/动作选项滚动位置。 */
function restoreContactOptionsScroll() {
  if (!ui.contactOpen) {
    return
  }

  const body = dom.app.querySelector("[data-contact-options-scroll]")
  const key = body?.dataset.contactOptionsScroll
  if (!body || !key) {
    return
  }

  const top = ui.contactOptionsScrollTops[key]
  if (!Number.isFinite(top)) {
    return
  }

  /** @returns 无返回值；把保存的 scrollTop 写回选项容器。 */
  const apply = () => {
    body.scrollTop = top
  }
  apply()
  window.requestAnimationFrame(apply)
}

/** @returns 无返回值；为本次 render 产生的三个滚动容器绑定被动监听器。 */
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

  dom.app.querySelectorAll("[data-contact-thread-scroll]").forEach((element) => {
    element.addEventListener("scroll", () => {
      const roleKey = element.dataset.contactThreadScroll
      if (!roleKey) {
        return
      }
      ui.contactThreadScrollTops[roleKey] = element.scrollTop
    }, { passive: true })
  })

  dom.app.querySelectorAll("[data-contact-options-scroll]").forEach((element) => {
    element.addEventListener("scroll", () => {
      const key = element.dataset.contactOptionsScroll
      if (!key) {
        return
      }
      ui.contactOptionsScrollTops[key] = element.scrollTop
    }, { passive: true })
  })
}

/** @param thread 联系人消息线程。 @returns 由消息数和最后消息 id 组成的轻量变化键。 */
function getContactThreadMessageKey(thread) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : []
  const lastMessage = messages.at(-1)
  return `${messages.length}:${lastMessage?.id ?? ""}`
}

/** @param roleKey 联系人键。 @param thread 最新线程。 @param force 是否强制。 @returns 无返回值；消息变化时标记下次渲染滚到底部。 */
function updateContactThreadAutoScroll(roleKey, thread, { force = false } = {}) {
  if (!roleKey) {
    return
  }

  const nextKey = getContactThreadMessageKey(thread)
  const previousKey = ui.contactThreadLastMessageKeys[roleKey]
  ui.contactThreadLastMessageKeys[roleKey] = nextKey

  if (force || previousKey === undefined || previousKey !== nextKey) {
    ui.contactThreadAutoScrollRoleKeys[roleKey] = true
  }
}

/** @param roleKey 联系人键。 @param options 可含 forceScroll。 @returns 服务端最新线程，并同步自动滚动状态。 */
async function fetchContactThread(roleKey, options = {}) {
  const result = await api(`/api/contact/thread?roleKey=${encodeURIComponent(roleKey)}`, { method: "GET" })
  updateContactThreadAutoScroll(roleKey, result.thread, { force: Boolean(options.forceScroll) })
  ui.thread = result.thread
  return result.thread
}

/** @param options 线程加载选项。 @returns 当前选中线程；联系人抽屉未打开或未选联系人时返回 null。 */
async function refreshSelectedContactThread(options = {}) {
  if (!ui.contactOpen || !ui.selectedRoleKey) {
    return null
  }

  return fetchContactThread(ui.selectedRoleKey, options)
}

/** @param panel notifications/variables/scheduler/bags/doing/shop 之一。 @returns 无返回值；关闭联系人抽屉并打开对应工具面板。 */
function openMenuPanel(panel) {
  if (ui.menuPanel !== panel) {
    ui.menuPanelScrollTops[panel] = 0
  }
  ui.contactOpen = false
  ui.menuPanel = panel
  render()
}

/** @returns 无返回值；关闭菜单、联系人抽屉和建档浮层，回到主游戏画面。 */
function returnToMainView() {
  ui.contactOpen = false
  ui.menuPanel = null
  ui.selectedRoleKey = null
  ui.thread = null
  ui.createOpen = false
  ui.screen = "profiles"
  render()
}

/**
 * 调用当前故事命名空间下的 JSON API。
 * @param path `/api/...` 路径。 @param options method 和可选 body。 @returns 解析后的 payload。
 * @throws HTTP 非成功或 payload.ok 为 false 时抛出服务端错误信息。
 */
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

/** @param label 成功 toast 文本。 @param handler 异步任务。 @returns handler 结果；统一管理 busy、状态更新和错误 toast。 */
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

/** @returns 最新客户端状态；从服务端读取后立即重绘。 */
async function refreshState() {
  const result = await api("/api/state", { method: "GET" })
  ui.data = result
  render()
}

/** @returns 启动 API 结果；同步 bundle/档案后切到档案页面。 */
async function bootstrap() {
  await runTask("客户端已启动", async () => {
    const result = await api("/api/bootstrap")
    ui.data = result
    ui.screen = "profiles"
    return result
  })
}

/** @returns 重新编译故事后的客户端状态；同时清空旧建角字段缓存。 */
async function syncStoryBundle() {
  const result = await api("/api/sync-story-bundle")
  ui.data = result
  ui.prompts = []
  return result
}

/** @param force 是否忽略已有缓存。 @returns 无返回值；加载玩家覆盖表单字段到 ui.prompts。 */
async function loadPrompts({ force = false } = {}) {
  if (!force && ui.prompts.length > 0) {
    return
  }

  const result = await api("/api/player-prompts", { method: "GET" })
  ui.prompts = result.prompts ?? []
}

/**
 * 根据当前 ui 状态重建页面 HTML，并重新绑定事件和恢复滚动位置。
 * @returns 无返回值。重绘前先记住滚动，避免 innerHTML 替换节点后用户阅读位置跳动。
 */
function render() {
  const activeShopGiftSearch = document.activeElement?.matches?.("[data-shop-gift-search]")
    ? {
        productId: document.activeElement.dataset.shopGiftSearch,
        selectionStart: document.activeElement.selectionStart,
        selectionEnd: document.activeElement.selectionEnd
      }
    : null

  rememberMenuPanelScroll()
  rememberContactThreadScroll()
  rememberContactOptionsScroll()

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
  restoreContactThreadScroll()
  restoreContactOptionsScroll()

  if (activeShopGiftSearch) {
    const input = Array.from(dom.app.querySelectorAll("[data-shop-gift-search]"))
      .find((element) => element.dataset.shopGiftSearch === activeShopGiftSearch.productId)
    input?.focus()
    input?.setSelectionRange(
      activeShopGiftSearch.selectionStart ?? input.value.length,
      activeShopGiftSearch.selectionEnd ?? input.value.length
    )
  }
}

/** @param action Runtime 交互动作。 @returns 服务端动作结果；提交后刷新状态/联系人线程并统一处理错误。 */
async function dispatchRuntimeAction(action) {
  setBusy(true)
  try {
    const result = await api("/api/session/action", { body: { action } })
    ui.data = result
    if (ui.contactOpen && ui.selectedRoleKey) {
      await loadContactThread(ui.selectedRoleKey)
    } else {
      render()
    }
    return result
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error")
    throw error
  } finally {
    setBusy(false)
  }
}

/** @param roleKey 联系人键。 @param options 加载选项。 @returns 无返回值；读取线程后重绘联系人抽屉。 */
async function loadContactThread(roleKey, options = {}) {
  await fetchContactThread(roleKey, options)
  render()
}

/** @param roleKey 联系人键。 @returns 无返回值；先标记服务端消息已读，再加载并强制滚到最新消息。 */
async function openContactThread(roleKey) {
  ui.selectedRoleKey = roleKey
  await api("/api/session/action", {
    body: {
      action: { type: "contact-mark-read", roleKey }
    }
  }).then((result) => {
    ui.data = result
  })
  await loadContactThread(roleKey, { forceScroll: true })
}

/** @returns 无返回值；打开联系人抽屉并优先选活动剧情联系人、上次联系人或第一联系人。 */
async function openContactDrawer() {
  ui.menuPanel = null
  ui.contactOpen = true
  const activeConversation = getActiveContactConversation()
  const fallbackRoleKey = ui.selectedRoleKey
    ?? activeConversation?.roleKey
    ?? ui.data?.contacts?.[0]?.roleKey
    ?? null

  if (fallbackRoleKey) {
    await openContactThread(fallbackRoleKey)
    return
  }

  render()
}

/** @returns 无返回值；询问槽名，用户未取消时保存当前会话。 */
async function saveGame() {
  const defaultSlot = `slot-${(ui.data?.saveSlots?.length ?? 0) + 1}`
  const slotId = window.prompt("保存到哪个存档？", defaultSlot)
  if (slotId === null) {
    return
  }
  await runTask("进度已保存", async () => api("/api/session/save", { body: { slotId } }))
}

/** @returns 无返回值；调用调试 API 推进一天，并刷新可能产生主动消息的联系人线程。 */
async function advanceDay() {
  await runTask("已推进到下一天", async () => {
    const result = await api("/api/session/advance-day")
    ui.data = result
    await refreshSelectedContactThread()
    return result
  })
}

/** @param key 键盘字符。 @returns 1–9 成功选择当前互动选项时为 true，否则 false。 */
async function selectInteractionOptionByNumber(key) {
  if (ui.contactOpen || ui.menuPanel) {
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

/** @returns 无返回值；若会话空闲则向服务端提交固定帧 tick，并防止请求重入。 */
async function tick() {
  if (!ui.data?.hasSession || ui.tickInFlight) {
    return
  }

  ui.tickInFlight = true
  try {
    const result = await api("/api/session/tick", { body: { deltaMs: 1000 } })
    ui.data = result
    await refreshSelectedContactThread()
    render()
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error")
  } finally {
    ui.tickInFlight = false
  }
}

/**
 * 为当前 render 生成的按钮、表单和菜单节点绑定事件。
 * @returns 无返回值；节点每次由 innerHTML 重建，所以监听器也在每次 render 后重新绑定。
 */
function bindEvents() {
  bindGiftEvents({ dispatchRuntimeAction, render, showToast })

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
      } else if (action === "open-contact") {
        await openContactDrawer()
      } else if (action === "close-contact") {
        ui.contactOpen = false
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

  dom.app.querySelectorAll("[data-history-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.historyFilter = button.dataset.historyFilter ?? "all"
      render()
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

  dom.app.querySelectorAll("[data-shop-category]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.selectedShopCategoryId = button.dataset.shopCategory
      ui.selectedShopGiftProductId = null
      render()
    })
  })

  dom.app.querySelectorAll("[data-shop-buy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await dispatchRuntimeAction({ type: "shop-buy", productId: button.dataset.shopBuy })
    })
  })

  dom.app.querySelectorAll("[data-shop-gift-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const productId = button.dataset.shopGiftToggle
      const opening = ui.selectedShopGiftProductId !== productId
      ui.selectedShopGiftProductId = opening ? productId : null
      if (opening) {
        ui.shopGiftSearchQueries[productId] = ""
        delete ui.shopGiftSelectedRoleKeys[productId]
      }
      render()
      if (opening) {
        dom.app.querySelector("[data-shop-gift-search]")?.focus()
      }
    })
  })

  dom.app.querySelectorAll("[data-shop-gift-search]").forEach((input) => {
    input.addEventListener("input", () => {
      const productId = input.dataset.shopGiftSearch
      ui.shopGiftSearchQueries[productId] = input.value
      delete ui.shopGiftSelectedRoleKeys[productId]
      filterShopGiftTargetOptions(input)
    })
  })

  dom.app.querySelectorAll("[data-shop-gift-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const productId = button.dataset.shopGiftTarget
      ui.shopGiftSelectedRoleKeys[productId] = button.dataset.shopGiftRole
      ui.shopGiftSearchQueries[productId] = button.dataset.shopGiftLabel
      render()
    })
  })

  dom.app.querySelectorAll("[data-shop-gift-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      await dispatchRuntimeAction({
        type: "shop-gift",
        productId: button.dataset.shopGiftConfirm,
        roleKey: button.dataset.shopGiftRole
      })
      delete ui.shopGiftSelectedRoleKeys[button.dataset.shopGiftConfirm]
      delete ui.shopGiftSearchQueries[button.dataset.shopGiftConfirm]
      ui.selectedShopGiftProductId = null
      render()
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

  dom.app.querySelectorAll("[data-contact-contact]").forEach((button) => {
    button.addEventListener("click", async () => {
      rememberContactThreadScroll()
      rememberContactOptionsScroll()
      await openContactThread(button.dataset.contactContact)
    })
  })

  dom.app.querySelectorAll("[data-contact-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      rememberContactThreadScroll()
      rememberContactOptionsScroll()
      ui.contactMode = button.dataset.contactMode
      render()
    })
  })

  dom.app.querySelectorAll("[data-contact-talk]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!ui.selectedRoleKey) return
      await dispatchRuntimeAction({ type: "contact-send-talk", roleKey: ui.selectedRoleKey, talkId: button.dataset.contactTalk })
      await dispatchRuntimeAction({ type: "contact-mark-read", roleKey: ui.selectedRoleKey })
    })
  })

  dom.app.querySelectorAll("[data-contact-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!ui.selectedRoleKey) return
      await dispatchRuntimeAction({ type: "contact-send-action", roleKey: ui.selectedRoleKey, actionId: button.dataset.contactAction })
      await dispatchRuntimeAction({ type: "contact-mark-read", roleKey: ui.selectedRoleKey })
    })
  })

  dom.app.querySelectorAll("[data-contact-conversation-reply]").forEach((button) => {
    button.addEventListener("click", async () => {
      await dispatchRuntimeAction({
        type: "contact-select-conversation-reply",
        optionId: button.dataset.contactConversationReply
      })
      if (ui.selectedRoleKey) {
        await dispatchRuntimeAction({ type: "contact-mark-read", roleKey: ui.selectedRoleKey })
      }
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
  } else if (key === "c") {
    if (ui.contactOpen) {
      ui.contactOpen = false
      ui.selectedRoleKey = null
      ui.thread = null
      render()
    } else {
      await openContactDrawer()
    }
  } else if (key === " ") {
    event.preventDefault()
    await runTask("时间状态已更新", async () => api("/api/session/time", { body: { paused: !ui.data.summary.paused } }))
  } else if (key === "n") {
    await advanceDay()
  } else if (key === "d") {
    openMenuPanel("doing")
  } else if (key === "m") {
    openMenuPanel("shop")
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
