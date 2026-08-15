import { useEffect, useState } from "react"

/** How long each spotlight holds before the next one slides in. */
const INTERVAL_MS = 7000

/**
 * Auto-rotation for the marketplace banner.
 *
 * The timer is keyed on the current index rather than started once, so every
 * slide gets a full interval — including one the user just picked by hand,
 * which would otherwise flip away a moment after they chose it.
 */
export function useHeroCarousel(
  count: number,
  paused: boolean,
): { index: number; select: (i: number) => void } {
  const [index, setIndex] = useState(0)

  // The candidate list shrinks as agents get installed; snap back rather than
  // pointing past the end of it.
  useEffect(() => {
    setIndex((i) => (i < count ? i : 0))
  }, [count])

  useEffect(() => {
    if (count < 2 || paused || prefersReducedMotion()) return
    const id = window.setTimeout(
      () => setIndex((i) => (i + 1) % count),
      INTERVAL_MS,
    )
    return () => window.clearTimeout(id)
  }, [count, paused, index])

  return { index: count > 0 ? Math.min(index, count - 1) : 0, select: setIndex }
}

/**
 * Content that moves on its own is exactly what this setting asks us not to
 * do, so the banner holds on one agent instead. Guarded for jsdom, which
 * ships no matchMedia.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}
