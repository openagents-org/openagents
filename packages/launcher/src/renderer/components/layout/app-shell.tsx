import React from "react"

import { StatusFooter } from "./status-footer"

/**
 * This Computer below the top bar: the current page, then the status line.
 * Navigation lives in the top bar's second row, so there is no rail. Pages own
 * their own scrolling, so the frame itself never scrolls.
 */
export function AppShell({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
      <StatusFooter />
    </div>
  )
}
