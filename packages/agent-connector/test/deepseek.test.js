'use strict';

/**
 * Unit tests for the DeepSeek Harness adapter.
 *
 * These drive a REAL subprocess — test/fixtures/mock-dsh.js, a scriptable fake
 * that speaks dsh 0.1.0-rc.6's headless contract — rather than a faked `spawn`.
 * The properties under test (what reaches argv, whether the whole of stdout is
 * captured before the promise settles, whether a process group actually dies)
 * are properties of process handling, and a fake spawn cannot demonstrate them.
 *
 * No real dsh, API key, model or network is involved.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAdapter, ADAPTER_MAP, DeepSeekAdapter } = require('../src/adapters');
const { HEADLESS_TASK_INSTRUCTION } = require('../src/adapters/deepseek-runtime');

const MOCK = path.join(__dirname, 'fixtures', 'mock-dsh.js');
const IS_WINDOWS = process.platform === 'win32';

const TOKEN = 'wst_SUPERSECRET_workspace_token_value';
const API_KEY = 'sk-SUPERSECRET_deepseek_key_value';

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-'));
});
after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

let seq = 0;

/**
 * An adapter wired to the mock CLI, with its private harness home redirected
 * into the test temp dir and all network helpers stubbed.
 */
function makeAdapter(extra = {}) {
  seq += 1;
  const workingDir = path.join(tmpRoot, `proj-${seq}`);
  fs.mkdirSync(workingDir, { recursive: true });

  const adapter = createAdapter('deepseek', {
    workspaceId: 'ws',
    channelName: 'general',
    token: TOKEN,
    agentName: `dsh-bot-${seq}`,
    endpoint: 'https://example.invalid',
    agentType: 'deepseek',
    agentEnv: { DEEPSEEK_API_KEY: API_KEY, ...(extra.agentEnv || {}) },
    workingDir,
    runTimeoutMs: extra.runTimeoutMs,
  });

  adapter._nodeBin = process.execPath;
  adapter._jsEntry = MOCK;
  adapter._dshHome = path.join(tmpRoot, `home-${seq}`);
  adapter._patchFile = path.join(adapter._dshHome, 'openagents.patch.yml');
  adapter._tasksDir = path.join(adapter._dshHome, 'tasks');
  if (extra.mode) adapter._mode = extra.mode;

  adapter._reportStatus = () => {};
  adapter._autoTitleChannel = async () => {};
  adapter._logs = [];
  adapter._log = (m) => adapter._logs.push(String(m));
  adapter._sent = { status: [], response: [], error: [] };
  adapter.sendStatus = async (_c, content) => adapter._sent.status.push(content);
  adapter.sendResponse = async (_c, content) => adapter._sent.response.push(content);
  adapter.sendError = async (_c, content) => adapter._sent.error.push(content);
  // The recap has its own tests; keep the subprocess tests independent of it.
  adapter._buildRecap = async () => extra.recap || '';
  return adapter;
}

/**
 * Wait for a CONDITION rather than for a duration.
 *
 * These tests need a real child process to have started and registered before
 * they can act on it. A fixed sleep is a guess about machine speed, and on a
 * loaded Windows CI run the guess was wrong — two stop tests passed on their
 * own and failed inside the full suite. Polling removes the guess.
 */
async function waitFor(predicate, { timeoutMs = 15000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try { ok = await predicate(); } catch { ok = false; }
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`waitFor timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Wait until the adapter has a live child registered for a channel. */
function waitForChild(adapter, channel = 'general') {
  return waitFor(() => !!adapter._channelProcesses[channel], { label: `a child on ${channel}` });
}

/** Wait until the adapter has ANY child registered (bootstrap included). */
function waitForAnyChild(adapter) {
  return waitFor(() => Object.keys(adapter._channelProcesses).length > 0, { label: 'any child' });
}

/**
 * Run one message through the adapter with the mock in a given scenario.
 *
 * The scenario variables go through `agentEnv`, not `process.env`: the child's
 * environment is built by `getEnhancedEnv(this.agentEnv)`, which does NOT
 * inherit the parent's environment. That mirrors production, where the daemon
 * has already merged process.env into the agent environment before the adapter
 * ever sees it.
 */
async function run(adapter, content, scenarioEnv = {}) {
  const logFile = path.join(tmpRoot, `argv-${seq}-${Math.random().toString(36).slice(2)}.json`);
  Object.assign(adapter.agentEnv, { FAKE_ARGV_LOG: logFile, ...scenarioEnv });
  await adapter._handleMessage({ content, sessionId: 'general', messageId: 'm1' });
  let log = null;
  try { log = JSON.parse(fs.readFileSync(logFile, 'utf-8')); } catch {}
  return log;
}

describe('DeepSeek adapter — registration', () => {
  it('is registered under "deepseek"', () => {
    assert.equal(ADAPTER_MAP.deepseek, DeepSeekAdapter);
  });

  it('does not disturb the other adapters', () => {
    for (const t of ['claude', 'codex', 'pi', 'mini-swe-agent', 'amp']) {
      assert.ok(ADAPTER_MAP[t], `${t} still registered`);
    }
  });

  it('creates via createAdapter', () => {
    assert.ok(makeAdapter() instanceof DeepSeekAdapter);
  });
});

describe('DeepSeek adapter — argv and secrecy', () => {
  it('orders launcher flags before the positional task', async () => {
    const log = await run(makeAdapter(), 'hello');
    assert.ok(log, 'mock recorded its invocation');
    // The mock records process.argv.slice(2), i.e. everything AFTER the script.
    assert.deepEqual(log.argv.slice(0, 2), ['--profile', 'headless']);
    assert.equal(log.argv[2], '--patch');
    assert.equal(log.argv.length, 5, '--profile headless --patch <file> <task>');
  });

  it('passes a CONSTANT task sentence, never the prompt', async () => {
    const log = await run(makeAdapter(), 'refactor the billing module please');
    const task = log.argv[log.argv.length - 1];
    assert.equal(task, HEADLESS_TASK_INSTRUCTION.replace('%s', log.taskFile));
    assert.ok(!task.includes('billing'), 'prompt text is not in argv');
  });

  // The reason the task file exists at all.
  it('never puts the workspace token, the API key or the prompt in argv', async () => {
    const secretPrompt = 'MAGIC-PROMPT-9931 do the thing';
    const log = await run(makeAdapter(), secretPrompt);
    const argvStr = log.argv.join('\u0000');
    assert.ok(!argvStr.includes(TOKEN), 'workspace token absent from argv');
    assert.ok(!argvStr.includes(API_KEY), 'API key absent from argv');
    assert.ok(!argvStr.includes('MAGIC-PROMPT-9931'), 'prompt absent from argv');
  });

  it('passes the secrets through the child ENVIRONMENT instead', async () => {
    const log = await run(makeAdapter(), 'hello');
    assert.equal(log.env.DEEPSEEK_API_KEY, API_KEY);
    assert.equal(log.env.OPENAGENTS_WORKSPACE_TOKEN, TOKEN);
  });

  it('never writes the prompt, token or key into a log line', async () => {
    const adapter = makeAdapter();
    await run(adapter, 'MAGIC-PROMPT-9931 do the thing');
    const logs = adapter._logs.join('\n');
    assert.ok(!logs.includes(TOKEN));
    assert.ok(!logs.includes(API_KEY));
    assert.ok(!logs.includes('MAGIC-PROMPT-9931'));
    // It should still say enough to debug with.
    assert.match(logs, /--profile headless/);
  });
});

describe('DeepSeek adapter — task file', () => {
  it('carries the prompt, and the mock can read it back', async () => {
    const adapter = makeAdapter();
    await run(adapter, 'MAGIC-PROMPT-9931 do the thing', { FAKE_SCENARIO: 'echo_task' });
    assert.equal(adapter._sent.error.length, 0);
    assert.match(adapter._sent.response[0], /MAGIC-PROMPT-9931/);
  });

  // The strongest single assertion in this file.
  it('contains the token EXPRESSION and never the token itself', async () => {
    const log = await run(makeAdapter(), 'hello');
    assert.ok(log.taskBody, 'task file was written');
    assert.ok(!log.taskBody.includes(TOKEN), 'real token absent from the task file');
    assert.ok(!log.taskBody.includes(API_KEY), 'API key absent from the task file');
    const expr = IS_WINDOWS ? '$env:OPENAGENTS_WORKSPACE_TOKEN' : '$OPENAGENTS_WORKSPACE_TOKEN';
    assert.ok(log.taskBody.includes(expr), 'token is referenced by shell expression');
  });

  it('does not leave the unsubstituted {WORKSPACE_API} placeholder behind', async () => {
    const log = await run(makeAdapter(), 'hello');
    assert.ok(!log.taskBody.includes('{WORKSPACE_API}'));
  });

  it('includes the recap when there is one', async () => {
    const log = await run(makeAdapter({ recap: '[user] earlier question' }), 'now this');
    assert.match(log.taskBody, /Recent channel history/);
    assert.match(log.taskBody, /earlier question/);
  });

  it('deletes the task file after the run', async () => {
    const adapter = makeAdapter();
    const log = await run(adapter, 'hello');
    assert.equal(fs.existsSync(log.taskFile), false);
  });

  it('deletes the task file even when the run fails', async () => {
    const adapter = makeAdapter();
    const log = await run(adapter, 'hello', { FAKE_SCENARIO: 'fail' });
    assert.equal(fs.existsSync(log.taskFile), false);
    assert.equal(adapter._sent.error.length, 1);
  });

  it('writes the task file 0600 on POSIX', { skip: IS_WINDOWS && 'POSIX mode bits' }, async () => {
    const adapter = makeAdapter();
    let mode = null;
    // Observe the mode from inside the run, before the finally-block unlinks it.
    const origSpawn = adapter._spawnDsh.bind(adapter);
    adapter._spawnDsh = (args) => {
      mode = fs.statSync(args.taskFile).mode & 0o777;
      return origSpawn(args);
    };
    await run(adapter, 'hello');
    assert.equal(mode, 0o600);
  });

  // FAIL CLOSED: no argv fallback is ever attempted.
  it('fails the run when the task file cannot be staged, and does not spawn', async () => {
    const adapter = makeAdapter();
    let spawned = false;
    adapter._spawnDsh = async () => { spawned = true; return { text: 'x', error: null }; };
    // Bootstrap has already succeeded by the time a task is staged; this is
    // about the task file specifically.
    adapter._ensureBootstrap = async () => {};
    adapter._writePrivatePatch = () => {};
    // A FILE where the tasks directory should be. mkdir then fails with
    // ENOTDIR/EEXIST on every platform, unlike a path under os.devNull, which
    // is only unwritable on POSIX.
    const blocked = path.join(tmpRoot, `blocked-${seq}`);
    fs.writeFileSync(blocked, 'not a directory');
    adapter._tasksDir = path.join(blocked, 'tasks');
    await adapter._handleMessage({ content: 'hello', sessionId: 'general', messageId: 'm1' });
    assert.equal(spawned, false, 'no subprocess was started');
    assert.equal(adapter._sent.response.length, 0);
    assert.match(adapter._sent.error[0], /could not stage its task file/);
    assert.match(adapter._sent.error[0], /never passed on the command line/);
  });
});

describe('DeepSeek adapter — process handling', () => {
  it('posts stdout as the reply on exit 0', async () => {
    const adapter = makeAdapter();
    await run(adapter, 'hello', { FAKE_SCENARIO: 'answer', FAKE_STDOUT: 'the answer\n\n' });
    assert.deepEqual(adapter._sent.response, ['the answer']);
    assert.equal(adapter._sent.error.length, 0);
  });

  it('reports one status line, since nothing streams', async () => {
    const adapter = makeAdapter();
    await run(adapter, 'hello');
    assert.equal(adapter._sent.status.length, 1);
    assert.match(adapter._sent.status[0], /working/i);
  });

  it('DISCARDS stdout when the run fails', async () => {
    const adapter = makeAdapter();
    await run(adapter, 'hello', { FAKE_SCENARIO: 'partial_fail' });
    assert.equal(adapter._sent.response.length, 0, 'no partial answer is posted');
    assert.equal(adapter._sent.error.length, 1);
    assert.match(adapter._sent.error[0], /\(auth\)/, 'stderr drove the classification');
  });

  it('classifies stderr into an actionable category', async () => {
    const adapter = makeAdapter();
    await run(adapter, 'hello', {
      FAKE_SCENARIO: 'fail',
      FAKE_STDERR: 'getaddrinfo ENOTFOUND api.deepseek.com',
    });
    assert.match(adapter._sent.error[0], /\(network\)/);
  });

  // 'close', not 'exit': a large write immediately before exit must arrive whole.
  it('captures the complete answer when the child exits mid-flush', async () => {
    const adapter = makeAdapter();
    await run(adapter, 'hello', { FAKE_SCENARIO: 'slow_flush', FAKE_STDOUT: 'y' });
    assert.equal(adapter._sent.response.length, 1);
    assert.match(adapter._sent.response[0], /END-OF-ANSWER$/);
    assert.ok(adapter._sent.response[0].length > 20000, 'the whole payload arrived');
  });

  it('answers with a note when the run succeeds but says nothing', async () => {
    const adapter = makeAdapter();
    await run(adapter, 'hello', { FAKE_SCENARIO: 'answer', FAKE_STDOUT: '' });
    assert.match(adapter._sent.response[0], /no textual output/);
  });
});

describe('DeepSeek adapter — total run timeout', () => {
  it('terminates a run that never produces output, with a clear reason', async () => {
    const adapter = makeAdapter({ runTimeoutMs: 400 });
    const started = Date.now();
    await run(adapter, 'hello', { FAKE_SCENARIO: 'hang' });
    assert.ok(Date.now() - started < 20000, 'the timeout fired');
    assert.equal(adapter._sent.response.length, 0);
    assert.match(adapter._sent.error[0], /timed out/);
    assert.match(adapter._sent.error[0], /does not report progress/);
  });

  // The distinction from every other adapter in this repo.
  it('is a TOTAL budget, not an idle one — silence under budget is fine', async () => {
    const adapter = makeAdapter({ runTimeoutMs: 30000 });
    // slow_flush is silent for its whole life and then answers at the end.
    await run(adapter, 'hello', { FAKE_SCENARIO: 'slow_flush', FAKE_STDOUT: 'z' });
    assert.equal(adapter._sent.error.length, 0, 'a silent-but-healthy run is not killed');
    assert.equal(adapter._sent.response.length, 1);
  });
});

describe('DeepSeek adapter — stop control', () => {
  it('kills the run and posts no answer', async () => {
    const adapter = makeAdapter({ runTimeoutMs: 30000 });
    const done = run(adapter, 'hello', { FAKE_SCENARIO: 'hang' });
    await waitForChild(adapter);
    await adapter._onControlAction('stop');
    await done;
    assert.equal(adapter._sent.response.length, 0);
    assert.equal(adapter._sent.error.length, 0, 'a user stop is not an error');
  });

  it('leaves no tracked process behind', async () => {
    const adapter = makeAdapter({ runTimeoutMs: 30000 });
    const done = run(adapter, 'hello', { FAKE_SCENARIO: 'hang' });
    await waitForChild(adapter);
    await adapter._onControlAction('stop');
    await done;
    assert.deepEqual(Object.keys(adapter._channelProcesses), []);
  });
});

describe('DeepSeek adapter — stop before the process exists', () => {
  /**
   * The pre-spawn window is real time: bootstrap, the status post, the recap
   * fetch and the browser lookup all happen before any child exists. A stop
   * landing there used to be dropped — _onControlAction only walked the
   * process registry, which was still empty — and the task ran to completion
   * and posted its answer anyway.
   */
  async function stopDuring(hook) {
    const adapter = makeAdapter({ runTimeoutMs: 30000 });
    let spawned = false;
    const realSpawn = adapter._spawnDsh.bind(adapter);
    adapter._spawnDsh = (args) => { spawned = true; return realSpawn(args); };
    hook(adapter);
    await adapter._handleMessage({ content: 'do the thing', sessionId: 'general', messageId: 'm1' });
    return { adapter, spawned };
  }

  it('drops a stop that arrives during bootstrap', async () => {
    const { adapter, spawned } = await stopDuring((a) => {
      a._bootstrap = async () => { await a._onControlAction('stop'); };
    });
    assert.equal(spawned, false, 'no process was started');
    assert.equal(adapter._sent.response.length, 0, 'and no answer was posted');
  });

  it('drops a stop that arrives during the recap fetch', async () => {
    const { adapter, spawned } = await stopDuring((a) => {
      a._buildRecap = async () => { await a._onControlAction('stop'); return ''; };
    });
    assert.equal(spawned, false);
    assert.equal(adapter._sent.response.length, 0);
  });

  it('drops a stop that arrives during the browser lookup', async () => {
    const { adapter, spawned } = await stopDuring((a) => {
      a.getBrowserEnabled = async () => { await a._onControlAction('stop'); return false; };
    });
    assert.equal(spawned, false);
    assert.equal(adapter._sent.response.length, 0);
  });

  it('marks the channel cancelled even with nothing to kill', async () => {
    const adapter = makeAdapter();
    adapter._bootstrap = async () => {
      assert.deepEqual(Object.keys(adapter._channelProcesses), [], 'nothing spawned yet');
      await adapter._onControlAction('stop');
      assert.equal(adapter._cancelled('general'), true, 'but the stop was recorded');
    };
    await adapter._handleMessage({ content: 'x', sessionId: 'general', messageId: 'm1' });
  });

  it('does not leak cancellation into the NEXT message', async () => {
    const adapter = makeAdapter();
    adapter._bootstrap = async () => {
      // Still do what the real bootstrap does — create the private home — so
      // the follow-up message exercises cancellation, not a missing directory.
      fs.mkdirSync(adapter._tasksDir, { recursive: true });
      await adapter._onControlAction('stop');
    };
    await adapter._handleMessage({ content: 'first', sessionId: 'general', messageId: 'm1' });
    assert.equal(adapter._sent.response.length, 0);

    adapter._bootstrap = async () => {};
    await run(adapter, 'second', { FAKE_STDOUT: 'second answer' });
    assert.deepEqual(adapter._sent.response, ['second answer']);
  });

  it('clears the busy marker even when the handler throws', async () => {
    const adapter = makeAdapter();
    adapter._ensureBootstrap = async () => { throw new Error('boom'); };
    await adapter._handleMessage({ content: 'x', sessionId: 'general', messageId: 'm1' });
    assert.equal(adapter._busyChannels.has('general'), false);
  });
});

describe('DeepSeek adapter — stop is confirmed to the workspace', () => {
  /**
   * The client (workspace/frontend chat-view.tsx) clears its "stopping" state
   * only on a status matching this. Asserting the adapter's wording against the
   * consumer's own regex is what stops the two from drifting: a reworded status
   * that no longer matches would leave every stopped session showing as busy.
   */
  const TERMINAL = /stopped|stopping failed/i;

  it('confirms a stop that landed before the process existed', async () => {
    const adapter = makeAdapter();
    adapter._bootstrap = async () => { await adapter._onControlAction('stop'); };
    await adapter._handleMessage({ content: 'x', sessionId: 'general', messageId: 'm1' });

    const last = adapter._sent.status[adapter._sent.status.length - 1];
    assert.match(last, TERMINAL, 'the LAST status reads as terminal to the client');
  });

  it('confirms a stop that killed a running process', async () => {
    const adapter = makeAdapter({ runTimeoutMs: 30000 });
    const done = run(adapter, 'hello', { FAKE_SCENARIO: 'hang' });
    await waitForChild(adapter);
    await adapter._onControlAction('stop');
    await done;

    const last = adapter._sent.status[adapter._sent.status.length - 1];
    assert.match(last, TERMINAL);
  });

  it('sends the confirmation exactly once per channel', async () => {
    const adapter = makeAdapter({ runTimeoutMs: 30000 });
    const done = run(adapter, 'hello', { FAKE_SCENARIO: 'hang' });
    await waitForChild(adapter);
    // The channel is BOTH busy and has a live process — the two paths that
    // collect stopped channels. It must not be told twice.
    assert.equal(adapter._busyChannels.has('general'), true);
    assert.ok(adapter._channelProcesses.general, 'and has a child');
    await adapter._onControlAction('stop');
    await done;

    const terminal = adapter._sent.status.filter((c) => TERMINAL.test(c));
    assert.equal(terminal.length, 1);
  });

  it('never posts to the bootstrap pseudo-channel', async () => {
    const adapter = makeAdapter();
    adapter._bootstrapTimeoutMs = 30000;
    Object.assign(adapter.agentEnv, { FAKE_BOOTSTRAP_HANG: '1' });
    const pending = adapter._ensureBootstrap().catch(() => {});
    await waitForAnyChild(adapter);
    await adapter._onControlAction('stop');
    await pending;
    // No channel was busy, so there is nobody to confirm to.
    assert.equal(adapter._sent.status.length, 0);
    assert.equal(adapter._stoppingChannels.size, 0);
  });
});

describe('DeepSeek adapter — stop targets one conversation', () => {
  const TERMINAL = /stopped|stopping failed/i;

  /** Two concurrent runs on separate channels, both hung. */
  async function twoRuns() {
    const adapter = makeAdapter({ runTimeoutMs: 30000 });
    const sent = [];
    adapter.sendStatus = async (channel, content) => {
      adapter._sent.status.push(content);
      sent.push({ channel, content });
    };
    Object.assign(adapter.agentEnv, { FAKE_SCENARIO: 'hang' });
    const a = adapter._handleMessage({ content: 'a', sessionId: 'general', messageId: 'm1' });
    const b = adapter._handleMessage({ content: 'b', sessionId: 'other', messageId: 'm2' });
    await waitForChild(adapter, 'general');
    await waitForChild(adapter, 'other');
    return { adapter, a, b, sent };
  }

  it('stops only the channel named in the payload', async () => {
    const { adapter, a, b, sent } = await twoRuns();
    assert.ok(adapter._channelProcesses.general && adapter._channelProcesses.other,
      'both runs are live');

    await adapter._onControlAction('stop', { channel: 'general' });
    assert.equal(adapter._cancelled('general'), true);
    assert.equal(adapter._cancelled('other'), false, 'the other conversation is untouched');
    assert.ok(adapter._channelProcesses.other, 'and its process is still running');

    const terminal = sent.filter((m) => TERMINAL.test(m.content));
    assert.deepEqual(terminal.map((m) => m.channel), ['general']);

    await a;
    await adapter._onControlAction('stop');
    await b;
  });

  it('stops everything when no channel is given', async () => {
    const { adapter, a, b, sent } = await twoRuns();
    await adapter._onControlAction('stop');
    const stoppedChannels = sent.filter((m) => TERMINAL.test(m.content)).map((m) => m.channel);
    assert.deepEqual(stoppedChannels.sort(), ['general', 'other']);
    await a; await b;
  });

  it('leaves the SHARED bootstrap alone for a scoped stop', async () => {
    const adapter = makeAdapter();
    adapter._bootstrapTimeoutMs = 30000;
    Object.assign(adapter.agentEnv, { FAKE_BOOTSTRAP_HANG: '1' });
    const pending = adapter._ensureBootstrap().catch(() => {});
    await waitForAnyChild(adapter);

    await adapter._onControlAction('stop', { channel: 'general' });
    assert.ok(adapter._channelProcesses[Object.keys(adapter._channelProcesses)[0]],
      'bootstrap survived a stop aimed at one conversation');

    await adapter._onControlAction('stop');
    await pending;
  });
});

describe('DeepSeek adapter — stop tells the truth', () => {
  it('reports a FAILED stop when the child could not be confirmed dead', async () => {
    const adapter = makeAdapter({ runTimeoutMs: 30000 });
    const done = run(adapter, 'hello', { FAKE_SCENARIO: 'hang' });
    await waitForChild(adapter);

    const real = adapter._stopProcess.bind(adapter);
    const child = adapter._channelProcesses.general;
    adapter._stopProcess = async () => false;
    await adapter._onControlAction('stop');

    const last = adapter._sent.status[adapter._sent.status.length - 1];
    assert.match(last, /stopping failed/i, 'the client sees a terminal status');
    assert.match(last, /may still be running/i, 'and is told the process may live on');

    adapter._stopProcess = real;
    await adapter._stopProcess(child);
    await done;
  });

  it('keeps the child registered until the kill has been attempted', async () => {
    const adapter = makeAdapter({ runTimeoutMs: 30000 });
    const done = run(adapter, 'hello', { FAKE_SCENARIO: 'hang' });
    await waitForChild(adapter);

    // The registry is what the session GC consults, so the entry must outlive
    // the decision to kill rather than being dropped ahead of it.
    let registeredDuringKill = null;
    const real = adapter._stopProcess.bind(adapter);
    adapter._stopProcess = async (proc) => {
      registeredDuringKill = Object.keys(adapter._channelProcesses).length > 0;
      return real(proc);
    };
    await adapter._onControlAction('stop');
    assert.equal(registeredDuringKill, true);
    assert.deepEqual(Object.keys(adapter._channelProcesses), [], 'and is gone afterwards');
    await done;
  });
});

describe('DeepSeek adapter — a stopped channel stops waiting', () => {
  it('releases a channel parked on the shared bootstrap without killing it', async () => {
    const adapter = makeAdapter();
    adapter._bootstrapTimeoutMs = 30000;
    Object.assign(adapter.agentEnv, { FAKE_BOOTSTRAP_HANG: '1' });

    let finished = false;
    const handled = adapter
      ._handleMessage({ content: 'x', sessionId: 'general', messageId: 'm1' })
      .then(() => { finished = true; });
    await waitForAnyChild(adapter);
    assert.equal(finished, false, 'the handler is parked on bootstrap');

    await adapter._onControlAction('stop', { channel: 'general' });
    await handled;

    assert.equal(finished, true, 'the stopped channel stopped waiting');
    assert.equal(adapter._busyChannels.has('general'), false, 'and is free for the next message');
    // The shared compose is deliberately still running for everyone else.
    assert.equal(Object.keys(adapter._channelProcesses).length, 1);

    await adapter._onControlAction('stop');
  });
});

describe('DeepSeek adapter — permission mode', () => {
  it('passes workspace-write by default', async () => {
    const log = await run(makeAdapter(), 'hello');
    assert.equal(log.env.DSH_PERMISSION_MODE, 'workspace-write');
  });

  it('forces read-only in plan mode, overriding the agent setting', async () => {
    const adapter = makeAdapter({
      mode: 'plan',
      agentEnv: { DSH_PERMISSION_MODE: 'danger-full-access' },
    });
    const log = await run(adapter, 'hello');
    assert.equal(log.env.DSH_PERMISSION_MODE, 'read-only');
  });

  it('honours an explicit valid mode', async () => {
    const log = await run(makeAdapter({ agentEnv: { DSH_PERMISSION_MODE: 'read-only' } }), 'hello');
    assert.equal(log.env.DSH_PERMISSION_MODE, 'read-only');
  });

  it('rejects an invalid mode instead of silently defaulting', async () => {
    const adapter = makeAdapter({ agentEnv: { DSH_PERMISSION_MODE: 'workspace_write' } });
    await run(adapter, 'hello');
    assert.equal(adapter._sent.response.length, 0);
    assert.match(adapter._sent.error[0], /Invalid DSH_PERMISSION_MODE/);
  });
});

describe('DeepSeek adapter — private harness home', () => {
  it('points DSH_HOME at the agent\'s own directory, never the user\'s ~/.dsh', async () => {
    const adapter = makeAdapter();
    const log = await run(adapter, 'hello');
    assert.equal(log.env.DSH_HOME, adapter._dshHome);
    assert.ok(!log.env.DSH_HOME.endsWith(path.join(os.homedir(), '.dsh')));
  });

  it('disables telemetry unconditionally', async () => {
    const log = await run(makeAdapter(), 'hello');
    assert.equal(log.env.DSH_TELEMETRY_DISABLED, '1');
  });

  it('gives two agents separate homes', () => {
    const a = makeAdapter();
    const b = makeAdapter();
    assert.notEqual(a._dshHome, b._dshHome);
  });

  it('writes the private patch with the configured model', async () => {
    const adapter = makeAdapter({ agentEnv: { DEEPSEEK_MODEL: 'deepseek-v4-flash' } });
    await run(adapter, 'hello');
    const patch = fs.readFileSync(adapter._patchFile, 'utf-8');
    assert.match(patch, /model: "deepseek-v4-flash"/);
    assert.match(patch, /policy: never/);
    assert.ok(!patch.includes('sandbox-policy'), 'the filesystem boundary is untouched');
  });

  it('runs in the project directory', async () => {
    const adapter = makeAdapter();
    const log = await run(adapter, 'hello');
    assert.equal(fs.realpathSync(log.cwd), fs.realpathSync(adapter.workingDir));
  });
});

describe('DeepSeek adapter — bootstrap', () => {
  it('composes the profile once for concurrent channels', async () => {
    const adapter = makeAdapter();
    let calls = 0;
    adapter._bootstrap = async () => { calls += 1; };
    await Promise.all([
      adapter._ensureBootstrap(),
      adapter._ensureBootstrap(),
      adapter._ensureBootstrap(),
    ]);
    assert.equal(calls, 1);
  });

  it('clears the promise on failure so a later message can retry', async () => {
    const adapter = makeAdapter();
    let calls = 0;
    adapter._bootstrap = async () => {
      calls += 1;
      if (calls === 1) throw new Error('first attempt fails');
    };
    await assert.rejects(() => adapter._ensureBootstrap(), /first attempt fails/);
    await adapter._ensureBootstrap();
    assert.equal(calls, 2, 'the second message retried instead of reusing a rejection');
  });

  it('surfaces a bootstrap failure as an error, not a silent hang', async () => {
    const adapter = makeAdapter();
    adapter._bootstrap = async () => { throw new Error('compose failed'); };
    await adapter._handleMessage({ content: 'hi', sessionId: 'general', messageId: 'm1' });
    assert.match(adapter._sent.error[0], /could not initialise its profile/);
  });

  it('reports a real dump-config failure from the CLI', async () => {
    const adapter = makeAdapter();
    await run(adapter, 'hi', { FAKE_BOOTSTRAP_FAIL: '1', FAKE_STDERR: 'unknown bundle' });
    assert.equal(adapter._sent.response.length, 0);
    assert.match(adapter._sent.error[0], /could not initialise its profile/);
  });
});

describe('DeepSeek adapter — session GC', () => {
  function seedSessions(adapter, entries) {
    const scope = path.join(adapter._dshHome, 'sessions', 'proj');
    fs.mkdirSync(scope, { recursive: true });
    for (const [name, ageDays] of entries) {
      const dir = path.join(scope, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), 'x');
      const t = (Date.now() - ageDays * 86400000) / 1000;
      fs.utimesSync(dir, t, t);
    }
    return scope;
  }

  it('removes stale sessions and keeps recent ones', () => {
    const adapter = makeAdapter();
    const scope = seedSessions(adapter, [['session-old', 30], ['session-new', 0]]);
    adapter._gcSessions();
    assert.equal(fs.existsSync(path.join(scope, 'session-old')), false);
    assert.equal(fs.existsSync(path.join(scope, 'session-new')), true);
  });

  it('does nothing while a run is in flight', () => {
    const adapter = makeAdapter();
    const scope = seedSessions(adapter, [['session-old', 30]]);
    adapter._channelProcesses.general = { pid: 1 };
    adapter._gcSessions();
    assert.equal(fs.existsSync(path.join(scope, 'session-old')), true);
  });

  it('never follows a symlink', { skip: IS_WINDOWS && 'POSIX symlinks' }, () => {
    const adapter = makeAdapter();
    const scope = seedSessions(adapter, [['session-new', 0]]);
    const outside = path.join(tmpRoot, `outside-${seq}`);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'precious.txt'), 'do not delete');
    const link = path.join(scope, 'session-evil');
    fs.symlinkSync(outside, link);
    const old = (Date.now() - 30 * 86400000) / 1000;
    try { fs.lutimesSync(link, old, old); } catch {}

    adapter._gcSessions();

    assert.equal(fs.existsSync(path.join(outside, 'precious.txt')), true,
      'the symlink target survived');
  });

  it('leaves profiles, settings and credentials alone', () => {
    const adapter = makeAdapter();
    seedSessions(adapter, [['session-old', 30]]);
    const keep = ['settings.yaml', '.credentials.yaml'];
    for (const f of keep) fs.writeFileSync(path.join(adapter._dshHome, f), 'keep');
    fs.mkdirSync(path.join(adapter._dshHome, 'profiles', 'headless'), { recursive: true });

    adapter._gcSessions();

    for (const f of keep) {
      assert.equal(fs.existsSync(path.join(adapter._dshHome, f)), true, `${f} untouched`);
    }
    assert.equal(fs.existsSync(path.join(adapter._dshHome, 'profiles', 'headless')), true);
  });

  it('survives a missing sessions directory', () => {
    const adapter = makeAdapter();
    fs.mkdirSync(adapter._dshHome, { recursive: true });
    assert.doesNotThrow(() => adapter._gcSessions());
  });
});

describe('DeepSeek adapter — recap', () => {
  function withClient(adapter, head, tail) {
    adapter.client = {
      getRecentMessages: async (_ws, _ch, _tok, _limit, opts) => (
        opts && opts.sort === 'asc' ? head : tail
      ),
    };
    delete adapter._buildRecap;
    return Object.getPrototypeOf(adapter)._buildRecap.bind(adapter);
  }

  it('excludes the current event BY ID, keeping an older identical message', async () => {
    const adapter = makeAdapter();
    const head = [
      { messageId: 'old', content: 'continue', senderType: 'human', senderName: 'u' },
    ];
    const tail = [
      { messageId: 'cur', content: 'continue', senderType: 'human', senderName: 'u' },
    ];
    const build = withClient(adapter, head, tail);
    const recap = await build('general', { messageId: 'cur', content: 'continue' });
    // The identical OLDER message must survive; only the current event is gone.
    assert.ok(recap.includes('continue'), 'the earlier identical message was kept');
    assert.equal((recap.match(/continue/g) || []).length, 1);
  });

  it('returns empty rather than throwing when history is unavailable', async () => {
    const adapter = makeAdapter();
    adapter.client = { getRecentMessages: async () => { throw new Error('offline'); } };
    delete adapter._buildRecap;
    const build = Object.getPrototypeOf(adapter)._buildRecap.bind(adapter);
    assert.equal(await build('general', { messageId: 'x', content: 'y' }), '');
  });
});

describe('DeepSeek adapter — recap ordering', () => {
  function build(adapter, head, tail) {
    // getRecentMessages returns CHRONOLOGICAL order for both sort directions.
    adapter.client = {
      getRecentMessages: async (_ws, _ch, _tok, _limit, opts) => (
        opts && opts.sort === 'asc' ? head : tail
      ),
    };
    delete adapter._buildRecap;
    return Object.getPrototypeOf(adapter)._buildRecap.bind(adapter);
  }
  const msg = (id, content) => ({ messageId: id, content, senderType: 'human', senderName: 'u' });

  it('keeps the transcript chronological', async () => {
    const adapter = makeAdapter();
    const tail = [msg('a', 'first thing'), msg('b', 'second thing'), msg('c', 'third thing')];
    const recap = await build(adapter, [], tail)('general', msg('cur', 'now'));
    const lines = recap.split('\n').filter(Boolean);
    assert.ok(lines[0].includes('first thing'));
    assert.ok(lines[lines.length - 1].includes('third thing'));
  });

  // The bug this replaces reversed an already-chronological window, so
  // sampleRecap's tail.slice(-N) kept the OLDEST entries and dropped the newest.
  it('keeps the NEWEST messages when the window overflows', async () => {
    const adapter = makeAdapter();
    const tail = Array.from({ length: 40 }, (_, i) => msg(`m${i}`, `message ${i}`));
    const recap = await build(adapter, [], tail)('general', msg('cur', 'now'));
    assert.ok(recap.includes('message 39'), 'the newest message survived');
    assert.ok(!recap.includes('message 0'), 'the oldest fell out of the window');
  });
});

describe('DeepSeek adapter — browser directive', () => {
  it('loads the workspace browser setting instead of assuming it is off', async () => {
    const adapter = makeAdapter();
    let asked = false;
    adapter.getBrowserEnabled = async () => { asked = true; return true; };
    const log = await run(adapter, 'hello');
    assert.equal(asked, true, 'the adapter actually loaded the setting');
    assert.match(log.taskBody, /Browser Use \(MANDATORY\)/);
  });

  it('omits the directive when the workspace has it off', async () => {
    const adapter = makeAdapter();
    adapter.getBrowserEnabled = async () => false;
    const log = await run(adapter, 'hello');
    assert.ok(!log.taskBody.includes('Browser Use (MANDATORY)'));
  });
});

describe('DeepSeek adapter — bootstrap safety', () => {
  it('times out a wedged dump-config instead of hanging every channel', async () => {
    const adapter = makeAdapter();
    adapter._bootstrapTimeoutMs = 400;
    Object.assign(adapter.agentEnv, { FAKE_BOOTSTRAP_HANG: '1' });
    await adapter._handleMessage({ content: 'hi', sessionId: 'general', messageId: 'm1' });
    assert.equal(adapter._sent.response.length, 0);
    assert.match(adapter._sent.error[0], /could not initialise its profile/);
    assert.match(adapter._sent.error[0], /timed out/);
  });

  it('tracks the bootstrap child so /stop can interrupt it', async () => {
    const adapter = makeAdapter();
    adapter._bootstrapTimeoutMs = 30000;
    Object.assign(adapter.agentEnv, { FAKE_BOOTSTRAP_HANG: '1' });
    const pending = adapter._ensureBootstrap().catch(() => {});
    await waitForAnyChild(adapter);
    assert.equal(Object.keys(adapter._channelProcesses).length, 1, 'bootstrap is tracked');
    await adapter._onControlAction('stop');
    await pending;
    assert.deepEqual(Object.keys(adapter._channelProcesses), [], 'and untracked after stop');
  });

  it('does not post a status to the pseudo-channel it is tracked under', async () => {
    const adapter = makeAdapter();
    adapter._bootstrapTimeoutMs = 30000;
    Object.assign(adapter.agentEnv, { FAKE_BOOTSTRAP_HANG: '1' });
    const pending = adapter._ensureBootstrap().catch(() => {});
    await waitForAnyChild(adapter);
    await adapter._onControlAction('stop');
    await pending;
    assert.equal(adapter._sent.status.length, 0);
    assert.equal(adapter._stoppingChannels.size, 0);
  });
});

describe('DeepSeek adapter — output caps', () => {
  it('bounds stdout by BYTES even when one chunk is oversized', async () => {
    const adapter = makeAdapter();
    adapter._runTimeoutMs = 30000;
    const rt = require('../src/adapters/deepseek-runtime');
    const log = await run(adapter, 'hello', { FAKE_SCENARIO: 'slow_flush', FAKE_STDOUT: 'y' });
    assert.ok(log, 'the run happened');
    // The reply cap is far below the buffer cap, so the reply is what proves
    // the pipeline stayed bounded end to end.
    assert.ok(adapter._sent.response[0].length <= rt.MAX_REPLY_CHARS + 64);
  });

  it('keeps only the TAIL of a large stderr', async () => {
    const adapter = makeAdapter();
    const rt = require('../src/adapters/deepseek-runtime');
    const noise = ('warmup line\n').repeat(rt.MAX_STDERR_BYTES / 4);
    await run(adapter, 'hello', {
      FAKE_SCENARIO: 'fail',
      FAKE_STDERR: `${noise}getaddrinfo ENOTFOUND api.deepseek.com\n`,
    });
    assert.equal(adapter._sent.error.length, 1);
    // The classification could only come from the END of a stream far larger
    // than the cap, which is what proves the tail (not the head) was kept.
    assert.match(adapter._sent.error[0], /\(network\)/);
    assert.ok(adapter._sent.error[0].length < 4000, 'and the reported text stayed bounded');
  });
});

describe('DeepSeek adapter — Node selection', () => {
  /**
   * Stub the two seams rather than planting fake node binaries, so this runs
   * identically on every platform.
   */
  function withNodes(adapter, versions) {
    adapter._nodeCandidates = () => Object.keys(versions);
    adapter._readNodeVersionOf = (bin) => versions[bin] || null;
    return adapter;
  }

  it('prefers the managed runtime when it is compatible', () => {
    const a = withNodes(makeAdapter(), {
      '/managed/node': 'v22.22.3',
      '/usr/bin/node': 'v24.15.0',
    });
    assert.equal(a._findNodeBin(), '/managed/node');
  });

  // Observed on Windows: a managed 22.14.0 sitting next to a system 24.15.0
  // made the adapter refuse to start on a machine that could run it perfectly
  // well. Preferring the managed runtime is right; preferring it
  // unconditionally is not.
  it('skips a managed runtime that is too old and uses the system Node', () => {
    const a = withNodes(makeAdapter(), {
      '/managed/node': 'v22.14.0',
      '/usr/bin/node': 'v24.15.0',
    });
    assert.equal(a._findNodeBin(), '/usr/bin/node');
  });

  it('skips a managed Node 23, which the caret range excludes', () => {
    const a = withNodes(makeAdapter(), {
      '/managed/node': 'v23.5.0',
      '/usr/bin/node': 'v22.19.0',
    });
    assert.equal(a._findNodeBin(), '/usr/bin/node');
  });

  it('falls back to the first candidate when none is compatible', () => {
    const a = withNodes(makeAdapter(), {
      '/managed/node': 'v20.11.0',
      '/usr/bin/node': 'v18.20.0',
    });
    assert.equal(a._findNodeBin(), '/managed/node', 'so preflight can name it');
  });

  it('names the rejected binary in the preflight error', () => {
    const a = withNodes(makeAdapter(), { '/managed/node': 'v20.11.0' });
    a._nodeBin = a._findNodeBin();
    const pf = a.preflight();
    assert.equal(pf.ok, false);
    assert.match(pf.message, /20\.11\.0/);
    assert.match(pf.message, /\/managed\/node/, 'the path is actionable');
  });

  it('ignores a candidate whose version cannot be read', () => {
    const a = withNodes(makeAdapter(), {
      '/managed/node': null,
      '/usr/bin/node': 'v24.15.0',
    });
    assert.equal(a._findNodeBin(), '/usr/bin/node');
  });
});

describe('DeepSeek adapter — preflight', () => {
  beforeEach(() => {});

  it('fails with runtime_missing when dsh cannot be resolved', () => {
    const adapter = makeAdapter();
    adapter._jsEntry = null;
    adapter._resolveDshCommand = () => null;
    const pf = adapter.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, 'runtime_missing');
    assert.match(pf.message, /npm install -g @deepseek-ai\/dsh@/);
  });

  it('rejects an unsupported Node before probing anything else', () => {
    const adapter = makeAdapter();
    adapter._readNodeVersion = () => 'v23.5.0';
    const pf = adapter.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, 'version_incompatible');
    assert.match(pf.message, /Node 23\.x is not supported/);
  });

  it('rejects a dsh preview other than the pinned one', () => {
    const adapter = makeAdapter();
    adapter._readNodeVersion = () => 'v22.19.0';
    adapter._readDshVersion = () => '0.1.0-rc.7';
    const pf = adapter.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, 'version_incompatible');
    assert.match(pf.message, /0\.1\.0-rc\.7 is not supported/);
  });

  it('requires an API key', () => {
    const adapter = makeAdapter({ agentEnv: { DEEPSEEK_API_KEY: '' } });
    adapter.agentEnv = {};
    adapter._readNodeVersion = () => 'v22.19.0';
    adapter._readDshVersion = () => '0.1.0-rc.6';
    const pf = adapter.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, 'login_required');
  });

  it('passes when everything lines up', () => {
    const adapter = makeAdapter();
    adapter._readNodeVersion = () => 'v22.19.0';
    adapter._readDshVersion = () => '0.1.0-rc.6';
    assert.deepEqual(adapter.preflight(), { ok: true });
  });

  it('reads the pinned version from the bundled registry', () => {
    const adapter = makeAdapter();
    const entry = adapter._registryEntry();
    assert.ok(entry, 'the registry carries a deepseek entry');
    assert.equal(entry.install.supported_version, '0.1.0-rc.6');
  });
});
