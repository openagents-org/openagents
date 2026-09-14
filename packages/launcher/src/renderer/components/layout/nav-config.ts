import {
  FileText,
  LayoutDashboard,
  Layers,
  Settings,
  Store,
  type LucideIcon,
} from "lucide-react"

export type NavSection = "overview" | "manage" | "system"

export interface NavItem {
  id: string
  icon: LucideIcon
  section: NavSection
}

/**
 * Labels and tooltips live in the i18n catalog under `nav.items.<id>`; this
 * table carries only icon and grouping so it stays language-agnostic.
 *
 * No Agents entry: This Computer (`dashboard`) already lists this computer's
 * agents and is where they are created, configured, started and stopped.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", icon: LayoutDashboard, section: "overview" },
  // Installs and updates agents — not OpenAgents itself, whose updates live in
  // Settings → Updates. Carries the agent update count.
  { id: "install", icon: Store, section: "manage" },
  { id: "workspaces", icon: Layers, section: "manage" },
  // `connections` is hidden for now — none of the platform options work yet.
  // The page itself still exists; put the row back here once they do.
  { id: "logs", icon: FileText, section: "system" },
  { id: "settings", icon: Settings, section: "system" },
]

export const NAV_SECTIONS: NavSection[] = ["overview", "manage", "system"]

/**
 * Ctrl+1..9 jump targets: the rail in order, then screens with no rail entry
 * (github). `credentials` is left out on purpose — the page is unfinished and
 * has no exposed entry.
 */
export const SHORTCUT_TABS = [
  "dashboard",
  "install",
  "workspaces",
  "logs",
  "settings",
  "github",
]
