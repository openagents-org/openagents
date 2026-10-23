import {
  Bell,
  Cog,
  Download,
  FileText,
  Globe,
  HardDrive,
  Info,
  Languages,
  Palette,
  Terminal,
  type LucideIcon,
} from "lucide-react"

export type SectionId =
  | "general"
  | "appearance"
  | "notifications"
  | "network"
  | "data"
  | "language"
  | "updates"
  | "runtime"
  | "logs"
  | "about"

export type SectionGroupId =
  | "preferences"
  | "connectivity"
  | "system"

export interface Section {
  id: SectionId
  icon: LucideIcon
}

/**
 * The settings menu: modules grouped by what the user came to change, not by
 * which subsystem owns them. Labels and descriptions live in the i18n catalog
 * under `settings.groups.<id>` / `settings.sections.<id>` / `settings.pages.<id>`,
 * so this table stays language-agnostic.
 */
export const SECTION_GROUPS: Array<{
  id: SectionGroupId
  sections: Section[]
}> = [
  {
    id: "preferences",
    sections: [
      { id: "general", icon: Cog },
      { id: "appearance", icon: Palette },
      { id: "language", icon: Languages },
      { id: "notifications", icon: Bell },
    ],
  },
  {
    id: "connectivity",
    sections: [
      { id: "network", icon: Globe },
      { id: "data", icon: HardDrive },
    ],
  },
  {
    id: "system",
    sections: [
      { id: "updates", icon: Download },
      { id: "runtime", icon: Terminal },
      // Where to look when an agent fails; it used to be a top-level page.
      { id: "logs", icon: FileText },
      { id: "about", icon: Info },
    ],
  },
]

/** Flat list in menu order — deep links validate against it. */
export const SECTIONS: Section[] = SECTION_GROUPS.flatMap((g) => g.sections)

/** What Settings opens on. */
export const DEFAULT_SECTION: SectionId = "general"
