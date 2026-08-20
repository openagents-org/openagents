/**
 * Detecting an agent installer that has taken over the machine's `node`.
 *
 * Hermes's install.sh, when it decides the system Node is too old, downloads
 * its own and then does this:
 *
 *   ln -sf "$HERMES_HOME/node/bin/node" "$HOME/.local/bin/node"
 *   ln -sf "$HERMES_HOME/node/bin/npm"  "$HOME/.local/bin/npm"
 *   ln -sf "$HERMES_HOME/node/bin/npx"  "$HOME/.local/bin/npx"
 *
 * `ln -sf` overwrites. On a machine where ~/.local/bin comes before nvm or
 * Homebrew on PATH — a very common layout — the user's default `node` silently
 * becomes the agent's, for every shell and every unrelated project, and npm's
 * global prefix is rewritten to ~/.local along with it. Nothing announces this,
 * and nothing connects a project that suddenly builds differently back to
 * having installed an agent.
 *
 * This module only looks and reports. Rewriting a user's PATH or deleting their
 * symlinks would be a second uninvited change on top of the first, and the
 * agent's Node may be exactly what they want. Telling them precisely what
 * happened, and how to undo it, is the part that was missing.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * node/npm/npx under `linkDir` that are symlinks into `ownerDir`, together with
 * whether they shadow another installation the user already had.
 *
 * @param {object} [deps] - seams for tests; production passes nothing.
 * @returns {{ shims: Array<{name: string, link: string, target: string}>, shadowed: string|null }}
 */
function detectShadowedNodeShims(deps = {}) {
  const home = deps.home || os.homedir();
  const linkDir = deps.linkDir || path.join(home, '.local', 'bin');
  const ownerDir = deps.ownerDir || path.join(home, '.hermes', 'node', 'bin');
  const readLink = deps.readLink || defaultReadLink;
  const exists = deps.exists || ((p) => fs.existsSync(p));
  const entries = deps.pathEntries || (process.env.PATH || '').split(path.delimiter);

  const shims = [];
  for (const name of ['node', 'npm', 'npx']) {
    const link = path.join(linkDir, name);
    const target = readLink(link);
    if (!target) continue;
    const resolved = path.resolve(linkDir, target);
    if (resolved === path.join(ownerDir, name) || resolved.startsWith(ownerDir + path.sep)) {
      shims.push({ name, link, target: resolved });
    }
  }
  if (shims.length === 0) return { shims: [], shadowed: null };

  // Only a problem if the user HAD another node. On a machine with none, these
  // symlinks are the installer doing something useful.
  const normalized = entries.map((d) => d.trim()).filter(Boolean);
  const linkIndex = normalized.indexOf(linkDir);
  const after = linkIndex === -1 ? normalized : normalized.slice(linkIndex + 1);
  for (const dir of after) {
    if (dir === linkDir) continue;
    const candidate = path.join(dir, 'node');
    try {
      if (exists(candidate)) return { shims, shadowed: candidate };
    } catch {
      /* unreadable dir on PATH — skip */
    }
  }
  return { shims, shadowed: null };
}

/** lstat + readlink, or null when the path is absent or not a symlink. */
function defaultReadLink(p) {
  try {
    if (!fs.lstatSync(p).isSymbolicLink()) return null;
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
}

/**
 * The warning text, or null when there is nothing worth saying. Written to be
 * read in an install log by someone who did not expect any of this.
 */
function shadowedNodeWarning(agentLabel, detection) {
  if (!detection || detection.shims.length === 0 || !detection.shadowed) return null;
  const names = detection.shims.map((s) => s.name).join(', ');
  const dir = path.dirname(detection.shims[0].link);
  return [
    '',
    `Note: the ${agentLabel} installer replaced ${names} in ${dir} with links to its own Node.`,
    `That now takes precedence over ${detection.shadowed} for every shell on this machine,`,
    'so other projects will build with the agent\'s Node version from here on.',
    '',
    'To put your own Node back, remove the links (this does not affect the agent):',
    `  rm -f ${detection.shims.map((s) => s.link).join(' ')}`,
  ].join('\n');
}

module.exports = { detectShadowedNodeShims, shadowedNodeWarning };
