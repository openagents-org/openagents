import React, { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { PlatformLogo } from "./PlatformLogo"
import { OAuthConnectButton } from "./OAuthConnectButton"
import { PlatformCredentialFields } from "./PlatformCredentialFields"
import { ConnectResultNotice } from "./ConnectResultNotice"
import { usePlatformConnect, type ConnectDraft } from "./use-platform-connect"
import type { PlatformDef } from "./platforms"
import type { ConnectionRecord, CredentialSummary } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface Props {
  open: boolean
  onClose: () => void
  platform: PlatformDef
  existing: ConnectionRecord | null
  credentials: CredentialSummary[]
  onSaved: () => Promise<void> | void
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * Two-step flow:
 *  1. Pick (or paste) a credential for this platform.
 *  2. Save + automatically test. On success, the connection card flips to
 *     "Connected".
 *
 * Mirrors stage.md §4.2 — "Connect / Disconnect / Reconnect / Test / Configure".
 */
export function PlatformConnectDialog({
  open,
  onClose,
  platform,
  existing,
  credentials,
  onSaved,
  showToast,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const matchingCreds = useMemo(
    () => credentials.filter((c) => c.provider === platform.id),
    [credentials, platform.id],
  )

  const [draft, setDraft] = useState<ConnectDraft>({
    credentialId: existing?.credentialId || matchingCreds[0]?.id || "__new__",
    newSecret: "",
    newLabel: t("connections.dialog.defaultLabel", { platform: platform.label }),
    accountHint: existing?.account || "",
  })

  const connect = usePlatformConnect({ platform, existing, onSaved, showToast })

  useEffect(() => {
    if (!open) return
    setDraft({
      credentialId: existing?.credentialId || matchingCreds[0]?.id || "__new__",
      newSecret: "",
      newLabel: t("connections.dialog.defaultLabel", { platform: platform.label }),
      accountHint: existing?.account || "",
    })
    connect.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing, matchingCreds, platform.label])

  const scopes = platform.suggestedScopes

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="flex-row items-center gap-3 space-y-0">
          <PlatformLogo platform={platform} size={44} />
          <div className="min-w-0">
            <DialogTitle>
              {existing
                ? t("connections.dialog.reconnectTitle", { platform: platform.label })
                : t("connections.dialog.connectTitle", { platform: platform.label })}
            </DialogTitle>
            <DialogDescription>{platform.blurb}</DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody>
          <PlatformCredentialFields
            platform={platform}
            credentials={matchingCreds}
            draft={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          />

          {scopes && scopes.length > 0 && (
            <p className="text-2xs text-muted-foreground">
              {t("connections.dialog.suggestedScopes")}
              {scopes.map((s) => (
                <code
                  key={s}
                  className="ml-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-3xs"
                >
                  {s}
                </code>
              ))}
            </p>
          )}

          {connect.result && <ConnectResultNotice result={connect.result} />}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={connect.working}>
            {t("connections.dialog.cancel")}
          </Button>
          <OAuthConnectButton platform={platform} />
          <Button onClick={() => connect.submit(draft)} disabled={connect.working}>
            {connect.working
              ? t("connections.dialog.connecting")
              : existing
                ? t("connections.dialog.saveAndTest")
                : t("connections.dialog.connect")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
