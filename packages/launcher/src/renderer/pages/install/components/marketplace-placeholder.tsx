import React from "react"
import { useTranslation } from "react-i18next"
import { FilterX, SearchX } from "lucide-react"

import { Card } from "@renderer/components/ui/card"
import { Skeleton } from "@renderer/components/ui/skeleton"
import { EmptyState } from "@renderer/components/ui-kit"
import { GRID } from "./marketplace-grid"

/** Card-shaped placeholders while the catalog loads. */
export function MarketplaceSkeleton(): React.JSX.Element {
  return (
    <div className={GRID}>
      {Array.from({ length: 6 }, (_, i) => (
        <Card key={i} className="min-h-42 gap-2 px-4.5 py-4">
          <Skeleton className="mb-2 h-3 w-3/5" />
          <Skeleton className="h-2 w-4/5" />
          <Skeleton className="h-2 w-2/5" />
          <Skeleton className="mt-auto h-2 w-3/5" />
        </Card>
      ))}
    </div>
  )
}

/**
 * Nothing in the catalog matches. `onReset` is offered only while a search,
 * category or header counter is narrowing the list.
 */
export function MarketplaceEmpty({
  search,
  onReset,
}: {
  search: string
  onReset?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const query = search.trim()
  return (
    <EmptyState
      icon={query ? <SearchX /> : <FilterX />}
      title={
        query ? t("install.empty.noQueryMatchTitle") : t("install.empty.noMatchTitle")
      }
      description={
        query ? t("install.empty.noQueryMatch", { query }) : t("install.empty.noMatch")
      }
      action={
        onReset ? { label: t("install.empty.resetFilters"), onClick: onReset } : undefined
      }
    />
  )
}
