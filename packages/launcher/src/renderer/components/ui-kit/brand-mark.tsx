import React from "react"

import { cn } from "@renderer/lib/utils"

/**
 * The OpenAgents mark. One component so the rail, the About card and anything
 * added later cannot drift onto different artwork.
 *
 * The file is `src/renderer/public/logo.png` (a 256px copy of the app icon in
 * `assets/`), referenced RELATIVELY: production loads index.html over file://,
 * where a leading slash resolves to the filesystem root.
 */
export function BrandMark({
  className,
}: {
  /** Size it with `size-*`; the logo is transparent and needs no backdrop. */
  className?: string
}): React.JSX.Element {
  return (
    <img
      src="logo.png"
      alt="OpenAgents"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  )
}
