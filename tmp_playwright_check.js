const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000/editor/demo', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: '一次性大事件' }).click();
  const createButtons = await page.getByRole('button', { name: '创建事件' }).all();
  await createButtons[0].click();
  await page.screenshot({ path: 'tmp_big_once_modal.png', fullPage: true });
  const modal = await page.locator('.editor-modal__panel').boundingBox();
  const panel = await page.locator('.detail-panel').boundingBox();
  console.log(JSON.stringify({ modal, panel }));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
