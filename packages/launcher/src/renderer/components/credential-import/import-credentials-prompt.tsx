import React, { useState } from "react"
import { Import } from "lucide-react"
import { useTranslation } from "react-i18next"

import { canImportCredentials } from "../../../shared/credential-import-targets"
import { Button } from "@renderer/components/ui/button"
import { showGlobalToast } from "@renderer/hooks/useToast"
import { cn } from "@renderer/lib/utils"

import { ImportCredentialsDialog } from "./import-credentials-dialog"

interface Props {
  agentType: string
  /** The form's own fields: an import never writes a value the form doesn't show. */
  fieldNames: string[]
  onImport: (values: Record<string, string>) => void
  className?: string
}

/**
 * The way into an import, above an agent's key form. Renders nothing for an
 * agent whose credential only its own vendor can issue.
 */
export function ImportCredentialsPrompt({
  agentType,
  fieldNames,
  onImport,
  className,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!canImportCredentials(agentType)) return null

  const apply = (values: Record<string, string>): void => {
    const shown = new Set(fieldNames)
    onImport(
      Object.fromEntries(
        Object.entries(values).filter(([name]) => shown.has(name)),
      ),
    )
    showGlobalToast(t("credentialImport.filled"), "success")
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-dashed px-3.5 py-2.5",
        className,
      )}
    >
      <p className="m-0 text-2xs leading-relaxed text-muted-foreground">
        {t("credentialImport.prompt")}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        <Import />
        {t("credentialImport.trigger")}
      </Button>
      <ImportCredentialsDialog
        open={open}
        agentType={agentType}
        onOpenChange={setOpen}
        onImport={apply}
      />
    </div>
  )
}
