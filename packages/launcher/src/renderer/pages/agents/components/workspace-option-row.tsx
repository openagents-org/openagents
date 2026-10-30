import React from "react"

import { cn } from "@renderer/lib/utils"

export interface WorkspaceOption {
  id: string
  slug: string
  name?: string
  endpoint?: string
  token?: string
}

/**
 * One workspace in the add-to-workspace picker, as a radio choice. A click
 * selects it; the dialog's Connect button (or a double click, or Enter) joins.
 */
export function WorkspaceOptionRow({
  workspace,
  selected,
  agentsLabel,
  onSelect,
  onPick,
}: {
  workspace: WorkspaceOption
  selected: boolean
  /** How many of this computer's agents are already in it, as words. */
  agentsLabel: string
  onSelect: () => void
  onPick: () => void
}): React.JSX.Element {
  const shortId = workspace.slug || workspace.id
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`ws-option-${shortId}`}
      data-active={selected}
      onClick={onSelect}
      onDoubleClick={onPick}
      className={cn(
        "flex w-full shrink-0 items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary bg-(--accent-bg)"
          : "border-border hover:bg-row-hover",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary" : "border-muted-foreground/50",
        )}
      >
        {selected && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{workspace.name || shortId}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {agentsLabel} · <span className="font-mono">{shortId}</span>
        </span>
      </span>
    </button>
  )
}
