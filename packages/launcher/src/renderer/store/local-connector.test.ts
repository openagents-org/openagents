import { beforeEach, describe, expect, it, vi } from "vitest"

import { useLocalConnectorStore } from "./local-connector"

beforeEach(() => {
  useLocalConnectorStore.setState({ enabled: null, busy: false, prompt: null })
  window.api = {
    getLocalConnector: vi.fn().mockResolvedValue(false),
    setLocalConnector: vi.fn().mockResolvedValue({ success: true, enabled: true }),
  } as unknown as typeof window.api
})

describe("useLocalConnectorStore.ensureOn", () => {
  it("goes ahead without asking when the connector runs", async () => {
    useLocalConnectorStore.setState({ enabled: true })
    await expect(useLocalConnectorStore.getState().ensureOn()).resolves.toBe(true)
    expect(useLocalConnectorStore.getState().prompt).toBeNull()
  })

  it("asks when it is off, and stops when the user declines", async () => {
    useLocalConnectorStore.setState({ enabled: false })
    const answer = useLocalConnectorStore.getState().ensureOn()
    const prompt = useLocalConnectorStore.getState().prompt
    expect(prompt).not.toBeNull()
    prompt!(false)
    await expect(answer).resolves.toBe(false)
    expect(useLocalConnectorStore.getState().prompt).toBeNull()
    expect(window.api.setLocalConnector).not.toHaveBeenCalled()
  })

  it("reads the state first when it is not known yet", async () => {
    const answer = useLocalConnectorStore.getState().ensureOn()
    await vi.waitFor(() => expect(useLocalConnectorStore.getState().prompt).not.toBeNull())
    useLocalConnectorStore.getState().prompt!(true)
    await expect(answer).resolves.toBe(true)
  })
})

describe("useLocalConnectorStore.load", () => {
  it("keeps asking while the main process cannot answer yet", async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(window.api.getLocalConnector).mockResolvedValueOnce(null).mockResolvedValueOnce(true)
      const done = useLocalConnectorStore.getState().load()
      await vi.advanceTimersByTimeAsync(1000)
      await done
      expect(useLocalConnectorStore.getState().enabled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
