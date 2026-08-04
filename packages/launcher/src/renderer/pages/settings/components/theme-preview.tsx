import React from "react"

import { cn } from "@renderer/lib/utils"
import type { ThemeMode } from "@renderer/store/theme"

/**
 * Miniature of the app window in a given theme: rail on the left, header and
 * content blocks on the right.
 *
 * Colours are literal palette classes, not design tokens — each tile has to
 * show what that theme looks like while the app itself is rendered in a
 * different one, which is exactly what tokens cannot do.
 */
export function ThemePreview({ mode }: { mode: ThemeMode }): React.JSX.Element {
  // "System" shows one window cut down the middle: the same miniature drawn
  // light, with its dark twin clipped to the right half and offset back into
  // place so the two halves line up pixel for pixel.
  if (mode === "system") {
    return (
      <div className="relative h-16 w-full overflow-hidden rounded-md border border-border">
        <Pane dark={false} />
        <div className="absolute inset-y-0 right-0 left-1/2 overflow-hidden">
          <div className="absolute inset-y-0 right-0 -left-full">
            <Pane dark />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-16 w-full overflow-hidden rounded-md border border-border">
      <Pane dark={mode === "dark"} />
    </div>
  )
}

function Pane({ dark }: { dark: boolean }): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex h-full w-full",
        dark ? "bg-zinc-900" : "bg-zinc-100",
      )}
    >
      <div
        className={cn(
          "h-full w-1/4 shrink-0 p-1",
          dark ? "bg-zinc-950" : "bg-white",
        )}
      >
        <div
          className={cn(
            "mb-1 h-1 w-full rounded-full",
            dark ? "bg-zinc-700" : "bg-zinc-300",
          )}
        />
        <div
          className={cn(
            "mb-1 h-1 w-3/4 rounded-full",
            dark ? "bg-zinc-800" : "bg-zinc-200",
          )}
        />
        <div
          className={cn(
            "h-1 w-3/4 rounded-full",
            dark ? "bg-zinc-800" : "bg-zinc-200",
          )}
        />
      </div>

      <div className="min-w-0 flex-1 p-1.5">
        <div
          className={cn(
            "mb-1.5 h-1.5 w-1/2 rounded-full",
            dark ? "bg-zinc-700" : "bg-zinc-300",
          )}
        />
        <div
          className={cn(
            "mb-1 h-4 w-full rounded-sm",
            dark ? "bg-zinc-800" : "bg-white",
          )}
        />
        <div
          className={cn(
            "h-4 w-full rounded-sm",
            dark ? "bg-zinc-800" : "bg-white",
          )}
        />
      </div>
    </div>
  )
}
