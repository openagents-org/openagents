import { describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

import type { MemoryScan } from "@renderer/types"
import { useOnboardingMemory } from "./use-onboarding-memory"

vi.mock("@renderer/lib/analytics", () => ({ capture: vi.fn() }))

const scan: MemoryScan = {
  agent: "claude-1", type: "claude", tool: "Claude Code", supported: true, importedAt: null, dismissedAt: null,
  items: [
    { id: "claude:global", tool: "claude", kind: "instructions", label: "Global", source: "~/.claude/CLAUDE.md", files: [], fileCount: 1, bytes: 1, status: "loaded", secret: false, selected: false },
    { id: "p1", tool: "claude", kind: "memory", label: "Project memory: shop", source: "~/code/shop", files: [], fileCount: 2, bytes: 9, status: "importable", secret: false, selected: true },
    { id: "p2", tool: "claude", kind: "memory", label: "Project memory: api", source: "~/code/api", files: [], fileCount: 1, bytes: 9, status: "importable", secret: true, selected: false },
  ],
}

function installApi(result: MemoryScan = scan) {
  const api = {
    memoryScan: vi.fn().mockResolvedValue(result),
    memoryImport: vi.fn().mockResolvedValue({ at: "now", tool: "Claude Code", files: 2, counts: { memory: 1 }, items: [{ id: "p1", label: "Project memory: shop", kind: "memory", tool: "claude", source: "~/code/shop", files: 2 }] }),
    memoryUndo: vi.fn().mockResolvedValue({ removed: 2, restored: 0, items: 1 }),
    memoryDismiss: vi.fn().mockResolvedValue({ dismissedAt: "now" }),
    memoryPreview: vi.fn().mockResolvedValue([]),
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

describe("useOnboardingMemory — bring your memory after creating the agent", () => {
  it("scans the new agent, preselects what is safe, and imports only the pick", async () => {
    const api = installApi()
    const { result } = renderHook(() =>
      useOnboardingMemory({ active: true, agentName: "claude-1", showToast: vi.fn(), onDone: vi.fn() }),
    )
    await waitFor(() => expect(result.current.scan).not.toBeNull())
    expect(api.memoryScan).toHaveBeenCalledWith("claude-1")
    expect([...result.current.picked]).toEqual(["p1"])
    expect(result.current.pickedCount).toBe(1)

    await act(() => result.current.importPicked())
    expect(api.memoryImport).toHaveBeenCalledWith("claude-1", ["p1"])
    expect(result.current.receipt?.files).toBe(2)
  })

  it("moves on by itself when the installed core cannot import memory", async () => {
    installApi({ ...scan, supported: false, outdated: true, items: [] })
    const onDone = vi.fn()
    renderHook(() => useOnboardingMemory({ active: true, agentName: "claude-1", showToast: vi.fn(), onDone }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it("skipping tells the device, so the workspace stops offering it", async () => {
    const api = installApi()
    const onDone = vi.fn()
    const { result } = renderHook(() =>
      useOnboardingMemory({ active: true, agentName: "claude-1", showToast: vi.fn(), onDone }),
    )
    await waitFor(() => expect(result.current.scan).not.toBeNull())
    await act(() => result.current.skip())
    expect(api.memoryDismiss).toHaveBeenCalledWith("claude-1")
    expect(onDone).toHaveBeenCalled()
  })
})
