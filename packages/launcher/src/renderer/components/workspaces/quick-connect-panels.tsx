import React from "react"
import { AlertCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Field, FieldDescription, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import { formatCode } from "../../lib/pairing-code"

/**
 * The three ways into a workspace, as forms. State and the actions that submit
 * them live in `WorkspaceQuickConnect`; these only render.
 */

/** Redeem a pairing code — this device joins the workspace as a node. */
export function PairPanel({
  code,
  onChange,
  onSubmit,
  error,
  pairedWith,
}: {
  code: string
  onChange: (v: string) => void
  onSubmit: () => void
  error: string | null
  /** Workspace this device is paired to today — redeeming moves it away. */
  pairedWith: string | null
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
      {pairedWith && (
        <p className="m-0 flex items-start gap-2 rounded-md border border-(--warning-border) bg-(--warning-bg) px-3 py-2 text-2xs text-(--warning-text)">
          <AlertCircle className="mt-px size-3 shrink-0" />
          {t("workspaces.quickConnect.pairReplaces", { name: pairedWith })}
        </p>
      )}
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

/** Name a new workspace; the credentials it returns are shown once, here. */
export function CreatePanel({
  name,
  onChange,
  result,
}: {
  name: string
  onChange: (v: string) => void
  result: { slug?: string; token?: string } | null
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <Field>
        <FieldLabel htmlFor="quick-connect-name">
          {t("workspaces.quickConnect.createLabel")}
        </FieldLabel>
        <Input
          id="quick-connect-name"
          value={name}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("workspaces.quickConnect.createPlaceholder")}
          autoFocus
        />
      </Field>
      {result?.token && (
        <div className="rounded-sm bg-(--success-bg) px-3 py-2 text-xs break-all text-(--success-text)">
          <div className="mb-1 font-semibold">
            {t("workspaces.quickConnect.ready")}
          </div>
          <div className="text-2xs">
            {t("workspaces.quickConnect.readySlug", { slug: result.slug })}
          </div>
          <div className="text-2xs">
            {t("workspaces.quickConnect.readyToken", { token: result.token })}
          </div>
        </div>
      )}
    </>
  )
}
