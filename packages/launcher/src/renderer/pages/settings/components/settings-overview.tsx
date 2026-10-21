import React from "react"
import { useTranslation } from "react-i18next"
import { ChevronRight, RefreshCw, RotateCcw } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { SearchInput } from "@renderer/components/ui-kit/search-input"
import { SECTION_GROUPS, type Section, type SectionId } from "../section-config"

interface SettingsOverviewProps {
  /** Current value of each module, shown under its name. */
  summaries: Record<SectionId, string>
  search: string
  onSearchChange: (value: string) => void
  onSelect: (id: SectionId) => void
  onReset: () => void
}

/**
 * The settings landing screen: every module as a card, grouped by intent. A
 * module's own controls only appear once it is opened, so no screen has to
 * carry a rail plus a panel.
 */
export function SettingsOverview({
  summaries,
  search,
  onSearchChange,
  onSelect,
  onReset,
}: SettingsOverviewProps): React.JSX.Element {
  const { t } = useTranslation()

  // Matching covers the description and keyword list too, so "代理" / "proxy"
  // finds Network even though the word is in neither title.
  const query = search.trim().toLowerCase()
  const matches = (s: Section): boolean =>
    !query ||
    [
      t(`settings.sections.${s.id}`),
      t(`settings.pages.${s.id}.desc`),
      t(`settings.pages.${s.id}.keywords`),
      summaries[s.id],
    ]
      .join(" ")
      .toLowerCase()
      .includes(query)

  const groups = SECTION_GROUPS.map((g) => ({
    id: g.id,
    sections: g.sections.filter(matches),
  })).filter((g) => g.sections.length > 0)

  // Two columns of groups, each filled top to bottom, so a group never splits.
  const columns = [groups.filter((_, i) => i % 2 === 0), groups.filter((_, i) => i % 2 === 1)]

  return (
    // Header and search stay put while the groups scroll under them, the way
    // every other page in the launcher is built — one scroll container, and it
    // holds the list only.
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-6 px-9 pt-7 pb-5">
        <div className="min-w-0">
          <h1 className="m-0 text-2xl font-bold tracking-tight">
            {t("settings.title")}
          </h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            {t("settings.subtitle")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-1">
          <SearchInput
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onClear={() => onSearchChange("")}
            placeholder={t("settings.searchPlaceholder")}
            wrapperClassName="w-80"
          />
          <Button variant="outline" onClick={onReset}>
            <RotateCcw />
            {t("settings.overview.resetDefaults")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-9 pb-6">
        {groups.length === 0 ? (
          <p className="m-0 text-xs text-muted-foreground">
            {t("settings.noSectionMatch")}
          </p>
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            {columns.map((column, i) => (
              <div key={i} className="flex flex-col gap-5">
                {column.map((group) => (
                  <section key={group.id} className="overflow-hidden rounded-lg border bg-card">
                    <h2 className="m-0 border-b bg-secondary px-5 py-3 text-sm font-semibold">
                      {t(`settings.groups.${group.id}`)}
                    </h2>
                    <div className="divide-y">
                      {group.sections.map((s) => (
                        <SectionTile
                          key={s.id}
                          section={s}
                          summary={summaries[s.id]}
                          onSelect={onSelect}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ))}
          </div>
        )}
        <p className="m-0 mt-5 flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="size-4" />
          {t("settings.overview.hint")}
        </p>
      </div>
    </div>
  )
}

function SectionTile({
  section,
  summary,
  onSelect,
}: {
  section: Section
  summary: string
  onSelect: (id: SectionId) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const Icon = section.icon

  return (
    <button
      type="button"
      onClick={() => onSelect(section.id)}
      className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-row-hover"
    >
      <Icon className="size-6 shrink-0 text-foreground/80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {t(`settings.sections.${section.id}`)}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {t(`settings.pages.${section.id}.short`)}
        </span>
      </span>
      <span className="max-w-48 shrink-0 truncate text-xs text-muted-foreground" title={summary}>
        {summary}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}
