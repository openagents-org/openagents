import React from "react"
import { Unplug } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert"
import { Button } from "../ui/button"
import type { RevokedPairing } from "../../types"

/**
 * One workspace removed this device, so the launcher removed the workspace:
 * the pairing, the local entry and the agent bindings all go together — a
 * workspace this machine is not in cannot be opened, cannot run anything, and
 * has no honest state to draw as a card.
 *
 * What is left is telling the user. Without this the workspace would simply be
 * gone one launch, along with whatever its agents were filed under, and the
 * only visible trace would be agents that had quietly become workspace-less.
 */
export function WorkspaceRevokedNotice({
  notices,
  onRejoin,
  onDismiss,
}: {
  notices: RevokedPairing[]
  onRejoin: () => void
  onDismiss: (workspaceId: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (notices.length === 0) return null

  return (
    <div className="mb-4 flex flex-col gap-2">
      {notices.map((n) => {
        const count = n.agents?.length || 0
        return (
          <Alert
            key={n.workspaceId}
            className="has-data-[slot=alert-action]:pr-44"
          >
            <Unplug className="text-warning" />
            <AlertTitle>
              {t("workspaces.revokedNotice.title", {
                name: n.workspaceName || n.workspaceSlug || n.workspaceId,
              })}
            </AlertTitle>
            <AlertDescription>
              {count > 0
                ? t("workspaces.revokedNotice.bodyAgents", { count })
                : t("workspaces.revokedNotice.body")}
            </AlertDescription>
            <AlertAction className="flex items-center gap-2">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onDismiss(n.workspaceId)}
              >
                {t("workspaces.revokedNotice.dismiss")}
              </Button>
              <Button size="xs" onClick={onRejoin}>
                {t("workspaces.revokedNotice.rejoin")}
              </Button>
            </AlertAction>
          </Alert>
        )
      })}
    </div>
  )
}
