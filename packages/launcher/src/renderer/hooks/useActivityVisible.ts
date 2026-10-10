import { useLayoutEffect, useState } from "react"

/**
 * False while the calling component sits inside a hidden `<Activity>`.
 *
 * Pages stay mounted behind `<Activity mode="hidden">` when you navigate away
 * (see App.tsx). Hiding destroys their effects but not what they rendered into
 * a portal, and a Radix overlay that was mid-way through its closing animation
 * at that moment stops listening for the animation's end — so it never
 * unmounts. The Logs page's filter popover was left floating in the window's
 * corner over the next page that way: the click on the sidebar that closed it
 * was the same click that navigated.
 *
 * Hiding runs layout-effect cleanups, which is what flips this to false; the
 * overlay then renders nothing and its portal goes away.
 */
export function useActivityVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useLayoutEffect(() => {
    setVisible(true)
    return () => setVisible(false)
  }, [])
  return visible
}
