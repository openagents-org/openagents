import type { CatalogEntry } from "@renderer/types"

export interface CategoryDef {
  key: string
  match: (e: CatalogEntry) => boolean
}

/**
 * Category chips above the catalog. "all" is the implicit reset; the rest map
 * onto registry tags, so adding a tag to a registry entry is the only change
 * needed to surface it under a category. Labels are translated at render time
 * from `install.categories.<key>`.
 */
export const CATEGORIES: CategoryDef[] = [
  { key: "all", match: () => true },
  { key: "coding", match: (e) => (e.tags || []).includes("coding") },
  { key: "open-source", match: (e) => (e.tags || []).includes("open-source") },
  { key: "cli", match: (e) => (e.tags || []).includes("cli") },
  {
    key: "ide-extension",
    match: (e) =>
      (e.tags || []).some(
        (t) => t === "vscode" || t === "editor" || t === "ide-extension",
      ),
  },
  { key: "productivity", match: (e) => (e.tags || []).includes("productivity") },
  { key: "ai-tools", match: (e) => (e.tags || []).includes("ai-tools") },
  { key: "automation", match: (e) => (e.tags || []).includes("automation") },
  { key: "devtools", match: (e) => (e.tags || []).includes("devtools") },
]
