import React from "react"
import { useTranslation } from "react-i18next"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@renderer/components/ui/sidebar"
import { BrandMark } from "@renderer/components/ui-kit"
import { SidebarNav } from "./sidebar-nav"
import { SidebarSearch } from "./sidebar-search"
import { SidebarFooterBar } from "./sidebar-footer-bar"
import { NotificationBell } from "./notification-bell"
import { SidebarToggle } from "./sidebar-toggle"

/**
 * Brand row. Collapsed, the wordmark drops and the row stacks so the logo and
 * the bell each keep a full icon slot in the narrow rail.
 *
 * Expanded, the row is 40px tall and vertically centres its contents, which
 * puts the logo on the same line as the window buttons across the seam on the
 * far side of the app. Collapsed it goes back to auto height — the stacked logo
 * and bell need two rows, not one 40px one.
 *
 * `h-10`, not `h-(--titlebar-h)`, even though the two match: this is the app's
 * own header, so it should scale with Settings → Appearance → UI scale, and it
 * must survive full screen collapsing the strip to zero.
 *
 * The collapsed padding lives here rather than on the header, which already
 * carries the platform's own inset — putting both there would mean one
 * overriding the other, and on macOS the loser is the traffic lights' clearance.
 */
function Brand(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex h-10 min-w-0 items-center gap-2.5 px-1 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:pt-2">
      {/* Follows the theme, like the rail behind it. Pinning this to the white
          cut-out was right only while the rail was always dark — on the light
          rail it disappears into the background. */}
      <BrandMark className="size-7" />
      {/* Same key the About card uses, so the rail and Settings never disagree
          about what the app is called. It stays on one line at every UI scale
          because the rail is sized in rem — see RAIL_WIDTH. */}
      <span
        className="truncate text-base font-semibold tracking-tight text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
        title={t("settings.about.productName")}
      >
        {t("settings.about.productName")}
      </span>
      <NotificationBell className="sidebar-no-drag ml-auto group-data-[collapsible=icon]:ml-0" />
      {/* Collapsed, this is the one control that gets the rail back, so it has
          to be in the rail rather than in the content area beside it. */}
      <SidebarToggle className="sidebar-no-drag" />
    </div>
  )
}

export function AppSidebar(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    // `sidebar-drag` makes the rail a window drag handle (Electron); every
    // interactive child re-enables pointer events via `sidebar-no-drag`.
    <Sidebar
      collapsible="icon"
      className="sidebar-drag h-screen border-r border-sidebar-border select-none"
    >
      {/* Draggable, unlike the rest of the rail: it is the band the window
          buttons sit in, so grabbing it has to move the window. The two
          interactive things inside opt back out.

          The inset is the traffic lights' clearance on macOS and zero
          everywhere else, where the buttons are over the content area instead.
          Nothing more is needed above the expanded brand row: it is 40px tall
          and lines up with the buttons on its own. */}
      <SidebarHeader className="sidebar-drag gap-2 pt-(--rail-top-inset)">
        <Brand />
        <div className="sidebar-no-drag">
          <SidebarSearch />
        </div>
      </SidebarHeader>
      <SidebarContent className="sidebar-no-drag">
        <SidebarNav />
      </SidebarContent>
      <SidebarFooter className="sidebar-no-drag">
        <SidebarFooterBar />
      </SidebarFooter>
      {/* The hairline between rail and content collapses it too — kept for the
          people who already grab edges, but no longer the only way in: nothing
          about a 2px seam says it can be clicked, which is why the header now
          carries a button. ⌘B does it from the keyboard. */}
      <SidebarRail
        className="sidebar-no-drag"
        title={t("nav.toggleSidebar")}
        aria-label={t("nav.toggleSidebar")}
      />
    </Sidebar>
  )
}
