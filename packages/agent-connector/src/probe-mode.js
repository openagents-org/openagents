/**
 * Whether this process may wait on a probe.
 *
 * The core runs in two kinds of process. The daemon and the CLI are plain Node
 * processes: a synchronous `wsl.exe`, `npm config get prefix` or `<cli>
 * --version` only delays the caller. The desktop app loads the same modules
 * into Electron's MAIN process, whose thread also pumps the window's messages —
 * while it waits on a probe the window cannot paint or take input, and Windows
 * marks it "Not Responding". The app polls agent detection every few seconds,
 * so those waits add up to a window that is frozen more often than not.
 *
 * There, a probe that would spawn a process or touch a network share answers
 * from its cache — possibly empty, possibly stale — and refreshes in the
 * background. Everywhere else it keeps the synchronous behaviour, because a
 * daemon about to spawn an agent needs the real answer, not a cached guess.
 */

'use strict';

let override = null;

/** True when a probe may block this thread until it has an answer. */
function canBlock() {
  if (override !== null) return override;
  return !(process.versions && process.versions.electron && process.type === 'browser');
}

/**
 * Force the mode, for tests. `null` restores detection.
 * @param {boolean|null} value
 */
function setBlockingProbes(value) {
  override = value === null || value === undefined ? null : !!value;
}

module.exports = { canBlock, setBlockingProbes };
