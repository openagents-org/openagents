'use strict';

/**
 * Where Cursor's Windows launcher keeps the node it runs. Shared by the
 * adapter (to start a turn) and the installer (to ask `cursor-agent status`),
 * so neither goes through cmd.exe and PowerShell.
 */

const fs = require('fs');
const path = require('path');

/** A Cursor version directory: YYYY.MM.DD-commit, or YYYY.MM.DD-HH-MM-SS-commit. */
const CURSOR_VERSION_DIR = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/;

/** The node.exe + index.js pair in one install root (beside it, or its newest version). */
function entryUnder(dir) {
  const pair = (d) => {
    const node = path.join(d, 'node.exe');
    const entry = path.join(d, 'index.js');
    return fs.existsSync(node) && fs.existsSync(entry) ? [node, entry] : null;
  };
  const beside = pair(dir);
  if (beside) return beside;

  let names;
  try { names = fs.readdirSync(path.join(dir, 'versions')); } catch { return null; }
  const day = (name) => {
    const m = name.match(CURSOR_VERSION_DIR);
    return Number(m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0'));
  };
  const newestFirst = names
    .filter((name) => CURSOR_VERSION_DIR.test(name))
    .sort((a, b) => day(b) - day(a) || (a < b ? 1 : -1));
  for (const name of newestFirst) {
    const found = pair(path.join(dir, 'versions', name));
    if (found) return found;
  }
  return null;
}

/**
 * The `node.exe` + `index.js` pair behind Cursor's Windows launcher, or null.
 *
 * The Windows install is not an npm shim. cursor-agent.cmd hands its arguments
 * to PowerShell, and cursor-agent.ps1 runs the node.exe shipped in the newest
 * `versions\<version>` directory (or beside the script) on that directory's
 * index.js. This is the same lookup, so the caller can start node itself.
 *
 * The launcher found on PATH is not always inside the install (a copy or link
 * in ~/.local/bin, say), so the installer's default root,
 * %LOCALAPPDATA%\cursor-agent, is tried next.
 */
function resolveCursorNodeEntry(binPath, env = process.env) {
  const dir = path.dirname(path.resolve(binPath));
  const found = entryUnder(dir);
  if (found) return found;
  const localAppData = env && env.LOCALAPPDATA;
  if (!localAppData) return null;
  const root = path.join(localAppData, 'cursor-agent');
  if (path.resolve(root) === dir) return null;
  return entryUnder(root);
}

module.exports = { resolveCursorNodeEntry, CURSOR_VERSION_DIR };
