import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import type { CatalogEntry } from "../../types"
import type { ToastType } from "../../hooks/useToast"

const SECTION = "px-4.5 py-4 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm"
const SECTION_H4 = "text-xs font-semibold uppercase tracking-wider text-(--text-secondary) m-0 mb-2.5"

interface AgentQuickStartProps {
  entry: CatalogEntry
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * Getting-started panel (stage.md §2.2 — 使用入门指南).
 *
 * Combines three sources, in priority order:
 *   1. registry-provided `quick_start` markdown (preserved whitespace)
 *   2. registry-provided `example_commands` (cmd + optional description)
 *   3. derived hint — "run `<binary>`" + login_command if check_ready has one
 *
 * If nothing is available the section is hidden so empty entries don't
 * surface a card that just says "no info."
 */
export function AgentQuickStart({
  entry,
  showToast,
}: AgentQuickStartProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)

  const quickStart = entry.quick_start?.trim() || ""
  const examples = (entry.example_commands || []).filter((e) => e?.cmd)
  const loginCmd = entry.check_ready?.login_command?.trim() || ""
  const binary = entry.install?.binary

  // Derive a default first-run command list when registry doesn't supply one.
  const derived: Array<{ cmd: string; description?: string }> = []
  if (examples.length === 0) {
    if (binary) derived.push({ cmd: binary, description: t("agents.quickStart.launch", { name: entry.label || entry.name }) })
    if (loginCmd) derived.push({ cmd: loginCmd, description: t("agents.quickStart.signInConfigure") })
  }
  const commands = examples.length > 0 ? examples : derived

  const docs = entry.docs || entry.homepage
  const github = entry.github

  if (!quickStart && commands.length === 0 && !docs && !github) return null

  async function copy(cmd: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(cmd)
      showToast(t("agents.quickStart.toast.copied"), "success")
      setTimeout(() => setCopied((c) => (c === cmd ? null : c)), 1500)
    } catch {
      showToast(t("agents.quickStart.toast.copyFailed"), "error")
    }
  }

  return (
    <div className={SECTION}>
      <h4 className={SECTION_H4}>{t("agents.quickStart.title")}</h4>

      {quickStart && (
        <p className="text-xs text-(--text-secondary) leading-[1.7] m-0 mb-3 whitespace-pre-wrap">
          {quickStart}
        </p>
      )}

      {commands.length > 0 && (
        <ul className="list-none m-0 p-0 flex flex-col gap-2">
          {commands.map((ex, i) => (
            <li key={`${ex.cmd}-${i}`} className="flex flex-col gap-1">
              {ex.description && (
                <span className="text-2xs text-(--text-tertiary)">
                  {ex.description}
                </span>
              )}
              <div className="flex items-stretch gap-0 border border-(--border) rounded-(--radius) overflow-hidden">
                <code className="flex-1 text-2xs px-2.5 py-1.5 bg-(--bg-input) text-(--text-primary) font-mono whitespace-pre-wrap break-all">
                  {ex.cmd}
                </code>
                <button
                  type="button"
                  onClick={() => copy(ex.cmd)}
                  className="px-2.5 text-2xs text-(--text-secondary) bg-(--bg-card) border-l border-(--border) cursor-pointer hover:text-(--text-primary) hover:bg-(--bg-card-hover) transition-colors"
                  aria-label={t("agents.quickStart.copyCommand")}
                >
                  {copied === ex.cmd ? t("agents.quickStart.copied") : t("agents.quickStart.copy")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(docs || github) && (
        <div className="mt-3 flex items-center gap-3 flex-wrap text-2xs">
          {docs && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.api.openExternal(docs) }}
            >
              {t("agents.quickStart.documentation")}
            </a>
          )}
          {github && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.api.openExternal(github) }}
            >
              {t("agents.quickStart.github")}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
