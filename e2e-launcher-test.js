/**
 * E2E test for OpenAgents Launcher — drives the Electron app via CDP.
 *
 * Steps:
 *   1. Connect to Electron via CDP
 *   2. Install tab → Install OpenClaw (if needed)
 *   3. Dashboard → Create Agent
 *   4. Configure LLM API key
 *   5. Connect to workspace
 *   6. Start agent
 *   7. Send message via workspace
 *   8. Verify agent responds
 */
const http = require('http');
const https = require('https');
const WebSocket = require('ws');

const CDP_PORT = process.env.CDP_PORT || 9333;
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const LLM_MODEL = process.env.LLM_MODEL;
const WS_TOKEN = process.env.WS_TOKEN;
const WS_SLUG = 'c5be7aa2';

let ws;
let msgId = 1;
const pending = {};

// ── CDP helpers ──────────────────────────────────────────────────────────────

async function getCdpTarget() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        const targets = JSON.parse(data);
        const page = targets.find((t) => t.type === 'page');
        resolve(page.webSocketDebuggerUrl);
      });
    }).on('error', reject);
  });
}

async function connectCdp() {
  const wsUrl = await getCdpTarget();
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl, { maxPayload: 50 * 1024 * 1024 });
    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id && pending[msg.id]) {
        pending[msg.id](msg);
        delete pending[msg.id];
      }
    });
  });
}

function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const timeout = setTimeout(() => {
      delete pending[id];
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending[id] = (msg) => {
      clearTimeout(timeout);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    };
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdpSend('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Eval error');
  }
  return result.result?.value;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function screenshot(name) {
  const { data } = await cdpSend('Page.captureScreenshot', { format: 'png' });
  const fs = require('fs');
  const path = require('path');
  const dir = process.env.GITHUB_WORKSPACE
    ? path.join(process.env.GITHUB_WORKSPACE, 'e2e-screenshots')
    : 'e2e-screenshots';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  📸 ${name}.png`);
}

// ── Test steps ───────────────────────────────────────────────────────────────

async function step(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log('✅');
  } catch (e) {
    console.log(`❌ ${e.message}`);
    try { await screenshot(`FAIL-${name.replace(/\s+/g, '-')}`); } catch {}
    throw e;
  }
}

async function clickTab(tabName) {
  await evaluate(`document.querySelector('[data-tab="${tabName}"]').click()`);
  await sleep(2000);
}

async function clickButtonByText(text) {
  await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === '${text}') {
          btns[i].click();
          return 'clicked';
        }
      }
      throw new Error('Button "${text}" not found');
    })()
  `);
  await sleep(2000);
}

async function getBodyText() {
  return evaluate('document.body.innerText');
}

async function waitForText(text, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const body = await getBodyText();
    if (body.includes(text)) return body;
    await sleep(3000);
  }
  throw new Error(`Timeout waiting for "${text}"`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 OpenAgents Launcher E2E Test\n');

  // Connect to Electron via CDP
  await step('Connect to Electron via CDP', async () => {
    await connectCdp();
    const title = await evaluate('document.title');
    if (!title.includes('OpenAgents')) throw new Error(`Unexpected title: ${title}`);
  });

  await screenshot('01-launch');

  // Step 1: Verify app loaded
  await step('App loaded', async () => {
    const text = await getBodyText();
    if (!text.includes('Dashboard')) throw new Error('Dashboard not found');
  });

  // Step 2: Go to Install tab, install OpenClaw if needed
  await step('Install OpenClaw via UI', async () => {
    await clickTab('install');
    await sleep(2000);
    const text = await getBodyText();

    if (text.includes('OpenClaw') && text.includes('INSTALLED')) {
      console.log('(already installed) ');
      return;
    }

    // Find and click Install on OpenClaw row
    await evaluate(`
      (function() {
        var rows = document.querySelectorAll('.catalog-row');
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].textContent.includes('OpenClaw')) {
            rows[i].querySelector('button').click();
            return 'clicked';
          }
        }
        throw new Error('OpenClaw not found in catalog');
      })()
    `);
    await sleep(2000);

    // Click Install in confirm dialog
    var confirmBtn = await evaluate(`
      (function() {
        var btn = document.getElementById('confirm-install-yes');
        if (btn) { btn.click(); return 'confirmed'; }
        // Try any Install button in overlay
        var btns = document.querySelectorAll('.confirm-overlay button, .modal button');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].textContent.trim() === 'Install') { btns[i].click(); return 'confirmed'; }
        }
        throw new Error('Confirm button not found');
      })()
    `);

    // Wait for install to complete (up to 3 minutes)
    await waitForText('Back to Install', 180000);
    await screenshot('02-openclaw-installed');

    // Click Back to Install
    await clickButtonByText('Back to Install');
  });

  // Step 3: Go to Dashboard, create agent
  await step('Create agent', async () => {
    await clickTab('dashboard');
    await sleep(2000);

    const text = await getBodyText();
    if (text.includes('openclaw') && (text.includes('stopped') || text.includes('running'))) {
      console.log('(agent exists) ');
      return;
    }

    // Click New Agent or Add Agent
    try {
      await clickButtonByText('New Agent');
    } catch {
      await clickButtonByText('Add Agent');
    }
    await sleep(2000);

    // Click Create (default type is openclaw)
    await clickButtonByText('Create');
    await sleep(3000);
  });

  await screenshot('03-agent-created');

  // Step 4: Configure LLM API key
  await step('Configure LLM', async () => {
    if (!LLM_API_KEY) throw new Error('LLM_API_KEY not set');

    // Use the API directly to save env vars
    await evaluate(`
      window.api.saveAgentEnv('openclaw', {
        LLM_API_KEY: '${LLM_API_KEY}',
        LLM_BASE_URL: '${LLM_BASE_URL || 'https://api.openai.com/v1'}',
        LLM_MODEL: '${LLM_MODEL || 'gpt-4o'}'
      })
    `);
    await sleep(1000);
  });

  // Step 5: Connect to workspace via UI
  await step('Connect to workspace', async () => {
    await clickTab('dashboard');
    await sleep(2000);

    // Click Actions on the agent card
    await evaluate(`
      (function() {
        var btn = document.querySelector('[data-action="actions"]');
        if (btn) { btn.click(); return 'clicked'; }
        throw new Error('Actions button not found');
      })()
    `);
    await sleep(2000);

    // Click Connect Workspace
    const connected = await evaluate(`
      (function() {
        var btns = document.querySelectorAll('.modal-action-btn, button');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].textContent.includes('Connect') && btns[i].dataset.action === 'connect') {
            btns[i].click();
            return 'clicked';
          }
        }
        // If no connect button, agent might already be connected
        return 'no-connect-btn';
      })()
    `);

    if (connected === 'clicked') {
      await sleep(2000);
      // Enter workspace token
      await evaluate(`
        (function() {
          var input = document.querySelector('#workspace-token-input, input[placeholder*="token"], input[type="text"]');
          if (input) {
            input.value = '${WS_TOKEN}';
            input.dispatchEvent(new Event('input', {bubbles: true}));
            return 'filled';
          }
          throw new Error('Token input not found');
        })()
      `);
      await sleep(1000);

      // Click Connect/Join
      try { await clickButtonByText('Connect'); } catch {
        try { await clickButtonByText('Join'); } catch {
          await clickButtonByText('Save');
        }
      }
      await sleep(3000);
    } else {
      // Use API fallback
      const agentName = await evaluate(`
        (function() {
          var cards = document.querySelectorAll('.agent-card');
          if (cards.length) return cards[0].querySelector('.agent-name')?.textContent?.trim();
          return null;
        })()
      `);
      if (agentName) {
        await evaluate(`window.api.connectWorkspace('${agentName}', '${WS_TOKEN}')`);
      }
    }

    // Close any modal
    try {
      await evaluate(`
        var overlay = document.querySelector('.modal-overlay, .confirm-overlay');
        if (overlay) overlay.click();
      `);
    } catch {}
    await sleep(2000);
  });

  await screenshot('04-connected');

  // Step 6: Start agent
  await step('Start agent', async () => {
    await clickTab('dashboard');
    await sleep(2000);

    await clickButtonByText('Start All');
    await sleep(15000); // Wait for daemon + adapter

    const text = await getBodyText();
    if (text.includes('running')) {
      return; // Good
    }
    // Wait more
    await sleep(15000);
  });

  await screenshot('05-agent-started');

  // Step 7: Send message via workspace
  await step('Send message via workspace', async () => {
    // Use the workspace API to send a message targeted at the agent
    const agentName = await evaluate(`
      (function() {
        var cards = document.querySelectorAll('.agent-card');
        if (cards.length) return cards[0].querySelector('.agent-name')?.textContent?.trim();
        return 'e2e-agent';
      })()
    `);

    const result = await evaluate(`
      fetch('https://workspace-endpoint.openagents.org/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Token': '${WS_TOKEN}'
        },
        body: JSON.stringify({
          type: 'workspace.message.posted',
          source: 'human:e2e-tester',
          target: 'openagents:' + '${agentName || "e2e-agent"}',
          network: '${WS_SLUG}',
          payload: { content: 'What is 9 plus 3? Reply with just the number.', message_type: 'chat' },
          metadata: {}
        })
      }).then(r => r.json()).then(d => JSON.stringify(d))
    `);

    const parsed = JSON.parse(result);
    if (parsed.code !== 0) throw new Error(`Workspace API error: ${result}`);
    console.log(`(sent to ${agentName}) `);
  });

  // Step 8: Wait for response
  await step('Wait for agent response (up to 120s)', async () => {
    // Poll the daemon log or status for a response
    const start = Date.now();
    while (Date.now() - start < 120000) {
      try {
        const log = await evaluate(`
          window.api.getLogs && window.api.getLogs().then(r => r.lines ? r.lines.join('\\n') : '')
        `);
        if (log && log.includes('responded')) {
          console.log(`(found response in ${Math.round((Date.now() - start) / 1000)}s) `);
          return;
        }
      } catch {}
      await sleep(5000);
    }
    throw new Error('No response within 120s');
  });

  await screenshot('06-response');

  // Done
  console.log('\n✅ All E2E tests passed!\n');
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n❌ E2E test failed: ${e.message}\n`);
  if (ws) ws.close();
  process.exit(1);
});
