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

async function openWs(page, ws) {
  await page.goto(`https://workspace.openagents.org/${ws.slug}?token=${ws.token}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
}
async function clickText(page, text, exact = true) {
  try { await page.getByText(text, { exact }).first().click(); await page.waitForTimeout(2000); return true; }
  catch (e) { console.log('  click fail:', text, e.message.split('\n')[0]); return false; }
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox'] });

  // ── phone pass ──
  let page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const phoneThreads = [
    ['phone-dealer-thread', cases.dealer, cases.dealer.title],
    ['phone-dsp-thread', cases.dsp, cases.dsp.title],
    ['phone-gpu-thread', cases.gpu, cases.gpu.title],
    ['phone-finance-thread', cases.finance, cases.finance.title],
  ];
  for (const [name, ws, title] of phoneThreads) {
    await openWs(page, ws);
    await clickText(page, 'Threads');
    await clickText(page, title, false);
    await scrub(page); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  }
  // threads list + files (dealer)
  await openWs(page, cases.dealer);
  await clickText(page, 'Threads');
  await page.screenshot({ path: `${OUT}/phone-threads-list.png` });
  console.log('shot phone-threads-list');
  await clickText(page, 'Files');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/phone-files.png` });
  console.log('shot phone-files');
  await page.close();

  // ── tablet pass ──
  page = await browser.newPage({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2 });
  const tabletScenes = [
    ['tablet-dealer-thread', cases.dealer, async () => { await clickText(page, 'Threads'); await clickText(page, cases.dealer.title, false); }],
    ['tablet-routines', cases.dealer, async () => { await clickText(page, 'Routines'); }],
    ['tablet-knowledge', cases.finance, async () => { await clickText(page, 'Knowledge'); }],
    ['tablet-tasks', cases.enterprise, async () => { await clickText(page, 'Tasks'); }],
    ['tablet-dsp-thread', cases.dsp, async () => { await clickText(page, 'Threads'); await clickText(page, cases.dsp.title, false); }],
    ['tablet-threads-list', cases.dealer, async () => { await clickText(page, 'Threads'); }],
  ];
  for (const [name, ws, nav] of tabletScenes) {
    await openWs(page, ws);
    // expand sidebar if collapsed
    try { const ex = page.getByLabel('Expand sidebar').first(); if (await ex.isVisible().catch(() => false)) { await ex.click(); await page.waitForTimeout(600); } } catch {}
    await nav();
    await scrub(page); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  }
  await browser.close();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
