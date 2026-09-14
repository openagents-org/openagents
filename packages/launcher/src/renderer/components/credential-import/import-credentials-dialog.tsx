import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { Spinner } from "@renderer/components/ui/spinner"

import { CandidateList } from "./candidate-list"
import { PasteConfig } from "./paste-config"
import { useCredentialImport } from "./use-credential-import"

interface Props {
  open: boolean
  agentType: string
  onOpenChange: (open: boolean) => void
  /** The picked credential, as this agent's form values. */
  onImport: (values: Record<string, string>) => void
}

/**
 * Pick a key this computer already has, or paste the configuration a relay
 * handed out. Picking only fills the form in: the user still tests and saves,
 * the same as a key they typed.
 */
export function ImportCredentialsDialog({
  open,
  agentType,
  onOpenChange,
  onImport,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const imp = useCredentialImport(agentType, open)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [lost, setLost] = useState(false)

  useEffect(() => {
    if (!open) return
    setPasteOpen(false)
    setLost(false)
  }, [open])

  // Nothing to pick from: pasting is the only way forward, so open it.
  const nothingFound = imp.scanned && imp.candidates.length === 0
  useEffect(() => {
    if (nothingFound) setPasteOpen(true)
  }, [nothingFound])

  const apply = async (): Promise<void> => {
    setApplying(true)
    const values = await imp.resolve()
    setApplying(false)
    if (!values) {
      setLost(true)
      return
    }
    onImport(values)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("credentialImport.title")}</DialogTitle>
          <DialogDescription>
            {t("credentialImport.description")}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {imp.scanning && (
            <p className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner />
              {t("credentialImport.scanning")}
            </p>
          )}
          {imp.candidates.length > 0 && (
            <CandidateList
              candidates={imp.candidates}
              selected={imp.selected}
              onSelect={imp.select}
            />
          )}
          {nothingFound && (
            <p className="m-0 rounded-lg border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
              {t("credentialImport.empty")}
            </p>
          )}
          {lost && (
            <p className="m-0 text-xs text-(--danger-text)">
              {t("credentialImport.lost")}
            </p>
          )}

          <PasteConfig
            open={pasteOpen}
            onOpenChange={setPasteOpen}
            onRecognize={imp.parse}
          />
        </DialogBody>

        <DialogFooter>
          <Button
            disabled={!imp.selected || applying}
            onClick={() => void apply()}
          >
            {applying
              ? t("credentialImport.applying")
              : t("credentialImport.apply")}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
