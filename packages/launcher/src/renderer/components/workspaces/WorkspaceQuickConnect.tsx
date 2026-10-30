import React, { useEffect } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { PairPanel, PairingCodeHowTo } from "./quick-connect-panels"
import { usePairDevice } from "./use-pair-device"
import type { ToastType } from "../../hooks/useToast"

/**
 * The dialog behind "Add workspace" — one form, one way in: redeem a pairing
 * code and this device joins the workspace as a node, after which agents can be
 * installed on it from there.
 *
 * Everything else is gone. Workspaces are created on the web after signing in
 * (the form says where), and the manual paths that predated pairing — a
 * workspace link, a bare invitation token, a "sign in with the browser" tab —
 * are retired: they registered a workspace this device was never paired with,
 * which is a state the daemon can no longer get credentials for.
 */
export function WorkspaceQuickConnect({
  open,
  onClose,
  onCreated,
  showToast,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const pairing = usePairDevice("quick_connect", showToast)
  const { reset } = pairing

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const handlePair = async (): Promise<void> => {
    if (!(await pairing.pair())) return
    onCreated()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* The title says everything the field needs, so no description. */}
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("workspaces.quickConnect.title")}</DialogTitle>
        </DialogHeader>

        <DialogBody className="gap-5">
          <PairPanel
            code={pairing.code}
            onChange={pairing.setCode}
            onSubmit={() => void handlePair()}
            error={pairing.error}
          />
          {/* Workspace creation lives on the web (after signing in) — the
              launcher only joins existing ones. */}
          <PairingCodeHowTo />
        </DialogBody>

        <DialogFooter>
          {/* "Cancel", not "Close": the form is waiting to be submitted, so the
              button backs out of an action rather than dismissing a notice. */}
          <Button variant="outline" onClick={onClose} disabled={pairing.busy}>
            {t("workspaces.quickConnect.cancel")}
          </Button>
          <Button
            data-testid="ws-pair-submit"
            onClick={() => void handlePair()}
            disabled={pairing.busy || !pairing.ready}
          >
            {pairing.busy
              ? t("workspaces.quickConnect.connecting")
              : t("workspaces.quickConnect.pairBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
