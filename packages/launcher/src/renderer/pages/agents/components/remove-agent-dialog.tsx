import React from "react"
import { Trans, useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import { ConfirmDialog } from "@renderer/components/ui-kit"
import type { Agent } from "@renderer/types"

/** Confirms removing an agent from this computer, and from its workspace. */
export function RemoveAgentDialog({
  agent,
  name,
  onConfirm,
  onCancel,
}: {
  /** The agent being removed, when it is still in the list. */
  agent: Agent | undefined
  name: string | null
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <ConfirmDialog
      open={!!name}
      icon={<AgentIcon type={agent?.type || ""} size={40} />}
      title={t("agents.list.removeTitle", { name })}
      description={
        <Trans
          i18nKey="agents.list.removeBody"
          values={{ name }}
          components={{ 1: <strong className="text-foreground" /> }}
        />
      }
      confirmLabel={t("agents.list.remove")}
      cancelLabel={t("agents.list.cancel")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {/* Stated, not asked. Leaving the membership behind was never a useful
          choice: once the agent is gone from here there is no way back to it,
          so the workspace would keep a member nobody can reach or clean up.
          `fromWorkspace` is a no-op for an agent that never joined one. */}
      {agent?.network && (
        <p className="m-0 rounded-lg border bg-muted/40 px-3 py-2.5 text-left text-xs leading-relaxed">
          {t("agents.list.alsoRemovedFromWorkspace", {
            workspace: agent.networkName || t("agents.list.theWorkspace"),
          })}
        </p>
      )}
    </ConfirmDialog>
  )
}
