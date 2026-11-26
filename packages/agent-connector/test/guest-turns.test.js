'use strict';

/**
 * OpenAgents Share: a guest of a shared thread posts as
 * guest-<id>@guest.invalid. Their turn runs read-only on adapters that can
 * enforce it (Claude), and is declined everywhere else.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BaseAdapter = require('../src/adapters/base');
const ClaudeAdapter = require('../src/adapters/claude');

const { isGuestMessage } = BaseAdapter;

function guestMsg(extra = {}) {
  return {
    messageId: 'm-guest',
    sessionId: 'share-abc',
    senderType: 'human',
    senderName: 'guest-1@guest.invalid',
    senderEmail: 'guest-1@guest.invalid',
    content: '@reviewer please review https://github.com/example/repo/pull/42',
    metadata: { guest: { id: '1', name: 'Maya' } },
    ...extra,
  };
}

function ownerMsg() {
  return { messageId: 'm-owner', sessionId: 'share-abc', senderType: 'human',
    senderName: 'alex@acme.test', senderEmail: 'alex@acme.test', content: '@reviewer hi', metadata: {} };
}

function hermetic(adapter) {
  adapter._saveSessions = () => {};
  adapter.responses = [];
  adapter.sendStatus = async () => {};
  adapter.sendResponse = async (ch, text) => { adapter.responses.push(text); };
  adapter.sendError = async () => {};
  adapter._prefetchPinnedContext = async () => {};
  adapter._applyThreadHistory = async () => {};
  adapter._applyThreadCollaboration = () => {};
  adapter._sharedContextCandidate = () => false;
  return adapter;
}

function mkClaude() {
  const adapter = new ClaudeAdapter({ workspaceId: 'ws', channelName: 'general', token: 'tok', agentName: 'reviewer' });
  adapter._findClaudeBinary = () => '/usr/bin/claude';
  adapter.workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-turns-'));
  return hermetic(adapter);
}

describe('guest messages', () => {
  it('recognises a guest by the reserved address or the guest marker', () => {
    assert.equal(isGuestMessage(guestMsg()), true);
    assert.equal(isGuestMessage(guestMsg({ metadata: {} })), true);
    assert.equal(isGuestMessage(guestMsg({ senderEmail: undefined })), true);
    assert.equal(isGuestMessage(ownerMsg()), false);
    assert.equal(isGuestMessage({ ...guestMsg(), senderType: 'agent' }), false, 'agents are never guests');
  });

  it('an adapter that cannot enforce read-only declines the guest instead of running', async () => {
    const adapter = hermetic(new BaseAdapter({ workspaceId: 'ws', channelName: 'general', token: 'tok', agentName: 'bot' }));
    let ran = 0;
    adapter._handleMessage = async () => { ran++; };
    await adapter._channelWorker('share-abc', guestMsg());
    assert.equal(ran, 0);
    assert.equal(adapter.responses.length, 1);
    assert.match(adapter.responses[0], /guests/);

    await adapter._channelWorker('share-abc', ownerMsg());
    assert.equal(ran, 1, 'the owner is unaffected');
  });

  it('Claude runs a guest turn in guest mode and drops it afterwards', async () => {
    const adapter = mkClaude();
    const modes = [];
    adapter._handleMessage = async (msg) => { modes.push(adapter._effectiveMode(msg.sessionId)); };
    await adapter._channelWorker('share-abc', guestMsg());
    await adapter._channelWorker('share-abc', ownerMsg());
    assert.deepEqual(modes, ['guest', 'execute']);
    assert.equal(adapter._guestChannels.size, 0);
  });

  it('a guest turn never gets the shell, file writes or skipped permissions', () => {
    for (const toolMode of ['skills', 'mcp']) {
      const adapter = mkClaude();
      adapter.toolMode = toolMode;
      adapter._guestChannels.add('share-abc');
      const { cmd } = adapter._buildClaudeCmd('review this', 'share-abc', { skipResume: true });
      assert.ok(!cmd.includes('--dangerously-skip-permissions'), toolMode);
      const allowedAt = cmd.lastIndexOf('--allowedTools');
      const allowed = [];
      for (let i = allowedAt + 1; i < cmd.length && !cmd[i].startsWith('--'); i++) allowed.push(cmd[i]);
      for (const tool of ['Bash', 'Write', 'Edit']) assert.ok(!allowed.includes(tool), `${toolMode}: ${tool} allowed`);
      assert.ok(allowed.includes('Read') && allowed.includes('WebFetch'), toolMode);
      const disAt = cmd.indexOf('--disallowedTools');
      const disallowed = [];
      for (let i = disAt + 1; i < cmd.length && !cmd[i].startsWith('--'); i++) disallowed.push(cmd[i]);
      for (const tool of ['Bash', 'Write', 'Edit']) assert.ok(disallowed.includes(tool), `${toolMode}: ${tool} not denied`);
      assert.equal(cmd[cmd.indexOf('--permission-mode') + 1], 'default');
    }
  });

  it("the owner's own turn keeps the owner's mode", () => {
    const adapter = mkClaude();
    adapter.toolMode = 'skills';
    const { cmd } = adapter._buildClaudeCmd('hi', 'share-abc', { skipResume: true });
    assert.ok(cmd.includes('--dangerously-skip-permissions'));
  });

  it('says on join whether it can take guest turns', async () => {
    for (const [adapter, expected] of [
      [mkClaude(), ['guest_turns', 'scoped_turns']],
      [hermetic(new BaseAdapter({ workspaceId: 'ws', channelName: 'general', token: 'tok', agentName: 'bot' })), []],
    ]) {
      let sent;
      adapter.client.joinNetwork = async (name, token, opts) => { sent = opts.capabilities; return { session_id: 's' }; };
      adapter._reportStatus = () => {};
      await adapter._joinWorkspace();
      assert.deepEqual(sent, expected);
    }
  });
});

describe('guest turn errors', () => {
  it("never posts the CLI's raw error text into a guest's thread", async () => {
    const adapter = mkClaude();
    const errors = [];
    adapter.sendError = async (ch, text) => { errors.push(text); };
    adapter._guestChannels.add('share-abc');
    const raw = 'API Error: safeguards flagged this session. Request ID: req_123';
    await adapter._postTurnOutcome({ lastErrorText: raw, responseModel: null }, 'share-abc', `Partial answer.\n${raw}`);
    assert.deepEqual(adapter.responses, ['Partial answer.']);
    assert.equal(errors.length, 1);
    assert.doesNotMatch(errors[0], /req_123|safeguards/);
    adapter._guestChannels.delete('share-abc');
  });

  it("a guest turn neither resumes nor becomes the owner's CLI session", () => {
    const adapter = mkClaude();
    adapter.toolMode = 'skills';
    adapter._channelSessions['share-abc'] = 'owner-session';
    adapter._guestChannels.add('share-abc');
    const { cmd } = adapter._buildClaudeCmd('hi', 'share-abc');
    assert.ok(!cmd.includes('--resume'), 'no --resume for a guest turn');
    adapter._rememberSession({ msgChannel: 'share-abc', spawnMode: 'guest' }, 'guest-session');
    assert.equal(adapter._channelSessions['share-abc'], 'owner-session');
    adapter._guestChannels.delete('share-abc');
    const owner = adapter._buildClaudeCmd('hi', 'share-abc').cmd;
    assert.equal(owner[owner.indexOf('--resume') + 1], 'owner-session');
    adapter._rememberSession({ msgChannel: 'share-abc', spawnMode: 'execute' }, 'owner-2');
    assert.equal(adapter._channelSessions['share-abc'], 'owner-2');
  });
});

describe('an agent a guest brought into someone else\'s room', () => {
  it('runs only its own guest with full rights; everyone else as a guest', async () => {
    const adapter = mkClaude();
    adapter.client.joinNetwork = async () => ({ session_id: 's',
      scoped: { channel: 'share-abc', owner_address: 'guest-1@guest.invalid' } });
    adapter._reportStatus = () => {};
    let caps;
    const join = adapter.client.joinNetwork;
    adapter.client.joinNetwork = async (n, t, opts) => { caps = opts.capabilities; return join(); };
    await adapter._joinWorkspace();
    assert.ok(caps.includes('scoped_turns'));
    const modes = [];
    adapter._handleMessage = async (msg) => { modes.push(adapter._effectiveMode(msg.sessionId)); };
    await adapter._channelWorker('share-abc', guestMsg());                        // its own guest
    await adapter._channelWorker('share-abc', ownerMsg());                        // the room's owner
    await adapter._channelWorker('share-abc', guestMsg({ senderEmail: 'guest-2@guest.invalid',
      senderName: 'guest-2@guest.invalid' }));                                    // another guest
    await adapter._channelWorker('share-abc', { ...ownerMsg(), senderType: 'agent',
      senderName: 'pr-reviewer', senderEmail: undefined });                       // another agent
    assert.deepEqual(modes, ['execute', 'guest', 'guest', 'guest']);
  });
});
