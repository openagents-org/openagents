import { useEffect } from "react"

/**
 * macOS tints its own traffic lights and has no overlay to repaint, so there is
 * nothing to say there. Read once — preload hands `platform` over as a value.
 * No preload at all (tests, a browser) is treated the same way: no window to
 * dim, so the dialogs are left alone.
 */
const HAS_OVERLAY = !!window.api && window.api.platform !== "darwin"

/**
 * Modals currently mounted. Counted rather than flagged because they stack: a
 * confirmation opened on top of a form closes first, and the chrome has to stay
 * dimmed until the form underneath closes too.
 */
let openModals = 0

function publish(next: number): void {
  const was = openModals > 0
  openModals = Math.max(0, next)
  const dim = openModals > 0
  // `?.` for the older preload of a running app whose renderer was reloaded
  // after an update: a missing method must not take the dialog down with it.
  if (was !== dim) void window.api.setChromeDimmed?.(dim)?.catch(() => {})
}

/**
 * Dims the OS-drawn window buttons for as long as the caller is mounted.
 *
 * Called by the dialog primitives themselves rather than by each dialog: the
 * scrim is theirs, and the buttons have to go dark with it. Windows draws them
 * above everything the page paints, so without this they stayed bright over a
 * dimmed app — the one thing on screen that still looked live.
 */
export function useDimWindowChrome(): void {
  useEffect(() => {
    if (!HAS_OVERLAY) return
    publish(openModals + 1)
    return () => publish(openModals - 1)
  }, [])
}
