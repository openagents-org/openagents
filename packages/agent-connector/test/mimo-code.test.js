'use strict';

/**
 * MiMo Code adapter — what it changes about OpenCodeAdapter.
 *
 * The CLI is an OpenCode fork, so the event stream itself is covered by
 * opencode.test.js. These pin the differences found running MiMo Code 0.1.14
 * and 0.1.15: where a run is routed and what config it gets, the run
 * arguments, how failures that exit 0 are read, the session kept across a
 * stop, and a Stop that has to reach commands outside the CLI's process group.
 * The process tests drive a stand-in `mimo` that answers the way the real one
 * does.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MiMoCodeAdapter = require('../src/adapters/mimo-code');
const runtime = require('../src/adapters/mimo-code-runtime');
const { ADAPTER_MAP } = require('../src/adapters');

const IS_WINDOWS = process.platform === 'win32';

let home;
let savedHome;
let savedProfile;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-mimo-'));
  savedHome = process.env.HOME;
  savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedProfile;
  fs.rmSync(home, { recursive: true, force: true });
});

function makeAdapter(agentEnv = {}, opts = {}) {
  const adapter = new MiMoCodeAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'ws-token',
    agentName: 'mimo-test',
    agentType: 'mimo-code',
    endpoint: 'http://127.0.0.1:9',
    workingDir: opts.workingDir,
  });
  adapter._log = () => {};
  adapter.agentEnv = agentEnv;
  return adapter;
}

const KEY = { LLM_API_KEY: 'sk-agent', LLM_MODEL: 'mimo-v2.6-pro' };

describe('MiMo Code — registry entry', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'));
  const entry = (registry.agents || registry).find((a) => a.name === 'mimo-code');

  it('is registered with an adapter', () => {
    assert.ok(entry, 'mimo-code entry exists');
    assert.equal(ADAPTER_MAP['mimo-code'], MiMoCodeAdapter);
  });

  it("installs with Xiaomi's own script and checks for `mimo`", () => {
    assert.equal(entry.install.binary, 'mimo');
    assert.equal(entry.install.linux, 'curl -fsSL https://mimo.xiaomi.com/install | bash');
    assert.equal(entry.install.macos, entry.install.linux);
    assert.equal(entry.install.windows, 'irm https://mimo.xiaomi.com/install.ps1 | iex');
  });

  it('takes an optional key, base URL and model, with the base URL prefilled to MiMo', () => {
    const field = (name) => entry.env_config.find((f) => f.name === name);
    // A Xiaomi-account sign-in runs with none of them.
    for (const name of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL']) assert.equal(field(name).required, false, name);
    assert.equal(field('LLM_API_KEY').password, true);
    assert.equal(field('LLM_BASE_URL').default, runtime.MIMO_DEFAULT_BASE_URL);
    assert.equal(entry.check_ready.saved_env_key, 'LLM_API_KEY');
    assert.equal(entry.check_ready.min_version, MiMoCodeAdapter.MIMO_MIN_VERSION);
    // The adapter reads LLM_* itself; a resolve rule would copy the key into
    // a variable MiMo's tools could print.
    assert.equal(entry.resolve_env, undefined);
  });

  it("is ready on a Xiaomi-account sign-in, read from MiMo's auth.json", () => {
    assert.equal(entry.check_ready.login_command, 'mimo providers login -p xiaomi');
    assert.equal(entry.check_ready.creds_file, '~/.local/share/mimocode/auth.json');
    assert.equal(entry.check_ready.creds_key, 'xiaomi');

    const { Installer } = require('../src/installer');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-mimo-ready-'));
    try {
      const auth = path.join(dir, 'auth.json');
      const inst = new Installer({ getEntry: () => null, getResolveRules: () => [] }, dir);
      const checkReady = { ...entry.check_ready, creds_file: auth };
      assert.equal(inst._checkCredsReady(checkReady, 'mimo-code'), false, 'no file');
      fs.writeFileSync(auth, JSON.stringify({ openai: { type: 'api', key: 'k' } }));
      assert.equal(inst._checkCredsReady(checkReady, 'mimo-code'), false, 'another provider is not a Xiaomi sign-in');
      fs.writeFileSync(auth, JSON.stringify({ xiaomi: { type: 'api', key: 'sk', metadata: { uid: '1' } } }));
      assert.equal(inst._checkCredsReady(checkReady, 'mimo-code'), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops XIAOMI_API_KEY with the other credentials of a signed-in agent", () => {
    const { credentialKeys } = require('../src/env');
    assert.ok(credentialKeys('mimo-code', null).has('XIAOMI_API_KEY'));
  });

  it('follows XDG_DATA_HOME to the sign-in, as MiMo and the adapter do', () => {
    assert.equal(entry.check_ready.creds_xdg_data_file, 'mimocode/auth.json');
    const { Installer } = require('../src/installer');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-mimo-xdg-'));
    const saved = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = path.join(dir, 'data');
      const inst = new Installer({ getEntry: () => null, getResolveRules: () => [] }, dir);
      inst._whichBinary = () => null;
      assert.equal(inst._checkCredsReady(entry.check_ready, 'mimo-code'), false);
      const env = { XDG_DATA_HOME: process.env.XDG_DATA_HOME };
      const auth = MiMoCodeAdapter._authFilePath(env);
      fs.mkdirSync(path.dirname(auth), { recursive: true });
      fs.writeFileSync(auth, JSON.stringify({ xiaomi: { type: 'api', key: 'sk' } }));
      assert.equal(inst._checkCredsReady(entry.check_ready, 'mimo-code'), true, 'the file the adapter reads');
      // Set on the agent instead of the daemon: the agent's own setting is the
      // one its CLI runs with.
      delete process.env.XDG_DATA_HOME;
      assert.equal(inst._checkCredsReady(entry.check_ready, 'mimo-code'), false);
      assert.equal(inst._checkCredsReady(entry.check_ready, 'mimo-code', env), true);
      assert.equal(inst._credsFileState({ ...entry.check_ready, creds_no_parse: true }, 'mimo-code', env), 'present');
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('MiMo Code — where a run goes', () => {
  it('sends a key with no base URL to MiMo, on the built-in xiaomi provider', () => {
    const r = runtime.resolveMimoRoute({ LLM_API_KEY: 'k' });
    assert.equal(r.mode, 'key');
    assert.equal(r.baseURL, 'https://api.xiaomimimo.com/v1');
    assert.equal(r.providerId, 'xiaomi');
    // No model of ours: MiMo's catalog decides what it still runs.
    assert.equal(r.modelRef, '');
    const cfg = runtime.buildMimoRunConfig(r);
    assert.equal(cfg.model, undefined);
    assert.deepEqual(cfg.provider, { xiaomi: { options: { baseURL: 'https://api.xiaomimimo.com/v1', apiKey: 'k', headers: null } } });
    assert.equal(makeAdapter({ LLM_API_KEY: 'k' })._modelRequired(), false);
  });

  it('keeps Token Plan endpoints on the xiaomi provider and drops a repeated xiaomi/ prefix', () => {
    const r = runtime.resolveMimoRoute({
      LLM_API_KEY: 'k', LLM_BASE_URL: 'https://token-plan-sgp.xiaomimimo.com/v1', LLM_MODEL: 'xiaomi/mimo-v2.6-flash',
    });
    assert.equal(r.providerId, 'xiaomi');
    assert.equal(r.model, 'mimo-v2.6-flash');
    assert.equal(r.baseURL, 'https://token-plan-sgp.xiaomimimo.com/v1');
  });

  it('declares any other endpoint as its own provider and sends a vendor/model id as written', () => {
    const r = runtime.resolveMimoRoute({
      LLM_API_KEY: 'k', LLM_BASE_URL: 'https://openrouter.ai/api/v1', LLM_MODEL: 'deepseek/deepseek-v4',
    });
    assert.equal(r.providerId, 'openagents');
    assert.equal(r.model, 'deepseek/deepseek-v4');
    assert.equal(r.modelRef, 'openagents/deepseek/deepseek-v4');
  });

  it('has no model to guess for an endpoint that is not MiMo', () => {
    const r = runtime.resolveMimoRoute({ LLM_API_KEY: 'k', LLM_BASE_URL: 'https://example.com/v1' });
    assert.equal(r.modelRef, '');
    const pf = makeAdapter({ LLM_API_KEY: 'k', LLM_BASE_URL: 'https://example.com/v1' });
    pf._opencodeBinary = process.execPath;
    pf._detectCliVersion = () => ({ version: '0.1.15', executable: true });
    assert.equal(pf._preflight().category, 'model_missing');
  });

  it("leaves a sign-in with no model to MiMo's pick, still pinned to xiaomi", () => {
    const route = runtime.resolveMimoRoute({});
    assert.deepEqual(runtime.buildMimoRunConfig(route), { enabled_providers: ['xiaomi'], disabled_providers: [] });
    assert.deepEqual(
      runtime.buildMimoRunArgs({ runCwd: '/work', model: route.modelRef, title: 't' }),
      ['run', '--format', 'json', '--dangerously-skip-permissions', '--dir', '/work', '--title', 't'],
    );
    assert.equal(makeAdapter({})._modelRequired(), false);
    assert.equal(makeAdapter({ LLM_API_KEY: 'k', LLM_BASE_URL: 'http://127.0.0.1:1/v1' })._modelRequired(), true);
  });

  it("uses the workspace's model choice over LLM_MODEL", () => {
    const r = runtime.resolveMimoRoute({ ...KEY }, 'mimo-v2.5');
    assert.equal(r.modelRef, 'xiaomi/mimo-v2.5');
  });

  it("without a key, runs on MiMo Code's own sign-in", () => {
    // No model of ours: what a sign-in may run depends on the account.
    assert.deepEqual(
      runtime.resolveMimoRoute({}),
      { mode: 'signin', providerId: 'xiaomi', model: '', modelRef: '', baseURL: '', apiKey: '' },
    );
    assert.equal(runtime.resolveMimoRoute({ LLM_MODEL: 'xiaomi/mimo-v2.6-pro' }).modelRef, 'xiaomi/mimo-v2.6-pro');
    const own = runtime.resolveMimoRoute({ LLM_MODEL: 'myproxy/some-model' });
    assert.equal(own.providerId, 'myproxy');
    assert.equal(own.model, 'some-model');
  });

  it('knows which runs have a credential', () => {
    assert.equal(makeAdapter(KEY)._credentialState(), 'present');
    assert.equal(makeAdapter({})._credentialState(), 'missing');
    // XIAOMI_API_KEY is MiMo's own way in, not one of this agent's two.
    assert.equal(makeAdapter({ XIAOMI_API_KEY: 'x' })._credentialState(), 'missing');
    assert.equal(makeAdapter({ LLM_MODEL: 'myproxy/m' })._credentialState(), 'unknown');

    const auth = MiMoCodeAdapter._authFilePath({}, home);
    fs.mkdirSync(path.dirname(auth), { recursive: true });
    fs.writeFileSync(auth, JSON.stringify({ xiaomi: { type: 'api', key: '' } }));
    assert.equal(makeAdapter({})._credentialState(), 'missing', 'an entry without a key signs nothing in');
    fs.writeFileSync(auth, JSON.stringify({ xiaomi: { type: 'api', key: 'sk', metadata: { uid: '1' } } }));
    assert.equal(makeAdapter({})._credentialState(), 'present');
  });

  it('gates on the oldest release it was checked against', () => {
    assert.equal(MiMoCodeAdapter._classifyVersion('0.1.13'), 'unsupported');
    assert.equal(MiMoCodeAdapter._classifyVersion('0.1.14'), 'ok');
    assert.equal(MiMoCodeAdapter._classifyVersion('0.1.15'), 'ok');
    assert.equal(MiMoCodeAdapter._classifyVersion('0.1.16'), 'ok');
    assert.equal(MiMoCodeAdapter._classifyVersion('0.1.17'), 'degraded');
    assert.equal(MiMoCodeAdapter._classifyVersion('0.2.0'), 'degraded');
    assert.equal(MiMoCodeAdapter._classifyVersion('dev'), 'unknown');
  });
});

describe('MiMo Code — before a run', () => {
  it('reports runtime_missing at preflight when `mimo` is not installed', () => {
    const adapter = makeAdapter(KEY);
    adapter._opencodeBinary = null;
    adapter._findOpencodeBinary = () => null;
    const pf = adapter.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, 'runtime_missing');
    assert.match(pf.message, /mimo/);

    adapter._findOpencodeBinary = () => '/opt/mimo/bin/mimo';
    assert.deepEqual(adapter.preflight(), { ok: true });
    assert.equal(adapter._opencodeBinary, '/opt/mimo/bin/mimo');
  });

  it('reads $MIMOCODE_HOME/data/auth.json when MIMOCODE_HOME is set, as the CLI does', () => {
    const mimoHome = path.join(home, 'mimo-home');
    assert.equal(MiMoCodeAdapter._authFilePath({ MIMOCODE_HOME: mimoHome, XDG_DATA_HOME: path.join(home, 'xdg') }, home),
      path.join(mimoHome, 'data', 'auth.json'));
    fs.mkdirSync(path.join(mimoHome, 'data'), { recursive: true });
    fs.writeFileSync(path.join(mimoHome, 'data', 'auth.json'), JSON.stringify({ xiaomi: { type: 'api', key: 'k-home' } }));
    assert.equal(makeAdapter({ MIMOCODE_HOME: mimoHome })._credentialState(), 'present');
    assert.equal(makeAdapter({})._credentialState(), 'missing');

    const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'));
    const entry = (registry.agents || registry).find((a) => a.name === 'mimo-code');
    const { Installer } = require('../src/installer');
    const inst = new Installer({ getEntry: () => null, getResolveRules: () => [] }, home);
    inst._whichBinary = () => null;
    assert.equal(inst._checkCredsReady(entry.check_ready, 'mimo-code', { MIMOCODE_HOME: mimoHome }), true);
    assert.equal(inst._checkCredsReady(entry.check_ready, 'mimo-code', { MIMOCODE_HOME: path.join(home, 'none') }), false);
  });

  it("masks the sign-in key from auth.json in a failure notice, whatever its shape", async () => {
    // Not sk-shaped, too short and not hex: no pattern rule knows it.
    const signInKey = 'mimo-cli-key-ABCdef123';
    const OpenCodeAdapter = require('../src/adapters/opencode');
    assert.ok(OpenCodeAdapter._redact(`x ${signInKey}`).includes(signInKey), 'the pattern rules alone miss it');

    const auth = MiMoCodeAdapter._authFilePath({}, home);
    fs.mkdirSync(path.dirname(auth), { recursive: true });
    fs.writeFileSync(auth, JSON.stringify({ xiaomi: { type: 'api', key: signInKey } }));
    const adapter = makeAdapter({});
    const sent = [];
    adapter.client = { sendMessage: async (_ws, _ch, _tok, content) => { sent.push(content); } };
    await adapter._sendClassifiedError('thread', 'credential_invalid', `401 Unauthorized for ${signInKey} at api.xiaomimimo.com`);
    assert.equal(sent.length, 1);
    assert.ok(!sent[0].includes(signInKey), sent[0]);
    assert.match(sent[0], /\[REDACTED\]/);

    // A configured key of the same kind, too.
    const keyed = makeAdapter({ LLM_API_KEY: 'plain-key-XYZ789' });
    keyed.client = adapter.client;
    await keyed._sendClassifiedError('thread', 'credential_invalid', 'rejected plain-key-XYZ789');
    assert.ok(!sent[1].includes('plain-key-XYZ789'), sent[1]);
  });
});

describe('MiMo Code — the config a run starts with', () => {
  it('pins the run to the one provider, with the key and base URL as configured', () => {
    const route = runtime.resolveMimoRoute({ ...KEY, LLM_BASE_URL: 'https://api.xiaomimimo.com/v1' });
    const cfg = runtime.buildMimoRunConfig(route);
    assert.deepEqual(cfg.enabled_providers, ['xiaomi']);
    assert.deepEqual(cfg.disabled_providers, []);
    const ref = 'xiaomi/mimo-v2.6-pro';
    assert.equal(cfg.model, ref);
    assert.equal(cfg.small_model, ref);
    assert.deepEqual(cfg.model_groups, { lite: ref, standard: ref, ultra: ref });
    assert.deepEqual(cfg.agent, { general: { model: ref }, explore: { model: ref } });
    assert.deepEqual(cfg.provider, {
      xiaomi: {
        options: { baseURL: 'https://api.xiaomimimo.com/v1', apiKey: 'sk-agent', headers: null },
        // `beta` keeps a model MiMo's catalog has deprecated runnable.
        models: { 'mimo-v2.6-pro': { id: 'mimo-v2.6-pro', name: 'mimo-v2.6-pro', status: 'beta' } },
      },
    });
  });

  it('declares another endpoint as an OpenAI-compatible provider', () => {
    const route = runtime.resolveMimoRoute({ LLM_API_KEY: 'k', LLM_BASE_URL: 'http://127.0.0.1:1/v1', LLM_MODEL: 'm' });
    const p = runtime.buildMimoRunConfig(route).provider.openagents;
    assert.equal(p.npm, '@ai-sdk/openai-compatible');
    assert.deepEqual(p.options, { baseURL: 'http://127.0.0.1:1/v1', apiKey: 'k', headers: null });
  });

  it("runs a key and a sign-in each on its own credential, never on what MiMo has stored", () => {
    const keyEnv = makeAdapter({ ...KEY, XIAOMI_API_KEY: 'env-key' })._spawnEnv('thread');
    assert.equal(keyEnv.MIMOCODE_AUTH_CONTENT, '{}');
    assert.equal(keyEnv.XIAOMI_API_KEY, undefined);

    const auth = MiMoCodeAdapter._authFilePath({}, home);
    fs.mkdirSync(path.dirname(auth), { recursive: true });
    fs.writeFileSync(auth, JSON.stringify({ xiaomi: { type: 'api', key: 'tp-signed-in', metadata: { uid: '1', base_url: 'https://token-plan-cn.xiaomimimo.com/v1' } } }));
    const signedIn = makeAdapter({ XIAOMI_API_KEY: 'env-key', LLM_MODEL: 'xiaomi/mimo-v2.6-pro' });
    const env = signedIn._spawnEnv('thread');
    assert.equal(env.MIMOCODE_AUTH_CONTENT, '{}', "the sign-in is declared for the run, so the store is not read");
    assert.equal(env.XIAOMI_API_KEY, undefined);
    const cfg = JSON.parse(env.MIMOCODE_CONFIG_CONTENT);
    // Declared like a key: the user's own provider.xiaomi options cannot replace it.
    assert.deepEqual(cfg.provider.xiaomi.options, { baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', apiKey: 'tp-signed-in', headers: null });
    assert.equal(cfg.model, 'xiaomi/mimo-v2.6-pro');

    // A provider of the user's own MiMo setup reads MiMo's store, as theirs.
    assert.equal(makeAdapter({ LLM_MODEL: 'myproxy/m' })._spawnEnv('thread').MIMOCODE_AUTH_CONTENT, undefined);
  });

  it("asks the CLI for a model when none is set, so the user's own model settings cannot take it", { skip: IS_WINDOWS && 'the stand-in CLI is a POSIX script' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-mimo-models-'));
    try {
      const bin = path.join(dir, 'mimo');
      fs.writeFileSync(bin, `#!${process.execPath}\nif (process.env.MIMOCODE_AUTH_CONTENT !== '{}') process.exit(1);\nprocess.stdout.write('xiaomi/mimo-v2.6-flash — window 1.05M\\nxiaomi/mimo-v2.6-pro — window 1.05M\\n');\n`);
      fs.chmodSync(bin, 0o755);
      const a = makeAdapter({ LLM_API_KEY: 'sk-agent' });
      a._opencodeBinary = bin;
      assert.equal(a._resolveModel(), '');
      await a._ensureFallbackModel();
      assert.equal(a._resolveModel(), 'xiaomi/mimo-v2.6-pro');
      const cfg = runtime.buildMimoRunConfig(a._route());
      assert.equal(cfg.model, 'xiaomi/mimo-v2.6-pro');
      assert.deepEqual(cfg.agent, { general: { model: 'xiaomi/mimo-v2.6-pro' }, explore: { model: 'xiaomi/mimo-v2.6-pro' } });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('declares no provider on a sign-in, only pins to it', () => {
    const cfg = runtime.buildMimoRunConfig(runtime.resolveMimoRoute({}));
    assert.equal(cfg.provider, undefined);
    assert.deepEqual(cfg.enabled_providers, ['xiaomi']);
  });

  it('carries the workspace MCP server and the briefing file', () => {
    const cfg = runtime.buildMimoRunConfig(runtime.resolveMimoRoute(KEY), {
      mcp: { command: '/node', args: ['cli.js', 'mcp-server'], env: { OA_WORKSPACE_TOKEN: 't' } },
      instructions: ['/brief.md'],
    });
    assert.deepEqual(cfg.mcp, {
      'openagents-workspace': { type: 'local', command: ['/node', 'cli.js', 'mcp-server'], environment: { OA_WORKSPACE_TOKEN: 't' } },
    });
    assert.deepEqual(cfg.instructions, ['/brief.md']);
  });

  it('hands the CLI the config, the scheduler off, and the key only inside the config', () => {
    const adapter = makeAdapter({ ...KEY, PATH: '/bin' });
    const env = adapter._spawnEnv('thread');
    assert.equal(env.LLM_API_KEY, undefined);
    assert.equal(env.MIMOCODE_EXPERIMENTAL_CRON, '0');
    assert.equal(env.MIMOCODE_DISABLE_CLAUDE_CODE_MCP, '1');
    assert.equal(env.MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT, '1');
    assert.equal(env.MIMOCODE_DISABLE_AUTOUPDATE, '1');
    assert.equal(env.PATH, '/bin');
    const cfg = JSON.parse(env.MIMOCODE_CONFIG_CONTENT);
    assert.equal(cfg.provider.xiaomi.options.apiKey, 'sk-agent');
    const mcp = cfg.mcp['openagents-workspace'];
    assert.match(mcp.command[1], /bin[\\/]agent-connector\.js$/);
    assert.deepEqual(mcp.command.slice(2, 6), ['mcp-server', '--workspace-id', 'ws', '--channel-name']);
    assert.equal(mcp.command[6], 'thread');
    assert.deepEqual(mcp.environment, { OA_WORKSPACE_TOKEN: 'ws-token' });
  });

  it('passes the briefing as instructions once written, and not in the message', () => {
    const adapter = makeAdapter(KEY);
    adapter._writeInstructions('thread');
    const file = adapter._instructionsPath('thread');
    assert.match(fs.readFileSync(file, 'utf-8'), /You are agent 'mimo-test'/);
    assert.deepEqual(JSON.parse(adapter._spawnEnv('thread').MIMOCODE_CONFIG_CONTENT).instructions, [file]);
    assert.equal(adapter._composePrompt('hello', 'thread', null), 'hello');
    // A channel whose briefing could not be written falls back to the preamble.
    assert.match(adapter._composePrompt('hello', 'other', null), /You are agent 'mimo-test'[\s\S]*---\n\nhello$/);
  });
});

describe('MiMo Code — run arguments', () => {
  const adapter = makeAdapter(KEY);

  it('runs headless with permissions bypassed, in the working dir, titling a new session', () => {
    assert.deepEqual(
      adapter._buildRunArgs({ runCwd: '/work', model: 'xiaomi/m', sessionId: null, channel: 'thread' }),
      ['run', '--format', 'json', '--dangerously-skip-permissions', '--dir', '/work', '--model', 'xiaomi/m', '--title', 'OpenAgents - thread'],
    );
  });

  it('resumes the channel session without retitling it', () => {
    const args = adapter._buildRunArgs({ runCwd: '/work', model: 'xiaomi/m', sessionId: 'ses_1', channel: 'thread' });
    assert.deepEqual(args.slice(-2), ['--session', 'ses_1']);
    assert.equal(args.includes('--title'), false);
  });

  it("uses MiMo's plan agent in plan mode", () => {
    const planning = makeAdapter(KEY);
    planning._mode = 'plan';
    const args = planning._buildRunArgs({ runCwd: '/w', model: 'xiaomi/m', sessionId: null, channel: 'c' });
    assert.deepEqual(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 2), ['--agent', 'plan']);
  });
});

describe('MiMo Code — reading failures', () => {
  // What 0.1.15 prints without a credential: a slice of its bundled source,
  // the error line, a stack — and exit 0 with nothing on stdout.
  const NO_CREDENTIAL = [
    '858 | `));let C=k.outputs[0];/* network timeout fetch failed */',
    '',
    'error: MiMo free API service has ended. Sign in or configure a third-party API.',
    '      at /$bunfs/root/chunk-3zb47vqp.js:863:31140',
  ].join('\n');

  const NO_SESSION = [
    'NotFoundError: NotFoundError',
    ' data: {',
    '  message: "Session not found: ses_gone",',
    '},',
    '',
    '      at <anonymous> (/$bunfs/root/chunk-3zb47vqp.js:866:10852)',
  ].join('\n');

  it('reads the error line, not the source around it', () => {
    assert.equal(runtime.mimoErrorLine(NO_CREDENTIAL), 'MiMo free API service has ended. Sign in or configure a third-party API.');
    assert.equal(runtime.mimoErrorLine(NO_SESSION), 'NotFoundError: Session not found: ses_gone');
    assert.equal(runtime.mimoErrorLine('plain noise'), '');
  });

  it('reports a missing credential, not an empty reply', () => {
    const out = MiMoCodeAdapter._outcomeForCleanExit({ stdout: '', stderr: NO_CREDENTIAL });
    assert.equal(out.failure.category, 'credential_missing');
  });

  it('reports a session the CLI no longer has', () => {
    const out = MiMoCodeAdapter._outcomeForCleanExit({ stdout: '', stderr: NO_SESSION });
    assert.equal(out.failure.category, 'session_missing');
  });

  it("classifies an API error event on stdout the way OpenCode's is", () => {
    const stdout = JSON.stringify({
      type: 'error', sessionID: 'ses_1',
      error: { name: 'APIError', data: { message: 'Invalid API Key: Please provide valid API Key', statusCode: 401, isRetryable: false } },
    });
    const stdoutErr = MiMoCodeAdapter._extractErrorFromStdout(stdout);
    assert.equal(MiMoCodeAdapter._outcomeForCleanExit({ stdout, stderr: '', stdoutErr }).failure.category, 'auth_failed');
  });

  it("reads MiMo's answer to a model it does not serve as model_not_found", () => {
    // What api.xiaomimimo.com returns (HTTP 400) for an unknown model id.
    const stdout = JSON.stringify({
      type: 'error', sessionID: 'ses_1',
      error: { name: 'APIError', data: { message: 'Unsupported model mimo-v9-nope', statusCode: 400, isRetryable: false } },
    });
    const stdoutErr = MiMoCodeAdapter._extractErrorFromStdout(stdout);
    assert.equal(MiMoCodeAdapter._outcomeForCleanExit({ stdout, stderr: '', stdoutErr }).failure.category, 'model_not_found');
  });

  it('has a message for every category it can report', () => {
    const messages = makeAdapter()._failureMessages();
    for (const c of ['session_missing', 'credential_missing', 'auth_failed', 'timeout', 'unsupported_version']) {
      assert.ok(messages[c], c);
      assert.match(messages[c], /MiMo|model service/);
    }
  });
});

describe('MiMo Code — process tree', () => {
  it('finds every descendant, nearest first, and nothing else', () => {
    const rows = runtime.parseProcessTable([
      '  100     1   100',
      '  200   100   100',
      '  300   200   300',
      '  301   300   300',
      '  400     1   400',
      'garbage',
    ].join('\n'));
    assert.deepEqual(runtime.descendantsOf(rows, 100).map((r) => r.pid), [200, 300, 301]);
    assert.deepEqual(runtime.descendantsOf(rows, 400), []);
  });
});

// ---------------------------------------------------------------------------
// Against a stand-in CLI
// ---------------------------------------------------------------------------

/**
 * A `mimo` that answers the way 0.1.15 does: `--version`, OpenCode's JSON
 * events for `run`, the NotFoundError dump for an unknown --session, and — in
 * hang mode — a shell command started in a session of its own that only a
 * tree-aware Stop reaches.
 */
function writeFakeCli(dir) {
  const file = path.join(dir, 'mimo');
  fs.writeFileSync(file, `#!${process.execPath}
'use strict';
const fs = require('fs');
const { spawn } = require('child_process');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('0.1.15'); process.exit(0); }
if (argv[0] === 'models') {
  if (process.env.FAKE_MODELS === 'hang') { setInterval(() => {}, 1000); return; }
  console.log('xiaomi/mimo-v2.6-pro — window 1.05M, compacts at 944K');
  process.exit(0);
}
const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  if (process.env.FAKE_LOG) {
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({
      argv, input, config: process.env.MIMOCODE_CONFIG_CONTENT, key: process.env.LLM_API_KEY || null,
      cron: process.env.MIMOCODE_EXPERIMENTAL_CRON,
    }) + '\\n');
  }
  const session = at('--session');
  if (session === 'ses_gone') {
    process.stderr.write('NotFoundError: NotFoundError\\n data: {\\n  message: "Session not found: ses_gone",\\n},\\n');
    process.exit(0);
  }
  const sid = session || 'ses_fresh';
  const emit = (e) => process.stdout.write(JSON.stringify({ timestamp: 1, sessionID: sid, ...e }) + '\\n');
  emit({ type: 'step_start', part: { type: 'step-start', sessionID: sid } });
  if (process.env.FAKE_MODE === 'hang') {
    const child = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync(process.env.FAKE_CHILD, String(child.pid));
    setInterval(() => {}, 1000);
    return;
  }
  emit({ type: 'reasoning', part: { type: 'reasoning', text: 'thinking it over' } });
  emit({ type: 'text', part: { type: 'text', text: 'pong: ' + input.trim() } });
  emit({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } });
});
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function cliAdapter(extraEnv = {}) {
  const work = fs.mkdtempSync(path.join(home, 'work-'));
  const bin = writeFakeCli(home);
  const log = path.join(home, 'calls.jsonl');
  const adapter = makeAdapter({ ...KEY, PATH: process.env.PATH, FAKE_LOG: log, ...extraEnv }, { workingDir: work });
  adapter._opencodeBinary = bin;
  adapter._findOpencodeBinary = () => bin;
  adapter.getBrowserEnabled = async () => false;
  adapter.sendStatus = async () => {};
  adapter.sendThinking = async () => {};
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { adapter, calls, work };
}

describe('MiMo Code — a run against the CLI', { skip: IS_WINDOWS && 'the stand-in CLI is a POSIX script' }, () => {
  it('sends the message as typed, answers with the reply text, and remembers the session', async () => {
    const { adapter, calls, work } = cliAdapter();
    const reply = await adapter._runOpencode('hello', 'thread');
    assert.equal(reply, 'pong: hello');
    assert.equal(adapter._channelSessions.thread, 'ses_fresh');

    const [call] = calls();
    assert.equal(call.input, 'hello');
    assert.equal(call.key, null);
    assert.equal(call.cron, '0');
    assert.deepEqual(call.argv.slice(0, 6), ['run', '--format', 'json', '--dangerously-skip-permissions', '--dir', work]);
    const cfg = JSON.parse(call.config);
    assert.deepEqual(cfg.instructions, [adapter._instructionsPath('thread')]);
    assert.ok(fs.existsSync(adapter._instructionsPath('thread')));
    assert.equal(fs.readdirSync(work).length, 0, 'nothing is written into the project');

    await adapter._runOpencode('again', 'thread');
    assert.deepEqual(calls()[1].argv.slice(-2), ['--session', 'ses_fresh']);
  });

  it('starts over once when the CLI no longer has the session', async () => {
    const { adapter, calls } = cliAdapter();
    adapter._channelSessions.thread = 'ses_gone';
    const reply = await adapter._runOpencode('still there?', 'thread');
    assert.equal(reply, 'pong: still there?');
    assert.equal(adapter._channelSessions.thread, 'ses_fresh');
    const [first, second] = calls();
    assert.deepEqual(first.argv.slice(-2), ['--session', 'ses_gone']);
    assert.equal(second.argv.includes('--session'), false);
  });

  it('keeps the session of a stopped turn and ends the command it was running', { timeout: 20000 }, async () => {
    const childFile = path.join(home, 'child.pid');
    const { adapter } = cliAdapter({ FAKE_MODE: 'hang', FAKE_CHILD: childFile });
    const run = adapter._runOpencode('long task', 'thread');

    let child = 0;
    for (let i = 0; i < 100 && !child; i++) {
      await new Promise((r) => setTimeout(r, 50));
      try { child = Number(fs.readFileSync(childFile, 'utf-8')); } catch {}
    }
    assert.ok(child > 0, 'the stand-in started its command');
    for (let i = 0; i < 100 && !adapter._channelSessions.thread; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(adapter._channelSessions.thread, 'ses_fresh', 'session recorded from the stream, before the run ends');

    await adapter._onControlAction('stop', { channel: 'thread' });
    assert.equal(await run, '');
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try { process.kill(child, 0); await new Promise((r) => setTimeout(r, 50)); } catch { alive = false; }
    }
    assert.equal(alive, false, 'the command outside the CLI process group was ended');
  });

  it('a Stop during the model lookup ends it and starts no run', { timeout: 20000 }, async () => {
    const { adapter, calls } = cliAdapter({ LLM_MODEL: '', FAKE_MODELS: 'hang' });
    // As a real turn does: the stop is measured against the turn's start.
    adapter._channelRunGeneration.thread = adapter._stopGenerationFor('thread');
    const run = adapter._runOpencode('hi', 'thread');
    for (let i = 0; i < 100 && !adapter._modelLookups.has('thread'); i++) await new Promise((r) => setTimeout(r, 20));
    const lookup = adapter._modelLookups.get('thread');
    assert.ok(lookup, 'the lookup is running');

    const started = Date.now();
    await adapter._onControlAction('stop', { channel: 'thread' });
    assert.equal(await run, '');
    assert.ok(Date.now() - started < 10000, 'not held for the lookup timeout');
    assert.ok(lookup.signalCode || lookup.exitCode !== null, 'the lookup process was ended');
    assert.equal(calls().length, 0, 'no run was started');
  });
});
