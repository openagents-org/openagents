import React, { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown } from "lucide-react"

import { DialogBody, DialogFooter } from "@renderer/components/ui/dialog"
import { Button } from "@renderer/components/ui/button"
import { SearchInput } from "@renderer/components/ui-kit"
import { useAgentsStore } from "@renderer/store/agents"
import { cn } from "@renderer/lib/utils"
import type { PairedWorkspace } from "@renderer/components/workspaces/use-pair-device"
import type { ToastType } from "@renderer/hooks/useToast"
import { PairCodeForm } from "./connect-workspace-pair"
import { WorkspaceOptionRow, type WorkspaceOption } from "./workspace-option-row"

/**
 * The add-to-workspace dialog when this device is in at least one workspace:
 * pick one and connect. Joining another one is secondary: a pairing code can
 * be entered right here, folded away until asked for.
 */
export function ConnectWorkspacePicker({
  options,
  onConnect,
  onPaired,
  onCancel,
  showToast,
}: {
  options: WorkspaceOption[]
  onConnect: (slug: string) => void
  onPaired: (workspace: PairedWorkspace) => void
  onCancel: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const agents = useAgentsStore((s) => s.agents)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const [pairOpen, setPairOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((ws) =>
      [ws.name, ws.slug, ws.id].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [options, query])

  // Keep the selection inside the result set as the query narrows it.
  useEffect(() => setCursor(0), [query])

  // Follow the keyboard when it walks past the visible window.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView?.({ block: "nearest" })
  }, [cursor])

  const selected = filtered[cursor]
  const connect = (ws: WorkspaceOption | undefined): void => {
    if (ws) onConnect(ws.slug || ws.id)
  }

  const onSearchKeyDown = (e: React.KeyboardEvent): void => {
    if (filtered.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setCursor((c) => (c + 1) % filtered.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setCursor((c) => (c - 1 + filtered.length) % filtered.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      connect(selected)
    }
  }

  return (
    <>
      <DialogBody ref={listRef} className="gap-3 py-4">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          onKeyDown={onSearchKeyDown}
          placeholder={t("agents.connectDialog.searchPlaceholder")}
          autoFocus
        />

        <div role="radiogroup" aria-label={t("agents.connectDialog.pickHint")} className="flex flex-col gap-2">
          {filtered.length === 0 ? (
            <p className="m-0 py-4 text-center text-xs text-muted-foreground">
              {t("agents.connectDialog.noMatch")}
            </p>
          ) : (
            filtered.map((ws, i) => (
              <WorkspaceOptionRow
                key={ws.id}
                workspace={ws}
                selected={i === cursor}
                agentsLabel={t("agents.connectDialog.agentCount", {
                  count: agents.filter((a) => a.network === ws.slug || a.network === ws.id).length,
                })}
                onSelect={() => setCursor(i)}
                onPick={() => connect(ws)}
              />
            ))
          )}
        </div>

        <div className="border-t pt-3">
          <button
            type="button"
            aria-expanded={pairOpen}
            onClick={() => setPairOpen((v) => !v)}
            className="flex w-full items-start gap-2 text-left"
          >
            <ChevronDown className={cn("mt-0.5 size-4 shrink-0 transition-transform", !pairOpen && "-rotate-90")} />
            <span>
              <span className="block text-sm font-medium">{t("agents.connectDialog.pairToggle")}</span>
              <span className="block text-xs text-muted-foreground">{t("agents.connectDialog.pairToggleHint")}</span>
            </span>
          </button>
          {pairOpen && <PairCodeForm className="mt-3" onPaired={onPaired} showToast={showToast} />}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("agents.connectDialog.cancel")}
        </Button>
        <Button data-testid="ws-connect-submit" disabled={!selected} onClick={() => connect(selected)}>
          {t("agents.connectDialog.connect")}
        </Button>
      </DialogFooter>
    </>
  )
}
