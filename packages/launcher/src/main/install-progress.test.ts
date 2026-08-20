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
