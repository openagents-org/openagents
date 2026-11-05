// @vitest-environment node
import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import type { ChildProcess } from "child_process"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { spawn, execFile } = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }))
vi.mock("child_process", () => ({ spawn, execFile }))

import { LoginProbe } from "./login-probe"

describe("LoginProbe — Hermes status with slow unrelated diagnostics", () => {
  let home: string
  let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
  let probe: LoginProbe
  let settled: ReturnType<typeof vi.fn<(type: string, value: boolean | null) => void>>

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-login-probe-"))
    vi.spyOn(os, "homedir").mockReturnValue(home)
    vi.useFakeTimers()
    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    })
    spawn.mockReturnValue(child as unknown as ChildProcess)
    settled = vi.fn()
    probe = new LoginProbe({
      resolveBinary: () => "/fake/hermes.exe",
      getSavedTypeEnv: () => ({}),
      getCore: () => null,
      onSettled: settled,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    spawn.mockReset()
    execFile.mockReset()
    fs.rmSync(home, { recursive: true, force: true })
  })

  it("returns a streamed login before terminal and gateway diagnostics exit", async () => {
    const result = probe.refresh("hermes")
    child.stdout.write("Nous Portal  ✗ not logged in\nOpenAI Codex  \x1b[32m✓\x1b[0m logged ")
    await vi.advanceTimersByTimeAsync(100)
    expect(settled).not.toHaveBeenCalled()
    child.stdout.write("in\n◆ Terminal Backend\n")
    await vi.advanceTimersByTimeAsync(100)
    expect(settled).toHaveBeenCalledWith("hermes", true)
    expect(await result).toBe(true)
    expect(probe.isAuthed("hermes")).toBe(true)
    expect(child.kill).toHaveBeenCalledOnce()
    child.emit("close", null)
    expect(settled).toHaveBeenCalledOnce()
  })

  it("requests unbuffered Python output so a pipe receives the login rows", () => {
    void probe.refresh("hermes")
    const options = spawn.mock.calls[0][2]
    expect(options.env.PYTHONUNBUFFERED).toBe("1")
    child.emit("close", 0)
  })

  it.runIf(process.platform === "win32")("ends the Windows wrapper's process tree after detecting login", async () => {
    Object.assign(child, { pid: 12345 })
    const result = probe.refresh("hermes")
    child.stdout.write("OpenAI Codex  ✓ logged in\n")
    await vi.advanceTimersByTimeAsync(100)
    expect(await result).toBe(true)
    expect(execFile).toHaveBeenCalledWith("taskkill", ["/pid", "12345", "/T", "/F"], { windowsHide: true }, expect.any(Function))
    expect(child.kill).not.toHaveBeenCalled()
  })

  it("decodes a check mark split across UTF-8 buffers", async () => {
    const result = probe.refresh("hermes")
    const bytes = Buffer.from("OpenAI Codex  ✓ logged in\n")
    child.stdout.write(bytes.subarray(0, 15))
    child.stdout.write(bytes.subarray(15))
    await vi.advanceTimersByTimeAsync(100)
    expect(settled).toHaveBeenCalledWith("hermes", true)
    expect(await result).toBe(true)
  })

  it("allows a cold Hermes startup to report login after eight seconds", async () => {
    const result = probe.refresh("hermes")
    await vi.advanceTimersByTimeAsync(9_000)
    expect(settled).not.toHaveBeenCalled()
    child.stdout.write("OpenAI Codex  ✓ logged in\n")
    await vi.advanceTimersByTimeAsync(100)
    expect(settled).toHaveBeenCalledWith("hermes", true)
    expect(await result).toBe(true)
  })

  it("does not infer signed out from an incomplete status report", async () => {
    const result = probe.refresh("hermes")
    child.stdout.write("◆ Auth Providers\nNous Portal  ✗ not logged in\n")
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await result).toBe(null)
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it("still reports signed out when the complete status exits cleanly", async () => {
    const result = probe.refresh("hermes")
    child.stdout.write("Nous Portal  ✗ not logged in\nOpenAI Codex  ✗ not logged in\n")
    child.emit("close", 0)
    expect(await result).toBe(false)
  })
})
