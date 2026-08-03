import React from "react"
import { useTranslation } from "react-i18next"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import type { MarketplaceSort as SortKey } from "../../hooks/useMarketplacePrefs"

interface MarketplaceSortProps {
  value: SortKey
  onChange: (next: SortKey) => void
}

// Keep only the ids at module level; labels are translated at render time.
const OPTION_KEYS: SortKey[] = ["featured", "popular", "newest", "name"]

/** Sort dropdown — stage.md §2.1 keys: featured / newest / popular / name. */
export function MarketplaceSort({
  value,
  onChange,
}: MarketplaceSortProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Select value={value} onValueChange={(next) => onChange(next as SortKey)}>
      <SelectTrigger size="sm" className="w-40" aria-label={t("install.sort.ariaLabel")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent size="sm">
        {OPTION_KEYS.map((key) => (
          <SelectItem key={key} value={key}>
            {t("install.sort.prefix", { label: t(`install.sort.${key}`) })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
