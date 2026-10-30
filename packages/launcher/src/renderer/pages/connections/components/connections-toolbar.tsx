import React from "react"
import { ArrowDownUp, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"

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

import type { ConnectionFilter } from "../empty-state"
import { CONNECTION_SORTS, type ConnectionSort } from "../use-connections-view"

const FILTERS: ConnectionFilter[] = ["all", "connected", "disconnected"]

interface Props {
  search: string
  onSearchChange: (value: string) => void
  filter: ConnectionFilter
  onFilterChange: (value: ConnectionFilter) => void
  filterCounts: Record<ConnectionFilter, number>
  sort: ConnectionSort
  onSortChange: (value: ConnectionSort) => void
  ascending: boolean
  onToggleDirection: () => void
  refreshing: boolean
  onRefresh: () => void
}

export function ConnectionsToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  filterCounts,
  sort,
  onSortChange,
  ascending,
  onToggleDirection,
  refreshing,
  onRefresh,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const directionKey = ascending ? "connections.sort.asc" : "connections.sort.desc"

  return (
    <PageToolbar>
      <SearchInput
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onClear={() => onSearchChange("")}
        placeholder={t("connections.search.placeholder")}
        wrapperClassName="max-w-70 flex-1"
      />

      <FilterChips
        value={filter}
        onChange={onFilterChange}
        options={FILTERS.map((k) => ({
          value: k,
          label: t(`connections.filters.${k}`),
          count: filterCounts[k],
        }))}
      />

      <Select value={sort} onValueChange={(v) => onSortChange(v as ConnectionSort)}>
        <SelectTrigger className="ml-auto w-40" aria-label={t("connections.sort.label")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONNECTION_SORTS.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`connections.sort.${k}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        onClick={onToggleDirection}
        title={t(directionKey)}
        aria-label={t(directionKey)}
      >
        <ArrowDownUp className={cn(!ascending && "rotate-180")} />
      </Button>

      <Button variant="outline" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={cn(refreshing && "animate-spin")} />
        {t("connections.refresh")}
      </Button>
    </PageToolbar>
  )
}
