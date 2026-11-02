import React from "react"
import { useTranslation } from "react-i18next"
import { FolderOpen } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"

/**
 * The new agent's working folder, beside the model field in the setup form.
 *
 * Built from the same Field parts as the env fields (AgentEnvFields) rather
 * than taken as drawn by the shared form: that one's label, input height and
 * hint size were the workspace app's, and side by side with the model the two
 * columns sat at different heights.
 */
export function SetupWorkdirField({ value, onChange }: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const browse = (): void => {
    void window.api.selectDirectory(value || undefined).then((path) => { if (path) onChange(path) }).catch(() => {})
  }
  return (
    <Field>
      <FieldLabel htmlFor="agent-setup-workdir" className="text-xs">
        {t("agents.shared.workdirOptional")}
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Input id="agent-setup-workdir" data-testid="agent-setup-workdir" className="min-w-0 flex-1"
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("agents.shared.homeFolder")} />
        <Button variant="outline" className="shrink-0" onClick={browse}>
          <FolderOpen />
          {t("agents.configureDialog.workdir.browse")}
        </Button>
      </div>
      <FieldDescription className="text-2xs">{t("agents.shared.folderHint")}</FieldDescription>
    </Field>
  )
}
