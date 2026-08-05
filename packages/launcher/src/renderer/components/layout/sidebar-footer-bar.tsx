import React from "react"
import {
  Activity,
  HelpCircle,
  Languages,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { useSidebar } from "@renderer/components/ui/sidebar"
import { StatusDot } from "@renderer/components/ui-kit"
import { useAgentsStore, useDaemonStatus } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
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
 * The rail's identity row: daemon health and version at rest, with the
 * low-frequency controls (theme, tour, settings) folded into its menu instead
 * of sitting on the rail as three permanent icons.
 */
function StatusMenu(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const launcherVersion = useAgentsStore((s) => s.launcherVersion)
  const status = useDaemonStatus()
  const startTour = useUiStore((s) => s.startTour)
  const collapsed = useSidebar().state === "collapsed"
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )
  const language = (i18n.resolvedLanguage ?? i18n.language) as LanguageCode
  // The trigger wears the mode it is currently set to, so the submenu does not
  // have to be opened to read the answer.
  const ModeIcon = THEME_MODES.find((m) => m.id === mode)?.icon ?? Monitor

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

  return (
    <DropdownMenu>
      <div className="flex w-full items-center gap-2 rounded-md p-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
        {/* Daemon health and version are a readout, not a control — only the ⋯
            opens the menu. Collapsed there is no room for it, so the status
            chip takes the job over; exactly one trigger exists either way. */}
        {collapsed ? (
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("nav.menu.label")}
              className="rounded-md transition-opacity hover:opacity-80"
            >
              {statusChip}
            </button>
          </DropdownMenuTrigger>
        ) : (
          <>
            {statusChip}

            {/* One centred line between the two controls. Stacked and
                left-aligned, two short strings sat against the chip and left
                the right half of a 264px rail empty; stacked and centred they
                were two short lines instead of one. Side by side they fill the
                slot and the row loses a line of height — the widest case,
                "Daemon stopped · v0.10.12", is 143px of the 168px available.
                The version can grow a prerelease tag, so the label is the one
                that gives way. */}
            <span className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5">
              <span className="truncate text-2xs font-medium text-sidebar-foreground">
                {label}
              </span>
              <span aria-hidden className="shrink-0 text-3xs text-sidebar-muted">
                ·
              </span>
              {/* Already carries its own `v` — the hooks that fill the store
                  prefix it on the way in (see useAgents / usePythonStatus). */}
              <span className="shrink-0 text-3xs text-sidebar-muted">
                {launcherVersion || "v?"}
              </span>
            </span>

            <DropdownMenuTrigger asChild>
              {/* Same footprint as the status chip opposite it — unequal flanks
                  would pull the centred text off the row's true centre. */}
              <button
                type="button"
                aria-label={t("nav.menu.label")}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
          </>
        )}
      </div>

      {/* Opens beside the rail, not over it: stacked on top the panel covered
          the nav it belongs to and sat flush against the window's rounded
          corner. `end` keeps its bottom edge on the row that opened it. */}
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-48"
      >
        {/* Both preference lists are folded into submenus: spelled out, six
            radio items pushed the one thing people open this menu for — the
            tour — off the bottom of a menu that is mostly settings they set
            once. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-xs">
            <ModeIcon className="size-3.5" />
            {t("nav.themeToggle")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-xs">
            <Languages className="size-3.5" />
            {t("settings.sections.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={language}
              onValueChange={(v) => void changeLanguage(v as LanguageCode)}
            >
              {/* Endonyms — a language is listed in its own words, so it stays
                  findable when the UI is in one you cannot read. */}
              {SUPPORTED_LANGUAGES.map((l) => (
                <DropdownMenuRadioItem key={l.value} value={l.value} className="text-xs">
                  {l.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

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
      <StatusMenu />
    </div>
  )
}
