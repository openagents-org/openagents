import React, { useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { Link as LinkIcon, Plus, RefreshCw } from "lucide-react"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/shadcn/button"
import { Spinner } from "@renderer/components/shadcn/spinner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@renderer/components/shadcn/alert-dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@renderer/components/shadcn/empty"
import { SearchInput } from "@renderer/components/ui-kit"
import { WorkspaceCard } from "@renderer/components/workspaces/WorkspaceCard"
import { WorkspaceQuickConnect } from "@renderer/components/workspaces/WorkspaceQuickConnect"
import { WorkspaceRenameDialog } from "@renderer/components/workspaces/WorkspaceRenameDialog"
import { useAgentsStore } from "@renderer/store/agents"
import { useConnectionsStore } from "@renderer/store/connections"
import { useWorkspacePrefs } from "@renderer/store/workspace-prefs"
import { useUiStore } from "@renderer/store/ui"
import { workspaceWebBaseUrl } from "@renderer/lib/workspace-urls"
import type { Agent, Workspace } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"
import { useWorkspacesData } from "./use-workspaces-data"
import { WorkspacesStats } from "./components/workspaces-stats"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

/** Full workspace URL, including the access token when the workspace has one. */
function workspaceUrl(ws: Workspace): string {
  const url = `${workspaceWebBaseUrl(ws.endpoint)}/${ws.slug || ws.id}`
  return ws.token ? `${url}?token=${encodeURIComponent(ws.token)}` : url
}

export default function Workspaces({ showToast }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { pendingAgentActions, addPendingAction, removePendingAction } =
    useAgentsStore(
      useShallow((s) => ({
        pendingAgentActions: s.pendingAgentActions,
        addPendingAction: s.addPendingAction,
        removePendingAction: s.removePendingAction,
      })),
    )
  const refreshConnections = useConnectionsStore((s) => s.refresh)
  const { favorites, toggleFavorite, markUsed } = useWorkspacePrefs(
    useShallow((s) => ({
      favorites: s.favorites,
      toggleFavorite: s.toggleFavorite,
      markUsed: s.markUsed,
    })),
  )
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)

  const [search, setSearch] = useState("")
  const [quickOpen, setQuickOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Workspace | null>(null)
  const [removing, setRemoving] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Workspace | null>(null)

  const { workspaces, aliases, setAliases, filtered, stats, loading, reload } =
    useWorkspacesData(search)

  React.useEffect(() => {
    refreshConnections()
  }, [refreshConnections])

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

  const toggleAgent = async (a: Agent): Promise<void> => {
    if (pendingAgentActions.has(a.name)) return
    addPendingAction(a.name)
    try {
      const isRunning = ["online", "running", "idle"].includes(a.state)
      if (isRunning) await window.api.stopAgent(a.name)
      else await window.api.startAgent(a.name)
      setTimeout(reload, 1500)
    } catch (err) {
      showToast(t("workspaces.toast.error", { message: (err as Error).message }), "error")
    } finally {
      setTimeout(() => removePendingAction(a.name), 1500)
    }
  }

  // Jump to the Logs tab. The Logs page reads from the agents store and there
  // is no per-agent deep-link API, so this is the best we can do without
  // changing the logs page contract.
  const openAgentLogs = (): void => setCurrentTab("logs")

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

      <div className="flex-1 overflow-y-auto px-9 py-6">
        <WorkspacesStats stats={stats} starred={favorites.size} />

        <div className="mb-5 flex items-center gap-2">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder={t("workspaces.searchPlaceholder")}
            wrapperClassName="max-w-80 flex-1"
          />
          <Button size="sm" variant="ghost" onClick={reload}>
            <RefreshCw />
            {t("workspaces.refresh")}
          </Button>
        </div>

        <h2 className="mb-3 text-base font-semibold">
          {t("workspaces.activeWorkspaces")}
        </h2>

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
              <EmptyDescription>
                {workspaces.length === 0
                  ? t("workspaces.emptyNone")
                  : t("workspaces.emptyNoMatch", { query: search })}
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
          <div className="flex flex-col gap-2.5">
            {filtered.map((c) => (
              <WorkspaceCard
                key={c.ws.id}
                data={c}
                pendingNames={pendingAgentActions}
                favorite={favorites.has(c.ws.id)}
                onToggleFavorite={() => toggleFavorite(c.ws.id)}
                onCopyUrl={() => copyUrl(c.ws)}
                onOpen={() => openInBrowser(c.ws)}
                onRename={() => setRenameTarget(c.ws)}
                onRemove={() => setRemoveTarget(c.ws)}
                onToggleAgent={toggleAgent}
                onOpenAgentLogs={openAgentLogs}
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

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && !removing && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removeTarget
                ? t("workspaces.remove.title", {
                    name:
                      aliases[removeTarget.id] ||
                      removeTarget.name ||
                      removeTarget.slug ||
                      removeTarget.id,
                  })
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("workspaces.remove.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>
              {t("ui.confirmDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(e) => {
                e.preventDefault()
                void performRemove()
              }}
            >
              {removing && <Spinner />}
              {t("workspaces.remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
