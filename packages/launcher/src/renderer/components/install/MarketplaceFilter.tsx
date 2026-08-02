import React from "react"
import { useTranslation } from "react-i18next"
import { cn } from "../../lib/utils"
import type { CatalogEntry } from "../../types"

export interface CategoryDef {
  key: string
  label: string
  match: (e: CatalogEntry) => boolean
}

/**
 * Category list per stage.md §2.1. "all" is the implicit reset; the rest
 * map onto registry tags so adding a tag to a registry entry is the only
 * change needed to surface it under a category.
 */
export const CATEGORIES: CategoryDef[] = [
  { key: "all", label: "All", match: () => true },
  { key: "coding", label: "Coding", match: (e) => (e.tags || []).includes("coding") },
  { key: "open-source", label: "Open source", match: (e) => (e.tags || []).includes("open-source") },
  { key: "cli", label: "CLI", match: (e) => (e.tags || []).includes("cli") },
  { key: "ide-extension", label: "IDE extension", match: (e) => (e.tags || []).some((t) => t === "vscode" || t === "editor" || t === "ide-extension") },
  { key: "productivity", label: "Productivity", match: (e) => (e.tags || []).includes("productivity") },
  { key: "ai-tools", label: "AI tools", match: (e) => (e.tags || []).includes("ai-tools") },
  { key: "automation", label: "Automation", match: (e) => (e.tags || []).includes("automation") },
  { key: "devtools", label: "Dev tools", match: (e) => (e.tags || []).includes("devtools") },
]

interface MarketplaceFilterProps {
  catalog: CatalogEntry[]
  category: string
  onCategoryChange: (key: string) => void
}

/**
 * Horizontal category chips. Categories that match zero catalog entries are
 * hidden automatically so the user doesn't see a row of always-empty buckets.
 * The current selection always renders even if empty, otherwise switching to
 * an empty filter would make its own chip disappear and look like a UI glitch.
 */
export function MarketplaceFilter({
  catalog,
  category,
  onCategoryChange,
}: MarketplaceFilterProps): React.JSX.Element {
  const { t } = useTranslation()
  const visibleCategories = CATEGORIES.filter((c) => {
    if (c.key === "all") return true
    if (c.key === category) return true
    return catalog.some((e) => c.match(e))
  })

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibleCategories.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onCategoryChange(c.key)}
          className={cn(
            "cursor-pointer rounded-full border px-2.5 py-1 text-2xs transition-colors",
            category === c.key
              ? "bg-(--accent) text-(--accent-text) border-(--accent)"
              : "bg-(--bg-card) text-(--text-secondary) border-(--border) hover:border-(--border-hover) hover:text-(--text-primary)",
          )}
          aria-pressed={category === c.key}
        >
          {t(`install.categories.${c.key}`)}
        </button>
      ))}
    </div>
  )
}
