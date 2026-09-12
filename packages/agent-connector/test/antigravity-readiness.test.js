'use strict';

/**
 * Antigravity sign-in detection — the "signed in as me@gmail.com in the CLI's
 * own header, 未登录 in the launcher" fix.
 *
 * agy has no auth/login/status subcommand (1.2.2 `--help` lists agent, models,
 * mcp, plugin, remote-control, update and nothing else), and its Google sign-in
 * leaves NOTHING on disk that names the account — ~/.gemini/antigravity-cli
 * holds settings, logs, conversations and caches only. The credential lives in
 * Windows Credential Manager as the generic target `gemini:antigravity`, which
 * is what these tests pin.
 *
 * No real agy, no cmdkey, no model call.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer, credentialListHasTarget } = require('../src/installer');

const mockRegistry = { getEntry: () => null, getResolveRules: () => [] };

/** The real registry entry, so the test fails if the fields are dropped. */
const ENTRY = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'),
).find((e) => e.name === 'antigravity');

let tmpDir;
let savedKey;

function evaluate(inst, savedEnv = {}) {
  inst.env.getEffective = () => savedEnv;
  return inst._evaluateReadiness('antigravity', ENTRY, '/fake/agy');
}

/**
 * An installer whose Windows-credential probe answers `has`.
 *
 * The platform guard stays at the call site in _checkCredsReady, mirroring the
 * macOS keychain tier, so the test has to stand on Windows to reach it.
 */
function installerWithCredential(has) {
  const inst = new Installer(mockRegistry, tmpDir);
  inst._checkWindowsCredential = (target) =>
    has && target === 'gemini:antigravity';
  return inst;
}

/** Run `fn` as if this were Windows, and put the platform back afterwards. */
function onWindows(fn) {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', real);
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agy-'));
  savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('antigravity registry check_ready', () => {
  it('declares the credential the Google sign-in actually lands in', () => {
    assert.equal(ENTRY.check_ready.credential_target, 'gemini:antigravity');
    // Nothing on disk names the account, so a missing positive signal must not
    // harden into "definitely signed out" — see probe.js, which gives an
    // 'unknown' verdict a live try instead of refusing the run.
    assert.equal(ENTRY.check_ready.unverifiable, true);
  });
});

describe('credentialListHasTarget', () => {
  // Verbatim from `cmdkey /list` on the zh-CN machine that reported this: the
  // labels are localized, the target fragment is not.
  const CMDKEY_ZH =
    '\r\n当前登录会话的凭据存储在下面:\r\n\r\n' +
    '    目标: LegacyGeneric:target=gemini:antigravity\r\n' +
    '    类型: 一般\r\n' +
    '    用户: antigravity\r\n';

  it('finds the target behind a localized label and a LegacyGeneric prefix', () => {
    assert.equal(credentialListHasTarget(CMDKEY_ZH, 'gemini:antigravity'), true);
  });

  it('ignores case, which is the CLI-s choice and not the user-s', () => {
    assert.equal(credentialListHasTarget(CMDKEY_ZH, 'Gemini:Antigravity'), true);
  });

  it('does not match a different agent-s credential', () => {
    assert.equal(credentialListHasTarget(CMDKEY_ZH, 'gemini:cli'), false);
    assert.equal(
      credentialListHasTarget('    目标: LegacyGeneric:target=git:https://github.com', 'gemini:antigravity'),
      false,
    );
  });

  it('answers false rather than throwing on empty input', () => {
    assert.equal(credentialListHasTarget('', 'gemini:antigravity'), false);
    assert.equal(credentialListHasTarget(CMDKEY_ZH, ''), false);
    assert.equal(credentialListHasTarget(undefined, undefined), false);
  });
});

describe('antigravity readiness', () => {
  it('reports the Google sign-in as ready, with no API key set', () => {
    const r = onWindows(() => evaluate(installerWithCredential(true)));
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
    assert.equal(r.auth_status, 'ready');
  });

  it('still prefers a configured API key, as before', () => {
    const r = evaluate(installerWithCredential(false), { GEMINI_API_KEY: 'k' });
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'api_key');
  });

  it('leaves an undetectable sign-in unknown, not signed out', () => {
    // Windows with no such credential, which is also every mac and Linux box.
    const r = onWindows(() => evaluate(installerWithCredential(false)));
    assert.equal(r.ready, false);
    // The distinction that lets the run be attempted anyway.
    assert.equal(r.auth_status, 'unknown');
    assert.match(r.message, /agy/);
  });
});
