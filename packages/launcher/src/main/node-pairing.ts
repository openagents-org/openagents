import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"

/**
 * Node identity for "connect this device to a workspace" (~/.openagents/node.json).
 *
 * A node is this DEVICE's registration with a workspace, independent of any
 * agent: the workspace lists it under Connect Agent → Nodes and can install,
 * configure and run agents on it remotely. Pairing is a one-shot redeem of a
 * short-lived code (POST /v1/nodes/redeem) that hands back the workspace token.
 *
 * The file format is shared with the core's `src/node-config.js` — the daemon
 * re-reads it on every node heartbeat (10s) to know who it is. It is written
 * here rather than through the core because that module is internal to the core
 * package and is not on its public export surface.
 */

// Resolved per call, never captured at import time: a module-level constant
// binds one home directory forever, which is wrong for tests (they redirect
// HOME to a temp dir) and for any future data-dir override.
function nodeDir(): string {
  return path.join(os.homedir(), ".openagents")
}

/** Absolute path of this device's node identity file. */
export function nodeFilePath(): string {
  return path.join(nodeDir(), "node.json")
}

/** One workspace this device has been paired with. */
export interface NodePairing {
  node_id?: string
  workspace_id?: string
  workspace_slug?: string
  workspace_name?: string
  endpoint?: string
  token?: string
  paired_at?: string
}

export interface NodeRecord extends NodePairing {
  /** Stable per-device id. Generated once, survives re-pairing. */
  node_key?: string
  /**
   * Every workspace this device has redeemed a code for, newest first.
   *
   * The daemon heartbeats only the record's top-level (active) pairing — the
   * server-side Node row is per (workspace, device), so a workspace whose
   * pairing has been superseded goes offline there. Keeping the history is what
   * lets the UI say "this device moved to <other workspace>" instead of
   * showing a workspace the user paired ten minutes ago as simply disconnected.
   * It also carries the tokens needed to restore or unpair them later.
   */
  pairings?: NodePairing[]
}

export interface DeviceInfo {
  nodeKey: string
  hostname: string
  os: string
  deviceType: string
  launcherVersion: string
  name?: string
}

export function loadNode(): NodeRecord | null {
  try {
    const file = nodeFilePath()
    if (fs.existsSync(file))
      return JSON.parse(fs.readFileSync(file, "utf-8")) as NodeRecord
  } catch {}
  return null
}

export function saveNode(record: NodeRecord): void {
  const file = nodeFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(record, null, 2))
  // The file holds the workspace token — keep it owner-only.
  try {
    fs.chmodSync(file, 0o600)
  } catch {}
}

/**
 * Persist a fresh pairing as the active one, keeping the history.
 *
 * The active pairing stays at the top level because that is the shape the
 * daemon reads (core `src/node-config.js`) — a launcher that wrote only the
 * list would stop being heartbeated by the daemon already installed.
 *
 * @returns the pairing this one replaced, when it was a different workspace.
 */
export function recordPairing(
  nodeKey: string,
  pairing: NodePairing,
): NodePairing | null {
  const existing = loadNode()
  const previous =
    existing?.workspace_id && existing.workspace_id !== pairing.workspace_id
      ? {
          node_id: existing.node_id,
          workspace_id: existing.workspace_id,
          workspace_slug: existing.workspace_slug,
          workspace_name: existing.workspace_name,
          endpoint: existing.endpoint,
          token: existing.token,
        }
      : null

  const stamped = { ...pairing, paired_at: new Date().toISOString() }
  const history = [
    stamped,
    ...(existing?.pairings || []).filter(
      (p) => p.workspace_id !== pairing.workspace_id,
    ),
  ]
  // A pairing made before this history existed would otherwise be lost the
  // first time the user re-pairs.
  if (previous && !history.some((p) => p.workspace_id === previous.workspace_id))
    history.push(previous)

  saveNode({ node_key: nodeKey, ...stamped, pairings: history })
  return previous
}

/**
 * Forget the active pairing — the workspace no longer knows this device.
 *
 * Dropped from the history too, not just demoted: the reason to call this is
 * that the server-side Node row is gone, so keeping it would leave the UI
 * claiming a membership that cannot be restored (only a fresh code can).
 * The record keeps its `node_key`, so re-pairing reuses the same device id.
 */
export function clearActivePairing(): NodePairing | null {
  const record = loadNode()
  if (!record?.workspace_id) return null
  const dropped: NodePairing = {
    node_id: record.node_id,
    workspace_id: record.workspace_id,
    workspace_slug: record.workspace_slug,
    workspace_name: record.workspace_name,
    endpoint: record.endpoint,
  }
  saveNode({
    node_key: record.node_key,
    pairings: (record.pairings || []).filter(
      (p) => p.workspace_id !== record.workspace_id,
    ),
  })
  return dropped
}

/** Every workspace this device has paired with, active one first. */
export function listPairings(): NodePairing[] {
  const record = loadNode()
  if (!record) return []
  if (record.pairings?.length) return record.pairings
  return record.workspace_id ? [record] : []
}

/** Stable per-device id, generated once and persisted. */
export function getOrCreateNodeKey(): string {
  const existing = loadNode()
  if (existing?.node_key) return existing.node_key
  const key = crypto.randomUUID()
  saveNode({ ...(existing || {}), node_key: key })
  return key
}

/** Best-effort device type from the platform; the user can override it. */
export function inferDeviceType(): string {
  if (process.platform === "darwin") return "laptop"
  if (process.platform === "win32") return "desktop"
  return "server" // linux here is typically a server/VM
}

/** Device facts sent on redeem — the same shape the daemon heartbeats. */
export function gatherDeviceInfo(launcherVersion: string): DeviceInfo {
  return {
    nodeKey: getOrCreateNodeKey(),
    hostname: os.hostname(),
    os: process.platform,
    deviceType: inferDeviceType(),
    launcherVersion,
  }
}

/**
 * Uppercase and drop separators, so a code typed as "yaj8-966m" matches the
 * "YAJ8966M" the server stored. The alphabet excludes 0/O/1/I/L, so we do NOT
 * map look-alikes — a wrong glyph is a wrong code, not a silent substitution.
 */
export function normalizePairingCode(code: string): string {
  return (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/** Human-facing form: XXXX-XXXX, matching how the workspace displays it. */
export function formatPairingCode(code: string): string {
  const c = normalizePairingCode(code)
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4, 8)}` : c
}

export const PAIRING_CODE_LENGTH = 8
