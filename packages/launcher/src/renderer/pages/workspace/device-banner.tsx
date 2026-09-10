import React from "react"
import { useTranslation } from "react-i18next"
import { Laptop, ShieldCheck } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import { useUiStore } from "@renderer/store/ui"
import { useAccountStore } from "@renderer/store/account"
import { accountError } from "@renderer/lib/account-errors"
import { capture } from "@renderer/lib/analytics"
import type { ToastType } from "@renderer/hooks/useToast"
import type { AccountWorkspace } from "@renderer/types"

/**
 * The seam between the two scopes, made visible.
 *
 * Being a member of a workspace does not authorize THIS MACHINE to run agents
 * in it — that is a separate, device-level grant (a pairing code). The most
 * common state after a first sign-in is member-but-unauthorized, and without
 * this strip the workspace simply would not list the machine, with nothing on
 * screen explaining why.
 *
 * Owners and admins can settle it in one click: the launcher mints a pairing
 * code as them and redeems it here. A member cannot mint one — correctly, the
 * grant is the workspace's to give — so they are pointed at an admin and at
 * the manual code entry.
 */
export function DeviceBanner({
  workspace,
  authorized,
  onAuthorized,
  showToast,
}: {
  workspace: AccountWorkspace
  authorized: boolean
  onAuthorized: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [busy, setBusy] = React.useState(false)
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const requestCreate = useUiStore((s) => s.requestCreate)
  const exitWorkspace = useAccountStore((s) => s.exitWorkspace)

  if (authorized) return null

  const canAuthorize = workspace.role === "owner" || workspace.role === "admin"

  const authorize = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.authorizeDevice(workspace.workspaceId)
      capture("node_connected", { source: "one_click", role: workspace.role })
      showToast(
        t("account.device.authorizedToast", { name: workspace.name }),
        "success",
      )
      onAuthorized()
    } catch (err) {
      showToast(accountError(err, t), "error")
    } finally {
      setBusy(false)
    }
  }

  const enterCodeManually = (): void => {
    // Pairing a code is the machine's business, and the machine lives on the
    // other side of the mode bar — so this crosses over rather than opening a
    // launcher dialog on top of the workspace, which since the two halves
    // became peers would leave the user somewhere neither tab describes.
    exitWorkspace()
    setCurrentTab("workspaces")
    requestCreate("workspace")
  }

  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs">
      <Laptop className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-muted-foreground">
        {canAuthorize
          ? t("account.device.notAuthorized")
          : t("account.device.adminOnly", {
              section: t("nav.items.workspaces.label"),
            })}
      </p>
      {canAuthorize ? (
        <Button size="sm" onClick={() => void authorize()} disabled={busy}>
          {busy ? (
            <Spinner className="size-3.5" />
          ) : (
            <ShieldCheck className="size-3.5" />
          )}
          {busy
            ? t("account.device.authorizing")
            : t("account.device.authorize")}
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={enterCodeManually}>
          {t("account.device.manualEntry")}
        </Button>
      )}
    </div>
  )
}
