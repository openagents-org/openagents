import { describe, it, expect } from "vitest"
import {
  parseNpmInstallCommand,
  needsLatestPin,
  displayInstallCommand,
} from "./npm-install-spec"

// The exact command strings shipped in packages/agent-connector/registry.json.
// If the registry changes shape, these are the cases that decide whether the
// Update button actually moves an agent's version.
const REGISTRY_COMMANDS = {
  claude: "npm install -g @anthropic-ai/claude-code",
  codex: "npm install -g @openai/codex",
  gemini: "npm install -g @google/gemini-cli",
  openclaw: "npm install -g openclaw@latest",
  opencode: "npm install -g opencode-ai@1.17.11",
  amp: "curl -fsSL https://ampcode.com/install.sh | bash",
  cursor: "curl https://cursor.com/install -fsSL | bash",
  kimi: "echo 'Kimi uses direct API mode — no binary install needed'",
}

describe("parseNpmInstallCommand", () => {
  it("reads a scoped package with no version", () => {
    expect(parseNpmInstallCommand(REGISTRY_COMMANDS.claude)).toEqual({
      pkg: "@anthropic-ai/claude-code",
      spec: null,
    })
  })

  it("separates an unscoped package from its dist-tag", () => {
    expect(parseNpmInstallCommand(REGISTRY_COMMANDS.openclaw)).toEqual({
      pkg: "openclaw",
      spec: "latest",
    })
  })

  it("separates an unscoped package from a pinned version", () => {
    expect(parseNpmInstallCommand(REGISTRY_COMMANDS.opencode)).toEqual({
      pkg: "opencode-ai",
      spec: "1.17.11",
    })
  })

  it("returns nulls for non-npm installers", () => {
    for (const cmd of [REGISTRY_COMMANDS.amp, REGISTRY_COMMANDS.cursor, REGISTRY_COMMANDS.kimi]) {
      expect(parseNpmInstallCommand(cmd)).toEqual({ pkg: null, spec: null })
    }
  })

  it("tolerates a missing command", () => {
    expect(parseNpmInstallCommand(undefined)).toEqual({ pkg: null, spec: null })
  })
})

describe("needsLatestPin", () => {
  // These three are exactly the agents that reported "Update" doing nothing:
  // npm answers "up to date" for a bare install once package.json carries a
  // satisfied range, so the version never advances.
  it.each(["claude", "codex", "gemini"] as const)(
    "pins @latest for %s (bare npm install)",
    (agent) => {
      expect(needsLatestPin(REGISTRY_COMMANDS[agent])).toBe(true)
    },
  )

  it("leaves an explicit @latest alone — it already floats", () => {
    expect(needsLatestPin(REGISTRY_COMMANDS.openclaw)).toBe(false)
  })

  it("never overrides a deliberately pinned version", () => {
    expect(needsLatestPin(REGISTRY_COMMANDS.opencode)).toBe(false)
  })

  it("leaves non-npm installers to their own scripts", () => {
    expect(needsLatestPin(REGISTRY_COMMANDS.amp)).toBe(false)
    expect(needsLatestPin(REGISTRY_COMMANDS.cursor)).toBe(false)
  })
})

describe("displayInstallCommand", () => {
  // The confirm dialog must not promise a command the launcher won't run.
  it("shows the @latest pin that an update actually applies", () => {
    expect(displayInstallCommand(REGISTRY_COMMANDS.gemini, "update")).toBe(
      "npm install -g @google/gemini-cli@latest",
    )
  })

  it("shows installs verbatim — only updates pin @latest", () => {
    expect(displayInstallCommand(REGISTRY_COMMANDS.gemini, "install")).toBe(
      REGISTRY_COMMANDS.gemini,
    )
  })

  it("does not double up when the command already names a spec", () => {
    expect(displayInstallCommand(REGISTRY_COMMANDS.openclaw, "update")).toBe(
      REGISTRY_COMMANDS.openclaw,
    )
    expect(displayInstallCommand(REGISTRY_COMMANDS.opencode, "update")).toBe(
      REGISTRY_COMMANDS.opencode,
    )
  })

  it("leaves non-npm commands untouched", () => {
    expect(displayInstallCommand(REGISTRY_COMMANDS.amp, "update")).toBe(
      REGISTRY_COMMANDS.amp,
    )
  })

  it("passes through a missing command", () => {
    expect(displayInstallCommand(undefined, "update")).toBeUndefined()
  })
})
