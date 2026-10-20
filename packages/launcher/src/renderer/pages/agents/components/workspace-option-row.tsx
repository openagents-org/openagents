import React from "react"
import { CornerDownLeft } from "lucide-react"

import { cn } from "@renderer/lib/utils"

export interface WorkspaceOption {
  id: string
  slug: string
  name?: string
  endpoint?: string
  token?: string
}

/** One workspace in the add-to-workspace picker. */
export function WorkspaceOptionRow({
  workspace,
  active,
  inUse,
  onHover,
  onPick,
}: {
  workspace: WorkspaceOption
  active: boolean
  inUse: boolean
  onHover: () => void
  onPick: () => void
}): React.JSX.Element {
  const shortId = workspace.slug || workspace.id
  return (
    <button
      type="button"
      data-testid={`ws-option-${shortId}`}
      data-active={active}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "flex w-full shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors",
        // `active` is the cursor, not a stored choice, so this takes the hover
        // state the menus and the rail use — written out rather than via
        // ROW_HOVER because the cursor here is a prop, not `:focus`.
        active && "bg-row-hover text-row-hover-foreground",
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          inUse ? "bg-success" : "bg-muted-foreground/40",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {workspace.name || shortId}
      </span>
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">
        {shortId}
      </span>
      {active && (
        <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  )
}
