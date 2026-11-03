import React from "react"
import { useTranslation } from "react-i18next"

import { FilterChips, SearchInput } from "@renderer/components/ui-kit"
import { AGENT_FILTERS, type AgentFilter } from "../use-agents-view"

/** Search earns its place past this many agents; below it the list fits on screen. */
const SEARCH_MIN = 6

interface Props {
  search: string
  onSearch: (v: string) => void
  filter: AgentFilter
  onFilter: (f: AgentFilter) => void
  counts: Record<AgentFilter, number>
}

/**
 * The filters that would narrow the list: none that match nothing, and none
 * that match everything ("Running 3" beside "All 3"). The one in use stays,
 * so a filter is never taken out from under the user. With nothing left to
 * narrow to, there are no tabs at all.
 */
function narrowing(counts: Record<AgentFilter, number>, filter: AgentFilter): AgentFilter[] {
  const useful = AGENT_FILTERS.filter(
    (f) => f !== "all" && (f === filter || (counts[f] > 0 && counts[f] < counts.all)),
  )
  return useful.length > 0 ? ["all", ...useful] : []
}

/**
 * The list's heading row: its title, the state tabs beside it, search on the
 * right — each only once there is something for it to do. No sort or view
 * switch: the list is ordered by recent activity.
 */
export function AgentsToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  counts,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const filters = narrowing(counts, filter)

  return (
    // Sticks to the top of the page's scroll body with the table header right
    // under it (top-12: this row's h-14 less the -top-2), so filters and
    // search stay in reach down a long list. Bled to the body's edges so rows
    // pass under an opaque band. `-top-2` cancels the body's `pt-2`: a sticky
    // element stops at the padding edge, which left a strip of rows showing
    // above it.
    <div className="sticky -top-2 z-10 -mx-9 flex h-14 items-center gap-8 bg-background px-9 pb-3">
      <h2 className="m-0 shrink-0 text-lg font-semibold">{t("agents.shared.agentsHere")}</h2>
      {filters.length > 0 && (
        <FilterChips
          variant="underline"
          value={filter}
          onChange={onFilter}
          options={filters.map((f) => ({
            value: f,
            label: t(`agents.list.filters.${f}`),
            count: counts[f],
          }))}
        />
      )}
      {(counts.all >= SEARCH_MIN || search) && (
        <SearchInput
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onClear={() => onSearch("")}
          placeholder={t("agents.list.searchPlaceholder")}
          wrapperClassName="ml-auto w-72"
        />
      )}
    </div>
  )
}
