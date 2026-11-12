/**
 * The workspace no longer has a phone layout: phones are served by the mobile
 * app, and a narrow desktop window keeps the desktop shell at its minimum width
 * (see `WORKSPACE_MIN_WIDTH` in the layout wrapper) instead of switching to a
 * single-pane layout. Callers that still branch on this always get the desktop
 * path. Phone-only *content* (not layout) asks `useIsMobileDevice` instead.
 */
export function useIsMobile() {
  return false;
}
