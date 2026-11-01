import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Switch } from "@renderer/components/ui/switch"
import { ConfirmDialog } from "@renderer/components/ui-kit"
import { showGlobalToast } from "@renderer/hooks/useToast"
import { SettingsCard, Row } from "./settings-card"

/**
 * Switches the local connector — the daemon that runs this computer's agents.
 * Not one of the plain settings: flipping it starts or stops the daemon, and
 * before any choice its value follows whether this computer has agents.
 */
export function LocalConnectorCard(): React.JSX.Element {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)

  useEffect(() => {
    let active = true
    window.api
      .getLocalConnector()
      .then((value) => {
        if (active) setEnabled(value)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const apply = async (next: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.setLocalConnector(next)
      setEnabled(result.enabled)
      if (!result.success)
        showGlobalToast(
          t("settings.localConnector.failed", { message: result.message || "" }),
          "error",
        )
    } catch (err) {
      showGlobalToast(
        t("settings.localConnector.failed", { message: String(err) }),
        "error",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsCard title={t("settings.localConnector.title")}>
        <Row
          label={t("settings.localConnector.label")}
          desc={t("settings.localConnector.desc")}
        >
          <Switch
            checked={!!enabled}
            disabled={enabled === null || busy}
            onCheckedChange={(next) => {
              // Off takes every local agent offline, so it asks first.
              if (next) void apply(true)
              else setConfirmOff(true)
            }}
          />
        </Row>
      </SettingsCard>

      <ConfirmDialog
        open={confirmOff}
        title={t("settings.localConnector.offDialog.title")}
        description={t("settings.localConnector.offDialog.description")}
        confirmLabel={t("settings.localConnector.offDialog.confirm")}
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => {
          setConfirmOff(false)
          void apply(false)
        }}
      />
    </>
  )
}
