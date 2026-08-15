/**
 * Which device drove the last interaction.
 *
 * Radix hands focus back to the trigger when an overlay closes, and Chromium
 * counts that programmatic focus as keyboard focus — so a menu opened and
 * dismissed with the mouse leaves its trigger wearing the global
 * `:focus-visible` outline until something else is clicked. That is what makes
 * the rail's ⋯ button look stuck in a selected state after picking a theme or
 * a language.
 *
 * Overlays consult this to decide whether returning focus is worth a ring:
 * keyboard users need it (it is their place in the page), pointer users never
 * asked for it.
 */
let keyboardDriven = false

if (typeof window !== "undefined") {
  // Capture phase so the flag is already correct by the time Radix's own
  // handlers run on the same event.
  window.addEventListener("keydown", () => (keyboardDriven = true), true)
  window.addEventListener("pointerdown", () => (keyboardDriven = false), true)
}

export function isKeyboardDriven(): boolean {
  return keyboardDriven
}
