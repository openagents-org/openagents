import {
  Bell,
  Bot,
  Cog,
  Download,
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
  | "agents"
  | "notifications"
  | "network"
  | "data"
  | "language"
  | "updates"
  | "runtime"
  | "about"

export type SectionGroupId =
  | "preferences"
  | "assistants"
  | "connectivity"
  | "system"

export interface Section {
  id: SectionId
  icon: LucideIcon
}

/**
 * The overview grid: modules grouped by what the user came to change, not by
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
    ],
  },
  {
    id: "assistants",
    sections: [
      { id: "agents", icon: Bot },
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
      { id: "about", icon: Info },
    ],
  },
]

/** Flat list in overview order — deep links validate against it. */
export const SECTIONS: Section[] = SECTION_GROUPS.flatMap((g) => g.sections)

/**
 * "Related settings" shortcuts at the foot of a module. Two at most — a third
 * suggestion is never the one anyone wanted, and the row stops reading as a
 * recommendation and starts reading as a second navigation bar. Only listed
 * for the modules whose detail screen has been designed; the rest omit the
 * block rather than guess at a pairing.
 */
export const RELATED: Partial<Record<SectionId, SectionId[]>> = {
  general: ["appearance", "runtime"],
  appearance: ["general", "language"],
  notifications: ["agents", "updates"],
  network: ["data", "runtime"],
  data: ["network", "runtime"],
  language: ["appearance", "general"],
  agents: ["general", "notifications"],
  updates: ["runtime", "about"],
  runtime: ["updates", "data"],
  about: ["updates", "runtime"],
}
