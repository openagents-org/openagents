import React from "react"
import {
  Bell,
  Cog,
  Cpu,
  Download,
  ExternalLink,
  Globe,
  HardDrive,
  Languages,
  Palette,
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

export const SECTIONS: Array<{ id: SectionId; icon: React.JSX.Element }> = [
  { id: "general", icon: <Cog className="size-4" /> },
  { id: "appearance", icon: <Palette className="size-4" /> },
  { id: "agents", icon: <Cpu className="size-4" /> },
  { id: "notifications", icon: <Bell className="size-4" /> },
  { id: "network", icon: <Globe className="size-4" /> },
  { id: "data", icon: <HardDrive className="size-4" /> },
  { id: "language", icon: <Languages className="size-4" /> },
  { id: "updates", icon: <Download className="size-4" /> },
  { id: "runtime", icon: <Cpu className="size-4" /> },
  { id: "about", icon: <ExternalLink className="size-4" /> },
]

/** Radix Select rejects an empty item value, so "no default" needs a sentinel. */
export const NO_DEFAULT_AGENT = "__none__"
