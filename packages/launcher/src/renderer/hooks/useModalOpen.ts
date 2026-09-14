import { useEffect, useState } from "react"

import { OPEN_MODAL } from "@renderer/lib/modal-chrome"

/**
 * Whether a modal is currently on screen.
 *
 * Read from the DOM rather than from React state for the same reason
 * modal-chrome does it: `data-state` flips the instant a dialog closes, while
 * an unmount-driven counter depends on an exit animation reporting back and
 * strands itself when one never does.
 *
 * The embedded workspace view needs this because it is a native view layered
 * above the page — a dialog opened over it would otherwise be painted over.
 */
export function useModalOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const sync = (): void => setOpen(!!document.querySelector(OPEN_MODAL))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    })
    return () => observer.disconnect()
  }, [])

  return open
}
