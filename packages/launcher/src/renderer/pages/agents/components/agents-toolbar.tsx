import React from "react"
import { useTranslation } from "react-i18next"

import { FilterChips, SearchInput } from "@renderer/components/ui-kit"
import { AGENT_FILTERS, type AgentFilter } from "../use-agents-view"

interface Props {
  search: string
  onSearch: (v: string) => void
  filter: AgentFilter
  onFilter: (f: AgentFilter) => void
  counts: Record<AgentFilter, number>
}

/**
 * The list's heading row: its title, the state tabs beside it, search on the
 * right. No sort or view switch — the list is ordered by recent activity and
 * is always the table.
 */
export function AgentsToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  counts,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mb-3 flex h-11 items-center gap-8">
      <h2 className="m-0 shrink-0 text-lg font-semibold">{t("agents.shared.agentsHere")}</h2>
      <FilterChips
        variant="underline"
        value={filter}
        onChange={onFilter}
        options={AGENT_FILTERS.map((f) => ({
          value: f,
          label: t(`agents.list.filters.${f}`),
          count: counts[f],
        }))}
      />
      <SearchInput
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onClear={() => onSearch("")}
        placeholder={t("agents.list.searchPlaceholder")}
        wrapperClassName="ml-auto w-72"
      />
    </div>
  )
}
