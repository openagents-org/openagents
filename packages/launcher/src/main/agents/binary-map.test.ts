import { describe, expect, it } from "vitest"

import BUNDLED_REGISTRY from "../../../../agent-connector/registry.json"
import { buildBinaryTypeMap, firstToken } from "./binary-map"
import { DUAL_LOGIN_AGENTS, HOSTED_LOGIN_AGENTS } from "./auth-specs"

const entries = BUNDLED_REGISTRY as Array<Record<string, unknown>>
const map = buildBinaryTypeMap(entries)

describe("firstToken", () => {
  it("takes the binary and drops the subcommands", () => {
    expect(firstToken("claude auth login")).toBe("claude")
    expect(firstToken("  codex login  ")).toBe("codex")
    expect(firstToken("gemini")).toBe("gemini")
  })

  it("shrugs at anything that isn't a command string", () => {
    expect(firstToken(undefined)).toBe("")
    expect(firstToken(null)).toBe("")
    expect(firstToken("")).toBe("")
    expect(firstToken(42)).toBe("")
  })
})

describe("buildBinaryTypeMap", () => {
  // The regression this whole change exists for: a hand-written map covered six
  // agents, and `codex login` was rewritten to an absolute path for none of
  // them — so the Windows login terminal ran a bare command that PATH couldn't
  // resolve. EVERY agent that can be signed in from a terminal must be here.
  it("covers every agent with a login command — the codex regression", () => {
    const withLogin = entries
      .filter((e) => {
        const type = String(e.name || "")
        const cr = (e.check_ready || {}) as Record<string, unknown>
        return (
          !!cr.login_command ||
          !!HOSTED_LOGIN_AGENTS[type] ||
          !!DUAL_LOGIN_AGENTS[type]
        )
      })
      .map((e) => String(e.name))
    expect(withLogin).toContain("codex")
    for (const type of withLogin) {
      const cr = (entries.find((e) => e.name === type)?.check_ready ||
        {}) as Record<string, unknown>
      const commands = [
        cr.login_command,
        HOSTED_LOGIN_AGENTS[type]?.loginCommand,
        DUAL_LOGIN_AGENTS[type]?.loginCommand,
      ].filter(Boolean)
      for (const cmd of commands)
        expect([type, map.get(firstToken(cmd))]).toEqual([type, type])
    }
  })

  it("maps each agent's own binary, including renamed ones", () => {
    expect(map.get("codex")).toBe("codex")
    expect(map.get("cursor-agent")).toBe("cursor")
    expect(map.get("ncl")).toBe("nanoclaw")
    expect(map.get("mini")).toBe("mini-swe-agent")
  })

  it("maps binary aliases", () => {
    // Cursor installs both `cursor-agent` and a bare `agent`.
    expect(map.get("agent")).toBe("cursor")
  })

  it("is case-insensitive — Windows paths are", () => {
    expect(map.get("CODEX".toLowerCase())).toBe("codex")
  })

  it("lets a binary name win over another agent's alias", () => {
    const collide = buildBinaryTypeMap([
      { name: "beta", install: { binary: "shared" } },
      {
        name: "alpha",
        install: { binary: "alpha", binary_aliases: ["shared"] },
      },
    ])
    expect(collide.get("shared")).toBe("beta")
    expect(collide.get("alpha")).toBe("alpha")
  })

  it("survives a junk registry", () => {
    expect(buildBinaryTypeMap([]).size).toBeGreaterThan(0) // login specs still land
    expect(() =>
      buildBinaryTypeMap([{}, { name: 42 }, { name: "x", install: null }]),
    ).not.toThrow()
  })
})
