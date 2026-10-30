import React from "react"
import { QRCodeSVG } from "qrcode.react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { useToasts } from "@renderer/hooks/useToast"
import { workspaceUrl } from "../../lib/workspace-urls"
import type { Workspace } from "../../types"

interface Props {
  ws: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * One workspace's join link as a QR code — the same `/{slug}?token=` URL the
 * card's "copy URL" hands out, so scanning it on a phone opens that workspace
 * already authorised.
 */
export function WorkspaceQrcodeDialog({
  ws,
  open,
  onOpenChange,
}: Props): React.JSX.Element {
  const { showToast } = useToasts()
  const { t } = useTranslation()

  // Without a token the URL is a bare `/slug` that lands the scanner on a login
  // wall — not worth showing as if it were a working invite.
  const url = ws.token ? workspaceUrl(ws) : ""

  const handleCopy = async (): Promise<void> => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      showToast(t("workspaces.qrcode.copied"), "success")
    } catch {
      showToast(t("workspaces.qrcode.copyFailed"), "error")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("workspaces.qrcode.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("workspaces.qrcode.dialogDescription", {
              name: ws.name || ws.slug || ws.id,
            })}
          </DialogDescription>
        </DialogHeader>

        {/* DialogBody carries the project's standard dialog padding — a bare
            div here leaves the code flush against the header's divider. */}
        <DialogBody className="items-center gap-4 py-6">
          {url ? (
            <>
              {/* The code keeps a white quiet zone in both themes — inverting it
                  for dark mode is what breaks scanners. */}
              <button
                type="button"
                onClick={() => void handleCopy()}
                title={t("workspaces.qrcode.clickToCopy")}
                className="rounded-lg bg-white p-4 ring-1 ring-border transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {/* `marginSize` is the spec's 4-module quiet zone, in modules —
                    dropping it leaves scanners with nothing to lock onto once
                    the dialog behind it is dark. */}
                <QRCodeSVG value={url} size={200} level="M" marginSize={4} />
              </button>
              <p className="text-xs text-muted-foreground">
                {t("workspaces.qrcode.clickToCopy")}
              </p>
            </>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              {t("workspaces.qrcode.unavailable")}
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
