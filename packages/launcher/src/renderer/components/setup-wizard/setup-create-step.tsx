import React from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldDescription, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"
import { Badge } from "@renderer/components/ui/badge"
import { cn } from "@renderer/lib/utils"

/** How the agent will authenticate, and whether that is actually settled. */
export interface ConnectionRecap {
  label: string
  model?: string
  /** False when the user chose to press on without a confirmed sign-in. */
  ok: boolean
}

/**
 * Step 2 — name the first instance. addAgent is unchanged from legacy, so the
 * install_agents.json schema is honoured without callers changing anything.
 *
 * The connection recap under the field is what the old third step was for. It
 * is a receipt, not a stage: the result belongs where the user can see it while
 * they do the one thing left. It reports what is true rather than what the flow
 * hoped for — nothing here forces a sign-in, so an unconfirmed one has to be
 * able to say so.
 */
export function SetupCreateStep({
  agentName,
  onChange,
  defaultName,
  connection,
}: {
  agentName: string
  onChange: (name: string) => void
  defaultName: string
  /** null for an agent with nothing to connect — then there is no card. */
  connection: ConnectionRecap | null
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="m-0 text-xl font-bold tracking-tight">
          {t("onboarding.wizard.createInstance.heading")}
        </h2>
        <p className="m-0 mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t("onboarding.wizard.createInstance.subheading")}
        </p>
      </div>

      <Field>
        <FieldLabel htmlFor="setup-agent-name">
          {t("onboarding.wizard.createInstance.agentNameLabel")}
        </FieldLabel>
        <Input
          id="setup-agent-name"
          value={agentName}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultName}
        />
        <FieldDescription>{t("onboarding.wizard.createInstance.hint")}</FieldDescription>
      </Field>

      {connection && (
        <div className="rounded-xl border bg-card p-5">
          <p className="m-0 text-sm font-semibold">
            {t("onboarding.wizard.createInstance.connectedEnv")}
          </p>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm">{connection.label}</div>
              {connection.model && (
                <div className="mt-1 truncate font-mono text-2xs text-muted-foreground">
                  {t("onboarding.wizard.createInstance.model", {
                    model: connection.model,
                  })}
                </div>
              )}
            </div>
            <Badge
              variant={connection.ok ? "success" : "warning"}
              className="shrink-0"
            >
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  connection.ok ? "bg-success" : "bg-warning",
                )}
              />
              {t(
                connection.ok
                  ? "onboarding.wizard.verify.ok"
                  : "onboarding.wizard.verify.unconfirmed",
              )}
            </Badge>
          </div>
        </div>
      )}
    </div>
  )
}
