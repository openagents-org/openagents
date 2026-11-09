'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Keep _runAgn's real spawning/timeout logic, but run a local fixture in
// place of the CLI. Other commands (notably taskkill) run unchanged.
const wslPath = require.resolve('../src/wsl');
const wsl = require(wslPath);
let fixture;
let wrapper;
require.cache[wslPath].exports = {
  ...wsl,
  spawn(file, args, opts) {
    if (file !== process.execPath) return cp.spawn(file, args, opts);
    wrapper = cp.spawn(file, ['-e', fixture], opts);
    return wrapper;
  },
};
const { Daemon } = require('../src/daemon');
require.cache[wslPath].exports = wsl;

it('_runAgn timeout stops the CLI descendant as well as its wrapper', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-timeout-'));
  const heartbeat = path.join(dir, 'heartbeat');
  const pidFile = path.join(dir, 'pid');
  const child = `
    const fs = require('fs');
    fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    process.on('SIGTERM', () => {});
    setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, '.'), 20);
  `;
  fixture = `
    const cp = require('child_process');
    cp.spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' });
  `;
  try {
    const result = await Daemon.prototype._runAgn.call({}, ['runtimes', '--json'], { timeoutMs: 5000 });
    assert.equal(result.timedOut, true);
    assert.ok(fs.existsSync(pidFile), 'the descendant started before the timeout');
    // taskkill is asynchronous on Windows and can take over a second on a
    // busy runner, so wait for the heartbeat to go quiet instead of sampling
    // it once. Activity, not PID existence (zombies retain PIDs on Linux).
    assert.ok(fs.statSync(heartbeat).size > 0, 'the descendant was active before the timeout');
    const deadline = Date.now() + 6000;
    let quiet = false;
    while (!quiet && Date.now() < deadline) {
      const size = fs.statSync(heartbeat).size;
      await new Promise((resolve) => setTimeout(resolve, 300));
      quiet = fs.statSync(heartbeat).size === size;
    }
    assert.ok(quiet, 'the descendant kept running after timeout');
  } finally {
    if (wrapper) { try { wrapper.kill('SIGKILL'); } catch {} }
    if (fs.existsSync(pidFile)) {
      try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {}
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
