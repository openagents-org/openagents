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
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for child pid')), 3000);
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const idx = buffer.indexOf('\n');
      if (idx >= 0) {
        clearTimeout(timeout);
        resolve(buffer.slice(0, idx).trim());
      }
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
    adapter.sendResponse = async (channel, content) => responses.push({ channel, content });

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
