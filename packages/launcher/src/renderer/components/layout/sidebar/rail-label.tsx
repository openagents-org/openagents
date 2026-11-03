import React from "react"

/**
 * In the icon rail a nav entry is its icon over a short word, the way a
 * messenger's side rail reads, rather than a bare icon only its tooltip names.
 * The rail is wide enough for that because it also holds the macOS traffic
 * lights (see `--rail-icon-width`).
 *
 * The overrides undo the 32px square shadcn's menu button becomes in the rail.
 */
export const RAIL_BUTTON =
  "group-data-[collapsible=icon]:!h-auto group-data-[collapsible=icon]:!w-full group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:!px-0.5 group-data-[collapsible=icon]:!py-2"

/** The entry's name: in full beside the icon, the short word under it in the rail. */
export function RailLabel({ label, short }: { label: string; short: string }): React.JSX.Element {
  return (
    <>
      <span className="truncate group-data-[collapsible=icon]:hidden">{label}</span>
      <span className="hidden w-full truncate text-center text-xs group-data-[collapsible=icon]:block">{short}</span>
    </>
  )
}
