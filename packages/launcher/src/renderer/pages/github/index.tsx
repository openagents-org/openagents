import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Github, Plus, RefreshCw } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@renderer/components/ui/empty"
import { ConfirmDialog } from "@renderer/components/ui-kit"
import { GitHubBindDialog } from "@renderer/components/github/GitHubBindDialog"
import { useAgentsStore } from "@renderer/store/agents"
import { useCredentialsStore } from "@renderer/store/credentials"
import { useGitHubStore } from "@renderer/store/github"
import { cn } from "@renderer/lib/utils"
import type { GitHubBinding } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"
import { useGitHubFeeds } from "./use-github-feeds"
import { BindingCard } from "./components/binding-card"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

export default function GitHubPage({ showToast }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { bindings, refresh, loading } = useGitHubStore(
    useShallow((s) => ({
      bindings: s.bindings,
      refresh: s.refresh,
      loading: s.loading,
    })),
  )
  const credentials = useCredentialsStore((s) => s.credentials)
  const refreshCredentials = useCredentialsStore((s) => s.refresh)
  const refreshAgents = useCallback(
    async () =>
      window.api.listAgents().then((a) => useAgentsStore.getState().setAgents(a)),
    [],
  )

  const [bindOpen, setBindOpen] = useState(false)
  const [bindEditing, setBindEditing] = useState<GitHubBinding | null>(null)
  const [unbindTarget, setUnbindTarget] = useState<GitHubBinding | null>(null)
  const [unbinding, setUnbinding] = useState(false)
  const [search, setSearch] = useState("")
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({})
  const [commenting, setCommenting] = useState<string | null>(null)

  const { feeds, tabs, setTab, loadFeed, unbind } = useGitHubFeeds(bindings, showToast)

  useEffect(() => {
    void refresh()
    void refreshAgents()
    void refreshCredentials()
  }, [refresh, refreshAgents, refreshCredentials])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bindings
    return bindings.filter(
      (b) =>
        b.agentName.toLowerCase().includes(q) ||
        b.owner.toLowerCase().includes(q) ||
        b.repo.toLowerCase().includes(q),
    )
  }, [bindings, search])

  const openBind = (existing: GitHubBinding | null): void => {
    setBindEditing(existing)
    setBindOpen(true)
  }

  const handleUnbind = async (): Promise<void> => {
    if (!unbindTarget) return
    setUnbinding(true)
    const ok = await unbind(unbindTarget)
    setUnbinding(false)
    if (ok) setUnbindTarget(null)
  }

  const handleComment = async (
    b: GitHubBinding,
    issueNumber: number,
  ): Promise<void> => {
    const key = `${b.agentName}:${issueNumber}`
    const body = (commentDraft[key] || "").trim()
    if (!body) return
    setCommenting(key)
    try {
      const res = await window.api.githubComment({
        agentName: b.agentName,
        issueNumber,
        body,
      })
      if (res.ok) {
        showToast(t("github.toast.commentPosted", { number: issueNumber }), "success")
        setCommentDraft((d) => ({ ...d, [key]: "" }))
        void loadFeed(b)
      } else {
        showToast(res.error || t("github.toast.commentFailed"), "error")
      }
    } finally {
      setCommenting(null)
    }
  }

  const credLabel = (id: string): string =>
    credentials.find((c) => c.id === id)?.label || t("github.missingCredential")

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        title={t("github.title")}
        subtitle={t("github.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                void refresh()
                for (const b of bindings) void loadFeed(b)
              }}
              disabled={loading}
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
              {t("github.refresh")}
            </Button>
            <Button onClick={() => openBind(null)}>
              <Plus />
              {t("github.bindRepo")}
            </Button>
          </>
        }
      />

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-9 py-6">
        {bindings.length > 0 && (
          <Input
            placeholder={t("github.filterPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        )}

        {bindings.length === 0 && !loading && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Github />
              </EmptyMedia>
              <EmptyTitle>{t("github.empty.title")}</EmptyTitle>
              <EmptyDescription>{t("github.empty.description")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => openBind(null)}>
                <Plus />
                {t("github.empty.bindFirst")}
              </Button>
            </EmptyContent>
          </Empty>
        )}

        <div className="flex flex-col gap-4">
          {visible.map((b) => (
            <BindingCard
              key={b.agentName}
              binding={b}
              feed={feeds[b.agentName] || { loading: false, issues: [], pulls: [] }}
              tab={tabs[b.agentName] || "issues"}
              credentialLabel={credLabel(b.credentialId)}
              commentDraft={commentDraft}
              setCommentDraft={setCommentDraft}
              commentingKey={commenting}
              onTabChange={(tab) => setTab(b.agentName, tab)}
              onReload={() => loadFeed(b)}
              onEdit={() => openBind(b)}
              onUnbind={() => setUnbindTarget(b)}
              onComment={(num) => handleComment(b, num)}
            />
          ))}
        </div>
      </div>

      <GitHubBindDialog
        open={bindOpen}
        onClose={() => {
          setBindOpen(false)
          setBindEditing(null)
        }}
        existing={bindEditing}
        showToast={showToast}
      />

      <ConfirmDialog
        open={!!unbindTarget}
        title={t("github.unbindConfirm.title", { name: unbindTarget?.agentName })}
        description={
          unbindTarget
            ? t("github.unbindConfirm.description", {
                owner: unbindTarget.owner,
                repo: unbindTarget.repo,
              })
            : ""
        }
        confirmLabel={t("github.unbindConfirm.confirm")}
        busy={unbinding}
        onConfirm={() => void handleUnbind()}
        onCancel={() => setUnbindTarget(null)}
      />
    </section>
  )
}
