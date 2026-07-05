'use strict';

/**
 * Skill installer — installs third-party Agent Skills (Skill Hub catalog
 * entries) into a local agent's skills directory.
 *
 * Responsibilities (all independently testable):
 *  - Resolve the per-agent-type skills directory.
 *  - Fetch the skill's files from its source repo into that directory.
 *  - Verify a SKILL.md actually landed (no silent success).
 *  - Enumerate already-installed skills (used to inject context for agents,
 *    like Codex, that don't auto-discover a skills directory).
 *
 * The "how bytes arrive" step is injected via a `fetcher` so production can
 * use git/https while tests use a local fixture copier. The directory
 * resolution, file verification, and error handling — the parts that decide
 * end-to-end correctness — are exercised directly.
 *
 * A catalog skill is identified by `source_repo` + `source_path`
 * (e.g. "anthropics/skills" + "skills/claude-api"), mirroring the Skill Hub
 * catalog in workspace/backend/app/skill_catalog.py.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { defaultAgentWorkdir } = require('./paths');

// Uploaded-skill (.zip) extraction guards. Mirrors the server-side limits in
// workspace/backend/app/custom_skills.py so both ends agree.
const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB expanded total
const MAX_ZIP_COMPRESSION_RATIO = 200;               // expanded / stored

/**
 * Resolve the skills directory for a given agent type, rooted at the agent's
 * working directory. Different runtimes look in different places:
 *  - claude  → <workingDir>/.claude/skills   (Claude Code auto-discovers here)
 *  - cursor  → <workingDir>/.cursor/skills   (Cursor auto-discovers here)
 *  - codex   → <workingDir>/.codex/skills    (no native discovery; the Codex
 *              adapter injects these into the prompt — see codex.js)
 *  - default → <workingDir>/.agent/skills
 *
 * @param {string} agentType
 * @param {string} [workingDir]
 * @returns {string} absolute path to the skills directory
 */
function skillsDirForAgentType(agentType, workingDir) {
  // Never root skills at process.cwd(): a packaged Windows daemon's cwd is
  // C:\WINDOWS\system32, so installing there throws EPERM. Fall back to a
  // writable per-agent dir under ~/.openagents instead.
  const base = workingDir || defaultAgentWorkdir(agentType);
  switch ((agentType || '').toLowerCase()) {
    case 'claude':
      return path.join(base, '.claude', 'skills');
    case 'cursor':
      return path.join(base, '.cursor', 'skills');
    case 'codex':
      return path.join(base, '.codex', 'skills');
    default:
      return path.join(base, '.agent', 'skills');
  }
}

/**
 * Normalize a catalog skill object (snake_case from backend / camelCase from
 * UI) to a stable shape.
 */
// Validation patterns. The skill metadata comes from a workspace.agent.control
// event, which any holder of the workspace token could craft — so the launcher
// does NOT trust it blindly even though the backend only emits catalog entries.
// These guards prevent path traversal (a malicious id/source_path escaping the
// skills dir) and argument injection (a value starting with "-" being read as a
// git/curl flag).
const _ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;          // no leading dash, no slashes/dots-only
const _REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;  // owner/repo
const _PATH_SEG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;    // each path segment

function _assertSafeId(id) {
  if (typeof id !== 'string' || id === '.' || id === '..' || !_ID_RE.test(id)) {
    throw new Error(`unsafe skill id "${id}" (must match ${_ID_RE})`);
  }
}

function _assertSafeSourceRepo(repo) {
  if (repo && !_REPO_RE.test(repo)) {
    throw new Error(`unsafe source_repo "${repo}" (expected owner/repo)`);
  }
}

function _assertSafeSourcePath(sp) {
  if (!sp) return;
  const segs = sp.replace(/^\/+|\/+$/g, '').split('/');
  for (const seg of segs) {
    if (seg === '..' || !_PATH_SEG_RE.test(seg)) {
      throw new Error(`unsafe source_path "${sp}" (segment "${seg}")`);
    }
  }
}

function normalizeSkill(skill) {
  if (!skill || typeof skill !== 'object') {
    throw new Error('skill metadata missing');
  }
  const id = skill.id || skill.skill_id || skill.skillId;
  if (!id) throw new Error('skill metadata missing id');
  _assertSafeId(id);
  const sourceRepo = skill.source_repo || skill.sourceRepo || '';
  const sourcePath = skill.source_path || skill.sourcePath || '';
  _assertSafeSourceRepo(sourceRepo);
  _assertSafeSourcePath(sourcePath);
  return {
    id,
    name: skill.name || id,
    description: skill.description || '',
    sourceRepo,
    sourcePath,
  };
}

/**
 * Resolve <skillsDir>/<id> and assert it stays inside <skillsDir>. Belt-and-
 * suspenders on top of _assertSafeId so we never read/write/delete outside the
 * agent's skills directory.
 */
function _safeSkillDir(skillsDir, id) {
  const dest = path.resolve(skillsDir, id);
  const root = path.resolve(skillsDir);
  if (dest !== path.join(root, id) || !dest.startsWith(root + path.sep)) {
    throw new Error(`refusing to operate on "${dest}" outside skills dir "${root}"`);
  }
  return dest;
}

/**
 * Default fetcher: download the skill's files from GitHub into `destDir`.
 *
 * Strategy, in order of preference:
 *   1. git sparse-checkout of `<source_repo>` limited to `<source_path>`
 *      (gets the full skill directory — scripts, references, assets).
 *   2. Fallback: fetch just `SKILL.md` over HTTPS from raw.githubusercontent.
 *
 * Throws if neither strategy produces a SKILL.md. Never silently no-ops.
 *
 * @param {{skill: object, destDir: string, log?: function}} args
 */
function defaultFetcher({ skill, destDir, log }) {
  const { sourceRepo, sourcePath } = skill;
  if (!sourceRepo) {
    throw new Error(`skill "${skill.id}" has no source_repo; cannot fetch`);
  }
  const _log = log || (() => {});

  // ── Strategy 1: git sparse-checkout ──
  if (_gitAvailable()) {
    let tmp;
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), `skill-${skill.id}-`));
      const repoUrl = `https://github.com/${sourceRepo}.git`;
      const sp = sourcePath || '.';
      execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', repoUrl, tmp],
        { stdio: 'pipe', timeout: 120000 });
      execFileSync('git', ['-C', tmp, 'sparse-checkout', 'set', sp],
        { stdio: 'pipe', timeout: 60000 });
      const srcDir = path.join(tmp, sp);
      if (!fs.existsSync(srcDir)) {
        throw new Error(`source path "${sp}" not found in ${sourceRepo}`);
      }
      _copyDir(srcDir, destDir);
      _log(`Fetched ${sourceRepo}/${sp} via git sparse-checkout`);
      return { partial: false };
    } catch (e) {
      _log(`git fetch failed (${e && e.message ? e.message : e}); trying raw SKILL.md`);
    } finally {
      if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
    }
  }

  // ── Strategy 2: raw SKILL.md over HTTPS ──
  const sp = (sourcePath || '').replace(/^\/+|\/+$/g, '');
  for (const branch of ['main', 'master']) {
    const rawUrl = `https://raw.githubusercontent.com/${sourceRepo}/${branch}/${sp ? sp + '/' : ''}SKILL.md`;
    try {
      const body = _httpGetSync(rawUrl);
      if (body && body.trim()) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, 'SKILL.md'), body, 'utf-8');
        _log(`Fetched SKILL.md via HTTPS (${branch})`);
        // Only the SKILL.md was retrieved — any bundled scripts/references the
        // skill ships were NOT fetched. Signal "partial" so installSkill can
        // warn; skills that depend on those files may not be fully functional.
        return { partial: true };
      }
    } catch {
      // try next branch
    }
  }

  throw new Error(`could not fetch skill "${skill.id}" from ${sourceRepo}/${sourcePath}`);
}

/**
 * Install a catalog skill into the agent's skills directory.
 *
 * @param {object} args
 * @param {object} args.skill        catalog entry (id, name, source_repo, source_path)
 * @param {string} args.agentType    e.g. "claude", "codex"
 * @param {string} [args.workingDir] agent working dir; defaults to cwd
 * @param {function} [args.fetcher]  ({skill, destDir, log}) => void; defaults to git/https
 * @param {function} [args.log]
 * @returns {{path: string, skillId: string}}
 * @throws {Error} with a clear, surfaceable message on any failure
 */
function installSkill({ skill, agentType, workingDir, fetcher, log }) {
  const norm = normalizeSkill(skill);
  const _log = log || (() => {});
  const skillsDir = skillsDirForAgentType(agentType, workingDir);
  const destDir = _safeSkillDir(skillsDir, norm.id);

  // Ensure the parent skills directory exists / is writable. A clear error
  // here distinguishes "no permission / bad working dir" from fetch failures.
  try {
    fs.mkdirSync(destDir, { recursive: true });
  } catch (e) {
    throw new Error(
      `cannot create skills directory "${destDir}" for agent type "${agentType}": ` +
      `${e && e.message ? e.message : e}`
    );
  }

  // Re-installing: start clean so stale files from a prior version don't linger.
  try {
    for (const entry of fs.readdirSync(destDir)) {
      fs.rmSync(path.join(destDir, entry), { recursive: true, force: true });
    }
  } catch {}

  const doFetch = fetcher || defaultFetcher;
  const fetchResult = doFetch({ skill: norm, destDir, log: _log }) || {};

  // No silent success: a real install must produce a SKILL.md.
  const skillMd = _findSkillMd(destDir);
  if (!skillMd) {
    throw new Error(
      `install of "${norm.id}" produced no SKILL.md in ${destDir} ` +
      `(fetched from ${norm.sourceRepo}/${norm.sourcePath})`
    );
  }

  // A partial fetch (SKILL.md only, bundled scripts/references missing) is a
  // known degraded state — succeed but WARN loudly so it isn't mistaken for a
  // fully-functional install.
  const partial = fetchResult.partial === true;
  if (partial) {
    _log(
      `WARNING: only SKILL.md was fetched for "${norm.id}" — bundled files ` +
      `(scripts/references) were NOT installed; skills that need them may not work fully`
    );
  }

  _log(`Installed skill "${norm.id}" → ${destDir}${partial ? ' (partial: SKILL.md only)' : ''}`);
  return { path: destDir, skillId: norm.id, partial };
}

/**
 * Install a user-uploaded custom skill (source_type=workspace_file) from an
 * already-downloaded Buffer. Unlike catalog skills, the bytes are provided by
 * the caller (the adapter downloads them via WorkspaceClient.readFile) — the
 * installer never touches the network here.
 *
 *  - `.md`  → written verbatim as <destDir>/SKILL.md
 *  - `.zip` → extracted with full path/symlink/zip-bomb validation; a single
 *             top-level directory is stripped so SKILL.md ends up at the root.
 *
 * Reuses installSkill's dest-dir resolution, clean-on-reinstall, and final
 * SKILL.md verification by passing a synchronous fetcher that writes the Buffer.
 *
 * @param {object} args
 * @param {object} args.skill        metadata (id, package_type, filename, …)
 * @param {Buffer} args.buffer       the uploaded file bytes
 * @param {string} args.agentType
 * @param {string} [args.workingDir]
 * @param {function} [args.log]
 * @returns {{path: string, skillId: string, partial: boolean}}
 */
function installUploadedSkill({ skill, buffer, agentType, workingDir, log }) {
  const _log = log || (() => {});
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const id = (skill && (skill.id || skill.skill_id)) || 'unknown';
    throw new Error(`uploaded skill "${id}" has no file content`);
  }
  const packageType = _resolvePackageType(skill, buffer);
  const fetcher = ({ destDir }) => {
    if (packageType === 'zip') {
      _installUploadedZip(buffer, destDir, _log);
    } else {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'SKILL.md'), buffer);
      _log('wrote uploaded SKILL.md');
    }
    return { partial: false };
  };
  return installSkill({ skill, agentType, workingDir, fetcher, log: _log });
}

/**
 * Remove an installed skill directory. Idempotent.
 *
 * @returns {{path: string, removed: boolean, skillId: string}}
 */
function uninstallSkill({ skill, agentType, workingDir, log }) {
  const norm = normalizeSkill(skill);
  const _log = log || (() => {});
  const destDir = _safeSkillDir(skillsDirForAgentType(agentType, workingDir), norm.id);
  let removed = false;
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
    removed = true;
    _log(`Uninstalled skill "${norm.id}" from ${destDir}`);
  }
  return { path: destDir, removed, skillId: norm.id };
}

/**
 * Enumerate installed third-party skills under the agent's skills directory.
 * Each returned entry parses the SKILL.md frontmatter for name/description.
 * Used by adapters (e.g. Codex) that must inject skill availability into the
 * model context because the runtime doesn't auto-discover skills.
 *
 * @returns {Array<{id: string, name: string, description: string, path: string, skillMd: string}>}
 */
function listInstalledSkills({ agentType, workingDir }) {
  const skillsDir = skillsDirForAgentType(agentType, workingDir);
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(skillsDir, ent.name);
    const skillMd = _findSkillMd(dir);
    if (!skillMd) continue;
    const meta = _parseSkillFrontmatter(skillMd);
    out.push({
      id: ent.name,
      name: meta.name || ent.name,
      description: meta.description || '',
      path: dir,
      skillMd,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function _findSkillMd(dir) {
  // Prefer a top-level SKILL.md; fall back to any *.md so single-file skills
  // (e.g. fetched as openagents-workspace.md) still count as installed.
  const candidates = ['SKILL.md', 'skill.md', 'Skill.md'];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  try {
    const md = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.md'));
    if (md) return path.join(dir, md);
  } catch {}
  return null;
}

function _parseSkillFrontmatter(skillMdPath) {
  try {
    const text = fs.readFileSync(skillMdPath, 'utf-8');
    const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

function _copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) _copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

// ---------------------------------------------------------------------------
// Uploaded-skill (workspace_file) install internals
// ---------------------------------------------------------------------------

/** Decide md vs zip: declared package_type → zip magic sniff → filename hint. */
function _resolvePackageType(skill, buffer) {
  const declared = String((skill && (skill.package_type || skill.packageType)) || '').toLowerCase();
  if (declared === 'zip' || declared === 'md') return declared;
  if (Buffer.isBuffer(buffer) && buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return 'zip'; // "PK"
  }
  const fn = String((skill && (skill.filename || skill.file_name)) || '').toLowerCase();
  if (fn.endsWith('.zip')) return 'zip';
  return 'md';
}

/** Only a real SKILL.md counts (uploaded zips must ship one, not just any *.md). */
function _hasSkillMd(dir) {
  for (const c of ['SKILL.md', 'skill.md', 'Skill.md']) {
    if (fs.existsSync(path.join(dir, c))) return true;
  }
  return false;
}

// Path safety for a zip entry name. Mirrors _is_unsafe_zip_name in the backend:
// reject absolute paths, Windows drive paths, and any ".." segment.
function _isUnsafeZipName(name) {
  if (!name) return true;
  if (name.startsWith('/') || name.startsWith('\\')) return true;
  if (/^[A-Za-z]:/.test(name)) return true;
  return name.split(/[\\/]/).some((seg) => seg === '..');
}

function _isSymlinkMode(unixMode) {
  return (unixMode & 0o170000) === 0o120000; // S_IFLNK
}

/**
 * Parse a zip's central directory into entry descriptors. We trust the central
 * directory (not local headers) for sizes/method, and reject zip64 (skills are
 * small). Returns [{name, method, compSize, uncompSize, unixMode, localOffset}].
 */
function _readZipEntries(buf) {
  const EOCD_SIG = 0x06054b50;
  const maxBack = Math.min(buf.length, 22 + 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('invalid zip: end-of-central-directory not found');

  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('zip64 archives are not supported');
  }

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < totalEntries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('invalid zip: corrupt central directory');
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttr = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('zip64 archives are not supported');
    }
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({
      name, method, compSize, uncompSize, localOffset,
      unixMode: (externalAttr >>> 16) & 0xffff,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Read + decompress one entry's bytes (store or deflate only). */
function _zipEntryData(buf, e) {
  if (e.localOffset + 30 > buf.length || buf.readUInt32LE(e.localOffset) !== 0x04034b50) {
    throw new Error(`invalid zip: bad local header for "${e.name}"`);
  }
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const end = start + e.compSize;
  if (end > buf.length) throw new Error(`invalid zip: truncated data for "${e.name}"`);
  const raw = buf.subarray(start, end);
  if (e.method === 0) return Buffer.from(raw);          // stored
  if (e.method === 8) return zlib.inflateRawSync(raw);  // deflate
  throw new Error(`unsupported zip compression method ${e.method} for "${e.name}"`);
}

/**
 * Extract a validated zip Buffer into `outDir`. Enforces entry-count, total-
 * size and compression-ratio caps, rejects unsafe paths / symlinks, and
 * verifies every written path stays inside `outDir`.
 */
function _extractZipToDir(buffer, outDir, log) {
  const entries = _readZipEntries(buffer);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`zip has too many entries (> ${MAX_ZIP_ENTRIES})`);
  }
  let totalUncomp = 0;
  let totalComp = 0;
  for (const e of entries) { totalUncomp += e.uncompSize; totalComp += e.compSize; }
  if (totalUncomp > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new Error('zip expands too large');
  }
  if (totalComp > 0 && totalUncomp / totalComp > MAX_ZIP_COMPRESSION_RATIO) {
    throw new Error('zip compression ratio looks abusive (possible zip bomb)');
  }

  const root = path.resolve(outDir);
  fs.mkdirSync(root, { recursive: true });
  for (const e of entries) {
    if (_isSymlinkMode(e.unixMode)) throw new Error(`zip contains a symlink entry: "${e.name}"`);
    if (_isUnsafeZipName(e.name)) throw new Error(`zip contains an unsafe path: "${e.name}"`);
    const isDir = e.name.endsWith('/');
    const dest = path.resolve(root, e.name.replace(/\\/g, '/'));
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(`zip entry escapes target dir: "${e.name}"`);
    }
    if (isDir) { fs.mkdirSync(dest, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, _zipEntryData(buffer, e));
  }
  if (log) log(`extracted ${entries.length} zip entr${entries.length === 1 ? 'y' : 'ies'}`);
}

/**
 * Install an uploaded `.zip` into `destDir`: extract to a temp dir, verify a
 * SKILL.md is present (stripping a single wrapper directory if needed), then
 * copy the validated tree in. On any failure the temp dir is cleaned up and
 * nothing partial is written into destDir (installSkill emptied it first).
 */
function _installUploadedZip(buffer, destDir, log) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-skillzip-'));
  try {
    _extractZipToDir(buffer, tmp, log);

    // Strip a single top-level wrapper dir (my-skill/SKILL.md → SKILL.md).
    let srcRoot = tmp;
    if (!_hasSkillMd(tmp)) {
      const ents = fs.readdirSync(tmp, { withFileTypes: true });
      const dirs = ents.filter((e) => e.isDirectory());
      const files = ents.filter((e) => !e.isDirectory());
      if (dirs.length === 1 && files.length === 0 && _hasSkillMd(path.join(tmp, dirs[0].name))) {
        srcRoot = path.join(tmp, dirs[0].name);
      }
    }
    if (!_hasSkillMd(srcRoot)) {
      throw new Error('uploaded skill .zip has no SKILL.md');
    }

    fs.mkdirSync(destDir, { recursive: true });
    _copyDir(srcRoot, destDir);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// Blocking GET used only by defaultFetcher's HTTPS fallback (which runs off
// the hot path inside a try/catch). Uses curl for redirect handling; returns
// the body string or throws. git sparse-checkout is the primary strategy, so
// this only matters on hosts that have curl but not git.
function _httpGetSync(url) {
  try {
    const body = execFileSync('curl', ['-fsSL', url], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    return body.toString('utf-8');
  } catch (e) {
    throw new Error(`HTTPS fetch failed for ${url}: ${e && e.message ? e.message : e}`);
  }
}

module.exports = {
  skillsDirForAgentType,
  installSkill,
  installUploadedSkill,
  uninstallSkill,
  listInstalledSkills,
  normalizeSkill,
  defaultFetcher,
};
