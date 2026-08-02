import React from "react"
import { CircleDot, GitPullRequest, Pencil, RefreshCw, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/shadcn/button"
import { Card } from "@renderer/components/shadcn/card"
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/shadcn/tabs"
import { cn } from "@renderer/lib/utils"
import type { GitHubBinding } from "@renderer/types"
import { timeAgo } from "../time-ago"
import type { BindingFeed, FeedTab } from "../use-github-feeds"
import { IssueList, openExternal } from "./issue-list"
import { PullList } from "./pull-list"

interface Props {
  binding: GitHubBinding
  feed: BindingFeed
  tab: FeedTab
  credentialLabel: string
  commentDraft: Record<string, string>
  setCommentDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>
  commentingKey: string | null
  onTabChange: (tab: FeedTab) => void
  onReload: () => void
  onEdit: () => void
  onUnbind: () => void
  onComment: (issueNumber: number) => void
}

export function BindingCard({
  binding: b,
  feed,
  tab,
  credentialLabel,
  commentDraft,
  setCommentDraft,
  commentingKey,
  onTabChange,
  onReload,
  onEdit,
  onUnbind,
  onComment,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const repoUrl = `https://github.com/${b.owner}/${b.repo}`

  return (
    <Card className="gap-3 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold">
            <span className="truncate">{b.agentName}</span>
            <span className="text-xs font-normal text-muted-foreground">→</span>
            <a
              className="truncate text-primary hover:underline"
              href={repoUrl}
              onClick={openExternal(repoUrl)}
            >
              {b.owner}/{b.repo}
            </a>
          </div>
          <div className="mt-0.5 text-2xs text-muted-foreground">
            {t("github.credentialLine", {
              label: credentialLabel,
              time: timeAgo(b.createdAt, t),
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onReload}
            disabled={feed.loading}
            title={t("github.refreshBinding")}
          >
            <RefreshCw className={cn(feed.loading && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onEdit} title={t("github.editBinding")}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon" onClick={onUnbind} title={t("github.unbind")}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as FeedTab)} className="w-fit">
        <TabsList>
          <TabsTrigger value="issues" className="gap-1.5 text-2xs">
            <CircleDot className="size-3" />
            {t("github.tabs.issues", { count: feed.issues.length })}
          </TabsTrigger>
          <TabsTrigger value="pulls" className="gap-1.5 text-2xs">
            <GitPullRequest className="size-3" />
            {t("github.tabs.pulls", { count: feed.pulls.length })}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {feed.error && (
        <p className="rounded-sm bg-(--danger-bg) px-3 py-2 text-2xs wrap-break-word text-(--danger-text)">
          {feed.error}
        </p>
      )}

      {tab === "issues" ? (
        <IssueList
          binding={b}
          items={feed.issues}
          loading={feed.loading}
          commentDraft={commentDraft}
          setCommentDraft={setCommentDraft}
          onComment={onComment}
          commentingKey={commentingKey}
        />
      ) : (
        <PullList items={feed.pulls} loading={feed.loading} />
      )}
    </Card>
  )
}
