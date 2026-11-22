'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listLocalSessions, readLocalSession, maskSecrets } = require('../src/local-sessions');

const CLAUDE_ID = '11111111-2222-3333-4444-555555555555';
const OA_CLAUDE_ID = '99999999-2222-3333-4444-555555555555';
const CODEX_ID = '01a11d54-e2e8-7aa3-9fb3-579101b2b98e';

function jsonl(rows) { return rows.map((r) => JSON.stringify(r)).join('\n') + '\n'; }

describe('local sessions', () => {
  let home; let env;
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-sessions-'));
    env = { CLAUDE_CONFIG_DIR: path.join(home, 'claude'), CODEX_HOME: path.join(home, 'codex'), OPENAGENTS_HOME: path.join(home, 'oa') };
    const proj = path.join(env.CLAUDE_CONFIG_DIR, 'projects', '-work-app');
    fs.mkdirSync(proj, { recursive: true });
    const base = { sessionId: CLAUDE_ID, cwd: '/work/app', isSidechain: false };
    fs.writeFileSync(path.join(proj, `${CLAUDE_ID}.jsonl`), jsonl([
      { type: 'queue-operation', operation: 'enqueue', sessionId: CLAUDE_ID },
      { ...base, type: 'user', timestamp: '2026-11-01T10:00:00Z', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
      { ...base, type: 'user', timestamp: '2026-11-01T10:00:01Z', message: { role: 'user', content: 'Fix the login bug, my key is sk-ant-abcdefghijklmnop123456' } },
      { ...base, type: 'assistant', timestamp: '2026-11-01T10:00:05Z', message: { role: 'assistant', content: [
        { type: 'thinking', thinking: 'hidden reasoning' },
        { type: 'text', text: 'Looking at auth.py.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      ] } },
      { ...base, type: 'user', timestamp: '2026-11-01T10:00:09Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'SECRET FILE CONTENTS' }] } },
      { ...base, isSidechain: true, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'sub-agent chatter' }] } },
      { ...base, type: 'assistant', timestamp: '2026-11-01T10:01:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed: the session cookie expired early.' }] } },
    ]));
    // A session an OpenAgents agent ran in its own folder: not the person's.
    const oaProj = path.join(env.CLAUDE_CONFIG_DIR, 'projects', '-oa-agents-bot');
    fs.mkdirSync(oaProj, { recursive: true });
    fs.writeFileSync(path.join(oaProj, `${OA_CLAUDE_ID}.jsonl`), jsonl([
      { sessionId: OA_CLAUDE_ID, cwd: path.join(env.OPENAGENTS_HOME, 'agents', 'bot'), type: 'user', message: { role: 'user', content: 'hello' } },
    ]));
    const day = path.join(env.CODEX_HOME, 'sessions', '2026', '11', '02');
    fs.mkdirSync(day, { recursive: true });
    fs.writeFileSync(path.join(day, `rollout-2026-11-02T09-00-00-${CODEX_ID}.jsonl`), jsonl([
      { type: 'session_meta', payload: { id: CODEX_ID, cwd: '/work/api', timestamp: '2026-11-02T09:00:00Z' } },
      { type: 'response_item', timestamp: '2026-11-02T09:00:00Z', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'system stuff' }] } },
      { type: 'response_item', timestamp: '2026-11-02T09:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
      { type: 'response_item', timestamp: '2026-11-02T09:00:01Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Add pagination to /users' }] } },
      { type: 'response_item', timestamp: '2026-11-02T09:00:03Z', payload: { type: 'reasoning', summary: [] } },
      { type: 'response_item', timestamp: '2026-11-02T09:00:04Z', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'pytest -q'] }) } },
      { type: 'response_item', timestamp: '2026-11-02T09:00:06Z', payload: { type: 'function_call_output', output: 'LOTS OF OUTPUT' } },
      { type: 'response_item', timestamp: '2026-11-02T09:00:09Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done, added limit and offset.' }] } },
    ]));
  });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('lists the person\'s own Claude Code sessions with a masked title', () => {
    const list = listLocalSessions('claude', { env });
    assert.equal(list.length, 1, 'the OpenAgents-run session is left out');
    const [s] = list;
    assert.equal(s.id, CLAUDE_ID);
    assert.equal(s.cwd, '/work/app');
    assert.match(s.title, /^Fix the login bug/);
    assert.ok(!s.title.includes('abcdefghijklmnop123456'), 'secrets are masked in titles');
    assert.equal(s.messageCount, 3);
  });

  it('reads a Claude Code session as conversation plus tool notes, never tool output', () => {
    const s = readLocalSession('claude', CLAUDE_ID, { env });
    assert.deepEqual(s.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant']);
    assert.equal(s.messages[2].text, 'Ran: npm test');
    const all = s.messages.map((m) => m.text).join('\n');
    assert.ok(!all.includes('SECRET FILE CONTENTS') && !all.includes('hidden reasoning') && !all.includes('sub-agent'));
    assert.ok(!all.includes('<command-name>'));
    assert.ok(!all.includes('abcdefghijklmnop123456'));
    assert.equal(s.messages[0].at, '2026-11-01T10:00:01Z');
  });

  it('lists and reads Codex sessions, skipping injected context', () => {
    const [s] = listLocalSessions('codex', { env });
    assert.equal(s.id, CODEX_ID);
    assert.equal(s.title, 'Add pagination to /users');
    assert.equal(s.cwd, '/work/api');
    assert.equal(s.messageCount, 2);
    const full = readLocalSession('codex', CODEX_ID, { env });
    assert.deepEqual(full.messages.map((m) => [m.role, m.text]), [
      ['user', 'Add pagination to /users'],
      ['tool', 'Ran: bash -lc pytest -q'],
      ['assistant', 'Done, added limit and offset.'],
    ]);
  });

  it('keeps the most recent part of a long session', () => {
    const s = readLocalSession('claude', CLAUDE_ID, { env, maxMessages: 2 });
    assert.equal(s.truncated, true);
    assert.deepEqual(s.messages.map((m) => m.role), ['tool', 'assistant']);
  });

  it('refuses unknown types and odd ids, and finds nothing for a missing session', () => {
    assert.throws(() => listLocalSessions('aider', { env }), /not supported/);
    assert.equal(readLocalSession('claude', '../../etc/passwd', { env }), null);
    assert.equal(readLocalSession('codex', '00000000-0000-0000-0000-000000000000', { env }), null);
  });

  it('masks private keys and tokens', () => {
    const out = maskSecrets('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY----- and ghp_abcdefghijklmnopqrstuvwxyz0123');
    assert.ok(!out.includes('abc\n') && !out.includes('ghp_abcdefghijklmnopqrstuvwxyz0123'));
  });
});
