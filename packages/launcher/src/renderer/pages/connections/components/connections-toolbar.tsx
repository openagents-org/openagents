import React from "react"
import { useTranslation } from "react-i18next"

import { SearchInput } from "@renderer/components/ui-kit"
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import type { ConnectionFilter } from "../empty-state"

const FILTERS: ConnectionFilter[] = ["all", "connected", "disconnected"]

interface Props {
  search: string
  onSearchChange: (value: string) => void
  filter: ConnectionFilter
  onFilterChange: (value: ConnectionFilter) => void
}

export function ConnectionsToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mb-5 flex items-center gap-2">
      <SearchInput
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onClear={() => onSearchChange("")}
        placeholder={t("connections.search.placeholder")}
        wrapperClassName="max-w-70 flex-1"
      />
      <Tabs value={filter} onValueChange={(v) => onFilterChange(v as ConnectionFilter)}>
        <TabsList>
          {FILTERS.map((k) => (
            <TabsTrigger key={k} value={k} className="text-2xs">
              {t(`connections.filters.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
