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
 */

const childProcess = require('child_process');

const PATCHED = Symbol.for('openagents.windowsHideDefault');
const WRAPPED = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'];

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

module.exports = { installWindowsHideDefault, withWindowsHide };
