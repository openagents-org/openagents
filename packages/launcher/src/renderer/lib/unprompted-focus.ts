/**
 * Keeps focus nobody asked for from drawing a focus ring.
 *
 * When the window is activated — at launch, when detached DevTools hands focus
 * back, or when the native workspace view is taken down while it held focus —
 * Chromium moves focus into the page by tab traversal. Traversal counts as
 * keyboard navigation, so the first tabbable element lights up with its
 * `:focus-visible` ring although nobody pressed a key: the notification bell
 * once, the mode bar's first button now.
 *
 * Nothing in the page calls focus() there, so there is no call to remove. The
 * guard instead lets go of focus that lands on a control before the user has
 * pressed a key or a pointer since the page last had focus. Left alone:
 *
 *  - text fields, whose autofocus is how a form says where to type
 *  - anything inside a dialog or menu, which places its own focus on purpose
 *  - the element that held focus when the window lost it, which Chromium
 *    restores on return and a keyboard user expects to find still there
 *
 * `relatedTarget` is deliberately not consulted: traversal into a page that
 * still has an element focused reports that element as the related target,
 * so it cannot tell the page moving focus from the browser doing it.
 */

const TEXT_ENTRY =
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"]),' +
  'textarea, select, [contenteditable=""], [contenteditable="true"]'

const OWNS_FOCUS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/** Marks the throwaway element `release` focuses, so the guard lets it be. */
const PARK = "data-focus-park"

/**
 * Drop focus back to the top of the page.
 *
 * Not a bare blur(): that leaves the next Tab starting AFTER the released
 * element, so a keyboard user's first Tab would skip it. Focusing a throwaway
 * element at the top of the body and removing it moves the starting point back
 * to the top as well.
 */
function release(el: HTMLElement): void {
  const park = document.createElement("span")
  park.setAttribute(PARK, "")
  park.tabIndex = -1
  document.body.prepend(park)
  park.focus({ preventScroll: true })
  park.remove()
  // Removing the focused element returns focus to the body in Chromium. Not in
  // every DOM implementation, and never if the park could not take focus.
  const active = document.activeElement
  if (active instanceof HTMLElement && (active === el || !active.isConnected)) active.blur()
}

/**
 * Starts guarding. Call once, from the renderer entry, before the first render.
 * The returned function stops it again, for tests.
 */
export function initUnpromptedFocusGuard(): () => void {
  let prompted = false
  let heldWhenBlurred: Element | null = null

  const onInput = (): void => {
    prompted = true
  }
  const onWindowBlur = (e: FocusEvent): void => {
    // Only the window's own blur: an element's does not bubble here, but a
    // node-targeted one is still turned away. Compared by kind rather than by
    // `=== window`, which a DOM implementation's window proxy can fail.
    if (e.target instanceof Node) return
    prompted = false
    heldWhenBlurred = document.activeElement
  }
  const onFocusIn = (e: FocusEvent): void => {
    const el = e.target
    if (prompted || !(el instanceof HTMLElement) || el.hasAttribute(PARK)) return
    if (el === heldWhenBlurred || el.matches(TEXT_ENTRY) || el.closest(OWNS_FOCUS)) return
    release(el)
  }

  // Capture phase: a key or pointer press is counted before its own default
  // action moves focus, whatever a component does with the event.
  window.addEventListener("keydown", onInput, true)
  window.addEventListener("pointerdown", onInput, true)
  window.addEventListener("blur", onWindowBlur)
  document.addEventListener("focusin", onFocusIn, true)
  return () => {
    window.removeEventListener("keydown", onInput, true)
    window.removeEventListener("pointerdown", onInput, true)
    window.removeEventListener("blur", onWindowBlur)
    document.removeEventListener("focusin", onFocusIn, true)
  }
}
