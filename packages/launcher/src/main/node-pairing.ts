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
   * Every workspace this device is paired to, newest first — ALL of them live.
   *
   * The server-side Node row is keyed per (workspace, node_key), so one device
   * legitimately holds a membership in many workspaces at once and the daemon
   * heartbeats every entry here. This list is the source of truth; the
   * top-level fields mirror `pairings[0]` purely so a daemon predating
   * multi-pairing still finds one workspace to report to.
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
 * Add a pairing, or refresh it if this workspace is already paired.
 *
 * Pairing a second workspace ADDS to the set rather than displacing what was
 * there: each workspace issues its own Node row for this device, and the daemon
 * heartbeats them all. Re-redeeming a code for a workspace already in the list
 * replaces that entry in place (the token may have rotated) and moves it to the
 * front, which is what the top-level mirror then reflects.
 */
export function recordPairing(nodeKey: string, pairing: NodePairing): void {
  const existing = loadNode()
  const stamped = { ...pairing, paired_at: new Date().toISOString() }
  const pairings = [
    stamped,
    ...normalizePairings(existing).filter(
      (p) => p.workspace_id !== pairing.workspace_id,
    ),
  ]
  saveNode({ node_key: nodeKey, ...stamped, pairings })
}

/**
 * Forget one workspace's pairing — that workspace no longer knows this device.
 *
 * Called when the server has given its definitive word (the node row is gone),
 * so the entry is dropped outright: only a fresh code can restore it. Every
 * OTHER pairing survives untouched, and the top-level mirror is re-pointed at
 * whatever is now first so the daemon keeps heartbeating the rest.
 *
 * @param workspaceId which pairing to drop; defaults to the top-level one.
 * @returns the pairing that was dropped, or null if there was no such pairing.
 */
export function clearPairing(workspaceId?: string): NodePairing | null {
  const record = loadNode()
  if (!record) return null
  const target = workspaceId || record.workspace_id
  if (!target) return null

  const pairings = normalizePairings(record)
  const dropped = pairings.find((p) => p.workspace_id === target)
  if (!dropped) return null

  const remaining = pairings.filter((p) => p.workspace_id !== target)
  // The daemon reads the top level, so promoting the next pairing is what keeps
  // the surviving workspaces reporting rather than going quiet with this one.
  const { token: _t, ...droppedSafe } = dropped
  saveNode({ node_key: record.node_key, ...remaining[0], pairings: remaining })
  return droppedSafe
}

/** Every workspace this device is paired to, most recent first. */
export function listPairings(): NodePairing[] {
  return normalizePairings(loadNode())
}

/**
 * The pairing list, reconstructed for records written before `pairings` existed
 * (those carry a single top-level pairing and nothing else).
 */
function normalizePairings(record: NodeRecord | null): NodePairing[] {
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
