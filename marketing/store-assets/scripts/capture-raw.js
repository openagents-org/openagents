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
  // floating "New messages" scroll pill — appears once we scroll to top
  for (const el of Array.from(document.querySelectorAll('button,div,span'))) {
    const txt = (el.textContent || '').trim();
    if ((txt === 'New messages' || txt === '↓ New messages') && el.childElementCount <= 2) {
      (el.closest('button') || el).remove();
    }
  }
});
const scrollTop = (page) => page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('div')).filter(e =>
    e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY));
  els.sort((a, b) => b.scrollHeight - a.scrollHeight);
  if (els[0]) els[0].scrollTop = 0;
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

  // ── phone: thread scenes scrolled to conversation start ──
  let page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const phone = [
    ['phone-dealer-thread', cases.dealer, cases.dealer.title],
    ['phone-dsp-thread', cases.dsp, cases.dsp.title],
    ['phone-gpu-thread', cases.gpu, cases.gpu.title],
    ['phone-finance-thread', cases.finance, cases.finance.title],
    ['phone-enterprise-thread', cases.enterprise, cases.enterprise.title],
  ];
  for (const [name, ws, title] of phone) {
    await openWs(page, ws);
    await clickText(page, 'Threads');
    await clickText(page, title, false);
    await scrollTop(page);
    await page.waitForTimeout(700);
    await scrub(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  }
  await page.close();

  // ── tablet: dense 1024x840 landscape captures ──
  page = await browser.newPage({ viewport: { width: 1024, height: 840 }, deviceScaleFactor: 2 });
  const tablet = [
    ['tablet-dealer-thread', cases.dealer, cases.dealer.title],
    ['tablet-dsp-thread', cases.dsp, cases.dsp.title],
    ['tablet-projects', cases.dealer, 'Supplier quotes'],
    ['tablet-gpu-thread', cases.gpu, cases.gpu.title],
    ['tablet-enterprise-thread', cases.enterprise, cases.enterprise.title],
    ['tablet-finance-thread', cases.finance, cases.finance.title],
  ];
  for (const [name, ws, title] of tablet) {
    await openWs(page, ws);
    await clickText(page, title, false);
    await scrollTop(page);
    await page.waitForTimeout(700);
    await scrub(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  }
  await browser.close();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
