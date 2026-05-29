const { test } = require('@playwright/test');

test('capture big once modal', async ({ page }) => {
  await page.goto('http://localhost:3000/editor/demo', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: '一次性大事件' }).click();
  const createButtons = await page.getByRole('button', { name: '创建事件' }).all();
  await createButtons[0].click();
  await page.screenshot({ path: 'tmp_big_once_modal.png', fullPage: true });
  const modal = await page.locator('.editor-modal__panel').boundingBox();
  const panel = await page.locator('.detail-panel').boundingBox();
  console.log('BOUNDING_BOXES=' + JSON.stringify({ modal, panel }));
});
