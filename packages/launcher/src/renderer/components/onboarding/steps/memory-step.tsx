import React, { useState } from "react"
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Undo2, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import type { MemoryScanItem } from "@renderer/types"

import { SectionLabel } from "../onboarding-chrome"
import type { OnboardingMemoryApi } from "../use-onboarding-memory"

function formatBytes(n: number): string {
  if (!n) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`
  return `${Math.round(n / (1024 * 104.8576)) / 10} MB`
}

function ItemRow({
  item,
  memory,
}: {
  item: MemoryScanItem
  memory: OnboardingMemoryApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<{ path: string; text: string }[] | null>(null)
  const selectable = item.status === "importable" && !memory.receipt
  const togglePreview = async (): Promise<void> => {
    const next = !open
    setOpen(next)
    if (next && !files) {
      try {
        setFiles(await memory.preview(item.id))
      } catch {
        setFiles([])
      }
    }
  }
  return (
    <div className="rounded-lg border border-(--border) bg-(--bg-card) px-3.5 py-2.5 text-xs">
      <div className="flex items-start gap-2.5">
        {selectable ? (
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 shrink-0"
            checked={memory.picked.has(item.id)}
            onChange={() => memory.toggle(item.id)}
            aria-label={item.label}
          />
        ) : item.status === "skipped" ? (
          <X className="mt-0.5 size-3.5 shrink-0 text-(--text-tertiary)" />
        ) : (
          <Check className="mt-0.5 size-3.5 shrink-0 text-(--success)" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-(--text-primary)">{item.label}</span>
            <span className="shrink-0 rounded bg-(--bg-secondary) px-1.5 py-0.5 text-2xs uppercase tracking-wide text-(--text-tertiary)">
              {t(`onboarding.flow.memory.kind.${item.kind}`)}
            </span>
          </div>
          <div className="mt-0.5 break-all font-mono text-2xs text-(--text-tertiary)">
            {item.source}
            {item.fileCount ? ` · ${t("onboarding.flow.memory.files", { count: item.fileCount })}` : ""}
            {item.bytes ? ` · ${formatBytes(item.bytes)}` : ""}
          </div>
          {item.description && <div className="mt-0.5 text-(--text-secondary)">{item.description}</div>}
          {item.note && <div className="mt-0.5 text-(--text-tertiary)">{item.note}</div>}
          {item.secret && (
            <div className="mt-1 flex items-center gap-1 text-(--warning)">
              <AlertTriangle className="size-3 shrink-0" />
              {t("onboarding.flow.memory.secret")}
            </div>
          )}
          {item.files.length > 0 && item.kind !== "skill" && (
            <button
              type="button"
              onClick={() => void togglePreview()}
              className="mt-1 inline-flex items-center gap-0.5 text-(--text-tertiary) hover:text-(--text-primary)"
            >
              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {open ? t("onboarding.flow.memory.hidePreview") : t("onboarding.flow.memory.preview")}
            </button>
          )}
          {open && (
            <div className="mt-1.5 max-h-64 space-y-2 overflow-y-auto rounded bg-(--bg-secondary) p-2">
              {!files ? (
                <div className="text-(--text-tertiary)">{t("onboarding.flow.memory.previewLoading")}</div>
              ) : (
                files.map((f) => (
                  <div key={f.path}>
                    <div className="font-mono text-2xs text-(--text-tertiary)">{f.path}</div>
                    <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-2xs text-(--text-secondary)">{f.text}</pre>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * "Bring your memory": what the new agent can keep from the user's own
 * Claude Code / Codex / OpenClaw setup. The footer holds the actions.
 */
export function MemoryStep({ memory }: { memory: OnboardingMemoryApi }): React.JSX.Element {
  const { t } = useTranslation()
  const { scan, scanning, error, receipt } = memory
  const tool = scan?.tool || ""
  const agent = memory.agentName || ""

  if (scanning && !scan) {
    return (
      <div className="flex items-center gap-2 py-10 text-xs text-(--text-tertiary)">
        <Loader2 className="size-4 animate-spin" />
        {t("onboarding.flow.memory.scanning", { tool: tool || "…" })}
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-3 py-6 text-xs">
        <p className="text-(--text-secondary)">{t("onboarding.flow.memory.failed", { tool: tool || "…", message: error })}</p>
        <Button variant="outline" size="sm" onClick={() => void memory.rescan()}>
          {t("onboarding.flow.memory.retry")}
        </Button>
      </div>
    )
  }
  if (!scan) return <></>

  if (receipt) {
    return (
      <>
        <div className="flex items-start gap-2.5 rounded-lg border border-(--border) bg-(--bg-card) px-4 py-3 text-xs">
          <Check className="mt-0.5 size-4 shrink-0 text-(--success)" />
          <div>
            <div className="font-medium text-(--text-primary)">{t("onboarding.flow.memory.receiptTitle")}</div>
            <div className="mt-0.5 text-(--text-secondary)">
              {t("onboarding.flow.memory.receiptBody", { agent, count: receipt.items.length, tool: receipt.tool || tool, files: receipt.files })}
            </div>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 text-xs">
          {receipt.items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-(--text-secondary)">
              <Check className="size-3 shrink-0 text-(--success)" />
              <span className="truncate">{i.label}</span>
              <span className="ml-auto shrink-0 text-(--text-tertiary)">{t("onboarding.flow.memory.files", { count: i.files })}</span>
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 text-(--text-tertiary)"
          disabled={memory.undoing}
          onClick={() => void memory.undo()}
        >
          {memory.undoing ? <Loader2 className="animate-spin" /> : <Undo2 />}
          {t("onboarding.flow.memory.undo")}
        </Button>
      </>
    )
  }

  const groups: { key: MemoryScanItem["status"]; title: string }[] = [
    { key: "importable", title: t("onboarding.flow.memory.groupImportable") },
    { key: "imported", title: t("onboarding.flow.memory.groupImported") },
    { key: "loaded", title: t("onboarding.flow.memory.groupLoaded") },
    { key: "skipped", title: t("onboarding.flow.memory.groupSkipped") },
  ]
  const importable = scan.items.filter((i) => i.status === "importable")
  return (
    <>
      {importable.length === 0 && (
        <p className="mb-4 rounded-lg bg-(--bg-secondary) px-4 py-3 text-xs text-(--text-secondary)">
          {t("onboarding.flow.memory.nothingFound", { agent, tool })}
        </p>
      )}
      {groups.map((g, gi) => {
        const list = scan.items.filter((i) => i.status === g.key)
        if (!list.length) return null
        return (
          <section key={g.key} className={cn(gi > 0 && "mt-6")}>
            <SectionLabel>{g.title}</SectionLabel>
            <div className="space-y-2">
              {list.map((item) => (
                <ItemRow key={item.id} item={item} memory={memory} />
              ))}
            </div>
          </section>
        )
      })}
      <p className="mt-6 mb-0 text-2xs text-(--text-tertiary)">{t("onboarding.flow.memory.later")}</p>
    </>
  )
}
