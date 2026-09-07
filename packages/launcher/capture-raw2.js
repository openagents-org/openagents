const { chromium } = require('playwright-core');
const fs = require('fs'); const os = require('os');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1237/chrome-headless-shell-linux64/chrome-headless-shell';
const cases = JSON.parse(fs.readFileSync(os.homedir() + '/store-assets/case-ws.json', 'utf8'));
const OUT = os.homedir() + '/store-assets/raw';
const scrub = (page) => page.evaluate(() => {
  const needle = 'No agent in this thread is online';
  for (const el of Array.from(document.querySelectorAll('span,p'))) {
    if (el.childElementCount === 0 && (el.textContent || '').includes(needle)) {
      const row = el.closest('.group');
      if (row) row.remove(); else if (el.parentElement) el.parentElement.remove();
    }
  }
});
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2 });
  for (const [name, ws] of [
    ['tablet-finance-thread', cases.finance],
    ['tablet-gpu-thread', cases.gpu],
    ['tablet-enterprise-thread', cases.enterprise],
  ]) {
    await page.goto(`https://workspace.openagents.org/${ws.slug}?token=${ws.token}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);
    try { await page.getByText(ws.title, { exact: false }).first().click(); await page.waitForTimeout(2200); } catch (e) { console.log('nav fail', name); }
    await scrub(page); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
