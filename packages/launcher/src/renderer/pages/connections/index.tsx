import React, { useEffect, useState } from "react"
import { ShieldCheck } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Empty, EmptyDescription, EmptyHeader } from "@renderer/components/ui/empty"
import { useConnectionsStore } from "@renderer/store/connections"
import { useCredentialsStore } from "@renderer/store/credentials"
import { useAgentsStore } from "@renderer/store/agents"
import { PLATFORMS, type PlatformDef } from "@renderer/components/connections/platforms"
import { PlatformConnectDialog } from "@renderer/components/connections/PlatformConnectDialog"
import { ConnectionTestDialog } from "@renderer/components/connections/ConnectionTestDialog"
import { McpSetupDialog } from "@renderer/components/connections/McpSetupDialog"
import { CredentialApplyDialog } from "@renderer/components/credentials/CredentialApplyDialog"
import type { ConnectionRecord, CredentialSummary } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"
import { getConnectionsEmptyState } from "./empty-state"
import { ConnectionsTable } from "./components/connections-table"
import { ConnectionsToolbar } from "./components/connections-toolbar"
import { DisconnectDialog } from "./components/disconnect-dialog"
import { useConnectionsView } from "./use-connections-view"
import { useDisconnect } from "./use-disconnect"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

export default function Connections({ showToast }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { connections, refresh: refreshConnections } = useConnectionsStore(
    useShallow((s) => ({ connections: s.connections, refresh: s.refresh })),
  )
  const { credentials, refresh: refreshCredentials } = useCredentialsStore(
    useShallow((s) => ({ credentials: s.credentials, refresh: s.refresh })),
  )
  const [dialogPlatform, setDialogPlatform] = useState<PlatformDef | null>(null)
  const [testTarget, setTestTarget] = useState<ConnectionRecord | null>(null)
  const [applyTarget, setApplyTarget] = useState<CredentialSummary | null>(null)
  const [mcpTarget, setMcpTarget] = useState<PlatformDef | null>(null)
  const [mcpPlatforms, setMcpPlatforms] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)

  const view = useConnectionsView(connections)
  const disconnect = useDisconnect({
    mcpPlatforms,
    refresh: refreshConnections,
    showToast,
  })

  useEffect(() => {
    refreshConnections()
    refreshCredentials()
    // CredentialApplyDialog picks its target agent types out of useAgentsStore,
    // so make sure it's populated even when Connections is the first page shown.
    void window.api.listAgents().then((a) => useAgentsStore.getState().setAgents(a))
    // Which platforms the launcher can register as an MCP server. Owned by the
    // main process so the endpoint catalog lives in exactly one place.
    void window.api.mcpPlatforms().then((ids) => setMcpPlatforms(new Set(ids)))
  }, [refreshConnections, refreshCredentials])

  // Re-probe every stored connection, then re-read. Listing alone only replays
  // the local records — nothing writes `status` or `lastSyncAt` except a probe,
  // so a "refresh" that skipped this would visibly do nothing.
  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await Promise.all(
        connections.map((c) => window.api.testConnection(c.id).catch(() => null)),
      )
      await refreshConnections()
      await refreshCredentials()
    } finally {
      setRefreshing(false)
    }
  }

  // Hand the connection's stored secret to agents by writing it into their
  // ~/.openagents/env/<type>.env under the platform's default env key. This is
  // what turns a connected platform into something an agent can actually use.
  const applyToAgents = (conn: ConnectionRecord): void => {
    const cred = credentials.find((c) => c.id === conn.credentialId)
    if (!cred) {
      showToast(t("connections.toast.credentialMissing"), "error")
      return
    }
    setApplyTarget(cred)
  }

  const emptyState = getConnectionsEmptyState(view.search, view.filter)

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        title={t("connections.title")}
        subtitle={t("connections.subtitle")}
        actions={
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success" />
              <span className="font-semibold text-success">
                {view.stats.connected}
              </span>
              {t("connections.stats.connected")}
            </span>
            <span>·</span>
            <span>{t("connections.stats.platforms", { count: PLATFORMS.length })}</span>
          </div>
        }
      />

      {/* No stats row: the toolbar chips carry the counts, and the table's own
          "last sync" column carries the freshness the fourth tile showed. */}
      <div className="flex-1 overflow-y-auto px-9 py-6">
        <ConnectionsToolbar
          search={view.search}
          onSearchChange={view.setSearch}
          filter={view.filter}
          onFilterChange={view.setFilter}
          filterCounts={view.filterCounts}
          sort={view.sort}
          onSortChange={view.setSort}
          ascending={view.ascending}
          onToggleDirection={view.toggleDirection}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
        />

        {view.rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>
                {t(emptyState.key, { query: emptyState.query })}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ConnectionsTable
            rows={view.rows}
            mcpPlatforms={mcpPlatforms}
            busyId={disconnect.busyId}
            onConnect={(row) => setDialogPlatform(row.platform)}
            onTest={setTestTarget}
            onDisconnect={disconnect.request}
            onApplyToAgents={applyToAgents}
            onConfigureMcp={(row) => setMcpTarget(row.platform)}
          />
        )}

        {/* A footnote, not a fourth panel — it explains where secrets live and
            then gets out of the way. */}
        <p className="mt-3 flex items-center gap-2 text-2xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" />
          {t("connections.security.body")}
        </p>
      </div>

      {dialogPlatform && (
        <PlatformConnectDialog
          open
          onClose={() => setDialogPlatform(null)}
          platform={dialogPlatform}
          existing={view.byPlatform.get(dialogPlatform.id) || null}
          credentials={credentials}
          showToast={showToast}
          onSaved={async () => {
            await refreshConnections()
            await refreshCredentials()
          }}
        />
      )}

      <ConnectionTestDialog
        open={!!testTarget}
        connection={testTarget}
        onClose={() => setTestTarget(null)}
        onAfterRun={() => refreshConnections()}
      />

      <CredentialApplyDialog
        open={!!applyTarget}
        credential={applyTarget}
        onClose={() => setApplyTarget(null)}
        onApplied={() => refreshCredentials()}
        showToast={showToast}
      />

      {mcpTarget && (
        <McpSetupDialog
          open
          platform={mcpTarget}
          connection={view.byPlatform.get(mcpTarget.id) || null}
          onClose={() => setMcpTarget(null)}
          showToast={showToast}
        />
      )}

      <DisconnectDialog
        target={disconnect.target}
        busy={!!disconnect.target && disconnect.busyId === disconnect.target.id}
        onConfirm={disconnect.confirm}
        onCancel={disconnect.cancel}
      />
    </section>
  )
}
