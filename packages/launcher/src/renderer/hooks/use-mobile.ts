import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * shadcn's breakpoint hook, used by the sidebar to switch to a sheet on narrow
 * screens. The window's minimum width (960px, or the work area on a smaller
 * screen) keeps the launcher above it in practice.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = (): void => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
