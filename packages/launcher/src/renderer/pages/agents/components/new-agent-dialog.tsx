import React, { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/shadcn/dialog"
import { Button } from "@renderer/components/shadcn/button"
import { Field, FieldLabel } from "@renderer/components/shadcn/field"
import { Input } from "@renderer/components/shadcn/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/shadcn/select"
import { useUiStore } from "@renderer/store/ui"
import { randomAgentName } from "@renderer/utils/randomName"
import type { CatalogEntry } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

export function NewAgentDialog({
  open,
  onClose,
  showToast,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
  onCreated: (name: string, type: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [supportedTypes, setSupportedTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState("")
  const [agentName, setAgentName] = useState("")
  const [agentPath, setAgentPath] = useState("")
  // Once the user browses/edits the folder, stop auto-syncing it to the name.
  const [folderTouched, setFolderTouched] = useState(false)
  const [homeDir, setHomeDir] = useState("")
  const [loading, setLoading] = useState(false)
  const setCurrentTab = useUiStore.getState().setCurrentTab

  // Default the working folder to the user's home directory — a sensible,
  // easy-to-find root the user can then narrow to a specific project.
  const defaultFolderFor = useCallback((): string => homeDir, [homeDir])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    window.api
      .listPaths()
      .then((p) => setHomeDir(p?.home || ""))
      .catch(() => {})
    Promise.all([window.api.getCatalog(), window.api.getSupportedAgentTypes()])
      .then(([cat, types]) => {
        setCatalog(cat)
        setSupportedTypes(types || [])
        const supportedSet = new Set(types || [])
        const installed = cat.filter((c) => c.installed && supportedSet.has(c.name))
        if (installed.length > 0) setSelectedType(installed[0].name)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [open])

  // Seed a friendly random name once when the dialog opens. We deliberately
  // do NOT regenerate on every type change — that would clobber a name the
  // user has already edited. The name is independent of the agent type.
  useEffect(() => {
    if (open) setAgentName(randomAgentName())
  }, [open])

  // Prefill the folder with the default until the user picks/edits their own.
  useEffect(() => {
    if (folderTouched) return
    const def = defaultFolderFor()
    if (def && def !== agentPath) setAgentPath(def)
  }, [folderTouched, defaultFolderFor, agentPath])

  const browseFolder = async (): Promise<void> => {
    try {
      const picked = await window.api.selectDirectory(agentPath || homeDir || undefined)
      if (picked) {
        setFolderTouched(true)
        setAgentPath(picked)
      }
    } catch (err: unknown) {
      showToast((err as Error).message, "error")
    }
  }

  const supportedSet = new Set(supportedTypes)
  const supportedInstalled = catalog.filter(
    (c) => c.installed && supportedSet.has(c.name),
  )
  const hasRuntimes = supportedInstalled.length > 0

  const doCreate = async (): Promise<void> => {
    const name = agentName.trim() || randomAgentName()
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      showToast(t("agents.newDialog.toast.invalidName"), "warning")
      return
    }
    if (!agentPath.trim()) {
      showToast(t("agents.newDialog.toast.selectFolder"), "warning")
      return
    }
    try {
      await window.api.addAgent({
        name,
        type: selectedType,
        path: agentPath.trim(),
      })
      showToast(t("agents.newDialog.toast.created", { name }), "success")
      onCreated(name, selectedType)
    } catch (err: unknown) {
      showToast(
        t("agents.newDialog.toast.error", { message: (err as Error).message }),
        "error",
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("agents.newDialog.title")}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("agents.newDialog.loadingTypes")}
            </p>
          ) : !hasRuntimes ? (
            <p className="text-sm text-muted-foreground">
              {t("agents.newDialog.noRuntimes")}
            </p>
          ) : (
            <>
              <Field>
                <FieldLabel>{t("agents.newDialog.agentType")}</FieldLabel>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {supportedInstalled.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.label || c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="agent-name">
                  {t("agents.newDialog.agentName")}
                </FieldLabel>
                <Input
                  id="agent-name"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="swift-lynx-37"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="agent-working-directory">
                  {t("agents.newDialog.workingDirectory")}
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="agent-working-directory"
                    className="flex-1"
                    value={agentPath}
                    onChange={(e) => {
                      setFolderTouched(true)
                      setAgentPath(e.target.value)
                    }}
                    placeholder={t("agents.newDialog.workingDirectoryPlaceholder")}
                  />
                  <Button variant="outline" onClick={() => void browseFolder()}>
                    {t("agents.newDialog.browse")}
                  </Button>
                </div>
              </Field>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("agents.newDialog.cancel")}
          </Button>
          {hasRuntimes ? (
            <Button data-testid="new-agent-create" onClick={doCreate} disabled={loading}>
              {t("agents.newDialog.create")}
            </Button>
          ) : (
            <Button
              onClick={() => {
                onClose()
                setCurrentTab("install")
              }}
            >
              {t("agents.newDialog.goToInstall")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
