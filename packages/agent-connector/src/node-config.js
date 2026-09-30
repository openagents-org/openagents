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

/**
 * The record on disk: null when there is no file, and a throw when there is
 * one that cannot be read or parsed (half-written by another process, or held
 * by an antivirus scan on Windows). Every writer reads through this, so an
 * unreadable file is left alone rather than rebuilt from nothing — which
 * dropped every pairing and minted a new device key.
 */
function readNode() {
  let raw;
  try {
    raw = fs.readFileSync(NODE_FILE, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(raw);
}

/** Lenient read for display and heartbeat: an unreadable file counts as none. */
function loadNode() {
  try { return readNode(); } catch { return null; }
}

/**
 * Written through a temp file and a rename, so a reader in the other process
 * (launcher or daemon) sees the old record or the new one, never a torn one.
 */
function saveNode(data) {
  try {
    fs.mkdirSync(NODE_DIR, { recursive: true });
    const tmp = `${NODE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });  // holds the workspace token
    try {
      fs.renameSync(tmp, NODE_FILE);
    } catch {
      // Windows refuses the rename while another process holds the target.
      try { fs.unlinkSync(tmp); } catch {}
      fs.writeFileSync(NODE_FILE, JSON.stringify(data, null, 2));
    }
    try { fs.chmodSync(NODE_FILE, 0o600); } catch {}
  } catch {}
}

/** Stable per-device id, generated once and persisted. Throws if node.json is unreadable. */
function getOrCreateNodeKey() {
  const existing = readNode();
  if (existing && existing.node_key) return existing.node_key;
  const key = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');
  saveNode({ ...(existing || {}), node_key: key });
  return key;
}

function pairingsOf(record) {
  if (!record) return [];
  if (record.pairings && record.pairings.length) return record.pairings;
  return record.workspace_id ? [record] : [];
}

/**
 * Every workspace this device is paired to, most recent first.
 *
 * All of them are live: the server-side node row is keyed per (workspace,
 * node_key), so one device holds a membership in each workspace it paired with
 * and the daemon heartbeats every one. Records written before `pairings`
 * existed carry a single top-level pairing, which is reconstructed here.
 */
function listPairings() {
  return pairingsOf(loadNode());
}

/**
 * Add a pairing, or refresh it if this workspace is already paired.
 *
 * Additive on purpose: pairing a second workspace must NOT take the device away
 * from the ones it already belongs to (each issues its own node row). The newest
 * pairing is mirrored at the top level, which is what a daemon predating
 * multi-pairing reads. Mirrors the launcher's writer (`node-pairing.ts`).
 */
function recordPairing(nodeKey, pairing) {
  const stamped = { ...pairing, paired_at: new Date().toISOString() };
  const pairings = [
    stamped,
    ...pairingsOf(readNode()).filter((p) => p.workspace_id !== pairing.workspace_id),
  ];
  saveNode({ node_key: nodeKey, ...stamped, pairings });
}

/**
 * Forget one workspace's pairing — that workspace no longer recognizes this node.
 *
 * Keeps `node_key` (so a re-pair reuses the same device id) and drops just the
 * one entry: the server-side node row for THAT workspace is gone and can only
 * be replaced by a fresh code, while every other pairing is still good. The top
 * level is re-pointed at whichever pairing is now first, since that is what a
 * daemon predating multi-pairing reads. Mirrors the launcher's writer
 * (`node-pairing.ts`) so the two stay schema-compatible.
 *
 * @param workspaceId which pairing to drop; defaults to the top-level one.
 * @returns the pairing that was dropped, or null if there was no such pairing.
 */
function clearPairing(workspaceId) {
  const record = readNode();
  if (!record) return null;
  const target = workspaceId || record.workspace_id;
  if (!target) return null;

  const pairings = pairingsOf(record);
  const dropped = pairings.find((p) => p.workspace_id === target);
  if (!dropped) return null;

  const remaining = pairings.filter((p) => p.workspace_id !== target);
  saveNode({ node_key: record.node_key, ...remaining[0], pairings: remaining });
  return {
    node_id: dropped.node_id,
    workspace_id: dropped.workspace_id,
    workspace_slug: dropped.workspace_slug,
    workspace_name: dropped.workspace_name,
    endpoint: dropped.endpoint,
  };
}

/** Best-effort device type from the platform (user/UI can override). */
function inferDeviceType() {
  const p = os.platform();
  if (p === 'darwin') return 'laptop';
  if (p === 'win32') return 'desktop';
  return 'server';  // linux is typically a server/VM in this context
}

/** Device info sent on every heartbeat. Reads and writes nothing on disk. */
function deviceInfo() {
  let launcherVersion = '';
  try { launcherVersion = require('../package.json').version; } catch {}
  return {
    hostname: os.hostname(),
    os: os.platform(),
    deviceType: inferDeviceType(),
    launcherVersion,
  };
}

/** Device info sent on redeem, with the device key (minted on first pairing). */
function gatherDeviceInfo() {
  return { nodeKey: getOrCreateNodeKey(), ...deviceInfo() };
}

module.exports = {
  readNode,
  loadNode,
  saveNode,
  listPairings,
  recordPairing,
  clearPairing,
  getOrCreateNodeKey,
  inferDeviceType,
  deviceInfo,
  gatherDeviceInfo,
  NODE_FILE,
  NODE_DIR,
};
