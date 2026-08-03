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
    <div className="mt-6">
      <h2 className="m-0 mb-3 text-sm font-semibold tracking-tight">
        {t("settings.detail.related")}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className="group flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {t(`settings.sections.${s.id}`)}
                </span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {t(`settings.pages.${s.id}.short`)}
                </span>
              </span>

              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
