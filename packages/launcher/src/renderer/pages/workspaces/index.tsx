import React, { useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { Link as LinkIcon, Plus } from "lucide-react"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@renderer/components/ui/empty"
import { ConfirmDialog } from "@renderer/components/ui-kit"
import { WorkspaceCard } from "@renderer/components/workspaces/WorkspaceCard"
import { WorkspaceQuickConnect } from "@renderer/components/workspaces/WorkspaceQuickConnect"
import { WorkspaceRenameDialog } from "@renderer/components/workspaces/WorkspaceRenameDialog"
import { useConnectionsStore } from "@renderer/store/connections"
import { useUiStore } from "@renderer/store/ui"
import { useWorkspacePrefs } from "@renderer/store/workspace-prefs"
import { workspaceUrl } from "@renderer/lib/workspace-urls"
import { copyTextToClipboard } from "@renderer/lib/clipboard"
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
  const [refreshing, setRefreshing] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Workspace | null>(null)
  const [removing, setRemoving] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Workspace | null>(null)

  const { workspaces, aliases, setAliases, filtered, stats, loading, reload } =
    useWorkspacesData(search, filter, sort)
  const activity = useWorkspaceActivity(workspaces)

  const runRefresh = (): void => {
    setRefreshing(true)
    void reload().finally(() => setRefreshing(false))
  }

  React.useEffect(() => {
    refreshConnections()
  }, [refreshConnections])

  // The dashboard's "Create workspace" button lands here with the dialog
  // requested; clearing the flag keeps a later tab click from re-opening it.
  React.useEffect(() => {
    if (pendingCreate !== "workspace") return
    setQuickOpen(true)
    clearPendingCreate()
  }, [pendingCreate, clearPendingCreate])

  const copyUrl = async (ws: Workspace): Promise<void> => {
    markUsed(ws.id)
    try {
      await copyTextToClipboard(workspaceUrl(ws))
      showToast(t("workspaces.toast.urlCopied"), "success")
    } catch {
      showToast(t("workspaces.toast.copyFailed"), "error")
    }
  }

  const openInBrowser = (ws: Workspace): void => {
    markUsed(ws.id)
    window.api.openExternal(workspaceUrl(ws))
  }

  const performRemove = async (): Promise<void> => {
    if (!removeTarget) return
    const ws = removeTarget
    // Same display name the confirm dialog shows.
    const name = aliases[ws.id] || ws.name || ws.slug || ws.id
    setRemoving(true)
    try {
      // No "removing…" progress toast — a single success toast (below) is the
      // only feedback, so a quick remove doesn't stack two notifications.
      await window.api.removeWorkspace(ws.slug || ws.id)
      await reload()
      showToast(t("workspaces.toast.removed", { name }), "success")
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
          <>
            <Button variant="outline" onClick={() => setQuickOpen(true)}>
              <LinkIcon />
              {t("workspaces.join")}
            </Button>
            <Button onClick={() => setQuickOpen(true)}>
              <Plus />
              {t("workspaces.create")}
            </Button>
          </>
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
          <Empty>
            <EmptyHeader>
              {/* Three distinct reasons a list can be empty, and each gets its
                  own sentence: no workspaces at all, none matching what was
                  typed, none matching the active filter. Folding the last two
                  together used to print 没有匹配""的工作区 whenever a filter
                  emptied the list with the search box untouched. */}
              <EmptyDescription>
                {workspaces.length === 0
                  ? t("workspaces.emptyNone")
                  : search.trim()
                    ? t("workspaces.emptyNoMatch", { query: search.trim() })
                    : t("workspaces.emptyNoFilterMatch")}
              </EmptyDescription>
            </EmptyHeader>
            {workspaces.length === 0 && (
              <EmptyContent>
                <Button onClick={() => setQuickOpen(true)}>
                  {t("workspaces.connectFirst")}
                </Button>
              </EmptyContent>
            )}
          </Empty>
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
        onClose={() => setQuickOpen(false)}
        onCreated={reload}
        showToast={showToast}
      />

      <WorkspaceRenameDialog
        open={!!renameTarget}
        workspace={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSaved={(id, name) => {
          setAliases((a) => ({ ...a, [id]: name }))
          showToast(t("workspaces.toast.renamed"), "success")
        }}
      />

      <ConfirmDialog
        open={!!removeTarget}
        title={
          removeTarget
            ? t("workspaces.remove.title", {
                name:
                  aliases[removeTarget.id] ||
                  removeTarget.name ||
                  removeTarget.slug ||
                  removeTarget.id,
              })
            : ""
        }
        description={t("workspaces.remove.description")}
        confirmLabel={t("workspaces.remove.confirm")}
        busy={removing}
        onConfirm={() => void performRemove()}
        onCancel={() => setRemoveTarget(null)}
      />
    </section>
  )
}
