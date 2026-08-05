import React from "react"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"

import { cn } from "@renderer/lib/utils"

/**
 * The right-hand aside. It exists so the flow can answer "where am I going?"
 * without spending a whole step on the answer — the connection test used to be
 * a full page that told the user one thing, and this is that one thing, parked
 * beside the form instead of in front of it.
 *
 * It paints the fixed dark surface in both themes, the same way the onboarding
 * rail and the app rail do, so "this is the frame, not the form" needs no
 * further explaining.
 */
export function WizardSummary({
  badge,
  title,
  description,
  children,
}: {
  /** Two-digit marker. The step being described, which is not always current. */
  badge: string
  title: string
  description: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <aside className="hidden min-w-0 flex-col rounded-xl bg-sidebar p-6 md:flex">
      <div className="flex items-start gap-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary font-mono text-2xs font-bold text-sidebar-primary-foreground">
          {badge}
        </span>
        <div className="min-w-0">
          <h3 className="m-0 text-base font-bold text-sidebar-accent-foreground">
            {title}
          </h3>
          <p className="m-0 mt-1 text-xs leading-relaxed text-sidebar-muted">
            {description}
          </p>
        </div>
      </div>
      {children && (
        <>
          <span className="my-5 h-px shrink-0 bg-sidebar-border" />
          <div className="flex min-w-0 flex-col gap-4">{children}</div>
        </>
      )}
    </aside>
  )
}

/** A labelled block inside the panel. The label is the quietest thing in it. */
export function SummarySection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-2xs text-sidebar-muted">{label}</div>
      <div className="mt-2 min-w-0">{children}</div>
    </div>
  )
}

/**
 * The verification state, as one line. Every branch keeps the same shape and
 * position so a result replaces the thing that preceded it rather than pushing
 * the panel around.
 */
export function VerifyStatus({
  state,
  message,
}: {
  state: "idle" | "running" | "ok" | "failed"
  message: string
}): React.JSX.Element {
  const tone = {
    idle: "border-sidebar-border bg-white/5 text-sidebar-muted",
    running: "border-sidebar-border bg-white/5 text-sidebar-accent-foreground",
    ok: "border-(--success-border) bg-success/15 text-success",
    failed: "border-(--danger-border) bg-destructive/15 text-destructive",
  }[state]

  const Icon = { idle: null, running: Loader2, ok: CheckCircle2, failed: AlertCircle }[
    state
  ]

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-xs font-semibold",
        tone,
      )}
    >
      {Icon && (
        <Icon
          className={cn("mt-px size-4 shrink-0", state === "running" && "animate-spin")}
          strokeWidth={2}
        />
      )}
      <span className="min-w-0 leading-relaxed break-words">{message}</span>
    </div>
  )
}
