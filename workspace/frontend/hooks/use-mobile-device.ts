import { useSyncExternalStore } from 'react';

type DeviceNavigator = Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { userAgentData?: { mobile?: boolean } };

/**
 * Whether the browser runs on a phone or tablet — a device that cannot install
 * the desktop app or run agents. This is about the device, not the window
 * width: a narrow desktop window is still a computer.
 */
export function isMobileDevice(nav: DeviceNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  if (nav.userAgentData?.mobile) return true;
  // iPadOS reports a desktop Mac user agent; only its touch points give it away.
  return /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

const subscribe = () => () => {};

/** `isMobileDevice()` for components; false during server rendering. */
export function useIsMobileDevice(): boolean {
  return useSyncExternalStore(subscribe, () => isMobileDevice(), () => false);
}
