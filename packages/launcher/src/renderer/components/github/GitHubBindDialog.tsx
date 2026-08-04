import React, { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { Field, FieldDescription, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { useAgentsStore } from "../../store/agents"
import { useCredentialsStore } from "../../store/credentials"
import { useGitHubStore } from "../../store/github"
import type { GitHubBinding } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface Props {
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
  /** Pre-select an agent (e.g. opened from an agent card). */
  initialAgent?: string | null
  /** Pre-fill from an existing binding (rebind flow). */
  existing?: GitHubBinding | null
}

export function GitHubBindDialog({
  open,
  onClose,
  showToast,
  initialAgent,
  existing,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const agents = useAgentsStore((s) => s.agents)
  const credentials = useCredentialsStore((s) => s.credentials)
  const refreshBindings = useGitHubStore((s) => s.refresh)

  const githubCreds = useMemo(
    () => credentials.filter((c) => c.provider === "github"),
    [credentials],
  )

  const [agentName, setAgentName] = useState("")
  const [repo, setRepo] = useState("")
  const [credentialId, setCredentialId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (existing) {
      setAgentName(existing.agentName)
      setRepo(`${existing.owner}/${existing.repo}`)
      setCredentialId(existing.credentialId)
    } else {
      setAgentName(initialAgent || agents[0]?.name || "")
      setRepo("")
      setCredentialId(githubCreds[0]?.id || "")
    }
  }, [open, existing, initialAgent, agents, githubCreds])

  const submit = async (): Promise<void> => {
    setError(null)
    if (!agentName) return setError(t("github.dialog.errorChooseAgent"))
    if (!repo.trim()) return setError(t("github.dialog.errorEnterRepo"))
    if (!credentialId) return setError(t("github.dialog.errorPickCredential"))

    setBusy(true)
    try {
      const res = await window.api.githubBindRepo({
        agentName,
        repo: repo.trim(),
        credentialId,
      })
      if (!res.ok) {
        setError(res.error || t("github.dialog.errorBindFailed"))
        return
      }
      await refreshBindings()
      showToast(
        t("github.toast.bound", {
          owner: res.binding!.owner,
          repo: res.binding!.repo,
          name: agentName,
        }),
        "success",
      )
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existing ? t("github.dialog.titleEdit") : t("github.dialog.titleCreate")}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          <Field>
            <FieldLabel>{t("github.dialog.agentLabel")} *</FieldLabel>
            <Select
              value={agentName}
              onValueChange={setAgentName}
              disabled={!!existing || busy || agents.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("github.dialog.noAgents")} />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.name} value={a.name}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="github-repo">
              {t("github.dialog.repoLabel")} *
            </FieldLabel>
            <Input
              id="github-repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder={t("github.dialog.repoPlaceholder")}
              disabled={busy}
            />
            <FieldDescription>{t("github.dialog.repoHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("github.dialog.credentialLabel")} *</FieldLabel>
            <Select
              value={credentialId}
              onValueChange={setCredentialId}
              disabled={busy || githubCreds.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("github.dialog.noCredentials")} />
              </SelectTrigger>
              <SelectContent>
                {githubCreds.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {githubCreds.length === 0 && (
              <FieldDescription>{t("github.dialog.credentialHint")}</FieldDescription>
            )}
          </Field>

          {error && (
            <p className="rounded-sm bg-(--danger-bg) px-3 py-2 text-2xs wrap-break-word text-(--danger-text)">
              {error}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy
              ? t("github.dialog.binding")
              : existing
                ? t("github.dialog.update")
                : t("github.dialog.bind")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
