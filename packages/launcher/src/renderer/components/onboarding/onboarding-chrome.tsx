import React from "react"
import { ChevronLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"

import { STEP_IDS, type Step } from "./onboarding-shared"

/**
 * The step's headline. Not an `<h1>`: globals.css pins h1 to 1.375rem.
 * Carries no outer spacing — the container owns it, since the heading sits in
 * its own pinned row above the scroll area.
 */
export function StepHeading({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}): React.JSX.Element {
  return (
    <div>
      <h2 className="m-0 text-3xl font-bold tracking-tight">{title}</h2>
      <p className="mt-2.5 mb-0 max-w-2xl text-base text-(--text-secondary)">
        {subtitle}
      </p>
    </div>
  )
}

/** Monospaced section marker with a rule running to the edge of the column. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn("mb-4 flex items-center gap-3", className)}>
      <span className="font-mono text-2xs font-medium tracking-widest text-(--text-tertiary) uppercase">
        {children}
      </span>
      <span className="h-px flex-1 bg-(--border)" />
    </div>
  )
}

/**
 * Field label with the underlying identifier (env var, id) parked on the right
 * in mono — the value the agent actually receives, next to the human name.
 */
export function FieldLabel({
  label,
  token,
  required,
  htmlFor,
}: {
  label: string
  token: string
  required?: boolean
  htmlFor?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      {/* One line, always: the label and the identifier must not reflow, or
          fields in a two-column row stop lining up with each other. The
          identifier wins the space — it is the shorter, exact string. */}
      <label htmlFor={htmlFor} className="truncate text-sm font-semibold">
        {label}
      </label>
      <span className="shrink-0 font-mono text-2xs text-(--text-tertiary)">
        {token}
        {required && (
          <span className="ml-2 text-(--accent)">
            {t("onboarding.flow.field.required")}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * Inline monospace chip for commands and hostnames inside prose. (The old
 * `.inline-code` class these call sites used was never defined in any
 * stylesheet, so the commands rendered as unstyled text.)
 */
export function InlineCode({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <code className="rounded-sm bg-accent px-1.5 py-0.5 font-mono text-2xs">
      {children}
    </code>
  )
}

/** Shared frame for the pickable cards (agents, workspace mode). */
export function selectableCard(active: boolean): string {
  return cn(
    "rounded-lg border bg-(--bg-card) text-left transition-colors",
    active
      ? "border-(--accent) bg-(--accent-bg)"
      : "border-(--border) hover:border-(--border-hover)",
  )
}

/**
 * Sticky action bar: back on the left, step dots in the middle, the step's own
 * actions on the right. The dots double as the progress indicator on narrow
 * windows, where the rail is hidden.
 */
export function FooterBar({
  step,
  onBack,
  children,
}: {
  step: Step
  onBack?: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <footer className="shrink-0 border-t border-(--border) bg-(--bg-card) px-10 py-4">
      <div className="mx-auto flex w-full max-w-4xl items-center gap-4">
        <div className="flex-1">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ChevronLeft />
              {t("onboarding.flow.footer.back")}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1.5" aria-hidden>
          {STEP_IDS.map((id, i) => (
            <span
              key={id}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step
                  ? "w-5 bg-(--accent)"
                  : i < step
                    ? "w-1.5 bg-(--accent-border)"
                    : "w-1.5 bg-(--border-hover)",
              )}
            />
          ))}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          {children}
        </div>
      </div>
    </footer>
  )
}
