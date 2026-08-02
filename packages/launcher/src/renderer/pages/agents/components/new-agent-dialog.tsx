import React, { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useUiStore } from "@renderer/store/ui"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/shadcn/dialog"
import { Button } from "@renderer/components/shadcn/button"
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
        const installed = cat.filter(
          (c) => c.installed && supportedSet.has(c.name),
        )
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
      const picked = await window.api.selectDirectory(
        agentPath || homeDir || undefined,
      )
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
        <p className="loading-text">{t("agents.newDialog.loadingTypes")}</p>
      ) : supportedInstalled.length === 0 ? (
        <>
          <p className="hint">{t("agents.newDialog.noRuntimes")}</p>
          <div className="form-actions">
            <Button
              variant="default"
              onClick={() => {
                onClose()
                setCurrentTab("install")
              }}
            >
              {t("agents.newDialog.goToInstall")}
            </Button>
            <Button variant="outline" onClick={onClose}>{t("agents.newDialog.cancel")}</Button>
          </div>
        </>
      ) : (
        <>
          <div className="form-group">
            <label htmlFor="agent-type">
              {t("agents.newDialog.agentType")}
            </label>
            <select
              id="agent-type"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              {supportedInstalled.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.label || c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="agent-name">
              {t("agents.newDialog.agentName")}
            </label>
            <input
              id="agent-name"
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="swift-lynx-37"
            />
          </div>
          <div className="form-group">
            <label htmlFor="agent-working-directory">
              {t("agents.newDialog.workingDirectory")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="agent-working-directory"
                type="text"
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
          </div>
          <div className="form-actions">
            <Button variant="default" data-testid="new-agent-create" onClick={doCreate}>
              {t("agents.newDialog.create")}
            </Button>
            <Button variant="outline" onClick={onClose}>{t("agents.newDialog.cancel")}</Button>
          </div>
        </>
      )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
