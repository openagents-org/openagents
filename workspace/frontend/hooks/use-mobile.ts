import { useEffect, useState } from 'react';
import { isMobileDevice } from './use-mobile-device';

/** Below this width a phone or tablet gets the single-pane layout. */
const MOBILE_LAYOUT_MAX_WIDTH = 1024;

/**
 * Whether to use the single-pane phone layout. Only a phone or tablet does,
 * and only while it is narrow (a tablet held in landscape keeps the desktop
 * shell, as before). On a computer a narrow window stays the desktop layout at
 * its minimum width (see `WORKSPACE_MIN_WIDTH` in the layout wrapper), however
 * small the window gets.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (!isMobileDevice()) return;
    const check = () => setIsMobile(window.innerWidth < MOBILE_LAYOUT_MAX_WIDTH);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}
