'use client';

import { createContext, useContext } from 'react';

/**
 * Where overlays (menus, popovers, dialogs) portal to. Undefined means the
 * primitives' own default, document.body — which is what the web app uses.
 *
 * The desktop router keeps a route mounted behind the one in front of it,
 * hidden with <Activity>. React hides a hidden tree's DOM, but not what that
 * tree portaled into document.body, and it disconnects the effects that would
 * have finished closing it. A menu that navigated away mid-close was left
 * stranded over the next page, pinned to the corner its now-hidden trigger
 * reported. Each route provides a container inside its own tree instead, so
 * its overlays are hidden with it.
 */
export const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext);
}
