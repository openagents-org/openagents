import React from "react"
import { useTranslation } from "react-i18next"
import { LayoutGrid, List } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import {
  FilterChips,
  IconToggle,
  PageToolbar,
  SearchInput,
} from "@renderer/components/ui-kit"
import {
  AGENT_FILTERS,
  AGENT_SORTS,
  type AgentFilter,
  type AgentSort,
  type AgentView,
} from "../use-agents-view"

interface Props {
  search: string
  onSearch: (v: string) => void
  filter: AgentFilter
  onFilter: (f: AgentFilter) => void
  counts: Record<AgentFilter, number>
  sort: AgentSort
  onSort: (s: AgentSort) => void
  view: AgentView
  onView: (v: AgentView) => void
}

export function AgentsToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  counts,
  sort,
  onSort,
  view,
  onView,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <PageToolbar>
      <SearchInput
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onClear={() => onSearch("")}
        placeholder={t("agents.list.searchPlaceholder")}
        wrapperClassName="flex-1"
      />

      <FilterChips
        value={filter}
        onChange={onFilter}
        options={AGENT_FILTERS.map((f) => ({
          value: f,
          label: t(`agents.list.filters.${f}`),
          count: counts[f],
        }))}
      />

      <Select value={sort} onValueChange={(v) => onSort(v as AgentSort)}>
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENT_SORTS.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`agents.list.sorts.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <IconToggle
        value={view}
        onChange={onView}
        options={[
          { value: "grid", icon: LayoutGrid, label: t("agents.list.views.grid") },
          { value: "list", icon: List, label: t("agents.list.views.list") },
        ]}
      />
    </PageToolbar>
  )
}
