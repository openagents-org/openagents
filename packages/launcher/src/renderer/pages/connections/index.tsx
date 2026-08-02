import React, { useEffect, useMemo, useState } from "react"
import { Sparkles } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Empty, EmptyDescription, EmptyHeader } from "@renderer/components/shadcn/empty"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@renderer/components/shadcn/item"
import { useConnectionsStore } from "@renderer/store/connections"
import { useCredentialsStore } from "@renderer/store/credentials"
import { useAgentsStore } from "@renderer/store/agents"
import { PLATFORMS, type PlatformDef } from "@renderer/components/connections/platforms"
import { PlatformCard } from "@renderer/components/connections/PlatformCard"
import { PlatformConnectDialog } from "@renderer/components/connections/PlatformConnectDialog"
import { ConnectionTestDialog } from "@renderer/components/connections/ConnectionTestDialog"
import { McpSetupDialog } from "@renderer/components/connections/McpSetupDialog"
import { CredentialApplyDialog } from "@renderer/components/credentials/CredentialApplyDialog"
import type { ConnectionRecord, CredentialSummary } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"
import { getConnectionsEmptyState, type ConnectionFilter } from "./empty-state"
import { ConnectionsToolbar } from "./components/connections-toolbar"
import { DisconnectDialog } from "./components/disconnect-dialog"
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
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<ConnectionFilter>("all")
  const [dialogPlatform, setDialogPlatform] = useState<PlatformDef | null>(null)
  const [testTarget, setTestTarget] = useState<ConnectionRecord | null>(null)
  const [applyTarget, setApplyTarget] = useState<CredentialSummary | null>(null)
  const [mcpTarget, setMcpTarget] = useState<PlatformDef | null>(null)
  const [mcpPlatforms, setMcpPlatforms] = useState<Set<string>>(new Set())

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

  const connectionByPlatform = useMemo(() => {
    const m = new Map<string, ConnectionRecord>()
    for (const c of connections) m.set(c.platform, c)
    return m
  }, [connections])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return PLATFORMS.filter((p) => {
      if (q && !p.label.toLowerCase().includes(q) && !p.id.includes(q)) return false
      if (filter === "connected") return connectionByPlatform.get(p.id)?.status === "connected"
      if (filter === "disconnected") return connectionByPlatform.get(p.id)?.status !== "connected"
      return true
    })
  }, [search, filter, connectionByPlatform])

  const connectedCount = useMemo(
    () => PLATFORMS.filter((p) => connectionByPlatform.get(p.id)?.status === "connected").length,
    [connectionByPlatform],
  )

  // Hand the connection's stored secret to agents by writing it into their
  // ~/.openagents/env/<type>.env under the platform's default env key. This is
  // what turns a "Connected" card into something an agent can actually use.
  const applyToAgents = (conn: ConnectionRecord): void => {
    const cred = credentials.find((c) => c.id === conn.credentialId)
    if (!cred) {
      showToast(t("connections.toast.credentialMissing"), "error")
      return
    }
    setApplyTarget(cred)
  }

  const emptyState = getConnectionsEmptyState(search, filter)

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        title={t("connections.title")}
        subtitle={t("connections.subtitle")}
        actions={
          <div className="flex items-center gap-2 text-2xs text-muted-foreground">
            <span>
              <span className="font-semibold text-success">{connectedCount}</span>{" "}
              {t("connections.stats.connected")}
            </span>
            <span>·</span>
            <span>{t("connections.stats.platforms", { count: PLATFORMS.length })}</span>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6">
        <Item variant="muted" className="mb-5 border border-primary/20 bg-primary/5">
          <ItemMedia>
            <Sparkles className="size-4 text-primary" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t("connections.banner.title")}</ItemTitle>
            <ItemDescription>{t("connections.banner.body")}</ItemDescription>
          </ItemContent>
        </Item>

        <ConnectionsToolbar
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
        />

        {visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>
                {t(emptyState.key, { query: emptyState.query })}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {visible.map((p) => {
              const conn = connectionByPlatform.get(p.id) || null
              return (
                <PlatformCard
                  key={p.id}
                  platform={p}
                  connection={conn}
                  busy={!!conn && disconnect.busyId === conn.id}
                  onConnect={() => setDialogPlatform(p)}
                  onReconnect={() => setDialogPlatform(p)}
                  onTest={() => conn && setTestTarget(conn)}
                  onDisconnect={() => conn && disconnect.request(conn)}
                  onApplyToAgents={() => conn && applyToAgents(conn)}
                  onConfigureMcp={() => setMcpTarget(p)}
                  hasMcp={mcpPlatforms.has(p.id)}
                />
              )
            })}
          </div>
        )}
      </div>

      {dialogPlatform && (
        <PlatformConnectDialog
          open
          onClose={() => setDialogPlatform(null)}
          platform={dialogPlatform}
          existing={connectionByPlatform.get(dialogPlatform.id) || null}
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
          connection={connectionByPlatform.get(mcpTarget.id) || null}
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
