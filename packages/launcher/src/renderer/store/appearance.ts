import { create } from 'zustand'

/**
 * Appearance preferences that are pure presentation — UI scale, animations and
 * high contrast. All of them are applied as data attributes on <html> and
 * resolved entirely in CSS (see the appearance blocks in globals.css), so no
 * component has to know they exist.
 *
 * There is no accent or skin choice: the app wears shadcn's neutral palette in
 * both themes. The OpenAgents skin was dropped because the embedded workspace
 * cannot follow it, and the window read as two different apps.
 *
 * Persisted in localStorage next to the theme mode rather than settings.json:
 * they must be applied on the very first paint, and settings.json is only
 * reachable through async IPC.
 */
export type UiScale = 'sm' | 'md' | 'lg'

export const UI_SCALES: UiScale[] = ['sm', 'md', 'lg']

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

interface Applied {
  scale: UiScale
  animations: boolean
  highContrast: boolean
}

function apply(state: Applied): void {
  if (typeof document === 'undefined') return
  const { scale, animations, highContrast } = state
  const root = document.documentElement
  root.dataset.uiScale = scale
  // Only the off/high states carry a rule, so the default leaves no attribute
  // behind for a stylesheet to trip over.
  if (animations) delete root.dataset.animations
  else root.dataset.animations = 'off'
  if (highContrast) root.dataset.contrast = 'high'
  else delete root.dataset.contrast
}

/** What a fresh install looks like; also what `reset()` restores. */
export const DEFAULT_APPEARANCE: Applied = {
  scale: 'md',
  animations: true,
  highContrast: false,
}

interface AppearanceState extends Applied {
  setScale: (s: UiScale) => void
  setAnimations: (on: boolean) => void
  setHighContrast: (on: boolean) => void
  /** Back to DEFAULT_APPEARANCE, repainted. */
  reset: () => void
  init: () => void
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  scale: readStored<UiScale>(SCALE_KEY, UI_SCALES, DEFAULT_APPEARANCE.scale),
  animations: readFlag(ANIMATIONS_KEY, DEFAULT_APPEARANCE.animations),
  highContrast: readFlag(CONTRAST_KEY, DEFAULT_APPEARANCE.highContrast),

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

  // One write, one paint — going through the setters would repaint three times.
  reset: () => {
    try {
      localStorage.setItem(SCALE_KEY, DEFAULT_APPEARANCE.scale)
    } catch {}
    writeFlag(ANIMATIONS_KEY, DEFAULT_APPEARANCE.animations)
    writeFlag(CONTRAST_KEY, DEFAULT_APPEARANCE.highContrast)
    apply(DEFAULT_APPEARANCE)
    set({ ...DEFAULT_APPEARANCE })
  },

  init: () => {
    apply(get())
  },
}))
