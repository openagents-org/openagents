import React from "react"
import { useTranslation } from "react-i18next"
import { ChevronRight } from "lucide-react"

import { SECTIONS, type SectionId } from "../section-config"

/**
 * Jumps to the modules a user typically wants next — the pairs that came up
 * repeatedly while the rail existed (theme → language, general → runtime).
 * Without it, every hop between two related settings goes via the overview.
 */
export function RelatedSettings({
  ids,
  onSelect,
}: {
  ids: SectionId[]
  onSelect: (id: SectionId) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  const items = ids
    .map((id) => SECTIONS.find((s) => s.id === id))
    .filter((s): s is (typeof SECTIONS)[number] => !!s)
  if (items.length === 0) return null

  return (
    <div className="mt-6 overflow-hidden rounded-lg border bg-card">
      <h2 className="m-0 border-b bg-secondary px-5 py-3 text-sm font-semibold">
        {t("settings.detail.related")}
      </h2>

      <div className="divide-y">
        {items.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className="group flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-row-hover"
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {t(`settings.sections.${s.id}`)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t(`settings.pages.${s.id}.short`)}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
