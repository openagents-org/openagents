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

  it('counts OpenCode messages in one query and skips workspace runs', () => {
    const calls = [];
    const run = (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'db') {
        return JSON.stringify([
          { id: 'ses_old', title: 'Refactor billing', directory: '/work/billing', updated: 1762000000000, message_count: 0 },
          { id: 'ses_new', title: 'Write the README', directory: '/work/docs', updated: 1763000000000, message_count: 2, first_prompt: 'Draft a README' },
          { id: 'ses_oa', title: 'Agent run', directory: path.join(env.OPENAGENTS_HOME, 'agents', 'oc'), updated: 1764000000000, message_count: 2 },
          { id: 'ses_workspace', title: 'Update the docs', directory: '/work/docs', updated: 1765000000000, message_count: 2,
            first_prompt: "You are agent 'docs' connected to an OpenAgents workspace." },
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
    assert.deepEqual(list.map((x) => x.id), ['ses_new']);
    assert.equal(list[0].cwd, '/work/docs');
    assert.equal(list[0].title, 'Draft a README');
    assert.equal(list[0].messageCount, 2);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^db --format json SELECT /);
    const s = readLocalSession('opencode', 'ses_new', { env, run });
    assert.deepEqual(s.messages.map((m) => [m.role, m.text]), [
      ['user', 'Draft a README'], ['tool', 'Used write'], ['assistant', 'Written.'],
    ]);
    assert.equal(s.title, 'Draft a README');
    assert.ok(calls.includes('export ses_new'));
    assert.equal(readLocalSession('opencode', 'bad id;rm', { env, run }), null);
    assert.throws(() => listLocalSessions('opencode', { env, run: () => '' }), /Could not read the OpenCode session database/);
    // No CLI: nothing to import, no error.
    assert.deepEqual(listLocalSessions('opencode', { env, run: () => null }), []);
  });

  it('uses the same titles, counts and workspace exclusions for OpenCode SQL and the read-only fallback', (t) => {
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); } catch { return t.skip('node:sqlite unavailable'); }
    const file = path.join(home, 'OpenCode review.db');
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE session (id TEXT, directory TEXT, parent_id TEXT, time_updated INTEGER);
      CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT, message_id TEXT, time_created INTEGER, data TEXT);`);
    const session = db.prepare('INSERT INTO session VALUES (?,?,?,?)');
    for (const [index, id] of ['empty', 'synthetic', 'mine', 'mapped', 'child', 'workspace', 'hi'].entries()) {
      session.run(id, '/projects/' + id, id === 'child' ? 'mine' : null, 1762000000000 + index);
    }
    const message = db.prepare('INSERT INTO message VALUES (?,?,?,?)');
    const part = db.prepare('INSERT INTO part VALUES (?,?,?,?)');
    let seq = 0;
    const add = (id, role, data) => {
      const key = String(++seq);
      message.run(key, id, seq, JSON.stringify({ role }));
      part.run(key, key, seq, JSON.stringify(data));
    };
    add('synthetic', 'user', { type: 'text', text: 'prefill', synthetic: true });
    add('mine', 'user', { type: 'text', text: '\t\u00a0\u3000' });
    add('mine', 'user', { type: 'text', text: '\u00a0'.repeat(2050) + 'Which file?' });
    add('mine', 'assistant', { type: 'text', text: '\u2028\ufeff' });
    add('mine', 'assistant', { type: 'reasoning', text: 'intermediate' });
    add('mine', 'assistant', { type: 'tool', tool: 'read' });
    add('mine', 'assistant', { type: 'text', text: 'README.md' });
    add('mapped', 'user', { type: 'text', text: 'A plain user prompt' });
    add('child', 'user', { type: 'text', text: 'child' });
    add('workspace', 'user', { type: 'text', text: "You are agent 'writer' connected to an OpenAgents workspace." });
    add('hi', 'user', { type: 'text', text: 'hi' });
    const agentDir = path.join(env.OPENAGENTS_HOME, 'agents', 'writer');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'sessions-0123456789abcdef.json'), JSON.stringify({ thread: 'mapped' }));
    try {
      const direct = listLocalSessions('opencode', { env, run: (args) => JSON.stringify(db.prepare(args[3]).all()) });
      assert.deepEqual(direct.map((s) => [s.id, s.title, s.messageCount]), [['hi', 'hi', 1], ['mine', 'Which file?', 2]]);
      const calls = [];
      const fallback = listLocalSessions('opencode', { env, run: (args) => {
        calls.push(args.slice(0, 2));
        return args[1] === 'path' ? file : '';
      } });
      assert.deepEqual(fallback, direct);
      assert.deepEqual(calls, [['db', '--format'], ['db', 'path']]);
      if (process.platform === 'win32') {
        // A custom .cmd without a native target can return its DB path, even
        // when its own path contains spaces and literal percent signs.
        const shim = path.join(home, 'OpenCode %TEMP% shim.cmd');
        fs.writeFileSync(shim, '@echo off\r\nif "%~1 %~2"=="db path" echo(%OA_TEST_DB%\r\n');
        t.mock.method(require('../src/adapters/opencode'), 'findOpencodeBinary', () => shim);
        assert.deepEqual(listLocalSessions('opencode', { env: { ...env, OA_TEST_DB: file } }), direct);
        // A wrapper that supports SQL should also work without a separate
        // sqlite3 command; the whole query must reach it as a single argument.
        const cli = path.join(home, 'test-opencode.cjs');
        fs.writeFileSync(cli, `const [cmd, flag, format, sql] = process.argv.slice(2);
if (cmd !== 'db' || flag !== '--format' || format !== 'json' || process.argv.length !== 6) process.exit(1);
const db = new (require('node:sqlite').DatabaseSync)(process.env.OA_TEST_DB, { readOnly: true });
console.log(JSON.stringify(db.prepare(sql).all()));
db.close();`);
        fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0test-opencode.cjs" %*\r\n`);
        assert.deepEqual(listLocalSessions('opencode', { env: { ...env, OA_TEST_DB: file } }), direct);
      }
    } finally { db.close(); }
  });

  it('pages past 2000 newer excluded roots, including roots with identical timestamps', (t) => {
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); } catch { return t.skip('node:sqlite unavailable'); }
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, parent_id TEXT, time_updated INTEGER);
        CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
        CREATE INDEX messages_by_session ON message(session_id);
        CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT);
        CREATE INDEX parts_by_message ON part(message_id);
        WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n < 2000)
        INSERT INTO session SELECT printf('agent_%04d', n), '/repo', NULL, 100 FROM seq;
        INSERT INTO session VALUES ('personal', '/repo', NULL, 100), ('older', '/repo', NULL, 99);
        INSERT INTO message SELECT id, id, 1, '{"role":"user"}' FROM session;
        INSERT INTO part SELECT id, id, 1, '{"type":"text","text":"A question"}' FROM session;`);
      const excludeIds = db.prepare("SELECT id FROM session WHERE id LIKE 'agent_%'").all().map(row => row.id);
      const run = args => JSON.stringify(db.prepare(args[3]).all());
      assert.deepEqual(listLocalSessions('opencode', { env, run, excludeIds }).map(s => s.id), ['personal', 'older']);
    } finally { db.close(); }
  });

  it('reports a CLI timeout without retrying the SQL and limits the read-only fallback to the remaining time', (t) => {
    const bin = path.join(home, 'opencode.exe');
    t.mock.method(require('../src/adapters/opencode'), 'findOpencodeBinary', () => bin);
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const timedOut = { status: null, error: { code: 'ETIMEDOUT' }, signal: 'SIGTERM' };
    const spawn = t.mock.method(require('child_process'), 'spawnSync', () => timedOut);
    assert.throws(() => listLocalSessions('opencode', { env }), /OpenCode sessions timed out/);
    assert.equal(spawn.mock.callCount(), 1);
    const db = path.join(home, 'fallback.db');
    spawn.mock.mockImplementation((command, args, opts) => {
      if (command !== bin) { assert.equal(opts.timeout, 9000); return timedOut; }
      if (args[1] === 'path') { now += 7000; return { status: 0, stdout: db }; }
      now += 19000;
      return { status: 1, stdout: '' };
    });
    assert.throws(() => listLocalSessions('opencode', { env }), /OpenCode sessions timed out/);
    assert.equal(spawn.mock.callCount(), 4);
  });

  it('reports a migrated OpenCode database without changing its tables', (t) => {
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); } catch { return t.skip('node:sqlite unavailable'); }
    const file = path.join(home, 'migrated.db');
    const db = new DatabaseSync(file);
    try {
      db.exec('CREATE TABLE session_v2 (id TEXT)');
      assert.throws(() => listLocalSessions('opencode', { env: { ...env, OPENCODE_DB: file }, run: () => '' }), /newer format.*1\.x/);
      assert.deepEqual(db.prepare('SELECT name FROM sqlite_master').all().map(row => row.name), ['session_v2']);
    } finally { db.close(); }
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


describe('local sessions: what is left out', () => {
  let home; let env;
  const ID = '22222222-2222-3333-4444-555555555555';
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-sessions2-'));
    env = { CLAUDE_CONFIG_DIR: path.join(home, 'claude'), OPENAGENTS_HOME: path.join(home, 'oa') };
    const proj = path.join(env.CLAUDE_CONFIG_DIR, 'projects', '-work-x');
    fs.mkdirSync(proj, { recursive: true });
    const base = { cwd: '/work/x', isSidechain: false };
    fs.writeFileSync(path.join(proj, `${ID}.jsonl`), [
      // A resumed file can open with an older session's records.
      { ...base, sessionId: 'older-session-id', type: 'user', message: { role: 'user', content: 'Deploy the site' } },
      { ...base, sessionId: ID, type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: written by the CLI' } },
      { ...base, sessionId: ID, type: 'user', message: { role: 'user', content: '<bash-input>cat .env</bash-input>' } },
      { ...base, sessionId: ID, type: 'user', message: { role: 'user', content: '<bash-stdout>PASSWORD=hunter2hunter2\nOTHER=1</bash-stdout><bash-stderr></bash-stderr>' } },
      { ...base, sessionId: ID, type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued…' } },
      { ...base, sessionId: ID, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Deployed.' }] } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('uses the file name as a Claude session\'s id', () => {
    assert.equal(listLocalSessions('claude', { env })[0].id, ID);
    assert.equal(readLocalSession('claude', ID, { env }).id, ID);
  });

  it('never imports what a !command printed, CLI notes or compaction summaries', () => {
    const all = readLocalSession('claude', ID, { env }).messages.map((m) => m.text).join('\n');
    assert.ok(!all.includes('hunter2') && !all.includes('cat .env') && !all.includes('Caveat') && !all.includes('being continued'));
    assert.deepEqual(readLocalSession('claude', ID, { env }).messages.map((m) => m.role), ['user', 'assistant']);
  });

  it('keeps personal sessions in a shared folder and skips recorded workspace runs and copies', () => {
    const agentSession = '22222222-3333-4444-5555-666666666666';
    const project = path.join(env.CLAUDE_CONFIG_DIR, 'projects', '-work-x');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, `${agentSession}.jsonl`), jsonl([
      { sessionId: agentSession, cwd: '/work/x', type: 'user', message: { role: 'user', content: 'Fix this bug' } },
    ]));
    const maps = path.join(env.OPENAGENTS_HOME, 'sessions');
    fs.mkdirSync(maps, { recursive: true });
    fs.writeFileSync(path.join(maps, 'workspace_agent.json'), JSON.stringify({ thread: agentSession }));

    assert.deepEqual(listLocalSessions('claude', { env }).map((session) => session.id), [ID]);
    assert.deepEqual(listLocalSessions('claude', { env, excludeIds: [ID] }), []);
  });
});

describe('local sessions: readiness checks', () => {
  let home; let env;
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-sessions3-'));
    env = { CLAUDE_CONFIG_DIR: path.join(home, 'claude'), OPENAGENTS_HOME: path.join(home, 'oa') };
    const proj = path.join(env.CLAUDE_CONFIG_DIR, 'projects', '-home-u');
    fs.mkdirSync(proj, { recursive: true });
    const write = (id, rows) => fs.writeFileSync(path.join(proj, `${id}.jsonl`), rows.map((r) => JSON.stringify({ cwd: '/home/u', sessionId: id, ...r })).join('\n') + '\n');
    write('33333333-0000-0000-0000-000000000001', [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi! How can I help?' }] } },
    ]);
    write('33333333-0000-0000-0000-000000000002', [
      { type: 'user', message: { role: 'user', content: 'OWNER-REVIEWED SHARED INSTRUCTIONS (this request…)' } },
    ]);
    write('33333333-0000-0000-0000-000000000003', [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] } },
      { type: 'user', message: { role: 'user', content: 'Refactor the auth module' } },
    ]);
  });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('leaves out the device\'s "hi" readiness checks and shared-thread runs, keeps a real chat that began with hi', () => {
    const ids = listLocalSessions('claude', { env }).map((s) => s.id);
    assert.deepEqual(ids, ['33333333-0000-0000-0000-000000000003']);
  });
});

describe('local sessions: newer Codex context blocks', () => {
  let home; let env;
  const write = (id, userTexts) => {
    const day = path.join(env.CODEX_HOME, 'sessions', '2026', '11', '20');
    fs.mkdirSync(day, { recursive: true });
    const rows = [{ type: 'session_meta', payload: { id, cwd: '/work/c' } }];
    for (const t of userTexts) rows.push({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: t }] } });
    rows.push({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] } });
    fs.writeFileSync(path.join(day, `rollout-2026-11-20T00-00-00-${id}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-sessions4-'));
    env = { CODEX_HOME: path.join(home, 'codex'), OPENAGENTS_HOME: path.join(home, 'oa') };
    write('01a0bf7a-61e9-7172-a4aa-d4025c84ef24', ['<recommended_plugins>\nHere is a list of plugins\n</recommended_plugins>\n<environment_context>\n<cwd>/work/c</cwd>\n</environment_context>', 'Write a migration for users']);
    write('01a0bf7a-61e9-7172-a4aa-d4025c84ef25', ['The following is the Codex agent history whose request action you are assessing. …']);
    write('01a0bf7a-61e9-7172-a4aa-d4025c84ef26', ['<some_new_context>\nx\n</some_new_context>', 'Add tests']);
  });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('titles a session by what the person typed, and leaves out Codex\'s own reviewer runs', () => {
    const list = listLocalSessions('codex', { env });
    assert.deepEqual(list.map((s) => s.title).sort(), ['Add tests', 'Write a migration for users']);
  });
});
