import React from "react"
import {
  Activity,
  Languages,
  Monitor,
  Moon,
  Sun,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { useSidebar } from "@renderer/components/ui/sidebar"
import { StatusDot } from "@renderer/components/ui-kit"
import { useAgentsStore, useDaemonStatus } from "@renderer/store/agents"
import { useThemeStore, type ThemeMode } from "@renderer/store/theme"
import {
  SUPPORTED_LANGUAGES,
  changeLanguage,
  type LanguageCode,
} from "@renderer/i18n"

const THEME_MODES = [
  { id: "light", icon: Sun },
  { id: "dark", icon: Moon },
  { id: "system", icon: Monitor },
] as const

/**
 * The rail's identity row: daemon health and app version at rest.
 */
function StatusReadout(): React.JSX.Element {
  const { t } = useTranslation()
  const reportedVersion = useAgentsStore((s) => s.launcherVersion)
  const [appVersion, setAppVersion] = React.useState<string | null>(null)
  const status = useDaemonStatus()
  const collapsed = useSidebar().state === "collapsed"

  React.useEffect(() => {
    let active = true
    void window.api.appVersion().then((version) => {
      if (active) setAppVersion(version ? `v${version.replace(/^v/, "")}` : null)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const label =
    status === "running"
      ? t("nav.daemon.running")
      : status === "starting"
        ? t("nav.daemon.starting")
        : status === "stopped"
          ? t("nav.daemon.stopped")
          : t("nav.daemon.offline")

  const statusChip = (
    <span
      title={label}
      className="relative flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-foreground"
    >
      <Activity className="size-3.5" />
      {/* `stopped` is a deliberate state, not a fault — StatusDot renders it in
          the same muted tone as offline, which is the intent. */}
      <StatusDot
        state={status}
        className="absolute -right-0.5 -bottom-0.5 ring-2 ring-sidebar"
      />
    </span>
  )

  if (collapsed) {
    return (
      <div className="flex w-full justify-center" aria-label={label}>
        {statusChip}
      </div>
    )
  }

  return (
    <div className="grid w-full grid-cols-[1.75rem_1fr_1.75rem] items-center gap-2 rounded-md p-1">
      {statusChip}

      {/* One centred line between equal flanks. Stacked and
                left-aligned, two short strings sat against the chip and left
                the right half of a 264px rail empty; stacked and centred they
                were two short lines instead of one. Side by side they fill the
                slot and the row loses a line of height — the widest case,
                "Daemon stopped · v0.10.12", is 143px of the 168px available.
                The version can grow a prerelease tag, so the label is the one
                that gives way. */}
      <span className="flex min-w-0 items-baseline justify-center gap-1.5">
        <span className="truncate text-2xs font-medium text-sidebar-foreground">
          {label}
        </span>
        <span aria-hidden className="shrink-0 text-3xs text-sidebar-muted">
          ·
        </span>
        <span className="shrink-0 text-3xs text-sidebar-muted">
          {appVersion || reportedVersion || "v?"}
        </span>
      </span>

      {/* Empty balancing cell keeps the readout centred after removing the
          unnecessary ellipsis / quick-start menu. */}
      <span aria-hidden />
    </div>
  )
}

/** Visible, compact theme and language controls at the bottom of every page. */
function AppearanceControls(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )
  const language = (i18n.resolvedLanguage ?? i18n.language) as LanguageCode
  const ModeIcon = THEME_MODES.find((m) => m.id === mode)?.icon ?? Monitor
  const languageLabel = SUPPORTED_LANGUAGES.find((l) => l.value === language)?.label ?? language
  const triggerClass = "flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-accent/45 px-2 text-3xs font-medium text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:px-0"

  return (
    <div className="grid grid-cols-2 gap-1.5 group-data-[collapsible=icon]:grid-cols-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={triggerClass} aria-label={t("nav.themeToggle")} title={t("nav.themeToggle")}>
            <ModeIcon className="size-3.5 shrink-0" />
            <span className="truncate group-data-[collapsible=icon]:hidden">{t(`settings.appearance.modes.${mode}`)}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-40">
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as ThemeMode)}
            className="flex flex-col gap-0.5"
          >
            {THEME_MODES.map(({ id, icon: Icon }) => (
              <DropdownMenuRadioItem key={id} value={id} className="text-xs">
                <Icon className="size-3.5" />{t(`settings.appearance.modes.${id}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={triggerClass} aria-label={t("settings.sections.language")} title={t("settings.sections.language")}>
            <Languages className="size-3.5 shrink-0" />
            <span className="truncate group-data-[collapsible=icon]:hidden">{languageLabel}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-36">
          <DropdownMenuRadioGroup
            value={language}
            onValueChange={(v) => void changeLanguage(v as LanguageCode)}
            className="flex flex-col gap-0.5"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <DropdownMenuRadioItem key={l.value} value={l.value} className="text-xs">
                {l.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function SidebarFooterBar(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-t border-sidebar-border pt-2">
      {/* The account row used to sit above this. It moved to the Workspace side
          with everything else about the account — this rail is the machine. */}
      <AppearanceControls />
      <StatusReadout />
    </div>
  )
}
