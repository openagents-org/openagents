import React from "react"
import { useTranslation } from "react-i18next"

import { SearchInput } from "@renderer/components/ui-kit"
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"

export const AGENT_FILTERS = ["all", "connected", "disconnected"] as const
export type AgentFilter = (typeof AGENT_FILTERS)[number]

interface Props {
  search: string
  onSearch: (v: string) => void
  filter: AgentFilter
  onFilter: (f: AgentFilter) => void
}

export function AgentsToolbar({
  search,
  onSearch,
  filter,
  onFilter,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mb-4 flex items-center gap-2">
      <SearchInput
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onClear={() => onSearch("")}
        placeholder={t("agents.list.searchPlaceholder")}
        wrapperClassName="h-10 flex-1"
      />
      <Tabs value={filter} onValueChange={(v) => onFilter(v as AgentFilter)}>
        <TabsList className="h-10">
          {AGENT_FILTERS.map((f) => (
            <TabsTrigger key={f} value={f} className="px-3 text-xs">
              {t(`agents.list.filters.${f}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
