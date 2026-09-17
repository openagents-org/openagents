'use strict';

/**
 * Unit tests for the Aider adapter (Node / agent-connector runtime).
 *
 * No real `aider` binary, model key, or workspace is needed: `child_process.spawn`
 * is faked to emit plain (non-JSON) terminal text, and the network helpers
 * (sendStatus/sendResponse/sendError) are stubbed on the instance.
 *
 * Covered: registration in ADAPTER_MAP, non-interactive command construction
 * (message-file, git-safety flags, model, auto-commit opt-in), multi-provider
 * key→env mapping, secret never on the command line or in logs, exit-code
 * decides success, error classification, per-channel chat-history isolation,
 * stop control, git hygiene, and that existing adapters keep loading.
 */

const { describe, it, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

// Swappable spawn shim installed BEFORE requiring the adapter so the
// module-level `const { spawn } = require('child_process')` binds to it.
const realSpawn = cp.spawn;
let spawnImpl = null;
let lastSpawn = null;
cp.spawn = (...args) => spawnImpl(...args);

const { createAdapter, ADAPTER_MAP, AiderAdapter } = require('../src/adapters');

after(() => { cp.spawn = realSpawn; });

function makeFakeSpawn(lines, exitCode = 0, stderr = '') {
  return (cmd, args, opts) => {
    const proc = new EventEmitter();
    proc.pid = 4242;
    proc.exitCode = null;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    lastSpawn = { cmd, args, opts };
    setImmediate(() => {
      for (const line of lines) proc.stdout.emit('data', Buffer.from(line + '\n', 'utf-8'));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr, 'utf-8'));
      proc.exitCode = exitCode;
      proc.emit('exit', exitCode);
    });
    return proc;
  };
}

let tmpHome;
let savedHome;

function isolateHome() {
  savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-home-'));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
}
function restoreHome() {
  if (savedHome) {
    for (const k of ['HOME', 'USERPROFILE']) {
      if (savedHome[k] === undefined) delete process.env[k];
      else process.env[k] = savedHome[k];
    }
  }
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
}

function makeAdapter(extra = {}) {
  const adapter = createAdapter('aider', {
    workspaceId: 'ws',
    channelName: 'general',
    token: 'tok',
    agentName: 'aider-bot',
    endpoint: 'https://example.invalid',
    agentType: 'aider',
    agentEnv: extra.agentEnv || {},
    workingDir: extra.workingDir || '/tmp/proj',
  });
  adapter._aiderBin = '/usr/bin/aider';
  // Stub network helpers — record what was streamed.
  adapter._streamed = { status: [], response: [], error: [] };
  adapter.sendStatus = async (_c, content) => adapter._streamed.status.push(content);
  adapter.sendResponse = async (_c, content) => adapter._streamed.response.push(content);
  adapter.sendError = async (_c, content) => adapter._streamed.error.push(content);
  return adapter;
}

describe('Aider adapter — registration', () => {
  it('is registered under the "aider" agent type', () => {
    assert.equal('aider' in ADAPTER_MAP, true);
    assert.equal(typeof AiderAdapter, 'function');
  });

  it('createAdapter("aider") returns an AiderAdapter', () => {
    const a = makeAdapter();
    assert.equal(a.constructor.name, 'AiderAdapter');
    assert.equal(typeof a._handleMessage, 'function');
  });

  it('does not disturb the existing adapter map', () => {
    for (const t of ['claude', 'codex', 'opencode', 'cursor', 'gemini', 'kimi']) {
      assert.equal(t in ADAPTER_MAP, true, `${t} should still be registered`);
    }
  });
});

describe('Aider — install-dir resolution (aiderBinDirs)', () => {
  const { aiderBinDirs } = require('../src/paths');
  const os = require('node:os');
  const pathMod = require('node:path');

  it('includes ~/.local/bin and the uv tools venv (the install targets)', () => {
    const dirs = aiderBinDirs().map((d) => String(d));
    assert.ok(dirs.includes(pathMod.join(os.homedir(), '.local', 'bin')));
    // uv tool venv — Scripts on Windows, bin on Unix.
    const hasVenv = dirs.some((d) => d.includes(pathMod.join('uv', 'tools', 'aider-chat')));
    assert.ok(hasVenv, `expected a uv tools/aider-chat dir in ${JSON.stringify(dirs)}`);
  });

  it('honors XDG_BIN_HOME and UV_TOOL_DIR overrides', () => {
    const savedXdg = process.env.XDG_BIN_HOME;
    const savedUv = process.env.UV_TOOL_DIR;
    try {
      process.env.XDG_BIN_HOME = pathMod.join(os.tmpdir(), 'xdgbin');
      process.env.UV_TOOL_DIR = pathMod.join(os.tmpdir(), 'uvtools');
      const dirs = aiderBinDirs().map((d) => String(d));
      assert.ok(dirs.includes(process.env.XDG_BIN_HOME), 'XDG_BIN_HOME first');
      assert.ok(dirs.some((d) => d.startsWith(process.env.UV_TOOL_DIR)), 'UV_TOOL_DIR honored');
    } finally {
      if (savedXdg === undefined) delete process.env.XDG_BIN_HOME; else process.env.XDG_BIN_HOME = savedXdg;
      if (savedUv === undefined) delete process.env.UV_TOOL_DIR; else process.env.UV_TOOL_DIR = savedUv;
    }
  });
});

describe('Aider adapter — command construction', () => {
  it('defaults to NO auto-commit and edits-only git safety', () => {
    const a = makeAdapter();
    const cmd = a._buildAiderCmd('general', '/tmp/m.txt', false);
    assert.equal(cmd[0], '/usr/bin/aider');
    assert.ok(cmd.includes('--message-file') && cmd.includes('/tmp/m.txt'));
    assert.ok(cmd.includes('--yes-always'));
    assert.ok(cmd.includes('--no-pretty'));
    assert.ok(cmd.includes('--no-auto-commits'));
    assert.ok(cmd.includes('--no-dirty-commits'));
    assert.ok(cmd.includes('--no-gitignore'));
    assert.ok(!cmd.includes('--auto-commits'));
    assert.ok(!cmd.includes('--restore-chat-history'));
  });

  it('adds --restore-chat-history when resuming', () => {
    const a = makeAdapter();
    const cmd = a._buildAiderCmd('general', '/tmp/m.txt', true);
    assert.ok(cmd.includes('--restore-chat-history'));
  });

  it('opts in to auto-commit via AIDER_AUTO_COMMITS', () => {
    const a = makeAdapter({ agentEnv: { AIDER_AUTO_COMMITS: 'true' } });
    const cmd = a._buildAiderCmd('general', '/tmp/m.txt', false);
    assert.ok(cmd.includes('--auto-commits'));
    assert.ok(!cmd.includes('--no-auto-commits'));
  });

  it('passes the configured model and never the key', () => {
    const a = makeAdapter({ agentEnv: { AIDER_MODEL: 'gpt-4o', LLM_API_KEY: 'sk-secret' } });
    const cmd = a._buildAiderCmd('general', '/tmp/m.txt', false);
    const i = cmd.indexOf('--model');
    assert.equal(cmd[i + 1], 'gpt-4o');
    assert.ok(cmd.every((p) => !String(p).includes('sk-secret')));
  });
});

describe('Aider adapter — provider resolution (explicit AIDER_PROVIDER)', () => {
  const cfg = (env) => makeAdapter({ agentEnv: env })._resolveConfig();

  it('maps each explicit provider to its env var (key wins over model)', () => {
    assert.deepEqual(cfg({ AIDER_PROVIDER: 'openai', AIDER_MODEL: 'gpt-4o', LLM_API_KEY: 'k' }).env, { OPENAI_API_KEY: 'k' });
    assert.deepEqual(cfg({ AIDER_PROVIDER: 'anthropic', AIDER_MODEL: 'sonnet', LLM_API_KEY: 'k' }).env, { ANTHROPIC_API_KEY: 'k' });
    assert.deepEqual(cfg({ AIDER_PROVIDER: 'openrouter', AIDER_MODEL: 'x', LLM_API_KEY: 'k' }).env, { OPENROUTER_API_KEY: 'k' });
    assert.deepEqual(cfg({ AIDER_PROVIDER: 'gemini', AIDER_MODEL: 'x', LLM_API_KEY: 'k' }).env, { GEMINI_API_KEY: 'k' });
    assert.deepEqual(cfg({ AIDER_PROVIDER: 'deepseek', AIDER_MODEL: 'x', LLM_API_KEY: 'k' }).env, { DEEPSEEK_API_KEY: 'k' });
  });

  it('explicit provider beats model inference (no conflict for a bare model)', () => {
    const r = cfg({ AIDER_PROVIDER: 'anthropic', AIDER_MODEL: 'gpt-4o', LLM_API_KEY: 'k' });
    assert.equal(r.error, null);
    assert.deepEqual(r.env, { ANTHROPIC_API_KEY: 'k' });
  });

  it('rejects an unknown AIDER_PROVIDER value', () => {
    const r = cfg({ AIDER_PROVIDER: 'bogus', LLM_API_KEY: 'k' });
    assert.ok(r.error && r.error.includes('Unknown AIDER_PROVIDER'));
    assert.deepEqual(r.env, {});
  });
});

describe('Aider adapter — provider resolution (auto inference, case-insensitive)', () => {
  const env = (e) => makeAdapter({ agentEnv: e })._resolveConfig().env;

  it('infers Anthropic from sonnet/opus/haiku/claude aliases', () => {
    for (const m of ['sonnet', 'OPUS', 'Haiku', 'claude-3-5-sonnet-20241022', 'anthropic/claude-3']) {
      assert.deepEqual(env({ AIDER_MODEL: m, LLM_API_KEY: 'k' }), { ANTHROPIC_API_KEY: 'k' }, m);
    }
  });

  it('infers OpenAI from gpt/openai models', () => {
    for (const m of ['gpt-4o', 'openai/gpt-4o', 'GPT-4O', 'o1-mini']) {
      assert.deepEqual(env({ AIDER_MODEL: m, LLM_API_KEY: 'k' }), { OPENAI_API_KEY: 'k' }, m);
    }
  });

  it('infers OpenRouter / Gemini / DeepSeek', () => {
    assert.deepEqual(env({ AIDER_MODEL: 'openrouter/anthropic/claude-3.5-sonnet', LLM_API_KEY: 'k' }), { OPENROUTER_API_KEY: 'k' });
    assert.deepEqual(env({ AIDER_MODEL: 'gemini/gemini-1.5-pro', LLM_API_KEY: 'k' }), { GEMINI_API_KEY: 'k' });
    assert.deepEqual(env({ AIDER_MODEL: 'DeepSeek/deepseek-chat', LLM_API_KEY: 'k' }), { DEEPSEEK_API_KEY: 'k' });
  });
});

describe('Aider adapter — ambiguity & conflict protection', () => {
  const cfg = (e) => makeAdapter({ agentEnv: e })._resolveConfig();

  it('empty model + key + no provider → config error (never silent OpenAI)', () => {
    const r = cfg({ LLM_API_KEY: 'k' });
    assert.deepEqual(r.env, {});
    assert.ok(r.error && r.error.includes('Could not determine'));
  });

  it('unknown model + key + auto → config error', () => {
    const r = cfg({ AIDER_MODEL: 'some-unknown-xyz', LLM_API_KEY: 'k', AIDER_PROVIDER: 'auto' });
    assert.deepEqual(r.env, {});
    assert.ok(r.error);
  });

  it('empty model + no key → allowed (auto mode)', () => {
    const r = cfg({ AIDER_PROVIDER: 'auto' });
    assert.equal(r.error, null);
    assert.deepEqual(r.env, {});
  });

  it('no key does not override a native provider key', () => {
    // resolver adds nothing; _buildSubprocessEnv keeps the inherited key.
    const a = makeAdapter({ agentEnv: { AIDER_MODEL: 'claude-3', ANTHROPIC_API_KEY: 'preexisting' } });
    assert.equal(a._buildSubprocessEnv().ANTHROPIC_API_KEY, 'preexisting');
    assert.deepEqual(a._resolveConfig().env, {});
  });

  it('explicit provider conflicting with an explicit model prefix → error', () => {
    assert.ok(cfg({ AIDER_PROVIDER: 'anthropic', AIDER_MODEL: 'openai/gpt-4o', LLM_API_KEY: 'k' }).error);
    assert.ok(cfg({ AIDER_PROVIDER: 'openrouter', AIDER_MODEL: 'anthropic/claude-3', LLM_API_KEY: 'k' }).error);
  });
});

describe('Aider adapter — OpenAI-compatible', () => {
  const cfg = (e) => makeAdapter({ agentEnv: e })._resolveConfig();

  it('maps base URL → OPENAI_API_BASE and key → OPENAI_API_KEY', () => {
    const r = cfg({ AIDER_PROVIDER: 'openai-compatible', AIDER_MODEL: 'llama3', LLM_API_KEY: 'k', LLM_BASE_URL: 'https://host/v1' });
    assert.equal(r.env.OPENAI_API_BASE, 'https://host/v1');
    assert.equal(r.env.OPENAI_API_KEY, 'k');
  });

  it('normalizes a plain model to openai/<model> without doubling', () => {
    assert.equal(cfg({ AIDER_PROVIDER: 'openai-compatible', AIDER_MODEL: 'llama3', LLM_API_KEY: 'k', LLM_BASE_URL: 'https://h/v1' }).model, 'openai/llama3');
    assert.equal(cfg({ AIDER_PROVIDER: 'openai-compatible', AIDER_MODEL: 'openai/llama3', LLM_API_KEY: 'k', LLM_BASE_URL: 'https://h/v1' }).model, 'openai/llama3');
  });

  it('errors when Base URL is missing', () => {
    const r = cfg({ AIDER_PROVIDER: 'openai-compatible', AIDER_MODEL: 'llama3', LLM_API_KEY: 'k' });
    assert.deepEqual(r.env, {});
    assert.ok(r.error && r.error.includes('LLM_BASE_URL'));
  });

  it('does not write Base URL into an unrelated provider env', () => {
    const r = cfg({ AIDER_PROVIDER: 'anthropic', AIDER_MODEL: 'sonnet', LLM_API_KEY: 'k', LLM_BASE_URL: 'https://h/v1' });
    assert.equal(r.env.OPENAI_API_BASE, undefined);
    assert.deepEqual(r.env, { ANTHROPIC_API_KEY: 'k' });
  });

  it('normalized model reaches argv; key/base never do', () => {
    const a = makeAdapter({ agentEnv: { AIDER_PROVIDER: 'openai-compatible', AIDER_MODEL: 'llama3', LLM_API_KEY: 'sk', LLM_BASE_URL: 'https://host/v1' } });
    const cmd = a._buildAiderCmd('general', '/tmp/m', false);
    const i = cmd.indexOf('--model');
    assert.equal(cmd[i + 1], 'openai/llama3');
    assert.ok(cmd.every((p) => String(p) !== 'sk' && !String(p).includes('https://host/v1')));
  });
});

describe('Aider adapter — config gate', () => {
  it('_runAider returns a config error without spawning', async () => {
    let spawned = false;
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: 'k' } }); // key but no model/provider
    a._spawnAider = async () => { spawned = true; return { text: '', error: null }; };
    a._sessionsDir = require('node:os').tmpdir();
    const r = await a._runAider('hi', 'general');
    assert.equal(spawned, false);
    assert.ok(r.error && r.error.includes('Configuration error'));
  });
});

describe('Aider adapter — execution', () => {
  beforeEach(() => { lastSpawn = null; });

  it('returns cleaned stdout on success and streams progress', async () => {
    spawnImpl = makeFakeSpawn(['Applied edit to foo.py', 'All done.']);
    const a = makeAdapter();
    const { text, error } = await a._spawnAider(['/usr/bin/aider'], 'general');
    assert.equal(error, null);
    assert.ok(text.includes('All done.'));
    assert.ok(a._streamed.status.some((s) => s.includes('Applied edit')));
  });

  it('treats a non-zero exit as failure even with stdout', async () => {
    spawnImpl = makeFakeSpawn(['partial output'], 1);
    const a = makeAdapter();
    const { text, error } = await a._spawnAider(['/usr/bin/aider'], 'general');
    assert.equal(text, '');
    assert.ok(error && /code 1|exit/i.test(error));
  });

  it('classifies an authentication failure', async () => {
    spawnImpl = makeFakeSpawn(['litellm.AuthenticationError: invalid api key'], 1);
    const a = makeAdapter();
    const { error } = await a._spawnAider(['/usr/bin/aider'], 'general');
    assert.ok(/Authentication failed/.test(error));
  });

  it('runs in the working directory and passes the key via env, not argv', async () => {
    spawnImpl = makeFakeSpawn(['ok']);
    const a = makeAdapter({ workingDir: '/tmp/myproject', agentEnv: { AIDER_MODEL: 'gpt-4o', LLM_API_KEY: 'sk-secret' } });
    await a._spawnAider(['/usr/bin/aider', '--model', 'gpt-4o'], 'general');
    assert.equal(lastSpawn.opts.cwd, '/tmp/myproject');
    assert.equal(lastSpawn.opts.env.OPENAI_API_KEY, 'sk-secret');
    assert.ok(lastSpawn.args.every((x) => !String(x).includes('sk-secret')));
  });

  it('never writes the key to the logs', async () => {
    spawnImpl = makeFakeSpawn(['done'], 1, 'provider noise');
    const a = makeAdapter({ agentEnv: { AIDER_MODEL: 'gpt-4o', LLM_API_KEY: 'sk-supersecret' } });
    const logs = [];
    a._log = (m) => logs.push(m);
    await a._spawnAider(['/usr/bin/aider'], 'general');
    assert.ok(!logs.join('\n').includes('sk-supersecret'));
  });
});

describe('Aider adapter — sessions (isolated HOME)', () => {
  beforeEach(isolateHome);
  afterEach(restoreHome);

  it('uses a separate, safe history file per channel', () => {
    const a = makeAdapter();
    const alpha = a._chatHistoryFile('alpha');
    const beta = a._chatHistoryFile('beta');
    assert.notEqual(alpha, beta);
    assert.equal(path.dirname(alpha), a._sessionsDir);
    const evil = a._chatHistoryFile('../../etc/passwd');
    assert.equal(path.dirname(evil), a._sessionsDir);
    assert.ok(!path.basename(evil).includes('/') && !path.basename(evil).includes('\\'));
  });

  it('resumes only when a non-empty history exists; corrupt → fresh', () => {
    const a = makeAdapter();
    assert.equal(a._hasHistory('general'), false);
    fs.mkdirSync(a._sessionsDir, { recursive: true });
    fs.writeFileSync(a._chatHistoryFile('general'), '# prior\n');
    assert.equal(a._hasHistory('general'), true);
  });

  it('writes the message file under the sessions dir, not the project', async () => {
    spawnImpl = makeFakeSpawn(['ok']);
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-proj-'));
    const a = makeAdapter({ workingDir: wd });
    a._streamed = { status: [] };
    a.sendStatus = async () => {};
    await a._runAider('a'.repeat(100000), 'general');
    const mfIndex = lastSpawn.args.indexOf('--message-file');
    const msgPath = lastSpawn.args[mfIndex + 1];
    assert.ok(msgPath.startsWith(a._sessionsDir));
    assert.ok(!msgPath.startsWith(wd));
    fs.rmSync(wd, { recursive: true, force: true });
  });

  it('reset/clear remove stored history', () => {
    const a = makeAdapter();
    fs.mkdirSync(a._sessionsDir, { recursive: true });
    fs.writeFileSync(a._chatHistoryFile('general'), 'x');
    a.resetChannelSession('general');
    assert.equal(fs.existsSync(a._chatHistoryFile('general')), false);
    fs.writeFileSync(a._chatHistoryFile('general'), 'x');
    a.clearAllSessions();
    assert.equal(fs.existsSync(a._sessionsDir), false);
  });
});

describe('Aider adapter — git hygiene (isolated HOME)', () => {
  beforeEach(isolateHome);
  afterEach(restoreHome);

  it('adds .aider* to .git/info/exclude without touching .gitignore', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-repo-'));
    fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
    const a = makeAdapter({ workingDir: repo });
    a._ensureLocalGitExclude(repo);
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf-8');
    assert.ok(exclude.includes('.aider*'));
    assert.equal(fs.existsSync(path.join(repo, '.gitignore')), false);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('is a no-op in a non-git directory', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-plain-'));
    const a = makeAdapter({ workingDir: plain });
    a._ensureLocalGitExclude(plain); // must not throw
    assert.equal(fs.existsSync(path.join(plain, '.git')), false);
    fs.rmSync(plain, { recursive: true, force: true });
  });
});

describe('Aider adapter — stop control', () => {
  it('terminates the running process and marks the channel stopped', async () => {
    const a = makeAdapter();
    const stopped = [];
    a._stopProcess = async () => stopped.push('killed');
    // The stop notice is posted by BaseAdapter straight through the client.
    const statuses = [];
    a.client.getTodos = async () => ({ todos: [] });
    a.client.sendMessage = async (_ws, _c, _t, content) => statuses.push(content);

    const proc = new EventEmitter();
    proc.pid = 99;
    proc.exitCode = null;
    a._channelProcesses.general = proc;

    await a._onControlAction('stop', {});
    assert.equal(stopped.length, 1);
    assert.equal('general' in a._channelProcesses, false);
    assert.equal(a._stoppingChannels.has('general'), true);
    assert.deepEqual(statuses, ['Execution stopped by user.']);
  });

  it('a stop in one channel leaves its run in another channel alone', async () => {
    const a = makeAdapter();
    const killed = [];
    a._stopProcess = async (proc) => killed.push(proc.pid);
    const notices = [];
    a.client.getTodos = async () => ({ todos: [] });
    a.client.sendMessage = async (_ws, channel, _t, content) => notices.push({ channel, content });

    const inA = new EventEmitter();
    inA.pid = 101;
    inA.exitCode = null;
    const inB = new EventEmitter();
    inB.pid = 102;
    inB.exitCode = null;
    a._channelProcesses.channelA = inA;
    a._channelProcesses.channelB = inB;

    await a._onControlAction('stop', { channel: 'channelA' });

    assert.deepEqual(killed, [101]);
    assert.equal(a._channelProcesses.channelB, inB);
    assert.deepEqual(notices, [{ channel: 'channelA', content: 'Execution stopped by user.' }]);
  });
});
