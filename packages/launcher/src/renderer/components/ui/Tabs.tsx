import * as React from "react"
import { cn } from "../../lib/utils"

/**
 * Two things share this segmented-control look:
 *
 * - `"tabs"`   — picking one swaps the panel below it (GitHub issues/pulls,
 *                the workspace connect dialog's paste/create/browser forms).
 * - `"filter"` — picking one narrows a list that is always on screen
 *                (Connections' all/connected, the Credentials provider filter).
 *
 * They must not share ARIA. `role="tab"` promises a `tabpanel` it controls, so
 * putting it on a filter chip advertises a relationship that does not exist and
 * leaves screen-reader users hunting for a panel. Filters are a single-choice
 * group, which is exactly `radiogroup`/`radio`.
 */
type TabsMode = "tabs" | "filter"

// ─── context ───────────────────────────────────────────────────────────────
const TabsCtx = React.createContext<{ value: string; onChange: (v: string) => void; mode: TabsMode } | null>(null)

function useTabs(): { value: string; onChange: (v: string) => void; mode: TabsMode } {
  const ctx = React.useContext(TabsCtx)
  if (!ctx) throw new Error("Tabs: must be used inside <Tabs>")
  return ctx
}

// ─── Tabs (root) ───────────────────────────────────────────────────────────
interface TabsProps {
  value: string
  onValueChange: (v: string) => void
  children: React.ReactNode
  className?: string
  /** Defaults to `"tabs"`. See {@link TabsMode}. */
  mode?: TabsMode
}
function Tabs({ value, onValueChange, children, className, mode = "tabs" }: TabsProps): React.JSX.Element {
  const ctx = React.useMemo(
    () => ({ value, onChange: onValueChange, mode }),
    [value, onValueChange, mode],
  )
  return (
    <TabsCtx.Provider value={ctx}>
      <div className={cn(className)}>{children}</div>
    </TabsCtx.Provider>
  )
}

// ─── TabsList ──────────────────────────────────────────────────────────────
const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { mode } = useTabs()
    return (
      <div
        ref={ref}
        role={mode === "filter" ? "radiogroup" : "tablist"}
        className={cn("inline-flex items-center gap-1 rounded-(--radius-sm) bg-(--bg-input) p-1", className)}
        {...props}
      />
    )
  },
)
TabsList.displayName = "TabsList"

// ─── TabsTrigger ───────────────────────────────────────────────────────────
interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { value: string }
const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, ...props }, ref) => {
    const { value: active, onChange, mode } = useTabs()
    const isActive = active === value
    const isFilter = mode === "filter"
    return (
      <button
        ref={ref}
        type="button"
        role={isFilter ? "radio" : "tab"}
        aria-selected={isFilter ? undefined : isActive}
        aria-checked={isFilter ? isActive : undefined}
        data-state={isActive ? "active" : "inactive"}
        onClick={() => onChange(value)}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5",
          "text-[12px] font-medium text-(--text-secondary)",
          "transition-all duration-150 cursor-pointer select-none outline-none",
          "disabled:pointer-events-none disabled:opacity-50",
          isActive && "bg-(--bg-card) text-(--text-primary) shadow-sm",
          className,
        )}
        {...props}
      />
    )
  },
)
TabsTrigger.displayName = "TabsTrigger"

// ─── TabsContent ───────────────────────────────────────────────────────────
interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> { value: string }
const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => {
    const { value: active } = useTabs()
    if (active !== value) return null
    return <div ref={ref} role="tabpanel" className={cn("mt-4 outline-none", className)} {...props} />
  },
)
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
