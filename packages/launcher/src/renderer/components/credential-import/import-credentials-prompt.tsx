import React, { useState } from "react"
import { Import } from "lucide-react"
import { useTranslation } from "react-i18next"

import { canImportCredentials } from "../../../shared/credential-import-targets"
import { Button } from "@renderer/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription } from "@renderer/components/ui/item"
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
    <Item variant="outline" size="sm" className={cn("border-dashed", className)}>
      <ItemContent>
        <ItemDescription className="text-xs">{t("credentialImport.prompt")}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Import data-icon="inline-start" />
          {t("credentialImport.trigger")}
        </Button>
      </ItemActions>
      <ImportCredentialsDialog
        open={open}
        agentType={agentType}
        onOpenChange={setOpen}
        onImport={apply}
      />
    </Item>
  )
}
