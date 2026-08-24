import React from "react"
import { useTranslation } from "react-i18next"
import { ChevronRight, RotateCcw } from "lucide-react"

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

  return (
    // Header and search stay put while the tiles scroll under them, the way
    // every other page in the launcher is built — one scroll container, and it
    // holds the list only. The whole screen used to be that container, so the
    // title and the filter you were typing into scrolled away with the cards.
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-9 pt-6 pb-4">
        <h1 className="m-0 text-2xl font-bold tracking-tight">
          {t("settings.title")}
        </h1>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">
          {t("settings.subtitle")}
        </p>

        <div className="flex items-center gap-3">
          <SearchInput
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onClear={() => onSearchChange("")}
            placeholder={t("settings.searchPlaceholder")}
            wrapperClassName="h-10 flex-1"
          />
          <Button variant="outline" size="lg" onClick={onReset}>
            <RotateCcw />
            {t("settings.overview.resetDefaults")}
          </Button>
        </div>

        <p className="mt-3 mb-0 text-xs text-muted-foreground">
          {t("settings.overview.hint")}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-9 py-6">
        {groups.map((group) => (
          <section key={group.id}>
            <h2 className="m-0 mb-3 text-sm font-semibold tracking-tight">
              {t(`settings.groups.${group.id}`)}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

        {groups.length === 0 && (
          <p className="m-0 text-xs text-muted-foreground">
            {t("settings.noSectionMatch")}
          </p>
        )}
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
      className="group flex items-center gap-4 rounded-xl border bg-card px-4 py-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {t(`settings.sections.${section.id}`)}
        </span>
        <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
          {summary}
        </span>
      </span>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
