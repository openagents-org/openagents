import React from "react"
import { useTranslation } from "react-i18next"
import { RotateCcw, ShieldCheck } from "lucide-react"

/**
 * What "reset all settings" actually touches, shown inside the confirmation.
 *
 * The prompt used to be one sentence — "back to defaults, cannot be undone" —
 * which is exactly the information a user already has and none of what they
 * are actually asking: does this wipe my agents? So both halves are spelled
 * out, and the answer to the scary half is the reassuring one.
 */
const AFFECTED = ["startup", "agents", "network", "updates"] as const
const KEPT = ["agents", "workspaces", "prefs"] as const

export function ResetSummary(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="grid gap-3 text-left sm:grid-cols-2">
      <Column
        tone="text-destructive"
        icon={<RotateCcw className="size-3" />}
        title={t("settings.resetDialog.affectedTitle")}
        items={AFFECTED.map((id) => t(`settings.resetDialog.affected.${id}`))}
      />
      <Column
        tone="text-(--success-text)"
        icon={<ShieldCheck className="size-3" />}
        title={t("settings.resetDialog.keptTitle")}
        items={KEPT.map((id) => t(`settings.resetDialog.kept.${id}`))}
      />
    </div>
  )
}

function Column({
  tone,
  icon,
  title,
  items,
}: {
  tone: string
  icon: React.ReactNode
  title: string
  items: string[]
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-muted/40 px-4 py-3">
      <div className={`flex items-center gap-1.5 text-2xs font-medium ${tone}`}>
        {icon}
        {title}
      </div>
      <ul className="mt-2 mb-0 flex list-none flex-col gap-1.5 pl-0 text-2xs text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
