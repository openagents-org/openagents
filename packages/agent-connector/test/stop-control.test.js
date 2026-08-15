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
    adapter.sendCancelled = async (trigger, channel, content) => responses.push({ channel, content });
    adapter.sendFinalResult = async (trigger, channel, content) => responses.push({ channel, content });

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
    adapter.sendResponse = async (channel, content) => responses.push({ channel, content });
    adapter.sendCancelled = async (trigger, channel, content) => responses.push({ channel, content });
    adapter.sendFinalResult = async (trigger, channel, content) => responses.push({ channel, content });

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
    adapter.sendCancelled = async (trigger, channel, content) => responses.push({ channel, content });
    adapter.sendFinalResult = async (trigger, channel, content) => responses.push({ channel, content });

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
    adapter.sendResponse = async (channel, content) => responses.push({ channel, content });
    adapter.sendCancelled = async (trigger, channel, content) => responses.push({ channel, content });
    adapter.sendFinalResult = async (trigger, channel, content) => responses.push({ channel, content });

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
    adapter.sendResponse = async (channel, content) => responses.push({ channel, content });
    adapter.sendCancelled = async (trigger, channel, content) => responses.push({ channel, content });
    adapter.sendFinalResult = async (trigger, channel, content) => responses.push({ channel, content });

    await adapter._onControlAction('stop', { channel: 'channelA' });

    assert.equal(stopCalls, 0);
    assert.equal(adapter._stoppingChannels.has('channelA'), false);
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
    adapter.sendCancelled = async (trigger, channel, content) => responses.push({ channel, content });
    adapter.sendFinalResult = async (trigger, channel, content) => responses.push({ channel, content });

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
    adapter.sendCancelled = async (trigger, channel, content) => responses.push({ channel, content });
    adapter.sendFinalResult = async (trigger, channel, content) => responses.push({ channel, content });
    adapter.sendError = async (channel, content) => errors.push({ channel, content });
    adapter.sendFinalError = async (trigger, channel, content) => errors.push({ channel, content });
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
});
