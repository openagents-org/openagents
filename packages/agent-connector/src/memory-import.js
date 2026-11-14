'use strict';

/**
 * "Bring your memory": an explicit, reviewable copy of what a user's existing
 * Claude Code / Codex / OpenClaw setup knows into the agent they connect to a
 * workspace.
 *
 * What an agent inherits on its own and what it silently leaves behind
 * differs per tool, and nothing used to tell the user which was which:
 *
 *  - Claude Code keeps CLAUDE_CONFIG_DIR, so the global CLAUDE.md and the
 *    user's skills come along. Project memory does not: Claude Code files it
 *    by folder and the agent runs in a folder of its own.
 *  - Codex keeps CODEX_HOME (global AGENTS.md, skills, its own memories), but
 *    the AGENTS.md of the repos the user worked in stay behind.
 *  - OpenClaw run on a launcher-managed key gets a private state directory,
 *    so MEMORY.md, the persona files, daily notes and skills in the user's own
 *    ~/.openclaw workspace stay behind entirely.
 *
 * scanMemory() lists both kinds — `loaded` (already available, shown so the
 * user can see it) and `importable` — and importMemory() copies the picked
 * items. Rules:
 *
 *  - Copy, never move. Sources are only read.
 *  - Everything stays on this machine. Claude Code and Codex read imported
 *    memory from the agent's own store (~/.openagents/memory/<agent>/) through
 *    buildImportedMemoryPrompt(); skills go to the agent's skills folder;
 *    OpenClaw gets the files in its private workspace, where it reads them
 *    natively.
 *  - Anything that looks like a credential is flagged and left unselected.
 *  - One manifest per agent records every file written and every file
 *    overwritten (with a backup), so undoImport() puts things back.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_VERSION = 1;
/** A memory file larger than this is not a memory note; skip it. */
const MAX_FILE_BYTES = 256 * 1024;
/** Per skill folder: skills ship scripts and assets, but not gigabytes. */
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_FILES = 400;
/** How many recent projects to look at per tool. */
const MAX_PROJECTS = 30;
/** Codex rollout files to read (first line only) when finding its projects. */
const MAX_CODEX_SESSIONS = 400;
/** Inline budget for the prompt section; the rest is listed by path. */
const PROMPT_INLINE_BUDGET = 8000;
const PROMPT_FILE_BUDGET = 3000;
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build']);
/** The workspace skill the adapters write themselves; never import or overwrite it. */
const OWN_SKILL_RE = /^openagents-workspace/;

const SUPPORTED_TYPES = new Set(['claude', 'codex', 'openclaw']);
const TOOL_LABEL = { claude: 'Claude Code', codex: 'Codex', openclaw: 'OpenClaw' };

const SECRET_PATTERNS = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{16,}/i,
];

// ---------------------------------------------------------------------------
// Small fs helpers (all best-effort: a scan never throws on one bad path)
// ---------------------------------------------------------------------------

function statOrNull(p) {
  try { return fs.statSync(p); } catch { return null; }
}
function isFile(p) { const s = statOrNull(p); return !!(s && s.isFile()); }
function isDir(p) { const s = statOrNull(p); return !!(s && s.isDirectory()); }
function readdir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
}
function readText(p, max = MAX_FILE_BYTES) {
  try {
    const s = fs.statSync(p);
    if (!s.isFile() || s.size > max) return null;
    return fs.readFileSync(p, 'utf-8');
  } catch { return null; }
}
function hash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
}
function slug(s) {
  return String(s || 'item').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
}
function tildify(p, home) {
  if (!p) return p;
  const h = home || os.homedir();
  return p === h ? '~' : p.startsWith(h + path.sep) ? `~${path.sep}${p.slice(h.length + 1)}` : p;
}
function within(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function looksSecret(text) {
  return !!text && SECRET_PATTERNS.some((re) => re.test(text));
}

/** Markdown files under `dir` (recursive, bounded), as absolute paths. */
function markdownFiles(dir, limit = 200) {
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= limit || depth > 4) return;
    for (const ent of readdir(d)) {
      if (out.length >= limit) return;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) walk(p, depth + 1); }
      else if (ent.isFile() && /\.md$/i.test(ent.name) && isFile(p)) out.push(p);
    }
  };
  walk(dir, 0);
  return out.sort();
}

/** Every file in a skill folder, bounded; null when it is too big to copy. */
function skillFiles(dir) {
  const out = [];
  let bytes = 0;
  let tooBig = false;
  const walk = (d, depth) => {
    if (tooBig || depth > 6) return;
    for (const ent of readdir(d)) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(p, depth + 1); continue; }
      if (!ent.isFile()) continue; // symlinks and devices are not copied
      const s = statOrNull(p);
      if (!s) continue;
      bytes += s.size;
      out.push(p);
      if (bytes > MAX_SKILL_BYTES || out.length > MAX_SKILL_FILES) { tooBig = true; return; }
    }
  };
  walk(dir, 0);
  return tooBig ? null : { files: out, bytes };
}

/**
 * Drop names that are the same file. On a case-insensitive disk (macOS,
 * Windows) MEMORY.md and memory.md both "exist" and are one file; copying it
 * twice made the second copy look like a file we replaced, and undo then put
 * it back.
 */
function uniqueFiles(files) {
  const seen = new Set();
  return files.filter((f) => {
    let key;
    try { key = fs.realpathSync.native(f); } catch { key = f; }
    if (process.platform === 'win32' || process.platform === 'darwin') key = key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sumBytes(files) {
  return files.reduce((n, f) => n + ((statOrNull(f) || {}).size || 0), 0);
}
function anySecret(files) {
  return files.some((f) => looksSecret(readText(f)));
}

/** The first `description:` of a SKILL.md front matter, or ''. */
function skillDescription(dir) {
  const md = path.join(dir, 'SKILL.md');
  const text = readText(md, 64 * 1024) || '';
  const m = text.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (!m) return '';
  const d = m[1].match(/^description:\s*\|?\s*(.*)$/m);
  return d ? d[1].replace(/^["']|["']$/g, '').trim().slice(0, 160) : '';
}

// ---------------------------------------------------------------------------
// Context: where this agent's tool keeps things, and where its copy goes
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.name        agent name
 * @param {string} opts.type        agent type (claude | codex | openclaw)
 * @param {string} opts.workingDir  the folder the agent runs in
 * @param {object} [opts.env]       the env the agent is launched with
 * @param {string} [opts.configDir] the launcher home (~/.openagents)
 * @param {string} [opts.home]      the user's home (tests)
 */
function makeContext(opts) {
  const home = opts.home || os.homedir();
  const env = opts.env || process.env;
  const configDir = opts.configDir || path.join(home, '.openagents');
  return {
    name: String(opts.name || ''),
    type: String(opts.type || '').toLowerCase(),
    workingDir: opts.workingDir ? path.resolve(opts.workingDir) : null,
    env,
    home,
    configDir,
    store: storeDir(configDir, opts.name),
  };
}

/** The agent's own memory store. Hashed so no name can escape or alias. */
function storeDir(configDir, agentName) {
  const name = String(agentName || '');
  return path.join(configDir, 'memory', `${slug(name).slice(0, 32)}-${hash(name)}`);
}

function claudeHome(ctx) {
  return ctx.env.CLAUDE_CONFIG_DIR && String(ctx.env.CLAUDE_CONFIG_DIR).trim()
    ? path.resolve(ctx.env.CLAUDE_CONFIG_DIR)
    : path.join(ctx.home, '.claude');
}
function codexHome(ctx) {
  return ctx.env.CODEX_HOME && String(ctx.env.CODEX_HOME).trim()
    ? path.resolve(ctx.env.CODEX_HOME)
    : path.join(ctx.home, '.codex');
}

/** OpenClaw's workspace folder for a state dir: openclaw.json's, else <state>/workspace. */
function openclawWorkspace(stateDir) {
  const cfgFile = path.join(stateDir, 'openclaw.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    const ws = cfg && cfg.agents && cfg.agents.defaults && cfg.agents.defaults.workspace;
    if (typeof ws === 'string' && ws.trim()) return path.resolve(ws.replace(/^~(?=$|[\\/])/, os.homedir()));
  } catch {}
  return path.join(stateDir, 'workspace');
}

/** True when a cwd is one of ours (an agent folder), not a user project. */
function isOwnFolder(ctx, cwd) {
  return within(cwd, ctx.configDir) || within(cwd, path.join(ctx.home, '.openagents'))
    || (ctx.workingDir && within(cwd, ctx.workingDir));
}

/**
 * A readable name for a project whose folder is unknown (no transcript says
 * it): the encoded name's last segment. "-home-me-code-shop" → "shop".
 */
function encodedProjectLabel(dirName) {
  const parts = String(dirName).split('-').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(dirName);
}

// ---------------------------------------------------------------------------
// Per-tool inventories. Each item:
//   { id, tool, kind, label, source, files: [abs], bytes, status, note?,
//     dest: { mode: 'store'|'skill'|'openclaw', ... } }
// ---------------------------------------------------------------------------

function claudeItems(ctx) {
  const items = [];
  const chome = claudeHome(ctx);

  const globalMd = path.join(chome, 'CLAUDE.md');
  if (isFile(globalMd)) {
    items.push({ id: 'claude:global', tool: 'claude', kind: 'instructions', label: 'Global instructions (CLAUDE.md)',
      source: globalMd, files: [globalMd], status: 'loaded', note: 'Claude Code loads this for the agent already.' });
  }
  const userSkills = readdir(path.join(chome, 'skills')).filter((e) => e.isDirectory() && !OWN_SKILL_RE.test(e.name));
  if (userSkills.length) {
    items.push({ id: 'claude:user-skills', tool: 'claude', kind: 'skill', label: `${userSkills.length} personal skill${userSkills.length === 1 ? '' : 's'}`,
      source: path.join(chome, 'skills'), files: [], status: 'loaded', count: userSkills.length,
      note: 'Claude Code loads your personal skills for the agent already.' });
  }

  // Projects: Claude Code files each folder's sessions and auto-memory under
  // projects/<folder with non-alphanumerics as '-'>. The folder itself is not
  // recoverable from that name, so read it from a transcript's `cwd`.
  const projectsRoot = path.join(chome, 'projects');
  const projects = readdir(projectsRoot)
    .filter((e) => e.isDirectory())
    .map((e) => ({ dir: path.join(projectsRoot, e.name), mtime: (statOrNull(path.join(projectsRoot, e.name)) || {}).mtimeMs || 0 }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_PROJECTS * 2);
  const seen = new Set();
  let kept = 0;
  for (const p of projects) {
    if (kept >= MAX_PROJECTS) break;
    const cwd = claudeProjectCwd(p.dir);
    if (cwd && (isOwnFolder(ctx, cwd) || seen.has(cwd))) continue;
    if (cwd) seen.add(cwd);
    const files = [];
    if (cwd) {
      for (const f of [path.join(cwd, 'CLAUDE.md'), path.join(cwd, '.claude', 'CLAUDE.md'), path.join(cwd, 'CLAUDE.local.md')]) {
        if (isFile(f) && readText(f) != null) files.push(f);
      }
    }
    const memDir = path.join(p.dir, 'memory');
    if (isDir(memDir)) files.push(...markdownFiles(memDir));
    files.splice(0, files.length, ...uniqueFiles(files));
    const projectSkills = cwd
      ? readdir(path.join(cwd, '.claude', 'skills')).filter((e) => e.isDirectory() && !OWN_SKILL_RE.test(e.name))
      : [];
    if (!files.length && !projectSkills.length) continue;
    kept++;
    const label = cwd ? path.basename(cwd) : encodedProjectLabel(path.basename(p.dir));
    const source = cwd || p.dir;
    if (files.length) {
      items.push({ id: `claude:project:${hash(source)}`, tool: 'claude', kind: 'memory', label: `Project memory: ${label}`,
        source, files, status: 'importable', dest: { mode: 'store', folder: `claude-${slug(label)}-${hash(source).slice(0, 6)}`, root: cwd || null, memRoot: memDir } });
    }
    for (const e of projectSkills) {
      const dir = path.join(cwd, '.claude', 'skills', e.name);
      items.push(skillItem(ctx, 'claude', dir, e.name, label));
    }
  }
  return items.filter(Boolean);
}

/** A Claude project's folder, from the first `cwd` in its newest transcripts. */
function claudeProjectCwd(projectDir) {
  const transcripts = readdir(projectDir)
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => path.join(projectDir, e.name))
    .map((f) => ({ f, m: (statOrNull(f) || {}).mtimeMs || 0 }))
    .sort((a, b) => b.m - a.m)
    .slice(0, 3);
  for (const { f } of transcripts) {
    const head = readHead(f, 64 * 1024);
    const m = head.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try { return JSON.parse(`"${m[1]}"`); } catch {}
    }
  }
  return null;
}

function readHead(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, n).toString('utf-8');
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

function skillItem(ctx, tool, dir, name, fromLabel) {
  const listed = skillFiles(dir);
  const dest = tool === 'openclaw' ? null : path.join(require('./skill-installer').skillsDirForAgentType(ctx.type, ctx.workingDir), name);
  const base = { id: `${tool}:skill:${hash(dir)}`, tool, kind: 'skill', label: `Skill: ${name}`, source: dir,
    description: skillDescription(dir), skillName: name, from: fromLabel || null };
  if (!listed) return { ...base, files: [], bytes: 0, status: 'skipped', note: 'Too large to copy (over 5 MB or 400 files).' };
  if (dest && isDir(dest)) return { ...base, files: listed.files, bytes: listed.bytes, status: 'loaded', note: 'The agent already has a skill with this name.' };
  return { ...base, files: listed.files, bytes: listed.bytes, status: 'importable', dest: { mode: 'skill', root: dir, target: dest } };
}

function codexItems(ctx) {
  const items = [];
  const chome = codexHome(ctx);
  for (const f of ['AGENTS.override.md', 'AGENTS.md']) {
    const p = path.join(chome, f);
    if (isFile(p)) {
      items.push({ id: `codex:global:${f}`, tool: 'codex', kind: 'instructions', label: `Global instructions (${f})`,
        source: p, files: [p], status: 'loaded', note: 'Codex loads this for the agent already.' });
    }
  }
  const userSkills = readdir(path.join(chome, 'skills')).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !OWN_SKILL_RE.test(e.name));
  if (userSkills.length) {
    items.push({ id: 'codex:user-skills', tool: 'codex', kind: 'skill', label: `${userSkills.length} personal skill${userSkills.length === 1 ? '' : 's'}`,
      source: path.join(chome, 'skills'), files: [], status: 'loaded', count: userSkills.length,
      note: 'Codex loads your personal skills for the agent already.' });
  }
  const memories = path.join(chome, 'memories');
  if (isDir(memories) || isFile(path.join(chome, 'memories_1.sqlite'))) {
    items.push({ id: 'codex:memories', tool: 'codex', kind: 'memory', label: 'Codex memories',
      source: isDir(memories) ? memories : chome, files: [], status: 'loaded', note: 'Codex reads its own memories for the agent already.' });
  }

  // Projects the user ran Codex in, from the session_meta line that opens
  // each rollout file (newest days first).
  const cwds = [];
  const seen = new Set();
  let read = 0;
  const sessions = path.join(chome, 'sessions');
  const desc = (d) => readdir(d).map((e) => e.name).sort().reverse();
  outer:
  for (const y of desc(sessions)) {
    for (const m of desc(path.join(sessions, y))) {
      for (const d of desc(path.join(sessions, y, m))) {
        const dayDir = path.join(sessions, y, m, d);
        for (const f of desc(dayDir).filter((n) => n.endsWith('.jsonl'))) {
          if (read++ >= MAX_CODEX_SESSIONS || cwds.length >= MAX_PROJECTS) break outer;
          const line = readHead(path.join(dayDir, f), 16 * 1024).split('\n')[0];
          let cwd = null;
          try { cwd = (JSON.parse(line).payload || {}).cwd || null; } catch {
            const mm = line.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (mm) try { cwd = JSON.parse(`"${mm[1]}"`); } catch {}
          }
          if (!cwd || seen.has(cwd)) continue;
          seen.add(cwd);
          if (!isOwnFolder(ctx, cwd)) cwds.push(cwd);
        }
      }
    }
  }
  for (const cwd of cwds) {
    const files = uniqueFiles(['AGENTS.override.md', 'AGENTS.md'].map((f) => path.join(cwd, f)).filter((f) => isFile(f) && readText(f) != null));
    if (!files.length) continue;
    const label = path.basename(cwd);
    items.push({ id: `codex:project:${hash(cwd)}`, tool: 'codex', kind: 'instructions', label: `Project instructions: ${label}`,
      source: cwd, files, status: 'importable', dest: { mode: 'store', folder: `codex-${slug(label)}-${hash(cwd).slice(0, 6)}`, root: cwd } });
  }
  return items;
}

const OPENCLAW_GROUPS = [
  { key: 'persona', kind: 'persona', label: 'Persona (SOUL.md, IDENTITY.md, USER.md)', files: ['SOUL.md', 'IDENTITY.md', 'USER.md'] },
  { key: 'instructions', kind: 'instructions', label: 'Instructions (AGENTS.md, TOOLS.md, HEARTBEAT.md)', files: ['AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md'] },
  { key: 'memory', kind: 'memory', label: 'Long-term memory (MEMORY.md)', files: ['MEMORY.md', 'memory.md'] },
];

function openclawItems(ctx) {
  const items = [];
  const userState = ctx.env.OPENCLAW_SOURCE_STATE_DIR || path.join(ctx.home, '.openclaw');
  const srcWs = openclawWorkspace(userState);
  if (!isDir(srcWs)) return items;
  const agentState = ctx.env.OPENCLAW_STATE_DIR ? path.resolve(ctx.env.OPENCLAW_STATE_DIR) : null;
  // No private state: the agent runs on the user's own OpenClaw and sees it all.
  const destWs = agentState ? openclawWorkspace(agentState) : null;
  const shared = !destWs || path.resolve(destWs) === path.resolve(srcWs);
  const loadedNote = 'This agent runs on your own OpenClaw setup and reads this already.';

  for (const g of OPENCLAW_GROUPS) {
    const files = uniqueFiles(g.files.map((f) => path.join(srcWs, f)).filter((f) => isFile(f) && readText(f) != null));
    if (!files.length) continue;
    items.push({ id: `openclaw:${g.key}`, tool: 'openclaw', kind: g.kind, label: g.label, source: srcWs, files,
      status: shared ? 'loaded' : 'importable', note: shared ? loadedNote : undefined,
      dest: shared ? undefined : { mode: 'openclaw', root: srcWs, target: destWs } });
  }
  const notesDir = path.join(srcWs, 'memory');
  const notes = isDir(notesDir) ? markdownFiles(notesDir, 1000) : [];
  if (notes.length) {
    items.push({ id: 'openclaw:notes', tool: 'openclaw', kind: 'memory', label: `${notes.length} memory note${notes.length === 1 ? '' : 's'} (memory/)`,
      source: notesDir, files: notes, status: shared ? 'loaded' : 'importable', note: shared ? loadedNote : undefined,
      dest: shared ? undefined : { mode: 'openclaw', root: srcWs, target: destWs } });
  }
  for (const e of readdir(path.join(srcWs, 'skills'))) {
    if (!e.isDirectory() || OWN_SKILL_RE.test(e.name)) continue;
    const dir = path.join(srcWs, 'skills', e.name);
    const it = skillItem(ctx, 'openclaw', dir, e.name, null);
    if (shared) { it.status = 'loaded'; it.note = loadedNote; delete it.dest; }
    else if (it.status === 'importable' || it.status === 'skipped') {
      const target = path.join(destWs, 'skills', e.name);
      if (it.status === 'importable' && isDir(target)) { it.status = 'loaded'; it.note = 'The agent already has a skill with this name.'; }
      else if (it.status === 'importable') it.dest = { mode: 'skill', root: dir, target };
    }
    items.push(it);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function manifestPath(ctx) { return path.join(ctx.store, 'manifest.json'); }

function readManifest(ctx) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath(ctx), 'utf-8'));
    if (m && m.version === MANIFEST_VERSION) return m;
  } catch {}
  return { version: MANIFEST_VERSION, agent: ctx.name, imports: [], written: [], dirs: [], backups: [], dismissedAt: null };
}

function writeManifest(ctx, m) {
  fs.mkdirSync(ctx.store, { recursive: true });
  const tmp = `${manifestPath(ctx)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf-8');
  fs.renameSync(tmp, manifestPath(ctx));
}

function importedIds(m) {
  const ids = new Set();
  for (const imp of m.imports || []) for (const it of imp.items || []) ids.add(it.id);
  return ids;
}

// ---------------------------------------------------------------------------
// Public: scan / import / undo / dismiss / summary
// ---------------------------------------------------------------------------

function inventory(ctx) {
  if (ctx.type === 'claude') return claudeItems(ctx);
  if (ctx.type === 'codex') return codexItems(ctx);
  if (ctx.type === 'openclaw') return openclawItems(ctx);
  return [];
}

/** Public, serialisable view of an item (no absolute dest paths, no contents). */
function publicItem(ctx, it, imported, light) {
  const status = imported.has(it.id) ? 'imported' : it.status;
  const bytes = it.bytes != null ? it.bytes : light ? 0 : sumBytes(it.files);
  const secret = !light && status === 'importable' && it.kind !== 'skill' ? anySecret(it.files) : false;
  return {
    id: it.id,
    tool: it.tool,
    kind: it.kind,
    label: it.label,
    source: tildify(it.source, ctx.home),
    files: it.files.map((f) => tildify(f, ctx.home)).slice(0, 50),
    fileCount: it.count != null ? it.count : it.files.length,
    bytes,
    status,
    secret,
    selected: status === 'importable' && !secret,
    ...(it.note ? { note: it.note } : {}),
    ...(it.description ? { description: it.description } : {}),
  };
}

/**
 * What this agent could bring over, and what it has already.
 * Never throws; an unsupported agent type returns `supported: false`.
 */
function scanMemory(opts, { light = false } = {}) {
  const ctx = makeContext(opts);
  const supported = SUPPORTED_TYPES.has(ctx.type);
  const m = readManifest(ctx);
  const imported = importedIds(m);
  let items = [];
  if (supported) {
    try { items = inventory(ctx).map((it) => publicItem(ctx, it, imported, light)); } catch { items = []; }
  }
  const last = (m.imports || [])[m.imports.length - 1] || null;
  return {
    agent: ctx.name,
    type: ctx.type,
    tool: TOOL_LABEL[ctx.type] || ctx.type,
    supported,
    items,
    importedAt: last ? last.at : null,
    dismissedAt: m.dismissedAt || null,
  };
}

/** The status the daemon reports per agent on its heartbeat. */
function memorySummary(opts) {
  // Light: counts only. Reading every file for credentials is left to the
  // full scan the user opens.
  const scan = scanMemory(opts, { light: true });
  if (!scan.supported) return null;
  const importable = scan.items.filter((i) => i.status === 'importable');
  const counts = (list) => list.reduce((acc, i) => { acc[i.kind] = (acc[i.kind] || 0) + 1; return acc; }, {});
  const imported = scan.items.filter((i) => i.status === 'imported');
  return {
    status: scan.importedAt ? 'imported' : scan.dismissedAt ? 'dismissed' : importable.length ? 'available' : 'none',
    found: importable.length,
    loaded: scan.items.filter((i) => i.status === 'loaded').length,
    imported: imported.length,
    counts: counts(importable),
    importedCounts: counts(imported),
    importedAt: scan.importedAt,
    tool: scan.tool,
  };
}

/** mkdir -p that records the folders it creates, so undo removes only those. */
function mkdirTracked(m, dir) {
  const missing = [];
  let d = path.resolve(dir);
  while (!fs.existsSync(d)) {
    missing.push(d);
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  if (!missing.length) return;
  fs.mkdirSync(dir, { recursive: true });
  if (!m.dirs) m.dirs = [];
  for (const created of missing.reverse()) if (!m.dirs.includes(created)) m.dirs.push(created);
}

/** Copy one file, recording what was written and backing up what it replaces. */
function copyTracked(ctx, m, src, dest, stamp) {
  mkdirTracked(m, path.dirname(dest));
  if (fs.existsSync(dest)) {
    const already = m.written.includes(dest) || m.backups.some((b) => b.path === dest);
    if (!already) {
      const backup = path.join(ctx.store, 'backups', stamp, hash(dest) + '-' + path.basename(dest));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(dest, backup);
      m.backups.push({ path: dest, backup });
    }
  } else {
    m.written.push(dest);
  }
  fs.copyFileSync(src, dest);
}

/** Move a file out of the way (backed up), e.g. OpenClaw's first-run BOOTSTRAP.md. */
function retireTracked(ctx, m, file, stamp) {
  if (!isFile(file)) return;
  const backup = path.join(ctx.store, 'backups', stamp, hash(file) + '-' + path.basename(file));
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(file, backup);
  m.backups.push({ path: file, backup });
  fs.unlinkSync(file);
}

/**
 * Copy the picked items into the agent. `ids` are item ids from scanMemory;
 * anything not `importable` is ignored. Returns a receipt.
 */
function importMemory(opts, ids) {
  const ctx = makeContext(opts);
  if (!SUPPORTED_TYPES.has(ctx.type)) throw new Error(`Memory import is not available for ${ctx.type || 'this'} agents yet`);
  const wanted = new Set((ids || []).map(String));
  if (!wanted.size) throw new Error('Pick at least one item to import');
  const m = readManifest(ctx);
  const already = importedIds(m);
  const all = inventory(ctx);
  const picked = all.filter((it) => wanted.has(it.id) && it.status === 'importable' && !already.has(it.id) && it.dest);
  if (!picked.length) throw new Error('Nothing left to import: those items are already available to the agent');

  const at = new Date().toISOString();
  const stamp = at.replace(/[:.]/g, '-');
  const done = [];
  for (const it of picked) {
    let copied = 0;
    const d = it.dest;
    for (const src of it.files) {
      let dest;
      if (d.mode === 'store') {
        // Keep the source's layout under one folder per project, so the
        // memory/ index keeps pointing at the notes it links.
        const rel = d.memRoot && within(src, d.memRoot)
          ? path.join('memory', path.relative(d.memRoot, src))
          : d.root && within(src, d.root) ? path.relative(d.root, src) : path.basename(src);
        dest = path.join(ctx.store, 'files', d.folder, rel);
      } else {
        dest = path.join(d.target, path.relative(d.root, src));
      }
      copyTracked(ctx, m, src, dest, stamp);
      copied++;
    }
    if (d.mode === 'store') {
      const metaFile = path.join(ctx.store, 'files', d.folder, '.source.json');
      const existed = fs.existsSync(metaFile);
      fs.writeFileSync(metaFile, JSON.stringify({ id: it.id, label: it.label, source: it.source, tool: it.tool, kind: it.kind, at }, null, 2));
      if (!existed) m.written.push(metaFile);
    }
    if (it.tool === 'openclaw' && it.kind === 'persona' && d.mode === 'openclaw') {
      // A fresh OpenClaw workspace opens with a first-run ritual that asks who
      // it is and who the user is. The imported persona answers that.
      retireTracked(ctx, m, path.join(d.target, 'BOOTSTRAP.md'), stamp);
    }
    done.push({ id: it.id, label: it.label, kind: it.kind, tool: it.tool, source: tildify(it.source, ctx.home), files: copied });
  }
  m.imports.push({ at, items: done });
  m.dismissedAt = null;
  writeManifest(ctx, m);
  const counts = done.reduce((acc, i) => { acc[i.kind] = (acc[i.kind] || 0) + 1; return acc; }, {});
  return { at, tool: TOOL_LABEL[ctx.type], items: done, counts, files: done.reduce((n, i) => n + i.files, 0) };
}

/** Put everything back as it was before the first import. */
function undoImport(opts) {
  const ctx = makeContext(opts);
  const m = readManifest(ctx);
  let removed = 0;
  let restored = 0;
  for (const f of [...m.written].reverse()) {
    try { fs.unlinkSync(f); removed++; } catch {}
  }
  for (const b of [...m.backups].reverse()) {
    try {
      fs.mkdirSync(path.dirname(b.path), { recursive: true });
      fs.copyFileSync(b.backup, b.path);
      restored++;
    } catch {}
  }
  // Folders the import created, deepest first, and only once empty: anything
  // the user or the agent put there since stays.
  for (const d of [...(m.dirs || [])].sort((a, b) => b.length - a.length)) {
    try { fs.rmdirSync(d); } catch {}
  }
  try { fs.rmSync(path.join(ctx.store, 'files'), { recursive: true, force: true }); } catch {}
  try { fs.rmSync(path.join(ctx.store, 'backups'), { recursive: true, force: true }); } catch {}
  const items = (m.imports || []).reduce((n, i) => n + (i.items || []).length, 0);
  writeManifest(ctx, { version: MANIFEST_VERSION, agent: ctx.name, imports: [], written: [], dirs: [], backups: [], dismissedAt: null, undoneAt: new Date().toISOString() });
  return { removed, restored, items };
}

/** "Not now": stop offering the import until the user opens it again. */
function dismissMemory(opts) {
  const ctx = makeContext(opts);
  const m = readManifest(ctx);
  m.dismissedAt = new Date().toISOString();
  writeManifest(ctx, m);
  return { dismissedAt: m.dismissedAt };
}

/**
 * Text of one item's files, for a local preview (launcher, CLI). The daemon
 * does not send this to the workspace: memory stays on the device.
 */
function previewItem(opts, id, maxBytes = 20000) {
  const ctx = makeContext(opts);
  const it = inventory(ctx).find((x) => x.id === id);
  if (!it) throw new Error('No such item');
  return it.files.slice(0, 20).map((f) => {
    const text = readText(f) || '';
    return { path: tildify(f, ctx.home), text: text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…` : text };
  });
}

// ---------------------------------------------------------------------------
// Prompt section for agents that read imported memory from the store
// ---------------------------------------------------------------------------

/**
 * The system-prompt section that hands a Claude Code or Codex agent the
 * memory imported into its store: short files inline, the rest by path so the
 * agent reads them when they matter. '' when nothing was imported.
 */
function buildImportedMemoryPrompt({ agentName, configDir }) {
  const store = storeDir(configDir || path.join(os.homedir(), '.openagents'), agentName);
  const filesRoot = path.join(store, 'files');
  const folders = readdir(filesRoot).filter((e) => e.isDirectory()).map((e) => path.join(filesRoot, e.name)).sort();
  if (!folders.length) return '';
  let budget = PROMPT_INLINE_BUDGET;
  const parts = [
    '## Memory brought over from your earlier setup',
    'The user imported this from the setup they used before OpenAgents, so you keep what you already knew about them and their projects. ' +
    'Treat it as background knowledge: what the user tells you now wins where it differs. ' +
    'Files listed by path are on this computer; read them when they are relevant.',
  ];
  for (const folder of folders) {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(folder, '.source.json'), 'utf-8')); } catch {}
    const files = [];
    const walk = (d, depth) => {
      if (depth > 6) return;
      for (const ent of readdir(d)) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p, depth + 1);
        else if (ent.isFile() && ent.name !== '.source.json') files.push(p);
      }
    };
    walk(folder, 0);
    if (!files.length) continue;
    // Instructions and the memory index first: they say where the rest is.
    const rank = (f) => {
      const b = path.basename(f).toUpperCase();
      if (/^(CLAUDE|AGENTS)(\.OVERRIDE|\.LOCAL)?\.MD$/.test(b)) return 0;
      if (b === 'MEMORY.MD') return 1;
      return 2;
    };
    files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    parts.push(`\n### ${meta.label || path.basename(folder)}${meta.source ? ` (from ${meta.source})` : ''}`);
    const listed = [];
    for (const f of files) {
      const text = rank(f) < 2 ? readText(f, 64 * 1024) : null;
      // Instructions and the memory index go inline (cut short when long: the
      // head of an index already says where things are), the rest by path.
      const room = Math.min(PROMPT_FILE_BUDGET, budget);
      if (text != null && room >= 400) {
        const body = text.trim();
        const shown = body.length <= room ? body : `${body.slice(0, room)}\n… (continues in ${f})`;
        budget -= Math.min(body.length, room);
        parts.push(`<file path="${f}">\n${shown}\n</file>`);
      } else {
        listed.push(f);
      }
    }
    if (listed.length) {
      const shown = listed.slice(0, 40);
      parts.push(`Other files:\n${shown.map((f) => `- ${f}`).join('\n')}${listed.length > shown.length ? `\n- …and ${listed.length - shown.length} more in ${folder}` : ''}`);
    }
  }
  return parts.join('\n');
}

module.exports = {
  SUPPORTED_TYPES,
  scanMemory,
  memorySummary,
  importMemory,
  undoImport,
  dismissMemory,
  previewItem,
  buildImportedMemoryPrompt,
  storeDir,
  looksSecret,
  _internal: { makeContext, claudeProjectCwd, openclawWorkspace, inventory },
};
