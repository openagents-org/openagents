'use strict';

/**
 * Each keyed Hermes agent runs on a provider of its own.
 *
 * Hermes reads a custom endpoint only from its config.yaml, and the adapter
 * used to write every keyed agent's URL and key into the one device-wide
 * `model:` section. With two Hermes agents on two relays the last one saved
 * ran both, and a key rewritten under a running session ended it with
 * "launch_credentials_unavailable". Now each agent gets `providers.<name>`
 * (URL plus `key_env`), picked per run with `--provider`, and its key reaches
 * Hermes only through that run's environment.
 *
 * Also here: on Windows a `hermes.cmd` launcher found first on PATH failed
 * every message with "spawn EINVAL"; the hermes.exe behind it is run instead.
 *
 * Run: node --test test/hermes-agent-provider.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HermesAdapter = require('../src/adapters/hermes');
const { createAdapter } = require('../src/adapters');

let tmp;
let savedRestore;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-provider-'));
  // releaseLegacyEndpoint would otherwise touch the real ~/.openagents record.
  savedRestore = HermesAdapter.restoreNativeAuth;
  HermesAdapter.restoreNativeAuth = () => ({ skipped: true });
});
after(() => {
  HermesAdapter.restoreNativeAuth = savedRestore;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeHermes(name, env = {}, opts = {}) {
  const agentEnv = { PATH: process.env.PATH, HERMES_HOME: path.join(tmp, 'home'), ...env };
  const a = createAdapter('hermes', {
    workspaceId: 'w',
    channelName: 'general',
    token: 'tok-secret',
    agentName: name,
    endpoint: 'http://127.0.0.1:0',
    agentEnv,
    ...opts,
  });
  a._log = () => {};
  a._hermesBin = '/fake/hermes';
  return a;
}

/** Records `hermes config set` calls; each takes a tick so overlaps would show. */
function recordConfigSets(adapter, log, state) {
  adapter._hermesConfigSet = async (args) => {
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    log.push(args);
    state.inFlight--;
  };
}

describe('HermesAdapter.providerName', () => {
  it('names a provider after the agent', () => {
    assert.equal(HermesAdapter.providerName('hermes1'), 'openagents-hermes1');
  });

  it('keeps names that only differ in what Hermes does not allow apart', () => {
    const a = HermesAdapter.providerName('Hermes 1');
    const b = HermesAdapter.providerName('hermes-1');
    assert.match(a, /^openagents-hermes-1-[0-9a-f]{6}$/);
    assert.equal(b, 'openagents-hermes-1');
    assert.notEqual(a, b);
  });
});

describe('a keyed Hermes agent', () => {
  it('runs on its own provider and model', () => {
    const a = makeHermes('hermes1', { LLM_BASE_URL: 'https://one.example/v1/', LLM_API_KEY: 'sk-one', LLM_MODEL: 'm-one' });
    const args = a._buildHermesCmd('hi', null);
    assert.deepEqual(args.slice(args.indexOf('--provider')), ['--provider', 'openagents-hermes1', '-m', 'm-one']);
    assert.ok(!args.includes('sk-one'), 'the key is never an argument');
  });

  it('an agent on the sign-in passes neither', () => {
    const a = makeHermes('signed-in');
    const args = a._buildHermesCmd('hi', null);
    assert.ok(!args.includes('--provider'));
    assert.ok(!args.includes('-m'));
  });

  it('writes its URL and key variable, never the key, into its profile\'s config', async () => {
    const a = makeHermes('coder', { LLM_BASE_URL: 'https://one.example/v1', LLM_API_KEY: 'sk-one' }, { hermesProfile: 'coder' });
    const log = [];
    recordConfigSets(a, log, { inFlight: 0, maxInFlight: 0 });
    await a._ensureProvider(a._endpoint());
    assert.deepEqual(log, [
      ['-p', 'coder', 'config', 'set', 'providers.openagents-coder.api', 'https://one.example/v1'],
      ['-p', 'coder', 'config', 'set', 'providers.openagents-coder.key_env', 'OPENAGENTS_HERMES_API_KEY'],
    ]);
    assert.ok(!JSON.stringify(log).includes('sk-one'));
  });

  it('writes once per endpoint, and again when it changes', async () => {
    const a = makeHermes('hermes1', { LLM_BASE_URL: 'https://one.example/v1', LLM_API_KEY: 'sk-one' });
    const log = [];
    recordConfigSets(a, log, { inFlight: 0, maxInFlight: 0 });
    await a._ensureProvider(a._endpoint());
    await a._ensureProvider(a._endpoint());
    assert.equal(log.length, 2);
    a.agentEnv.LLM_BASE_URL = 'https://moved.example/v1';
    await a._ensureProvider(a._endpoint());
    assert.equal(log.length, 4);
    assert.deepEqual(log[2], ['config', 'set', 'providers.openagents-hermes1.api', 'https://moved.example/v1']);
  });

  it('two agents saving at once do not overlap their writes to the same file', async () => {
    const a = makeHermes('hermes1', { LLM_BASE_URL: 'https://one.example/v1' });
    const b = makeHermes('hermes3', { LLM_BASE_URL: 'https://three.example/v1' });
    const log = [];
    const state = { inFlight: 0, maxInFlight: 0 };
    recordConfigSets(a, log, state);
    recordConfigSets(b, log, state);
    await Promise.all([a._ensureProvider(a._endpoint()), b._ensureProvider(b._endpoint())]);
    assert.equal(state.maxInFlight, 1);
    const written = log.map((args) => args[2]);
    assert.deepEqual(written.filter((k) => k.endsWith('.api')).sort(), [
      'providers.openagents-hermes1.api',
      'providers.openagents-hermes3.api',
    ]);
  });

  it('a failed write is reported in words and tried again next turn', async () => {
    const a = makeHermes('hermes1', { LLM_BASE_URL: 'https://one.example/v1', LLM_API_KEY: 'sk-one' });
    let calls = 0;
    a._hermesConfigSet = async () => { calls++; throw new Error('Cannot parse config.yaml'); };
    await assert.rejects(a._ensureProvider(a._endpoint()), (e) => e.classified && /config\.yaml/.test(e.message));
    await assert.rejects(a._ensureProvider(a._endpoint()));
    assert.equal(calls, 2);
  });
});

describe('HermesAdapter.nativeExeFor (Windows launcher scripts)', () => {
  const files = (map) => ({
    exists: (p) => Object.prototype.hasOwnProperty.call(map, p),
    read: (p) => { if (map[p] == null) throw new Error('ENOENT'); return map[p]; },
    localAppData: 'C:\\Users\\u\\AppData\\Local',
  });

  it('leaves a real executable alone', () => {
    assert.equal(HermesAdapter.nativeExeFor('C:\\h\\hermes.exe', files({})), 'C:\\h\\hermes.exe');
    assert.equal(HermesAdapter.nativeExeFor('/usr/local/bin/hermes', files({})), '/usr/local/bin/hermes');
    assert.equal(HermesAdapter.nativeExeFor(null, files({})), null);
  });

  it('prefers a hermes.exe beside the launcher', () => {
    const fs = files({ 'C:\\h\\bin\\hermes.cmd': '@echo off', 'C:\\h\\bin\\hermes.exe': '' });
    assert.equal(HermesAdapter.nativeExeFor('C:\\h\\bin\\hermes.cmd', fs), 'C:\\h\\bin\\hermes.exe');
  });

  it('follows the .exe the launcher names, relative or absolute', () => {
    const relative = files({
      'C:\\h\\bin\\hermes.cmd': '@echo off\r\n"%~dp0\\..\\venv\\Scripts\\hermes.exe" %*\r\n',
      'C:\\h\\venv\\Scripts\\hermes.exe': '',
    });
    assert.equal(HermesAdapter.nativeExeFor('C:\\h\\bin\\hermes.cmd', relative), 'C:\\h\\venv\\Scripts\\hermes.exe');
    const absolute = files({
      'C:\\h\\bin\\hermes.bat': '@"D:\\tools\\hermes\\hermes.exe" %*',
      'D:\\tools\\hermes\\hermes.exe': '',
    });
    assert.equal(HermesAdapter.nativeExeFor('C:\\h\\bin\\hermes.bat', absolute), 'D:\\tools\\hermes\\hermes.exe');
  });

  it('falls back to the native installer\'s venv', () => {
    const venv = 'C:\\Users\\u\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe';
    const fs = files({ 'C:\\x\\hermes.cmd': 'uv run hermes %*', [venv]: '' });
    assert.equal(HermesAdapter.nativeExeFor('C:\\x\\hermes.cmd', fs), venv);
  });

  it('keeps the launcher when there is no hermes.exe to run', () => {
    const fs = files({ 'C:\\x\\hermes.cmd': 'uv run hermes %*' });
    assert.equal(HermesAdapter.nativeExeFor('C:\\x\\hermes.cmd', fs), 'C:\\x\\hermes.cmd');
  });
});
