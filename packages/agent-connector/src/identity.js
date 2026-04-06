'use strict';

/**
 * Local identity management (~/.openagents/identity.json).
 *
 * Port of Python: sdk/src/openagents/client/workspace_client.py (identity section)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const IDENTITY_DIR = path.join(os.homedir(), '.openagents');
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'identity.json');

function _loadIdentities() {
  try {
    if (fs.existsSync(IDENTITY_FILE)) {
      return JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'));
    }
  } catch {}
  return { agents: {}, user_email: null };
}

function _saveIdentities(data) {
  try {
    fs.mkdirSync(IDENTITY_DIR, { recursive: true });
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(data, null, 2));
    // Restrict permissions (best-effort)
    try { fs.chmodSync(IDENTITY_FILE, 0o600); } catch {}
  } catch {}
}

/**
 * Get the saved identity for an agent type.
 * @returns {{ agentName, agentType, apiKey, createdAt } | null}
 */
function getIdentity(agentType) {
  const data = _loadIdentities();
  const entry = (data.agents || {})[agentType];
  if (entry) {
    return {
      agentName: entry.agent_name,
      agentType,
      apiKey: entry.api_key || null,
      createdAt: entry.created_at || null,
    };
  }
  return null;
}

/**
 * Save an agent identity to local storage.
 */
function saveIdentity({ agentName, agentType, apiKey, createdAt }) {
  const data = _loadIdentities();
  if (!data.agents) data.agents = {};
  data.agents[agentType] = {
    agent_name: agentName,
    api_key: apiKey || null,
    created_at: createdAt || new Date().toISOString(),
  };
  _saveIdentities(data);
}

/**
 * Get the logged-in user email.
 */
function getUserEmail() {
  return _loadIdentities().user_email || null;
}

/**
 * Set the logged-in user email.
 */
function setUserEmail(email) {
  const data = _loadIdentities();
  data.user_email = email;
  _saveIdentities(data);
}

/**
 * Clear the logged-in user email (logout).
 */
function clearUserEmail() {
  const data = _loadIdentities();
  data.user_email = null;
  _saveIdentities(data);
}

/**
 * Generate an auto-name: {type}-{context}-{4hex} or {type}-{4hex}.
 */
function generateAgentName(agentType, context) {
  const suffix = crypto.randomBytes(2).toString('hex');
  if (context) {
    const ctx = context.toLowerCase().replace(/\s+/g, '-').slice(0, 20);
    return `${agentType}-${ctx}-${suffix}`;
  }
  return `${agentType}-${suffix}`;
}

module.exports = {
  getIdentity,
  saveIdentity,
  getUserEmail,
  setUserEmail,
  clearUserEmail,
  generateAgentName,
  IDENTITY_DIR,
  IDENTITY_FILE,
};
