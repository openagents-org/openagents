/**
 * Every visual skin the launcher ships, in one table.
 *
 * A skin is a whole-app repaint — tokens, frames, typeface — activated by
 * `[data-skin="<id>"]` on <html> and resolved entirely in CSS. It is orthogonal
 * to the light/dark mode rather than a third mode: every skin ships both, so
 * all combinations are reachable.
 *
 * Shared between processes on purpose. The renderer needs the list to draw the
 * picker and to know which accent a skin pins itself to; main needs the same
 * skin's surface colours to paint the startup splash before any renderer
 * exists. Keeping one table is what stops those two from drifting — the dark
 * pair of a skin and the default's are far enough apart that a mismatch is
 * visible as the window changing colour under the splash on launch.
 *
 * ---------------------------------------------------------------------------
 * ADDING A SKIN — four steps, none of them in a component:
 *
 *   1. `src/renderer/styles/skin-<id>.css`, everything keyed off
 *      `:root[data-skin='<id>']` so the other skins stay untouched.
 *   2. `@import` it from globals.css.
 *   3. One entry below. `SkinId`, the settings picker, the accent-lock notice
 *      and the splash all widen from it automatically.
 *   4. `skins.<id>.name` / `.desc` in every locale under
 *      `settings.appearance` (en + zh today).
 *
 * What deliberately does NOT need touching: the store, the picker, the preview
 * tile, the splash. If a new skin needs a change in any of those, the thing it
 * needs is probably a new field here.
 * ---------------------------------------------------------------------------
 */

/**
 * The handful of colours a skin can be identified by without loading its
 * stylesheet: what the splash paints itself with, and what the settings
 * preview tile draws a miniature app out of.
 *
 * Duplicating a few values out of the skin's CSS is the bargain that makes
 * both callers possible — the splash runs before a stylesheet can be read, and
 * the preview has to show a skin the app is NOT currently wearing, which is
 * exactly what design tokens cannot do.
 */
export interface SkinChrome {
  /** Page background. */
  bg: string
  /** Primary text. */
  title: string
  /** Secondary text. */
  msg: string
  /** Faint text and filler. */
  detail: string
  /** Cards and panels that sit on top of `bg`. */
  panel: string
  /** The left rail — usually the darkest (or whitest) surface in the theme. */
  rail: string
  /** What the skin draws container frames in. */
  border: string
  /** Offset block under a container, or null where shadows are soft/absent. */
  shadow: string | null
}

/** Container geometry, in px — the part of a skin visible at thumbnail size. */
export interface SkinFrame {
  radius: number
  borderWidth: number
}

export interface SkinDefinition {
  id: string
  /**
   * Accent preset the skin pins itself to, or null to leave the user's own
   * pick alone. Named presets live in globals.css as `--accent-<name>`; the
   * store writes this straight into `data-accent`, which is what makes the
   * lock flow through the existing preset machinery (hover, tint, border,
   * link, `--primary`, `--ring`, the sidebar) instead of fighting it.
   */
  lockedAccent: string | null
  chrome: { light: SkinChrome; dark: SkinChrome }
  frame: SkinFrame
  /**
   * Typeface the skin sets, used only to render its own name in the picker so
   * the tile shows the type as well as the colours. null keeps the app font.
   * The @font-face lives in the skin's stylesheet, which is imported
   * unconditionally, so the family resolves even while the skin is off.
   */
  fontFamily: string | null
}

export const SKINS = [
  {
    id: 'default',
    lockedAccent: null,
    chrome: {
      light: {
        bg: '#f2f2f7',
        title: '#1c1c1e',
        msg: '#636366',
        detail: '#aeaeb2',
        panel: '#ffffff',
        rail: '#ffffff',
        border: '#dcdce3',
        shadow: null,
      },
      dark: {
        bg: '#0f1115',
        title: '#f5f5f7',
        msg: '#a1a1aa',
        detail: '#6b6f7a',
        panel: '#1c1f26',
        rail: '#0e1117',
        border: '#2a2e38',
        shadow: null,
      },
    },
    frame: { radius: 8, borderWidth: 1 },
    fontFamily: null,
  },
  {
    id: 'openagents',
    /* The site's teal, declared as `--accent-oa` in globals.css alongside the
       eight user-facing presets and deliberately absent from ACCENT_COLORS: it
       is not a choice, so it is not a swatch. */
    lockedAccent: 'oa',
    chrome: {
      light: {
        bg: '#f9fafb',
        title: '#0a0a0a',
        msg: '#525252',
        detail: '#a3a3a3',
        panel: '#ffffff',
        rail: '#ffffff',
        border: '#000000',
        shadow: '#000000',
      },
      dark: {
        bg: '#121a2c',
        title: '#f2f5fa',
        msg: '#9fabc4',
        detail: '#6b7791',
        panel: '#1b2440',
        rail: '#0d1424',
        border: '#e6ecf8',
        /* Black in dark mode too, not mirrored to white: an offset block only
           reads as a second object if it is darker than the surface behind it.
           Same call the stylesheet makes for `--skin-ink-shadow`. */
        shadow: 'rgba(0, 0, 0, 0.92)',
      },
    },
    frame: { radius: 6, borderWidth: 2 },
    fontFamily: 'Inter Variable',
  },
] as const satisfies readonly SkinDefinition[]

export type SkinId = (typeof SKINS)[number]['id']

export const DEFAULT_SKIN: SkinId = 'default'

export const SKIN_IDS: SkinId[] = SKINS.map((s) => s.id)

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && (SKIN_IDS as string[]).includes(value)
}

/** The named skin, or the default one — never undefined, so callers that came
 *  from stored state (settings.json, localStorage) need no guard of their own. */
export function getSkin(id: unknown): SkinDefinition {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]
}
