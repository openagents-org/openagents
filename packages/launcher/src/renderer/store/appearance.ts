import { create } from 'zustand'

import { DEFAULT_SKIN, SKIN_IDS, getSkin, type SkinId } from '../../shared/skins'

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

/**
 * Visual skin — a whole-app repaint, one entry per skin in shared/skins.ts.
 * Re-exported here because every consumer already reaches for this store; the
 * table itself lives in shared/ so the main process can read it too.
 */
export type Skin = SkinId

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
const SKIN_KEY = 'launcher:skin'

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
 *
 * It is the EFFECTIVE accent that goes over, not the stored one — otherwise a
 * user running the skin gets a splash in the preset they picked months ago,
 * then a window in brand blue. The skin goes over for the same reason: it
 * moves the splash's surface colour too (`SPLASH_CHROME` in main/index.ts),
 * and dark default vs dark skin are far enough apart to see the seam.
 */
function syncMain(accent: string, skin: Skin): void {
  try {
    void window.api?.setSetting?.('accent', accent)
    void window.api?.setSetting?.('skin', skin)
  } catch {
    /* Older preload, or no bridge in tests — the page still themes itself. */
  }
}

interface Applied {
  accent: AccentColor
  scale: UiScale
  animations: boolean
  highContrast: boolean
  skin: Skin
}

/**
 * The accent actually painted: the skin's own while it pins one, the user's
 * preset otherwise. Their stored choice is never overwritten, only shadowed,
 * so leaving the skin restores it without having to remember it anywhere
 * separate.
 */
function effectiveAccent({ accent, skin }: Pick<Applied, 'accent' | 'skin'>): string {
  return getSkin(skin).lockedAccent ?? accent
}

function apply(state: Applied): void {
  if (typeof document === 'undefined') return
  const { scale, animations, highContrast, skin } = state
  const root = document.documentElement
  root.dataset.accent = effectiveAccent(state)
  root.dataset.uiScale = scale
  // Like `animations` below: the default skin carries no rules, so it leaves
  // no attribute behind either.
  if (skin === DEFAULT_SKIN) delete root.dataset.skin
  else root.dataset.skin = skin
  // Only the off/high states carry a rule, so the default leaves no attribute
  // behind for a stylesheet to trip over.
  if (animations) delete root.dataset.animations
  else root.dataset.animations = 'off'
  if (highContrast) root.dataset.contrast = 'high'
  else delete root.dataset.contrast
}

/** What a fresh install looks like; also what `reset()` restores. */
export const DEFAULT_APPEARANCE: Applied = {
  accent: 'indigo',
  scale: 'md',
  animations: true,
  highContrast: false,
  skin: DEFAULT_SKIN,
}

interface AppearanceState extends Applied {
  setAccent: (a: AccentColor) => void
  setScale: (s: UiScale) => void
  setAnimations: (on: boolean) => void
  setHighContrast: (on: boolean) => void
  setSkin: (s: Skin) => void
  /** Back to DEFAULT_APPEARANCE, repainted and mirrored to main. */
  reset: () => void
  init: () => void
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  accent: readStored<AccentColor>(ACCENT_KEY, ACCENT_COLORS, DEFAULT_APPEARANCE.accent),
  scale: readStored<UiScale>(SCALE_KEY, UI_SCALES, DEFAULT_APPEARANCE.scale),
  animations: readFlag(ANIMATIONS_KEY, DEFAULT_APPEARANCE.animations),
  highContrast: readFlag(CONTRAST_KEY, DEFAULT_APPEARANCE.highContrast),
  skin: readStored<Skin>(SKIN_KEY, SKIN_IDS, DEFAULT_APPEARANCE.skin),

  setAccent: (accent) => {
    try {
      localStorage.setItem(ACCENT_KEY, accent)
    } catch {}
    const next = { ...get(), accent }
    apply(next)
    syncMain(effectiveAccent(next), next.skin)
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

  // Also re-syncs main: flipping the skin changes the effective accent, so the
  // splash has to be told even though the user touched no swatch.
  setSkin: (skin) => {
    try {
      localStorage.setItem(SKIN_KEY, skin)
    } catch {}
    const next = { ...get(), skin }
    apply(next)
    syncMain(effectiveAccent(next), next.skin)
    set({ skin })
  },

  // One write, one paint, one sync — going through the five setters would
  // repaint five times and leave main holding an intermediate accent.
  reset: () => {
    try {
      localStorage.setItem(ACCENT_KEY, DEFAULT_APPEARANCE.accent)
      localStorage.setItem(SCALE_KEY, DEFAULT_APPEARANCE.scale)
      localStorage.setItem(SKIN_KEY, DEFAULT_APPEARANCE.skin)
    } catch {}
    writeFlag(ANIMATIONS_KEY, DEFAULT_APPEARANCE.animations)
    writeFlag(CONTRAST_KEY, DEFAULT_APPEARANCE.highContrast)
    apply(DEFAULT_APPEARANCE)
    syncMain(effectiveAccent(DEFAULT_APPEARANCE), DEFAULT_APPEARANCE.skin)
    set({ ...DEFAULT_APPEARANCE })
  },

  // Re-asserted on every boot, not just on change: this is what gives main a
  // copy for users who picked their accent before it was ever mirrored, and
  // what repairs a settings.json that has drifted from localStorage.
  init: () => {
    apply(get())
    syncMain(effectiveAccent(get()), get().skin)
  },
}))
