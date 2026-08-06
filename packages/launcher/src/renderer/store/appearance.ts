import { create } from 'zustand'

/**
 * Appearance preferences that are pure presentation — accent colour, UI scale,
 * animations and high contrast. All of them are applied as data attributes on
 * <html> and resolved entirely in CSS (see the appearance blocks in
 * globals.css), so no component has to know they exist.
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
const ANIMATIONS_KEY = 'launcher:animations'
const CONTRAST_KEY = 'launcher:high-contrast'

function readStored<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key) as T | null
    if (raw && allowed.includes(raw)) return raw
  } catch {}
  return fallback
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === 'on') return true
    if (raw === 'off') return false
  } catch {}
  return fallback
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {}
}

/**
 * Mirror the accent into settings.json, where the main process can see it.
 *
 * It paints the startup splash before any renderer exists, so localStorage —
 * the source of truth for everything in this store — is unreachable at the one
 * moment the colour is needed. Same arrangement `language` (i18n/index.ts) and
 * the theme mode (store/theme.ts) already use, and the only preference here
 * that main has any use for; scale, animations and contrast stay renderer-side.
 */
function syncMain(accent: AccentColor): void {
  try {
    void window.api?.setSetting?.('accent', accent)
  } catch {
    /* Older preload, or no bridge in tests — the page still themes itself. */
  }
}

interface Applied {
  accent: AccentColor
  scale: UiScale
  animations: boolean
  highContrast: boolean
}

function apply({ accent, scale, animations, highContrast }: Applied): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.accent = accent
  root.dataset.uiScale = scale
  // Only the off/high states carry a rule, so the default leaves no attribute
  // behind for a stylesheet to trip over.
  if (animations) delete root.dataset.animations
  else root.dataset.animations = 'off'
  if (highContrast) root.dataset.contrast = 'high'
  else delete root.dataset.contrast
}

interface AppearanceState extends Applied {
  setAccent: (a: AccentColor) => void
  setScale: (s: UiScale) => void
  setAnimations: (on: boolean) => void
  setHighContrast: (on: boolean) => void
  init: () => void
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  accent: readStored<AccentColor>(ACCENT_KEY, ACCENT_COLORS, 'indigo'),
  scale: readStored<UiScale>(SCALE_KEY, UI_SCALES, 'md'),
  animations: readFlag(ANIMATIONS_KEY, true),
  highContrast: readFlag(CONTRAST_KEY, false),

  setAccent: (accent) => {
    try {
      localStorage.setItem(ACCENT_KEY, accent)
    } catch {}
    apply({ ...get(), accent })
    syncMain(accent)
    set({ accent })
  },

  setScale: (scale) => {
    try {
      localStorage.setItem(SCALE_KEY, scale)
    } catch {}
    apply({ ...get(), scale })
    set({ scale })
  },

  setAnimations: (animations) => {
    writeFlag(ANIMATIONS_KEY, animations)
    apply({ ...get(), animations })
    set({ animations })
  },

  setHighContrast: (highContrast) => {
    writeFlag(CONTRAST_KEY, highContrast)
    apply({ ...get(), highContrast })
    set({ highContrast })
  },

  // Re-asserted on every boot, not just on change: this is what gives main a
  // copy for users who picked their accent before it was ever mirrored, and
  // what repairs a settings.json that has drifted from localStorage.
  init: () => {
    apply(get())
    syncMain(get().accent)
  },
}))
