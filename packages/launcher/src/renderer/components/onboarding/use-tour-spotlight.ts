import { useEffect, useState } from "react"

/** Breathing room between the highlighted control and the cut-out edge. */
const PADDING = 6

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export interface Spotlight {
  /** Cut-out in the mask, in viewport coordinates. */
  hole: Box
  /** Viewport, tracked here so the bubble re-clamps on every resize. */
  vw: number
  vh: number
}

/**
 * Where the bubble lands if the anchor cannot be measured (the rail is hidden,
 * the page has not painted yet). A sliver at the top-left keeps the tour usable
 * instead of dropping it off-screen.
 */
const FALLBACK: Box = { top: 80, left: 8, width: 220, height: 44 }

function measure(anchor: string): Box {
  const el = document.querySelector(`[data-tour="${anchor}"]`)
  if (!el) return FALLBACK
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return FALLBACK
  return {
    top: Math.max(0, r.top - PADDING),
    left: Math.max(0, r.left - PADDING),
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
  }
}

function viewport(): { vw: number; vh: number } {
  return { vw: window.innerWidth, vh: window.innerHeight }
}

/**
 * Tracks the rectangle the tour cuts out of its mask.
 *
 * Re-measures on the things that actually move a sidebar item: the tab switch
 * that precedes each step (two rAFs, so layout has settled), window resizes,
 * and the rail collapsing — the last one is a width transition on the anchor
 * itself, which is why a ResizeObserver is wired to the element rather than
 * just to the window.
 */
export function useTourSpotlight(anchor: string | null): Spotlight {
  const [spotlight, setSpotlight] = useState<Spotlight>(() => ({
    hole: FALLBACK,
    ...viewport(),
  }))

  useEffect(() => {
    if (!anchor) return
    let raf = 0
    const sync = (): void => setSpotlight({ hole: measure(anchor), ...viewport() })

    sync()
    raf = requestAnimationFrame(() => requestAnimationFrame(sync))
    window.addEventListener("resize", sync)

    const el = document.querySelector(`[data-tour="${anchor}"]`)
    const observer = el ? new ResizeObserver(sync) : null
    if (el && observer) observer.observe(el)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", sync)
      observer?.disconnect()
    }
  }, [anchor])

  return spotlight
}
