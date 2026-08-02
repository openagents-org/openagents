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
} from "../shadcn/dialog"
import { Button } from "../shadcn/button"
import { Spinner } from "../shadcn/spinner"
import { PlatformLogo } from "./PlatformLogo"
import { ConnectionStatusBadge } from "./ConnectionStatusBadge"
import { getPlatform } from "./platforms"
import type {
  ConnectionRecord,
  ConnectionStatus,
  ConnectionTestResult,
} from "../../types"

/**
 * Runs a probe against the saved credential and surfaces the structured
 * result inline (status badge + account + detail). stage.md §4.2 —
 * "Test Connection".
 */
export function ConnectionTestDialog({
  open,
  connection,
  onClose,
  onAfterRun,
}: {
  open: boolean
  connection: ConnectionRecord | null
  onClose: () => void
  onAfterRun?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
  const platform = connection ? getPlatform(connection.platform) : undefined

  useEffect(() => {
    if (open) setResult(null)
  }, [open, connection?.id])

  const runTest = async (): Promise<void> => {
    if (!connection) return
    setRunning(true)
    try {
      const r = await window.api.testConnection(connection.id)
      setResult(r)
    } catch (e) {
      setResult({ ok: false, status: "error", detail: (e as Error).message })
    } finally {
      setRunning(false)
      onAfterRun?.()
    }
  }

  // Auto-run on open for a smoother UX.
  useEffect(() => {
    if (open && connection && !result && !running) {
      void runTest()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection?.id])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:text-center">
          {platform && <PlatformLogo platform={platform} size={44} />}
          <DialogTitle>
            {t("connections.test.title", {
              platform: platform?.label || connection?.platform,
            })}
          </DialogTitle>
          <DialogDescription>{t("connections.test.subtitle")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="items-center">
          {running && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner />
              {t("connections.test.running")}
            </p>
          )}
          {result && (
            <>
              <ConnectionStatusBadge
                status={(result.status as ConnectionStatus) || "error"}
              />
              {result.account && (
                <p className="text-xs text-muted-foreground">
                  {t("connections.test.account")}
                  <strong className="text-foreground">{result.account}</strong>
                </p>
              )}
              {result.detail && (
                <p className="max-w-90 text-center text-2xs wrap-break-word text-muted-foreground">
                  {result.detail}
                </p>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={runTest} disabled={running}>
            {running ? t("connections.test.testing") : t("connections.test.runAgain")}
          </Button>
          <Button onClick={onClose}>{t("connections.test.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
