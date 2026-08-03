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
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import { SearchInput } from "@renderer/components/ui-kit"
import { cn } from "@renderer/lib/utils"
import {
  WORKSPACE_FILTERS,
  WORKSPACE_SORTS,
  type WorkspaceFilter,
  type WorkspaceSort,
} from "../use-workspaces-data"

interface Props {
  search: string
  onSearch: (v: string) => void
  filter: WorkspaceFilter
  onFilter: (f: WorkspaceFilter) => void
  sort: WorkspaceSort
  onSort: (s: WorkspaceSort) => void
  onRefresh: () => void
  refreshing?: boolean
}

export function WorkspacesToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  sort,
  onSort,
  onRefresh,
  refreshing,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mb-5 flex items-center gap-2">
      <SearchInput
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onClear={() => onSearch("")}
        placeholder={t("workspaces.searchPlaceholder")}
        wrapperClassName="h-10 flex-1"
      />

      <Tabs value={filter} onValueChange={(v) => onFilter(v as WorkspaceFilter)}>
        <TabsList className="h-10">
          {WORKSPACE_FILTERS.map((f) => (
            <TabsTrigger key={f} value={f} className="px-3 text-xs">
              {t(`workspaces.filters.${f}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Select value={sort} onValueChange={(v) => onSort(v as WorkspaceSort)}>
        <SelectTrigger className="h-10 w-36">
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

      <Button
        variant="outline"
        size="icon"
        className="size-10"
        aria-label={t("workspaces.refresh")}
        title={t("workspaces.refresh")}
        disabled={refreshing}
        onClick={onRefresh}
      >
        <RefreshCw className={cn(refreshing && "animate-spin")} />
      </Button>
    </div>
  )
}
