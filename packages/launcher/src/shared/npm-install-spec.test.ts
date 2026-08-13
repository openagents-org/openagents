import { describe, it, expect } from "vitest"
import {
  parseNpmInstallCommand,
  updateInstallCommand,
  stripInstallVersion,
  pinnedVersion,
  displayInstallCommand,
  globalUninstallCommand,
  resolveNpmPackage,
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
  pi: "npm install -g @earendil-works/pi-coding-agent@0.83.0",
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

  it("accepts `npm i`, which npm does too", () => {
    expect(parseNpmInstallCommand("npm i -g @openai/codex")).toEqual({
      pkg: "@openai/codex",
      spec: null,
    })
  })
})

describe("resolveNpmPackage", () => {
  it("reads the package out of an npm command", () => {
    expect(
      resolveNpmPackage({ binary: "codex", macos: REGISTRY_COMMANDS.codex }, "macos"),
    ).toBe("@openai/codex")
  })

  it("prefers an explicit npm_package over parsing", () => {
    expect(
      resolveNpmPackage(
        { npm_package: "@github/copilot", macos: "npm install -g @github/copilot" },
        "macos",
      ),
    ).toBe("@github/copilot")
  })

  // The bug this function exists to prevent. `install.binary` is an executable
  // name, and every one of these is ALSO an unrelated package on public npm:
  // amp@0.3.1 is "Abstract messaging protocol", goose@0.0.3 "adds brackets for
  // golang", hermes@0.4.4 "Messenger of the gods". Reading versions from them
  // gave seven agents a permanent, unclearable "update available" badge, and
  // pointed Update at `npm install -g amp@latest`.
  it.each([
    ["amp", { binary: "amp", macos: REGISTRY_COMMANDS.amp }],
    ["cursor", { binary: "cursor-agent", macos: REGISTRY_COMMANDS.cursor }],
    ["kimi", { binary: "kimi", macos: REGISTRY_COMMANDS.kimi }],
  ])("never falls back to install.binary for %s", (_name, install) => {
    expect(resolveNpmPackage(install, "macos")).toBeNull()
  })

  it("is null when the entry names no command for this platform", () => {
    expect(resolveNpmPackage({ binary: "amp" }, "windows")).toBeNull()
    expect(resolveNpmPackage(undefined, "macos")).toBeNull()
  })

  it("falls back to the platform-agnostic command", () => {
    expect(resolveNpmPackage({ command: REGISTRY_COMMANDS.gemini }, "linux")).toBe(
      "@google/gemini-cli",
    )
  })
})

describe("updateInstallCommand", () => {
  // These three reported "Update" doing nothing: npm answers "up to date" for a
  // bare install once package.json carries a satisfied range.
  it.each(["claude", "codex", "gemini"] as const)(
    "pins @latest for %s (bare npm install)",
    (agent) => {
      expect(updateInstallCommand(REGISTRY_COMMANDS[agent])).toBe(
        `${REGISTRY_COMMANDS[agent]}@latest`,
      )
    },
  )

  it("leaves an explicit @latest as it is", () => {
    expect(updateInstallCommand(REGISTRY_COMMANDS.openclaw)).toBe(
      REGISTRY_COMMANDS.openclaw,
    )
  })

  // The Pi bug: the registry pins a version, so "Update to v0.84.1" reinstalled
  // 0.83.0 and the update badge never cleared. A pin is a fresh-install
  // baseline; an update targets what the button advertises.
  it("replaces a pinned version rather than reinstalling it", () => {
    expect(updateInstallCommand(REGISTRY_COMMANDS.pi)).toBe(
      "npm install -g @earendil-works/pi-coding-agent@latest",
    )
    expect(updateInstallCommand(REGISTRY_COMMANDS.opencode)).toBe(
      "npm install -g opencode-ai@latest",
    )
  })

  it("leaves non-npm installers to their own scripts", () => {
    expect(updateInstallCommand(REGISTRY_COMMANDS.amp)).toBe(REGISTRY_COMMANDS.amp)
    expect(updateInstallCommand(REGISTRY_COMMANDS.cursor)).toBe(
      REGISTRY_COMMANDS.cursor,
    )
  })

  it("passes through a missing command", () => {
    expect(updateInstallCommand(undefined)).toBeUndefined()
  })
})

describe("stripInstallVersion", () => {
  // The detail rail's "Dependencies" card: a pin in a hand-maintained registry
  // is not the version the user ends up with, so printing it invites the wrong
  // question.
  it("drops a pinned version", () => {
    expect(stripInstallVersion(REGISTRY_COMMANDS.pi)).toBe(
      "npm install -g @earendil-works/pi-coding-agent",
    )
    expect(stripInstallVersion(REGISTRY_COMMANDS.opencode)).toBe(
      "npm install -g opencode-ai",
    )
  })

  it("drops a dist-tag too", () => {
    expect(stripInstallVersion(REGISTRY_COMMANDS.openclaw)).toBe(
      "npm install -g openclaw",
    )
  })

  it("leaves a scoped package with no spec intact", () => {
    expect(stripInstallVersion(REGISTRY_COMMANDS.claude)).toBe(
      REGISTRY_COMMANDS.claude,
    )
  })

  it("leaves non-npm installers untouched", () => {
    expect(stripInstallVersion(REGISTRY_COMMANDS.amp)).toBe(REGISTRY_COMMANDS.amp)
    expect(stripInstallVersion(undefined)).toBeUndefined()
  })
})

describe("displayInstallCommand", () => {
  // The confirm dialog must not promise a command the launcher won't run.
  it("shows the @latest pin that an update actually applies", () => {
    expect(displayInstallCommand(REGISTRY_COMMANDS.gemini, "update")).toBe(
      "npm install -g @google/gemini-cli@latest",
    )
  })

  it("shows a floating install verbatim", () => {
    expect(displayInstallCommand(REGISTRY_COMMANDS.gemini, "install")).toBe(
      REGISTRY_COMMANDS.gemini,
    )
    expect(displayInstallCommand(REGISTRY_COMMANDS.openclaw, "install")).toBe(
      REGISTRY_COMMANDS.openclaw,
    )
  })

  // The launcher overrides a frozen version on install as well as on update,
  // so the confirm dialog must stop printing the registry's stale pin.
  it("shows @latest for an install the launcher un-pins", () => {
    expect(displayInstallCommand(REGISTRY_COMMANDS.pi, "install")).toBe(
      "npm install -g @earendil-works/pi-coding-agent@latest",
    )
  })

  it("does not double up when the command already names a spec", () => {
    expect(displayInstallCommand(REGISTRY_COMMANDS.openclaw, "update")).toBe(
      REGISTRY_COMMANDS.openclaw,
    )
    expect(displayInstallCommand(REGISTRY_COMMANDS.pi, "update")).toBe(
      "npm install -g @earendil-works/pi-coding-agent@latest",
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

describe("pinnedVersion", () => {
  it("reports a frozen version", () => {
    expect(pinnedVersion(REGISTRY_COMMANDS.pi)).toBe("0.83.0")
    expect(pinnedVersion(REGISTRY_COMMANDS.opencode)).toBe("1.17.11")
  })

  // A dist-tag is not a pin: it resolves to whatever is newest on that channel,
  // so there is nothing to override.
  it("does not count a dist-tag", () => {
    expect(pinnedVersion(REGISTRY_COMMANDS.openclaw)).toBeNull()
    expect(pinnedVersion(REGISTRY_COMMANDS.claude)).toBeNull()
    expect(pinnedVersion(REGISTRY_COMMANDS.amp)).toBeNull()
    expect(pinnedVersion(undefined)).toBeNull()
  })
})

describe("globalUninstallCommand", () => {
  it("offers the -g removal the launcher itself refuses to run", () => {
    // The installer rewrites `-g` to `--prefix ~/.openagents/runtimes/<type>`,
    // so a copy installed globally by the user survives an in-app uninstall and
    // keeps the agent showing as installed. This is the command that ends that.
    expect(globalUninstallCommand(REGISTRY_COMMANDS.claude)).toBe(
      "npm uninstall -g @anthropic-ai/claude-code",
    )
  })

  it("drops a pinned version — you uninstall a package, not a version", () => {
    expect(globalUninstallCommand(REGISTRY_COMMANDS.opencode)).toBe(
      "npm uninstall -g opencode-ai",
    )
    expect(globalUninstallCommand(REGISTRY_COMMANDS.openclaw)).toBe(
      "npm uninstall -g openclaw",
    )
  })

  it("handles the python installers", () => {
    expect(globalUninstallCommand("pipx install aider-chat")).toBe(
      "pipx uninstall aider-chat",
    )
    expect(globalUninstallCommand("pip3 install aider-chat")).toBe(
      "pip3 uninstall -y aider-chat",
    )
  })

  it("has nothing to offer for a curl-script install", () => {
    // No package manager owns the result, so there is no one-liner to hand
    // over; the notice falls back to naming the path and stopping there.
    expect(globalUninstallCommand(REGISTRY_COMMANDS.amp)).toBeNull()
    expect(globalUninstallCommand(REGISTRY_COMMANDS.cursor)).toBeNull()
    expect(globalUninstallCommand(undefined)).toBeNull()
  })
})
