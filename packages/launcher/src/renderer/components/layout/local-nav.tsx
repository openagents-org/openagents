import React from "react"
import { Plus, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { useUiStore } from "@renderer/store/ui"
import { useAccountStore } from "@renderer/store/account"
import { useWorkspaceTabsStore } from "@renderer/store/workspace-tabs"
import { useUpdateCount } from "@renderer/hooks/useUpdateCount"
import { capture } from "@renderer/lib/analytics"
import { cn } from "@renderer/lib/utils"
import { NAV_ITEMS } from "./nav-config"
import type { WorkspaceTab } from "../../../shared/workspace-view"

/** Chips shown before the rest fold into a menu; the page tabs need the room. */
const VISIBLE_CHIPS = 3

/** This Computer's pages, underlined when current. */
function PageTabs(): React.JSX.Element {
  const { t } = useTranslation()
  const { currentTab, setCurrentTab } = useUiStore(
    useShallow((s) => ({ currentTab: s.currentTab, setCurrentTab: s.setCurrentTab })),
  )
  const updateCount = useUpdateCount()
  // The marketplace has no tab of its own; it is reached from Connect Agents,
  // so that tab stays lit while it is open.
  const activeId = currentTab === "install" ? "dashboard" : currentTab

  return (
    <nav role="tablist" aria-label={t("nav.pages")} className="flex items-stretch gap-2 self-stretch">
      {NAV_ITEMS.map((item) => {
        const active = activeId === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-tour={item.id}
            data-testid={`nav-${item.id}`}
            title={t(`nav.items.${item.id}.description`)}
            onClick={() => {
              capture("tab_switched", { tab: item.id })
              setCurrentTab(item.id)
            }}
            // Bold and padded wide: new users looked straight past Connect
            // Agents when these read like plain links.
            className={cn(
              "relative flex min-w-24 items-center justify-center gap-1.5 rounded-t-md px-4 text-[15px] font-semibold transition-colors",
              "after:absolute after:inset-x-2 after:bottom-0 after:h-0.75 after:rounded-full",
              active
                ? "text-primary after:bg-primary"
                : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {t(`nav.items.${item.id}.label`)}
            {item.id === "dashboard" && updateCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-3xs font-bold text-primary-foreground">
                {updateCount}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

/** The open tabs to show as chips, keeping the last-used one among them. */
function splitChips(tabs: WorkspaceTab[], last: string | null): [WorkspaceTab[], WorkspaceTab[]] {
  if (tabs.length <= VISIBLE_CHIPS) return [tabs, []]
  const shown = tabs.slice(0, VISIBLE_CHIPS)
  const current = tabs.find((tab) => tab.id === last)
  if (current && !shown.includes(current)) shown[VISIBLE_CHIPS - 1] = current
  return [shown, tabs.filter((tab) => !shown.includes(tab))]
}

function WorkspaceChip({ tab, current }: { tab: WorkspaceTab; current: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        "flex h-7 max-w-48 min-w-0 items-center gap-1 rounded-md pr-1 pl-2.5 text-xs transition-colors",
        current ? "bg-(--accent-bg) text-primary" : "bg-muted text-foreground hover:bg-muted/70",
      )}
    >
      <button
        type="button"
        className="min-w-0 truncate"
        title={tab.title}
        data-testid="open-workspace-chip"
        onClick={() => useWorkspaceTabsStore.getState().activate(tab.id)}
      >
        {tab.title}
      </button>
      <button
        type="button"
        aria-label={t("workspaceTabs.close", { name: tab.title })}
        title={t("workspaceTabs.close", { name: tab.title })}
        onClick={() => useWorkspaceTabsStore.getState().close(tab.id)}
        className="flex size-5 shrink-0 items-center justify-center rounded opacity-70 transition-colors hover:bg-foreground/10 hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/**
 * The workspaces open on the Workspace side, kept in reach from here: a chip
 * switches over to that tab, its cross closes it, and + opens All Workspaces.
 * Past a few, the rest fold into a menu rather than crowding the page tabs.
 */
function OpenWorkspaces(): React.JSX.Element {
  const { t } = useTranslation()
  const tabs = useWorkspaceTabsStore((s) => s.tabs)
  const last = useWorkspaceTabsStore((s) => s.active)
  const account = useAccountStore((s) => s.account)

  React.useEffect(() => { useWorkspaceTabsStore.getState().init() }, [])

  const [shown, folded] = splitChips(tabs, last)
  const moreLabel = t("workspaceTabs.more", { count: folded.length })

  return (
    <div className="flex min-w-0 items-center gap-2">
      {shown.map((tab) => <WorkspaceChip key={tab.id} tab={tab} current={tab.id === last} />)}
      {folded.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" aria-label={moreLabel} title={moreLabel}
              data-testid="open-workspace-more">
              +{folded.length}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-64">
            {folded.map((tab) => (
              <DropdownMenuItem key={tab.id} onSelect={() => useWorkspaceTabsStore.getState().activate(tab.id)}>
                <span className="truncate">{tab.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {account && (
        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          aria-label={t("account.workspaces.title")}
          title={t("account.workspaces.title")}
          onClick={() => useAccountStore.getState().openWorkspaces()}
        >
          <Plus />
        </Button>
      )}
    </div>
  )
}

/** The second row on the This Computer side: its pages, then open workspaces. */
export function LocalNav(): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-6 self-stretch">
      <PageTabs />
      <OpenWorkspaces />
    </div>
  )
}
