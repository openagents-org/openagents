import React from "react"
import { useTranslation } from "react-i18next"
import { House } from "lucide-react"

import { cn } from "@renderer/lib/utils"
import { SECTIONS, type SectionId } from "../section-config"

/**
 * The settings directory, beside an open module only. It moves between
 * modules and back to the overview; the app's own pages stay in the top bar.
 */
export function SettingsNav({
  current,
  onSelect,
  onOverview,
}: {
  current: SectionId
  onSelect: (id: SectionId) => void
  onOverview: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const item = (active: boolean): string =>
    cn(
      "relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
      active
        ? "bg-(--accent-bg) font-medium text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
        : "hover:bg-row-hover",
    )

  return (
    <nav aria-label={t("settings.title")} className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r px-4 py-6">
      <h2 className="m-0 mb-3 px-3 text-xl font-bold tracking-tight">{t("settings.title")}</h2>
      <button type="button" className={item(false)} onClick={onOverview}>
        <House className="size-4 shrink-0" />
        {t("settings.overview.title")}
      </button>
      {SECTIONS.map((s) => {
        const Icon = s.icon
        return (
          <button
            key={s.id}
            type="button"
            aria-current={s.id === current ? "page" : undefined}
            className={item(s.id === current)}
            onClick={() => onSelect(s.id)}
          >
            <Icon className="size-4 shrink-0" />
            {t(`settings.sections.${s.id}`)}
          </button>
        )
      })}
    </nav>
  )
}
