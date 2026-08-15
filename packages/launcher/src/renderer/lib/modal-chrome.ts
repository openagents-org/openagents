/**
 * Dims the OS-drawn window buttons while a modal is open.
 *
 * Windows and Linux draw minimise/maximise/close above everything the page
 * paints, so a dialog's scrim goes right under them and they stay bright over a
 * dimmed app — the one thing on screen that still looks live. Main repaints the
 * overlay in the scrim's own colour when told; this decides when to tell it.
 *
 * Driven by the DOM rather than by React, deliberately. The obvious version —
 * a counter incremented when a dialog mounts and decremented when it unmounts —
 * hangs off Radix unmounting the content, which it only does after the exit
 * animation reports back. Anything that stops that report (reduced motion, a
 * stylesheet that has not loaded, a tab that was backgrounded mid-animation)
 * leaves the counter above zero and the buttons dark for the rest of the
 * session, with no dialog on screen to explain why. `data-state` flips to
 * "closed" the instant the dialog closes, whatever happens afterwards, so
 * reading it is both simpler and impossible to strand.
 */

/** Radix stamps both, and both scrim the page. */
const OPEN_MODAL =
  '[data-slot="dialog-content"][data-state="open"],' +
  '[data-slot="alert-dialog-content"][data-state="open"]'

/**
 * macOS tints its own traffic lights and has no overlay to repaint. No preload
 * (tests, a browser) is treated the same way: nothing to dim.
 */
function hasOverlay(): boolean {
  return !!window.api && window.api.platform !== "darwin"
}

let lastSent: boolean | null = null

function sync(): void {
  const dim = !!document.querySelector(OPEN_MODAL)
  if (dim === lastSent) return
  lastSent = dim
  // `?.` for the older preload of a renderer reloaded after an update: a
  // missing method must not take the page down with it.
  void window.api.setChromeDimmed?.(dim)?.catch(() => {})
}

/**
 * Starts watching. Call once, from the renderer entry — the observer outlives
 * every component, which is the point. The returned function stops it again;
 * the app never needs to, but a test that leaves one running outlives the DOM
 * it was reading.
 */
export function initModalChrome(): () => void {
  if (!hasOverlay()) return () => {}
  // A reload lands here with main still holding whatever the previous page
  // last said, so the first sync has to be unconditional.
  lastSent = null
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-state"],
  })
  return () => observer.disconnect()
}
