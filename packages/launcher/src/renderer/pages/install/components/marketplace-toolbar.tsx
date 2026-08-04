import React from "react"
import { LayoutGrid, List } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { IconToggle, SearchInput } from "@renderer/components/ui-kit"
import type {
  MarketplaceSort,
  MarketplaceView,
} from "@renderer/hooks/useMarketplacePrefs"

const SORTS: MarketplaceSort[] = ["featured", "popular", "newest", "name"]
const VIEWS = [
  { value: "grid" as const, icon: LayoutGrid },
  { value: "list" as const, icon: List },
]

interface Props {
  search: string
  onSearchChange: (value: string) => void
  sort: MarketplaceSort
  onSortChange: (value: MarketplaceSort) => void
  view: MarketplaceView
  onViewChange: (value: MarketplaceView) => void
}

/** Search / sort / layout — the controls that shape the catalog below. */
export function MarketplaceToolbar({
  search,
  onSearchChange,
  sort,
  onSortChange,
  view,
  onViewChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onClear={() => onSearchChange("")}
        placeholder={t("install.search.placeholder")}
        wrapperClassName="min-w-60 flex-1"
      />

      <Select value={sort} onValueChange={(v) => onSortChange(v as MarketplaceSort)}>
        <SelectTrigger className="w-40" aria-label={t("install.sort.ariaLabel")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((key) => (
            <SelectItem key={key} value={key}>
              {t("install.sort.prefix", { label: t(`install.sort.${key}`) })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <IconToggle
        value={view}
        onChange={onViewChange}
        options={VIEWS.map((v) => ({
          ...v,
          label: t("install.viewToggle.viewLabel", {
            label: t(`install.viewToggle.${v.value}`),
          }),
        }))}
      />
    </div>
  )
}
