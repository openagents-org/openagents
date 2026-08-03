import React, { useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@renderer/components/ui/empty"
import { SearchInput } from "@renderer/components/ui-kit"
import { CredentialCard } from "@renderer/components/credentials/CredentialCard"
import { CredentialEditor } from "@renderer/components/credentials/CredentialEditor"
import { CredentialApplyDialog } from "@renderer/components/credentials/CredentialApplyDialog"
import { PLATFORMS, getPlatform } from "@renderer/components/connections/platforms"
import { RemoveCredentialDialog } from "./components/remove-credential-dialog"
import { useAgentsStore } from "@renderer/store/agents"
import { useCredentialsStore } from "@renderer/store/credentials"
import { useConnectionsStore } from "@renderer/store/connections"
import type { ConnectionTestResult, CredentialSummary } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

/** OS-specific name for where secrets actually live. */
function keychainName(t: (k: string) => string): string {
  if (navigator.platform.includes("Mac")) return t("credentials.storage.keychain.mac")
  if (navigator.platform.includes("Win")) return t("credentials.storage.keychain.windows")
  return t("credentials.storage.keychain.linux")
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
  const [providerFilter, setProviderFilter] = useState("all")
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
  const decorated = useMemo(
    () =>
      credentials.map((c) => {
        const usedByConn = connections
          .filter((conn) => conn.credentialId === c.id)
          .map((conn) => conn.id)
        return {
          ...c,
          usedByConnections: usedByConn.length ? usedByConn : c.usedByConnections,
        }
      }),
    [credentials, connections],
  )

  const providers = useMemo(
    () => Array.from(new Set(credentials.map((c) => c.provider))).sort(),
    [credentials],
  )

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

  const toggleReveal = async (id: string): Promise<void> => {
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
      if (r.ok && r.secret) setRevealed((prev) => ({ ...prev, [id]: r.secret! }))
      else showToast(r.error || t("credentials.toasts.revealFailed"), "error")
    } catch (err) {
      showToast(
        t("credentials.toasts.error", { message: (err as Error).message }),
        "error",
      )
    }
  }

  const performRemove = async (): Promise<void> => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await window.api.removeCredential(removeTarget.id)
      await refresh()
      await refreshConnections()
      showToast(t("credentials.toasts.removed"), "success")
      setRemoveTarget(null)
    } catch (err) {
      showToast(
        t("credentials.toasts.error", { message: (err as Error).message }),
        "error",
      )
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
      showToast(
        t("credentials.toasts.error", { message: (err as Error).message }),
        "error",
      )
    } finally {
      setTesting(null)
    }
  }

  const openAdd = (): void => {
    setEditing(null)
    setEditorOpen(true)
  }

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        title={t("credentials.title")}
        subtitle={t("credentials.subtitle")}
        actions={
          <Button onClick={openAdd}>
            <Plus />
            {t("credentials.addCredential")}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder={t("credentials.searchPlaceholder")}
            wrapperClassName="min-w-50 max-w-75 flex-1"
          />
          <Tabs value={providerFilter} onValueChange={setProviderFilter}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="all" className="text-2xs">
                {t("credentials.filterAll")}
              </TabsTrigger>
              {providers.map((p) => (
                <TabsTrigger key={p} value={p} className="text-2xs">
                  {getPlatform(p)?.label || p}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>
                {credentials.length === 0
                  ? t("credentials.empty.none")
                  : search.trim()
                    ? t("credentials.empty.noMatch", { query: search.trim() })
                    : t("credentials.empty.noFilterMatch")}
              </EmptyDescription>
            </EmptyHeader>
            {credentials.length === 0 && (
              <EmptyContent>
                <Button onClick={openAdd}>{t("credentials.empty.addFirst")}</Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div className="flex flex-col gap-2.5">
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
                onReveal={() => toggleReveal(c.id)}
                onApply={() => setApplyTarget(c)}
              />
            ))}
          </div>
        )}

        <Card className="mt-5 gap-2 px-4 py-4">
          <h3 className="text-sm font-semibold">{t("credentials.storage.title")}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("credentials.storage.description", { keychain: keychainName(t) })}
          </p>
          <p className="text-2xs text-muted-foreground">
            {t("credentials.storage.platformsSupported", { count: PLATFORMS.length })}
          </p>
        </Card>
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
        onApplied={refresh}
        showToast={showToast}
      />

      <RemoveCredentialDialog
        target={removeTarget}
        busy={removing}
        onConfirm={performRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </section>
  )
}
