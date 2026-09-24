'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { spawn } = require('node:child_process');

const BaseAdapter = require('../src/adapters/base');
const ClaudeAdapter = require('../src/adapters/claude');
const OpenCodeAdapter = require('../src/adapters/opencode');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readFirstLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };
    const timeout = setTimeout(() => finish(() => reject(new Error('Timed out waiting for child pid'))), 3000);
    // Guard the stream against 'error'. When the child is later SIGKILL'd, its
    // stdout pipe can emit EPIPE/EBADF/ECONNRESET (notably on macOS); without an
    // 'error' listener that becomes an unhandled 'error' event that crashes the
    // whole test worker. The listener persists for the stream's lifetime, so a
    // post-resolve error during teardown is swallowed instead of throwing.
    stream.on('error', () => finish(() => reject(new Error('stdout stream error'))));
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const idx = buffer.indexOf('\n');
      if (idx >= 0) finish(() => resolve(buffer.slice(0, idx).trim()));
    });
  });
}

/**
 * Collect the stop notices an adapter posts. BaseAdapter posts them straight
 * through the client (the send* helpers are muted for a stopped channel), so
 * this captures exactly what reaches the workspace. Todo lookups are stubbed
 * so the real cleanupTodos never touches the network.
 */
function captureNotices(adapter, sink) {
  adapter.client.getTodos = async () => ({ todos: [] });
  adapter.client.putTodos = async () => ({});
  adapter.client.sendMessage = async (_ws, channel, _token, content) => {
    sink.push({ channel, content });
  };
}

/**
 * A BaseAdapter whose next `_pollControl()` delivers one stop control event.
 * Driving the stop through the real poll path is what makes these tests fail
 * against the old code instead of passing on a missing method.
 */
function stoppableAdapter(channel) {
  const adapter = new BaseAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName: 'agent',
  });
  let delivered = false;
  adapter.client = {
    pollControl: async () => {
      if (delivered) return [];
      delivered = true;
      return [{ id: 'e1', payload: { action: 'stop', channel } }];
    },
  };
  adapter._stopChannelWork = async () => 'idle';
  adapter._finishUserStop = async () => {};
  adapter._prefetchPinnedContext = async () => {};
  adapter.sendStatus = async () => {};
  adapter.sendError = async () => {};
  return adapter;
}

describe('agent stop control', () => {
  it('polls control events faster while work is active', () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'agent',
    });

    assert.equal(adapter._controlPollDelayMs(), 2000);
    adapter._channelBusy.add('thread');
    assert.equal(adapter._controlPollDelayMs(), 250);
  });

  it('marks Claude channels as user-stopped before terminating processes', async () => {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
    });
    const proc = new EventEmitter();
    proc.pid = 99999999;
    proc.exitCode = null;

    adapter._channelProcesses.thread = proc;
    adapter._stopProcess = async () => {};
    const responses = [];
    adapter.sendResponse = async (channel, content) => responses.push({ channel, content });

    await adapter._stopAllProcesses('Execution stopped by user');

    assert.equal(adapter._stoppingChannels.has('thread'), true);
    assert.deepEqual(responses, [{ channel: 'thread', content: 'Execution stopped by user' }]);
  });

  it('channel-scoped stop only kills the targeted channel process', async () => {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
    });
    const proc1 = new EventEmitter();
    proc1.pid = 99999991;
    proc1.exitCode = null;
    const proc2 = new EventEmitter();
    proc2.pid = 99999992;
    proc2.exitCode = null;

    adapter._channelProcesses.channelA = proc1;
    adapter._channelProcesses.channelB = proc2;
    adapter._stopProcess = async () => {};
    const responses = [];
    captureNotices(adapter, responses);

    await adapter._onControlAction('stop', { channel: 'channelA' });

    assert.equal(adapter._stoppingChannels.has('channelA'), true);
    assert.equal(adapter._stoppingChannels.has('channelB'), false);
    assert.equal(adapter._channelProcesses.channelA, undefined);
    assert.ok(adapter._channelProcesses.channelB);
    assert.deepEqual(responses, [{ channel: 'channelA', content: 'Execution stopped by user.' }]);
  });

  it('Claude stop terminates the spawned process tree', async () => {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
    });
    const script = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'console.log(child.pid);',
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const proc = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    // Killing the child can make its stdio/process emit 'error' (EPIPE/EBADF on
    // macOS). Swallow so it never becomes an unhandled 'error' that crashes the
    // test worker.
    proc.on('error', () => {});
    if (proc.stdout) proc.stdout.on('error', () => {});

    try {
      const childPid = Number(await readFirstLine(proc.stdout));
      assert.equal(isPidAlive(proc.pid), true);
      assert.equal(isPidAlive(childPid), true);

      await adapter._stopProcess(proc);
      await sleep(500);

      assert.equal(isPidAlive(proc.pid), false);
      assert.equal(isPidAlive(childPid), false);
    } finally {
      await adapter._stopProcess(proc);
    }
  });

  it('OpenCode marks channels as user-stopped before terminating processes', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    const proc = new EventEmitter();
    proc.pid = 99999999;
    proc.exitCode = null;

    adapter._channelProcesses.thread = proc;
    adapter._stopProcess = async () => {};
    const responses = [];
    adapter.sendResponse = async (channel, content) => responses.push({ channel, content });

    await adapter._stopAllProcesses('Execution stopped by user');

    assert.equal(adapter._stoppingChannels.has('thread'), true);
    assert.deepEqual(responses, [{ channel: 'thread', content: 'Execution stopped by user' }]);
  });

  it('OpenCode channel-scoped stop only kills the targeted channel process', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    const proc1 = new EventEmitter();
    proc1.pid = 99999991;
    proc1.exitCode = null;
    const proc2 = new EventEmitter();
    proc2.pid = 99999992;
    proc2.exitCode = null;

    adapter._channelProcesses.channelA = proc1;
    adapter._channelProcesses.channelB = proc2;
    adapter._stopProcess = async () => {};
    const responses = [];
    captureNotices(adapter, responses);

    await adapter._onControlAction('stop', { channel: 'channelA' });

    assert.equal(adapter._stoppingChannels.has('channelA'), true);
    assert.equal(adapter._stoppingChannels.has('channelB'), false);
    assert.equal(adapter._channelProcesses.channelA, undefined);
    assert.ok(adapter._channelProcesses.channelB);
    assert.deepEqual(responses, [{ channel: 'channelA', content: 'Execution stopped by user.' }]);
  });

  it('OpenCode channel-scoped stop without a target process does not stop other channels', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    const proc = new EventEmitter();
    proc.pid = 99999992;
    proc.exitCode = null;

    adapter._channelProcesses.channelB = proc;
    adapter._channelQueues.channelA = [{ content: 'queued' }];
    let stopCalls = 0;
    adapter._stopProcess = async () => { stopCalls++; };
    const responses = [];
    captureNotices(adapter, responses);

    await adapter._onControlAction('stop', { channel: 'channelA' });

    assert.equal(stopCalls, 0);
    assert.equal(adapter._channelQueues.channelA, undefined);
    assert.ok(adapter._channelProcesses.channelB);
    assert.deepEqual(responses, [{ channel: 'channelA', content: 'Execution stopped by user.' }]);
  });

  it('OpenCode daemon stop calls _stopAllProcesses and then BaseAdapter stop', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    const proc = new EventEmitter();
    proc.pid = 99999999;
    proc.exitCode = null;

    adapter._channelProcesses.thread = proc;
    adapter._stopProcess = async () => {};
    const responses = [];
    adapter.sendResponse = async (channel, content) => responses.push({ channel, content });

    adapter.stop();
    await sleep(100);

    assert.equal(adapter._stoppingChannels.has('thread'), true);
    assert.equal(adapter._channelProcesses.thread, undefined);
    assert.deepEqual(responses, [{ channel: 'thread', content: 'Task interrupted — daemon restarting. Send another message to continue.' }]);
    assert.equal(adapter._running, false);
  });

  it('OpenCode suppresses normal writeback after intentional stop', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    const responses = [];
    const errors = [];

    adapter._autoTitleChannel = async () => {};
    adapter.sendStatus = async () => {};
    adapter.sendResponse = async (channel, content) => responses.push({ channel, content });
    adapter.sendError = async (channel, content) => errors.push({ channel, content });
    adapter._runOpencode = async (_content, channel) => {
      adapter._stoppingChannels.add(channel);
      return 'late response after stop';
    };

    await adapter._handleMessage({
      id: 'msg-1',
      content: 'hello',
      sessionId: 'thread',
      senderName: 'human:user',
    });

    assert.deepEqual(responses, []);
    assert.deepEqual(errors, []);
    assert.equal(adapter._stoppingChannels.has('thread'), false);
  });

  it('OpenCode drains complete JSON objects and keeps partial trailing data', () => {
    const raw = '{"type":"step_start"} {"type":"text","part":{"text":"hello"}} {"type":"tool_use"';

    const drained = OpenCodeAdapter._drainJsonObjects(raw);

    assert.deepEqual(drained.objects, [
      { type: 'step_start' },
      { type: 'text', part: { text: 'hello' } },
    ]);
    assert.equal(drained.rest, '{"type":"tool_use"');
  });

  it('OpenCode maps stream text and tool_use events to thinking and status', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    const thinking = [];
    const statuses = [];
    adapter.sendThinking = async (channel, content) => thinking.push({ channel, content });
    adapter.sendStatus = async (channel, content) => statuses.push({ channel, content });

    await adapter._handleStreamEvent({ type: 'text', part: { text: 'planning' } }, 'thread');
    await adapter._handleStreamEvent({
      type: 'tool_use',
      item: { name: 'Bash', input: { command: 'npm test' } },
    }, 'thread');
    await adapter._handleStreamEvent({ type: 'step_finish' }, 'thread');

    assert.deepEqual(thinking, [{ channel: 'thread', content: 'planning' }]);
    assert.deepEqual(statuses, [{
      channel: 'thread',
      content: '**Using tool:** `Bash`\n```\n{\n  "command": "npm test"\n}\n```',
    }]);
  });

  it('OpenCode tool status includes argument previews', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    const statuses = [];
    adapter.sendStatus = async (_channel, content) => statuses.push(content);

    await adapter._handleStreamEvent({
      type: 'tool_use',
      item: {
        name: 'Task',
        input: {
          description: 'medium-investigation',
          category: 'quick',
          prompt: 'inspect architecture details',
        },
      },
    }, 'thread');

    assert.equal(statuses.length, 1);
    assert.match(statuses[0], /^\*\*Using tool:\*\* `Task`\n```/);
    assert.equal(statuses[0].includes('medium-investigation'), true);
    assert.equal(statuses[0].includes('category'), true);
    assert.equal(statuses[0].includes('inspect architecture details'), true);
  });

  it('OpenCode tool status reads real state.input arguments', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    const statuses = [];
    adapter.sendStatus = async (_channel, content) => statuses.push(content);

    await adapter._handleStreamEvent({
      type: 'tool_use',
      part: {
        type: 'tool',
        tool: 'bash',
        state: {
          status: 'completed',
          input: {
            command: 'printf opencode-shape-test',
            description: 'Prints requested test string',
            workdir: '/tmp/opencode/openagents-real-shape-test',
          },
        },
      },
    }, 'thread');

    assert.equal(statuses.length, 1);
    assert.match(statuses[0], /^\*\*Using tool:\*\* `bash`\n```/);
    assert.equal(statuses[0].includes('printf opencode-shape-test'), true);
    assert.equal(statuses[0].includes('Prints requested test string'), true);
    assert.equal(statuses[0].includes('/tmp/opencode/openagents-real-shape-test'), true);
  });

  it('OpenCode tool status truncates long previews and uses safe fences', () => {
    const command = `\`\`\`break ${'x'.repeat(1100)}`;
    const preview = OpenCodeAdapter._formatToolStatus(
      'Bash',
      OpenCodeAdapter._toolInputPreview({ command })
    );

    assert.equal(preview.includes('x'.repeat(1001)), false);
    assert.match(preview, /````\n/);
  });

  it('OpenCode final response keeps only post-tool streamed text', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    adapter.sendThinking = async () => {};
    adapter.sendStatus = async () => {};
    const state = { finalText: '', seenText: false };

    const events = [
      { type: 'text', part: { text: 'I will inspect first. ' } },
      { type: 'tool_use', item: { name: 'Read', input: { path: '/secret' } } },
      { type: 'text', part: { text: 'Done after tool.' } },
    ];
    for (const event of events) {
      await adapter._handleStreamEvent(event, 'thread', state);
    }

    const raw = events.map((event) => JSON.stringify(event)).join(' ');
    assert.equal(OpenCodeAdapter._finalTextFromStdout(raw, state), 'Done after tool.');
  });

  it('OpenCode final response preserves fallback behavior for control and plain output', () => {
    assert.equal(
      OpenCodeAdapter._finalTextFromStdout('{"type":"step_start"} {"type":"tool_use","item":{"name":"Bash"}}'),
      ''
    );
    assert.equal(OpenCodeAdapter._finalTextFromStdout('plain non-json response'), 'plain non-json response');
  });

  it('OpenCode stop terminates the spawned process tree', async () => {
    const adapter = new OpenCodeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'opencode',
    });
    const script = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'console.log(child.pid);',
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const proc = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    // Killing the child can make its stdio/process emit 'error' (EPIPE/EBADF on
    // macOS). Swallow so it never becomes an unhandled 'error' that crashes the
    // test worker.
    proc.on('error', () => {});
    if (proc.stdout) proc.stdout.on('error', () => {});

    try {
      const childPid = Number(await readFirstLine(proc.stdout));
      assert.equal(isPidAlive(proc.pid), true);
      assert.equal(isPidAlive(childPid), true);

      await adapter._stopProcess(proc);
      await sleep(500);

      assert.equal(isPidAlive(proc.pid), false);
      assert.equal(isPidAlive(childPid), false);
    } finally {
      await adapter._stopProcess(proc);
    }
  });

  it('records the stop before the adapter tears its processes down', async () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'agent',
    });
    adapter.client = {
      pollControl: async () => [{ id: 'e1', payload: { action: 'stop', channel: 'thread' } }],
    };
    const before = adapter._stopGenerationFor('thread');
    let duringTeardown = null;
    adapter._stopChannelWork = async () => {
      duringTeardown = adapter._stopGenerationFor('thread');
      return 'idle';
    };
    adapter._finishUserStop = async () => {};

    await adapter._pollControl();

    assert.notEqual(duringTeardown, before);
    assert.equal(adapter._stopGenerationFor('thread'), duringTeardown);
  });

  it('drops a queued message the stop raced past in the drain loop', async () => {
    const adapter = stoppableAdapter('thread');
    const handled = [];
    adapter._handleMessage = async (m) => { handled.push(m.content); };
    adapter._channelQueues.thread = [{ content: 'queued', _queueId: 'q1' }];
    // The stop lands in the status post, after the drain loop has already
    // taken the message out of the queue — clearing `_channelQueues`, which
    // is all a stop handler does, cannot reach it any more.
    adapter.sendStatus = async () => { await adapter._pollControl(); };

    await adapter._channelWorker('thread', { content: 'first' });

    assert.deepEqual(handled, ['first']);
    assert.equal(adapter._channelBusy.has('thread'), false);
  });

  it('does not drain a follow-up queued by the turn the stop interrupted', async () => {
    const adapter = stoppableAdapter('thread');
    const handled = [];
    adapter._handleMessage = async (m) => {
      handled.push(m.content);
      if (m.content !== 'first') return;
      await adapter._pollControl();  // the stop lands mid-turn
      // Claude's todo nudge: queued on the way out of the stopped turn, so
      // the stop handler's queue wipe happened before it existed.
      adapter._channelQueues.thread = [{ content: 'continue your plan' }];
    };

    await adapter._channelWorker('thread', { content: 'first' });

    assert.deepEqual(handled, ['first']);
    assert.equal((adapter._channelQueues.thread || []).length, 0);
  });

  it('a workspace-wide stop reaches every channel worker', async () => {
    const adapter = stoppableAdapter(null);  // no channel — stop everything
    const handled = [];
    adapter._handleMessage = async (m) => { handled.push(m.content); };
    adapter._channelQueues.channelA = [{ content: 'queued', _queueId: 'q1' }];
    adapter.sendStatus = async () => { await adapter._pollControl(); };

    await adapter._channelWorker('channelA', { content: 'first' });

    assert.deepEqual(handled, ['first']);
  });

  it('Claude does not nudge a plan the user stopped', async () => {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
    });
    // Cancelling belongs to the stop path, which runs it before the notice;
    // doing it here would post the todo list after "Execution stopped".
    adapter.cleanupTodos = async () => { throw new Error('the stop path cancels todos'); };
    adapter.getRemainingTodos = async () => [{ content: 'unfinished task', status: 'pending' }];
    adapter._stoppingChannels.add('thread');

    await adapter._queueTodoNudge('thread', { content: 'do the work' });

    assert.equal(adapter._channelQueues.thread, undefined);
  });

  it('Claude still nudges unfinished todos when nothing was stopped', async () => {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
    });
    adapter.cleanupTodos = async () => { throw new Error('must not cancel a live plan'); };
    adapter.getRemainingTodos = async () => [{ content: 'unfinished task', status: 'pending' }];

    await adapter._queueTodoNudge('thread', { content: 'do the work' });

    assert.equal(adapter._channelQueues.thread.length, 1);
    assert.equal(adapter._channelQueues.thread[0]._todoNudge, true);
  });

  it('channel-scoped stop cancels that channel\'s todos', async () => {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
    });
    const proc = new EventEmitter();
    proc.pid = 99999993;
    proc.exitCode = null;
    adapter._channelProcesses.channelA = proc;
    adapter._stopProcess = async () => {};
    adapter.sendResponse = async () => {};
    const cancelled = [];
    adapter.cleanupTodos = async (channel) => cancelled.push(channel);

    await adapter._onControlAction('stop', { channel: 'channelA' });

    assert.deepEqual(cancelled, ['channelA']);
  });

  it('tells an adapter a stop landed while it was preparing the turn', async () => {
    const adapter = stoppableAdapter('thread');
    const seen = [];
    adapter._handleMessage = async () => {
      // Stands in for the round trips every adapter makes — session lookup,
      // thinking status, pinned knowledge — before it touches the CLI.
      await adapter._pollControl();
      seen.push(adapter._stopRequestedDuringTurn('thread'));
    };

    await adapter._channelWorker('thread', { content: 'first' });

    assert.deepEqual(seen, [true]);
    assert.equal(adapter._stopRequestedDuringTurn('thread'), false);
  });

  it('a turn that starts after the stop is not treated as interrupted', async () => {
    const adapter = stoppableAdapter('thread');
    await adapter._pollControl();  // the stop happened first
    const seen = [];
    adapter._handleMessage = async () => {
      seen.push(adapter._stopRequestedDuringTurn('thread'));
    };

    await adapter._channelWorker('thread', { content: 'a new message after the stop' });

    assert.deepEqual(seen, [false]);
  });

  it('Claude abandons a turn whose CLI had not started yet', async () => {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
    });
    const cancelled = [];
    adapter.cleanupTodos = async (channel) => cancelled.push(channel);
    const responses = [];
    captureNotices(adapter, responses);

    adapter._channelRunGeneration.thread = adapter._stopGenerationFor('thread');
    adapter._markStopRequested('thread');

    assert.equal(await adapter._bailOnStopDuringTurn('thread'), true);
    assert.deepEqual(cancelled, ['thread']);
    assert.deepEqual(responses, [{ channel: 'thread', content: 'Execution stopped by user.' }]);

    // A turn started after the stop is the user asking for new work.
    adapter._channelRunGeneration.thread = adapter._stopGenerationFor('thread');
    assert.equal(await adapter._bailOnStopDuringTurn('thread'), false);
    assert.deepEqual(cancelled, ['thread']);
  });

  it('Claude ends a stop on the notice, after the todo list it cancels', async () => {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
    });
    const proc = new EventEmitter();
    proc.pid = 99999994;
    proc.exitCode = null;
    adapter._channelProcesses.thread = proc;
    adapter._stopProcess = async () => {};
    const posted = [];
    // PUT /v1/todos emits the updated list into the channel as a message.
    const notices = [];
    captureNotices(adapter, notices);
    adapter.cleanupTodos = async () => posted.push('todo list');
    adapter.client.sendMessage = async (_ws, _channel, _token, content) => posted.push(content);

    await adapter._onControlAction('stop', { channel: 'thread' });

    assert.deepEqual(posted, ['todo list', 'Execution stopped by user.']);
  });

  it('a stop for an idle channel leaves the other channels running', async () => {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
    });
    const busy = new EventEmitter();
    busy.pid = 99999995;
    busy.exitCode = null;
    adapter._channelProcesses.channelA = busy;
    const killed = [];
    adapter._stopProcess = async (proc) => killed.push(proc.pid);
    adapter.cleanupTodos = async () => {};
    const responses = [];
    captureNotices(adapter, responses);

    await adapter._onControlAction('stop', { channel: 'channelC' });

    assert.deepEqual(killed, []);
    assert.ok(adapter._channelProcesses.channelA);
    // The channel the user pressed Stop in still gets its notice, so its UI
    // settles even though nothing was running there.
    assert.deepEqual(responses, [{ channel: 'channelC', content: 'Execution stopped by user.' }]);
  });

  it('output the CLI wrote before it was stopped is never posted', {
    skip: process.platform === 'win32' && 'drives a .js fake CLI, which only resolves on Unix',
  }, async (t) => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-fake-cli-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    // Answers the first prompt with a burst: five thinking blocks and a
    // finished result, then stays alive like the real CLI does.
    const fakeCli = path.join(dir, 'fake-claude.js');
    fs.writeFileSync(fakeCli, [
      "process.stdin.once('data', () => {",
      '  const lines = [];',
      "  for (let i = 0; i < 5; i++) lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'step ' + i }] } }));",
      "  lines.push(JSON.stringify({ type: 'result', session_id: 'sess-1', result: 'the final answer' }));",
      "  process.stdout.write(lines.join('\\n') + '\\n');",
      '});',
      'setInterval(() => {}, 1000);',
    ].join('\n'));

    const adapter = new ClaudeAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'claude',
      workingDir: dir,
    });
    adapter._saveSessions = () => {};
    const posted = [];
    // A slow post keeps the rest of the burst queued behind it — the state a
    // real stop lands in.
    adapter.sendThinking = async (_channel, text) => { await sleep(150); posted.push(text); };
    adapter.sendStatus = async (_channel, text) => posted.push(text);
    adapter.sendResponse = async (_channel, text) => posted.push(text);
    adapter.cleanupTodos = async () => {};
    adapter.client.sendMessage = async (_ws, _channel, _token, text) => posted.push(text);

    const pp = adapter._spawnPersistentProc('thread', [fakeCli], process.env);
    pp.msgChannel = 'thread';
    const turn = adapter._sendToPersistentProc(pp, 'go');
    try {
      const deadline = Date.now() + 5000;
      while (pp.lastResponseText.length === 0 && Date.now() < deadline) await sleep(10);
      assert.ok(pp.lastResponseText.length > 0, 'fake CLI never answered');

      await adapter._onControlAction('stop', { channel: 'thread' });
      await turn;

      assert.equal(posted[posted.length - 1], 'Execution stopped by user.');
      assert.ok(!posted.includes('the final answer'), `answer posted after stop: ${JSON.stringify(posted)}`);
      assert.ok(!posted.includes('step 4'), `leftover thinking posted: ${JSON.stringify(posted)}`);
      // The conversation is still resumable on the next message.
      assert.equal(adapter._channelSessions.thread, 'sess-1');
    } finally {
      await adapter._stopProcess(pp.proc);
    }
  });
});

// ---------------------------------------------------------------------------
// A stop in one thread never reaches the same agent's work in another thread.
//
// The workspace sends Stop to every participant of the thread it was pressed
// in, with that thread's channel. Several adapters used to ignore the channel
// and kill every run they had, or fall back to that whenever the named thread
// happened to be idle — so stopping thread A also killed the same agent's
// work in thread B.
// ---------------------------------------------------------------------------

const { createAdapter } = require('../src/adapters');

const PROCESS_ADAPTERS = [
  'claude', 'codex', 'kimi', 'aider', 'amp', 'antigravity', 'cline', 'codebuddy',
  'commandcode', 'copilot', 'cursor', 'deepseek', 'gemini', 'goose', 'hermes',
  'mini-swe-agent', 'muse', 'opencode', 'openworker', 'pi',
];

function fakeProc(pid) {
  const proc = new EventEmitter();
  proc.pid = pid;
  proc.exitCode = null;
  return proc;
}

function crossChannelAdapter(type) {
  const os = require('node:os');
  const adapter = createAdapter(type, {
    workspaceId: 'ws',
    channelName: 'general',
    token: 'token',
    agentName: `${type}-bot`,
    agentType: type,
    workingDir: os.tmpdir(),
  });
  adapter._log = () => {};
  const killed = [];
  // A confirmed kill, in the shape every adapter's _stopProcess resolves to.
  adapter._stopProcess = async (proc) => { killed.push(proc.pid); proc.exitCode = 0; return true; };
  const notices = [];
  captureNotices(adapter, notices);
  return { adapter, killed, notices };
}

/**
 * Register a running turn for `channel` the way the adapter itself would, and
 * return a check for whether that turn is still alive. OpenWorker's turns are
 * engine sockets; every other adapter here runs a child process per channel.
 */
function startRun(type, adapter, killed, channel, id) {
  adapter._channelBusy.add(channel);
  if (type === 'openworker') {
    const socket = { closed: false, send() {}, close() { this.closed = true; killed.push(id); } };
    adapter._sleep = async () => {};
    adapter._channelSockets[channel] = socket;
    return () => !socket.closed && adapter._channelSockets[channel] === socket;
  }
  const proc = fakeProc(id);
  adapter._channelProcesses[channel] = proc;
  return () => adapter._channelProcesses[channel] === proc;
}

describe('a stop stays inside its thread', () => {
  for (const type of PROCESS_ADAPTERS) {
    it(`${type}: stopping thread A leaves the run in thread B alone`, async () => {
      const { adapter, killed, notices } = crossChannelAdapter(type);
      const aAlive = startRun(type, adapter, killed, 'channelA', 201);
      const bAlive = startRun(type, adapter, killed, 'channelB', 202);

      await adapter._onControlAction('stop', { channel: 'channelA' });

      assert.equal(aAlive(), false, `${type} did not stop thread A`);
      assert.equal(bAlive(), true, `${type} stopped thread B too`);
      assert.ok(!killed.includes(202), `${type} killed thread B's run`);
      assert.equal(adapter._isMuted('channelB'), false);
      assert.deepEqual(notices, [{ channel: 'channelA', content: 'Execution stopped by user.' }]);
    });

    it(`${type}: stopping an idle thread A still leaves thread B alone`, async () => {
      const { adapter, killed, notices } = crossChannelAdapter(type);
      const bAlive = startRun(type, adapter, killed, 'channelB', 302);

      await adapter._onControlAction('stop', { channel: 'channelA' });

      assert.deepEqual(killed, [], `${type} killed thread B's run`);
      assert.equal(bAlive(), true);
      // The thread the user pressed Stop in is still answered, so its UI settles.
      assert.deepEqual(notices, [{ channel: 'channelA', content: 'Execution stopped by user.' }]);
    });
  }

  it('a direct-API run is stopped per thread too', async () => {
    const { adapter, notices } = crossChannelAdapter('kimi');
    const destroyed = [];
    const request = (channel) => ({ _oaChannel: channel, destroy: () => destroyed.push(channel) });
    adapter._activeRequests.add(request('channelA'));
    adapter._activeRequests.add(request('channelB'));
    adapter._channelBusy.add('channelA');
    adapter._channelBusy.add('channelB');

    await adapter._onControlAction('stop', { channel: 'channelA' });

    assert.deepEqual(destroyed, ['channelA']);
    assert.equal(adapter._activeRequests.size, 1);
    assert.deepEqual(notices, [{ channel: 'channelA', content: 'Execution stopped by user.' }]);
  });

  it('a workspace-wide stop reaches every busy thread, and only announces those', async () => {
    const { adapter, killed, notices } = crossChannelAdapter('codex');
    adapter._channelProcesses.channelA = fakeProc(401);
    adapter._channelProcesses.channelB = fakeProc(402);
    adapter._channelBusy.add('channelA');
    adapter._channelBusy.add('channelB');

    await adapter._onControlAction('stop', {});

    assert.deepEqual(killed.sort(), [401, 402]);
    assert.deepEqual(notices.map((n) => n.channel).sort(), ['channelA', 'channelB']);
  });
});

describe('a stopped thread goes quiet until its next turn', () => {
  it('drops what a stopped run was still posting, and says "stopped" last', async () => {
    const { adapter, notices } = crossChannelAdapter('codex');
    const posted = [];
    adapter.client.sendMessage = async (_ws, channel, _t, content) => posted.push({ channel, content });
    adapter._channelProcesses.channelA = fakeProc(501);
    adapter._channelBusy.add('channelA');

    await adapter._onControlAction('stop', { channel: 'channelA' });
    // The killed CLI's last output, arriving after the stop.
    await adapter.sendThinking('channelA', 'still thinking');
    await adapter.sendStatus('channelA', 'Bash › ls');
    await adapter.sendResponse('channelA', 'the answer');
    await adapter.sendError('channelA', 'exited with code 143');
    // The same agent in another thread is not muted.
    await adapter.sendResponse('channelB', 'answer in B');

    assert.equal(notices.length, 0);
    assert.deepEqual(posted, [
      { channel: 'channelA', content: 'Execution stopped by user.' },
      { channel: 'channelB', content: 'answer in B' },
    ]);
  });

  it('a message sent after the stop runs, even while the stopped run winds down', async () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'agent',
    });
    adapter._log = () => {};
    adapter._prefetchPinnedContext = async () => {};
    const posted = [];
    adapter.client.getTodos = async () => ({ todos: [] });
    adapter.client.sendMessage = async (_ws, _c, _t, content) => posted.push(content);
    const handled = [];
    let followUp;
    adapter._handleMessage = async (m) => {
      handled.push(m.content);
      if (m.content !== 'first') {
        await adapter.sendResponse('thread', `answer to ${m.content}`);
        return;
      }
      await adapter._onControlAction('stop', { channel: 'thread' });
      // The user types again before this stopped turn has returned: the
      // message is queued behind it, under the new stop generation.
      followUp = adapter._dispatchMessage({ content: 'second', sessionId: 'thread' });
      await followUp;
    };

    await adapter._dispatchMessage({ content: 'first', sessionId: 'thread' });
    for (let i = 0; i < 50 && adapter._channelBusy.has('thread'); i++) await sleep(10);

    assert.deepEqual(handled, ['first', 'second']);
    assert.deepEqual(posted.slice(-2), ['Execution stopped by user.', 'answer to second']);
  });
});

describe('the workspace client re-sending Stop', () => {
  it('does not discard what the user typed after the first press', async () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'agent',
    });
    adapter._log = () => {};
    adapter._prefetchPinnedContext = async () => {};
    const notices = [];
    captureNotices(adapter, notices);
    const handled = [];
    let release;
    const windingDown = new Promise((r) => { release = r; });
    adapter._handleMessage = async (m) => {
      handled.push(m.content);
      if (m.content === 'first') await windingDown;
    };

    await adapter._dispatchMessage({ content: 'first', sessionId: 'thread' });
    await adapter._onControlAction('stop', { channel: 'thread' });
    await adapter._dispatchMessage({ content: 'typed after stop', sessionId: 'thread' });
    // chat-view.tsx re-sends the stop 3s later while it still shows "Stopping…".
    await adapter._onControlAction('stop', { channel: 'thread' });
    release();
    for (let i = 0; i < 50 && adapter._channelBusy.has('thread'); i++) await sleep(10);

    assert.deepEqual(handled, ['first', 'typed after stop']);
    assert.equal(notices.length, 1, 'the repeat is not announced twice');
  });
});

// ---------------------------------------------------------------------------
// A stop that lands while a turn is still being prepared starts nothing.
//
// Preparing a turn takes several round trips before the CLI starts. A run
// started after the stop still calls the model — its output is muted, but
// the tokens are spent. Every adapter checks right before it starts.
// ---------------------------------------------------------------------------

const MISSING_BIN = '/nonexistent/openagents-test-cli';

/** Each adapter's own entry point for starting a run, with the prep it needs. */
const START_RUN = {
  claude: null, // covered by 'Claude abandons a turn whose CLI had not started yet'
  aider: { start: (a, ch) => a._spawnAider([MISSING_BIN], ch), stopped: { text: '', error: null } },
  amp: { start: (a, ch) => a._spawnAmp([MISSING_BIN], 'p', ch), stopped: { text: '', stale: false } },
  'mini-swe-agent': { start: (a, ch) => a._spawnMini([MISSING_BIN], ch), stopped: { text: '', error: null } },
  codex: {
    start: (a, ch) => a._spawnCodex([MISSING_BIN], {}, ch, 'p'),
    stopped: { stopped: true, responseText: '', exitCode: null },
  },
  hermes: { start: (a, ch) => { a._hermesBin = MISSING_BIN; return a._runHermes('p', ch); }, stopped: '' },
  cline: { start: (a, ch) => a._runCline(ch, MISSING_BIN, [], require('node:os').tmpdir()), stopped: { userStopped: true } },
  kimi: { start: (a, ch) => a._runKimi(ch, MISSING_BIN, [], require('node:os').tmpdir()), stopped: { userStopped: true } },
  commandcode: {
    start: (a, ch) => a._runCommandCode(ch, MISSING_BIN, [], require('node:os').tmpdir(), 'p'),
    stopped: { userStopped: true },
  },
  codebuddy: {
    start: (a, ch) => a._runCodeBuddy(ch, MISSING_BIN, [], require('node:os').tmpdir(), 'p'),
    stopped: { userStopped: true },
  },
  copilot: { start: (a, ch) => { a._copilotBin = MISSING_BIN; return a._runTurn(ch, []); }, stopped: { userStopped: true } },
  muse: {
    start: (a, ch) => a._runMuse(ch, MISSING_BIN, [], require('node:os').tmpdir(), {}),
    stopped: { userStopped: true },
  },
  goose: {
    start: (a, ch) => {
      a._resolveCwd = () => require('node:os').tmpdir();
      a._versionTooOldMessage = () => null;
      a._buildSystemPrompt = () => '';
      a._buildCmd = () => [MISSING_BIN];
      a._buildEnv = () => ({});
      return a._runGoose('p', ch);
    },
    stopped: null,
  },
  opencode: {
    start: (a, ch) => {
      a._preflight = () => ({ ok: true });
      a._opencodeBinary = MISSING_BIN;
      a._resolveCwd = () => require('node:os').tmpdir();
      a._ensureCustomProviderConfig = () => {};
      a._resolveModel = () => 'openai/gpt-4o';
      a._ensureWorkspaceSkill = () => {};
      a._buildSystemContext = () => '';
      return a._runOpencode('p', ch);
    },
    stopped: '',
  },
  openclaw: { start: (a, ch) => { a._openclawBinary = MISSING_BIN; return a._runCliAgent('p', ch); }, stopped: '' },
  openworker: {
    start: (a, ch) => a._runTurn(ch, { port: 1, token: 't' }, 's', require('node:os').tmpdir(), 'p', {}),
    stopped: { texts: [], error: null, interrupted: false, userStopped: true, sent: false },
  },
};

/** An adapter whose current turn in `channel` was stopped while being prepared. */
async function stoppedWhilePreparing(type, channel) {
  const { adapter } = crossChannelAdapter(type);
  adapter._channelRunGeneration[channel] = adapter._stopGenerationFor(channel);
  adapter._channelBusy.add(channel);
  await adapter._onControlAction('stop', { channel });
  // A turn's own handler clears the flag when it starts; some do it only
  // after their first await, which can run after the stop landed.
  adapter._stoppingChannels.delete(channel);
  const registered = [];
  adapter._onProcessRegistered = (ch, proc) => registered.push({ ch, proc });
  const guards = [];
  const guard = adapter._stoppedBeforeStart.bind(adapter);
  adapter._stoppedBeforeStart = (ch) => { const r = guard(ch); guards.push(r); return r; };
  return { adapter, registered, guards };
}

describe('a stop during preparation starts no run', () => {
  for (const [type, spec] of Object.entries(START_RUN)) {
    if (!spec) continue;
    it(`${type}: does not start its CLI`, async () => {
      const { adapter, registered, guards } = await stoppedWhilePreparing(type, 'channelA');

      const result = await spec.start(adapter, 'channelA');

      assert.deepEqual(guards, [true], `${type} did not check before starting`);
      assert.deepEqual(registered, [], `${type} started a process anyway`);
      assert.deepEqual(result, spec.stopped);
      assert.equal(adapter._stoppingChannels.has('channelA'), true,
        'the turn\'s handler must read its end as a user stop');
    });
  }

  it('a direct-API turn never sends the request', async () => {
    const { adapter, guards } = await stoppedWhilePreparing('kimi', 'channelA');
    adapter._directMode = true;
    let called = 0;
    adapter._callCompletionApi = async () => { called++; return 'answer'; };
    adapter._autoTitleChannel = async () => {};

    await require('../src/adapters/llm-direct').prototype._handleMessage.call(
      adapter, { content: 'hi', sessionId: 'channelA' },
    );

    assert.equal(called, 0);
    assert.deepEqual(guards, [true]);
  });

  it('the check lets a turn that was not stopped start', () => {
    const { adapter } = crossChannelAdapter('codex');
    adapter._channelRunGeneration.channelA = adapter._stopGenerationFor('channelA');
    assert.equal(adapter._stoppedBeforeStart('channelA'), false);
  });
});

describe('a run registered for a turn stopped while preparing is killed at once', () => {
  it('kills the child the moment it is registered', async () => {
    const { adapter, killed } = crossChannelAdapter('codex');
    adapter._channelRunGeneration.channelA = adapter._stopGenerationFor('channelA');
    await adapter._onControlAction('stop', { channel: 'channelA' });

    // An adapter that skipped the explicit check spawns and registers anyway.
    adapter._channelProcesses.channelA = fakeProc(601);
    await sleep(0);

    assert.deepEqual(killed, [601]);
    assert.equal(adapter._channelProcesses.channelA, undefined);
    assert.equal(adapter._stoppingChannels.has('channelA'), true);
  });

  it('leaves a run alone when its turn was not stopped', async () => {
    const { adapter, killed } = crossChannelAdapter('codex');
    adapter._channelRunGeneration.channelA = adapter._stopGenerationFor('channelA');
    // A stop in ANOTHER thread.
    await adapter._onControlAction('stop', { channel: 'channelB' });

    const proc = fakeProc(602);
    adapter._channelProcesses.channelA = proc;
    await sleep(0);

    assert.deepEqual(killed, []);
    assert.equal(adapter._channelProcesses.channelA, proc);
  });

  it('works for every adapter, including ones that replace the registry', () => {
    for (const type of [...PROCESS_ADAPTERS, 'openclaw']) {
      const { adapter } = crossChannelAdapter(type);
      let seen = null;
      adapter._onProcessRegistered = (ch) => { seen = ch; };
      adapter._channelProcesses = {};
      adapter._channelProcesses.channelZ = fakeProc(700);
      assert.equal(seen, 'channelZ', `${type}'s registry is not watched`);
    }
  });
});
