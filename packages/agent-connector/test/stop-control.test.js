'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { spawn } = require('node:child_process');

const BaseAdapter = require('../src/adapters/base');
const ClaudeAdapter = require('../src/adapters/claude');

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
    const statuses = [];
    adapter.sendStatus = async (channel, content) => statuses.push({ channel, content });

    await adapter._stopAllProcesses();

    assert.equal(adapter._stoppingChannels.has('thread'), true);
    assert.deepEqual(statuses, [{ channel: 'thread', content: 'Execution stopped by user' }]);
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
});
