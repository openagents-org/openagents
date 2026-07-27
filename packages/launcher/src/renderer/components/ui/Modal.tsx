import * as React from "react"
import { useEffect, useRef } from "react"
import ReactDOM from "react-dom"
import { cn } from "../../lib/utils"

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
  /** Panel layout: fixed header/footer with a scrollable body region. */
  layout?: "default" | "panel"
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.getClientRects().length > 0)
}

/**
 * Open modals, oldest first. Only the topmost one reacts to Escape.
 *
 * Without this, the single `document` keydown listener every mounted Modal used
 * to register meant one Escape press closed *all* of them at once — visible on
 * the Install page, which can have a confirm modal stacked on top of the setup
 * wizard.
 */
const modalStack: symbol[] = []

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  layout = "default",
}: ModalProps): React.JSX.Element | null {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const idRef = React.useRef<symbol | null>(null)
  if (idRef.current === null) idRef.current = Symbol("modal")
  const titleId = React.useId()

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const id = idRef.current as symbol
    // Avoid pushing duplicates when the effect re-runs
    const existingIdx = modalStack.indexOf(id)
    if (existingIdx !== -1) modalStack.splice(existingIdx, 1)
    modalStack.push(id)

    // Remember where focus came from so it can be handed back on close —
    // otherwise focus falls back to <body> and keyboard users lose their place.
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Give the dialog initial focus, unless a child already claimed it via
    // React's autoFocus (which runs before this effect).
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      ;(focusableWithin(panel)[0] ?? panel).focus()
    }

    const handler = (e: KeyboardEvent): void => {
      if (modalStack[modalStack.length - 1] !== id) return
      if (e.key === "Escape") {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab") return
      const el = panelRef.current
      if (!el) return
      const items = focusableWithin(el)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !el.contains(active)
      if (e.shiftKey ? active === first || outside : active === last || outside) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }

    // Capture phase so the trap runs before anything inside the dialog, and so
    // Escape is consumed before global shortcuts see it.
    document.addEventListener("keydown", handler, true)
    return () => {
      document.removeEventListener("keydown", handler, true)
      const i = modalStack.indexOf(id)
      if (i !== -1) modalStack.splice(i, 1)
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null

  const isPanel = layout === "panel"
  const labelledBy = title && !isPanel ? titleId : undefined

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/20 backdrop-blur-2xl animate-[fadeIn_0.15s_var(--ease)]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : title}
        tabIndex={-1}
        className={cn(
          "min-w-100 max-w-130 rounded-lg bg-(--bg-card) border border-(--border) shadow-lg",
          "animate-[modalIn_0.22s_var(--ease)]",
          isPanel
            ? "flex flex-col max-h-[min(80vh,720px)] overflow-hidden"
            : "max-h-[80vh] overflow-y-auto p-7",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && !isPanel && <ModalTitle id={labelledBy}>{title}</ModalTitle>}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function ModalHeader({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={cn("shrink-0 px-7 pt-7 pb-4 border-b border-(--border)", className)}>
      {children}
    </div>
  )
}

export function ModalBody({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex-1 min-h-0 overflow-y-auto scrollbar-hide px-7 py-4 flex flex-col gap-4",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function ModalFooter({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "shrink-0 flex flex-col gap-3 px-7 py-4 border-t border-(--border) bg-(--bg-card)",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function ModalTitle({
  className,
  children,
  style,
  id,
}: {
  className?: string
  children: React.ReactNode
  style?: React.CSSProperties
  /** Set by Modal so the dialog can point `aria-labelledby` at this heading. */
  id?: string
}): React.JSX.Element {
  return (
    <h3
      id={id}
      className={cn(
        "text-[17px] font-bold mb-5 tracking-[-0.02em]",
        className,
      )}
      style={style}
    >
      {children}
    </h3>
  )
}

export function ModalActions({ className, children }: { className?: string; children: React.ReactNode }): React.JSX.Element {
  return <div className={cn("flex flex-row gap-2 mt-5", className)}>{children}</div>
}
