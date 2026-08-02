import React from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { Switch } from "../ui/switch"
import { PasswordInput } from "../ui-kit"
import { ScopeEditor } from "./ScopeEditor"
import { PLATFORMS } from "../connections/platforms"
import type { CredentialKind } from "../../types"
import type { CredentialDraft } from "./CredentialEditor"

const KIND_OPTIONS: Array<{ value: CredentialKind; labelKey: string }> = [
  { value: "api_key", labelKey: "credentials.editor.kinds.apiKey" },
  { value: "token", labelKey: "credentials.editor.kinds.token" },
  { value: "oauth", labelKey: "credentials.editor.kinds.oauth" },
  { value: "webhook_secret", labelKey: "credentials.editor.kinds.webhookSecret" },
  { value: "password", labelKey: "credentials.editor.kinds.password" },
]

interface Props {
  draft: CredentialDraft
  onPatch: (patch: Partial<CredentialDraft>) => void
  onProviderChange: (provider: string) => void
  /** Locks the provider dropdown (used by ConnectionsHub, and when editing). */
  providerLocked: boolean
}

export function CredentialFormFields({
  draft,
  onPatch,
  onProviderChange,
  providerLocked,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>{t("credentials.editor.providerLabel")}</FieldLabel>
          <Select
            value={draft.provider}
            onValueChange={onProviderChange}
            disabled={providerLocked}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{t("credentials.editor.kindLabel")}</FieldLabel>
          <Select
            value={draft.kind}
            onValueChange={(v) => onPatch({ kind: v as CredentialKind })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {t(k.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="credential-label">
          {t("credentials.editor.labelLabel")}
        </FieldLabel>
        <Input
          id="credential-label"
          value={draft.label}
          placeholder={t("credentials.editor.labelPlaceholder")}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
      </Field>

      <Field>
        <FieldLabel>
          {t("credentials.editor.secretLabel")}
          {draft.id && (
            <span className="font-normal text-muted-foreground">
              {t("credentials.editor.secretKeepHint")}
            </span>
          )}
        </FieldLabel>
        <PasswordInput
          value={draft.secret || ""}
          placeholder={
            draft.id
              ? t("credentials.editor.secretPlaceholderExisting")
              : t("credentials.editor.secretPlaceholderNew")
          }
          onChange={(e) => onPatch({ secret: e.target.value })}
          autoComplete="off"
        />
      </Field>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">
            {t("credentials.editor.shareTitle")}
          </span>
          <span className="block text-2xs text-muted-foreground">
            {t("credentials.editor.shareDescription")}
          </span>
        </div>
        <Switch
          checked={draft.shared}
          onCheckedChange={(v) => onPatch({ shared: v })}
        />
      </div>

      <ScopeEditor value={draft.scopes} onChange={(scopes) => onPatch({ scopes })} />
    </>
  )
}
