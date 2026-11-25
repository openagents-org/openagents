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
const { spawnSync } = require('child_process');
const { redactSecrets } = require('./adapters/utils');

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

function openAgentsHome(env) {
  return env.OPENAGENTS_HOME || path.join(os.homedir(), '.openagents');
}

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
  if (type === 'claude') {
    const root = path.join(claudeHome(env), 'projects');
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
    const files = [];
    for (const d of dirs) {
      let names = [];
      try { names = fs.readdirSync(path.join(root, d.name)); } catch { continue; }
      for (const n of names) if (/^[0-9a-f-]{36}\.jsonl$/i.test(n)) files.push(path.join(root, d.name, n));
    }
    return files;
  }
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
  if (s.title.trim().toLowerCase() !== PROBE_PROMPT) return false;
  // Exactly: "hi" was all the person (the check) typed. Without that detail,
  // a short session that opened with "hi".
  return s.typedTurns != null ? s.typedTurns <= 1 : (s.messageCount == null || s.messageCount <= 2);
}

function ranByOpenAgents(firstPrompt, cwd, env) {
  if (OPENAGENTS_RUN.test(firstPrompt || '')) return true;
  return !!cwd && path.resolve(cwd).startsWith(path.resolve(openAgentsHome(env)) + path.sep);
}

function workspaceSessionIds(env) {
  const dir = path.join(openAgentsHome(env), 'sessions');
  const ids = new Set();
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ids; }
  // Some adapters pass the workspace briefing as a system prompt, so it
  // does not appear in the CLI's user messages. Their channel maps record
  // the exact CLI IDs, even when the agent works in a shared project.
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const channels = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      if (!channels || typeof channels !== 'object' || Array.isArray(channels)) continue;
      for (const id of Object.values(channels)) {
        if (typeof id === 'string') ids.add(id);
      }
    } catch { /* a stale or partially written map */ }
  }
  return ids;
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

function listFileSessions(type, { env, limit }) {
  const files = sessionFiles(type, env)
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
      title: maskSecrets(oneLine(first.text)),
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
  return sessionFiles(type, env).find((f) => idFromFile(type, f) === id) || null;
}

function readFileSession(type, id, { env }) {
  const file = findSessionFile(type, id, env);
  if (!file) return null;
  const s = parse(type, readLines(file));
  return { id: type === 'claude' ? id : (s.id || id), cwd: s.cwd, file, messages: s.messages };
}

// ── OpenCode ───────────────────────────────────────────────────────────────

function runOpencode(args, env) {
  const { findOpencodeBinary } = require('./adapters/opencode');
  const bin = findOpencodeBinary();
  if (!bin) return null; // not installed: nothing to import
  const cmdShim = process.platform === 'win32' && /\.cmd$/i.test(bin);
  const command = cmdShim ? (process.env.ComSpec || 'cmd.exe') : bin;
  // cmd.exe strips the outer quotes. The inner quotes preserve the shim
  // path and arguments such as the read-only SQL as individual tokens.
  const commandArgs = cmdShim ? ['/d', '/s', '/c', `"${[bin, ...args].map((arg) => `"${arg}"`).join(' ')}"`] : args;
  const r = spawnSync(command, commandArgs, {
    env: { ...process.env, ...env }, encoding: 'utf-8', timeout: 30000,
    maxBuffer: 64 * 1024 * 1024, windowsHide: true, windowsVerbatimArguments: cmdShim,
  });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout;
}

function jsonFrom(text) {
  if (!text) return null;
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  try { return JSON.parse(text.slice(start)); } catch { return null; }
}

const msIso = (v) => (Number(v) > 0 ? new Date(Number(v) > 1e12 ? Number(v) : Number(v) * 1000).toISOString() : null);

function listOpencode({ env, limit, run }) {
  // An indexed query lists sessions and counts across projects. The CLI's
  // session list can be scoped to its working directory's project.
  // Use the first user text to recognize workspace runs with generated titles.
  const sql = `SELECT s.id, s.title, s.directory, s.time_updated AS updated,
      (SELECT COUNT(*) FROM message WHERE session_id = s.id) AS message_count,
      (SELECT substr(json_extract(p.data, '$.text'), 1, 2048)
        FROM message m JOIN part p ON p.message_id = m.id
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'user'
          AND json_extract(p.data, '$.type') = 'text'
          AND COALESCE(json_extract(p.data, '$.synthetic'), 0) = 0
        ORDER BY m.time_created, m.id, p.time_created, p.id LIMIT 1) AS first_prompt
    FROM session s WHERE s.parent_id IS NULL
    ORDER BY s.time_updated DESC LIMIT ${Math.trunc(limit)}`.replace(/\s+/g, ' ');
  const rows = jsonFrom(run(['db', '--format', 'json', sql], env));
  const sessions = Array.isArray(rows) ? rows : jsonFrom(run(['session', 'list', '--format', 'json'], env));
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter((x) => x && x.id)
    .map((x) => ({ x, updated: Number((x.time && x.time.updated) || x.updated || 0) }))
    .sort((a, b) => b.updated - a.updated)
    .filter(({ x }) => !ranByOpenAgents(x.first_prompt || x.title, x.directory, env))
    .slice(0, limit)
    .map(({ x, updated }) => ({
      id: x.id, type: 'opencode', title: maskSecrets(oneLine(x.title || x.id)), cwd: x.directory || null,
      updatedAt: msIso(updated), messageCount: x.message_count ?? null,
    }));
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
      if (part.type === 'text' && part.text && !part.synthetic) messages.push({ role, text: part.text, at });
      else if (part.type === 'tool' && part.tool) messages.push({ role: 'tool', text: toolNote(part.tool, part.state && part.state.input), at });
    }
  }
  const info = exported.info || {};
  return { id: info.id || id, cwd: info.directory || null, title: info.title || null, messages };
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
function querySqlite(file, sql) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try { return db.prepare(sql).all(); } finally { db.close(); }
  } catch (e) {
    if (e && e.code !== 'ERR_UNKNOWN_BUILTIN_MODULE' && e.code !== 'MODULE_NOT_FOUND' && !/node:sqlite/.test(String(e.message))) return [];
  }
  const r = spawnSync('sqlite3', ['-readonly', '-json', file, sql], { encoding: 'utf-8', timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return [];
  try { return JSON.parse(r.stdout || '[]'); } catch { return []; }
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
  for (const db of hermesDbs(env)) rows.push(...querySqlite(db, HERMES_LIST_SQL));
  return rows
    .filter((r) => r && r.id && (r.first || r.title) && !ranByOpenAgents(r.first, r.cwd, env))
    .sort((a, b) => Number(b.updated) - Number(a.updated))
    .slice(0, limit)
    .map((r) => ({
      id: r.id, type: 'hermes', title: maskSecrets(oneLine(r.title || r.first)), cwd: r.cwd || null,
      updatedAt: msIso(r.updated), messageCount: Number(r.count) || null,
    }));
}

function readHermes(id, { env }) {
  if (!/^[A-Za-z0-9_.:-]{4,120}$/.test(String(id || ''))) return null;
  const q = String(id).replace(/'/g, "''");
  for (const db of hermesDbs(env)) {
    const head = querySqlite(db, `SELECT id, title, cwd FROM sessions WHERE id = '${q}'`);
    if (!head.length) continue;
    const rows = querySqlite(db, `SELECT role, content, tool_calls, tool_name, timestamp FROM messages
      WHERE session_id = '${q}' AND COALESCE(active, 1) = 1 ORDER BY id`);
    const messages = [];
    for (const r of rows) {
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
  const skip = workspaceSessionIds(env);
  for (const id of excludeIds) skip.add(id);
  // Read past what gets left out, so the picker still fills up.
  return sessions.list({ env, limit: Math.min(max * 10, 5000), run })
    .filter((s) => !skip.has(s.id) && !isProbe(s))
    .slice(0, max)
    .map(({ typedTurns, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

/** One session as a conversation, or null if it isn't there:
 *  {id, type, title, cwd, file, truncated, total, messages: [{role: user|assistant|tool, text, at}]}
 *  `file` is set for file-based tools (claude, codex). */
function readLocalSession(type, id, { env = process.env, maxMessages = 400, run = runOpencode } = {}) {
  const s = reader(type).read(id, { env, run });
  if (!s) return null;
  const first = s.messages.find((m) => m.role === 'user');
  // A long session keeps its most recent part; the caller can attach the rest.
  const messages = s.messages.slice(-maxMessages).map((m) => ({ ...m, text: clip(maskSecrets(m.text)) }));
  return {
    id: s.id || id,
    type,
    title: maskSecrets(oneLine(s.title || (first && first.text) || id)),
    cwd: s.cwd || null,
    file: s.file || null,
    truncated: s.messages.length > messages.length,
    total: s.messages.length,
    messages,
  };
}

module.exports = { TYPES, listLocalSessions, readLocalSession, maskSecrets, claudeHome, codexHome };
