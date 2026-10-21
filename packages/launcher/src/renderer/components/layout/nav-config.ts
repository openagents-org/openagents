import {
  Bot,
  FileText,
  Layers,
  Settings,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  id: string
  icon: LucideIcon
}

/**
 * This Computer's pages, as tabs along the second row of the window. Labels and
 * tooltips live in the i18n catalog under `nav.items.<id>`; this table carries
 * only the icon (the guided tour shows it) so it stays language-agnostic.
 *
 * Connect Agents (`dashboard`, the id kept so saved startup pages and deep
 * links still land) is the one way to agents: it lists this computer's agents,
 * starts every new one, and absorbed both the device overview and the
 * marketplace entry. The marketplace page itself has no tab; its update
 * notifications still open it. This tab carries the agent update count.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", icon: Bot },
  { id: "workspaces", icon: Layers },
  // `connections` is hidden for now — none of the platform options work yet.
  // The page itself still exists; put the tab back here once they do.
  { id: "logs", icon: FileText },
  { id: "settings", icon: Settings },
]

/**
 * Ctrl+1..9 jump targets: the tabs in order, then screens with no tab
 * (github). `credentials` is left out on purpose — the page is unfinished and
 * has no exposed entry.
 */
export const SHORTCUT_TABS = [
  "dashboard",
  "workspaces",
  "logs",
  "settings",
  "github",
]
