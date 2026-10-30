import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "@renderer/lib/utils"
import { SECTION_GROUPS, type SectionId } from "../section-config"

/**
 * The settings menu, always beside the open module — there is no landing page
 * to come back to. Modules sit under the group they belong to, so the menu
 * doubles as the map of what can be set; the app's own pages stay in the top
 * bar.
 */
export function SettingsNav({
  current,
  onSelect,
}: {
  current: SectionId
  onSelect: (id: SectionId) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <nav aria-label={t("settings.title")} className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r px-3 py-6">
      {SECTION_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`settings-group-${group.id}`} className="flex flex-col gap-0.5">
          <h2 id={`settings-group-${group.id}`} className="m-0 mb-1 px-3 text-xs font-medium text-muted-foreground">
            {t(`settings.groups.${group.id}`)}
          </h2>
          {group.sections.map((s) => {
            const Icon = s.icon
            const active = s.id === current
            return (
              <button
                key={s.id}
                type="button"
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-(--accent-bg) font-medium text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                    : "text-foreground/85 hover:bg-row-hover hover:text-foreground",
                )}
                onClick={() => onSelect(s.id)}
              >
                <Icon className="size-4 shrink-0" />
                {t(`settings.sections.${s.id}`)}
              </button>
            )
          })}
        </section>
      ))}
    </nav>
  )
}
