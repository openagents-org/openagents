import { create } from 'zustand'

const STORAGE_KEY = 'workspace-prefs:v1'

interface PersistShape {
  lastUsedAt: Record<string, string>        // workspace id → ISO timestamp
  groups: Record<string, string>            // workspace id → group label
}

function load(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { lastUsedAt: {}, groups: {} }
    const parsed = JSON.parse(raw) as Partial<PersistShape>
    return {
      lastUsedAt: parsed.lastUsedAt || {},
      groups: parsed.groups || {},
    }
  } catch {
    return { lastUsedAt: {}, groups: {} }
  }
}

function save(state: PersistShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

interface WorkspacePrefsState {
  lastUsedAt: Record<string, string>
  groups: Record<string, string>
  markUsed: (id: string) => void
  setGroup: (id: string, group: string) => void
}

export const useWorkspacePrefs = create<WorkspacePrefsState>((set, get) => {
  const initial = load()
  return {
    lastUsedAt: initial.lastUsedAt,
    groups: initial.groups,
    markUsed: (id) => {
      const next = { ...get().lastUsedAt, [id]: new Date().toISOString() }
      set({ lastUsedAt: next })
      save({ lastUsedAt: next, groups: get().groups })
    },
    setGroup: (id, group) => {
      const next = { ...get().groups }
      if (group) next[id] = group
      else delete next[id]
      set({ groups: next })
      save({ lastUsedAt: get().lastUsedAt, groups: next })
    },
  }
})
