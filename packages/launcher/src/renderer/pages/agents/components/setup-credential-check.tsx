import React from "react"
import { useTranslation } from "react-i18next"
import { AlertCircle, CheckCircle2, Info, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@renderer/components/ui/alert"
import { Button } from "@renderer/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@renderer/components/ui/field"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@renderer/components/ui/item"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Spinner } from "@renderer/components/ui/spinner"
import { cn } from "@renderer/lib/utils"

export type CredentialTestResult = { kind: "success" | "error" | "info"; message: string }

/** A custom Codex key endpoint chooses between its Responses CLI provider and direct chat. */
export function CodexWireApiField({ value, onChange }: {
  value: "responses" | "chat"
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return <Field>
    <FieldLabel htmlFor="local-codex-wire-api">{t("agents.codexApiMode.label")}</FieldLabel>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id="local-codex-wire-api" aria-label={t("agents.codexApiMode.label")} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="responses">{t("agents.codexApiMode.responses")}</SelectItem>
          <SelectItem value="chat">{t("agents.codexApiMode.chat")}</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <FieldDescription>{t(value === "responses" ? "agents.codexApiMode.responsesHint" : "agents.codexApiMode.chatHint")}</FieldDescription>
  </Field>
}

/**
 * The key form's "Verify API settings" row. A test that can only fail is
 * replaced by how this agent's credential IS verified.
 */
export function CredentialCheck({ unprobeable, unprobeableReason, testing, result, onTest }: {
  unprobeable: boolean
  unprobeableReason?: string | null
  testing: boolean
  result: CredentialTestResult | null
  onTest: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  if (unprobeable) return <Alert role="note">
    <Info />
    <AlertTitle>{t("agents.credentials.unprobeableTitle")}</AlertTitle>
    {unprobeableReason && <AlertDescription>{t(`agents.credentials.unprobeable.${unprobeableReason}`)}</AlertDescription>}
  </Alert>
  return <Item variant="outline" size="sm">
    <ItemMedia variant="icon" className={cn(result?.kind === "success" && "text-success", result?.kind === "error" && "text-destructive", !result && "text-muted-foreground")}>
      {result?.kind === "success" ? <CheckCircle2 /> : result?.kind === "error" ? <AlertCircle /> : <ShieldCheck />}
    </ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle>{t("agents.shared.verifyApiSettings")}</ItemTitle>
      <ItemDescription role={result ? "status" : undefined}
        className={cn("text-xs", result?.kind === "success" && "text-foreground", result?.kind === "error" && "text-destructive")}>
        {result?.message || t("agents.shared.verifyApiSettingsHint")}
      </ItemDescription>
    </ItemContent>
    <ItemActions>
      <Button size="sm" variant="outline" onClick={onTest} disabled={testing}>
        {testing && <Spinner data-icon="inline-start" />}
        {testing ? t("agents.shared.testing") : t("agents.shared.testConnection")}
      </Button>
    </ItemActions>
  </Item>
}
