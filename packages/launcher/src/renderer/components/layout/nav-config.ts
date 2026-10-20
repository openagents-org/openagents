import {
  Bot,
  FileText,
  Layers,
  Settings,
  type LucideIcon,
} from "lucide-react"

export type NavSection = "manage" | "system"

export interface NavItem {
  id: string
  icon: LucideIcon
  section: NavSection
}

/**
 * Labels and tooltips live in the i18n catalog under `nav.items.<id>`; this
 * table carries only icon and grouping so it stays language-agnostic.
 *
 * Connect Agents (`dashboard`, the id kept so saved startup pages and deep
 * links still land) is the one way to agents: it lists this computer's agents,
 * starts every new one, and absorbed both the device overview and the
 * marketplace entry. The marketplace page itself has no row any more; its
 * counters and update notifications still open it. This row carries the agent
 * update count the marketplace row used to.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", icon: Bot, section: "manage" },
  { id: "workspaces", icon: Layers, section: "manage" },
  // `connections` is hidden for now — none of the platform options work yet.
  // The page itself still exists; put the row back here once they do.
  { id: "logs", icon: FileText, section: "system" },
  { id: "settings", icon: Settings, section: "system" },
]

export const NAV_SECTIONS: NavSection[] = ["manage", "system"]

/**
 * Ctrl+1..9 jump targets: the rail in order, then screens with no rail entry
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
