import { create } from 'zustand'

/**
 * Appearance preferences that are pure presentation — accent colour and UI
 * scale. Both are applied as data attributes on <html> and resolved entirely
 * in CSS (see the accent/UI-scale blocks in globals.css), so no component has
 * to know they exist.
 *
 * Persisted in localStorage next to the theme mode rather than settings.json:
 * they must be applied on the very first paint, and settings.json is only
 * reachable through async IPC.
 */
export type AccentColor =
  | 'indigo'
  | 'blue'
  | 'teal'
  | 'green'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'slate'

export type UiScale = 'sm' | 'md' | 'lg'

export const ACCENT_COLORS: AccentColor[] = [
  'indigo',
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'rose',
  'slate',
]

export const UI_SCALES: UiScale[] = ['sm', 'md', 'lg']

const ACCENT_KEY = 'launcher:accent'
const SCALE_KEY = 'launcher:ui-scale'

function readStored<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key) as T | null
    if (raw && allowed.includes(raw)) return raw
  } catch {}
  return fallback
}

function apply(accent: AccentColor, scale: UiScale): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.accent = accent
  document.documentElement.dataset.uiScale = scale
}

interface AppearanceState {
  accent: AccentColor
  scale: UiScale
  setAccent: (a: AccentColor) => void
  setScale: (s: UiScale) => void
  init: () => void
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  accent: readStored<AccentColor>(ACCENT_KEY, ACCENT_COLORS, 'indigo'),
  scale: readStored<UiScale>(SCALE_KEY, UI_SCALES, 'md'),

  setAccent: (accent) => {
    try {
      localStorage.setItem(ACCENT_KEY, accent)
    } catch {}
    apply(accent, get().scale)
    set({ accent })
  },

  setScale: (scale) => {
    try {
      localStorage.setItem(SCALE_KEY, scale)
    } catch {}
    apply(get().accent, scale)
    set({ scale })
  },

  init: () => {
    const { accent, scale } = get()
    apply(accent, scale)
  },
}))
