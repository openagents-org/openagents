import React from "react"
import { ExternalLink, MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/shadcn/button"
import { Input } from "@renderer/components/shadcn/input"
import type { GitHubBinding, GitHubIssue } from "@renderer/types"
import { timeAgo } from "../time-ago"

const MAX_LABELS = 3

interface Props {
  binding: GitHubBinding
  items: GitHubIssue[]
  loading: boolean
  commentDraft: Record<string, string>
  setCommentDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onComment: (issueNumber: number) => void
  commentingKey: string | null
}

export function openExternal(url: string) {
  return (e: React.MouseEvent): void => {
    e.preventDefault()
    window.api.openExternal(url)
  }
}

export function IssueList({
  binding,
  items,
  loading,
  commentDraft,
  setCommentDraft,
  onComment,
  commentingKey,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  if (loading && items.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{t("common.loading")}</p>
  }
  if (items.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground">{t("github.issues.empty")}</p>
    )
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((i) => {
        const key = `${binding.agentName}:${i.number}`
        const draft = commentDraft[key] || ""
        const sending = commentingKey === key

        return (
          <li key={i.number} className="rounded-sm border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a
                  className="text-sm font-medium wrap-break-word hover:underline"
                  href={i.html_url}
                  onClick={openExternal(i.html_url)}
                >
                  #{i.number} {i.title}
                </a>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                  <span>{t("github.issues.by", { user: i.user.login })}</span>
                  <span>·</span>
                  <span>
                    {t("github.issues.updated", { time: timeAgo(i.updated_at, t) })}
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="size-3" />
                    {i.comments}
                  </span>
                  {i.labels.slice(0, MAX_LABELS).map((l) => (
                    <span
                      key={l.name}
                      className="rounded-full px-1.5 py-0.5 text-3xs"
                      // Label colours come from the GitHub API, so they can only
                      // be applied inline. `33` is ~20% alpha.
                      style={{
                        background: l.color ? `#${l.color}33` : "var(--bg-input)",
                      }}
                    >
                      {l.name}
                    </span>
                  ))}
                </div>
              </div>
              <a
                className="shrink-0 text-muted-foreground hover:text-foreground"
                href={i.html_url}
                onClick={openExternal(i.html_url)}
                title={t("github.issues.openOnGitHub")}
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <Input
                placeholder={t("github.issues.replyPlaceholder")}
                value={draft}
                onChange={(e) =>
                  setCommentDraft((d) => ({ ...d, [key]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && draft.trim() && !sending) {
                    e.preventDefault()
                    onComment(i.number)
                  }
                }}
                disabled={sending}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={() => onComment(i.number)}
                disabled={!draft.trim() || sending}
              >
                {sending ? t("github.issues.posting") : t("github.issues.comment")}
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
