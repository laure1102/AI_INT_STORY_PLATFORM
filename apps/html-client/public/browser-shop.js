/**
 * 按搜索词过滤当前赠礼好友下拉，并让已编辑的目标等待重新选择。
 * @param {HTMLInputElement} input 赠礼目标搜索框。 @returns 无返回值。
 */
export function filterShopGiftTargetOptions(input) {
  const picker = input.closest("[data-shop-gift-picker]")
  const normalizedQuery = input.value.trim().toLocaleLowerCase("zh-Hans-CN")
  let visibleCount = 0

  picker?.querySelectorAll("[data-shop-gift-search-text]").forEach((option) => {
    const matches = option.dataset.shopGiftSearchText
      .toLocaleLowerCase("zh-Hans-CN")
      .includes(normalizedQuery)
    option.hidden = !matches
    if (matches) {
      visibleCount += 1
    }
  })

  const empty = picker?.querySelector("[data-shop-gift-empty]")
  if (empty) {
    empty.hidden = visibleCount > 0
  }

  const confirm = picker?.querySelector("[data-shop-gift-confirm]")
  if (confirm) {
    confirm.disabled = true
    confirm.dataset.shopGiftRole = ""
  }
}
