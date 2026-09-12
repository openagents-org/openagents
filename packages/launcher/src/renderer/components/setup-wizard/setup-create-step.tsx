import React from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldDescription, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"
import { Badge } from "@renderer/components/ui/badge"
import { Checkbox } from "@renderer/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { cn } from "@renderer/lib/utils"

/** How the agent will authenticate, and whether that is actually settled. */
export interface ConnectionRecap {
  label: string
  model?: string
  /** False when the user chose to press on without a confirmed sign-in. */
  ok: boolean
  /**
   * The step passed, but nothing was actually checked — this agent has no
   * endpoint to probe. Reported as unconfirmed rather than verified: a green
   * tick for a check that never ran is a claim the user finds out is false the
   * first time the agent runs.
   */
  unsupported?: boolean
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
  pairedWorkspaces,
  pairedWorkspace,
  onPairedWorkspaceChange,
  connectOnCreate,
  onConnectOnCreateChange,
}: {
  agentName: string
  onChange: (name: string) => void
  defaultName: string
  /** null for an agent with nothing to connect — then there is no card. */
  connection: ConnectionRecap | null
  /** Every workspace this device is paired with; empty for local-only. */
  pairedWorkspaces: Array<{ slug: string; name: string | null }>
  /** The one the agent will join — an entry of the list above, or null. */
  pairedWorkspace: { slug: string; name: string | null } | null
  onPairedWorkspaceChange: (slug: string) => void
  connectOnCreate: boolean
  onConnectOnCreateChange: (v: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  // Verified means something answered. Reaching this step without a probe —
  // an unconfirmed CLI sign-in, or an agent with nothing to probe — is
  // "unconfirmed", not a green tick.
  const verified = !!connection?.ok && !connection.unsupported

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

      {/* The one line that stops this funnel dead-ending local-only: with a
          paired workspace the new agent joins it on creation (default on).

          A device can be paired with several workspaces. With one, the sentence
          names it and there is nothing to choose. With more, it has to be a
          choice — this used to bind to whichever pairing happened to be first
          and never said so, so a second workspace could only be discovered
          after the agent had already joined the wrong one. */}
      {pairedWorkspace && (
        <div className="rounded-xl border bg-card px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox
              checked={connectOnCreate}
              onCheckedChange={(v) => onConnectOnCreateChange(v === true)}
            />
            <span className="text-sm">
              {pairedWorkspaces.length > 1
                ? t("onboarding.wizard.createInstance.connectToWorkspace")
                : t("onboarding.wizard.createInstance.connectTo", {
                    name: pairedWorkspace.name || pairedWorkspace.slug,
                  })}
            </span>
          </label>
          {pairedWorkspaces.length > 1 && (
            <Select
              value={pairedWorkspace.slug}
              onValueChange={onPairedWorkspaceChange}
              disabled={!connectOnCreate}
            >
              <SelectTrigger className="mt-2.5 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pairedWorkspaces.map((w) => (
                  <SelectItem key={w.slug} value={w.slug}>
                    {w.name || w.slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

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
