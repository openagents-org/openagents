import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { useGitHubStore } from "@renderer/store/github"
import type { GitHubBinding, GitHubIssue, GitHubPullRequest } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

/** Items pulled per binding per tab — enough to scan, cheap enough to poll. */
const PER_PAGE = 10

export type FeedTab = "issues" | "pulls"

export interface BindingFeed {
  loading: boolean
  issues: GitHubIssue[]
  pulls: GitHubPullRequest[]
  error?: string
}

interface Feeds {
  feeds: Record<string, BindingFeed>
  tabs: Record<string, FeedTab>
  setTab: (agentName: string, tab: FeedTab) => void
  loadFeed: (b: GitHubBinding) => Promise<void>
  unbind: (b: GitHubBinding) => Promise<boolean>
}

/** Per-binding issue/PR feeds, plus the unbind that has to drop one. */
export function useGitHubFeeds(
  bindings: GitHubBinding[],
  showToast: (msg: string, type?: ToastType) => void,
): Feeds {
  const { t } = useTranslation()
  const refresh = useGitHubStore((s) => s.refresh)
  const [feeds, setFeeds] = useState<Record<string, BindingFeed>>({})
  const [tabs, setTabs] = useState<Record<string, FeedTab>>({})

  const loadFeed = useCallback(async (b: GitHubBinding): Promise<void> => {
    setFeeds((prev) => ({
      ...prev,
      [b.agentName]: {
        loading: true,
        issues: prev[b.agentName]?.issues || [],
        pulls: prev[b.agentName]?.pulls || [],
      },
    }))
    const [issuesRes, pullsRes] = await Promise.all([
      window.api.githubListIssues({
        agentName: b.agentName,
        state: "open",
        perPage: PER_PAGE,
      }),
      window.api.githubListPullRequests({
        agentName: b.agentName,
        state: "open",
        perPage: PER_PAGE,
      }),
    ])
    setFeeds((prev) => ({
      ...prev,
      [b.agentName]: {
        loading: false,
        issues: issuesRes.ok ? issuesRes.items || [] : [],
        pulls: pullsRes.ok ? pullsRes.items || [] : [],
        error: !issuesRes.ok
          ? issuesRes.error
          : !pullsRes.ok
            ? pullsRes.error
            : undefined,
      },
    }))
  }, [])

  // First sight of a binding seeds its tab and kicks off the initial load.
  useEffect(() => {
    for (const b of bindings) {
      if (!feeds[b.agentName] && !tabs[b.agentName]) {
        setTabs((prev) => ({ ...prev, [b.agentName]: "issues" }))
        void loadFeed(b)
      }
    }
  }, [bindings, feeds, tabs, loadFeed])

  const unbind = async (b: GitHubBinding): Promise<boolean> => {
    try {
      const ok = await window.api.githubUnbindRepo(b.agentName)
      if (!ok) return false
      showToast(t("github.toast.unbound", { name: b.agentName }), "success")
      await refresh()
      setFeeds((prev) => {
        const next = { ...prev }
        delete next[b.agentName]
        return next
      })
      return true
    } catch (e) {
      showToast((e as Error).message, "error")
      return false
    }
  }

  return {
    feeds,
    tabs,
    setTab: (agentName, tab) => setTabs((prev) => ({ ...prev, [agentName]: tab })),
    loadFeed,
    unbind,
  }
}
