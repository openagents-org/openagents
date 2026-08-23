import React from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldDescription, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import { formatCode } from "../../lib/pairing-code"

/**
 * The ways into a workspace, as forms. State and the actions that submit
 * them live in `WorkspaceQuickConnect`; these only render.
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

/** A workspace link or bare token. */
export function PastePanel({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Field>
      <FieldLabel htmlFor="quick-connect-paste">
        {t("workspaces.quickConnect.pasteLabel")}
      </FieldLabel>
      {/* One example, not two. The placeholder used to carry the hosted URL
          *and* a localhost one; at ~90 characters the field cut it off
          mid-token and neither example could be read in full. Both have the
          same shape, which is all a placeholder is for — that self-hosted URLs
          are accepted, and how they are parsed, is what the hint says. */}
      <Input
        id="quick-connect-paste"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("workspaces.quickConnect.pastePlaceholder")}
        autoFocus
      />
      <FieldDescription>
        {t("workspaces.quickConnect.pasteHint")}
      </FieldDescription>
    </Field>
  )
}
