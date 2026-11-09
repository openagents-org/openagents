import React from "react"
import { useTranslation } from "react-i18next"

import { ConfirmDialog } from "@renderer/components/ui-kit"
import { showGlobalToast } from "@renderer/hooks/useToast"
import { useLocalConnectorStore } from "@renderer/store/local-connector"

/**
 * Answers `ensureOn()`: an agent was started while the local connector is
 * off. Mounted once; turning the connector on here starts every agent on this
 * computer, which is why it asks instead of doing it silently.
 */
export function LocalConnectorPrompt(): React.JSX.Element {
  const { t } = useTranslation()
  const prompt = useLocalConnectorStore((s) => s.prompt)
  const busy = useLocalConnectorStore((s) => s.busy)

  const confirm = async (): Promise<void> => {
    const result = await useLocalConnectorStore.getState().setEnabled(true)
    if (!result.success)
      showGlobalToast(t("settings.localConnector.failed", { message: result.message || "" }), "error")
    prompt?.(result.success)
  }

  return (
    <ConfirmDialog
      open={!!prompt}
      title={t("settings.localConnector.onDialog.title")}
      description={t("settings.localConnector.onDialog.description")}
      confirmLabel={t("settings.localConnector.onDialog.confirm")}
      destructive={false}
      busy={busy}
      onCancel={() => prompt?.(false)}
      onConfirm={() => void confirm()}
    />
  )
}
