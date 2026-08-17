/**
 * 浏览器共享状态：保存当前路由、服务端数据和各面板的临时 UI 选择。
 * 此模块不发请求、不绑定事件，刷新页面后这些临时状态会自然重置。
 */
export const dom = {
  app: document.querySelector("#app"),
  toast: document.querySelector("#toast")
}

export const routeStorySegment = window.location.pathname.split("/").filter(Boolean)[0] ?? ""
export const route = {
  storyId: decodeURIComponent(routeStorySegment),
  basePath: routeStorySegment ? `/${encodeURIComponent(routeStorySegment)}` : ""
}

export const ui = {
  data: null,
  busy: false,
  screen: "auto",
  menuPanel: null,
  historyFilter: "all",
  selectedDoingMenuId: null,
  selectedShopCategoryId: null,
  selectedShopGiftProductId: null,
  shopGiftSelectedRoleKeys: {},
  shopGiftSearchQueries: {},
  bagGiftOpenItemId: null,
  bagGiftDrafts: {},
  contactGiftDrafts: {},
  menuPanelScrollTops: {},
  contactThreadScrollTops: {},
  contactOptionsScrollTops: {},
  contactThreadLastMessageKeys: {},
  contactThreadAutoScrollRoleKeys: {},
  createOpen: false,
  prompts: [],
  contactOpen: false,
  contactMode: "talk",
  selectedRoleKey: null,
  thread: null,
  tickInFlight: false,
  toastTimer: 0
}

/** @param value 要插入 HTML 的任意值。 @returns 转义 &, <, >, 引号后的安全文本。 */
export function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

/** @returns 当前 Runtime 行动视图；数据尚未加载时返回空菜单和行动数组。 */
export function getDoingView() {
  return ui.data?.view?.doing ?? { menus: [], doings: [] }
}

/** @returns 当前商店视图；尚未加载时返回使用 player.money 的空商店。 */
export function getShopView() {
  return ui.data?.view?.shop ?? { currencyValueKey: "player.money", categories: [], products: [] }
}

/** @returns 尚未结束的结构化联系人剧情视图；没有或已结束时为 null。 */
export function getActiveContactConversation() {
  const conversation = ui.data?.view?.contactConversation ?? null
  return conversation && !conversation.finished ? conversation : null
}

/** @param menus 当前可见行动菜单。 @returns 仍有效的已选 id，否则选择并返回第一项；会更新 ui。 */
export function getSelectedDoingMenu(menus) {
  if (menus.some((menu) => menu.id === ui.selectedDoingMenuId)) {
    return ui.selectedDoingMenuId
  }

  const firstMenuId = menus[0]?.id ?? null
  ui.selectedDoingMenuId = firstMenuId
  return firstMenuId
}

/** @param categories 当前可见商店分类。 @returns 仍有效的已选 id，否则选择并返回第一项；会更新 ui。 */
export function getSelectedShopCategory(categories) {
  if (categories.some((category) => category.id === ui.selectedShopCategoryId)) {
    return ui.selectedShopCategoryId
  }

  const firstCategoryId = categories[0]?.id ?? null
  ui.selectedShopCategoryId = firstCategoryId
  return firstCategoryId
}
