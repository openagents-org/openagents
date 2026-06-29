'use strict';

/**
 * Pure, content-free helpers that turn an agent's registry `check_ready` plus a
 * health-check result into human-readable authentication guidance.
 *
 * Used by the connector TUI (`showConfigureScreen`) and CLI (`agn env`) so an
 * agent whose sign-in is an OAuth/credential FILE (e.g. Gemini's
 * ~/.gemini/oauth_creds.json) is guided to authenticate instead of being
 * mislabeled "No configuration required for this agent type".
 *
 * These helpers NEVER read, parse, copy, or print credential CONTENTS. They use
 * only the agent's DECLARED metadata — the login command and env-var NAMES from
 * `check_ready`, and the already-computed (non-sensitive) `message` / status
 * fields the installer's health check returns. No token, key, email, or file
 * path is ever emitted.
 */

/**
 * True when an agent declares any credential / sign-in capability in
 * `check_ready` — an OAuth/credential file, API-key env vars, a service-account
 * path env, or a login command. This is the OPT-IN gate: agents WITHOUT any of
 * these are left exactly as before (the caller keeps showing "No configuration
 * required"), so other agents are never polluted by Gemini's guidance.
 *
 * @param {object|null|undefined} checkReady
 * @returns {boolean}
 */
function hasCredentialMetadata(checkReady) {
  if (!checkReady || typeof checkReady !== 'object') return false;
  return !!(
    checkReady.creds_file ||
    (Array.isArray(checkReady.env_vars) && checkReady.env_vars.length) ||
    (Array.isArray(checkReady.creds_path_env) && checkReady.creds_path_env.length) ||
    checkReady.login_command
  );
}

/**
 * A short, NON-sensitive label for a ready auth_mode. Registry-overridable via
 * `check_ready.auth_detected_labels` (e.g. Gemini maps cli_login → "Google
 * account sign-in detected"). Falls back to a generic, agent-agnostic phrase so
 * any future credential-file agent reads sensibly without extra config.
 *
 * @param {object} checkReady
 * @param {string|null|undefined} authMode  'cli_login' | 'api_key' | other
 * @returns {string}
 */
function readyLabel(checkReady, authMode) {
  const labels = (checkReady && checkReady.auth_detected_labels) || {};
  if (authMode === 'cli_login') return labels.cli_login || 'CLI sign-in detected';
  if (authMode === 'api_key') return labels.api_key || 'API key detected';
  return labels[authMode] || 'authenticated';
}

/**
 * Build display lines (plain text, no markup, no secrets) describing an agent's
 * authentication state and the concrete next step. The caller is responsible
 * for any terminal styling.
 *
 * @param {object} entry   Registry catalog entry (has .label/.name/.check_ready)
 * @param {object|null} health  Result of installer.healthCheck(type)
 * @returns {{ ready: boolean, status: string, lines: string[] }}
 */
function formatAuthGuidance(entry, health) {
  const checkReady = (entry && entry.check_ready) || {};
  const label = (entry && (entry.label || entry.name)) || 'This agent';
  const h = health || {};
  const lines = [];

  if (h.installed === false) {
    lines.push(`${label} is not installed yet.`);
    return { ready: false, status: 'not_installed', lines };
  }

  if (h.ready) {
    lines.push(`Ready — ${readyLabel(checkReady, h.auth_mode)}.`);
    return { ready: true, status: h.auth_status || 'ready', lines };
  }

  // Not ready: lead with the registry's own (non-sensitive) reason, then the
  // concrete next steps derived from the DECLARED login command + env-var names.
  if (h.message) lines.push(h.message);
  const loginCmd = checkReady.login_command;
  if (loginCmd) {
    lines.push(
      `Run \`${loginCmd}\` in your terminal and complete sign-in, then return here and refresh the agent status.`,
    );
  }
  const envVars = Array.isArray(checkReady.env_vars) ? checkReady.env_vars : [];
  if (envVars.length) {
    lines.push(`Alternatively, configure ${envVars.join(' or ')}.`);
  }
  if (!lines.length) lines.push(`${label} requires authentication before use.`);
  return { ready: false, status: h.auth_status || 'no_credentials', lines };
}

module.exports = { hasCredentialMetadata, readyLabel, formatAuthGuidance };
