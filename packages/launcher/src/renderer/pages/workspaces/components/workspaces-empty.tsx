import React from "react"
import { useTranslation } from "react-i18next"
import { FilterX, Layers, SearchX } from "lucide-react"

import { EmptyState } from "@renderer/components/ui-kit"

/**
 * Three distinct reasons the list can be empty, each with its own way out:
 * none at all, none matching what was typed (drop the search), none matching
 * the filter (widen it). Folding the last two together used to print
 * 没有匹配""的工作区 whenever a filter emptied the list with the search box
 * untouched.
 *
 * None at all offers no button of its own: the page's join button sits right
 * above it, and a second one here read as a different action.
 */
export function WorkspacesEmpty({
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
        icon={<Layers />}
        title={t("workspaces.emptyNoneTitle")}
        description={t("workspaces.emptyNone")}
      />
    )
  }
  if (search.trim()) {
    return (
      <EmptyState
        icon={<SearchX />}
        title={t("workspaces.emptyNoMatchTitle")}
        description={t("workspaces.emptyNoMatch", { query: search.trim() })}
        action={{ label: t("common.clearSearch"), onClick: onClearSearch }}
      />
    )
  }
  return (
    <EmptyState
      icon={<FilterX />}
      title={t("workspaces.emptyNoFilterMatchTitle")}
      description={t("workspaces.emptyNoFilterMatch")}
      action={{ label: t("common.showAll"), onClick: onShowAll }}
    />
  )
}
