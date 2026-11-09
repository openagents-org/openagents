import React, { useState } from "react"
import { useTranslation } from "react-i18next"

import { Switch } from "@renderer/components/ui/switch"
import { ConfirmDialog, StatusDot } from "@renderer/components/ui-kit"
import { showGlobalToast } from "@renderer/hooks/useToast"
import { useAgentsSummary } from "@renderer/store/agents"
import { useLocalConnectorStore } from "@renderer/store/local-connector"
import { SettingsCard, Row } from "./settings-card"

/**
 * Switches the local connector — the daemon that runs this computer's agents.
 * Not one of the plain settings: flipping it starts or stops the daemon, and
 * before any choice its value follows whether this computer has agents.
 */
export function LocalConnectorCard(): React.JSX.Element {
  const { t } = useTranslation()
  const enabled = useLocalConnectorStore((s) => s.enabled)
  const busy = useLocalConnectorStore((s) => s.busy)
  const summary = useAgentsSummary()
  const [confirmOff, setConfirmOff] = useState(false)

  const apply = async (next: boolean): Promise<void> => {
    const result = await useLocalConnectorStore.getState().setEnabled(next)
    if (!result.success)
      showGlobalToast(t("settings.localConnector.failed", { message: result.message || "" }), "error")
    else
      showGlobalToast(t(next ? "settings.localConnector.onToast" : "settings.localConnector.offToast"), "success")
  }

  // What the switch is doing right now, so flipping it shows its effect here.
  const status = enabled === false
    ? t("settings.localConnector.statusOff")
    : t("settings.localConnector.statusOn", {
        summary: t(`nav.agentsSummary.${summary.state}`, { count: summary.count }),
      })

  return (
    <>
      <SettingsCard title={t("settings.localConnector.title")}>
        <Row label={t("settings.localConnector.label")} desc={t("settings.localConnector.desc")}>
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
        {enabled !== null && (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground" role="status">
            <StatusDot state={enabled === false ? "stopped" : summary.state} />
            {status}
          </div>
        )}
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
