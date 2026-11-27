'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Existing adapter maps live under the OS home even on installations that set
// OPENAGENTS_HOME for the picker. Keep reading both when the paths differ.
function openAgentsHomes(env = process.env) {
  const standard = path.join(os.homedir(), '.openagents');
  const configured = env.OPENAGENTS_HOME && path.resolve(env.OPENAGENTS_HOME);
  return configured && path.relative(standard, configured) ? [configured, standard] : [standard];
}

function historyFile(home, type) {
  return path.join(home, 'sessions', `workspace-${type}.ids`);
}

function readHistory(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; }
}

const recorded = new Map();

// Several adapter processes can discover IDs at once. Append only new IDs,
// without rewriting another process's history when a channel resets or forks.
function rememberWorkspaceSessions(type, ids) {
  const file = historyFile(openAgentsHomes()[0], type);
  try {
    if (!recorded.has(file)) recorded.set(file, new Set(readHistory(file)));
    const known = recorded.get(file);
    const added = [...new Set(ids)].filter((id) => typeof id === 'string' && /^[\w.:-]+$/.test(id) && !known.has(id));
    if (!added.length) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, added.join('\n') + '\n', { mode: 0o600 });
    for (const id of added) known.add(id);
  } catch { /* session tracking must not interrupt an agent turn */ }
}

function entries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function addMappedIds(dir, names, ids) {
  for (const entry of entries(dir)) {
    if (!entry.isFile() || !names.test(entry.name)) continue;
    try {
      const map = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
      for (const id of Object.values(map)) if (typeof id === 'string') ids.add(id);
    } catch { /* a stale or partially written map */ }
  }
}

function workspaceSessionIds(type, env) {
  const ids = new Set();
  for (const home of openAgentsHomes(env)) {
    for (const id of readHistory(historyFile(home, type))) ids.add(id);
    const sessions = path.join(home, 'sessions');
    addMappedIds(sessions, /\.json$/, ids);
    if (type === 'codex') {
      // Copies made before adapters started remembering every workspace ID.
      try {
        const copies = JSON.parse(fs.readFileSync(path.join(sessions, 'import-copies.json'), 'utf8'));
        if (Array.isArray(copies)) for (const id of copies) ids.add(id);
      } catch { /* no previous imports */ }
    }
    if (type === 'opencode') {
      const agents = path.join(home, 'agents');
      for (const agent of entries(agents)) {
        if (agent.isDirectory()) addMappedIds(path.join(agents, agent.name), /^sessions(?:-[0-9a-f]{16})?\.json$/, ids);
      }
    }
  }
  return ids;
}

module.exports = { openAgentsHomes, rememberWorkspaceSessions, workspaceSessionIds };
