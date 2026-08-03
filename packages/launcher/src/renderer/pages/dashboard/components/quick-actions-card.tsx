import React from "react"
import { ChevronRight, Cpu, FileText, Layers, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Card } from "@renderer/components/ui/card"

interface Props {
  onNavigate: (tab: string) => void
}

/**
 * Shortcuts into the pages the dashboard summarises. Same icons as the rail so
 * a shortcut and its nav entry read as the same destination.
 */
const ACTIONS: { key: string; tab: string; icon: LucideIcon }[] = [
  { key: "manageAgents", tab: "agents", icon: Cpu },
  { key: "viewLogs", tab: "logs", icon: FileText },
  { key: "manageWorkspaces", tab: "workspaces", icon: Layers },
]

export function QuickActionsCard({ onNavigate }: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Card className="gap-3 px-4 py-3.5">
      <h2 className="text-base font-semibold">
        {t("dashboard.quickActions.title")}
      </h2>

      {/* Spread rather than stack: the three cards in this band share a height,
          and a short list bunched at the top left the card looking unfinished. */}
      <div className="flex flex-1 flex-col justify-between gap-2">
        {ACTIONS.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => onNavigate(action.tab)}
            className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent"
          >
            <action.icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {t(`dashboard.quickActions.${action.key}`)}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </Card>
  )
}
