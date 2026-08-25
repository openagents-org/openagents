import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"

import {
  clearPairing,
  clearRevocation,
  formatPairingCode,
  listPairings,
  listRevocations,
  loadNode,
  nodeFilePath,
  normalizePairingCode,
  recordPairing,
  revokePairing,
} from "./node-pairing"

describe("pairing codes", () => {
  it("normalizes what a user actually pastes", () => {
    expect(normalizePairingCode("yaj8-966m")).toBe("YAJ8966M")
    expect(normalizePairingCode(" YAJ8 966M ")).toBe("YAJ8966M")
    expect(normalizePairingCode("YAJ8966M")).toBe("YAJ8966M")
  })

  // The server's alphabet excludes 0/O/1/I/L, so a look-alike glyph means the
  // user mistyped — we must not "helpfully" substitute it into a valid code.
  it("does not rewrite look-alike characters", () => {
    expect(normalizePairingCode("O0I1LYA")).toBe("O0I1LYA")
  })

  it("renders back in the XXXX-XXXX form the workspace shows", () => {
    expect(formatPairingCode("YAJ8966M")).toBe("YAJ8-966M")
    expect(formatPairingCode("yaj")).toBe("YAJ")
    expect(formatPairingCode("YAJ8")).toBe("YAJ8")
    expect(formatPairingCode("YAJ89")).toBe("YAJ8-9")
  })

  it("survives empty input", () => {
    expect(normalizePairingCode("")).toBe("")
    expect(formatPairingCode("")).toBe("")
  })
})

describe("pairing history", () => {
  // node.json lives under the home dir, which the module resolves per call —
  // so redirecting homedir here is enough to keep the test off a developer's
  // own pairing. (It was not: an earlier version captured the path at import
  // time and overwrote the real file.)
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "node-pairing-"))
    vi.spyOn(os, "homedir").mockReturnValue(home)
    expect(nodeFilePath().startsWith(home)).toBe(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(home, { recursive: true, force: true })
  })

  const ccc = {
    node_id: "n-ccc",
    workspace_id: "w-ccc",
    workspace_slug: "ccc",
    workspace_name: "ccc",
    token: "t-ccc",
  }
  const shared = {
    node_id: "n-shared",
    workspace_id: "w-shared",
    workspace_slug: "shared",
    workspace_name: "OA Shared WS",
    token: "t-shared",
  }

  it("records the first pairing and mirrors it at the top level", () => {
    recordPairing("dev-1", shared)
    const record = loadNode()
    expect(record?.workspace_id).toBe("w-shared")
    expect(record?.node_key).toBe("dev-1")
    expect(listPairings()).toHaveLength(1)
  })

  // The bug this exists for: pairing a second workspace took the device away
  // from the first, which then went quiet. The server keys a node row per
  // (workspace, device), so both memberships are legitimate and must survive.
  it("keeps every workspace paired, newest first", () => {
    recordPairing("dev-1", shared)
    recordPairing("dev-1", ccc)

    expect(listPairings().map((p) => p.workspace_slug)).toEqual([
      "ccc",
      "shared",
    ])
    // Top level mirrors the newest, for daemons predating multi-pairing.
    expect(loadNode()?.workspace_slug).toBe("ccc")
  })

  it("carries each pairing's own token, so both can heartbeat", () => {
    recordPairing("dev-1", shared)
    recordPairing("dev-1", ccc)

    expect(listPairings().map((p) => p.token)).toEqual(["t-ccc", "t-shared"])
  })

  it("re-pairing the same workspace replaces its entry, not adds one", () => {
    recordPairing("dev-1", ccc)
    recordPairing("dev-1", { ...ccc, token: "t-ccc-2" })

    expect(listPairings()).toHaveLength(1)
    expect(loadNode()?.token).toBe("t-ccc-2")
  })

  // The workspace can forget this device (an owner deletes it from the node
  // list); the launcher then has to stop claiming that ONE membership. node_key
  // is deliberately kept so re-pairing reuses the same device identity.
  it("clears one pairing and leaves the others alone", () => {
    recordPairing("dev-1", shared)
    recordPairing("dev-1", ccc)

    const dropped = clearPairing("w-shared")
    expect(dropped?.workspace_slug).toBe("shared")
    expect(listPairings().map((p) => p.workspace_slug)).toEqual(["ccc"])
    expect(loadNode()?.node_key).toBe("dev-1")
  })

  // Dropping the mirrored one has to promote a survivor, or the daemon reads a
  // record with no workspace and stops heartbeating the ones still paired.
  it("promotes the next pairing when the top-level one is cleared", () => {
    recordPairing("dev-1", shared)
    recordPairing("dev-1", ccc)

    const dropped = clearPairing()
    expect(dropped?.workspace_slug).toBe("ccc")
    expect(loadNode()?.workspace_slug).toBe("shared")
    expect(loadNode()?.token).toBe("t-shared")
    expect(listPairings().map((p) => p.workspace_slug)).toEqual(["shared"])
  })

  it("never hands the caller a dropped pairing's token", () => {
    recordPairing("dev-1", ccc)
    expect(clearPairing("w-ccc")).not.toHaveProperty("token")
  })

  it("clearing the last pairing leaves the device id behind", () => {
    recordPairing("dev-1", ccc)

    clearPairing("w-ccc")
    expect(listPairings()).toEqual([])
    expect(loadNode()?.workspace_id).toBeUndefined()
    expect(loadNode()?.node_key).toBe("dev-1")
  })

  it("clearing when nothing is paired is a no-op", () => {
    expect(clearPairing()).toBeNull()
    expect(clearPairing("w-nope")).toBeNull()
  })

  // Why revocations are written down at all: the pairing is deleted the moment
  // the workspace's answer arrives, so nothing else on the machine remembers
  // that this device was ever in there. Without the record, the next launch
  // reads a workspace bound to agents with no pairing — which the UI reported
  // as an erroring workspace rather than a removed device.
  it("remembers which workspace revoked this device", () => {
    recordPairing("dev-1", shared)
    recordPairing("dev-1", ccc)

    const dropped = revokePairing("w-shared")
    expect(dropped?.workspace_slug).toBe("shared")
    expect(listPairings().map((p) => p.workspace_slug)).toEqual(["ccc"])
    expect(listRevocations().map((r) => r.workspace_slug)).toEqual(["shared"])
  })

  // saveNode rebuilds the record from the fields it is handed, so every write
  // has to carry the list forward — this is the regression that catches one
  // that does not.
  it("keeps revocations across later pairing writes", () => {
    recordPairing("dev-1", shared)
    revokePairing("w-shared")

    recordPairing("dev-1", ccc)
    expect(listRevocations().map((r) => r.workspace_slug)).toEqual(["shared"])

    clearPairing("w-ccc")
    expect(listRevocations().map((r) => r.workspace_slug)).toEqual(["shared"])
  })

  it("settles the revocation when the device joins that workspace again", () => {
    recordPairing("dev-1", shared)
    revokePairing("w-shared")
    expect(listRevocations()).toHaveLength(1)

    recordPairing("dev-1", shared)
    expect(listRevocations()).toEqual([])
    expect(listPairings().map((p) => p.workspace_slug)).toEqual(["shared"])
  })

  // Removing the leftover card is the other way a revocation ends.
  it("clears a revocation on request", () => {
    recordPairing("dev-1", shared)
    revokePairing("w-shared")

    clearRevocation("w-shared")
    expect(listRevocations()).toEqual([])
  })

  it("has nothing to revoke for a workspace it was never paired to", () => {
    recordPairing("dev-1", ccc)
    expect(revokePairing("w-nope")).toBeNull()
    expect(listRevocations()).toEqual([])
  })

  // A node.json written before `pairings` existed carries a single top-level
  // pairing, which must survive its owner pairing somewhere else.
  it("adopts a legacy single-pairing file into the list", () => {
    fs.mkdirSync(path.dirname(nodeFilePath()), { recursive: true })
    fs.writeFileSync(
      nodeFilePath(),
      JSON.stringify({ node_key: "dev-1", ...shared }),
    )
    expect(listPairings().map((p) => p.workspace_slug)).toEqual(["shared"])

    recordPairing("dev-1", ccc)
    expect(listPairings().map((p) => p.workspace_slug)).toEqual([
      "ccc",
      "shared",
    ])
  })
})
