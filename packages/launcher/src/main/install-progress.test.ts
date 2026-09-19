import { describe, expect, it } from "vitest"

import {
  asMissingPrereq,
  classifyInstallChunk,
  logStamp,
  userFacingInstallError,
} from "./install-progress"

describe("classifyInstallChunk", () => {
  it("treats a real size as a download", () => {
    expect(classifyInstallChunk("fetched 12.4 MB", "install").phase).toBe(
      "downloading",
    )
    expect(classifyInstallChunk("Downloading node v26", "install").phase).toBe(
      "downloading",
    )
    expect(classifyInstallChunk("  47% complete", "install").phase).toBe(
      "downloading",
    )
  })

  it("does not call a line a download because it contains the letters mb", () => {
    // The bug this guards: `line.includes("mb")` matched any of these, so a
    // failure at another step was reported as "Failed while downloading".
    for (const line of [
      "resolving symbols",
      "a large number of files",
      "assembly step failed",
    ]) {
      expect(classifyInstallChunk(line, "install").phase).toBeUndefined()
    }
  })
})

describe("userFacingInstallError", () => {
  it("names git when the installer tripped over a missing one", () => {
    const msg = userFacingInstallError(
      new Error("✗ Git not found\nRequesting Apple Command Line Tools"),
      "downloading",
      "install",
    )
    expect(msg).toMatch(/Git is missing/)
    expect(msg).toMatch(/xcode-select --install/)
  })

  // A real log from a Windows machine: hermes's install.ps1 spawns the astral
  // uv installer in a child PowerShell, that child could not auto-load
  // Microsoft.PowerShell.Security so uv's first call (Get-ExecutionPolicy)
  // died, hermes reported "uv installation failed" and still exited 0, and all
  // the user saw was "Failed while downloading. The installer stopped before
  // it could finish."
  const hermesUvFailure = [
    "Hermes install command completed, but the Hermes CLI binary could not be found",
    "(its installer can report a uv/setup failure yet still exit 0).",
    "",
    "Installer output:",
    "[X] uv installed but not found at C:\\Users\\u\\AppData\\Local\\hermes\\bin\\uv.exe",
    "->   Did not find path entry D:\\miniconda\\bin",
    "->   The 'Get-ExecutionPolicy' command was found in the module 'Microsoft.PowerShell.Security', but the module could not be loaded. For more information, run 'Import-Module Microsoft.PowerShell.Security'.",
    "[X] Installation failed: uv installation failed",
  ].join("\n")

  it("names the module-load failure behind a failed uv bootstrap", () => {
    const msg = userFacingInstallError(
      new Error(hermesUvFailure),
      "downloading",
      "install",
    )
    expect(msg).toMatch(/could not load a built-in module/)
    expect(msg).toMatch(/PSModulePath/)
    // NOT the permission bucket: the substring "executionpolicy" lives inside
    // the command name in that sentence and means nothing about permissions.
    expect(msg).not.toMatch(/did not have permission/)
    // And never the generic shrug, which is what shipped.
    expect(msg).not.toMatch(/stopped before it could finish/)
  })

  it("names uv when that is all the installer reported", () => {
    const msg = userFacingInstallError(
      new Error("Install failed with exit code 1\n\n[X] Installation failed: uv installation failed"),
      "installing",
      "install",
    )
    expect(msg).toMatch(/could not set up uv/)
    expect(msg).toMatch(/docs\.astral\.sh/)
  })

  it("says an installer left no command rather than shrugging", () => {
    // "could not be found" is the verify-before-mark wording, and it is not
    // the substring "not found" — so it used to fall through to the fallback.
    const msg = userFacingInstallError(
      new Error("Cursor install command completed, but the cursor-agent binary could not be found"),
      "verifying",
      "install",
    )
    expect(msg).toMatch(/left no working command/)
    expect(msg).not.toMatch(/stopped before it could finish/)
  })

  it("names the PortableGit download when Windows fails to fetch it", () => {
    // The real shape: install.ps1's error plus whatever the failed download
    // printed, which is usually full of network words.
    const msg = userFacingInstallError(
      new Error(
        "Install failed with exit code 1\n\nCould not install portable Git: The operation has timed out.",
      ),
      "downloading",
      "install",
    )
    expect(msg).toMatch(/downloading a portable copy failed/)
    expect(msg).toMatch(/git-scm\.com/)
    // Must NOT be claimed by the generic network branch, which would say
    // "check your VPN" to a machine that just has no Git.
    expect(msg).not.toMatch(/proxy, or VPN/)
  })

  it("explains a Git Bash that cannot launch MSYS programs", () => {
    const msg = userFacingInstallError(
      new Error(
        "Git Bash at C:\\Program Files\\Git\\bin\\bash.exe exists but cannot launch required MSYS programs.",
      ),
      "installing",
      "install",
    )
    expect(msg).toMatch(/cannot run the programs/)
    expect(msg).toMatch(/ASLR/)
  })

  it("does not mistake an ordinary git mention for a Git Bash failure", () => {
    const msg = userFacingInstallError(
      new Error("cloning with git bash succeeded, then npm ERR! code E404"),
      "installing",
      "install",
    )
    expect(msg).not.toMatch(/ASLR/)
  })

  it("still falls back to the generic copy", () => {
    const msg = userFacingInstallError(new Error("kaboom"), "installing", "install")
    expect(msg).toMatch(/Failed while running the installer/)
  })
})

describe("asMissingPrereq", () => {
  const remedy = {
    name: "git",
    action: "install-xcode-clt",
    summary: "Git is required.",
    command: "xcode-select --install",
    alternative: "brew install git",
  }

  it("recognises the core's preflight error", () => {
    const err = Object.assign(new Error("Hermes needs git"), {
      code: "MISSING_PREREQ",
      missing: [remedy],
    })
    expect(asMissingPrereq(err)).toEqual({
      message: "Hermes needs git",
      missing: [remedy],
    })
  })

  it("ignores anything else", () => {
    expect(asMissingPrereq(new Error("network down"))).toBeNull()
    expect(asMissingPrereq(null)).toBeNull()
    expect(asMissingPrereq("MISSING_PREREQ")).toBeNull()
    // Right code, but no payload to render — not usable as a prereq failure.
    expect(
      asMissingPrereq(Object.assign(new Error("x"), { code: "MISSING_PREREQ" })),
    ).toBeNull()
  })
})

describe("logStamp", () => {
  it("is filename-safe and sorts chronologically", () => {
    const early = logStamp(new Date(2026, 7, 20, 9, 5, 3))
    const later = logStamp(new Date(2026, 7, 20, 12, 47, 1))
    expect(early).toBe("20260820-090503")
    expect(later).toBe("20260820-124701")
    expect(early < later).toBe(true)
  })
})
