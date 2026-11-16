import React from "react"
import { useTranslation } from "react-i18next"
import { Alert, AlertDescription, AlertTitle } from "@renderer/components/ui/alert"
import { RotateCcw, ShieldCheck } from "lucide-react"

/**
 * What a reset actually touches, shown inside the confirmation.
 *
 * The prompt used to be one sentence — "back to defaults, cannot be undone" —
 * which is exactly the information a user already has and none of what they
 * are actually asking: does this wipe my agents? So both halves are spelled
 * out, and the answer to the scary half is the reassuring one.
 *
 * Two resets use this now (all settings, and the launcher's local state), so
 * the strings come from a caller-supplied `settings.*Dialog` prefix.
 */
export interface ResetSummaryProps {
  /** i18n prefix holding `affectedTitle`, `affected.*`, `keptTitle`, `kept.*`. */
  prefix: string
  affected: readonly string[]
  kept: readonly string[]
}

export function ResetSummary({
  prefix,
  affected,
  kept,
}: ResetSummaryProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="grid gap-3 text-left sm:grid-cols-2">
      <Column
        tone="text-destructive"
        icon={<RotateCcw />}
        title={t(`${prefix}.affectedTitle`)}
        items={affected.map((id) => t(`${prefix}.affected.${id}`))}
      />
      <Column
        tone="text-foreground"
        icon={<ShieldCheck />}
        title={t(`${prefix}.keptTitle`)}
        items={kept.map((id) => t(`${prefix}.kept.${id}`))}
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
    // The tone colours the title and, through `text-current`, the icon; the
    // description keeps its own muted colour.
    <Alert className={tone}>
      {icon}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="m-0 flex list-none flex-col gap-1.5 pl-0 text-xs">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
