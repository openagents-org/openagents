'use strict';

/**
 * Stop Windows from popping a console window for every child process we spawn.
 *
 * Neither process that runs this code owns a console: the daemon is spawned
 * DETACHED (`agn up --foreground`), and the launcher's Electron main process is
 * a GUI app. On Windows, when a console-less process launches a console
 * executable *without* CREATE_NO_WINDOW, the OS allocates a brand-new console
 * for the child — an empty black cmd/Windows-Terminal window that pops to the
 * foreground and steals focus. With stdio piped nothing is ever drawn in it,
 * so what the user sees is a blank window appearing out of nowhere.
 *
 * That is the "命令框 keeps popping up" report: `_refreshRuntimes()` shells out
 * to `agn runtimes --json` every two minutes, and the probe it runs keeps the
 * window on screen for as long as it takes to check every installed CLI.
 *
 * Node exposes CREATE_NO_WINDOW as the `windowsHide` spawn option and most call
 * sites pass it — but there are ~60 of them across the adapters and a single
 * miss brings the window back. So the default lives here, applied once at the
 * process entry points (src/index.js, src/cli.js) before any module has
 * captured a reference to child_process.
 *
 * Two things this deliberately does NOT do:
 *   - override an explicit `windowsHide: false` — the launcher opens a real
 *     terminal for CLI sign-in that way, and that window is the point; and
 *   - break interactive output: libuv only applies CREATE_NO_WINDOW when no
 *     stdio handle is inherited, so `agn` run from a terminal (stdio 'inherit')
 *     is unaffected by this and still prints where the user can see it.
 *
 * The same entry points also pin ComSpec to cmd.exe — see pinComSpec() below.
 */

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const PATCHED = Symbol.for('openagents.windowsHideDefault');
const WRAPPED = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'];

// Node's own test for "the shell is cmd.exe" (normalizeSpawnArguments in
// lib/child_process.js). A shell that fails it is handed `-c <command>` rather
// than `/d /s /c "<command>"`.
const CMD_EXE = /^(?:.*\\)?cmd(?:\.exe)?$/i;

/**
 * Return a copy of `args` whose options object carries `windowsHide: true`.
 *
 * Every child_process signature ends with `[options][, callback]`, so the
 * options object — if there is one — is the last non-function argument. The
 * caller's object is copied rather than mutated: callers reuse option objects
 * and must not see ours leak into their state.
 */
function withWindowsHide(args) {
  const out = args.slice();
  const cbIdx = typeof out[out.length - 1] === 'function' ? out.length - 1 : -1;
  const optIdx = cbIdx === -1 ? out.length - 1 : cbIdx - 1;
  const opts = optIdx >= 0 ? out[optIdx] : undefined;

  if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
    if ('windowsHide' in opts) return args;  // explicit wins, either way
    out[optIdx] = { ...opts, windowsHide: true };
    return out;
  }
  // No options argument at all — insert one ahead of any callback.
  out.splice(cbIdx === -1 ? out.length : cbIdx, 0, { windowsHide: true });
  return out;
}

/**
 * Default `windowsHide: true` for this process's child_process calls.
 * No-op off Windows, and idempotent.
 */
function installWindowsHideDefault() {
  if (process.platform !== 'win32') return;
  if (childProcess[PATCHED]) return;

  for (const name of WRAPPED) {
    const original = childProcess[name];
    if (typeof original !== 'function') continue;
    const wrapper = function (...args) {
      return original.apply(this, withWindowsHide(args));
    };
    // Keep util.promisify(exec) and friends working.
    for (const sym of Object.getOwnPropertySymbols(original)) {
      wrapper[sym] = original[sym];
    }
    Object.defineProperty(wrapper, 'name', { value: name });
    childProcess[name] = wrapper;
  }
  childProcess[PATCHED] = true;
}

/**
 * Point ComSpec at the real cmd.exe, in `env` (default: this process).
 *
 * ComSpec is what Windows runs a batch file with: starting `codebuddy.cmd`
 * really starts `%ComSpec% /c "codebuddy.cmd" …`. It is also the shell Node
 * picks for every `shell: true` spawn and every exec/execSync. Everything we
 * hand that shell is cmd syntax, and every npm-installed agent CLI is a .cmd
 * shim, so both uses assume cmd.exe.
 *
 * Some machines point ComSpec at PowerShell, and then both go wrong at once:
 *   - A .cmd never gets to run. The codebuddy probe became
 *     `pwsh -c …\codebuddy.cmd -p hi`; pwsh ran the .cmd, Windows started that
 *     as `pwsh /c "…\codebuddy.cmd" -p hi`, which ran the .cmd again — each
 *     pwsh the child of the last, with no end, still growing long after the
 *     probe gave up (seen: 1,048 pwsh processes and 99% memory).
 *   - `where` is Where-Object in PowerShell, so every PATH lookup comes back
 *     empty and CLIs that are installed read as "not installed".
 *
 * Set on process.env, the fix reaches Node's shell choice in this process and
 * every child we spawn, which inherits it. Only a value that fails Node's
 * cmd.exe test is replaced; a missing one is filled in (Electron may not set
 * it). The key keeps whatever casing it already has, because a copied env is a
 * plain object and a "ComSpec" beside a "COMSPEC" leaves the child to pick one.
 * Platform and existence check are injectable so the Windows branch is testable
 * anywhere. Returns true when it changed `env`.
 */
function pinComSpec(env = process.env, platform = process.platform, exists = fs.existsSync) {
  if (platform !== 'win32' || !env) return false;
  const keyOf = (lower) => Object.keys(env).find((k) => k.toLowerCase() === lower);
  const key = keyOf('comspec') || 'ComSpec';
  if (CMD_EXE.test(env[key] || '')) return false;
  const rootKey = keyOf('systemroot') || keyOf('windir');
  const cmdExe = path.win32.join((rootKey && env[rootKey]) || 'C:\\Windows', 'System32', 'cmd.exe');
  let found = false;
  try { found = exists(cmdExe); } catch {}
  // Bare `cmd.exe` when System32 isn't where we looked: PATH still finds it,
  // and it passes the same test.
  env[key] = found ? cmdExe : 'cmd.exe';
  return true;
}

module.exports = { installWindowsHideDefault, withWindowsHide, pinComSpec };
