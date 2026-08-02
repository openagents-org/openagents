import React from "react"
import { HelpCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/shadcn/button"
import { StatusDot } from "@renderer/components/ui-kit"
import { useAgentsStore, useDaemonStatus } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import { NotificationBell } from "./notification-bell"
import { ThemeToggle } from "./theme-toggle"

function GuideButton(): React.JSX.Element {
  const { t } = useTranslation()
  const startTour = useUiStore((s) => s.startTour)

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => startTour()}
      title={t("nav.guide")}
      aria-label={t("nav.guide")}
      className="size-7 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <HelpCircle className="size-3.5" />
    </Button>
  )
}

/** Daemon health and launcher version — the rail's status strip. */
function DaemonStatus(): React.JSX.Element {
  const { t } = useTranslation()
  const launcherVersion = useAgentsStore((s) => s.launcherVersion)
  const status = useDaemonStatus()

  const label =
    status === "running"
      ? t("nav.daemon.running")
      : status === "starting"
        ? t("nav.daemon.starting")
        : status === "stopped"
          ? t("nav.daemon.stopped")
          : t("nav.daemon.offline")

  return (
    <div
      className="flex items-center gap-2 px-1 text-2xs text-sidebar-muted"
      title={label}
    >
      {/* `stopped` is a deliberate state, not a fault — StatusDot renders it in
          the same muted tone as offline, which is the intent here. */}
      <StatusDot state={status} />
      <span className="truncate">{label}</span>
      <span className="opacity-60">·</span>
      <span className="truncate opacity-60">{launcherVersion || "v?"}</span>
    </div>
  )
}

export function SidebarFooterBar(): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-1 border-t border-sidebar-border pt-2">
        <NotificationBell />
        <ThemeToggle />
        <GuideButton />
      </div>
      <DaemonStatus />
    </>
  )
}
