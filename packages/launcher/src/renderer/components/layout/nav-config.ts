import {
  Bot,
  Layers,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  id: string
  icon: LucideIcon
}

/**
 * This Computer's two pages in the sidebar — Connect Agents and Connected
 * Workspaces. Labels and tooltips live in the i18n catalog
 * under `nav.items.<id>`; this table carries only the icon (the guided tour
 * shows it) so it stays language-agnostic.
 *
 * Connect Agents (`dashboard`, the id kept so saved startup pages and deep
 * links still land) is the one way to agents: it lists this computer's agents,
 * starts every new one, and absorbed both the device overview and the
 * marketplace entry. The marketplace page itself has no entry; its update
 * notifications still open it. This entry carries the agent update count.
 *
 * Settings is not here: it is its own entry in the sidebar, unfolding in place.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", icon: Bot },
  { id: "workspaces", icon: Layers },
  // `connections` is hidden for now — none of the platform options work yet.
  // The page itself still exists; put the entry back here once they do.
]

/**
 * Ctrl+1..9 jump targets: the sidebar's pages in order, then settings and the
 * screens with no entry (github). `credentials` is left out on purpose — the
 * page is unfinished and has no exposed entry.
 */
export const SHORTCUT_TABS = [
  "dashboard",
  "workspaces",
  "settings",
  "github",
]
