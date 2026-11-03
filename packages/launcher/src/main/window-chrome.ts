/**
 * The app's own window chrome: theme source, the Windows/Linux window-controls
 * overlay, the tray fallback icon, and the palette the startup splash paints
 * itself in before any renderer exists.
 */
import { BrowserWindow, nativeImage, nativeTheme } from "electron"
import { DEFAULT_THEME_MODE, isThemeMode } from "../shared/appearance-bridge"

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
 * absent or unrecognised stored value falls back to `light`, which is the
 * renderer's default too.
 */
export function applyThemeSource(mode: unknown): void {
  nativeTheme.themeSource =
    isThemeMode(mode) ? mode : DEFAULT_THEME_MODE
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
 * The colours main paints before any renderer exists — the startup splash and
 * the Windows/Linux window-controls overlay. They mirror shadcn's neutral
 * tokens in globals.css (`--background`, `--foreground`, `--muted-foreground`,
 * `--primary`), which main cannot read; keep the two in step.
 */
const CHROME = {
  light: { bg: "#ffffff", title: "#0a0a0a", msg: "#737373", detail: "#a3a3a3", accent: "#171717" },
  dark: { bg: "#0a0a0a", title: "#fafafa", msg: "#a1a1a1", detail: "#737373", accent: "#e5e5e5" },
} as const

/**
 * The Windows/Linux window-controls overlay, coloured as the right-hand end of
 * the header it sits in, which is painted in the page surface
 * (`bg-background`) — as is the content the buttons sit over during
 * onboarding.
 *
 * One pixel shorter than the header, so its bottom border runs on under the
 * buttons instead of stopping where they begin.
 *
 * macOS has no overlay: its traffic lights are positioned instead, at window
 * creation, and AppKit tints them itself.
 */
export function titleBarOverlayColors(): {
  color: string
  symbolColor: string
  height: number
} {
  const scheme = nativeTheme.shouldUseDarkColors ? "dark" : "light"
  const color = CHROME[scheme].bg
  const symbolColor = scheme === "dark" ? "#f5f5f7" : "#1c1c1e"
  return {
    color: chromeDimmed ? dimmed(color) : color,
    symbolColor: chromeDimmed ? dimmed(symbolColor) : symbolColor,
    height: TITLEBAR_HEIGHT - 1,
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
 * Colours for the startup splash, in the app's own theme so the first thing it
 * draws already matches the window that follows.
 *
 * Call only after `applyThemeSource()`, so `shouldUseDarkColors` reflects the
 * app's own setting rather than the bare OS one.
 */
export function splashPalette(): {
  bg: string
  title: string
  msg: string
  detail: string
  accent: string
  track: string
} {
  const palette = CHROME[nativeTheme.shouldUseDarkColors ? "dark" : "light"]
  return {
    ...palette,
    // Same relationship the in-app <Progress> uses (`bg-primary/20` track under
    // a `bg-primary` bar), expressed as an 8-digit hex because there is no
    // Tailwind here. `33` = 20% alpha.
    track: `${palette.accent}33`,
  }
}
