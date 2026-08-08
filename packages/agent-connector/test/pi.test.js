'use strict';

/**
 * PiAdapter tests.
 *
 * Everything runs against test/fixtures/mock-pi.js — a Node script that speaks
 * the real Pi RPC protocol — so no Pi CLI, provider, API key or network is
 * needed. The mock's wire format was captured from
 * @earendil-works/pi-coding-agent v0.83.0.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PiAdapter = require('../src/adapters/pi');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');
const { Installer } = require('../src/installer');
const { MIN_NODE_VERSION } = require('../src/adapters/pi-stream');
const { REASON } = require('../src/adapters/health-status');

const IS_WINDOWS = process.platform === 'win32';
const MOCK_PI_SRC = path.join(__dirname, 'fixtures', 'mock-pi.js');

let tmpRoot;
let fakeBin;      // what _findPiBinary returns
let workDir;      // the agent's working directory
let adapterSeq = 0;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
  workDir = path.join(tmpRoot, 'project');
  fs.mkdirSync(workDir, { recursive: true });

  const script = fs.readFileSync(MOCK_PI_SRC, 'utf-8');
  if (IS_WINDOWS) {
    // Mirror a REAL npm cmd-shim (`SET dp0=%~dp0` … `"%dp0%\…"`), not a
    // simplified one: the adapter must parse it into [node, entry.js] so the
    // long --append-system-prompt never goes through cmd.exe's 8191-char cap.
    fs.writeFileSync(path.join(tmpRoot, 'fake-pi.js'), script);
    fakeBin = path.join(tmpRoot, 'fake-pi.cmd');
    fs.writeFileSync(
      fakeBin,
      '@ECHO off\r\nSET dp0=%~dp0\r\nnode "%dp0%\\fake-pi.js" %*\r\n',
    );
  } else {
    fakeBin = path.join(tmpRoot, 'fake-pi');
    fs.writeFileSync(fakeBin, script, { mode: 0o755 });
  }
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

/**
 * Build an adapter wired to the mock CLI, with every network-touching helper
 * captured and all on-disk state redirected into the test temp dir.
 */
function makeAdapter(extra = {}) {
  const id = ++adapterSeq;
  const a = new PiAdapter({
    workspaceId: extra.workspaceId || `ws-${id}`,
    channelName: 'general',
    token: 'workspace-token-value',
    agentName: extra.agentName || `pi-bot-${id}`,
    agentEnv: extra.agentEnv || {},
    workingDir: 'workingDir' in extra ? extra.workingDir : workDir,
  });

  // Redirect all persisted state into the temp dir (the constructor computes
  // real ~/.openagents paths, which the isolation test asserts on directly).
  a._sessionsFile = path.join(tmpRoot, `sessions-${a.workspaceId}-${a.agentName}.json`);
  a._sessionDir = path.join(tmpRoot, `pi-sessions-${a.workspaceId}-${a.agentName}`);

  a._captured = { thinking: [], status: [], response: [], error: [] };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a._statuses = [];
  a._reportStatus = (reason, message) => { a._statuses.push({ reason, message }); };
  a._log = () => {};

  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getWorkspaceMetadata: async () => ({ browserEnabled: false }),
    sendMessage: async () => ({}),
    readFile: async () => Buffer.from('fake-image-bytes'),
  };

  a._findPiBinary = () => fakeBin;
  a._piBin = fakeBin;
  return a;
}

function msg(content, channel = 'thread-a', extra = {}) {
  return Object.assign({ content, sessionId: channel, senderName: 'user' }, extra);
}

/** Read the argv/cwd/env snapshot the mock wrote. */
function readArgvLog(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

async function shutdown(a) {
  for (const channel of Object.keys(a._persistentProcs)) {
    await a._killPersistentProc(channel, 'test teardown');
  }
}

// ---------------------------------------------------------------------------
// 12: registration
// ---------------------------------------------------------------------------

describe('PiAdapter — registration', () => {
  it('is registered under the `pi` agent type', () => {
    assert.equal(ADAPTER_MAP.pi, PiAdapter);
    const inst = createAdapter('pi', {
      workspaceId: 'ws', channelName: 't', token: 'tok', agentName: 'p', agentEnv: {},
    });
    assert.ok(inst instanceof PiAdapter);
  });

  it('is listed in the registry catalog with an npm install spec', () => {
    const catalog = require('../registry.json');
    const entry = catalog.find((e) => e.name === 'pi');
    assert.ok(entry, 'registry.json must contain a `pi` entry');
    assert.equal(entry.install.binary, 'pi');
    assert.equal(entry.install.npm_package, '@earendil-works/pi-coding-agent');
    assert.deepEqual(entry.install.requires, ['nodejs']);
    for (const key of ['macos', 'linux', 'windows']) {
      assert.match(entry.install[key], /^npm install -g @earendil-works\/pi-coding-agent@\d+\.\d+\.\d+$/, key);
    }
    assert.equal(entry.adapter.class, 'PiAdapter');
    assert.ok(entry.install.min_version);
    assert.ok(entry.install.verify && entry.install.verify_win);
    assert.equal(entry.check_ready.creds_json_has_entries, true);
  });

  it('does not treat an auto-created empty auth.json as a CLI login', () => {
    const authFile = path.join(tmpRoot, 'pi-auth.json');
    const checkReady = {
      creds_file: authFile,
      creds_no_parse: true,
      creds_json_has_entries: true,
      not_ready_message: 'Pi login required',
    };
    const entry = { name: 'pi', check_ready: checkReady };
    const installer = new Installer({ getEntry: () => entry, getResolveRules: () => [] }, tmpRoot);
    installer.env.getEffective = () => ({});

    fs.writeFileSync(authFile, '{}');
    assert.equal(installer._evaluateReadiness('pi', entry, '/fake/pi').ready, false);

    fs.writeFileSync(authFile, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'redacted' } }));
    const loggedIn = installer._evaluateReadiness('pi', entry, '/fake/pi');
    assert.equal(loggedIn.ready, true);
    assert.equal(loggedIn.auth_mode, 'cli_login');
  });

  it('keeps the registry.json entry identical to the pi.yaml source', () => {
    // build:registry cannot run (its REGISTRY_DIR points at a path that does
    // not exist in this repo), so the bundle is hand-synced — this guards it.
    const yaml = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'sdk', 'src', 'openagents', 'registry', 'pi.yaml'),
      'utf-8',
    );
    const entry = require('../registry.json').find((e) => e.name === 'pi');
    for (const value of [
      entry.install.npm_package,
      entry.install.min_version,
      entry.install.linux,
      entry.check_ready.creds_file,
      entry.adapter.class,
    ]) {
      assert.ok(yaml.includes(value), `pi.yaml is missing "${value}"`);
    }
    for (const field of entry.env_config) {
      assert.ok(yaml.includes(`name: ${field.name}`), `pi.yaml is missing env ${field.name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 13 / 14: binary + CLI entry-point resolution
// ---------------------------------------------------------------------------

describe('PiAdapter — binary resolution', () => {
  it('prefers the isolated runtime prefix over anything on PATH', () => {
    const home = fs.mkdtempSync(path.join(tmpRoot, 'home-'));
    const binDir = path.join(home, '.openagents', 'runtimes', 'pi', 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const expected = path.join(binDir, IS_WINDOWS ? 'pi.cmd' : 'pi');
    fs.writeFileSync(expected, '#!/usr/bin/env node\n');

    const a = makeAdapter();
    delete a._findPiBinary; // use the real resolver
    const realHomedir = os.homedir;
    os.homedir = () => home;
    try {
      assert.equal(a._findPiBinary(), expected);
    } finally {
      os.homedir = realHomedir;
    }
  });

  it('falls back to the package entry point when npm left no .bin shim', () => {
    const home = fs.mkdtempSync(path.join(tmpRoot, 'home-nobin-'));
    const pkgName = require('../registry.json').find((e) => e.name === 'pi').install.npm_package;
    const pkgRoot = path.join(
      home, '.openagents', 'runtimes', 'pi', 'node_modules', ...pkgName.split('/'),
    );
    const pkgDir = path.join(pkgRoot, 'dist');
    fs.mkdirSync(pkgDir, { recursive: true });
    const entry = path.join(pkgDir, 'cli.js');
    fs.writeFileSync(entry, '#!/usr/bin/env node\n');
    // The entry path comes from the package's own manifest, so the adapter
    // never has to know it — a real install always ships this file.
    fs.writeFileSync(path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: pkgName, bin: { pi: 'dist/cli.js' } }));

    const a = makeAdapter();
    delete a._findPiBinary;
    const realHomedir = os.homedir;
    os.homedir = () => home;
    try {
      assert.equal(a._findPiBinary(), entry);
    } finally {
      os.homedir = realHomedir;
    }
  });

  it('resolves the npm .bin symlink to [node, dist/cli.js] on macOS/Linux',
    { skip: IS_WINDOWS ? 'POSIX symlink shim' : false }, () => {
      const root = fs.mkdtempSync(path.join(tmpRoot, 'shim-'));
      const distDir = path.join(root, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist');
      const binDir = path.join(root, 'node_modules', '.bin');
      fs.mkdirSync(distDir, { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      const entry = path.join(distDir, 'cli.js');
      fs.writeFileSync(entry, '#!/usr/bin/env node\n');
      const shim = path.join(binDir, 'pi');
      fs.symlinkSync(path.relative(binDir, entry), shim);

      const a = makeAdapter();
      const resolved = a._resolveToNodeCmd(shim);
      assert.ok(resolved, 'the shim must resolve to a node + entry pair');
      assert.equal(resolved.length, 2);
      assert.equal(resolved[1], entry);
      assert.ok(fs.existsSync(resolved[0]), 'the resolved node interpreter must exist');
    });

  it('parses a real Windows .cmd shim into [node, entry.js] on Windows',
    { skip: IS_WINDOWS ? false : 'Windows-only: _resolveToNodeCmd gates on the platform' }, () => {
      const root = fs.mkdtempSync(path.join(tmpRoot, 'wincmd-'));
      fs.writeFileSync(path.join(root, 'entry.js'), '// entry\n');
      const cmd = path.join(root, 'pi.cmd');
      // The modern npm cmd-shim dialect.
      fs.writeFileSync(cmd,
        '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\n' +
        'SETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node.exe"  "%dp0%\\entry.js" %*\r\n');

      const a = makeAdapter();
      const resolved = a._resolveToNodeCmd(cmd);
      assert.ok(resolved, 'the shim must parse, or the long system prompt hits cmd.exe\'s 8191-char cap');
      assert.equal(resolved.length, 2);
      assert.equal(resolved[1], path.join(root, 'entry.js'));
    });

  it('parses the bundled fixture shim on Windows',
    { skip: IS_WINDOWS ? false : 'Windows-only shim format' }, () => {
      const a = makeAdapter();
      const resolved = a._resolveToNodeCmd(fakeBin);
      assert.ok(resolved, 'the test fixture must exercise the parsed path, not cmd.exe /c');
      assert.equal(resolved.length, 2);
      assert.equal(resolved[1], path.join(tmpRoot, 'fake-pi.js'));
    });

  it('runs a shebang script under a Node we choose rather than the shebang', () => {
    const a = makeAdapter();
    const resolved = a._resolveToNodeCmd(fakeBin);
    if (IS_WINDOWS) {
      assert.ok(resolved, 'the .cmd shim resolves to node + js');
      assert.ok(resolved[1].endsWith('.js'));
    } else {
      assert.deepEqual(resolved, [a._findNodeBin(), fakeBin]);
    }
  });
});

// ---------------------------------------------------------------------------
// 15 / 16 / 17: preflight
// ---------------------------------------------------------------------------

describe('PiAdapter — preflight', () => {
  it('reports RUNTIME_MISSING with an install hint when the CLI is absent', () => {
    const a = makeAdapter();
    a._piBin = null;
    a._findPiBinary = () => null;
    const pf = a.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, REASON.RUNTIME_MISSING);
    assert.match(pf.message, /openagents install pi/);
  });

  it(`reports VERSION_INCOMPATIBLE when Node is below ${MIN_NODE_VERSION}`, () => {
    const a = makeAdapter();
    PiAdapter._clearVersionCache();
    a._findNodeBin = () => '/fake/old/node';
    a._readNodeVersionRaw = () => 'v20.11.1';
    const pf = a.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, REASON.VERSION_INCOMPATIBLE);
    assert.match(pf.message, /Node\.js >= 22\.19\.0/);
    assert.match(pf.message, /20\.11\.1/);
    PiAdapter._clearVersionCache();
  });

  it('accepts a Node at or above the floor', () => {
    const a = makeAdapter();
    PiAdapter._clearVersionCache();
    a._findNodeBin = () => '/fake/new/node';
    a._readNodeVersionRaw = () => 'v22.22.3';
    assert.equal(a.preflight().ok, true);
    PiAdapter._clearVersionCache();
  });

  it('reports VERSION_INCOMPATIBLE for a confirmed-old Pi', () => {
    const a = makeAdapter();
    PiAdapter._clearVersionCache();
    a._readNodeVersionRaw = () => 'v22.22.3';
    a._readPiVersionRaw = () => '0.50.0';
    const pf = a.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, REASON.VERSION_INCOMPATIBLE);
    assert.match(pf.message, /0\.50\.0/);
    PiAdapter._clearVersionCache();
  });

  it('detects the Pi version from the real mock CLI and passes', () => {
    const a = makeAdapter({ agentEnv: { FAKE_PI_VERSION: '0.83.0' } });
    PiAdapter._clearVersionCache();
    // Pin the Node probe: preflight would otherwise read the version of the
    // runtime executing the tests, so this case failed on the CI matrix's
    // Node 20 legs even though it is about detecting the PI version.
    a._readNodeVersionRaw = () => 'v22.22.3';
    const probe = a._checkPiVersion(fakeBin);
    assert.equal(probe.version, '0.83.0');
    assert.equal(probe.compatible, true);
    assert.equal(a.preflight().ok, true);
    PiAdapter._clearVersionCache();
  });

  it('proceeds leniently when the version cannot be determined', () => {
    const a = makeAdapter();
    PiAdapter._clearVersionCache();
    a._readPiVersionRaw = () => { throw new Error('boom'); };
    a._readNodeVersionRaw = () => 'v22.22.3';
    assert.equal(a._checkPiVersion(fakeBin).compatible, null);
    assert.equal(a.preflight().ok, true);
    PiAdapter._clearVersionCache();
  });
});

// ---------------------------------------------------------------------------
// 18 / 28 / 29: launch command, argv, cwd, env
// ---------------------------------------------------------------------------

describe('PiAdapter — launch command', () => {
  it('spawns RPC mode in workingDir with the configured provider/model and NO key in argv', async () => {
    const log = path.join(tmpRoot, `argv-${Date.now()}.json`);
    const a = makeAdapter({
      agentEnv: {
        FAKE_SCENARIO: 'complete',
        FAKE_ARGV_LOG: log,
        PI_PROVIDER: 'anthropic',
        PI_MODEL: 'claude-sonnet-4-6',
        PI_THINKING: 'high',
        ANTHROPIC_API_KEY: 'sk-ant-SECRETVALUE0123456789',
      },
    });
    await a._handleMessage(msg('fix the bug'));
    const snap = readArgvLog(log);

    // RPC mode, in the agent's working directory
    assert.equal(snap.argv[0], '--mode');
    assert.equal(snap.argv[1], 'rpc');
    assert.equal(fs.realpathSync(snap.cwd), fs.realpathSync(workDir));

    // Session storage is OpenAgents-managed, never the user's project.
    const sessionDir = snap.argv[snap.argv.indexOf('--session-dir') + 1];
    assert.equal(sessionDir, a._sessionDir);
    assert.ok(!sessionDir.startsWith(workDir), 'sessions must not land in the project');
    assert.ok(!sessionDir.includes(path.join('.pi', 'agent')), 'must not reuse ~/.pi/agent/sessions');

    // Configuration reaches Pi as separate argv entries (no shell string).
    assert.equal(snap.argv[snap.argv.indexOf('--provider') + 1], 'anthropic');
    assert.equal(snap.argv[snap.argv.indexOf('--model') + 1], 'claude-sonnet-4-6');
    assert.equal(snap.argv[snap.argv.indexOf('--thinking') + 1], 'high');

    // The API key is injected ONLY through the environment.
    assert.ok(!snap.argv.includes('--api-key'));
    assert.ok(!snap.argv.some((x) => x.includes('sk-ant-SECRETVALUE0123456789')),
      'the API key must never appear in argv');
    assert.equal(snap.env.ANTHROPIC_API_KEY, 'sk-ant-SECRETVALUE0123456789');

    await shutdown(a);
  });

  it('maps the unified Launcher key and loads the process-local provider extension', async () => {
    const log = path.join(tmpRoot, `argv-relay-${Date.now()}.json`);
    const secret = 'relay-secret-DO-NOT-LOG-12345';
    const a = makeAdapter({
      agentEnv: {
        FAKE_SCENARIO: 'complete',
        FAKE_ARGV_LOG: log,
        PI_PROVIDER: 'deepseek',
        PI_MODEL: 'deepseek-v4-flash',
        PI_BASE_URL: 'https://relay.example/v1',
        PI_API_FORMAT: 'openai-completions',
        PI_API_KEY: secret,
      },
    });
    await a._handleMessage(msg('hello'));
    const snap = readArgvLog(log);

    assert.equal(snap.env.PI_API_KEY, secret);
    assert.equal(snap.env.DEEPSEEK_API_KEY, secret);
    assert.equal(snap.env.PI_BASE_URL, 'https://relay.example/v1');
    const extension = snap.argv[snap.argv.indexOf('--extension') + 1];
    assert.match(extension, /pi-launcher-provider\.mjs$/);
    assert.ok(!snap.argv.some((arg) => String(arg).includes(secret)));
    await shutdown(a);
  });

  it('loads the process-local provider extension for a native Launcher key', async () => {
    const log = path.join(tmpRoot, `argv-native-key-${Date.now()}.json`);
    const secret = 'native-secret-DO-NOT-LOG-12345';
    const a = makeAdapter({
      agentEnv: {
        FAKE_SCENARIO: 'complete',
        FAKE_ARGV_LOG: log,
        PI_PROVIDER: 'deepseek',
        PI_MODEL: 'deepseek-v4-flash',
        PI_API_KEY: secret,
      },
    });
    await a._handleMessage(msg('hello'));
    const snap = readArgvLog(log);

    assert.equal(snap.env.PI_API_KEY, secret);
    assert.equal(snap.env.DEEPSEEK_API_KEY, secret);
    const extension = snap.argv[snap.argv.indexOf('--extension') + 1];
    assert.match(extension, /pi-launcher-provider\.mjs$/);
    assert.ok(!snap.argv.some((arg) => String(arg).includes(secret)));
    await shutdown(a);
  });

  it('requires provider and model before launching a custom base URL', async () => {
    const a = makeAdapter({
      agentEnv: { FAKE_SCENARIO: 'complete', PI_BASE_URL: 'https://relay.example/v1' },
    });
    await a._handleMessage(msg('hello'));
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /PI_PROVIDER and PI_MODEL are required/);
    await shutdown(a);
  });

  it('registers a Launcher relay entirely from the child environment', async () => {
    const names = ['PI_PROVIDER', 'PI_MODEL', 'PI_BASE_URL', 'PI_API_FORMAT', 'PI_API_KEY', 'PI_THINKING'];
    const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    Object.assign(process.env, {
      PI_PROVIDER: 'anthropic',
      PI_MODEL: 'relay-claude',
      PI_BASE_URL: 'https://relay.example/v1',
      PI_API_FORMAT: 'anthropic-messages',
      PI_API_KEY: 'relay-key-in-memory-only',
      PI_THINKING: 'high',
    });
    try {
      const extensionUrl = pathToFileURL(
        path.join(__dirname, '..', 'src', 'adapters', 'pi-launcher-provider.mjs'),
      );
      extensionUrl.searchParams.set('test', String(Date.now()));
      const configure = (await import(extensionUrl.href)).default;
      let registered;
      configure({ registerProvider: (provider, config) => { registered = { provider, config }; } });

      assert.equal(registered.provider, 'anthropic');
      assert.equal(registered.config.baseUrl, 'https://relay.example');
      assert.equal(registered.config.api, 'anthropic-messages');
      assert.equal(registered.config.apiKey, 'relay-key-in-memory-only');
      assert.equal(registered.config.authHeader, true);
      assert.equal(registered.config.models[0].id, 'relay-claude');
      assert.equal(registered.config.models[0].reasoning, true);
      assert.deepEqual(registered.config.models[0].cost, {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tiers: [],
      });
    } finally {
      for (const name of names) {
        if (before[name] === undefined) delete process.env[name];
        else process.env[name] = before[name];
      }
    }
  });

  it('registers native DeepSeek with an explicit process-local key', async () => {
    const names = ['PI_PROVIDER', 'PI_MODEL', 'PI_BASE_URL', 'PI_API_FORMAT', 'PI_API_KEY'];
    const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    Object.assign(process.env, {
      PI_PROVIDER: 'deepseek',
      PI_MODEL: 'deepseek-v4-flash',
      PI_API_KEY: 'native-key-in-memory-only',
    });
    delete process.env.PI_BASE_URL;
    delete process.env.PI_API_FORMAT;
    try {
      const extensionUrl = pathToFileURL(
        path.join(__dirname, '..', 'src', 'adapters', 'pi-launcher-provider.mjs'),
      );
      extensionUrl.searchParams.set('test', String(Date.now()));
      const configure = (await import(extensionUrl.href)).default;
      let registered;
      configure({ registerProvider: (provider, config) => { registered = { provider, config }; } });

      assert.equal(registered.provider, 'deepseek');
      assert.equal(registered.config.baseUrl, 'https://api.deepseek.com/v1');
      assert.equal(registered.config.api, 'openai-completions');
      assert.equal(registered.config.apiKey, 'native-key-in-memory-only');
      assert.equal(registered.config.models[0].id, 'deepseek-v4-flash');
      assert.deepEqual(registered.config.models[0].cost, {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tiers: [],
      });
    } finally {
      for (const name of names) {
        if (before[name] === undefined) delete process.env[name];
        else process.env[name] = before[name];
      }
    }
  });

  it('registers a custom relay without forcing a Launcher key', async () => {
    const names = ['PI_PROVIDER', 'PI_MODEL', 'PI_BASE_URL', 'PI_API_FORMAT', 'PI_API_KEY'];
    const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    Object.assign(process.env, {
      PI_PROVIDER: 'custom',
      PI_MODEL: 'relay-model',
      PI_BASE_URL: 'https://relay.example/v1',
      PI_API_FORMAT: 'openai-completions',
    });
    delete process.env.PI_API_KEY;
    try {
      const extensionUrl = pathToFileURL(
        path.join(__dirname, '..', 'src', 'adapters', 'pi-launcher-provider.mjs'),
      );
      extensionUrl.searchParams.set('test', String(Date.now()));
      const configure = (await import(extensionUrl.href)).default;
      let registered;
      configure({ registerProvider: (provider, config) => { registered = { provider, config }; } });

      assert.equal(registered.provider, 'custom');
      assert.equal(registered.config.baseUrl, 'https://relay.example/v1');
      assert.equal(registered.config.apiKey, undefined);
    } finally {
      for (const name of names) {
        if (before[name] === undefined) delete process.env[name];
        else process.env[name] = before[name];
      }
    }
  });

  it('defaults to --no-approve and never blocks on a trust prompt', async () => {
    const log = path.join(tmpRoot, `argv-trust-${Date.now()}.json`);
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete', FAKE_ARGV_LOG: log } });
    await a._handleMessage(msg('hello'));
    const snap = readArgvLog(log);
    assert.ok(snap.argv.includes('--no-approve'));
    assert.ok(!snap.argv.includes('--approve'));
    // The turn completed, i.e. nothing waited on terminal interaction.
    assert.equal(a._captured.response.length, 1);
    await shutdown(a);
  });

  it('switches to --approve only when PI_TRUST_PROJECT opts in', async () => {
    const log = path.join(tmpRoot, `argv-trust2-${Date.now()}.json`);
    const a = makeAdapter({
      agentEnv: { FAKE_SCENARIO: 'complete', FAKE_ARGV_LOG: log, PI_TRUST_PROJECT: '1' },
    });
    await a._handleMessage(msg('hello'));
    const snap = readArgvLog(log);
    assert.ok(snap.argv.includes('--approve'));
    assert.ok(!snap.argv.includes('--no-approve'));
    await shutdown(a);
  });

  it('appends the workspace system prompt without replacing Pi\'s own', async () => {
    const log = path.join(tmpRoot, `argv-sys-${Date.now()}.json`);
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete', FAKE_ARGV_LOG: log } });
    await a._handleMessage(msg('hello'));
    const snap = readArgvLog(log);
    const idx = snap.argv.indexOf('--append-system-prompt');
    assert.ok(idx >= 0);
    assert.ok(!snap.argv.includes('--system-prompt'));
    const prompt = snap.argv[idx + 1];
    assert.match(prompt, /OpenAgents workspace/);
    assert.match(prompt, new RegExp(a.agentName));
    await shutdown(a);
  });

  it('reports a missing working directory instead of spawning', async () => {
    const a = makeAdapter({ workingDir: path.join(tmpRoot, 'nope') });
    await a._handleMessage(msg('hello'));
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /Working directory does not exist/);
    assert.equal(Object.keys(a._persistentProcs).length, 0);
  });
});

// ---------------------------------------------------------------------------
// 19: no Pi SDK anywhere in the source
// ---------------------------------------------------------------------------

describe('PiAdapter — CLI-only integration', () => {
  it('never imports a Pi SDK or internal Pi module', () => {
    const files = ['pi.js', 'pi-stream.js'].map((f) =>
      fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', f), 'utf-8'));
    const BANNED = [
      /require\(\s*['"]@earendil-works\//,
      /require\(\s*['"]pi-coding-agent/,
      /from\s+['"]@earendil-works\//,
      /import\(\s*['"]@earendil-works\//,
      /\bAgentSession\b\s*\(/,
    ];
    for (const src of files) {
      for (const re of BANNED) {
        assert.ok(!re.test(src), `source must not match ${re}`);
      }
    }
  });

  it('declares no new runtime dependency for Pi', () => {
    const pkg = require('../package.json');
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['blessed', 'ws']);
  });

  it('keeps the npm package name and version floor out of adapter code', () => {
    // The contract: package identity lives in registry configuration only.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', 'pi.js'), 'utf-8');
    const entry = require('../registry.json').find((e) => e.name === 'pi');
    // The literal package name appears only inside comments, never in code.
    const code = src.split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n');
    assert.ok(!code.includes(entry.install.npm_package),
      'the npm package name must be read from the registry, not written in pi.js');
    assert.ok(!code.includes(entry.install.min_version),
      'the version floor must be read from the registry, not written in pi.js');
  });

  it('resolves the package entry point from the registry + the installed manifest', () => {
    const entry = require('../registry.json').find((e) => e.name === 'pi');
    const home = fs.mkdtempSync(path.join(tmpRoot, 'pkgentry-'));
    const pkgDir = path.join(
      home, '.openagents', 'runtimes', 'pi', 'node_modules',
      ...entry.install.npm_package.split('/'),
    );
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    fs.writeFileSync(path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: entry.install.npm_package, bin: { pi: 'dist/cli.js' } }));

    const a = makeAdapter();
    assert.equal(a._findPackageEntryPoint(home), path.join(pkgDir, 'dist', 'cli.js'));
  });

  it('takes the version floor from the registry entry', () => {
    const entry = require('../registry.json').find((e) => e.name === 'pi');
    const a = makeAdapter();
    PiAdapter._clearVersionCache();
    a._readNodeVersionRaw = () => 'v22.22.3';
    // One patch below the registry's declared floor must be refused.
    const [maj, min] = entry.install.min_version.split('.').map(Number);
    a._readPiVersionRaw = () => `${maj}.${Math.max(0, min - 1)}.0`;
    const pf = a.preflight();
    assert.equal(pf.reason, REASON.VERSION_INCOMPATIBLE);
    assert.match(pf.message, new RegExp(entry.install.min_version.replace(/\./g, '\\.')));
    PiAdapter._clearVersionCache();
  });
});

// ---------------------------------------------------------------------------
// 20 / 21 / 22 / 23: sessions, process reuse and isolation
// ---------------------------------------------------------------------------

describe('PiAdapter — session + process isolation', () => {
  it('reuses one process for consecutive messages in the same channel', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    await a._handleMessage(msg('first', 'thread-a'));
    const pid1 = a._persistentProcs['thread-a'].proc.pid;
    const session1 = a._persistentProcs['thread-a'].sessionId;

    await a._handleMessage(msg('second', 'thread-a'));
    const pp = a._persistentProcs['thread-a'];
    assert.equal(pp.proc.pid, pid1, 'the same process must serve the follow-up');
    assert.equal(pp.sessionId, session1);
    // The mock echoes its per-process prompt counter — proof the SAME process
    // (and therefore the same Pi conversation) handled both turns.
    assert.match(a._captured.response[0], /^Done \(prompt #1\): first$/);
    assert.match(a._captured.response[1], /^Done \(prompt #2\): second$/);
    await shutdown(a);
  });

  it('gives each channel its own process and its own Pi session', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    await a._handleMessage(msg('a', 'thread-a'));
    await a._handleMessage(msg('b', 'thread-b'));

    const ppA = a._persistentProcs['thread-a'];
    const ppB = a._persistentProcs['thread-b'];
    assert.notEqual(ppA.proc.pid, ppB.proc.pid);
    assert.notEqual(ppA.sessionId, ppB.sessionId);
    // Each channel's Pi process counted its own prompts → separate contexts.
    assert.match(a._captured.response[1], /^Done \(prompt #1\): b$/);
    await shutdown(a);
  });

  it('isolates session state per workspace and per agent on disk', () => {
    const one = new PiAdapter({ workspaceId: 'ws-1', channelName: 'g', token: 't', agentName: 'alpha', agentEnv: {} });
    const two = new PiAdapter({ workspaceId: 'ws-1', channelName: 'g', token: 't', agentName: 'beta', agentEnv: {} });
    const three = new PiAdapter({ workspaceId: 'ws-2', channelName: 'g', token: 't', agentName: 'alpha', agentEnv: {} });

    const files = [one._sessionsFile, two._sessionsFile, three._sessionsFile];
    assert.equal(new Set(files).size, 3, 'no two agents may share a session file');
    for (const f of files) assert.match(f, /[/\\]\.openagents[/\\]sessions[/\\]/);
    assert.match(one._sessionsFile, /ws-1_alpha_pi\.json$/);

    const dirs = [one._sessionDir, two._sessionDir, three._sessionDir];
    assert.equal(new Set(dirs).size, 3, 'no two agents may share a Pi session directory');
    for (const d of dirs) {
      assert.match(d, /[/\\]\.openagents[/\\]pi-sessions[/\\]/);
      assert.ok(!d.includes(path.join('.pi', 'agent')), 'never write into the user-global Pi session store');
    }
  });

  it('persists a channel session and resumes the same id after a restart', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    await a._handleMessage(msg('hello', 'thread-a'));
    const sessionId = a._channelSessions['thread-a'].sessionId;
    assert.match(sessionId, /^[0-9a-f-]{36}$/);
    await shutdown(a);

    // A "restarted launcher": a brand-new adapter reading the same file.
    const b = makeAdapter({ workspaceId: a.workspaceId, agentName: a.agentName });
    b._sessionsFile = a._sessionsFile;
    b._loadSessions();
    assert.equal(b._sessionIdFor('thread-a', workDir), sessionId);
  });

  it('mints a fresh session when the sessions file is corrupt', () => {
    const a = makeAdapter();
    fs.writeFileSync(a._sessionsFile, '{ this is not json');
    a._channelSessions = {};
    a._loadSessions();
    assert.deepEqual(a._channelSessions, {});
    const id = a._sessionIdFor('thread-a', workDir);
    assert.match(id, /^[0-9a-f-]{36}$/);
  });

  it('discards a stored session id that is not a valid UUID', () => {
    const a = makeAdapter();
    fs.writeFileSync(a._sessionsFile, JSON.stringify({ 'thread-a': { sessionId: 'garbage' } }));
    a._channelSessions = {};
    a._loadSessions();
    assert.equal(a._channelSessions['thread-a'], undefined);
    assert.notEqual(a._sessionIdFor('thread-a', workDir), 'garbage');
  });

  it('does not resume a session bound to a different working directory', () => {
    const a = makeAdapter();
    a._channelSessions['thread-a'] = { sessionId: '11111111-2222-3333-4444-555555555555', workingDir: '/other/project' };
    const id = a._sessionIdFor('thread-a', workDir);
    assert.notEqual(id, '11111111-2222-3333-4444-555555555555');
    assert.equal(a._channelSessions['thread-a'].workingDir, workDir);
  });
});

// ---------------------------------------------------------------------------
// Event → workspace mapping
// ---------------------------------------------------------------------------

describe('PiAdapter — event mapping', () => {
  it('streams interim text + tool status and posts the final answer once', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    await a._handleMessage(msg('fix it'));

    assert.deepEqual(a._captured.response, ['Done (prompt #1): fix it']);
    assert.ok(a._captured.thinking.includes('Let me look at the file.'));
    assert.ok(a._captured.status.some((s) => s.startsWith('read › src/x.js')),
      `tool status missing: ${JSON.stringify(a._captured.status)}`);
    // The streamed block and the message_end payload must not both be posted.
    const narrations = a._captured.thinking.filter((t) => t === 'Let me look at the file.');
    assert.equal(narrations.length, 1, 'interim text posted exactly once');
    assert.equal(a._captured.error.length, 0);
    await shutdown(a);
  });

  it('posts the final answer EXACTLY once — never as thinking and as a reply', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    await a._handleMessage(msg('fix it'));

    const answer = 'Done (prompt #1): fix it';
    assert.deepEqual(a._captured.response, [answer]);
    assert.ok(!a._captured.thinking.includes(answer),
      `the answer must not also be posted as thinking: ${JSON.stringify(a._captured.thinking)}`);
    // Narration before the tool call still streams — only the answer is held.
    assert.deepEqual(a._captured.thinking, ['Let me look at the file.']);
    await shutdown(a);
  });

  it('does not drop a superseded answer candidate — it becomes thinking', async () => {
    // Two consecutive assistant messages that both end with stopReason 'stop':
    // the first is superseded and must resurface as thinking, not vanish.
    const a = makeAdapter();
    const pp = {
      msgChannel: 'thread-a', pending: new Map(), heldTexts: [], turnTexts: [],
      acc: new (require('../src/adapters/pi-stream').PiAssistantAccumulator)(),
    };
    const send = (message) => a._handleEvent(pp, {
      kind: 'message_end', message: { role: 'assistant', ...message },
    });
    await send({ content: [{ type: 'text', text: 'first pass' }], stopReason: 'stop' });
    await send({ content: [{ type: 'text', text: 'second pass' }], stopReason: 'stop' });

    assert.deepEqual(pp.turnTexts, ['second pass'], 'the last message is the answer');
    assert.deepEqual(a._captured.thinking, ['first pass'], 'the superseded one is not lost');
  });

  it('reports a successful tool completion, not just failures', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    await a._handleMessage(msg('fix it'));
    assert.ok(a._captured.status.some((s) => s.startsWith('read ✓')),
      `expected a tool-completed status: ${JSON.stringify(a._captured.status)}`);
    await shutdown(a);
  });

  it('redacts this agent\'s exact credentials in every diagnostic path', async () => {
    // A Google key matches NO generic secret pattern, so only the instance's
    // concrete secret list can mask it. The pure classifier cannot know it.
    const key = 'AIzaSyD-1234567890abcdefghijklmnop';
    const a = makeAdapter({ agentEnv: { GEMINI_API_KEY: key } });
    const logged = [];
    a._log = (m) => logged.push(m);
    const pp = { msgChannel: 'thread-a', pending: new Map(), heldTexts: [], turnTexts: [] };

    await a._handleEvent(pp, { kind: 'extension_error', message: `boom: GEMINI_API_KEY=${key}` });
    await a._handleEvent(pp, { kind: 'unknown', raw: `{"payload":"${key}"}` });
    await a._handleEvent(pp, { kind: 'tool_start', toolName: 'bash', preview: `echo ${key}` });
    await a._handleEvent(pp, { kind: 'tool_end', toolName: 'bash', isError: true, preview: key });
    await a._handleEvent(pp, {
      kind: 'compaction_end', reason: 'threshold', aborted: false, error: `upstream ${key}`,
    });

    for (const line of [...a._captured.status, ...logged]) {
      assert.ok(!line.includes(key), `credential leaked: ${line}`);
    }
    assert.ok(a._captured.status.length > 0, 'the statuses were actually exercised');
    // The workspace token is masked the same way.
    await a._handleEvent(pp, { kind: 'extension_error', message: `token ${a.token}` });
    assert.ok(!a._captured.status.at(-1).includes(a.token));
  });

  it('carries multi-byte text through the stream unmangled', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'unicode' } });
    await a._handleMessage(msg('修复这个 bug'));
    assert.deepEqual(a._captured.response, ['完成了：修复这个 bug 🚀']);
    await shutdown(a);
  });

  it('surfaces a provider auth failure as a redacted, actionable error', async () => {
    const a = makeAdapter({
      agentEnv: { FAKE_SCENARIO: 'auth_error', ANTHROPIC_API_KEY: 'sk-ant-SECRETVALUE0123456789' },
    });
    await a._handleMessage(msg('hello'));

    assert.equal(a._captured.response.length, 0, 'a failed turn must not post an answer');
    assert.equal(a._captured.error.length, 1);
    const err = a._captured.error[0];
    assert.match(err, /authentication failed/i);
    assert.ok(!err.includes('sk-ant-SECRETVALUE0123456789'), 'the key must be redacted');
    assert.ok(a._statuses.some((s) => s.reason === REASON.LOGIN_REQUIRED));
    await shutdown(a);
  });

  it('auto-cancels a blocking extension UI request instead of hanging', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'ui_prompt' } });
    // Without the auto-cancel the mock never settles and this would time out.
    await a._handleMessage(msg('do something risky'));
    assert.ok(a._captured.status.some((s) => /requested interactive input/.test(s)),
      `expected a dismissal notice: ${JSON.stringify(a._captured.status)}`);
    await shutdown(a);
  });
});

// ---------------------------------------------------------------------------
// 24 / 25 / 26 / 27: stop, abort escalation, crashes, teardown
// ---------------------------------------------------------------------------

describe('PiAdapter — stop and failure handling', () => {
  it('stops only the targeted channel and leaves the others running', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    await a._handleMessage(msg('a', 'thread-a'));
    await a._handleMessage(msg('b', 'thread-b'));
    const otherProc = a._persistentProcs['thread-b'].proc;

    await a._onControlAction('stop', { channel: 'thread-a' });

    assert.equal(a._persistentProcs['thread-a'], undefined, 'the target process is gone');
    assert.ok(a._persistentProcs['thread-b'], 'the sibling channel is untouched');
    assert.equal(a._persistentProcs['thread-b'].proc.pid, otherProc.pid);
    assert.equal(otherProc.exitCode, null, 'the sibling process is still alive');
    await shutdown(a);
  });

  it('sends `abort` first and keeps the process when Pi settles cleanly', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'hang' } });
    const turn = a._handleMessage(msg('long task', 'thread-a'));
    await waitFor(() => a._persistentProcs['thread-a'] && a._persistentProcs['thread-a'].turnInFlight);

    a._persistentProcs['thread-a'].userStopped = true;
    await a._abortChannel('thread-a');
    await turn;

    const pp = a._persistentProcs['thread-a'];
    assert.ok(pp, 'a clean abort keeps the session process alive for the next message');
    assert.equal(pp.proc.exitCode, null);
    await shutdown(a);
  });

  it('escalates to a process-tree kill when abort is ignored', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'ignore_abort' } });
    const turn = a._handleMessage(msg('wedged task', 'thread-a'));
    await waitFor(() => a._persistentProcs['thread-a'] && a._persistentProcs['thread-a'].turnInFlight);
    const proc = a._persistentProcs['thread-a'].proc;

    await a._onControlAction('stop', { channel: 'thread-a' });
    await turn;

    assert.equal(a._persistentProcs['thread-a'], undefined);
    assert.ok(proc.exitCode !== null || proc.signalCode !== null,
      'the wedged process must have been terminated');
    assert.deepEqual(a._captured.response, ['Execution stopped by user.']);
  });

  it('posts the stop notice exactly once', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'ignore_abort' } });
    const turn = a._handleMessage(msg('wedged', 'thread-a'));
    await waitFor(() => a._persistentProcs['thread-a'] && a._persistentProcs['thread-a'].turnInFlight);
    await a._onControlAction('stop', { channel: 'thread-a' });
    await a._onControlAction('stop', { channel: 'thread-a' });
    await turn;
    assert.equal(a._captured.response.filter((r) => r === 'Execution stopped by user.').length, 1);
  });

  it('rejects pending RPCs with a clear cancellation when the CLI dies', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'hang' } });
    const turn = a._handleMessage(msg('x', 'thread-a'));
    await waitFor(() => a._persistentProcs['thread-a'] && a._persistentProcs['thread-a'].turnInFlight);
    const pp = a._persistentProcs['thread-a'];

    // A control RPC that will never be answered, then the process dies.
    const pending = pp._testPending = a._sendRpc(pp, { type: 'get_state' }, { timeoutMs: 60000 });
    let rejection = null;
    pending.catch((e) => { rejection = e; });
    await a._killPersistentProc('thread-a', 'simulated crash');
    await turn;
    await new Promise((r) => setImmediate(r));

    assert.ok(rejection, 'the pending RPC must reject, not leak');
    assert.equal(rejection.name, 'PiCancelledError');
    assert.equal(pp.pending.size, 0);
  });

  it('survives an asynchronous stdin EPIPE instead of crashing the daemon', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'hang' } });
    const turn = a._handleMessage(msg('x', 'thread-a'));
    await waitFor(() => a._persistentProcs['thread-a'] && a._persistentProcs['thread-a'].turnInFlight);
    const pp = a._persistentProcs['thread-a'];

    // A Writable reports EPIPE through an 'error' EVENT, which the try/catch
    // around stdin.write() cannot see. Without a listener this is an
    // unhandled 'error' and Node tears the process down.
    assert.ok(pp.proc.stdin.listenerCount('error') > 0, 'stdin needs an error guard');
    pp.proc.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    assert.equal(pp.stdinBroken, true, 'a broken pipe is remembered');

    // Further RPCs fail fast and cleanly rather than writing into the void.
    await assert.rejects(
      () => a._sendRpc(pp, { type: 'get_state' }, { timeoutMs: 500 }),
      (e) => e.name === 'PiCancelledError',
    );

    await a._killPersistentProc('thread-a', 'test');
    await turn;
  });

  it('reports an abnormal CLI exit mid-turn instead of hanging on "thinking"', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'crash_mid_turn', FAKE_EXIT_CODE: '7' } });
    await a._handleMessage(msg('boom', 'thread-a'));
    assert.equal(a._captured.response.length, 0);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /exited with code 7/);
  });

  it('surfaces a CLI that dies before accepting the prompt', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'exit_immediately', FAKE_EXIT_CODE: '3' } });
    await a._handleMessage(msg('hello', 'thread-a'));
    assert.equal(a._captured.error.length, 1, JSON.stringify(a._captured));
    assert.equal(a._captured.response.length, 0);
  });

  it('leaves no child process, timer or listener behind after stop()', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    await a._handleMessage(msg('a', 'thread-a'));
    await a._handleMessage(msg('b', 'thread-b'));
    const procs = Object.values(a._persistentProcs).map((pp) => pp.proc);
    const records = Object.values(a._persistentProcs);
    assert.equal(procs.length, 2);

    a.stop();
    await waitFor(() => procs.every((p) => p.exitCode !== null || p.signalCode !== null), 8000);

    assert.deepEqual(Object.keys(a._persistentProcs), []);
    assert.deepEqual(Object.keys(a._channelProcesses), []);
    for (const pp of records) {
      assert.equal(pp.idleTimer, null, 'idle timer cleared');
      assert.equal(pp.watchdogTimer, null, 'watchdog cleared');
      assert.equal(pp.pending.size, 0, 'no pending RPC left');
      assert.equal(pp.alive, false);
      assert.equal(pp.proc.stdout.listenerCount('data'), 0, 'stdout data listeners removed');
      assert.equal(pp.proc.stderr.listenerCount('data'), 0, 'stderr data listeners removed');
    }
  });
});

/** Poll until `fn()` is truthy, or fail after `timeoutMs`. */
async function waitFor(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
}
