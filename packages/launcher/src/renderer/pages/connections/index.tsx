import React, { useEffect, useMemo, useState } from "react"
import { Sparkles } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { SearchInput } from "../../components/ui/SearchInput"
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/Tabs"
import { TopBar } from "../../components/TopBar"
import { useConnectionsStore } from "../../store/connections"
import { useCredentialsStore } from "../../store/credentials"
import { PLATFORMS, type PlatformDef, platformLabel } from "../../components/connections/platforms"
import { PlatformLogo } from "../../components/connections/PlatformLogo"
import { PlatformCard } from "../../components/connections/PlatformCard"
import { PlatformConnectDialog } from "../../components/connections/PlatformConnectDialog"
import { ConnectionTestDialog } from "../../components/connections/ConnectionTestDialog"
import { ConfirmDialog } from "../../components/ui/ConfirmDialog"
import type { ConnectionRecord } from "../../types"
import type { ToastType } from "../../hooks/useToast"

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
  const [filter, setFilter] = useState<"all" | "connected" | "disconnected">("all")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dialogPlatform, setDialogPlatform] = useState<PlatformDef | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectionRecord | null>(null)
  const [testTarget, setTestTarget] = useState<ConnectionRecord | null>(null)

  useEffect(() => {
    refreshConnections()
    refreshCredentials()
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
      if (filter === "all") return true
      const conn = connectionByPlatform.get(p.id)
      if (filter === "connected") return conn?.status === "connected"
      if (filter === "disconnected") return !conn || conn.status !== "connected"
      return true
    })
  }, [search, filter, connectionByPlatform])

  // Open the structured ConnectionTestDialog — it auto-runs on mount and
  // shows the status badge + account inline.
  const handleTest = (conn: ConnectionRecord): void => {
    setTestTarget(conn)
  }

  const performDisconnect = async (): Promise<void> => {
    const conn = disconnectTarget
    if (!conn) return
    setBusyId(conn.id)
    try {
      await window.api.removeConnection(conn.id)
      await refreshConnections()
      showToast(t("connections.toast.disconnected"), "success")
    } catch (err) {
      showToast(t("connections.toast.error", { message: (err as Error).message }), "error")
    } finally {
      setBusyId(null)
      setDisconnectTarget(null)
    }
  }

  const counts = useMemo(() => {
    let connected = 0
    let disconnected = 0
    for (const p of PLATFORMS) {
      const c = connectionByPlatform.get(p.id)
      if (c?.status === "connected") connected++
      else disconnected++
    }
    return { connected, disconnected, total: PLATFORMS.length }
  }, [connectionByPlatform])

  return (
    <section className="flex flex-col h-full">
      <TopBar
        title={t("connections.title")}
        subtitle={t("connections.subtitle")}
        actions={
          <div className="flex items-center gap-2 text-[11px] text-(--text-tertiary)">
            <span>
              <span className="text-(--success-text) font-semibold">{counts.connected}</span> {t("connections.stats.connected")}
            </span>
            <span>·</span>
            <span>{t("connections.stats.platforms", { count: counts.total })}</span>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6">

      <div className="flex items-start gap-2.5 mb-5 px-3.5 py-3 rounded-(--radius-sm) bg-(--accent-bg) border border-(--accent-border)">
        <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-(--accent)" />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-(--text-primary)">
            {t("connections.banner.title")}
          </div>
          <div className="text-[11px] text-(--text-secondary) mt-0.5">
            {t("connections.banner.body")}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-5">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("connections.search.placeholder")}
          className="flex-1 max-w-[280px]"
        />
        <Tabs
          mode="filter"
          value={filter}
          onValueChange={(v) => setFilter(v as typeof filter)}
        >
          <TabsList>
            {(["all", "connected", "disconnected"] as const).map((k) => (
              <TabsTrigger key={k} value={k} className="px-2.5 py-1 text-[11px]">
                {t(`connections.filters.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="card-grid">
        {visible.map((p) => {
          const conn = connectionByPlatform.get(p.id) || null
          return (
            <PlatformCard
              key={p.id}
              platform={p}
              connection={conn}
              busy={!!conn && busyId === conn.id}
              onConnect={() => setDialogPlatform(p)}
              onReconnect={() => setDialogPlatform(p)}
              onTest={() => conn && handleTest(conn)}
              onDisconnect={() => conn && setDisconnectTarget(conn)}
            />
          )
        })}
      </div>

      {visible.length === 0 && (
        <div className="card-legacy empty-state">
          <p>{t("connections.search.noResults", { query: search })}</p>
        </div>
      )}
      </div>

      {dialogPlatform && (
        <PlatformConnectDialog
          open={!!dialogPlatform}
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

      <ConfirmDialog
        open={!!disconnectTarget}
        icon={
          disconnectTarget ? (
            <PlatformLogo
              platform={
                PLATFORMS.find((p) => p.id === disconnectTarget.platform) || PLATFORMS[0]
              }
              size={40}
            />
          ) : undefined
        }
        title={
          disconnectTarget
            ? t("connections.disconnect.title", {
                platform: platformLabel(disconnectTarget.platform),
              })
            : ""
        }
        description={
          <>
            {t("connections.disconnect.descriptionBefore")}
            <strong>{disconnectTarget ? platformLabel(disconnectTarget.platform) : ""}</strong>
            {t("connections.disconnect.descriptionAfter")}
          </>
        }
        confirmLabel={t("connections.disconnect.confirm")}
        busy={!!disconnectTarget && busyId === disconnectTarget.id}
        onConfirm={performDisconnect}
        onCancel={() => setDisconnectTarget(null)}
      />
    </section>
  )
}
