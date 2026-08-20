'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

/**
 * The watchdog exists for installers that go silent and never come back —
 * hermes's install.sh polling for the macOS developer tools was the case that
 * prompted it, but the shape is general. These tests drive a real spawn with a
 * very short stall budget rather than faking timers, because what matters is
 * that the process tree actually dies.
 */
function loadInstallerWithStall(ms) {
  process.env.OPENAGENTS_INSTALL_STALL_MS = String(ms);
  // The stall budget is read once at module load.
  delete require.cache[require.resolve('../src/installer')];
  const { Installer } = require('../src/installer');
  return Installer;
}

function makeInstaller(Installer, command) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-stall-'));
  const registry = {
    getEntry: () => ({
      label: 'Silent Agent',
      install: { binary: 'silent', macos: command, linux: command, windows: command },
    }),
  };
  const installer = new Installer(registry, configDir);
  return { installer, configDir };
}

const isWindows = process.platform === 'win32';

/**
 * Wait for a pid to disappear, or give up.
 *
 * Signal delivery is asynchronous: the watchdog rejects as soon as it has
 * signalled, so asserting immediately is a race the test would lose on a slow
 * machine. Polling keeps the assertion meaningful — a process that is genuinely
 * never killed still fails, it just gets a few seconds to prove it.
 */
async function waitForExit(pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true; // ESRCH — gone
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test('a silent installer is killed and reported, not waited on forever', { skip: isWindows }, async () => {
  const Installer = loadInstallerWithStall(1500);
  // Prints once, then goes quiet for far longer than any patience we have.
  //
  // The grandchild records its OWN pid so the assertion below can check that
  // exact process. Matching on a command line instead (pgrep/ps) is unreliable:
  // the shell running the search has the search string in its own argv, so it
  // matches itself — green on macOS, red on Linux, for reasons having nothing
  // to do with the code under test.
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-stall-pid-'));
  const pidFile = path.join(configDir, 'child.pid');
  const { installer } = makeInstaller(
    Installer,
    `echo starting; sleep 120 & echo $! > "${pidFile}"; wait`,
  );

  const chunks = [];
  const started = Date.now();
  await assert.rejects(
    () => installer.installStreaming('silent', (d) => chunks.push(d)),
    (err) => /no output for/i.test(err.message),
  );
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 10000, `should give up quickly, took ${elapsed}ms`);
  assert.match(chunks.join(''), /starting/);
  assert.match(chunks.join(''), /Install stalled/);

  // The point of the process-group kill: the shell's CHILD (the sleep) has to
  // die too. Signalling only the direct child leaves the real work running,
  // which is exactly the "download that never returns" case this guards.
  const childPid = Number(fs.readFileSync(pidFile, 'utf-8').trim());
  assert.ok(Number.isInteger(childPid) && childPid > 0, 'grandchild pid not recorded');
  assert.strictEqual(
    await waitForExit(childPid),
    true,
    `grandchild ${childPid} survived the kill`,
  );
});

test('an installer that keeps talking is left alone', { skip: isWindows }, async () => {
  const Installer = loadInstallerWithStall(2000);
  // Output every 300ms for ~1.5s: never silent long enough to trip the watchdog.
  const { installer } = makeInstaller(
    Installer,
    'for i in 1 2 3 4 5; do echo tick $i; sleep 0.3; done',
  );

  const chunks = [];
  const result = await installer.installStreaming('silent', (d) => chunks.push(d));
  assert.strictEqual(result.success, true);
  assert.match(chunks.join(''), /tick 5/);
});

test('the stall budget is configurable and can be switched off', () => {
  process.env.OPENAGENTS_INSTALL_STALL_MS = '0';
  delete require.cache[require.resolve('../src/installer')];
  assert.doesNotThrow(() => require('../src/installer'));
  delete process.env.OPENAGENTS_INSTALL_STALL_MS;
  delete require.cache[require.resolve('../src/installer')];
});

test.after(() => {
  delete process.env.OPENAGENTS_INSTALL_STALL_MS;
  delete require.cache[require.resolve('../src/installer')];
});
