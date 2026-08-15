import React from "react"

import { useThemeStore } from "@renderer/store/theme"
import { cn } from "@renderer/lib/utils"

/**
 * The OpenAgents mark. One component so the rail, the About card and anything
 * added later cannot drift onto different artwork.
 *
 * The mark ships as a black and a white cut-out (`src/renderer/public/`),
 * referenced RELATIVELY: production loads index.html over file://, where a
 * leading slash resolves to the filesystem root.
 */
export function BrandMark({
  className,
  variant = "auto",
}: {
  /** Size it with `size-*`; the logo is transparent and needs no backdrop. */
  className?: string
  /**
   * Which cut-out to paint. `auto` follows the theme and is right on any
   * surface built from the theme tokens. Pin it to `white` on the surfaces
   * that stay dark in both themes — the rail and the onboarding sidebar — and
   * to `black` on ones that stay light.
   */
  variant?: "auto" | "black" | "white"
}): React.JSX.Element {
  const resolved = useThemeStore((s) => s.resolved)
  const dark = variant === "auto" ? resolved === "dark" : variant === "white"

  return (
    <img
      src={dark ? "logo-white.png" : "logo-black.png"}
      alt="OpenAgents"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  )
}
