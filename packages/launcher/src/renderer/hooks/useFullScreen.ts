import React from "react"

/**
 * Mirrors the window's full-screen state onto `<html data-fullscreen>`, which
 * is what collapses `--titlebar-h` (see globals.css).
 *
 * An attribute rather than React state: the strip is consumed by the rail, the
 * page inset, the onboarding overlay and the update banner, and threading a
 * boolean through all four to recompute the same number is more moving parts
 * than one custom property being redefined.
 *
 * Mount once, from the shell.
 */
export function useFullScreen(): void {
  React.useEffect(() => {
    const apply = (on: boolean): void => {
      // Absent rather than "false" when windowed: the selector matches on the
      // value, and leaving no attribute behind keeps the DOM honest about the
      // default case.
      if (on) document.documentElement.dataset.fullscreen = "true"
      else delete document.documentElement.dataset.fullscreen
    }
    // Older preload, or no bridge in tests — the windowed layout is correct.
    return window.api?.onFullScreenChange?.(apply)
  }, [])
}
