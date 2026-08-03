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
import { IconToggle, SearchInput } from "@renderer/components/ui-kit"
import { cn } from "@renderer/lib/utils"
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
        {/* Counts live on the chips: the filter and the number it would leave
            on screen are the same fact, and splitting them into a filter row
            plus a stat row made the page repeat itself. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {AGENT_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFilter(f)}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
                filter === f
                  ? "border-primary bg-primary font-medium text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t(`agents.list.filters.${f}`)}
              <span
                className={cn(
                  "tabular-nums",
                  filter === f ? "opacity-80" : "opacity-70",
                )}
              >
                {counts[f]}
              </span>
            </button>
          ))}
        </div>

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
