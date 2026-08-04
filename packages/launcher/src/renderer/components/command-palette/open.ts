/**
 * Replays ⌘K so the globally-mounted palette opens; it owns its own state, so a
 * trigger anywhere in the app just re-sends the shortcut it already listens for.
 */
export function openCommandPalette(): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }),
  )
}
