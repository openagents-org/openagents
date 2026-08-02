import React from "react"
import {
  Activity,
  Download,
  HelpCircle,
  Monitor,
  Moon,
  MoreHorizontal,
  Sun,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { StatusDot } from "@renderer/components/ui-kit"
import { useAgentsStore, useDaemonStatus } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import { useThemeStore, type ThemeMode } from "@renderer/store/theme"
import { useUpdateCount } from "@renderer/hooks/useUpdateCount"

const THEME_MODES = [
  { id: "light", icon: Sun },
  { id: "dark", icon: Moon },
  { id: "system", icon: Monitor },
] as const

/**
 * Pending agent updates, surfaced where the rail has room to explain them —
 * the nav badge alone only ever showed a number. Hidden when nothing is due,
 * and collapsed away with the rest of the labels.
 */
function UpdateCard(): React.JSX.Element | null {
  const { t } = useTranslation()
  const count = useUpdateCount()
  const goToInstallList = useUiStore((s) => s.goToInstallList)

  if (count === 0) return null

  return (
    <button
      type="button"
      onClick={goToInstallList}
      className="w-full rounded-md border border-sidebar-border bg-sidebar-accent/40 p-2.5 text-left transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
    >
      <span className="flex items-center gap-1.5 text-2xs font-semibold text-warning">
        <Download className="size-3 shrink-0" />
        {t("nav.updates.title", { count })}
      </span>
      <span className="mt-1 block text-3xs text-sidebar-muted">
        {t("nav.updates.body")}
      </span>
    </button>
  )
}

/**
 * The rail's identity row: daemon health and version at rest, with the
 * low-frequency controls (theme, tour, settings) folded into its menu instead
 * of sitting on the rail as three permanent icons.
 */
function StatusMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const launcherVersion = useAgentsStore((s) => s.launcherVersion)
  const status = useDaemonStatus()
  const startTour = useUiStore((s) => s.startTour)
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )

  const label =
    status === "running"
      ? t("nav.daemon.running")
      : status === "starting"
        ? t("nav.daemon.starting")
        : status === "stopped"
          ? t("nav.daemon.stopped")
          : t("nav.daemon.offline")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={t("nav.menu.label")}
          className="flex w-full items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        >
          <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-foreground">
            <Activity className="size-3.5" />
            {/* `stopped` is a deliberate state, not a fault — StatusDot renders
                it in the same muted tone as offline, which is the intent. */}
            <StatusDot
              state={status}
              className="absolute -right-0.5 -bottom-0.5 ring-2 ring-sidebar"
            />
          </span>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-2xs font-medium text-sidebar-foreground">
              {label}
            </span>
            <span className="block truncate text-3xs text-sidebar-muted">
              {launcherVersion || "v?"}
            </span>
          </span>
          <MoreHorizontal className="size-3.5 shrink-0 text-sidebar-muted group-data-[collapsible=icon]:hidden" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-52">
        <DropdownMenuLabel className="text-2xs text-muted-foreground">
          {t("nav.themeToggle")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as ThemeMode)}
        >
          {THEME_MODES.map(({ id, icon: Icon }) => (
            <DropdownMenuRadioItem key={id} value={id} className="text-xs">
              <Icon className="size-3.5" />
              {t(`settings.appearance.modes.${id}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        {/* No Settings entry: the rail already has one in the System group. */}
        <DropdownMenuItem className="text-xs" onSelect={() => startTour()}>
          <HelpCircle className="size-3.5" />
          {t("nav.guide")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SidebarFooterBar(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-t border-sidebar-border pt-2">
      <UpdateCard />
      <StatusMenu />
    </div>
  )
}
