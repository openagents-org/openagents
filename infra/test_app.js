// Playwright test for OpenAgents Launcher via CDP
// Usage: node test_app.js

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];
  const results = [];

  // Test 1: App title
  const title = await page.title();
  results.push({ test: 'App launches', pass: title.includes('OpenAgents'), detail: title });

  // Test 2: Dashboard tab
  await page.click('[data-tab="dashboard"]');
  await page.waitForTimeout(2000);
  const dashText = await page.textContent('body');
  results.push({ test: 'Dashboard works', pass: dashText.includes('Daemon'), detail: '' });
  await page.screenshot({ path: 'screenshot_dashboard.png' });

  // Test 3: Install tab
  await page.click('[data-tab="install"]');
  await page.waitForTimeout(2000);
  const installText = await page.textContent('body');
  results.push({ test: 'Install tab', pass: installText.includes('Claude Code') && installText.includes('OpenClaw'), detail: '' });
  await page.screenshot({ path: 'screenshot_install.png' });

  // Test 4: Click Install on OpenClaw
  const rows = await page.$$('.catalog-row');
  let clicked = false;
  for (const row of rows) {
    const text = await row.textContent();
    if (text.includes('OpenClaw')) {
      const btn = await row.$('button');
      if (btn) {
        const btnText = await btn.textContent();
        if (btnText.trim() === 'Install') {
          await btn.click();
          await page.waitForTimeout(2000);
          const confirmBtn = await page.$('#confirm-install-yes');
          if (confirmBtn) await confirmBtn.click();
          clicked = true;
        } else {
          results.push({ test: 'OpenClaw install', pass: true, detail: 'Already installed' });
        }
      }
      break;
    }
  }
  if (clicked) {
    results.push({ test: 'OpenClaw install clicked', pass: true, detail: '' });

    // Wait for install (up to 15 min — Node.js download + npm install can be slow)
    let installDone = false;
    for (let i = 0; i < 180; i++) {
      await page.waitForTimeout(5000);
      const bodyText = await page.textContent('body');
      if (bodyText.includes('Done!') || bodyText.includes('Error')) {
        const success = bodyText.includes('Done!') && !bodyText.includes('Error');
        results.push({ test: 'OpenClaw install completes', pass: success, detail: bodyText.slice(-200) });
        installDone = true;
        break;
      }
      if (i % 6 === 0) console.log('  ... waiting ' + ((i + 1) * 5) + 's');
    }
    if (!installDone) {
      results.push({ test: 'OpenClaw install completes', pass: false, detail: 'Timeout after 15 min' });
    }
    await page.screenshot({ path: 'screenshot_install_result.png' });
  }

  // Test 5: Logs tab
  await page.click('[data-tab="logs"]');
  await page.waitForTimeout(1000);
  const logsText = await page.textContent('body');
  results.push({ test: 'Logs tab', pass: logsText.includes('Logs'), detail: '' });

  // Test 6: Settings tab
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(1000);
  const settingsText = await page.textContent('body');
  results.push({ test: 'Settings tab', pass: settingsText.includes('Settings'), detail: '' });
  await page.screenshot({ path: 'screenshot_settings.png' });

  // Print results
  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    console.log(icon + ' ' + r.test + (r.detail ? ' -- ' + r.detail : ''));
    if (r.pass) passed++; else failed++;
  }
  console.log('\nResults: ' + passed + '/' + results.length + ' passed, ' + failed + ' failed');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
