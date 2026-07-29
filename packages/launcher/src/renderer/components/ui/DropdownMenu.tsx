import * as React from "react"
import { cn } from "../../lib/utils"

/**
 * Minimal overflow menu — enough for "one primary action + the rest behind a
 * ⋯", which is what the narrow cards in this app need. Closes on outside
 * click, on Escape, and after any item is chosen.
 */
const MenuContext = React.createContext<{ close: () => void }>({ close: () => {} })

export function DropdownMenu({
  trigger,
  children,
  className,
  menuClassName,
}: {
  /** Rendered as the toggle; click handling is supplied by the wrapper. */
  trigger: React.ReactNode
  children: React.ReactNode
  /** Applied to the positioning wrapper (e.g. `ml-auto`). */
  className?: string
  menuClassName?: string
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className={cn("relative", className)}>
      <span
        role="button"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="contents"
      >
        {trigger}
      </span>
      {open && (
        <MenuContext.Provider value={{ close: () => setOpen(false) }}>
          <div
            role="menu"
            className={cn(
              "absolute right-0 top-full mt-1 z-30 min-w-[132px] py-1",
              "rounded-sm border border-(--border) bg-(--bg-card) shadow-(--shadow-md)",
              menuClassName,
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  )
}

export function DropdownMenuItem({
  children,
  onSelect,
  destructive,
  disabled,
}: {
  children: React.ReactNode
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const { close } = React.useContext(MenuContext)
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close()
        onSelect()
      }}
      className={cn(
        "block w-full text-left px-3 py-[5px] text-[11px] leading-[1.6]",
        "bg-transparent border-0 cursor-pointer transition-colors duration-100",
        "disabled:opacity-35 disabled:cursor-not-allowed",
        destructive
          ? "text-(--danger-text) hover:enabled:bg-(--danger-bg)"
          : "text-(--text-primary) hover:enabled:bg-(--bg-input)",
      )}
    >
      {children}
    </button>
  )
}

export function DropdownMenuSeparator(): React.JSX.Element {
  return <div className="my-1 h-px bg-(--border)" />
}
