import React from "react"
import { useTranslation } from "react-i18next"
import { Cpu, FilterX, SearchX } from "lucide-react"

import { EmptyState } from "@renderer/components/ui-kit"

/**
 * Three reasons the list can be empty, each with its own way out: nothing
 * added yet, nothing matching the search (drop it), nothing in this state
 * (widen the filter). Nothing added offers no button of its own — the
 * recommended agents and "connect more" sit right above it.
 */
export function AgentsEmpty({
  hasAny,
  search,
  onClearSearch,
  onShowAll,
}: {
  hasAny: boolean
  search: string
  onClearSearch: () => void
  onShowAll: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  if (!hasAny) {
    return (
      <EmptyState
        icon={<Cpu />}
        title={t("agents.list.emptyTitle")}
        description={t("agents.list.empty")}
      />
    )
  }
  if (search.trim()) {
    return (
      <EmptyState
        icon={<SearchX />}
        title={t("agents.list.emptyNoMatchTitle")}
        description={t("agents.list.emptyNoMatch", { query: search.trim() })}
        action={{ label: t("common.clearSearch"), onClick: onClearSearch }}
      />
    )
  }
  return (
    <EmptyState
      icon={<FilterX />}
      title={t("agents.list.emptyNoFilterMatchTitle")}
      description={t("agents.list.emptyNoFilterMatch")}
      action={{ label: t("common.showAll"), onClick: onShowAll }}
    />
  )
}
