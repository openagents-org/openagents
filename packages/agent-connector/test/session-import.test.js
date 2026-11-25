'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Daemon } = require('../src/daemon');
const { Config } = require('../src/config');
const { EnvManager } = require('../src/env');
const { Registry } = require('../src/registry');
const { recordImport, pendingImport, importsFile } = require('../src/session-imports');
const ClaudeAdapter = require('../src/adapters/claude');
const CodexAdapter = require('../src/adapters/codex');
const OpenCodeAdapter = require('../src/adapters/opencode');
const { claudeProjectDir } = require('../src/host-agent');
const { listLocalSessions, readLocalSession } = require('../src/local-sessions');

const SID = '11111111-2222-3333-4444-555555555555';
const CODEX_SID = '01a11d54-e2e8-7aa3-9fb3-579101b2b98e';

let tmp; let saved;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-import-'));
  saved = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME, OPENAGENTS_HOME: process.env.OPENAGENTS_HOME };
  mock.method(os, 'homedir', () => tmp); // keep the adapter's import and copy records in the fixture
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
  process.env.CODEX_HOME = path.join(tmp, 'codex');
  process.env.OPENAGENTS_HOME = path.join(tmp, 'custom-openagents');
});
afterEach(() => {
  mock.restoreAll();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function claudeSession(turns) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-work-app');
  fs.mkdirSync(dir, { recursive: true });
  const rows = [];
  for (let i = 0; i < turns; i++) {
    rows.push({ sessionId: SID, cwd: '/work/app', type: 'user', timestamp: '2026-11-01T10:00:00Z', message: { role: 'user', content: `question ${i}` } });
    rows.push({ sessionId: SID, cwd: '/work/app', type: 'assistant', timestamp: '2026-11-01T10:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] } });
  }
  const file = path.join(dir, `${SID}.jsonl`);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

describe('import_local_session (daemon)', () => {
  function daemonWith(agent) {
    const config = new Config(path.join(tmp, 'oa'));
    if (agent) {
      const { network, node_id: nodeId, ...base } = agent;
      config.addAgent(base);
      if (network) config.updateAgent(base.name, { network, node_id: nodeId });
    }
    const daemon = new Daemon(config, new EnvManager(path.join(tmp, 'oa')), new Registry(path.join(tmp, 'oa')));
    const calls = [];
    let result = null;
    daemon._nodeClients.set('n1', {
      importSession: async (nodeId, token, body) => { calls.push({ nodeId, token, body }); return { channel: 'channel-imp1', title: body.title }; },
      nodeCommandResult: async (_id, _tok, res) => { result = res; },
    });
    const node = { node_id: 'n1', workspace_id: 'w1', workspace_slug: 'ws', token: 'tok', endpoint: 'https://ws' };
    return { daemon, calls, node, result: () => result };
  }

  it('uploads the session in batches of at most 50, the first creating the thread', async () => {
    claudeSession(60); // 120 messages
    const { daemon, calls, node, result } = daemonWith({ name: 'cc', type: 'claude', network: 'w1', node_id: 'n1' });
    await daemon._runNodeCommand(node, { commandId: 'c1', action: 'import_local_session', args: { type: 'claude', id: SID, agent: 'cc' } });
    assert.equal(result().ok, true, result().message);
    assert.deepEqual(calls.map((c) => c.body.messages.length), [50, 50, 20]);
    assert.equal(calls[0].body.channel, undefined, 'the first call creates the thread');
    assert.ok(calls.slice(1).every((c) => c.body.channel === 'channel-imp1'));
    // The workspace takes session, tool and agent from the owner's command.
    assert.ok(calls.every((c) => c.body.command_id === 'c1'));
    assert.equal(calls[0].body.session_id, undefined);
    assert.deepEqual(calls.map((c) => c.body.final), [false, false, true]);
    assert.equal(calls[0].body.total, 120);
    assert.equal(calls[0].nodeId, 'n1');
    assert.deepEqual(result().data, { channel: 'channel-imp1', title: 'question 0', resumable: true });
    const entry = pendingImport('w1', 'cc', 'channel-imp1', 'claude');
    assert.equal(entry.session_id, SID);
    assert.ok(entry.file.endsWith(`${SID}.jsonl`));
  });

  it('imports into another tool\'s agent as history only', async () => {
    claudeSession(2);
    const { daemon, node, result } = daemonWith({ name: 'cx', type: 'codex', network: 'w1', node_id: 'n1' });
    await daemon._runNodeCommand(node, { commandId: 'c2', action: 'import_local_session', args: { type: 'claude', id: SID, agent: 'cx' } });
    assert.equal(result().data.resumable, false);
    assert.equal(fs.existsSync(importsFile('w1', 'cx')), false);
  });

  it('stops at a thread the workspace already has for the session', async () => {
    claudeSession(60);
    const { daemon, calls, node, result } = daemonWith({ name: 'cc', type: 'claude', network: 'w1', node_id: 'n1' });
    daemon._nodeClients.get('n1').importSession = async (nodeId, token, body) => { calls.push({ body }); return { channel: 'channel-old', title: 't', existing: true }; };
    await daemon._runNodeCommand(node, { commandId: 'c9', action: 'import_local_session', args: { type: 'claude', id: SID, agent: 'cc' } });
    assert.equal(calls.length, 1);
    assert.equal(result().data.channel, 'channel-old');
    assert.equal(result().data.existing, true);
  });

  it('reports a session that is gone', async () => {
    const { daemon, node, result } = daemonWith(null);
    await daemon._runNodeCommand(node, { commandId: 'c3', action: 'import_local_session', args: { type: 'claude', id: SID } });
    assert.equal(result().ok, false);
    assert.match(result().message, /no longer on this device/);
  });

  it('does not create an empty thread if a selected session no longer has any messages', async () => {
    claudeSession(0);
    const { daemon, calls, node, result } = daemonWith(null);
    await daemon._runNodeCommand(node, { commandId: 'empty', action: 'import_local_session', args: { type: 'claude', id: SID } });
    assert.equal(result().ok, false);
    assert.match(result().message, /no messages to import/);
    assert.equal(calls.length, 0);
  });
});

describe('adapters continue an imported session', () => {
  it('Claude forks the imported session on the channel\'s first turn, once', () => {
    const file = claudeSession(1);
    recordImport('w1', 'cc', 'ch-imp', { type: 'claude', session_id: SID, file });
    const workDir = fs.mkdtempSync(path.join(tmp, 'wd-'));
    const a = new ClaudeAdapter({ workspaceId: 'w1', channelName: 'general', token: 'tok', agentName: 'cc', workingDir: workDir, agentEnv: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR } });
    a._saveSessions = () => {};
    a._findClaudeBinary = () => process.execPath;
    a._channelSessions = {};
    const built = a._buildClaudeCmd('hi', 'ch-imp');
    const i = built.cmd.indexOf('--resume');
    assert.deepEqual(built.cmd.slice(i, i + 3), ['--resume', SID, '--fork-session']);
    assert.ok(fs.existsSync(path.join(claudeProjectDir(process.env.CLAUDE_CONFIG_DIR, workDir), `${SID}.jsonl`)));
    claudeSession(2); // the person keeps chatting in the original after the fork
    assert.deepEqual(listLocalSessions('claude').map((s) => s.id), [SID]);
    assert.equal(readLocalSession('claude', SID).file, file);
    assert.equal(readLocalSession('claude', SID).messages.length, 4);
    // Another channel, and a second try of the same one, start fresh.
    assert.ok(!a._buildClaudeCmd('hi', 'ch-other').cmd.includes('--resume'));
    assert.ok(!a._buildClaudeCmd('hi', 'ch-imp').cmd.includes('--fork-session'));
    fs.unlinkSync(file);
    assert.deepEqual(listLocalSessions('claude'), []);
    assert.equal(readLocalSession('claude', SID), null);
  });

  it('prefers the original over an unmarked legacy snapshot when listing, reading and continuing', () => {
    const file = claudeSession(1);
    const configDir = process.env.CLAUDE_CONFIG_DIR;
    const legacyDir = claudeProjectDir(configDir, '/aaa');
    fs.mkdirSync(legacyDir, { recursive: true });
    const snapshot = path.join(legacyDir, path.basename(file));
    fs.copyFileSync(file, snapshot);
    claudeSession(2);
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(snapshot, later, later);
    assert.deepEqual(listLocalSessions('claude').map((s) => [s.id, s.messageCount]), [[SID, 4]]);
    assert.equal(readLocalSession('claude', SID).file, file);
    const original = fs.readFileSync(file);
    recordImport('w1', 'cc', 'old', { type: 'claude', session_id: SID, file: snapshot });
    const workingDir = path.join(tmp, 'agent');
    const a = new ClaudeAdapter({ workspaceId: 'w1', channelName: 'old', agentName: 'cc', workingDir });
    assert.deepEqual(a._importArgs('old'), ['--resume', SID, '--fork-session']);
    assert.deepEqual(fs.readFileSync(path.join(claudeProjectDir(configDir, workingDir), path.basename(file))), original);
    // A pre-fix import could also point back at the user's own project. A fork
    // there must not stage the stale snapshot on top of the personal transcript.
    a.workingDir = '/work/app';
    recordImport('w1', 'cc', 'same-project', { type: 'claude', session_id: SID, file: snapshot });
    assert.deepEqual(a._importArgs('same-project'), ['--resume', SID, '--fork-session']);
    assert.deepEqual(fs.readFileSync(file), original);
  });

  it('remembers both pre-upgrade Claude maps and later fork IDs after their channel is cleared', () => {
    const source = claudeSession(1);
    const previous = 'aaaa1111-2222-3333-4444-555555555555';
    const fork = 'bbbb1111-2222-3333-4444-555555555555';
    for (const id of [previous, fork]) fs.copyFileSync(source, path.join(path.dirname(source), id + '.jsonl'));
    const maps = path.join(tmp, '.openagents', 'sessions');
    fs.mkdirSync(maps, { recursive: true });
    fs.writeFileSync(path.join(maps, 'w1_cc.json'), JSON.stringify({ channel: previous }));
    assert.ok(!listLocalSessions('claude').some((s) => s.id === previous), 'reads the adapter map even with OPENAGENTS_HOME set');
    const agent = new ClaudeAdapter({ workspaceId: 'w1', channelName: 'channel', agentName: 'cc' });
    agent._channelSessions.channel = fork;
    agent._saveSessions();
    delete agent._channelSessions.channel;
    agent._saveSessions();
    assert.deepEqual(listLocalSessions('claude').map((s) => s.id), [SID]);
    assert.equal(readLocalSession('claude', fork), null);
    assert.equal(readLocalSession('claude', previous), null);
  });

  it('Codex resumes a copy under a new id, never the user\'s own rollout', () => {
    const day = path.join(tmp, 'mine', 'sessions', '2026', '11', '02');
    fs.mkdirSync(day, { recursive: true });
    const original = path.join(day, `rollout-2026-11-02T09-00-00-${CODEX_SID}.jsonl`);
    const body = `${JSON.stringify({ type: 'session_meta', payload: { id: CODEX_SID, cwd: '/work' } })}\n${JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } })}\n`;
    fs.writeFileSync(original, body);
    recordImport('w1', 'cx', 'ch-imp', { type: 'codex', session_id: CODEX_SID, file: original });
    const a = new CodexAdapter({ workspaceId: 'w1', channelName: 'general', token: 'tok', agentName: 'cx', agentEnv: { CODEX_HOME: process.env.CODEX_HOME } });
    a._saveSessions = () => {};
    a._channelThreads = {};
    a._adoptImportedThread('ch-imp');
    const newId = a._channelThreads['ch-imp'];
    assert.match(newId, /^[0-9a-f-]{36}$/);
    assert.notEqual(newId, CODEX_SID);
    const copies = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else copies.push(p); } })(path.join(process.env.CODEX_HOME, 'sessions'));
    assert.equal(copies.length, 1);
    assert.ok(copies[0].endsWith(`-${newId}.jsonl`));
    assert.ok(fs.readFileSync(copies[0], 'utf-8').includes(newId) && !fs.readFileSync(copies[0], 'utf-8').includes(CODEX_SID));
    assert.equal(fs.readFileSync(original, 'utf-8'), body, 'the original is untouched');
    // Once only: a dropped copy is not re-imported.
    delete a._channelThreads['ch-imp'];
    a._adoptImportedThread('ch-imp');
    assert.equal(a._channelThreads['ch-imp'], undefined);
  });

  it('OpenCode starts the channel from the imported session\'s transcript', { skip: process.platform === 'win32' }, () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'oc-'));
    const exportJson = { info: { id: 'ses_9' }, messages: [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'PELICAN-42' }] }] };
    fs.writeFileSync(path.join(dir, 'export.json'), JSON.stringify(exportJson));
    const bin = path.join(dir, 'opencode');
    fs.writeFileSync(bin, `#!/bin/sh\n[ "$1" = export ] && [ "$2" = ses_9 ] && cat "${path.join(dir, 'export.json')}"\n`, { mode: 0o755 });
    recordImport('w1', 'oc', 'ch-imp', { type: 'opencode', session_id: 'ses_9' });
    const a = new OpenCodeAdapter({ workspaceId: 'w1', channelName: 'general', token: 'tok', agentName: 'oc', agentEnv: { PATH: process.env.PATH } });
    a._opencodeBinary = bin;
    a._ensureWorkspaceSkill = () => {};
    a._buildSystemContext = () => 'CONTEXT';
    a._saveSessions = () => {};
    a._channelSessions = {};
    assert.match(a._composePrompt('hello', 'ch-imp', undefined), /<previous_conversation>[\s\S]*PELICAN-42/);
    assert.equal(a._composePrompt('fresh', 'ch-other', undefined), 'CONTEXT\n\n---\n\nfresh');
  });
});
