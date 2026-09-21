'use strict';

/**
 * Unit tests for the Amp adapter (Node / agent-connector runtime).
 *
 * No real `amp` binary or workspace is needed: `child_process.spawn` is faked
 * to emit Amp's Claude-compatible `--stream-json` events, and network helpers
 * (sendThinking/sendStatus/sendResponse) are stubbed on the instance.
 *
 * Covered: registration in ADAPTER_MAP, execute/threads-continue command
 * construction, stream-json parsing + per-channel thread persistence, working
 * dir + AMP_API_KEY env passing, secret never logged, stop control, and that
 * existing adapters keep loading.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const cp = require('node:child_process');

// Install a swappable spawn shim BEFORE requiring the adapter, so the
// module-level `const { spawn } = require('child_process')` binds to it.
const realSpawn = cp.spawn;
let spawnImpl = null;
let lastSpawn = null;
cp.spawn = (...args) => spawnImpl(...args);

const { createAdapter, ADAPTER_MAP, AmpAdapter } = require('../src/adapters');

after(() => { cp.spawn = realSpawn; });

function streamLines() {
  const events = [
    { type: 'system', subtype: 'init', session_id: 'T-thread-1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Looking into it' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'All done!' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'All done!', session_id: 'T-thread-1' },
  ];
  return events.map((e) => JSON.stringify(e) + '\n');
}

function makeFakeSpawn(lines, exitCode = 0, stderr = '') {
  return (cmd, args, opts) => {
    const proc = new EventEmitter();
    proc.pid = 4242;
    proc.exitCode = null;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    let stdinBuf = '';
    proc.stdin = {
      write(d) { stdinBuf += d.toString(); },
      end() { proc._stdin = stdinBuf; },
    };
    lastSpawn = { cmd, args, opts, get stdin() { return proc._stdin; } };
    setImmediate(() => {
      for (const line of lines) proc.stdout.emit('data', Buffer.from(line, 'utf-8'));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr, 'utf-8'));
      proc.exitCode = exitCode;
      proc.emit('exit', exitCode);
    });
    return proc;
  };
}

function makeAdapter(extra = {}) {
  const adapter = createAdapter('amp', {
    workspaceId: 'ws',
    channelName: 'general',
    token: 'tok',
    agentName: 'amp-bot',
    endpoint: 'https://example.invalid',
    agentType: 'amp',
    agentEnv: extra.agentEnv || {},
    workingDir: extra.workingDir || '/tmp/proj',
  });
  adapter._ampBin = '/usr/bin/amp';
  adapter._saveSessions = () => {};
  // Stub network helpers — record what was streamed.
  adapter._streamed = { thinking: [], status: [] };
  adapter.sendThinking = async (_c, content) => adapter._streamed.thinking.push(content);
  adapter.sendStatus = async (_c, content) => adapter._streamed.status.push(content);
  return adapter;
}

describe('Amp adapter — registration', () => {
  it('is registered under the "amp" agent type', () => {
    assert.equal('amp' in ADAPTER_MAP, true);
    assert.equal(typeof AmpAdapter, 'function');
  });

  it('createAdapter("amp") returns an AmpAdapter', () => {
    const a = makeAdapter();
    assert.equal(a.constructor.name, 'AmpAdapter');
    assert.equal(typeof a._handleMessage, 'function');
  });

  it('does not disturb the existing adapter map', () => {
    for (const t of ['claude', 'codex', 'opencode', 'cursor', 'gemini', 'kimi']) {
      assert.equal(t in ADAPTER_MAP, true, `${t} should still be registered`);
    }
  });
});

describe('Amp adapter — binary resolution', () => {
  it('includes the Amp installer dir (~/.amp/bin) in the shared resolver search path', () => {
    const os = require('node:os');
    const path = require('node:path');
    const fs = require('node:fs');
    const { getExtraBinDirs, clearBinaryLookupCache } = require('../src/paths');
    const ampBin = path.join(os.homedir(), '.amp', 'bin');

    // getExtraBinDirs() returns only dirs that actually exist and aren't
    // already on PATH, so materialize ~/.amp/bin for the assertion.
    const created = !fs.existsSync(ampBin);
    if (created) fs.mkdirSync(ampBin, { recursive: true });
    try {
      clearBinaryLookupCache();
      const onPath = (process.env.PATH || '').split(path.delimiter).includes(ampBin);
      if (!onPath) {
        assert.ok(
          getExtraBinDirs().includes(ampBin),
          `expected getExtraBinDirs() to include ${ampBin} so a GUI/daemon ` +
          `process resolves amp when ~/.amp/bin is not on PATH`,
        );
      }
    } finally {
      if (created) { try { fs.rmdirSync(ampBin); } catch {} }
      clearBinaryLookupCache();
    }
  });
});

describe('Amp adapter — command construction', () => {
  it('builds a new-thread execute command', () => {
    const a = makeAdapter();
    assert.deepEqual(a._buildAmpCmd('general', false), ['/usr/bin/amp', '-x', '--stream-json']);
  });

  it('builds a threads-continue command when resuming', () => {
    const a = makeAdapter();
    a._channelThreads.general = 'T-123';
    assert.deepEqual(
      a._buildAmpCmd('general', true),
      ['/usr/bin/amp', 'threads', 'continue', 'T-123', '-x', '--stream-json'],
    );
  });
});

describe('Amp adapter — stream-json execution', () => {
  beforeEach(() => { lastSpawn = null; });

  it('parses the final assistant turn and persists the thread id', async () => {
    spawnImpl = makeFakeSpawn(streamLines());
    const a = makeAdapter();
    const { text, stale } = await a._spawnAmp(['/usr/bin/amp', '-x', '--stream-json'], 'PROMPT', 'general');
    assert.equal(text, 'All done!');
    assert.equal(stale, false);
    assert.equal(a._channelThreads.general, 'T-thread-1');
    assert.ok(a._streamed.thinking.includes('Looking into it'));
    assert.ok(a._streamed.status.some((s) => s.includes('Bash')));
  });

  it('feeds the prompt on stdin and runs in the working directory', async () => {
    spawnImpl = makeFakeSpawn(streamLines());
    const a = makeAdapter({ workingDir: '/tmp/myproject' });
    await a._spawnAmp(['/usr/bin/amp', '-x', '--stream-json'], 'PROMPT-BODY', 'general');
    assert.equal(lastSpawn.opts.cwd, '/tmp/myproject');
    assert.equal(lastSpawn.stdin, 'PROMPT-BODY');
  });

  it('passes AMP_API_KEY through to the subprocess env', async () => {
    spawnImpl = makeFakeSpawn(streamLines());
    const a = makeAdapter({ agentEnv: { AMP_API_KEY: 'sk-amp-secret' } });
    await a._spawnAmp(['/usr/bin/amp', '-x', '--stream-json'], 'PROMPT', 'general');
    assert.equal(lastSpawn.opts.env.AMP_API_KEY, 'sk-amp-secret');
  });

  it('never writes AMP_API_KEY to the logs', async () => {
    spawnImpl = makeFakeSpawn(streamLines(), 1, 'some stderr noise');
    const a = makeAdapter({ agentEnv: { AMP_API_KEY: 'sk-amp-supersecret' } });
    const logs = [];
    a._log = (m) => logs.push(m);
    await a._spawnAmp(['/usr/bin/amp', '-x', '--stream-json'], 'PROMPT', 'general');
    assert.ok(!logs.join('\n').includes('sk-amp-supersecret'));
  });

  it('flags a stale thread when a resumed run fails with no output', async () => {
    spawnImpl = makeFakeSpawn(['{"type":"result","is_error":true}\n'], 1, 'thread not found');
    const a = makeAdapter();
    a._channelThreads.general = 'T-old';
    const { text, stale } = await a._spawnAmp(
      ['/usr/bin/amp', 'threads', 'continue', 'T-old', '-x', '--stream-json'], 'PROMPT', 'general',
    );
    assert.equal(text, '');
    assert.equal(stale, true);
  });
});

describe('Amp adapter — stop control', () => {
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
