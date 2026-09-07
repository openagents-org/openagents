const { chromium } = require('playwright-core');
const fs = require('fs'); const os = require('os');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1237/chrome-headless-shell-linux64/chrome-headless-shell';
const cases = JSON.parse(fs.readFileSync(os.homedir() + '/store-assets/case-ws.json', 'utf8'));
const ws = cases.dealer;
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(`https://workspace.openagents.org/${ws.slug}?token=${ws.token}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.getByText('Files', { exact: true }).first().click();
  await page.waitForTimeout(2000);
  await page.getByText('uploaded_files', { exact: false }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: os.homedir() + '/store-assets/raw/phone-files.png' });
  console.log('ok');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
