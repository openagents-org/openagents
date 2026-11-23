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

  it('lists and reads OpenCode sessions through its CLI, leaving out agent folders', () => {
    const calls = [];
    const run = (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'session') {
        return JSON.stringify([
          { id: 'ses_old', title: 'Refactor billing', directory: '/work/billing', time: { updated: 1762000000000 } },
          { id: 'ses_new', title: 'Write the README', directory: '/work/docs', time: { updated: 1763000000000 } },
          { id: 'ses_oa', title: 'Agent run', directory: path.join(env.OPENAGENTS_HOME, 'agents', 'oc'), time: { updated: 1764000000000 } },
        ]);
      }
      return 'some log line\n' + JSON.stringify({
        info: { id: 'ses_new', title: 'Write the README', directory: '/work/docs' },
        messages: [
          { info: { role: 'user', time: { created: 1763000000000 } }, parts: [{ type: 'text', text: 'Draft a README' }, { type: 'text', text: 'injected', synthetic: true }] },
          { info: { role: 'assistant', time: { created: 1763000005000 } }, parts: [
            { type: 'reasoning', text: 'thinking' },
            { type: 'tool', tool: 'write', state: { input: { filePath: 'README.md' }, output: 'FILE BODY' } },
            { type: 'text', text: 'Written.' },
          ] },
        ],
      });
    };
    const list = listLocalSessions('opencode', { env, run });
    assert.deepEqual(list.map((x) => x.id), ['ses_new', 'ses_old']);
    assert.equal(list[0].cwd, '/work/docs');
    assert.equal(list[0].messageCount, null);
    const s = readLocalSession('opencode', 'ses_new', { env, run });
    assert.deepEqual(s.messages.map((m) => [m.role, m.text]), [
      ['user', 'Draft a README'], ['tool', 'Used write'], ['assistant', 'Written.'],
    ]);
    assert.equal(s.title, 'Write the README');
    assert.ok(calls.includes('export ses_new'));
    assert.equal(readLocalSession('opencode', 'bad id;rm', { env, run }), null);
    // No CLI: nothing to import, no error.
    assert.deepEqual(listLocalSessions('opencode', { env, run: () => null }), []);
  });

  it('lists and reads Hermes sessions from its SQLite store, skipping the workspace\'s own runs', (t) => {
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); } catch { t.skip('node:sqlite unavailable'); return; }
    const hermesHome = path.join(home, 'hermes');
    fs.mkdirSync(path.join(hermesHome, 'profiles', 'work'), { recursive: true });
    const make = (file, rows) => {
      const db = new DatabaseSync(file);
      db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT, cwd TEXT, started_at REAL NOT NULL, message_count INTEGER DEFAULT 0);
        CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,
          tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);`);
      for (const r of rows.sessions) db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)').run(...r);
      for (const r of rows.messages) db.prepare('INSERT INTO messages (session_id, role, content, tool_calls, tool_name, timestamp, active) VALUES (?,?,?,?,?,?,?)').run(...r);
      db.close();
    };
    make(path.join(hermesHome, 'state.db'), {
      sessions: [['20261101_cli1', 'cli', null, '/work/research', 1762000000, 3], ['20261102_tool', 'tool', 'ws run', '/x', 1762100000, 2]],
      messages: [
        ['20261101_cli1', 'system', 'SYSTEM PROMPT', null, null, 1762000000, 1],
        ['20261101_cli1', 'user', 'Summarise the paper', null, null, 1762000001, 1],
        ['20261101_cli1', 'assistant', '', JSON.stringify([{ function: { name: 'terminal', arguments: JSON.stringify({ command: 'pdftotext paper.pdf' }) } }]), null, 1762000002, 1],
        ['20261101_cli1', 'tool', 'TOOL OUTPUT', null, 'terminal', 1762000003, 1],
        ['20261101_cli1', 'assistant', 'It argues X.', null, null, 1762000004, 1],
        ['20261101_cli1', 'user', 'compacted away', null, null, 1762000005, 0],
        ['20261102_tool', 'user', 'from the workspace', null, null, 1762100001, 1],
      ],
    });
    make(path.join(hermesHome, 'profiles', 'work', 'state.db'), {
      sessions: [['20261105_prof', 'telegram', 'Trip plan', '/home/u', 1762300000, 1]],
      messages: [['20261105_prof', 'user', 'Plan a trip', null, null, 1762300001, 1]],
    });
    const henv = { ...env, HERMES_HOME: hermesHome };
    const list = listLocalSessions('hermes', { env: henv });
    assert.deepEqual(list.map((x) => x.id), ['20261105_prof', '20261101_cli1']);
    assert.equal(list[1].title, 'Summarise the paper');
    assert.equal(list[0].title, 'Trip plan');
    const s = readLocalSession('hermes', '20261101_cli1', { env: henv });
    assert.deepEqual(s.messages.map((m) => [m.role, m.text]), [
      ['user', 'Summarise the paper'], ['tool', 'Ran: pdftotext paper.pdf'], ['assistant', 'It argues X.'],
    ]);
    assert.equal(s.messages[0].at, new Date(1762000001 * 1000).toISOString());
    assert.equal(readLocalSession('hermes', "x' OR '1'='1", { env: henv }), null);
    assert.deepEqual(listLocalSessions('hermes', { env: { ...env, HERMES_HOME: path.join(home, 'none') } }), []);
  });
});

