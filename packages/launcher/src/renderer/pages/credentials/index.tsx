import React, { useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { Button } from "../../components/ui/Button"
import { SearchInput } from "../../components/ui/SearchInput"
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/Tabs"
import { TopBar } from "../../components/TopBar"
import { CredentialCard } from "../../components/credentials/CredentialCard"
import { CredentialEditor } from "../../components/credentials/CredentialEditor"
import { CredentialApplyDialog } from "../../components/credentials/CredentialApplyDialog"
import { ConfirmDialog } from "../../components/ui/ConfirmDialog"
import { useAgentsStore } from "../../store/agents"
import { useCredentialsStore } from "../../store/credentials"
import { useConnectionsStore } from "../../store/connections"
import { PLATFORMS, getPlatform } from "../../components/connections/platforms"
import { PlatformLogo } from "../../components/connections/PlatformLogo"
import type { CredentialSummary, ConnectionTestResult } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

export default function Credentials({ showToast }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { credentials, refresh } = useCredentialsStore(
    useShallow((s) => ({ credentials: s.credentials, refresh: s.refresh })),
  )
  const { connections, refresh: refreshConnections } = useConnectionsStore(
    useShallow((s) => ({ connections: s.connections, refresh: s.refresh })),
  )
  const [search, setSearch] = useState("")
  const [providerFilter, setProviderFilter] = useState<string>("all")
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<CredentialSummary | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<CredentialSummary | null>(null)
  const [removing, setRemoving] = useState(false)
  const [applyTarget, setApplyTarget] = useState<CredentialSummary | null>(null)

  // Ensure the apply-dialog's "Target agent types" list reflects what's
  // currently configured (CredentialApplyDialog reads from useAgentsStore).
  useEffect(() => {
    refresh()
    refreshConnections()
    void window.api.listAgents().then((a) => useAgentsStore.getState().setAgents(a))
  }, [refresh, refreshConnections])

  // Cross-link credentials with their connection usage from connections state
  // (since the main-process store keeps `usedByConnections` lazily and this
  // gives the UI a fresh count without waiting for the next refresh).
  const decorated = useMemo(() => {
    return credentials.map((c) => {
      const usedByConn = connections.filter((conn) => conn.credentialId === c.id).map((conn) => conn.id)
      return {
        ...c,
        usedByConnections: usedByConn.length ? usedByConn : c.usedByConnections,
      }
    })
  }, [credentials, connections])

  const providers = useMemo(() => {
    const set = new Set(credentials.map((c) => c.provider))
    return Array.from(set).sort()
  }, [credentials])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return decorated.filter((c) => {
      if (providerFilter !== "all" && c.provider !== providerFilter) return false
      if (!q) return true
      return (
        c.label.toLowerCase().includes(q) ||
        c.provider.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q)
      )
    })
  }, [decorated, search, providerFilter])

  const handleReveal = async (id: string): Promise<void> => {
    if (revealed[id]) {
      setRevealed((r) => {
        const n = { ...r }
        delete n[id]
        return n
      })
      return
    }
    try {
      const r = await window.api.revealCredential(id)
      if (r.ok && r.secret) {
        setRevealed((prev) => ({ ...prev, [id]: r.secret! }))
      } else {
        showToast(r.error || t("credentials.toasts.revealFailed"), "error")
      }
    } catch (err) {
      showToast(t("credentials.toasts.error", { message: (err as Error).message }), "error")
    }
  }

  const performRemove = async (): Promise<void> => {
    const cred = removeTarget
    if (!cred) return
    setRemoving(true)
    try {
      await window.api.removeCredential(cred.id)
      await refresh()
      await refreshConnections()
      showToast(t("credentials.toasts.removed"), "success")
      setRemoveTarget(null)
    } catch (err) {
      showToast(t("credentials.toasts.error", { message: (err as Error).message }), "error")
    } finally {
      setRemoving(false)
    }
  }

  const handleTest = async (cred: CredentialSummary): Promise<void> => {
    setTesting(cred.id)
    try {
      const r: ConnectionTestResult = await window.api.testCredential({
        id: cred.id,
        provider: cred.provider,
      })
      await refresh()
      showToast(
        r.ok
          ? r.account
            ? t("credentials.toasts.testPassedAccount", { account: r.account })
            : t("credentials.toasts.testPassed")
          : t("credentials.toasts.testFailed", { detail: r.detail || r.status }),
        r.ok ? "success" : "error",
      )
    } catch (err) {
      showToast(t("credentials.toasts.error", { message: (err as Error).message }), "error")
    } finally {
      setTesting(null)
    }
  }

  const openAdd = (): void => {
    setEditing(null)
    setEditorOpen(true)
  }

  return (
    <section className="flex flex-col h-full">
      <TopBar
        title={t("credentials.title")}
        subtitle={t("credentials.subtitle")}
        actions={
          <Button variant="primary" onClick={openAdd}>
            <Plus className="w-3.5 h-3.5" />
            {t("credentials.addCredential")}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6">

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("credentials.searchPlaceholder")}
          className="flex-1 min-w-[200px] max-w-[300px]"
        />
        <Tabs mode="filter" value={providerFilter} onValueChange={setProviderFilter}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="all" className="px-2.5 py-1 text-[11px]">
              {t("credentials.filterAll")}
            </TabsTrigger>
            {providers.map((p) => (
              <TabsTrigger key={p} value={p} className="px-2.5 py-1 text-[11px]">
                {getPlatform(p)?.label || p}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {visible.length === 0 ? (
        <div className="card-legacy empty-state">
          <p>
            {credentials.length === 0
              ? t("credentials.empty.none")
              : t("credentials.empty.noMatch", { query: search })}
          </p>
          {credentials.length === 0 && (
            <Button variant="primary" onClick={openAdd}>
              {t("credentials.empty.addFirst")}
            </Button>
          )}
        </div>
      ) : (
        <div>
          {visible.map((c) => (
            <CredentialCard
              key={c.id}
              cred={c}
              revealed={revealed[c.id] || null}
              testing={testing === c.id}
              onEdit={() => {
                setEditing(c)
                setEditorOpen(true)
              }}
              onRemove={() => setRemoveTarget(c)}
              onTest={() => handleTest(c)}
              onReveal={() => handleReveal(c.id)}
              onApply={() => setApplyTarget(c)}
            />
          ))}
        </div>
      )}

      <div className="card-legacy mt-5">
        <h3>{t("credentials.storage.title")}</h3>
        <p className="text-[12px] text-(--text-secondary) mb-2 leading-relaxed">
          {t("credentials.storage.description", {
            keychain: navigator.platform.includes("Mac")
              ? t("credentials.storage.keychain.mac")
              : navigator.platform.includes("Win")
                ? t("credentials.storage.keychain.windows")
                : t("credentials.storage.keychain.linux"),
          })}
        </p>
        <p className="text-[11px] text-(--text-tertiary) m-0">
          {t("credentials.storage.platformsSupported", { count: PLATFORMS.length })}
        </p>
      </div>
      </div>

      <CredentialEditor
        open={editorOpen}
        initial={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          refresh()
          refreshConnections()
        }}
        showToast={showToast}
      />

      <CredentialApplyDialog
        open={!!applyTarget}
        credential={applyTarget}
        onClose={() => setApplyTarget(null)}
        onApplied={() => {
          refresh()
        }}
        showToast={showToast}
      />

      <ConfirmDialog
        open={!!removeTarget}
        icon={
          removeTarget && getPlatform(removeTarget.provider) ? (
            <PlatformLogo platform={getPlatform(removeTarget.provider)!} size={40} />
          ) : undefined
        }
        title={removeTarget ? t("credentials.remove.title", { label: removeTarget.label }) : ""}
        description={
          <>
            {t("credentials.remove.descriptionPrefix")}{" "}
            <strong>{t("credentials.remove.unauthorized")}</strong>
            {t("credentials.remove.descriptionSuffix")}
          </>
        }
        confirmLabel={t("credentials.remove.confirm")}
        busy={removing}
        onConfirm={performRemove}
        onCancel={() => !removing && setRemoveTarget(null)}
      />
    </section>
  )
}
