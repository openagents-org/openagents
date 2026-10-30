'use strict';

/**
 * cursor-agent -p does not always exit after its `result` event. The adapter
 * sends the reply from the exit handler, so a CLI left hanging held the answer
 * back until the 300s idle kill — a first message that took ~7 minutes. The
 * adapter now ends the process shortly after `result`.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CursorAdapter = require('../src/adapters/cursor');

let root;

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cursor-result-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

/** A fake cursor-agent that answers, emits `result`, then never exits. */
function hangingCli() {
  const bin = path.join(root, 'cursor-agent');
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'sess-1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hello there' }] } },
    { type: 'result', subtype: 'success', session_id: 'sess-1', is_error: false },
  ].map((e) => `echo '${JSON.stringify(e)}'`);
  fs.writeFileSync(bin, ['#!/bin/sh', ...lines, 'sleep 600', ''].join('\n'), { mode: 0o755 });
  return bin;
}

function makeAdapter(bin) {
  const a = new CursorAdapter({ workspaceId: 'ws-1', channelName: 'general', token: 't', agentName: 'cur' });
  a._log = () => {};
  a._sessionsFile = path.join(root, 'sessions.json');
  a.workingDir = root;
  a.responses = [];
  a._findCursorBinary = () => bin;
  a._resolveToNodeCmd = () => null;
  a._writeSkillFile = () => {};
  a.client = { getSession: async () => ({}), updateSession: async () => {} };
  a.sendThinking = async () => {};
  a.sendStatus = async () => {};
  a.sendResponse = async (channel, text) => { a.responses.push({ channel, text }); };
  a.getRemainingTodos = async () => [];
  return a;
}

describe('CursorAdapter — a CLI that hangs after its result', { skip: process.platform === 'win32' }, () => {
  it('posts the reply within seconds instead of waiting for the idle kill', async () => {
    const a = makeAdapter(hangingCli());
    const started = Date.now();
    await a._handleMessage({ content: 'hi', sessionId: 'general', senderName: 'user' });
    assert.ok(Date.now() - started < 15000, `took ${Date.now() - started}ms`);
    assert.deepEqual(a.responses, [{ channel: 'general', text: 'hello there' }]);
    assert.equal(a._channelSessions.general, 'sess-1');
  });
});
