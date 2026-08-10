import React from "react"
import {
  Activity,
  Layers,
  MessageSquare,
  Plus,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"

interface Props {
  runningCount: number
  /** Workspaces with recent traffic — not the total ever joined. */
  activeWorkspaceCount: number
  todayMessageCount: number
  /** Agents in an error state — what turns the greeting into a nudge. */
  attentionCount: number
  onNewAgent: () => void
  onNewWorkspace: () => void
}

const STATS: { key: "running" | "workspaces" | "messages"; icon: LucideIcon }[] = [
  { key: "running", icon: Activity },
  { key: "workspaces", icon: Layers },
  { key: "messages", icon: MessageSquare },
]

/**
 * The dashboard's header. It replaces the usual `PageHeader` because the first
 * thing this screen owes the user is a status sentence, not a page title — the
 * rail already says which page they are on.
 */
export function WelcomeHero({
  runningCount,
  activeWorkspaceCount,
  todayMessageCount,
  attentionCount,
  onNewAgent,
  onNewWorkspace,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  const values: Record<string, number> = {
    running: runningCount,
    workspaces: activeWorkspaceCount,
    messages: todayMessageCount,
  }

  const summary = [
    attentionCount > 0
      ? t("dashboard.welcome.attention", { count: attentionCount })
      : t("dashboard.welcome.allGood"),
    t("dashboard.welcome.messagesToday", { count: todayMessageCount }),
  ].join(" ")

  return (
    <section className="relative overflow-hidden rounded-xl border border-primary/25 bg-linear-to-r from-primary/12 via-primary/5 to-transparent px-7 py-6">
      {/* Ambient brand glow, the same decoration the marketplace banner uses —
          purely decorative, and it fills width that two lines of copy never
          will. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-24 size-96 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -bottom-32 size-96 rounded-full bg-primary/15 blur-3xl"
      />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 text-3xl font-bold tracking-tight">
            {t("dashboard.welcome.title")}
          </h1>
          <p className="m-0 mt-2 text-sm text-muted-foreground">{summary}</p>

          <div className="flex flex-wrap items-center gap-2 pt-5">
            <Button onClick={onNewAgent}>
              <Plus />
              {t("dashboard.welcome.newAgent")}
            </Button>
            <Button variant="outline" onClick={onNewWorkspace}>
              <Layers />
              {t("dashboard.welcome.newWorkspace")}
            </Button>
          </div>
        </div>

        <dl className="m-0 grid shrink-0 grid-cols-3 gap-6 lg:gap-8">
          {STATS.map((stat) => (
            // Centred, not leading-edge aligned: the label carries an icon and
            // the value is one or two glyphs, so left-aligning the two put the
            // number visibly off under its own heading.
            <div key={stat.key} className="flex flex-col items-center gap-1.5">
              {/* Each label hides a window ("today", "last 7 days"); without
                  the hint the numbers invite the wrong reading. */}
              <dt
                title={t(`dashboard.welcome.stats.hints.${stat.key}`)}
                className="flex items-center gap-1.5 text-2xs text-muted-foreground"
              >
                <stat.icon className="size-3.5" />
                {t(`dashboard.welcome.stats.${stat.key}`)}
              </dt>
              <dd className="m-0 text-3xl leading-none font-bold">
                {values[stat.key]}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
