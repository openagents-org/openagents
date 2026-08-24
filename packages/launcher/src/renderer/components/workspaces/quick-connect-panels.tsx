import React from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldDescription, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import { formatCode } from "../../lib/pairing-code"

/**
 * The way into a workspace, as a form. State and the action that submits it
 * live in `WorkspaceQuickConnect`; this only renders.
 */

/** Redeem a pairing code — this device joins the workspace as a node. */
export function PairPanel({
  code,
  onChange,
  onSubmit,
  error,
}: {
  code: string
  onChange: (v: string) => void
  onSubmit: () => void
  error: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Field>
      <FieldLabel htmlFor="quick-connect-code">
        {t("workspaces.quickConnect.pairLabel")}
      </FieldLabel>
      <Input
        id="quick-connect-code"
        value={code}
        onChange={(e) => onChange(formatCode(e.target.value))}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder={t("workspaces.quickConnect.pairPlaceholder")}
        className="text-center font-mono tracking-widest uppercase"
        autoFocus
      />
      <FieldDescription>
        {error ? (
          <span className="text-(--danger-text)">{error}</span>
        ) : (
          t("workspaces.quickConnect.pairHint")
        )}
      </FieldDescription>
    </Field>
  )
}
