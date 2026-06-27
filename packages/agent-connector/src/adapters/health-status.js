'use strict';

/**
 * Single source of truth for agent readiness / runtime-failure classification.
 *
 * The Install page, the Agents list, the daemon and the TUI must all speak the
 * same vocabulary about WHY an agent is or isn't usable. Mixing "not installed"
 * (a genuinely missing executable) with "installed but signed out" or "spawn
 * failed" is exactly the bug this module exists to prevent.
 *
 * Hard rule: REASON.NOT_INSTALLED is ONLY for a binary that cannot be resolved
 * at all. An installed-but-signed-out agent is REASON.LOGIN_REQUIRED. A binary
 * that resolved at install time but fails to start at run time is
 * REASON.RUNTIME_MISSING / REASON.SPAWN_FAILED — never NOT_INSTALLED.
 *
 * Everything here is pure and dependency-free so it can be required from the
 * daemon, the adapters AND the Electron launcher (via
 * `@openagents-org/agent-launcher/src/adapters/health-status`).
 */

const REASON = {
  READY: 'ready',
  NOT_INSTALLED: 'not_installed', // executable cannot be resolved anywhere
  LOGIN_REQUIRED: 'login_required', // installed, but no usable login / API key
  VERSION_INCOMPATIBLE: 'version_incompatible',
  RUNTIME_MISSING: 'runtime_missing', // resolved at install time, gone at run time
  SPAWN_FAILED: 'spawn_failed', // child_process spawn errored (ENOENT/EACCES/…)
  WORKSPACE_JOIN_FAILED: 'workspace_join_failed',
  HEARTBEAT_FAILED: 'heartbeat_failed',
  SESSION_REVOKED: 'session_revoked',
  ADAPTER_CRASHED: 'adapter_crashed',
};

// Reasons that represent a genuine failure the UI should surface as an error
// (red dot / X) rather than a benign "needs configuration" state.
const ERROR_REASONS = new Set([
  REASON.RUNTIME_MISSING,
  REASON.SPAWN_FAILED,
  REASON.WORKSPACE_JOIN_FAILED,
  REASON.HEARTBEAT_FAILED,
  REASON.SESSION_REVOKED,
  REASON.ADAPTER_CRASHED,
]);

/** True when a reason should render as a hard error (daemon state 'error'). */
function isErrorReason(reason) {
  return ERROR_REASONS.has(reason);
}

/**
 * Readiness reason from an (installed, ready) pair. The ONLY place that decides
 * "not_installed vs login_required", so the Install page and the Agents list
 * can never disagree.
 */
function readinessReason(installed, ready) {
  if (!installed) return REASON.NOT_INSTALLED;
  return ready ? REASON.READY : REASON.LOGIN_REQUIRED;
}

/**
 * Whether a resolved binary path must be launched through a shell. On Windows,
 * `.cmd`/`.bat` shims (npm/pnpm/yarn global bins, and amp.cmd) are NOT directly
 * executable via CreateProcess — Node's spawn needs shell:true or it throws
 * EINVAL/ENOENT. Mirrors the amp adapter's own _spawnAmp handling so the
 * launcher probe, the Test-connection path and the daemon all behave the same.
 */
function shouldUseShellForBinary(bin, platform) {
  const plat = platform || process.platform;
  return plat === 'win32' && /\.(cmd|bat)$/i.test(String(bin || ''));
}

/**
 * Strip secrets from a diagnostic string before it reaches a log, the daemon
 * status file or the UI. Removes tokens / api keys / bearer headers / cookies /
 * URL credentials / long opaque tokens, and caps the length. Never throws.
 */
function redactDiagnostic(input, maxLen = 300) {
  let s = String(input == null ? '' : input);
  try {
    s = s
      // key=value / key: value for sensitive keys (token, api_key, secret, …)
      .replace(
        /((?:access[_-]?|api[_-]?|auth[_-]?)?(?:tokens?|keys?|secrets?|passwords?|cookies?)\s*[=:]\s*)(\S+)/gi,
        '$1<redacted>',
      )
      // Authorization: Bearer xxxxx
      .replace(/(bearer\s+)[A-Za-z0-9._\-]+/gi, '$1<redacted>')
      // URL userinfo  scheme://user:pass@host
      .replace(/(\b[a-z][a-z0-9+.\-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1<redacted>@')
      // Known opaque token prefixes
      .replace(/\b(?:sgp_|sk-|ghp_|gho_|xox[baprs]-)[A-Za-z0-9._\-]+/g, '<redacted>')
      // Generic long opaque blobs (>= 40 chars)
      .replace(/\b[A-Za-z0-9_\-]{40,}\b/g, '<redacted>');
  } catch {
    /* keep best-effort */
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
  return s;
}

/** Pull a numeric HTTP status off a workspace-client error, if present. */
function httpStatusOf(err) {
  if (!err) return null;
  const sc = err.statusCode != null ? err.statusCode : err.status;
  return typeof sc === 'number' ? sc : null;
}

/** Classify a workspace JOIN failure → { reason, message } (redacted). */
function classifyJoinError(err) {
  const sc = httpStatusOf(err);
  let detail;
  if (sc === 401 || sc === 403) detail = `authentication rejected (HTTP ${sc})`;
  else if (sc === 404) detail = 'workspace not found (HTTP 404)';
  else if (typeof sc === 'number') detail = `HTTP ${sc}`;
  else detail = redactDiagnostic(err && err.message) || 'network error';
  return {
    reason: REASON.WORKSPACE_JOIN_FAILED,
    message: `Workspace join failed: ${detail}`,
  };
}

/** Classify a workspace HEARTBEAT failure → { reason, message } (redacted). */
function classifyHeartbeatError(err) {
  const sc = httpStatusOf(err);
  const detail =
    typeof sc === 'number'
      ? `HTTP ${sc}`
      : redactDiagnostic(err && err.message) || 'network error';
  return {
    reason: REASON.HEARTBEAT_FAILED,
    message: `Workspace heartbeat failed: ${detail}`,
  };
}

/**
 * Classify a child_process spawn failure (the CLI could not be started) →
 * { reason, message } (redacted). `label` names the agent ("Amp"), `bin` is the
 * resolved path included for diagnostics (it is a filesystem path, not a secret).
 */
function classifySpawnError(err, opts) {
  const { label = 'Agent', bin = null } = opts || {};
  const code = (err && (err.code || err.errno)) || '';
  const where = bin ? ` [${bin}]` : '';
  let detail;
  if (code === 'ENOENT') detail = `executable not found${where}`;
  else if (code === 'EACCES' || code === 'EPERM')
    detail = `permission denied${where}`;
  else detail = (redactDiagnostic((err && err.message) || code) || 'spawn error') + where;
  return {
    reason: REASON.SPAWN_FAILED,
    message: `${label} process failed to start: ${detail}`,
  };
}

module.exports = {
  REASON,
  isErrorReason,
  readinessReason,
  shouldUseShellForBinary,
  redactDiagnostic,
  httpStatusOf,
  classifyJoinError,
  classifyHeartbeatError,
  classifySpawnError,
};
