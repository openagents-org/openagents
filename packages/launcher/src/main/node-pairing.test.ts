import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"

import {
  clearActivePairing,
  formatPairingCode,
  listPairings,
  loadNode,
  nodeFilePath,
  normalizePairingCode,
  recordPairing,
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

  it("makes the newest pairing the active one", () => {
    expect(recordPairing("dev-1", shared)).toBeNull()
    const record = loadNode()
    expect(record?.workspace_id).toBe("w-shared")
    expect(record?.node_key).toBe("dev-1")
    expect(listPairings()).toHaveLength(1)
  })

  // The bug this exists for: pairing a second workspace silently took the
  // device away from the first, and nothing recorded that it ever happened —
  // the old workspace just went quiet.
  it("reports the workspace a new pairing displaced, and keeps it", () => {
    recordPairing("dev-1", shared)
    const replaced = recordPairing("dev-1", ccc)

    expect(replaced?.workspace_slug).toBe("shared")
    expect(loadNode()?.workspace_slug).toBe("ccc")
    expect(listPairings().map((p) => p.workspace_slug)).toEqual([
      "ccc",
      "shared",
    ])
  })

  it("re-pairing the same workspace replaces its entry, not adds one", () => {
    recordPairing("dev-1", ccc)
    const replaced = recordPairing("dev-1", { ...ccc, token: "t-ccc-2" })

    expect(replaced).toBeNull()
    expect(listPairings()).toHaveLength(1)
    expect(loadNode()?.token).toBe("t-ccc-2")
  })

  // The workspace can forget this device (an owner deletes it from the node
  // list); the launcher then has to stop claiming the membership. node_key is
  // deliberately kept so re-pairing reuses the same device identity.
  it("clears the active pairing without losing the device id", () => {
    recordPairing("dev-1", shared)
    recordPairing("dev-1", ccc)

    const dropped = clearActivePairing()
    expect(dropped?.workspace_slug).toBe("ccc")
    expect(loadNode()?.workspace_id).toBeUndefined()
    expect(loadNode()?.node_key).toBe("dev-1")
    expect(listPairings().map((p) => p.workspace_slug)).toEqual(["shared"])
  })

  it("clearing when nothing is paired is a no-op", () => {
    expect(clearActivePairing()).toBeNull()
  })

  // A node.json written before the history existed still has to survive its
  // owner pairing somewhere else.
  it("adopts a legacy single-pairing file into the history", () => {
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
