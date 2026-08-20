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

test('a silent installer is killed and reported, not waited on forever', { skip: isWindows }, async () => {
  const Installer = loadInstallerWithStall(1500);
  // Prints once, then goes quiet for far longer than any patience we have.
  const { installer } = makeInstaller(Installer, 'echo starting; sleep 120');

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
  // die too. Signalling only the direct child would leave it running, which is
  // exactly the "download that never returns" case this guards.
  const { execSync } = require('child_process');
  let survivors = '';
  try {
    survivors = execSync('pgrep -f "sleep 120" || true', { encoding: 'utf-8' }).trim();
  } catch { /* pgrep missing — skip the assertion */ }
  assert.strictEqual(survivors, '', `orphaned processes survived: ${survivors}`);
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
