/**
 * The app's own window chrome: theme source, the Windows/Linux window-controls
 * overlay, the tray fallback icon, and the palette the startup splash paints
 * itself in before any renderer exists.
 */
import { BrowserWindow, nativeImage, nativeTheme } from "electron"
import { getSkin } from "../shared/skins"

export function createPlaceholderIcon(): Electron.NativeImage {
  const size = 16
  const canvas = Buffer.alloc(size * size * 4)
  const cx = 7.5,
    cy = 7.5,
    r = 7,
    ri = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      if (d <= r) {
        if (d <= ri) {
          canvas[i] = 0xff
          canvas[i + 1] = 0xff
          canvas[i + 2] = 0xff
          canvas[i + 3] = 0xff
        } else {
          canvas[i] = 0x6c
          canvas[i + 1] = 0x63
          canvas[i + 2] = 0xff
          canvas[i + 3] = 0xff
        }
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size })
}

/**
 * Point Electron's native theme at the app's own theme setting.
 *
 * Only the three values `nativeTheme.themeSource` accepts are honoured; an
 * absent or unrecognised stored value falls back to `system`, which is the
 * renderer's default too.
 */
export function applyThemeSource(mode: unknown): void {
  nativeTheme.themeSource =
    mode === "dark" || mode === "light" ? mode : "system"
}

/**
 * Height of the strip the app reserves along its top edge, in device-independent
 * pixels. Windows draws the minimise/maximise/close buttons inside it; the
 * renderer keeps the same number in `--titlebar-h` and pads the content area by
 * it, so nothing ever renders underneath the buttons.
 *
 * Fixed px on both sides on purpose. The renderer's UI-scale setting moves the
 * root font size, and a `rem` here would drift away from the overlay, which
 * Electron only accepts in real pixels.
 */
export const TITLEBAR_HEIGHT = 40

/**
 * Whether a modal is currently up in the renderer. See `setChromeDimmed`.
 */
let chromeDimmed = false

/**
 * A colour with the dialog overlay laid over it — `bg-black/50`, the same 50%
 * black the renderer paints across the page, applied by hand because the
 * buttons are not part of the page.
 */
function dimmed(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (shift: number): number => ((n >> shift) & 0xff) >> 1
  const out = (mix(16) << 16) | (mix(8) << 8) | mix(0)
  return `#${out.toString(16).padStart(6, "0")}`
}

/**
 * The Windows/Linux window-controls overlay, coloured to match whatever is
 * behind it — `--background`, the content area's surface. Without this the
 * buttons sit on a grey system-drawn plate and the seam is exactly what
 * replacing the title bar was meant to remove.
 *
 * macOS has no overlay: its traffic lights are positioned instead, at window
 * creation, and AppKit tints them itself.
 */
export function titleBarOverlayColors(): {
  color: string
  symbolColor: string
  height: number
} {
  const dark = nativeTheme.shouldUseDarkColors
  const color = dark ? "#0f1115" : "#f2f2f7"
  const symbolColor = dark ? "#f5f5f7" : "#1c1c1e"
  return {
    color: chromeDimmed ? dimmed(color) : color,
    symbolColor: chromeDimmed ? dimmed(symbolColor) : symbolColor,
    height: TITLEBAR_HEIGHT,
  }
}

/** Repaint the overlay after a theme change. No-op where there isn't one. */
export function refreshTitleBarOverlay(win: BrowserWindow | null): void {
  if (process.platform === "darwin") return
  if (!win || win.isDestroyed()) return
  try {
    win.setTitleBarOverlay(titleBarOverlayColors())
  } catch {
    /* Linux desktops without overlay support — the frame is fine as-is. */
  }
}

/**
 * Dim the window buttons along with the rest of the app while a dialog is open.
 *
 * The dialog's scrim is a layer in the page, and these buttons are not in the
 * page — Windows draws them over everything the renderer paints, so they stayed
 * at full strength while the app behind them went dark, which read as the one
 * live thing on a disabled screen. Repainting the overlay in the scrimmed
 * colour is the only way to include them.
 *
 * The flag is remembered rather than passed through, so a theme change while a
 * dialog is open repaints in the dimmed palette instead of undoing it.
 */
export function setChromeDimmed(win: BrowserWindow | null, dim: boolean): void {
  if (chromeDimmed === dim) return
  chromeDimmed = dim
  refreshTitleBarOverlay(win)
}

/**
 * The accent presets, as flat hex. Mirrors the `--accent-*` triples in
 * globals.css (light takes the 600 step of each Tailwind ramp, dark the 400) —
 * the two lists must be edited together. Duplicated rather than imported
 * because the renderer's stylesheet is not reachable from the main process,
 * and the splash below is painted before any renderer exists.
 */
const ACCENT_HEX = {
  light: {
    indigo: "#4f46e5",
    blue: "#2563eb",
    teal: "#0d9488",
    green: "#16a34a",
    amber: "#e6950a",
    orange: "#ea580c",
    rose: "#e11d48",
    slate: "#475569",
    /* The skin's locked accent — teal, the colour this very progress bar
       draws in. Not a user-selectable preset, but it arrives here through the
       same door as the others, because the appearance store mirrors the
       EFFECTIVE accent rather than the stored one. Without an entry the lookup
       below would fall back to indigo and the splash would come up violet in
       front of a teal app. Keep in step with `--accent-oa` in globals.css. */
    oa: "#0d9488",
  },
  dark: {
    indigo: "#818cf8",
    blue: "#60a5fa",
    teal: "#2dd4bf",
    green: "#4ade80",
    amber: "#fbbf24",
    orange: "#fb923c",
    rose: "#fb7185",
    slate: "#94a3b8",
    oa: "#2dd4bf",
  },
} as const

/**
 * Colours for the startup splash, resolved from the user's stored theme and
 * accent so the first thing the app draws is already in their palette.
 *
 * Both preferences live in the renderer's localStorage (they must be readable
 * synchronously, on the first paint) and are mirrored into settings.json
 * purely so this function can see them — `themeMode` by the `theme:set-source`
 * handler, `accent` and `skin` by the appearance store. A missing or
 * unrecognised value falls back to the defaults, which is also what a fresh
 * install gets.
 *
 * Call only after `applyThemeSource()`, so `shouldUseDarkColors` reflects the
 * app's own setting rather than the bare OS one.
 */
export function splashPalette(prefs: { accent: unknown; skin: unknown }): {
  bg: string
  title: string
  msg: string
  detail: string
  accent: string
  track: string
} {
  const scheme = nativeTheme.shouldUseDarkColors ? "dark" : "light"
  const accents = ACCENT_HEX[scheme]
  const stored = prefs.accent
  const accent =
    typeof stored === "string" && stored in accents
      ? accents[stored as keyof typeof accents]
      : accents.indigo
  // Straight from the shared skin table, so a skin added there gets a splash
  // in its own colours without a second table to remember. An unknown id (an
  // older build reading a newer settings.json) falls back to the default skin.
  const { bg, title, msg, detail } = getSkin(prefs.skin).chrome[scheme]
  return {
    bg,
    title,
    msg,
    detail,
    accent,
    // Same relationship the in-app <Progress> uses (`bg-primary/20` track under
    // a `bg-primary` bar), expressed as an 8-digit hex because there is no
    // Tailwind here. `33` = 20% alpha.
    track: `${accent}33`,
  }
}
