import React, { useEffect, useState } from "react"
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
import { useAgentsStore } from "../../store/agents"
import { getPlatform } from "../connections/platforms"
import type { CredentialSummary } from "../../types"
import type { ToastType } from "../../hooks/useToast"

const CODE = "rounded-sm bg-muted px-1 py-0.5 font-mono"

/**
 * Writes a credential's secret into one or more agent .env files under a
 * caller-chosen env-var key. Bridges the encrypted Credentials store to the
 * legacy ~/.openagents/env/<type>.env files that resolve_env reads.
 *
 * stage.md §4.4 — image: "src/env.js 增强".
 */
export function CredentialApplyDialog({
  open,
  onClose,
  credential,
  onApplied,
  showToast,
}: {
  open: boolean
  onClose: () => void
  credential: CredentialSummary | null
  onApplied: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const agents = useAgentsStore((s) => s.agents)
  const platform = credential ? getPlatform(credential.provider) : undefined
  const [envKey, setEnvKey] = useState(platform?.defaultEnvKey || "")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // De-dupe by agent type — we apply per-type, not per-agent-instance, because
  // the resolve_env file lives at ~/.openagents/env/<type>.env.
  const types = Array.from(new Set(agents.map((a) => a.type))).sort()

  useEffect(() => {
    if (!open) return
    setEnvKey(platform?.defaultEnvKey || "")
    // Preselect types that already list this credential in their usedByAgents.
    setSelected(new Set(credential?.usedByAgents || []))
  }, [open, platform, credential])

  const toggleType = (type: string): void => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(type)) n.delete(type)
      else n.add(type)
      return n
    })
  }

  const handleApply = async (): Promise<void> => {
    if (!credential) return
    if (!envKey.trim()) {
      showToast(t("credentials.apply.toasts.envKeyRequired"), "warning")
      return
    }
    if (selected.size === 0) {
      showToast(t("credentials.apply.toasts.pickType"), "warning")
      return
    }
    setBusy(true)
    try {
      const res = await window.api.applyCredentialToAgents({
        credentialId: credential.id,
        envKey: envKey.trim(),
        agentTypes: Array.from(selected),
      })
      if (res.ok) {
        showToast(
          t("credentials.apply.toasts.applied", { count: res.written?.length || 0 }),
          "success",
        )
        onApplied()
        onClose()
      } else {
        showToast(
          res.error ||
            (res.errors || []).join("; ") ||
            t("credentials.apply.toasts.applyFailed"),
          "error",
        )
      }
    } catch (err) {
      showToast(
        t("credentials.apply.toasts.error", { message: (err as Error).message }),
        "error",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {credential
              ? t("credentials.apply.title", { label: credential.label })
              : t("credentials.apply.titleFallback")}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          <Field>
            <FieldLabel htmlFor="credential-env-key">
              {t("credentials.apply.envKeyLabel")}
            </FieldLabel>
            <Input
              id="credential-env-key"
              value={envKey}
              onChange={(e) => setEnvKey(e.target.value.toUpperCase())}
              placeholder={t("credentials.apply.envKeyPlaceholder")}
              autoFocus
            />
            <FieldDescription>
              {t("credentials.apply.envKeyHintPrefix")}{" "}
              <code className={CODE}>~/.openagents/env/&lt;type&gt;.env</code>
              {t("credentials.apply.envKeyHintSuffix")}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("credentials.apply.targetTypesLabel")}</FieldLabel>
            {types.length === 0 ? (
              <p className="rounded-sm bg-muted px-3 py-2 text-xs text-muted-foreground">
                {t("credentials.apply.noAgents")}
              </p>
            ) : (
              <div className="flex max-h-45 flex-wrap gap-1.5 overflow-y-auto">
                {types.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    size="sm"
                    variant={selected.has(type) ? "default" : "secondary"}
                    className="h-auto px-2.5 py-1 text-2xs"
                    onClick={() => toggleType(type)}
                  >
                    {type}
                  </Button>
                ))}
              </div>
            )}
          </Field>

          <p className="rounded-sm bg-muted px-3 py-2 text-2xs leading-relaxed text-muted-foreground">
            {t("credentials.apply.previewPrefix")} <code className={CODE}>.env</code>{" "}
            {t("credentials.apply.previewMiddle")}{" "}
            <strong className="text-foreground">
              {envKey || t("credentials.apply.envKeyPlaceholderShort")}
            </strong>{" "}
            {t("credentials.apply.previewSuffix")}
          </p>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("credentials.apply.cancel")}
          </Button>
          <Button onClick={handleApply} disabled={busy || types.length === 0}>
            {busy ? t("credentials.apply.applying") : t("credentials.apply.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
