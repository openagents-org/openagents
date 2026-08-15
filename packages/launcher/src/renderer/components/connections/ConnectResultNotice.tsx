import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "../../lib/utils"
import type { ConnectionTestResult } from "../../types"

/** Outcome of the save-and-test round trip, shown inline above the footer. */
export function ConnectResultNotice({
  result,
}: {
  result: ConnectionTestResult
}): React.JSX.Element {
  const { t } = useTranslation()

  const message = result.ok
    ? result.account
      ? t("connections.dialog.connectedAs", { account: result.account })
      : t("connections.dialog.connectedOk")
    : result.detail
      ? t("connections.dialog.resultError", {
          status: result.status,
          detail: result.detail,
        })
      : t("connections.dialog.resultStatus", { status: result.status })

  return (
    <p
      className={cn(
        "rounded-sm px-3 py-2 text-xs",
        result.ok
          ? "bg-(--success-bg) text-(--success-text)"
          : "bg-(--danger-bg) text-(--danger-text)",
      )}
    >
      {message}
    </p>
  )
}
