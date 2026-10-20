import React from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink, Laptop } from "lucide-react"

import { DialogBody, DialogFooter } from "@renderer/components/ui/dialog"
import { Button } from "@renderer/components/ui/button"
import {
  PairPanel,
  PairingCodeHowTo,
  openWorkspaceSite,
} from "@renderer/components/workspaces/quick-connect-panels"
import { usePairDevice, type PairedWorkspace } from "@renderer/components/workspaces/use-pair-device"
import type { ToastType } from "@renderer/hooks/useToast"

/**
 * The add-to-workspace dialog when this device is in no workspace yet. Getting
 * a code and redeeming one are two separate actions on the same panel: the
 * first opens the web app (sign in, create a workspace, copy its code), the
 * second joins with the pasted code — without a second dialog in between.
 */
export function ConnectWorkspacePair({
  onPaired,
  onCancel,
  showToast,
}: {
  onPaired: (workspace: PairedWorkspace) => void
  onCancel: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const pairing = usePairDevice("connect_agent_dialog", showToast)

  const submit = async (): Promise<void> => {
    const joined = await pairing.pair()
    if (joined) onPaired(joined)
  }

  return (
    <>
      <DialogBody
        className="items-center gap-4 py-8 text-center"
        data-testid="ws-none-paired"
      >
        <Laptop className="size-6 text-muted-foreground" />
        <p className="m-0 text-sm font-medium">
          {t("agents.connectDialog.emptyTitle")}
        </p>
        <Button onClick={openWorkspaceSite} data-testid="ws-get-code">
          <ExternalLink />
          {t("agents.connectDialog.getCode")}
        </Button>
        <div className="mt-2 flex w-full items-start gap-2">
          <PairPanel
            className="flex-1"
            code={pairing.code}
            onChange={pairing.setCode}
            onSubmit={() => void submit()}
            error={pairing.error}
            autoFocus={false}
          />
          <Button
            className="h-14 px-6"
            data-testid="ws-pair-submit"
            onClick={() => void submit()}
            disabled={pairing.busy || !pairing.ready}
          >
            {pairing.busy
              ? t("workspaces.quickConnect.connecting")
              : t("workspaces.quickConnect.pairBtn")}
          </Button>
        </div>
        <PairingCodeHowTo className="self-stretch text-left" />
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pairing.busy}>
          {t("agents.connectDialog.cancel")}
        </Button>
      </DialogFooter>
    </>
  )
}
