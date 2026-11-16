import React from "react"
import { useTranslation } from "react-i18next"
import { PowerOff } from "lucide-react"

import { Alert, AlertAction, AlertDescription } from "@renderer/components/ui/alert"
import { Button } from "@renderer/components/ui/button"
import { showGlobalToast } from "@renderer/hooks/useToast"
import { useLocalConnectorStore } from "@renderer/store/local-connector"

/**
 * Says the local connector is off where this computer's agents are listed —
 * otherwise a list of stopped agents reads as a fault — with the way back on.
 */
export function LocalConnectorBanner(): React.JSX.Element | null {
  const { t } = useTranslation()
  const enabled = useLocalConnectorStore((s) => s.enabled)
  const busy = useLocalConnectorStore((s) => s.busy)
  if (enabled !== false) return null

  const turnOn = async (): Promise<void> => {
    const result = await useLocalConnectorStore.getState().setEnabled(true)
    showGlobalToast(
      result.success
        ? t("settings.localConnector.onToast")
        : t("settings.localConnector.failed", { message: result.message || "" }),
      result.success ? "success" : "error",
    )
  }

  return (
    <Alert role="status" className="mb-4">
      <PowerOff />
      <AlertDescription>{t("settings.localConnector.banner")}</AlertDescription>
      <AlertAction>
        <Button size="xs" disabled={busy} onClick={() => void turnOn()}>
          {t("settings.localConnector.bannerAction")}
        </Button>
      </AlertAction>
    </Alert>
  )
}
