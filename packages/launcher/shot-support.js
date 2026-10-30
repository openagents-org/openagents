const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://localhost:3462/support', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/support-en.png', fullPage: true });
  await page.goto('http://localhost:3462/privacy', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/privacy-top.png' });
  await browser.close();
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
