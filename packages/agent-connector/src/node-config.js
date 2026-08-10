'use strict';

/**
 * Node identity for "connect a node" (~/.openagents/node.json).
 *
 * A node is this device's registration with a workspace, independent of any
 * agent. Stores the stable device key, the assigned node id, and the workspace
 * binding + token so the daemon can heartbeat the node.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const NODE_DIR = path.join(os.homedir(), '.openagents');
const NODE_FILE = path.join(NODE_DIR, 'node.json');

function loadNode() {
  try {
    if (fs.existsSync(NODE_FILE)) return JSON.parse(fs.readFileSync(NODE_FILE, 'utf-8'));
  } catch {}
  return null;
}

function saveNode(data) {
  try {
    fs.mkdirSync(NODE_DIR, { recursive: true });
    fs.writeFileSync(NODE_FILE, JSON.stringify(data, null, 2));
    try { fs.chmodSync(NODE_FILE, 0o600); } catch {}  // holds the workspace token
  } catch {}
}

/** Stable per-device id, generated once and persisted. */
function getOrCreateNodeKey() {
  const existing = loadNode();
  if (existing && existing.node_key) return existing.node_key;
  const key = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');
  saveNode({ ...(existing || {}), node_key: key });
  return key;
}

/** Best-effort device type from the platform (user/UI can override). */
function inferDeviceType() {
  const p = os.platform();
  if (p === 'darwin') return 'laptop';
  if (p === 'win32') return 'desktop';
  return 'server';  // linux is typically a server/VM in this context
}

/** Device info sent on redeem/heartbeat. */
function gatherDeviceInfo() {
  let launcherVersion = '';
  try { launcherVersion = require('../package.json').version; } catch {}
  return {
    nodeKey: getOrCreateNodeKey(),
    hostname: os.hostname(),
    os: os.platform(),
    deviceType: inferDeviceType(),
    launcherVersion,
  };
}

module.exports = {
  loadNode,
  saveNode,
  getOrCreateNodeKey,
  inferDeviceType,
  gatherDeviceInfo,
  NODE_FILE,
  NODE_DIR,
};
