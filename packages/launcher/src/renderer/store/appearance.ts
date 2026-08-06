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

/**
 * Visual skin. `openagents` aligns the launcher with openagents.org —
 * neo-brutalism over Inter; see styles/skin-openagents.css for what it repaints
 * and why. Orthogonal to the light/dark mode rather than a third mode: the skin
 * ships both, so all four combinations are reachable.
 */
export type Skin = 'default' | 'openagents'

export const SKINS: Skin[] = ['default', 'openagents']

/**
 * The accent the openagents skin pins itself to — the site's #2F6BFF, declared
 * as `--accent-oa` in globals.css alongside the eight user-facing presets.
 *
 * Locking the accent is done by writing this as `data-accent` rather than by
 * overriding `--accent` from the skin stylesheet. `:root[data-accent]` derives
 * a dozen values from whichever preset is live — hover, tint, border, link,
 * `--primary`, `--ring`, the sidebar and the row states — so going through the
 * same door gets all of them for free and in the right order. Overriding
 * `--accent` alone would leave every one of those still mixed from the user's
 * old preset.
 *
 * Deliberately absent from ACCENT_COLORS: it is not a choice, so it is not a
 * swatch. The user's own pick stays in the store untouched while the skin is
 * on, and comes back the moment it is switched off.
 */
const BRAND_ACCENT = 'oa'

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
 * The accent actually painted: the skin's brand blue while it is on, the
 * user's own preset otherwise. Their stored choice is never overwritten, only
 * shadowed, so turning the skin off restores it without having to remember it
 * anywhere separate.
 */
function effectiveAccent({ accent, skin }: Pick<Applied, 'accent' | 'skin'>): string {
  return skin === 'openagents' ? BRAND_ACCENT : accent
}

function apply(state: Applied): void {
  if (typeof document === 'undefined') return
  const { scale, animations, highContrast, skin } = state
  const root = document.documentElement
  root.dataset.accent = effectiveAccent(state)
  root.dataset.uiScale = scale
  // Like `animations` below: the default skin carries no rules, so it leaves
  // no attribute behind either.
  if (skin === 'default') delete root.dataset.skin
  else root.dataset.skin = skin
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
  setSkin: (s: Skin) => void
  init: () => void
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  accent: readStored<AccentColor>(ACCENT_KEY, ACCENT_COLORS, 'indigo'),
  scale: readStored<UiScale>(SCALE_KEY, UI_SCALES, 'md'),
  animations: readFlag(ANIMATIONS_KEY, true),
  highContrast: readFlag(CONTRAST_KEY, false),
  skin: readStored<Skin>(SKIN_KEY, SKINS, 'default'),

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

  // Re-asserted on every boot, not just on change: this is what gives main a
  // copy for users who picked their accent before it was ever mirrored, and
  // what repairs a settings.json that has drifted from localStorage.
  init: () => {
    apply(get())
    syncMain(effectiveAccent(get()), get().skin)
  },
}))
