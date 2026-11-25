'use strict';

/**
 * The user's own past sessions in local coding-agent CLIs, read so they can
 * be imported into a workspace (each picked session becomes a thread).
 *
 *   Claude Code  <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<cwd-slug>/<id>.jsonl
 *   Codex        <CODEX_HOME or ~/.codex>/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl
 *   OpenCode     through its CLI: `opencode db`, `opencode export <id>`
 *   Hermes       <HERMES_HOME or ~/.hermes>/state.db (and profiles/<p>/state.db),
 *                SQLite: sessions + messages tables
 *
 * Each type is one reader ({list, read}) in READERS below; adding a tool is
 * adding a reader.
 *
 * listLocalSessions(type) is cheap enough to show a picker: id, title (the
 * first real prompt), working folder, last activity and message count.
 * readLocalSession(type, id) turns one session into a plain conversation:
 * what the person asked, what the agent answered, and a one-line note per
 * tool call ("Ran: npm test") — never tool output or file contents. Secrets
 * are masked in everything returned (the same rules adapters use). Files are only ever read.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { redactSecrets } = require('./adapters/utils');
const { claudeTranscripts, findClaudeTranscript } = require('./host-agent');
const { openAgentsHomes, workspaceSessionIds } = require('./session-origins');

const TYPES = ['claude', 'codex', 'opencode', 'hermes'];
const MAX_TEXT = 8000;          // per message, after masking
const TITLE_LEN = 120;
const DEFAULT_LIMIT = 200;      // sessions listed, newest first

// ── secrets ────────────────────────────────────────────────────────────────

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

/** Text with credentials masked: the same rules as everything adapters post
 *  (adapters/utils.js redactSecrets), plus whole private-key blocks. */
function maskSecrets(text) {
  return redactSecrets(String(text || '').replace(PRIVATE_KEY, '[REDACTED_PRIVATE_KEY]'), []);
}

function clip(text, n = MAX_TEXT) {
  const s = String(text || '').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function oneLine(text, n = TITLE_LEN) {
  return clip(String(text || '').replace(/\s+/g, ' '), n);
}

// ── locations ──────────────────────────────────────────────────────────────

function claudeHome(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function codexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function walk(dir, match, out = [], depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) walk(p, match, out, depth + 1);
    else if (e.isFile() && match(e.name)) out.push(p);
  }
  return out;
}

function sessionFiles(type, env) {
  if (type === 'claude') return claudeTranscripts(claudeHome(env));
  if (type === 'codex') return walk(path.join(codexHome(env), 'sessions'), (n) => /^rollout-.*\.jsonl$/.test(n));
  return [];
}

function readLines(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a partial last line while the CLI writes */ }
  }
  return out;
}

// ── Claude Code ────────────────────────────────────────────────────────────

// Text the CLI injects into the user's turn that the person didn't type.
const CLAUDE_INJECTED = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|system-reminder|user-memory-input|bash-input|bash-stdout|bash-stderr)\b/;
// Whole blocks of it, including what a `!command` printed: never imported.
const CLAUDE_INJECTED_BLOCK = /<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|system-reminder|user-memory-input|bash-input|bash-stdout|bash-stderr)\b[^>]*>[\s\S]*?<\/\1>/g;

function claudeText(content, { forTitle = false } = {}) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .filter((t) => !(forTitle && CLAUDE_INJECTED.test(t)))
    .join('\n');
}

function toolNote(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  const target = i.command || i.cmd || i.file_path || i.path || i.pattern || i.url || i.query || i.description || '';
  const verb = /^(bash|shell|exec|local_shell|terminal|run_command|execute_command)$/i.test(name) ? 'Ran' : `Used ${name}`;
  return oneLine(target ? `${verb}: ${Array.isArray(target) ? target.join(' ') : target}` : verb, 200);
}

function parseClaude(lines) {
  const messages = [];
  let cwd = null;
  let id = null;
  for (const o of lines) {
    if (!o || typeof o !== 'object') continue;
    if (o.sessionId && !id) id = o.sessionId;
    if (o.cwd && !cwd) cwd = o.cwd;
    if (o.isSidechain) continue; // sub-agent chatter
    if (o.isMeta || o.isCompactSummary) continue; // CLI-written, not the person's
    const m = o.message;
    if (!m || (o.type !== 'user' && o.type !== 'assistant')) continue;
    const at = o.timestamp || null;
    if (o.type === 'user') {
      if (Array.isArray(m.content) && m.content.every((b) => b && b.type === 'tool_result')) continue;
      const text = claudeText(m.content).replace(CLAUDE_INJECTED_BLOCK, '').split('\n').filter((l) => !CLAUDE_INJECTED.test(l)).join('\n');
      if (text.trim() && !CLAUDE_INJECTED.test(text)) messages.push({ role: 'user', text, at });
    } else {
      const text = claudeText(m.content);
      if (text.trim()) messages.push({ role: 'assistant', text, at });
      if (Array.isArray(m.content)) {
        for (const b of m.content) if (b && b.type === 'tool_use') messages.push({ role: 'tool', text: toolNote(b.name || 'tool', b.input), at });
      }
    }
  }
  return { id, cwd, messages };
}

// ── Codex ──────────────────────────────────────────────────────────────────

// Codex puts AGENTS.md and environment details in user-role messages.
const CODEX_INJECTED = /^\s*<(environment_context|user_instructions|permissions|turn_aborted|recommended_plugins|user_shell_command)\b|^\s*# AGENTS\.md instructions|^\s*The following is the Codex agent history\b/;
// A user-role message that is nothing but <snake_case>…</snake_case> blocks
// is context the CLI added (newer versions add new kinds), not typing.
const ONLY_TAG_BLOCKS = /^(?:\s*<([a-z][a-z0-9_]*)\b[^>]*>[\s\S]*?<\/\1>\s*)+$/;

function codexText(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content
    .filter((c) => c && (c.type === 'input_text' || c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

function parseCodex(lines) {
  const messages = [];
  let cwd = null;
  let id = null;
  for (const o of lines) {
    if (!o || typeof o !== 'object') continue;
    const p = o.payload && typeof o.payload === 'object' ? o.payload : {};
    if (o.type === 'session_meta') { id = id || p.id || p.session_id || null; cwd = cwd || p.cwd || null; continue; }
    if (o.type === 'turn_context' && !cwd && p.cwd) cwd = p.cwd;
    if (o.type !== 'response_item') continue;
    const at = o.timestamp || null;
    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const text = codexText(p.content);
      if (!text.trim() || (p.role === 'user' && (CODEX_INJECTED.test(text) || ONLY_TAG_BLOCKS.test(text)))) continue;
      messages.push({ role: p.role, text, at });
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      let input = p.arguments || p.input || p.action || {};
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = { command: input }; } }
      messages.push({ role: 'tool', text: toolNote(p.name || 'shell', input), at });
    }
  }
  return { id, cwd, messages };
}

// ── public ─────────────────────────────────────────────────────────────────

function parse(type, lines) {
  return type === 'claude' ? parseClaude(lines) : parseCodex(lines);
}

function idFromFile(type, file) {
  const base = path.basename(file, '.jsonl');
  if (type === 'claude') return base;
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1] : base;
}

// Sessions an OpenAgents agent ran (a workspace thread), not the person's
// own: they carry the workspace briefing or run in the launcher's data directory.
const OPENAGENTS_RUN = /connected to an OpenAgents workspace|^You previously worked in this channel|^You are agent '[^']+'|^OWNER-REVIEWED SHARED INSTRUCTIONS/;

// The readiness check the device runs on an agent (src/probe.js sends "hi"
// and nothing else). Each one leaves a session behind; on a device that has
// run for a while they outnumber the person's own many times over.
const PROBE_PROMPT = 'hi';
function isProbe(s) {
  if (s.type !== 'claude' && s.type !== 'codex') return false;
  if (s.title.trim().toLowerCase() !== PROBE_PROMPT) return false;
  // Exactly: "hi" was all the person (the check) typed. Without that detail,
  // a short session that opened with "hi".
  return s.typedTurns != null ? s.typedTurns <= 1 : (s.messageCount == null || s.messageCount <= 2);
}

function ranByOpenAgents(firstPrompt, cwd, env) {
  if (OPENAGENTS_RUN.test(firstPrompt || '')) return true;
  return !!cwd && openAgentsHomes(env).some((home) => {
    const relative = path.relative(home, cwd);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  });
}

// How many of a file's lines a listing parses: enough for the first prompt.
const HEAD_LINES = 400;

/** What a picker shows, without parsing a long session in full: the first
 *  prompt and folder from the opening lines, and messages counted by shape. */
function summarize(type, file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const lines = raw.split('\n');
  const head = [];
  for (const line of lines.slice(0, HEAD_LINES)) {
    if (!line.trim()) continue;
    try { head.push(JSON.parse(line)); } catch { /* partial */ }
  }
  const s = parse(type, head);
  let count = 0;
  for (const line of lines) {
    if (type === 'claude') {
      if (line.includes('"isSidechain":true')) continue;
      if ((line.includes('"type":"user"') && !line.includes('"tool_result"') && !line.includes('<command-'))
          || (line.includes('"type":"assistant"') && line.includes('"type":"text"'))) count += 1;
    } else if (line.includes('"type":"response_item"') && line.includes('"type":"message"')
               && (line.includes('"role":"assistant"') || (line.includes('"role":"user"') && !line.includes('<environment_context>')))) {
      count += 1;
    }
  }
  return { ...s, count };
}

function listFileSessions(type, { env, limit, skip }) {
  const files = sessionFiles(type, env)
    .filter((file) => !skip.has(idFromFile(type, file)))
    .map((file) => { try { return { file, mtime: fs.statSync(file).mtimeMs }; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const { file, mtime } of files) {
    if (out.length >= limit) break;
    const s = summarize(type, file);
    const first = s && s.messages.find((m) => m.role === 'user');
    if (!first) continue; // nothing the person said: an empty or aborted session
    if (ranByOpenAgents(first.text, s.cwd, env)) continue;
    out.push({
      // Claude Code: the file's name is the session (a resumed file can open
      // with an older session's records).
      id: type === 'claude' ? idFromFile(type, file) : (s.id || idFromFile(type, file)),
      type,
      title: oneLine(maskSecrets(first.text)),
      cwd: s.cwd,
      updatedAt: new Date(mtime).toISOString(),
      messageCount: s.count,
      // How many times the person typed, in the opening lines read: lets a
      // readiness check ("hi" alone) be told from a chat that began with hi.
      typedTurns: s.messages.filter((m) => m.role === 'user').length,
    });
  }
  return out;
}

function findSessionFile(type, id, env) {
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(String(id || ''))) return null;
  if (type === 'claude') return findClaudeTranscript(id, claudeHome(env));
  return sessionFiles(type, env).find((f) => idFromFile(type, f) === id) || null;
}

function readFileSession(type, id, { env }) {
  const file = findSessionFile(type, id, env);
  if (!file) return null;
  const s = parse(type, readLines(file));
  return { id: type === 'claude' ? id : (s.id || id), cwd: s.cwd, file, messages: s.messages };
}

// ── OpenCode ───────────────────────────────────────────────────────────────

const OPENCODE_TIMEOUT = 'Reading OpenCode sessions timed out. Try again after other OpenCode activity has finished.';
const OPENCODE_MIGRATED = 'This OpenCode session database uses a newer format. Session import currently reads the OpenCode 1.x format.';

function remainingTime(deadline, cap) {
  const remaining = Math.min(cap, deadline - Date.now());
  if (remaining <= 0) throw new Error(OPENCODE_TIMEOUT);
  return remaining;
}

function checkOpenCodeExit(result) {
  if (result.error?.code === 'ETIMEDOUT') throw new Error(OPENCODE_TIMEOUT);
  if (result.signal) throw new Error('Reading OpenCode sessions was interrupted.');
}

function runOpencode(args, env, deadline = Infinity) {
  const { findOpencodeBinary, SHARED_DB_MIGRATED_RE } = require('./adapters/opencode');
  let bin = findOpencodeBinary();
  if (!bin) return null; // not installed: nothing to import
  if (process.platform === 'win32' && /\.cmd$/i.test(bin)) {
    const { cmdShimTargets } = require('./postinstall-stub');
    bin = cmdShimTargets(bin).find((file) => path.basename(file).toLowerCase() === 'opencode.exe' && fs.existsSync(file)) || bin;
  }
  const cmdShim = process.platform === 'win32' && /\.cmd$/i.test(bin);
  // A custom batch wrapper may expand a percent expression or reparse a
  // literal quote. Use the read-only database fallback for such arguments.
  if (cmdShim && args.some((arg) => /["%\r\n!]/.test(arg))) return '';
  const command = cmdShim ? (process.env.ComSpec || 'cmd.exe') : bin;
  const childEnv = { ...process.env, ...env };
  let commandArgs = args;
  if (cmdShim) {
    childEnv.OA_SESSION_IMPORT_CLI = bin;
    const quotedArgs = args.map((arg) => `"${arg}"`).join(' ');
    commandArgs = ['/d', '/v:off', '/s', '/c', `""%OA_SESSION_IMPORT_CLI%" ${quotedArgs}"`];
  }
  const cap = args[0] === 'export' ? 30000 : args[1] === 'path' ? 8000 : 20000;
  const r = childProcess.spawnSync(command, commandArgs, {
    env: childEnv, encoding: 'utf-8', timeout: remainingTime(deadline, cap), killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024, windowsHide: true, windowsVerbatimArguments: cmdShim,
  });
  checkOpenCodeExit(r);
  if (r.status !== 0 && (SHARED_DB_MIGRATED_RE.test(r.stderr) || SHARED_DB_MIGRATED_RE.test(r.stdout))) {
    throw new Error('OpenCode could not find the 1.x session table. This can happen after OpenCode 2.x or the desktop app migrates the database.');
  }
  if (r.status !== 0 || !r.stdout) return '';
  return r.stdout;
}

function jsonFrom(text) {
  if (!text) return null;
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  try { return JSON.parse(text.slice(start)); } catch { return null; }
}

const msIso = (v) => (Number(v) > 0 ? new Date(Number(v) > 1e12 ? Number(v) : Number(v) * 1000).toISOString() : null);

function opencodePageSql(pageSize, cursor) {
  // SQLite's default trim only removes ASCII spaces. Match JS String.trim()
  // for both the first real prompt and the number of importable text parts.
  const spaces = 'char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)';
  const text = `trim(json_extract(p.data, '$.text'), ${spaces})`;
  const textParts = `FROM message m JOIN part p ON p.message_id = m.id
    WHERE m.session_id = s.id AND json_extract(p.data, '$.type') = 'text'
      AND COALESCE(json_extract(p.data, '$.synthetic'), 0) = 0 AND json_type(p.data, '$.text') = 'text'
      AND ${text} <> ''`;
  // Hex keeps an ID in a single SQLite literal, also through a Windows .cmd shim.
  const after = cursor ? `AND (time_updated < ${cursor.updated} OR
    (time_updated = ${cursor.updated} AND id > CAST(X'${Buffer.from(cursor.id).toString('hex')}' AS TEXT)))` : '';
  return `SELECT s.id, s.directory, s.time_updated AS updated,
      (SELECT COUNT(*) ${textParts} AND json_extract(m.data, '$.role') IN ('user', 'assistant')) AS message_count,
      (SELECT substr(${text}, 1, 2048)
        ${textParts} AND json_extract(m.data, '$.role') = 'user'
        ORDER BY m.time_created, m.id, p.time_created, p.id LIMIT 1) AS first_prompt
    FROM (SELECT id, directory, time_updated FROM session WHERE parent_id IS NULL ${after}
      ORDER BY time_updated DESC, id LIMIT ${pageSize}) s
    ORDER BY s.time_updated DESC, s.id`.replace(/\s+/g, ' ');
}

function listOpencode({ env, limit, run, skip }) {
  const deadline = Date.now() + 35000; // leave room for the device command's 40s deadline
  let pageSize = Math.max(200, limit);
  const sessions = [];
  let cursor, database;
  do {
    const sql = opencodePageSql(pageSize, cursor);
    let rows;
    if (!database) {
      const output = run(['db', '--format', 'json', sql], env, deadline);
      if (output === null) return []; // no CLI installed
      rows = jsonFrom(output);
    }
    if (!Array.isArray(rows)) {
      database ||= path.isAbsolute(env.OPENCODE_DB || '') ? env.OPENCODE_DB : (run(['db', 'path'], env, deadline) || '').trim();
      rows = path.isAbsolute(database) ? querySqlite(database, sql, deadline) : null;
      if (!rows) {
        const migrated = "SELECT name FROM sqlite_master WHERE type='table' AND name='session_v2' AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='session')";
        if (path.isAbsolute(database) && querySqlite(database, migrated, deadline)?.length) {
          throw new Error(OPENCODE_MIGRATED);
        }
        throw new Error('Could not read the OpenCode session database. Check the database path and read access.');
      }
    }
    for (const row of rows) {
      if (!row.id || skip.has(row.id) || !row.first_prompt?.trim() || ranByOpenAgents(row.first_prompt, row.directory, env)) continue;
      sessions.push({
        id: row.id, type: 'opencode', title: oneLine(maskSecrets(row.first_prompt)), cwd: row.directory || null,
        updatedAt: msIso(row.updated), messageCount: row.message_count,
      });
      skip.add(row.id);
      if (sessions.length === limit) return sessions;
    }
    if (rows.length < pageSize) break;
    const last = rows[rows.length - 1];
    if (!Number.isSafeInteger(last.updated) || typeof last.id !== 'string') throw new Error('Invalid OpenCode session cursor');
    cursor = last;
    // A long run of exclusions should not start a new CLI for every 200 rows.
    pageSize = Math.min(1000, pageSize * 2);
    remainingTime(deadline, Infinity);
  } while (true);
  return sessions;
}

function readOpencode(id, { env, run }) {
  // Never something the CLI would take for an option.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{3,79}$/.test(String(id || ''))) return null;
  const exported = jsonFrom(run(['export', id], env));
  if (!exported || !Array.isArray(exported.messages)) return null;
  const messages = [];
  for (const msg of exported.messages) {
    const info = (msg && msg.info) || {};
    const role = info.role === 'assistant' ? 'assistant' : info.role === 'user' ? 'user' : null;
    if (!role) continue;
    const at = msIso(info.time && info.time.created);
    for (const part of (msg.parts || [])) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim() && !part.synthetic) messages.push({ role, text: part.text, at });
      else if (part.type === 'tool' && part.tool) messages.push({ role: 'tool', text: toolNote(part.tool, part.state && part.state.input), at });
    }
  }
  const info = exported.info || {};
  return { id: info.id || id, cwd: info.directory || null, messages };
}

// ── Hermes ─────────────────────────────────────────────────────────────────

function hermesDbs(env) {
  const home = String(env.HERMES_HOME || '').trim() || path.join(os.homedir(), '.hermes');
  const dbs = [path.join(home, 'state.db')];
  try {
    for (const d of fs.readdirSync(path.join(home, 'profiles'), { withFileTypes: true })) {
      if (d.isDirectory()) dbs.push(path.join(home, 'profiles', d.name, 'state.db'));
    }
  } catch { /* no profiles */ }
  return dbs.filter((f) => fs.existsSync(f));
}

/** Rows of a read-only query: node's built-in SQLite (Node 22.5+), else the
 *  sqlite3 CLI, else nothing. `sql` takes no user text but a checked id. */
function querySqlite(file, sql, deadline) {
  let native;
  try {
    native = require('./sqlite-readonly');
  } catch { /* older Node versions use the sqlite3 executable */ }
  if (native && deadline === undefined) {
    try { return native(file, sql); } catch { return null; }
  }
  // A worker-thread timeout cannot interrupt a synchronous SQLite call in C.
  const r = childProcess.spawnSync(native ? process.execPath : 'sqlite3',
    native ? [require.resolve('./sqlite-readonly'), file] : ['-readonly', '-json', file, sql], {
      encoding: 'utf-8', input: native ? sql : undefined, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: remainingTime(deadline ?? Infinity, 20000), killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    });
  if (deadline !== undefined) checkOpenCodeExit(r);
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout || '[]'); } catch { return null; }
}

// The workspace's own Hermes runs are started with `--source tool`
// (adapters/hermes.js); the person's own sessions come from the CLI or apps.
const HERMES_LIST_SQL = `
  SELECT s.id, s.title, s.cwd, s.source, s.message_count AS count,
    COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), s.started_at) AS updated,
    (SELECT m.content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id LIMIT 1) AS first
  FROM sessions s
  WHERE s.source <> 'tool'
  ORDER BY updated DESC
  LIMIT 1000`;

function listHermes({ env, limit }) {
  const rows = [];
  for (const db of hermesDbs(env)) rows.push(...(querySqlite(db, HERMES_LIST_SQL) || []));
  return rows
    .filter((r) => r && r.id && (r.first || r.title) && !ranByOpenAgents(r.first, r.cwd, env))
    .sort((a, b) => Number(b.updated) - Number(a.updated))
    .slice(0, limit)
    .map((r) => ({
      id: r.id, type: 'hermes', title: oneLine(maskSecrets(r.title || r.first)), cwd: r.cwd || null,
      updatedAt: msIso(r.updated), messageCount: r.count == null ? null : Number(r.count),
    }));
}

function readHermes(id, { env }) {
  if (!/^[A-Za-z0-9_.:-]{4,120}$/.test(String(id || ''))) return null;
  const q = String(id).replace(/'/g, "''");
  for (const db of hermesDbs(env)) {
    const head = querySqlite(db, `SELECT id, title, cwd FROM sessions WHERE id = '${q}' AND source <> 'tool'`);
    if (!head?.length) continue;
    const rows = querySqlite(db, `SELECT role, content, tool_calls, tool_name, timestamp FROM messages
      WHERE session_id = '${q}' AND COALESCE(active, 1) = 1 ORDER BY id`);
    const messages = [];
    for (const r of rows || []) {
      const at = msIso(r.timestamp);
      if ((r.role === 'user' || r.role === 'assistant') && r.content && String(r.content).trim()) {
        messages.push({ role: r.role, text: String(r.content), at });
      }
      if (r.role === 'assistant' && r.tool_calls) {
        let calls = [];
        try { calls = JSON.parse(r.tool_calls); } catch { /* not JSON */ }
        for (const c of Array.isArray(calls) ? calls : []) {
          const fn = (c && c.function) || c || {};
          let args = fn.arguments || {};
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { command: args }; } }
          messages.push({ role: 'tool', text: toolNote(fn.name || 'tool', args), at });
        }
      }
      // role 'tool' is a tool's output and 'system' the prompt: never imported.
    }
    return { id: head[0].id, cwd: head[0].cwd || null, title: head[0].title || null, messages };
  }
  return null;
}

// ── public ─────────────────────────────────────────────────────────────────

const READERS = {
  claude: { list: (o) => listFileSessions('claude', o), read: (id, o) => readFileSession('claude', id, o) },
  codex: { list: (o) => listFileSessions('codex', o), read: (id, o) => readFileSession('codex', id, o) },
  opencode: { list: listOpencode, read: readOpencode },
  hermes: { list: listHermes, read: readHermes },
};

function reader(type) {
  if (!TYPES.includes(type)) throw new Error(`Importing ${type} sessions is not supported`);
  return READERS[type];
}

/** Newest first: [{id, type, title, cwd, updatedAt, messageCount}] (count null
 *  when the tool can't say cheaply). Sessions an OpenAgents agent ran are left
 *  out: they are already threads. `run` replaces the opencode CLI in tests. */
function listLocalSessions(type, { env = process.env, limit = DEFAULT_LIMIT, run = runOpencode, excludeIds = [] } = {}) {
  const max = Math.max(1, Math.min(Math.trunc(limit), 1000));
  const sessions = reader(type);
  // A project can contain both workspace runs and personal CLI sessions.
  const skip = workspaceSessionIds(type, env);
  for (const id of excludeIds) skip.add(id);
  // Read past what gets left out, so the picker still fills up.
  if (type === 'opencode') return sessions.list({ env, limit: max, run, skip });
  return sessions.list({ env, limit: Math.min(max * 10, 5000), run, skip })
    .filter((s) => !skip.has(s.id) && !isProbe(s))
    .slice(0, max)
    .map(({ typedTurns, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

/** One session as a conversation, or null if it isn't there:
 *  {id, type, title, cwd, file, truncated, total, messages: [{role: user|assistant|tool, text, at}]}
 *  `file` is set for file-based tools (claude, codex). */
function readLocalSession(type, id, { env = process.env, maxMessages = 400, run = runOpencode } = {}) {
  const source = reader(type);
  if (workspaceSessionIds(type, env).has(id)) return null;
  const s = source.read(id, { env, run });
  if (!s) return null;
  const first = s.messages.find((m) => m.role === 'user');
  if (ranByOpenAgents(first?.text, s.cwd, env)) return null;
  if (type === 'opencode' && !first) throw new Error('This OpenCode session has no user messages to import');
  // A long session keeps its most recent part; the caller can attach the rest.
  const messages = s.messages.slice(-maxMessages).map((m) => ({ ...m, text: clip(maskSecrets(m.text)) }));
  return {
    id: s.id || id,
    type,
    title: oneLine(maskSecrets(s.title || (first && first.text) || id)),
    cwd: s.cwd || null,
    file: s.file || null,
    truncated: s.messages.length > messages.length,
    total: s.messages.length,
    messages,
  };
}

module.exports = { TYPES, listLocalSessions, readLocalSession, maskSecrets, claudeHome, codexHome };
