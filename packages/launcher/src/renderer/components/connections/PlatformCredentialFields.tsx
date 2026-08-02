import React from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldLabel } from "../shadcn/field"
import { Input } from "../shadcn/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../shadcn/select"
import { Button } from "../shadcn/button"
import { PasswordInput } from "../ui-kit"
import type { PlatformDef } from "./platforms"
import type { ConnectDraft } from "./use-platform-connect"
import type { CredentialSummary } from "../../types"

interface Props {
  platform: PlatformDef
  credentials: CredentialSummary[]
  draft: ConnectDraft
  onChange: (patch: Partial<ConnectDraft>) => void
}

export function PlatformCredentialFields({
  platform,
  credentials,
  draft,
  onChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const creatingNew = draft.credentialId === "__new__"

  return (
    <>
      <Field>
        <FieldLabel>{t("connections.dialog.credential")}</FieldLabel>
        <Select
          value={draft.credentialId}
          onValueChange={(v) => onChange({ credentialId: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__new__">
              {t("connections.dialog.addNewCredential")}
            </SelectItem>
            {credentials.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label} ({c.kind})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {creatingNew && (
        <>
          <Field>
            <FieldLabel>{t("connections.dialog.credentialLabel")}</FieldLabel>
            <Input
              value={draft.newLabel}
              onChange={(e) => onChange({ newLabel: e.target.value })}
              placeholder={t("connections.dialog.defaultLabel", {
                platform: platform.label,
              })}
            />
          </Field>
          <Field>
            <FieldLabel>{t("connections.dialog.tokenOrApiKey")}</FieldLabel>
            <PasswordInput
              value={draft.newSecret}
              onChange={(e) => onChange({ newSecret: e.target.value })}
              placeholder={t("connections.dialog.pasteSecret", {
                platform: platform.label,
              })}
              autoComplete="off"
            />
            {platform.docs && (
              <Button
                variant="link"
                size="sm"
                className="h-auto self-start p-0 text-2xs"
                onClick={() => window.api.openExternal(platform.docs!)}
              >
                {t("connections.dialog.whereToGet")}
              </Button>
            )}
          </Field>
        </>
      )}

      <Field>
        <FieldLabel>{t("connections.dialog.accountHint")}</FieldLabel>
        <Input
          value={draft.accountHint}
          onChange={(e) => onChange({ accountHint: e.target.value })}
          placeholder={t("connections.dialog.accountHintPlaceholder")}
        />
      </Field>
    </>
  )
}
