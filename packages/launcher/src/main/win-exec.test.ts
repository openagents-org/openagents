import fs from "fs"
import os from "os"
import path from "path"

import { describe, expect, it } from "vitest"

import { shellCommandFor, windowsExecutable } from "./win-exec"

/**
 * Two Windows shapes have each shipped a broken login, and both come out of the
 * same call:
 *
 *   `installer.which("claude")` → C:\...\claude with NO extension (npm writes an
 *   extensionless Git-Bash script alongside claude.cmd and claude.ps1, and
 *   `where` lists it first). CreateProcess can't run it, the spawn failed
 *   instantly, and every Windows user was handed the terminal window the in-app
 *   login exists to avoid.
 *
 *   `installer.which("codex")` → ...\@openai\codex\bin\codex.js, the core's
 *   package-bin fallback for an npm agent with no .bin shim on PATH. cmd.exe
 *   hands a .js to Windows Script Host; the sign-in probe, which didn't use a
 *   shell at all, just got ENOENT and reported the user signed out.
 *
 * These cases can't run on the machine the bugs appear on, so the platform and
 * the file check are injected.
 */
describe("windowsExecutable", () => {
  const win = (bin: string, present: string[] = []) =>
    windowsExecutable(bin, "win32", (p) => present.includes(p))

  it("leaves other platforms completely alone", () => {
    expect(windowsExecutable("/usr/local/bin/claude", "darwin")).toEqual({
      command: "/usr/local/bin/claude",
      shell: false,
    })
  })

  it("starts a WSL-resolved CLI through wsl.exe", () => {
    expect(win("wsl:/home/u/.local/bin/claude")).toEqual({
      command: 'wsl.exe -e "/home/u/.local/bin/claude"',
      shell: true,
    })
  })

  it("routes a WSL CLI through wsl.exe on every host platform", () => {
    // The marker only ever comes from a Windows host, but the binary behind it
    // is Linux either way — nothing else can start it.
    expect(windowsExecutable("wsl:/usr/bin/codex", "darwin")).toEqual({
      command: 'wsl.exe -e "/usr/bin/codex"',
      shell: true,
    })
  })

  it("picks the .cmd shim sitting next to the extensionless script", () => {
    expect(
      win("C:\\nvm4w\\nodejs\\claude", ["C:\\nvm4w\\nodejs\\claude.cmd"]),
    ).toEqual({ command: '"C:\\nvm4w\\nodejs\\claude.cmd"', shell: true })
  })

  it("quotes the path, because plenty of people are C:\\Users\\First Last", () => {
    const { command } = win("C:\\Users\\First Last\\bin\\claude", [
      "C:\\Users\\First Last\\bin\\claude.cmd",
    ])
    expect(command).toBe('"C:\\Users\\First Last\\bin\\claude.cmd"')
  })

  it("runs a real .exe directly — no shell, no quoting needed", () => {
    expect(win("C:\\tools\\cursor-agent.exe")).toEqual({
      command: "C:\\tools\\cursor-agent.exe",
      shell: false,
    })
  })

  it("sends an already-.cmd path through the shell (Node won't spawn it directly)", () => {
    expect(win("C:\\bin\\amp.cmd")).toEqual({
      command: '"C:\\bin\\amp.cmd"',
      shell: true,
    })
  })

  it("prefers .cmd over .exe when both are present", () => {
    const { command } = win("C:\\bin\\x", ["C:\\bin\\x.cmd", "C:\\bin\\x.exe"])
    expect(command).toBe('"C:\\bin\\x.cmd"')
  })

  it("runs a bare .js bin through node, not Windows Script Host", () => {
    expect(
      win(
        "C:\\Users\\q\\.openagents\\nodejs\\node_modules\\@openai\\codex\\bin\\codex.js",
      ),
    ).toEqual({
      command:
        'node "C:\\Users\\q\\.openagents\\nodejs\\node_modules\\@openai\\codex\\bin\\codex.js"',
      shell: true,
    })
  })

  it("runs an extensionless Node shebang through node on Windows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-node-bin-"))
    const bin = path.join(dir, "cline")
    try {
      fs.writeFileSync(bin, "#!/usr/bin/env node\n")
      expect(windowsExecutable(bin, "win32")).toEqual({
        command: `node "${bin}"`,
        shell: true,
      })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("treats an `env -S node --flag` shebang as a Node script, like the daemon does", () => {
    // agent-connector's isNodeShebangScript accepts env flags; if this copy
    // did not, the daemon would run such a bin through node while the login
    // terminal fell to the shell fallback and failed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-node-s-bin-"))
    const bin = path.join(dir, "tool")
    try {
      fs.writeFileSync(bin, "#!/usr/bin/env -S node --no-warnings\n")
      expect(windowsExecutable(bin, "win32")).toEqual({
        command: `node "${bin}"`,
        shell: true,
      })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("leaves other extensionless files on the shell fallback", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-other-bin-"))
    try {
      for (const [name, contents] of [
        ["ts-node", "#!/usr/bin/env ts-node\n"],
        ["node-wrapper", "#!/usr/bin/env node-wrapper\n"],
        ["shell-script", "#!/bin/sh -c node\n"],
        ["plain-text", "not a shebang\n"],
      ]) {
        const bin = path.join(dir, name)
        fs.writeFileSync(bin, contents)
        expect(windowsExecutable(bin, "win32")).toEqual({
          command: `"${bin}"`,
          shell: true,
        })
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("prefers a .js bin's real shim — named for the command, not the file", () => {
    // The sibling of `codex.js` is `codex.cmd`; `codex.js.cmd` never exists.
    const { command } = win("C:\\p\\node_modules\\.bin\\codex.js", [
      "C:\\p\\node_modules\\.bin\\codex.cmd",
    ])
    expect(command).toBe('"C:\\p\\node_modules\\.bin\\codex.cmd"')
  })

  it("leaves a .js alone off Windows — it has a shebang and the +x bit there", () => {
    expect(windowsExecutable("/home/q/.bin/codex.js", "linux")).toEqual({
      command: "/home/q/.bin/codex.js",
      shell: false,
    })
  })

  it("falls back to the shell rather than a spawn that cannot work", () => {
    expect(win("C:\\bin\\mystery")).toEqual({
      command: '"C:\\bin\\mystery"',
      shell: true,
    })
  })
})

// A command line is not an argv[0]: everything windowsExecutable leaves bare
// for spawn has to be quoted before it goes near a shell.
describe("shellCommandFor", () => {
  const win = (bin: string, present: string[] = []) =>
    shellCommandFor(bin, "win32", (p) => present.includes(p))

  it("quotes an .exe that spawn would take unquoted", () => {
    expect(win("C:\\Program Files\\cursor\\cursor-agent.exe")).toBe(
      '"C:\\Program Files\\cursor\\cursor-agent.exe"',
    )
  })

  it("quotes a plain unix path", () => {
    expect(
      shellCommandFor("/Users/First Last/.local/bin/claude", "darwin"),
    ).toBe('"/Users/First Last/.local/bin/claude"')
  })

  it("keeps the node prefix for a .js bin", () => {
    expect(win("C:\\p\\@openai\\codex\\bin\\codex.js")).toBe(
      'node "C:\\p\\@openai\\codex\\bin\\codex.js"',
    )
  })

  it("keeps the node prefix for an extensionless Node shebang", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-node-bin-"))
    const bin = path.join(dir, "cline")
    try {
      fs.writeFileSync(bin, "#!/usr/bin/env node\n")
      expect(shellCommandFor(bin, "win32")).toBe(`node "${bin}"`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("doesn't double-quote what is already quoted", () => {
    expect(win("C:\\bin\\amp.cmd")).toBe('"C:\\bin\\amp.cmd"')
  })

  it("keeps the wsl.exe prefix for an in-distro CLI", () => {
    expect(win("wsl:/home/u/.local/bin/claude")).toBe(
      'wsl.exe -e "/home/u/.local/bin/claude"',
    )
  })
})
