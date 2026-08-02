import {
  Cpu,
  Download,
  FileText,
  LayoutDashboard,
  Layers,
  Plug,
  Settings,
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
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", icon: LayoutDashboard, section: "overview" },
  { id: "install", icon: Download, section: "manage" },
  { id: "agents", icon: Cpu, section: "manage" },
  { id: "workspaces", icon: Layers, section: "manage" },
  { id: "connections", icon: Plug, section: "manage" },
  { id: "logs", icon: FileText, section: "system" },
  { id: "settings", icon: Settings, section: "system" },
]

export const NAV_SECTIONS: NavSection[] = ["overview", "manage", "system"]

/**
 * Ctrl+1..9 jump targets. Ordered by the page list rather than by `NAV_ITEMS`
 * because it also covers screens with no rail entry (credentials, github).
 */
export const SHORTCUT_TABS = [
  "dashboard",
  "agents",
  "workspaces",
  "connections",
  "credentials",
  "github",
  "install",
  "logs",
  "settings",
]
