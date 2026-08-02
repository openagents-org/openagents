import React from "react"
import { ExternalLink } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { GitHubPullRequest } from "@renderer/types"
import { timeAgo } from "../time-ago"
import { openExternal } from "./issue-list"

export function PullList({
  items,
  loading,
}: {
  items: GitHubPullRequest[]
  loading: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  if (loading && items.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{t("common.loading")}</p>
  }
  if (items.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{t("github.pulls.empty")}</p>
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((p) => (
        <li key={p.number} className="rounded-sm border bg-background p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a
                className="text-sm font-medium wrap-break-word hover:underline"
                href={p.html_url}
                onClick={openExternal(p.html_url)}
              >
                #{p.number} {p.title}
                {p.draft && (
                  <span className="ml-2 text-3xs uppercase text-muted-foreground">
                    {t("github.pulls.draft")}
                  </span>
                )}
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                <span>{t("github.pulls.by", { user: p.user.login })}</span>
                <span>·</span>
                <span>
                  {p.head.ref} → {p.base.ref}
                </span>
                <span>·</span>
                <span>
                  {t("github.pulls.updated", { time: timeAgo(p.updated_at, t) })}
                </span>
              </div>
            </div>
            <a
              className="shrink-0 text-muted-foreground hover:text-foreground"
              href={p.html_url}
              onClick={openExternal(p.html_url)}
              title={t("github.pulls.openOnGitHub")}
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </li>
      ))}
    </ul>
  )
}
