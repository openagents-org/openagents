'use strict';

/**
 * Telling an agent's CLI apart from another program of the same name.
 *
 * Some agents ship a binary whose name is already taken: Step Code's `step` is
 * also Smallstep's certificate CLI, which a PATH lookup can find first. An
 * agent opts in with `install.identify` in its registry entry:
 *
 *   "identify": {
 *     "install_dirs": ["$STEP_INSTALL_DIR", "~/.stepcode/bin"],
 *     "version_pattern": "^v?\\d+\\.\\d+\\.\\d+$"
 *   }
 *
 *   install_dirs     where the agent's own installer puts the binary. A copy
 *                    there is the agent's and wins over anything on PATH.
 *                    `~` is the home dir; `$VAR` (or `${VAR}`) a variable,
 *                    and an entry whose variable is unset is skipped.
 *   version_pattern  what `<binary> --version` prints, trimmed. A binary found
 *                    anywhere else is only the agent's when it answers this.
 *
 * Installer detection (`Installer._whichBinary`) and the agent's adapter both
 * read the same entry through these helpers, so "is this the agent's CLI" has
 * one answer. Agents without `identify` are resolved exactly as before.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/** The entry's `install.identify` block, or null when the agent did not opt in. */
function identityOf(entry) {
  const id = entry && entry.install && entry.install.identify;
  return id && typeof id === 'object' && !Array.isArray(id) ? id : null;
}

/** One `install_dirs` spec as an absolute dir, or null (blank, or an unset variable). */
function expandDir(spec, env = process.env, home = os.homedir()) {
  let s = String(spec == null ? '' : spec).trim();
  if (!s) return null;
  const v = s.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?(.*)$/);
  if (v) {
    const value = String((env && env[v[1]]) || '').trim();
    if (!value) return null;
    s = value + v[2];
  }
  if (s === '~') s = home;
  else if (s.startsWith('~/') || s.startsWith('~\\')) s = path.join(home, s.slice(2));
  return path.resolve(s);
}

/** The agent's own install dirs, in the entry's order, without duplicates. */
function ownInstallDirs(identify, { env = process.env, home = os.homedir() } = {}) {
  const out = [];
  for (const spec of (identify && Array.isArray(identify.install_dirs)) ? identify.install_dirs : []) {
    const dir = expandDir(spec, env, home);
    if (dir && !out.includes(dir)) out.push(dir);
  }
  return out;
}

/**
 * The binary in one of the agent's own install dirs, or null. On Windows the
 * installers drop an .exe; a .cmd and the bare name are tried after it.
 */
function findOwnInstall(identify, binary, {
  env = process.env,
  home = os.homedir(),
  platform = process.platform,
  isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
} = {}) {
  if (!identify || !binary) return null;
  const names = platform === 'win32' ? [`${binary}.exe`, `${binary}.cmd`, binary] : [binary];
  for (const dir of ownInstallDirs(identify, { env, home })) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Whether `--version` output answers like the agent: true / false, or null
 * when the entry declares no pattern (nothing to check) or the output is empty
 * (the binary could not be run — not evidence either way).
 */
function versionOutputMatches(identify, output) {
  if (!identify || typeof identify.version_pattern !== 'string' || !identify.version_pattern) return null;
  const text = String(output == null ? '' : output).trim();
  if (!text) return null;
  let re;
  try { re = new RegExp(identify.version_pattern); } catch { return null; }
  return re.test(text);
}

/** `<bin> --version`, stdout or (on a failing exit) whatever it printed. */
function readVersionOutput(bin, { env, timeoutMs = 15000 } = {}) {
  try {
    return execFileSync(bin, ['--version'], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });
  } catch (e) {
    return e && (e.stdout || e.stderr) ? String(e.stdout || e.stderr) : '';
  }
}

// bin → { key: "<mtime>:<size>", ok } — the answer holds until the file changes.
const verdicts = new Map();

/**
 * Whether the binary at `bin` is the agent's: true / false, or null when it
 * could not be told (no pattern, or the binary would not run). Cached per
 * file, since a version check can take a second or more.
 */
function verifyBinary(identify, bin, { env, run = readVersionOutput } = {}) {
  if (!identify || !identify.version_pattern) return null;
  let key;
  try {
    const st = fs.statSync(bin);
    key = `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
  const cached = verdicts.get(bin);
  if (cached && cached.key === key) return cached.ok;
  const ok = versionOutputMatches(identify, run(bin, { env }));
  if (ok !== null) verdicts.set(bin, { key, ok });
  return ok;
}

function clearIdentityCache() {
  verdicts.clear();
}

module.exports = {
  identityOf,
  expandDir,
  ownInstallDirs,
  findOwnInstall,
  versionOutputMatches,
  readVersionOutput,
  verifyBinary,
  clearIdentityCache,
};
