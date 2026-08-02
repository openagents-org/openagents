import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Copy, Eye, EyeOff, Link2, Pencil, Trash2 } from "lucide-react"

import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Card } from "../ui/card"
import { PlatformLogo } from "../connections/PlatformLogo"
import { getPlatform } from "../connections/platforms"
import { CredentialUsage } from "./CredentialUsage"
import { cn } from "../../lib/utils"
import type { CredentialSummary } from "../../types"

const CHIP = "px-1.5 py-0 text-3xs"

interface Props {
  cred: CredentialSummary
  onEdit: () => void
  onRemove: () => void
  onTest: () => void
  onReveal: () => Promise<void>
  onApply: () => void
  revealed: string | null
  testing: boolean
}

export function CredentialCard({
  cred,
  onEdit,
  onRemove,
  onTest,
  onReveal,
  onApply,
  revealed,
  testing,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const platform = getPlatform(cred.provider)
  const [copied, setCopied] = useState(false)

  const copySecret = async (): Promise<void> => {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const lastTest = cred.lastTestedAt
    ? new Date(cred.lastTestedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null

  return (
    <Card className="gap-3 px-4 py-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        {platform ? (
          <PlatformLogo platform={platform} size={32} />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted-foreground text-sm font-bold text-background">
            ?
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold tracking-tight">
              {cred.label}
            </span>
            <Badge variant="secondary" className={CHIP}>
              {cred.kind.replace("_", " ")}
            </Badge>
            {cred.shared && (
              <Badge variant="outline" className={CHIP}>
                {t("credentials.card.shared")}
              </Badge>
            )}
            {cred.scopes?.map((s) => (
              <Badge key={s} variant="secondary" className={cn(CHIP, "text-(--text-link)")}>
                {s}
              </Badge>
            ))}
          </div>
          <div className="mt-0.5 text-2xs text-muted-foreground">
            {platform?.label || cred.provider}
            {lastTest && (
              <>
                {" · "}
                <span
                  className={
                    cred.lastTestOk ? "text-(--success-text)" : "text-(--danger-text)"
                  }
                >
                  {t("credentials.card.tested", { date: lastTest })}{" "}
                  {cred.lastTestOk ? "✓" : "✗"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 truncate rounded-sm bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
          {revealed ?? cred.secretMasked}
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onReveal}
          title={revealed ? t("credentials.card.hide") : t("credentials.card.reveal")}
        >
          {revealed ? <EyeOff /> : <Eye />}
        </Button>
        {revealed && (
          <Button
            size="icon"
            variant="ghost"
            onClick={copySecret}
            title={t("credentials.card.copy")}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        )}
      </div>

      <CredentialUsage cred={cred} />

      <div className="mt-1 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onTest} disabled={testing}>
          {testing ? t("credentials.card.testing") : t("credentials.card.test")}
        </Button>
        <Button size="sm" variant="outline" onClick={onApply}>
          <Link2 />
          {t("credentials.card.applyToAgent")}
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil />
          {t("credentials.card.edit")}
        </Button>
        <Button size="sm" variant="destructive-ghost" onClick={onRemove}>
          <Trash2 />
          {t("credentials.card.remove")}
        </Button>
      </div>
    </Card>
  )
}
