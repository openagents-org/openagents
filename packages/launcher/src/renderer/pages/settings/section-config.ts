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

/**
 * Rail order. Labels and descriptions live in the i18n catalog under
 * `settings.sections.<id>` / `settings.pages.<id>`, so this table stays
 * language-agnostic.
 */
export const SECTIONS: Array<{ id: SectionId; icon: LucideIcon }> = [
  { id: "general", icon: Cog },
  { id: "appearance", icon: Palette },
  { id: "agents", icon: Bot },
  { id: "notifications", icon: Bell },
  { id: "network", icon: Globe },
  { id: "data", icon: HardDrive },
  { id: "language", icon: Languages },
  { id: "updates", icon: Download },
  { id: "runtime", icon: Terminal },
  { id: "about", icon: Info },
]
