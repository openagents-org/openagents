import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'launcher:theme-mode'

export const DEFAULT_THEME_MODE: ThemeMode = 'system'

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {}
  return DEFAULT_THEME_MODE
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return mode
}

function apply(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

/**
 * Hand the mode to the main process, which themes the OS-drawn window frame —
 * without this a dark app keeps a light Windows title bar.
 *
 * The *mode* goes over, not the resolved theme: `system` is a value
 * `nativeTheme.themeSource` understands, and letting Electron follow the OS
 * itself keeps the frame in step even while this window is asleep.
 */
function syncNativeFrame(mode: ThemeMode): void {
  try {
    void window.api?.setThemeSource?.(mode)
  } catch {
    /* Older preload, or no bridge in tests — the page still themes itself. */
  }
}

interface ThemeState {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (m: ThemeMode) => void
  /** Back to the default mode, painted and mirrored like any other change. */
  reset: () => void
  init: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readStoredMode(),
  resolved: resolve(readStoredMode()),
  setMode: (mode) => {
    try { localStorage.setItem(STORAGE_KEY, mode) } catch {}
    const resolved = resolve(mode)
    apply(resolved)
    syncNativeFrame(mode)
    set({ mode, resolved })
  },
  reset: () => get().setMode(DEFAULT_THEME_MODE),
  init: () => {
    const { mode } = get()
    const resolved = resolve(mode)
    apply(resolved)
    // Re-asserted on every boot, not just on change: this is what repairs a
    // settings.json that never got one (upgrades) or drifted from localStorage.
    syncNativeFrame(mode)
    set({ resolved })
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (): void => {
        if (get().mode !== 'system') return
        const r = mq.matches ? 'dark' : 'light'
        apply(r)
        set({ resolved: r })
      }
      try { mq.addEventListener('change', handler) } catch {
        mq.addListener(handler)
      }
    }
  },
}))
