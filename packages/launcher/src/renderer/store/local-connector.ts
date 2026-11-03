import { create } from 'zustand'

type SetResult = { success: boolean; message?: string }

interface LocalConnectorState {
  /** Whether the local connector runs; null until first read. */
  enabled: boolean | null
  /** A switch is in flight. */
  busy: boolean
  /** An open "turn it on?" question, answered by LocalConnectorPrompt. */
  prompt: ((accepted: boolean) => void) | null
  load: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<SetResult>
  /**
   * Resolve true when the connector runs, asking to turn it on when it does
   * not. For actions that need it — starting an agent — and that must not
   * switch it on behind the user's back, since doing so starts every agent.
   */
  ensureOn: () => Promise<boolean>
}

export const useLocalConnectorStore = create<LocalConnectorState>((set, get) => ({
  enabled: null,
  busy: false,
  prompt: null,

  load: async () => {
    // The main process answers null until its agent manager has loaded, which
    // at launch is after the window. Unknown must not read as off — it would
    // flash the "connector is off" banner — so ask again shortly.
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const enabled = await window.api.getLocalConnector()
        if (enabled !== null) return set({ enabled })
      } catch {
        // Same as not loaded yet.
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  },

  setEnabled: async (enabled) => {
    set({ busy: true })
    try {
      const result = await window.api.setLocalConnector(enabled)
      set({ enabled: result.enabled })
      return result
    } catch (err) {
      return { success: false, message: String(err) }
    } finally {
      set({ busy: false })
    }
  },

  ensureOn: async () => {
    if (get().enabled === null) await get().load()
    if (get().enabled !== false) return true
    return new Promise<boolean>((resolve) => {
      set({
        prompt: (accepted) => {
          set({ prompt: null })
          resolve(accepted)
        },
      })
    })
  },
}))

/** Read the connector once and follow it wherever it is switched from. */
export function initLocalConnector(): void {
  void useLocalConnectorStore.getState().load()
  window.api.onLocalConnectorChanged((enabled) => useLocalConnectorStore.setState({ enabled }))
}
