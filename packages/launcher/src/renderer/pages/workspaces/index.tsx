import React, { useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { FilterX, Layers, Plus, SearchX } from "lucide-react"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
} from "@renderer/components/ui/empty"
import { EmptyState } from "@renderer/components/ui-kit"
import { WorkspaceCard } from "@renderer/components/workspaces/WorkspaceCard"
import {
  WorkspaceQuickConnect,
  type QuickConnectMode,
} from "@renderer/components/workspaces/WorkspaceQuickConnect"
import { WorkspaceRemoveDialog } from "@renderer/components/workspaces/WorkspaceRemoveDialog"
import { WorkspaceRenameDialog } from "@renderer/components/workspaces/WorkspaceRenameDialog"
import { useConnectionsStore } from "@renderer/store/connections"
import { useUiStore } from "@renderer/store/ui"
import { useWorkspacePrefs } from "@renderer/store/workspace-prefs"
import { workspaceUrl } from "@renderer/lib/workspace-urls"
import type { Workspace } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"
import {
  useWorkspacesData,
  type WorkspaceFilter,
  type WorkspaceSort,
} from "./use-workspaces-data"
import { useWorkspaceActivity } from "./use-workspace-activity"
import { WorkspacesToolbar } from "./components/workspaces-toolbar"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

export default function Workspaces({ showToast }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const refreshConnections = useConnectionsStore((s) => s.refresh)
  const { favorites, toggleFavorite, markUsed } = useWorkspacePrefs(
    useShallow((s) => ({
      favorites: s.favorites,
      toggleFavorite: s.toggleFavorite,
      markUsed: s.markUsed,
    })),
  )
  const pendingCreate = useUiStore((s) => s.pendingCreate)
  const clearPendingCreate = useUiStore((s) => s.clearPendingCreate)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<WorkspaceFilter>("all")
  const [sort, setSort] = useState<WorkspaceSort>("recent")
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickMode, setQuickMode] = useState<QuickConnectMode>("pair")
  const [refreshing, setRefreshing] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Workspace | null>(null)
  const [removing, setRemoving] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Workspace | null>(null)

  const { workspaces, aliases, setAliases, filtered, stats, loading, reload } =
    useWorkspacesData(search, filter, sort)
  const activity = useWorkspaceActivity(workspaces)

  const openQuick = (mode: QuickConnectMode): void => {
    setQuickMode(mode)
    setQuickOpen(true)
  }

  const runRefresh = (): void => {
    setRefreshing(true)
    void reload().finally(() => setRefreshing(false))
  }

  React.useEffect(() => {
    refreshConnections()
  }, [refreshConnections])

  // "Add workspace" from anywhere else — the dashboard, the command palette —
  // lands here with the dialog requested. It opens on the same tab the header
  // button uses, because it is the same button: one label, one door, and
  // creating is the third tab inside it. Clearing the flag keeps a later tab
  // click from re-opening it.
  React.useEffect(() => {
    if (pendingCreate !== "workspace") return
    openQuick("pair")
    clearPendingCreate()
  }, [pendingCreate, clearPendingCreate])

  const copyUrl = async (ws: Workspace): Promise<void> => {
    markUsed(ws.id)
    try {
      await navigator.clipboard.writeText(workspaceUrl(ws))
      showToast(t("workspaces.toast.urlCopied"), "success")
    } catch {
      showToast(t("workspaces.toast.copyFailed"), "error")
    }
  }

  const openInBrowser = (ws: Workspace): void => {
    markUsed(ws.id)
    window.api.openExternal(workspaceUrl(ws))
  }

  const performRemove = async (deleteRemote: boolean): Promise<void> => {
    if (!removeTarget) return
    const ws = removeTarget
    // Same display name the confirm dialog shows.
    const name = aliases[ws.id] || ws.name || ws.slug || ws.id
    setRemoving(true)
    try {
      // No "removing…" progress toast — a single success toast (below) is the
      // only feedback, so a quick remove doesn't stack two notifications.
      await window.api.removeWorkspace(ws.slug || ws.id, { deleteRemote })
      await reload()
      showToast(
        t(
          deleteRemote
            ? "workspaces.toast.deleted"
            : "workspaces.toast.removed",
          { name },
        ),
        "success",
      )
      setRemoveTarget(null)
    } catch (err) {
      showToast(t("workspaces.toast.error", { message: (err as Error).message }), "error")
    } finally {
      setRemoving(false)
    }
  }

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        title={t("workspaces.title")}
        subtitle={t("workspaces.subtitle")}
        actions={
          // One door, not two: both buttons opened the same dialog, so the
          // header printed the same control twice. Creating a workspace is the
          // dialog's third tab, one click further in.
          <Button onClick={() => openQuick("pair")}>
            <Plus />
            {t("workspaces.join")}
          </Button>
        }
      />

      {/* No stats row: the toolbar chips already carry each bucket's count, and
          a page that prints the same four numbers twice reads as padding. */}
      <div className="flex-1 overflow-y-auto px-9 py-6">
        <WorkspacesToolbar
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
          stats={stats}
          sort={sort}
          onSort={setSort}
          onRefresh={runRefresh}
          refreshing={refreshing}
        />

        {loading ? (
          <Empty>
            <EmptyHeader>
              <Spinner />
              <EmptyDescription>{t("workspaces.loading")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : filtered.length === 0 ? (
          // Three distinct reasons a list can be empty, each with its own way
          // out: none at all (add one), none matching what was typed (drop the
          // search), none matching the filter (widen it). Folding the last two
          // together used to print 没有匹配""的工作区 whenever a filter emptied
          // the list with the search box untouched.
          workspaces.length === 0 ? (
            <EmptyState
              icon={<Layers />}
              title={t("workspaces.emptyNoneTitle")}
              description={t("workspaces.emptyNone")}
              action={{
                label: t("workspaces.join"),
                icon: <Plus />,
                onClick: () => openQuick("pair"),
              }}
            />
          ) : search.trim() ? (
            <EmptyState
              icon={<SearchX />}
              title={t("workspaces.emptyNoMatchTitle")}
              description={t("workspaces.emptyNoMatch", {
                query: search.trim(),
              })}
              action={{
                label: t("common.clearSearch"),
                onClick: () => setSearch(""),
              }}
            />
          ) : (
            <EmptyState
              icon={<FilterX />}
              title={t("workspaces.emptyNoFilterMatchTitle")}
              description={t("workspaces.emptyNoFilterMatch")}
              action={{
                label: t("common.showAll"),
                onClick: () => setFilter("all"),
              }}
            />
          )
        ) : (
          // Two up from the start: the window is 1200px wide at its smallest,
          // so a breakpoint above that only ever produced a single column on
          // exactly the size most people run.
          <div className="grid grid-cols-2 gap-3 3xl:grid-cols-3">
            {filtered.map((c) => (
              <WorkspaceCard
                key={c.ws.id}
                data={{ ...c, activity: activity[c.ws.id] }}
                favorite={favorites.has(c.ws.id)}
                onToggleFavorite={() => toggleFavorite(c.ws.id)}
                onCopyUrl={() => copyUrl(c.ws)}
                onOpen={() => openInBrowser(c.ws)}
                onRename={() => setRenameTarget(c.ws)}
                onRemove={() => setRemoveTarget(c.ws)}
              />
            ))}
          </div>
        )}
      </div>

      <WorkspaceQuickConnect
        open={quickOpen}
        defaultMode={quickMode}
        onClose={() => setQuickOpen(false)}
        onCreated={reload}
        showToast={showToast}
      />

      <WorkspaceRenameDialog
        open={!!renameTarget}
        workspace={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSaved={(id, name, scope) => {
          if (scope === "local") {
            setAliases((a) => ({ ...a, [id]: name }))
            showToast(t("workspaces.toast.renamed"), "success")
            return
          }
          // Renamed on the server: the alias was cleared with it, and the
          // local network record now carries the real name — reload to show it.
          setAliases((a) => {
            const next = { ...a }
            delete next[id]
            return next
          })
          void reload()
          showToast(t("workspaces.toast.renamedWorkspace", { name }), "success")
        }}
      />

      <WorkspaceRemoveDialog
        workspace={removeTarget}
        displayName={
          removeTarget
            ? aliases[removeTarget.id] ||
              removeTarget.name ||
              removeTarget.slug ||
              removeTarget.id
            : ""
        }
        busy={removing}
        onConfirm={(deleteRemote) => void performRemove(deleteRemote)}
        onCancel={() => setRemoveTarget(null)}
      />
    </section>
  )
}
