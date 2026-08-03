import React from "react"
import { useTranslation } from "react-i18next"

import { FilterChips } from "@renderer/components/ui-kit"
import type { CatalogEntry } from "@renderer/types"

import { CATEGORIES } from "../categories"

interface Props {
  catalog: CatalogEntry[]
  category: string
  onCategoryChange: (key: string) => void
}

/**
 * Category filter over the catalog — the same chips the agents, workspaces and
 * connections lists use, so a filter looks like a filter everywhere.
 *
 * A category that matches nothing in the current catalog is hidden so the row
 * isn't a list of always-empty buckets — except the active one, which stays
 * put; a chip that vanished on click would read as a glitch.
 */
export function MarketplaceCategories({
  catalog,
  category,
  onCategoryChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  // The count decides whether a chip appears at all, but is not printed on it:
  // "how many agents are tagged coding" is not a number anyone acts on, and the
  // header already says how many are available, installed and updatable.
  const options = CATEGORIES.map((c) => ({
    ...c,
    count: c.key === "all" ? catalog.length : catalog.filter(c.match).length,
  }))
    .filter((c) => c.key === "all" || c.key === category || c.count > 0)
    .map((c) => ({
      value: c.key,
      label: t(`install.categories.${c.key}`),
    }))

  return (
    <FilterChips
      value={category}
      onChange={onCategoryChange}
      options={options}
    />
  )
}
