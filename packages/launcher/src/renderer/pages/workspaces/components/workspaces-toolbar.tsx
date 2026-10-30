import React from "react"
import { useTranslation } from "react-i18next"
import { RefreshCw } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { FilterChips, PageToolbar, SearchInput } from "@renderer/components/ui-kit"
import { cn } from "@renderer/lib/utils"
import {
  WORKSPACE_FILTERS,
  WORKSPACE_SORTS,
  type WorkspaceFilter,
  type WorkspaceSort,
  type WorkspaceStats,
} from "../use-workspaces-data"

interface Props {
  search: string
  onSearch: (v: string) => void
  filter: WorkspaceFilter
  onFilter: (f: WorkspaceFilter) => void
  stats: WorkspaceStats
  sort: WorkspaceSort
  onSort: (s: WorkspaceSort) => void
  onRefresh: () => void
  refreshing?: boolean
}

/** Rows each chip would leave on screen, in the order WORKSPACE_FILTERS lists. */
function countOf(filter: WorkspaceFilter, stats: WorkspaceStats): number {
  if (filter === "healthy") return stats.healthy
  if (filter === "problem") return stats.warning + stats.error
  if (filter === "disconnected") return stats.disconnected
  return stats.total
}

export function WorkspacesToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  stats,
  sort,
  onSort,
  onRefresh,
  refreshing,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <PageToolbar>
      <SearchInput
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onClear={() => onSearch("")}
        placeholder={t("workspaces.searchPlaceholder")}
        wrapperClassName="flex-1"
      />

      <FilterChips
        value={filter}
        onChange={onFilter}
        options={WORKSPACE_FILTERS.map((f) => ({
          value: f,
          label: t(`workspaces.filters.${f}`),
          count: countOf(f, stats),
        }))}
      />

      <Select value={sort} onValueChange={(v) => onSort(v as WorkspaceSort)}>
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WORKSPACE_SORTS.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`workspaces.sorts.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Labelled, like every other page-level refresh (connections, logs,
          GitHub) — an icon alone was the odd one out. */}
      <Button variant="outline" disabled={refreshing} onClick={onRefresh}>
        <RefreshCw className={cn(refreshing && "animate-spin")} />
        {t("workspaces.refresh")}
      </Button>
    </PageToolbar>
  )
}
