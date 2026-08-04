import React from "react"
import { useTranslation } from "react-i18next"
import { FolderOpen } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"

interface Props {
  value: string
  initial: string
  saving: boolean
  onChange: (v: string) => void
  onBrowse: () => void
  onSave: () => void
}

/** Working directory (spawn cwd) for one agent instance — its own save action. */
export function ConfigureWorkDir({
  value,
  initial,
  saving,
  onChange,
  onBrowse,
  onSave,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Field>
      <FieldLabel htmlFor="agent-config-workdir">
        {t("agents.configureDialog.workdir.label")}
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id="agent-config-workdir"
          className="flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("agents.configureDialog.workdir.placeholder")}
        />
        <Button variant="outline" onClick={onBrowse}>
          <FolderOpen />
          {t("agents.configureDialog.workdir.browse")}
        </Button>
        <Button
          disabled={saving || !value.trim() || value.trim() === initial}
          onClick={onSave}
        >
          {saving
            ? t("agents.configureDialog.workdir.saving")
            : t("agents.configureDialog.workdir.save")}
        </Button>
      </div>
      <FieldDescription>
        {t("agents.configureDialog.workdir.hint")}
      </FieldDescription>
    </Field>
  )
}
