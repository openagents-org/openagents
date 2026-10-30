'use strict';

/**
 * macOS Keychain sign-in detection asks whether the item EXISTS and never for
 * its secret. `security find-generic-password … -w` run from the daemon's
 * detection round (every two minutes, through /bin/sh) was flagged by
 * CrowdStrike Falcon as credential dumping, and the value was only ever used
 * as a yes/no signal.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer, clearVersionCache } = require('../src/installer');
const { Registry } = require('../src/registry');
const { setBlockingProbes } = require('../src/probe-mode');

const KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];

let home;
let cacheDir;
let savedVars;
let savedPlatform;

function claude(spawnResult) {
  const entry = new Registry(cacheDir).getEntry('claude');
  const inst = new Installer({ getEntry: () => entry, getResolveRules: () => [] }, cacheDir);
  inst._homeForAgent = () => home;
  inst.env.getEffective = () => ({});
  inst.env.getForAgent = () => ({});
  const calls = [];
  inst._spawnSyncForTest = (...a) => { calls.push(a); return spawnResult; };
  // No binary: `claude auth status` stays out of it, only the Keychain decides.
  return { calls, evaluate: () => inst._evaluateReadiness('claude', entry, null, {}) };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-keychain-home-'));
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-keychain-cache-'));
  savedVars = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));
  for (const k of KEY_VARS) delete process.env[k];
  savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  clearVersionCache();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', savedPlatform);
  setBlockingProbes(null);
  clearVersionCache();
  for (const [k, v] of Object.entries(savedVars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

describe('macOS Keychain sign-in probe', () => {
  it('an existing Claude Code item is a sign-in', () => {
    const { evaluate } = claude({ status: 0 });
    const r = evaluate();
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
  });

  it('asks for attributes only, without a shell', () => {
    const { calls, evaluate } = claude({ status: 0 });
    evaluate();
    assert.equal(calls.length, 1);
    const [file, args, opts] = calls[0];
    assert.equal(file, 'security');
    assert.deepEqual(args, ['find-generic-password', '-s', 'Claude Code-credentials']);
    assert.ok(!args.includes('-w') && !args.includes('-g'), 'must not print the secret');
    assert.notEqual(opts.shell, true);
    // Not even the attributes are kept: the exit status is the answer.
    assert.deepEqual(opts.stdio, ['ignore', 'ignore', 'ignore']);
  });

  it('a missing item is not a sign-in', () => {
    // 44: "The specified item could not be found in the keychain."
    const { evaluate } = claude({ status: 44 });
    assert.equal(evaluate().ready, false);
  });

  it('a lookup that cannot run is not a sign-in', () => {
    const { evaluate } = claude({ error: new Error('ETIMEDOUT'), status: null });
    assert.equal(evaluate().ready, false);
  });

  it('a credentials file that settles it skips the Keychain', () => {
    const file = path.join(home, '.claude', '.credentials.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: 'x' } }));
    const { calls, evaluate } = claude({ status: 0 });
    assert.equal(evaluate().ready, true);
    assert.equal(calls.length, 0);
  });

  it('repeat checks within the cache window do not spawn again', () => {
    const { calls, evaluate } = claude({ status: 0 });
    evaluate();
    evaluate();
    assert.equal(calls.length, 1);
  });

  it('never waits on `security` in Electron main', () => {
    setBlockingProbes(false);
    const { calls, evaluate } = claude({ status: 0 });
    evaluate();
    assert.equal(calls.length, 0);
  });
});

describe('installer source', () => {
  it('no Keychain lookup asks for the stored secret', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'installer.js'), 'utf-8');
    assert.doesNotMatch(src, /find-generic-password[^\n]*-w/);
  });
});
