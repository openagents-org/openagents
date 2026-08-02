import React from "react"
import { ArrowUp } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/shadcn/button"
import type { AgentUpdateInfo } from "@renderer/types"

interface Props {
  updates: AgentUpdateInfo[]
  onIgnore: (u: AgentUpdateInfo) => void
  onSnooze: (u: AgentUpdateInfo) => void
  onView: () => void
}

/** Preview at most this many agent names before the list gets unreadable. */
const PREVIEW_LIMIT = 3

export function PendingUpdatesBanner({
  updates,
  onIgnore,
  onSnooze,
  onView,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  if (updates.length === 0) return null

  // Ignore/snooze act on a single update, so only offer them when unambiguous.
  const single = updates.length === 1 ? updates[0] : null

  return (
    <div className="mb-5 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs">
      <ArrowUp className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          {single
            ? t("dashboard.updates.oneAvailable", { name: single.name })
            : t("dashboard.updates.manyAvailable", { count: updates.length })}
        </div>
        <div className="truncate text-muted-foreground">
          {updates
            .slice(0, PREVIEW_LIMIT)
            .map((u) => `${u.name} v${u.current} → v${u.latest}`)
            .join(" · ")}
        </div>
      </div>
      {single && (
        <>
          <Button size="sm" variant="ghost" onClick={() => onIgnore(single)}>
            {t("dashboard.updates.ignore")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onSnooze(single)}>
            {t("dashboard.updates.later")}
          </Button>
        </>
      )}
      <Button size="sm" onClick={onView}>
        {single ? t("dashboard.updates.updateNow") : t("dashboard.updates.view")}
      </Button>
    </div>
  )
}
