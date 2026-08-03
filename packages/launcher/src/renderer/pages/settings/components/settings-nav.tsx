import React from "react"
import { useTranslation } from "react-i18next"

import { SearchInput } from "@renderer/components/ui-kit/search-input"
import { cn } from "@renderer/lib/utils"
import { SECTIONS, type SectionId } from "../section-config"

interface SettingsNavProps {
  section: SectionId
  onSelect: (id: SectionId) => void
  search: string
  onSearchChange: (value: string) => void
}

/**
 * The settings rail. Filtering matches the section name *and* its description,
 * so searching "代理" / "proxy" finds Network even though the word appears in
 * neither title.
 */
export function SettingsNav({
  section,
  onSelect,
  search,
  onSearchChange,
}: SettingsNavProps): React.JSX.Element {
  const { t } = useTranslation()

  const query = search.trim().toLowerCase()
  const visible = query
    ? SECTIONS.filter((s) =>
        [
          t(`settings.sections.${s.id}`),
          t(`settings.pages.${s.id}.desc`),
          t(`settings.pages.${s.id}.keywords`),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : SECTIONS

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-2">
      <SearchInput
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onClear={() => onSearchChange("")}
        placeholder={t("settings.searchPlaceholder")}
        className="text-xs"
      />

      <nav className="flex flex-col gap-0.5">
        {visible.map((s) => {
          const Icon = s.icon
          const active = section === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs transition-colors",
                active
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{t(`settings.sections.${s.id}`)}</span>
            </button>
          )
        })}

        {visible.length === 0 && (
          <p className="px-3 py-2 text-2xs text-muted-foreground">
            {t("settings.noSectionMatch")}
          </p>
        )}
      </nav>
    </aside>
  )
}
