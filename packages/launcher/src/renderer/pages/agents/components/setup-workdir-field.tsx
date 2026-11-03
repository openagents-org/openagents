import React, { useLayoutEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { FolderOpen } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@renderer/components/ui/tooltip"

/**
 * The new agent's working folder, beside the model field in the setup form.
 *
 * Built from the same Field parts as the env fields (AgentEnvFields) rather
 * than taken as drawn by the shared form: that one's label, input height and
 * hint size were the workspace app's, and side by side with the model the two
 * columns sat at different heights.
 *
 * Half a row is narrow for a path, so Browse is an icon (its name in the
 * tooltip) rather than a labelled button that took a third of the width in
 * English, and the box shows the END of the path while it is not being
 * edited: the folder's own name, not "/Users/…" that every path starts with.
 */
export function SetupWorkdirField({ value, onChange }: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const el = input.current
    if (el && document.activeElement !== el) el.scrollLeft = el.scrollWidth
  }, [value])
  const label = t("agents.configureDialog.workdir.browse")
  const browse = (): void => {
    void window.api.selectDirectory(value || undefined).then((path) => { if (path) onChange(path) }).catch(() => {})
  }
  return (
    <Field>
      <FieldLabel htmlFor="agent-setup-workdir" className="text-xs">
        {t("agents.shared.workdirOptional")}
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Input ref={input} id="agent-setup-workdir" data-testid="agent-setup-workdir" className="min-w-0 flex-1" title={value || undefined}
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("agents.shared.homeFolder")}
          onBlur={(e) => { e.currentTarget.scrollLeft = e.currentTarget.scrollWidth }} />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0" onClick={browse} aria-label={label}>
                <FolderOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <FieldDescription className="text-2xs">{t("agents.shared.folderHint")}</FieldDescription>
    </Field>
  )
}
