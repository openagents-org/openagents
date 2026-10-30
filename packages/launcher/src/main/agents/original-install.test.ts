import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  elevatedShellCommand,
  npmGlobalPrefix,
  originalUpdateCommand,
} from "./original-install"

let root: string
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "oa-original-")))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function writeManifest(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }))
}

describe("npmGlobalPrefix", () => {
  it("finds the prefix beside a Windows .cmd shim", () => {
    writeManifest(path.join(root, "node_modules", "@anthropic-ai", "claude-code"), "@anthropic-ai/claude-code")
    const bin = path.join(root, "claude.cmd")
    expect(npmGlobalPrefix(bin, "@anthropic-ai/claude-code", "win32")).toBe(root)
  })

  it("rejects a Windows shim with no package beside it (pnpm, Volta)", () => {
    expect(npmGlobalPrefix(path.join(root, "claude.cmd"), "@anthropic-ai/claude-code", "win32")).toBe(null)
  })

  it.skipIf(process.platform === "win32")("follows an npm bin link back to its prefix", () => {
    const pkgDir = path.join(root, "lib", "node_modules", "@openai", "codex")
    writeManifest(pkgDir, "@openai/codex")
    fs.mkdirSync(path.join(pkgDir, "bin"))
    fs.writeFileSync(path.join(pkgDir, "bin", "codex.js"), "")
    fs.mkdirSync(path.join(root, "bin"))
    fs.symlinkSync(path.join(pkgDir, "bin", "codex.js"), path.join(root, "bin", "codex"))
    expect(npmGlobalPrefix(path.join(root, "bin", "codex"), "@openai/codex", "darwin")).toBe(root)
  })

  it.skipIf(process.platform === "win32")("rejects a link from outside the prefix's own bin (Homebrew)", () => {
    const pkgDir = path.join(root, "Cellar", "libexec", "lib", "node_modules", "@openai", "codex")
    writeManifest(pkgDir, "@openai/codex")
    fs.writeFileSync(path.join(pkgDir, "codex.js"), "")
    fs.mkdirSync(path.join(root, "bin"))
    fs.symlinkSync(path.join(pkgDir, "codex.js"), path.join(root, "bin", "codex"))
    expect(npmGlobalPrefix(path.join(root, "bin", "codex"), "@openai/codex", "darwin")).toBe(null)
  })

  it.skipIf(process.platform === "win32")("rejects a layout that is not npm's (bun)", () => {
    const pkgDir = path.join(root, "install", "global", "node_modules", "@openai", "codex")
    writeManifest(pkgDir, "@openai/codex")
    fs.writeFileSync(path.join(pkgDir, "codex.js"), "")
    fs.mkdirSync(path.join(root, "bin"))
    fs.symlinkSync(path.join(pkgDir, "codex.js"), path.join(root, "bin", "codex"))
    expect(npmGlobalPrefix(path.join(root, "bin", "codex"), "@openai/codex", "darwin")).toBe(null)
  })
})

describe("originalUpdateCommand", () => {
  it("is plain npm when the prefix is writable", () => {
    const cmd = originalUpdateCommand({ prefix: "/home/u/.npm-global", elevation: "none" }, "@openai/codex", "latest", "linux")
    expect(cmd).toBe("npm install -g --prefix /home/u/.npm-global @openai/codex@latest")
  })

  it("adds sudo, and quotes a path with spaces", () => {
    const cmd = originalUpdateCommand({ prefix: "/opt/my tools", elevation: "manual" }, "codex", "1.2.3", "linux")
    expect(cmd).toBe("sudo npm install -g --prefix '/opt/my tools' codex@1.2.3")
  })

  it("asks Windows users for an admin terminal instead of sudo", () => {
    const cmd = originalUpdateCommand({ prefix: "C:\\Program Files\\nodejs", elevation: "manual" }, "codex", "latest", "win32")
    expect(cmd).toBe('npm install -g --prefix "C:\\Program Files\\nodejs" codex@latest')
  })
})

describe("elevatedShellCommand", () => {
  it("carries PATH and proxy into the bare root shell, and keeps npm's cache off ~/.npm", () => {
    const cmd = elevatedShellCommand(
      "/Users/u/.openagents/nodejs/bin/node",
      ["/Users/u/.openagents/nodejs/lib/node_modules/npm/bin/npm-cli.js"],
      ["install", "-g", "--prefix", "/usr/local", "@openai/codex@latest"],
      "/Users/u/.openagents/nodejs/bin:/usr/bin",
      { HTTPS_PROXY: "http://127.0.0.1:7890", HOME: "/Users/u" },
    )
    expect(cmd).toMatch(/^export PATH=\/Users\/u\/\.openagents\/nodejs\/bin:\/usr\/bin HTTPS_PROXY=http:\/\/127\.0\.0\.1:7890; /)
    expect(cmd).toContain("--prefix /usr/local @openai/codex@latest --cache ")
    expect(cmd).not.toContain("HOME=")
  })

  it("quotes what the shell would otherwise split", () => {
    const cmd = elevatedShellCommand("/Users/o'neil/node", [], ["install"], "/bin", {})
    expect(cmd).toContain(`'/Users/o'\\''neil/node' install`)
  })
})
