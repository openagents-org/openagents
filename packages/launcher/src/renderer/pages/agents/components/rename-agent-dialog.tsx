import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { Button } from "@renderer/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"
import type { Agent } from "@renderer/types"
import { agentLabel } from "./agent-actions"

interface Props {
  /** The agent being renamed; null keeps the dialog closed. */
  agent: Agent | null
  onClose: () => void
  onSubmit: (displayName: string) => Promise<void>
}

/**
 * Rename one agent — which sets a display LABEL, never the agent's identity.
 *
 * `agent.name` keys the config, the working directory under
 * ~/.openagents/agents, the agent's sessions and its workspace membership, so
 * it is deliberately immutable and shown here read-only. An agent in a
 * workspace has its label pushed there too, so both sides read the same thing;
 * the workspace refuses a label another member already answers to (it doubles
 * as an @-mention alias), and that refusal fails the rename rather than
 * leaving the two sides disagreeing.
 */
export function RenameAgentDialog({
  agent,
  onClose,
  onSubmit,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)

  // Seed from the current label each time a different agent is opened, so the
  // field never shows the previous agent's name for a frame.
  useEffect(() => {
    if (agent) setValue(agent.displayName?.trim() || "")
  }, [agent])

  const trimmed = value.trim()
  const unchanged = trimmed === (agent?.displayName?.trim() || "")

  const submit = async (): Promise<void> => {
    if (!agent || saving || unchanged) return
    setSaving(true)
    try {
      await onSubmit(trimmed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!agent} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="rename-agent">
        <DialogHeader>
          <DialogTitle>
            {t("agents.renameDialog.title", {
              name: agent ? agentLabel(agent) : "",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("agents.renameDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Field>
            <FieldLabel htmlFor="agent-rename-input">
              {t("agents.renameDialog.label")}
            </FieldLabel>
            <Input
              id="agent-rename-input"
              autoFocus
              value={value}
              placeholder={agent?.name || ""}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit()
              }}
            />
            <FieldDescription>
              {/* Says what clearing does, because an empty field is a real
                  choice here rather than an incomplete form. */}
              {t("agents.renameDialog.hint", { name: agent?.name || "" })}
            </FieldDescription>
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("agents.list.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={saving || unchanged}>
            {saving
              ? t("agents.renameDialog.saving")
              : t("agents.renameDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
