'use strict';

/**
 * Local sessions imported into a workspace thread, waiting for the agent that
 * owns the thread to continue them (src/local-sessions.js reads them; the
 * daemon's import_local_session command records them here).
 *
 *   ~/.openagents/sessions/imports_<agentName>.json
 *   { "<channel>": { type, session_id, file, at } }
 *
 * Keyed by agent alone: imported threads have random names (channel-<8 hex>),
 * and the daemon knows a workspace by id while an adapter may know it by
 * slug, so a workspace part in the name could miss.
 *
 * An adapter asks for a channel's import only while that channel has no
 * session of its own, so the entry matters exactly once: on the first turn,
 * when the agent picks the session up from a copy. The user's own session
 * files are never written to.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// eslint-disable-next-line no-unused-vars
function importsFile(workspaceId, agentName) {
  const safe = (v) => String(v || '').replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(os.homedir(), '.openagents', 'sessions', `imports_${safe(agentName)}.json`);
}

function readAll(workspaceId, agentName) {
  try {
    const data = JSON.parse(fs.readFileSync(importsFile(workspaceId, agentName), 'utf-8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

/** Remember that `channel` continues the local session `entry` ({type, session_id, file}). */
function recordImport(workspaceId, agentName, channel, entry) {
  const file = importsFile(workspaceId, agentName);
  const all = readAll(workspaceId, agentName);
  all[channel] = { type: entry.type, session_id: entry.session_id, file: entry.file || null, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
}

/** The local session `channel` continues, or null. Read from disk each time:
 *  imports arrive while the adapter runs, after it loaded its own sessions. */
function pendingImport(workspaceId, agentName, channel, type) {
  const entry = readAll(workspaceId, agentName)[channel];
  if (!entry || !entry.session_id || (type && entry.type !== type)) return null;
  return entry;
}

module.exports = { importsFile, recordImport, pendingImport };
