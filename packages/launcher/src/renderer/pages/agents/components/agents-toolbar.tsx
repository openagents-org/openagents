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
import { FilterChips, IconToggle, SearchInput } from "@renderer/components/ui-kit"
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
    <div className="mb-4 flex flex-col gap-3">
      <SearchInput
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onClear={() => onSearch("")}
        placeholder={t("agents.list.searchPlaceholder")}
        wrapperClassName="h-10"
      />

      <div className="flex items-center gap-2">
        <FilterChips
          value={filter}
          onChange={onFilter}
          size="sm"
          options={AGENT_FILTERS.map((f) => ({
            value: f,
            label: t(`agents.list.filters.${f}`),
            count: counts[f],
          }))}
        />

        <div className="ml-auto flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => onSort(v as AgentSort)}>
            <SelectTrigger size="sm" className="w-32">
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
        </div>
      </div>
    </div>
  )
}
