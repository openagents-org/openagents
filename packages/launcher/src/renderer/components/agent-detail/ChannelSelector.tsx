import React from "react"
import { useTranslation } from "react-i18next"
import { cn } from "../../lib/utils"
import type { UpdateChannel } from "../../hooks/useAgentChannel"

interface ChannelSelectorProps {
  value: UpdateChannel
  onChange: (next: UpdateChannel) => void
  className?: string
}

const OPTIONS: Array<{ value: UpdateChannel }> = [
  { value: "stable" },
  { value: "beta" },
  { value: "nightly" },
]

/**
 * Per-agent update channel switcher (stage.md §2.5).
 *
 * Rendered as a 3-up segmented control so the user sees all options at a
 * glance and the dist-tag mapping is implicit in the label. Beta / Nightly
 * route the next Update through the install-at-version IPC; Stable uses the
 * default install pipeline.
 */
export function ChannelSelector({
  value,
  onChange,
  className,
}: ChannelSelectorProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-3xs uppercase tracking-wider text-(--text-tertiary)">
        {t("agents.channelSelector.updateChannel")}
      </span>
      <div
        role="radiogroup"
        aria-label={t("agents.channelSelector.updateChannel")}
        className="inline-flex p-0.5 bg-(--bg-input) border border-(--border) rounded-(--radius) gap-0.5 self-start"
      >
        {OPTIONS.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={t(`agents.channelSelector.${opt.value}Description`)}
              onClick={() => onChange(opt.value)}
              className={cn(
                "text-2xs px-2.5 py-1 rounded-sm cursor-pointer transition-colors duration-150",
                active
                  ? "bg-(--bg-card) text-(--text-primary) shadow-(--shadow-sm)"
                  : "text-(--text-secondary) hover:text-(--text-primary)",
              )}
            >
              {t(`agents.channelSelector.${opt.value}`)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
